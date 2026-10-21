import { ClockSync } from '../shared/clock-sync';
import { RemoteTrack, createPoseOut } from '../shared/interpolation';
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
import {
  decodeEdits,
  decodeHostFrame,
  decodeRelay,
  encodeFrame,
  encodeGuestState,
  seqNewer,
} from '../shared/wire';
import { Emitter } from './emitter';
import type { Scheduler } from './scheduler';
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

/** Commands a guest remembers so a refusal can say which one it was. */
const REMEMBERED_COMMANDS = 64;
/** More than this many tracks cannot belong to a room, whatever the host sends. */
const MAX_TRACKS = 8;
const GOODBYE_GRACE_MS = 400;
const STEP_MS = 500;

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

  private cancelWelcome: (() => void) | null = null;
  private stopStep: (() => void) | null = null;
  private stopDial: (() => void) | null = null;

  private readonly events = new Emitter<WorldEvent>();
  private readonly rejections = new Emitter<Rejection>();
  private readonly playerChanges = new Emitter<void>();
  private readonly phases = new Emitter<SessionPhase>();
  private readonly corrections = new Emitter<Correction>();

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

  onEvent(listener: (event: WorldEvent) => void): Unsubscribe {
    return this.events.on(listener);
  }
  onRejected(listener: (rejection: Rejection) => void): Unsubscribe {
    return this.rejections.on(listener);
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

  publishState(sample: PlayerSample): void {
    if (this.phaseValue !== 'open' || !this.link) return;
    const now = this.scheduler.now();
    if (!sample.reset && now - this.lastSend < NET.stateIntervalMs - 1) return;
    this.lastSend = now;
    this.link.sendState(
      encodeGuestState({ epoch: this.epoch, seq: this.sendSeq++ & 0xffff, time: now, sample }),
    );
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
      },
      (error: unknown) => {
        console.error(error);
        this.fail('error');
      },
    );
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

  // --------------------------------------------------------------------------------------------
  // Upkeep.
  // --------------------------------------------------------------------------------------------

  private step(): void {
    if (this.phaseValue === 'closed') return;
    const now = this.scheduler.now();
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
    this.setPhase('closed');
    this.playerChanges.emit();
  }

  private setPhase(phase: SessionPhase): void {
    if (this.phaseValue === phase) return;
    this.phaseValue = phase;
    this.phases.emit(phase);
  }
}
