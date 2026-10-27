import { ClockSync } from '../shared/clock-sync';
import type { EconomyView } from '../shared/economy';
import type { EnemyPose } from '../shared/enemy-state';
import { RemoteTrack, createPoseOut } from '../shared/interpolation';
import type { Vec3 } from '../shared/look';
import { NET } from '../shared/net-config';
import {
  closeInfo,
  type BlockCommand,
  type CloseInfo,
  type CloseReason,
  type EditRecord,
  type HostFrame,
  type PlayerId,
  type PlayerSample,
  type RemotePose,
  type WorldEvent,
} from '../shared/protocol';
import { SHOT_FLAG, type ShotEvent } from '../shared/shot';
import type { WildPose } from '../shared/wildlife-state';
import {
  KIND_ENEMIES,
  KIND_WILDLIFE,
  decodeEdits,
  decodeEnemies,
  decodeWildlife,
  decodeHostFrame,
  decodeRelay,
  encodeFrame,
  encodeGuestState,
  packetKind,
  roundTo,
  seqNewer,
} from '../shared/wire';
import type { SurvivalView } from '../shared/survival-state';
import type { VitalsView } from '../shared/vitals-state';
import { EconomyMirror } from './economy-sync';
import { Emitter } from './emitter';
import { EnemyMirror } from './enemy-mirror';
import type { Scheduler } from './scheduler';
import { StallWatch } from './stall-watch';
import type {
  Correction,
  GameSession,
  NetStats,
  Rejection,
  RosterEntry,
  SessionPhase,
  SessionRole,
  Unsubscribe,
  WorldBinding,
} from './session';
import { SurvivalMirror } from './survival-mirror';
import { VitalsMirror } from './vitals-mirror';
import { NetError, type Link, type Transport } from './transport';

export interface GuestSessionOptions {
  scheduler: Scheduler;
  world: WorldBinding;
  transport: Transport;
  name: string;
  token: string;
  buildId: string;
}

interface Seat {
  id: PlayerId;
  slot: number;
  name: string;
  rtt: number | null;
}

type Welcome = Extract<HostFrame, { t: 'welcome' }>;
type Run = Extract<HostFrame, { t: 'run' }>;

/** Commands a guest remembers so a refusal can say which one it was. */
const REMEMBERED_COMMANDS = 64;
/** More than this many tracks cannot belong to a room, whatever the host sends. */
const MAX_TRACKS = 8;
const GOODBYE_GRACE_MS = 400;
const STEP_MS = 500;
/** What a guest that is not in the world yet draws. */
const NO_ENEMIES: readonly EnemyPose[] = [];
const NO_WILDLIFE: readonly WildPose[] = [];

const REASON_FOR_ERROR: Record<string, CloseReason> = {
  'broker-unreachable': 'broker-unreachable',
  'room-not-found': 'room-not-found',
  'timed-out': 'timed-out',
  unsupported: 'unsupported',
};

/**
 * A player in someone else's room. It dials the host, says hello, builds the host's world from
 * the snapshot, then sends its own movement, asks for block changes and applies the host's
 * events. The host is the authority: this side only requests and displays.
 */
export class GuestSession implements GameSession {
  private readonly scheduler: Scheduler;
  private readonly binding: WorldBinding;
  private readonly transport: Transport;
  private readonly mirror: SurvivalMirror;
  private readonly vitalsMirror = new VitalsMirror();
  private readonly economyMirror = new EconomyMirror();
  private readonly enemyMirror = new EnemyMirror();
  private readonly wildMirror = new EnemyMirror(NET.maxWildlife);

  private phaseValue: SessionPhase = 'connecting';
  private closedInfo: CloseInfo | null = null;
  private code: string | null = null;
  private link: Link | null = null;
  private welcome: Welcome | null = null;
  private localIdValue: PlayerId = 0;
  private hostId: PlayerId = 0;
  private epoch = 0;

  private readonly seats = new Map<PlayerId, Seat>();
  private readonly tracks = new Map<PlayerId, RemoteTrack>();
  private readonly sync = new ClockSync();
  private lastRelaySeq: number | null = null;
  private lastEnemySeq: number | null = null;
  private lastWildSeq: number | null = null;
  /** Which run this screen is in: 1 for the first, one more each time the host starts over. */
  private runValue = 1;
  /** The run whose world is being built now, or 0. */
  private runLoading = 0;
  /** A start-over that arrived while the world of the first run was still being built: played as soon as that is done. */
  private deferredRun: Run | null = null;

  private readonly parts = new Map<number, EditRecord[]>();
  private readonly queued: { seq: number; event: WorldEvent }[] = [];
  private lastEventSeq = 0;

  private commandId = 0;
  private readonly sent = new Map<number, BlockCommand>();

  private sendSeq = 0;
  private lastSend = -Infinity;
  private pingNonce = 0;
  private readonly pingSent = new Map<number, number>();
  private lastPing = -Infinity;
  private lastHeard = 0;
  private stall: StallWatch | null = null;

  private cancelWelcome: (() => void) | null = null;
  private stopStep: (() => void) | null = null;
  private stopDial: (() => void) | null = null;

  private readonly events = new Emitter<WorldEvent>();
  private readonly rejections = new Emitter<Rejection>();
  private readonly shots = new Emitter<ShotEvent>();
  private readonly playerChanges = new Emitter<void>();
  private readonly phases = new Emitter<SessionPhase>();
  private readonly corrections = new Emitter<Correction>();
  private readonly runs = new Emitter<number>();

  private readonly counters: NetStats = {
    rttMs: null,
    staleDropped: 0,
    corrections: 0,
    rejections: 0,
    badFrames: 0,
  };

  private readonly poses: RemotePose[] = [];
  private readonly poseSlots: RemotePose[] = [];
  private readonly poseOut = createPoseOut();

  constructor(private readonly options: GuestSessionOptions) {
    this.scheduler = options.scheduler;
    this.binding = options.world;
    this.transport = options.transport;
    this.mirror = new SurvivalMirror(options.scheduler);
  }

  // --------------------------------------------------------------------------------------------
  // GameSession.
  // --------------------------------------------------------------------------------------------

  get role(): SessionRole {
    return 'guest';
  }
  get phase(): SessionPhase {
    return this.phaseValue;
  }
  get localId(): PlayerId {
    return this.localIdValue;
  }
  get roomCode(): string | null {
    return this.code;
  }
  get closed(): CloseInfo | null {
    return this.closedInfo;
  }
  get roomOnline(): boolean {
    return true;
  }
  get stats(): Readonly<NetStats> {
    return this.counters;
  }
  get survival(): SurvivalView {
    return this.mirror;
  }
  get vitals(): VitalsView {
    return this.vitalsMirror;
  }
  get economy(): EconomyView {
    return this.economyMirror;
  }
  get run(): number {
    return this.runValue;
  }
  get players(): readonly RosterEntry[] {
    return [...this.seats.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((seat) => ({
        id: seat.id,
        slot: seat.slot,
        name: seat.name,
        isHost: seat.id === this.hostId,
        pingMs: seat.id === this.localIdValue ? this.counters.rttMs : seat.rtt,
      }));
  }

  sendCommand(command: BlockCommand): void {
    if (this.phaseValue !== 'open' || !this.link) return;
    const id = ++this.commandId;
    this.sent.set(id, command);
    if (this.sent.size > REMEMBERED_COMMANDS) {
      const oldest = this.sent.keys().next();
      if (!oldest.done) this.sent.delete(oldest.value);
    }
    this.link.sendControl(encodeFrame({ t: 'cmd', id, c: command }));
  }

  /**
   * Sends a shot to the host, stamped with the moment of the host's clock that the machines on
   * this screen are drawn at, so the host can judge it against what the shooter saw.
   */
  fire(origin: Vec3, dir: Vec3): void {
    if (this.phaseValue !== 'open' || !this.link || !this.sync.ready) return;
    const at = Math.round(this.sync.remoteNow(this.scheduler.now()) - NET.enemyDelayMs);
    this.link.sendControl(
      encodeFrame({
        t: 'fire',
        o: [roundTo(origin.x, 100), roundTo(origin.y, 100), roundTo(origin.z, 100)],
        d: [roundTo(dir.x, 10_000), roundTo(dir.y, 10_000), roundTo(dir.z, 10_000)],
        at,
      }),
    );
  }

  onEvent(listener: (event: WorldEvent) => void): Unsubscribe {
    return this.events.on(listener);
  }
  onRejected(listener: (rejection: Rejection) => void): Unsubscribe {
    return this.rejections.on(listener);
  }
  onShot(listener: (shot: ShotEvent) => void): Unsubscribe {
    return this.shots.on(listener);
  }
  onPlayers(listener: () => void): Unsubscribe {
    return this.playerChanges.on(listener);
  }
  onPhase(listener: (phase: SessionPhase) => void): Unsubscribe {
    return this.phases.on(listener);
  }
  onCorrection(listener: (correction: Correction) => void): Unsubscribe {
    return this.corrections.on(listener);
  }
  onRun(listener: (run: number) => void): Unsubscribe {
    return this.runs.on(listener);
  }

  /** The host decides whether the clock runs; a guest in the room is always counted as playing. */
  setLocalActive(): void {
    // Nothing to do on this side.
  }

  /** Starting over is the host's word. */
  restartRun(): void {
    // Nothing to do on this side.
  }

  publishState(sample: PlayerSample): void {
    if (this.phaseValue !== 'open' || !this.link) return;
    const now = this.scheduler.now();
    if (!sample.reset && now - this.lastSend < NET.stateIntervalMs - 1) return;
    this.lastSend = now;
    this.link.sendState(
      encodeGuestState({ epoch: this.epoch, seq: this.sendSeq++ & 0xffff, time: now, sample }),
    );
  }

  sampleEnemies(): readonly EnemyPose[] {
    if (this.phaseValue !== 'open' || !this.sync.ready) return NO_ENEMIES;
    return this.enemyMirror.sample(this.sync.remoteNow(this.scheduler.now()) - NET.enemyDelayMs);
  }

  sampleWildlife(): readonly WildPose[] {
    if (this.phaseValue !== 'open' || !this.sync.ready) return NO_WILDLIFE;
    return this.wildMirror.sample(this.sync.remoteNow(this.scheduler.now()) - NET.enemyDelayMs);
  }

  sampleRemotes(): readonly RemotePose[] {
    this.poses.length = 0;
    if (this.phaseValue !== 'open' || !this.sync.ready) return this.poses;
    const renderTime = this.sync.remoteNow(this.scheduler.now()) - NET.interpDelayMs;
    let used = 0;
    for (const seat of this.seats.values()) {
      if (seat.id === this.localIdValue) continue;
      const track = this.tracks.get(seat.id);
      if (!track || !track.sample(renderTime, this.poseOut)) continue;
      const pose = (this.poseSlots[used] ??= {
        id: 0,
        slot: 0,
        name: '',
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
        speed: 0,
        onGround: true,
      });
      pose.id = seat.id;
      pose.slot = seat.slot;
      pose.name = seat.name;
      pose.x = this.poseOut.x;
      pose.y = this.poseOut.y;
      pose.z = this.poseOut.z;
      pose.yaw = this.poseOut.yaw;
      pose.pitch = this.poseOut.pitch;
      pose.speed = this.poseOut.speed;
      pose.onGround = this.poseOut.onGround;
      this.poses.push(pose);
      used++;
    }
    return this.poses;
  }

  close(): void {
    if (this.phaseValue === 'closed') return;
    const link = this.link;
    if (link) {
      link.sendControl(encodeFrame({ t: 'bye' }));
      this.scheduler.after(GOODBYE_GRACE_MS, () => link.close());
      this.link = null;
    }
    this.finish(closeInfo('left'));
  }

  // --------------------------------------------------------------------------------------------
  // Joining.
  // --------------------------------------------------------------------------------------------

  /** Starts dialling the room. Progress is reported through `onPhase`; failure ends in `closed`. */
  join(code: string): void {
    if (this.code !== null) return;
    this.code = code;
    this.lastHeard = this.scheduler.now();
    void this.dial(code);
  }

  private dialWithTimeout(code: string): Promise<Link> {
    return new Promise((resolve, reject) => {
      const abort = new AbortController();
      let settled = false;
      const cancel = this.scheduler.after(NET.dialTimeoutMs, () => {
        settled = true;
        abort.abort();
        reject(new NetError('timed-out', 'The host did not answer.'));
      });
      this.stopDial = () => {
        cancel();
        if (!settled) abort.abort();
        settled = true;
        this.stopDial = null;
      };
      this.transport.dial(code, abort.signal).then(
        (link) => {
          if (settled) {
            link.close();
            return;
          }
          settled = true;
          cancel();
          this.stopDial = null;
          resolve(link);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          cancel();
          this.stopDial = null;
          reject(error);
        },
      );
    });
  }

  private async dial(code: string): Promise<void> {
    let link: Link;
    try {
      link = await this.dialWithTimeout(code);
    } catch (error) {
      const kind = error instanceof NetError ? error.kind : 'error';
      this.fail(REASON_FOR_ERROR[kind] ?? 'error');
      return;
    }
    if (this.phaseValue === 'closed') {
      link.close();
      return;
    }
    this.link = link;
    this.lastHeard = this.scheduler.now();
    link.attach({
      control: (text) => this.onControl(text),
      state: (bytes) => this.onState(bytes),
      closed: () => {
        this.link = null;
        this.fail('host-left');
      },
    });
    link.sendControl(
      encodeFrame({
        t: 'hello',
        v: NET.protocolVersion,
        build: this.options.buildId,
        token: this.options.token,
        name: this.options.name,
      }),
    );
    this.cancelWelcome = this.scheduler.after(NET.welcomeTimeoutMs, () => this.fail('timed-out'));
    this.stall = new StallWatch(STEP_MS, this.scheduler.now());
    this.stopStep = this.scheduler.every(STEP_MS, () => this.step());
  }

  // --------------------------------------------------------------------------------------------
  // Frames from the host.
  // --------------------------------------------------------------------------------------------

  private onControl(text: string): void {
    const frame = decodeHostFrame(text);
    if (!frame) {
      this.counters.badFrames++;
      return;
    }
    this.lastHeard = this.scheduler.now();
    switch (frame.t) {
      case 'welcome':
        this.onWelcome(frame);
        break;
      case 'deny':
        this.fail(
          frame.reason === 'full'
            ? 'room-full'
            : frame.reason === 'version'
              ? 'version-mismatch'
              : 'room-not-found',
        );
        break;
      case 'snap':
        this.onSnap(frame.i, frame.b);
        break;
      case 'join':
        this.seats.set(frame.p.id, { ...frame.p, rtt: null });
        this.playerChanges.emit();
        break;
      case 'leave':
        this.seats.delete(frame.id);
        this.tracks.delete(frame.id);
        this.playerChanges.emit();
        break;
      case 'ev':
        this.onWorldEvent(frame.s, frame.e);
        break;
      case 'rej': {
        const command = this.sent.get(frame.id);
        this.sent.delete(frame.id);
        this.counters.rejections++;
        if (command) this.rejections.emit({ command, reason: frame.r });
        break;
      }
      case 'fix':
        this.epoch = frame.epoch;
        this.counters.corrections++;
        this.corrections.emit({ x: frame.x, y: frame.y, z: frame.z });
        break;
      case 'pong': {
        const sentAt = this.pingSent.get(frame.n);
        if (sentAt !== undefined) {
          this.pingSent.delete(frame.n);
          this.counters.rttMs = Math.max(0, this.scheduler.now() - sentAt);
          this.playerChanges.emit();
        }
        break;
      }
      case 'sv':
        this.mirror.apply(
          frame.tick,
          frame.run,
          frame.core[0],
          frame.core[1],
          frame.over,
          frame.why ?? null,
          frame.rc[0],
          frame.rc[1],
          frame.st[0],
          frame.st[1],
          frame.st[2],
          frame.st[3],
          frame.st[4],
        );
        break;
      case 'run':
        // The frames that follow are the new run's economy: the old one goes now, once, even if the
        // restart itself has to wait for the first world to finish building.
        if (frame.n > Math.max(this.runValue, this.runLoading, this.deferredRun?.n ?? 0)) {
          this.economyMirror.reset();
        }
        this.onRunFrame(frame);
        break;
      case 'ec':
        this.economyMirror.applyPool(frame.pl, frame.cap, frame.rp, frame.cl);
        break;
      case 'nl':
        this.economyMirror.debris.setList(frame.n);
        break;
      case 'hd':
        this.economyMirror.debris.strip({
          by: frame.p,
          node: frame.i,
          material: frame.m,
          gained: frame.g,
          left: frame.l,
          full: frame.f,
        });
        break;
      case 'se':
        this.mirror.announce(frame.e);
        break;
      case 'vt':
        this.vitalsMirror.apply(
          frame.hp[0],
          frame.hp[1],
          frame.en[0],
          frame.en[1],
          frame.chg,
          frame.rt,
          frame.sk,
        );
        break;
      case 'sh':
        // A shot heard of before the world is built has nothing to be drawn in.
        if (this.phaseValue !== 'open') break;
        this.shots.emit({
          by: frame.p,
          x: frame.e[0],
          y: frame.e[1],
          z: frame.e[2],
          flags: frame.f,
          enemy: frame.f & (SHOT_FLAG.enemy | SHOT_FLAG.wild) ? frame.h : 0,
          ...(frame.c ? { turret: frame.c } : {}),
        });
        break;
      case 'pings':
        for (const [id, rtt] of frame.p) {
          const seat = this.seats.get(id);
          if (seat) seat.rtt = rtt;
        }
        this.playerChanges.emit();
        break;
      case 'bye':
        this.fail('host-left');
        break;
    }
  }

  private onWelcome(frame: Welcome): void {
    if (this.welcome) return;
    this.cancelWelcome?.();
    this.cancelWelcome = null;
    if (frame.v !== NET.protocolVersion) {
      this.fail('version-mismatch');
      return;
    }
    this.welcome = frame;
    this.localIdValue = frame.id;
    this.hostId = frame.hostId;
    this.epoch = frame.epoch;
    this.runValue = frame.run;
    this.lastEventSeq = frame.seq;
    for (const player of frame.players) this.seats.set(player.id, { ...player, rtt: null });
    this.sync.observe(this.scheduler.now(), frame.hostTime);
    this.setPhase('loading');
    this.playerChanges.emit();
    if (frame.parts === 0) this.finishLoading();
  }

  private onSnap(index: number, blob: string): void {
    const welcome = this.welcome;
    if (!welcome || this.phaseValue !== 'loading' || index >= welcome.parts) return;
    if (this.parts.has(index)) return;
    const records = decodeEdits(blob);
    if (!records) {
      this.counters.badFrames++;
      this.fail('error');
      return;
    }
    this.parts.set(index, records);
    if (this.parts.size === welcome.parts) this.finishLoading();
  }

  private finishLoading(): void {
    const welcome = this.welcome;
    if (!welcome) return;
    const edits: EditRecord[] = [];
    for (let i = 0; i < welcome.parts; i++) edits.push(...(this.parts.get(i) ?? []));
    if (edits.length !== welcome.edits) {
      this.counters.badFrames++;
      this.fail('error');
      return;
    }
    this.parts.clear();
    this.binding.load(welcome.seed, edits).then(
      () => {
        if (this.phaseValue !== 'loading') return;
        const backlog = this.queued.splice(0);
        for (const { seq, event } of backlog) this.applyEvent(seq, event);
        this.setPhase('open');
        this.corrections.emit({ x: welcome.spawn.x, y: welcome.spawn.y, z: welcome.spawn.z });
        this.playDeferredRun();
      },
      (error: unknown) => {
        console.error(error);
        this.fail('error');
      },
    );
  }

  /**
   * The host started the run over: forget the old run, build the valley for the host's seed with
   * nothing on it, and stand where the host put this player. The session is `loading` meanwhile, so
   * nothing is sent and nothing the others do is drawn until the new world is up; what the host
   * says about it in the meantime is kept and applied then.
   */
  private onRunFrame(frame: Run): void {
    if (this.phaseValue === 'loading' && this.runLoading === 0) {
      // Still building the first world: start over as soon as it is up.
      if (!this.deferredRun || frame.n > this.deferredRun.n) this.deferredRun = frame;
      return;
    }
    if (this.phaseValue !== 'open' && this.phaseValue !== 'loading') return;
    if (frame.n <= Math.max(this.runValue, this.runLoading)) return;
    this.runLoading = frame.n;
    this.epoch = frame.epoch;
    this.lastEventSeq = frame.seq;
    this.queued.length = 0;
    this.sent.clear();
    this.tracks.clear();
    this.enemyMirror.clear();
    this.wildMirror.clear();
    this.mirror.reset();
    this.vitalsMirror.reset();
    this.setPhase('loading');
    this.binding.load(frame.seed, []).then(
      () => {
        if (this.phaseValue !== 'loading' || this.runLoading !== frame.n) return;
        const backlog = this.queued.splice(0);
        for (const { seq, event } of backlog) this.applyEvent(seq, event);
        this.runValue = frame.n;
        this.runLoading = 0;
        this.setPhase('open');
        this.corrections.emit({ x: frame.spawn.x, y: frame.spawn.y, z: frame.spawn.z });
        this.runs.emit(frame.n);
        this.playDeferredRun();
      },
      (error: unknown) => {
        console.error(error);
        this.fail('error');
      },
    );
  }

  private playDeferredRun(): void {
    const next = this.deferredRun;
    this.deferredRun = null;
    if (next) this.onRunFrame(next);
  }

  private onWorldEvent(seq: number, event: WorldEvent): void {
    if (this.phaseValue === 'loading') this.queued.push({ seq, event });
    else if (this.phaseValue === 'open') this.applyEvent(seq, event);
  }

  private applyEvent(seq: number, event: WorldEvent): void {
    if (seq <= this.lastEventSeq) return;
    this.lastEventSeq = seq;
    this.binding.current().setBlock(event.x, event.y, event.z, event.state);
    this.events.emit(event);
  }

  private onState(bytes: Uint8Array): void {
    const kind = packetKind(bytes);
    if (kind === KIND_ENEMIES) {
      this.onEnemies(bytes);
      return;
    }
    if (kind === KIND_WILDLIFE) {
      this.onWildlife(bytes);
      return;
    }
    const packet = decodeRelay(bytes);
    if (!packet) {
      this.counters.badFrames++;
      return;
    }
    const now = this.scheduler.now();
    this.lastHeard = now;
    if (this.lastRelaySeq !== null && !seqNewer(packet.seq, this.lastRelaySeq)) {
      this.counters.staleDropped++;
      return;
    }
    this.lastRelaySeq = packet.seq;
    this.sync.observe(now, packet.hostTime);
    for (const entry of packet.entries) {
      if (entry.id === this.localIdValue) continue;
      let track = this.tracks.get(entry.id);
      if (!track) {
        if (this.tracks.size >= MAX_TRACKS) continue;
        track = new RemoteTrack();
        this.tracks.set(entry.id, track);
      }
      track.push(packet.hostTime - entry.age, entry.sample);
    }
  }

  /** The host's word on where the machines are. Reports that arrive out of order are dropped, like players'. */
  private onEnemies(bytes: Uint8Array): void {
    const packet = decodeEnemies(bytes);
    if (!packet) {
      this.counters.badFrames++;
      return;
    }
    const now = this.scheduler.now();
    this.lastHeard = now;
    if (this.lastEnemySeq !== null && !seqNewer(packet.seq, this.lastEnemySeq)) {
      this.counters.staleDropped++;
      return;
    }
    this.lastEnemySeq = packet.seq;
    this.sync.observe(now, packet.hostTime);
    this.enemyMirror.push(packet.hostTime, packet.entries, packet.entries.length);
  }

  /** The host's word on where the creatures of the wildlife are: the machines' rules, with a sequence of its own. */
  private onWildlife(bytes: Uint8Array): void {
    const packet = decodeWildlife(bytes);
    if (!packet) {
      this.counters.badFrames++;
      return;
    }
    const now = this.scheduler.now();
    this.lastHeard = now;
    if (this.lastWildSeq !== null && !seqNewer(packet.seq, this.lastWildSeq)) {
      this.counters.staleDropped++;
      return;
    }
    this.lastWildSeq = packet.seq;
    this.sync.observe(now, packet.hostTime);
    this.wildMirror.push(packet.hostTime, packet.entries, packet.entries.length);
  }

  // --------------------------------------------------------------------------------------------
  // Upkeep.
  // --------------------------------------------------------------------------------------------

  private step(): void {
    if (this.phaseValue === 'closed') return;
    const now = this.scheduler.now();
    // Our own page was blocked, so the host's packets are still waiting to be read: the silence
    // during the stall is not the host's.
    const late = this.stall?.lateBy(now) ?? 0;
    if (late > 0) this.lastHeard = Math.min(now, this.lastHeard + late);
    if (now - this.lastHeard > NET.timeoutMs) {
      this.fail('host-lost');
      return;
    }
    if (this.phaseValue === 'open' && this.link && now - this.lastPing >= NET.pingIntervalMs) {
      this.lastPing = now;
      const n = ++this.pingNonce;
      this.pingSent.set(n, now);
      this.pingSent.delete(n - 8);
      this.link.sendControl(encodeFrame({ t: 'ping', n, rtt: this.counters.rttMs ?? 0 }));
    }
  }

  private fail(reason: CloseReason): void {
    if (this.phaseValue === 'closed') return;
    const link = this.link;
    this.link = null;
    link?.close();
    this.finish(closeInfo(reason));
  }

  private finish(info: CloseInfo): void {
    this.closedInfo = info;
    this.stopDial?.();
    this.cancelWelcome?.();
    this.cancelWelcome = null;
    this.stopStep?.();
    this.stopStep = null;
    this.queued.length = 0;
    this.parts.clear();
    this.tracks.clear();
    this.enemyMirror.clear();
    this.wildMirror.clear();
    this.setPhase('closed');
    this.playerChanges.emit();
  }

  private setPhase(phase: SessionPhase): void {
    if (this.phaseValue === phase) return;
    this.phaseValue = phase;
    this.phases.emit(phase);
  }
}
