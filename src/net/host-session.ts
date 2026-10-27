import type { BlockWorld } from '../shared/block-world';
import { ClockSync } from '../shared/clock-sync';
import type { EconomyView } from '../shared/economy';
import { createEnemyState, type EnemyPose, type EnemyState } from '../shared/enemy-state';
import { createWildState, type WildPose, type WildState } from '../shared/wildlife-state';
import { RemoteTrack, createPoseOut } from '../shared/interpolation';
import type { Vec3 } from '../shared/look';
import { MoveGuard } from '../shared/move-guard';
import { PLAYER } from '../shared/movement';
import { cleanName, defaultName } from '../shared/names';
import { NET } from '../shared/net-config';
import {
  HOST_PLAYER_ID,
  NO_PLAYER,
  closeInfo,
  createPlayerSample,
  type BlockCommand,
  type BlockSetEvent,
  type CloseInfo,
  type DenyReason,
  type EditRecord,
  type GuestFrame,
  type PlayerId,
  type PlayerSample,
  type PlayerWire,
  type RemotePose,
  type WorldEvent,
} from '../shared/protocol';
import type { ShotEvent } from '../shared/shot';
import type {
  RestartKind,
  SurvivalEvent,
  SurvivalReading,
  SurvivalView,
} from '../shared/survival-state';
import { createVitalsReading, type VitalsReading, type VitalsView } from '../shared/vitals-state';
import {
  decodeGuestFrame,
  decodeGuestState,
  encodeEdits,
  encodeEnemies,
  encodeFrame,
  encodeRelay,
  encodeWildlife,
  roundTo,
  seqNewer,
  type RelayEntry,
} from '../shared/wire';
import { DEBRIS } from '../systems/economy/balance';
import { upgradeBlocker, upgradeStep } from '../systems/economy/build-rules';
import type { NavCell } from '../systems/survival/nav';
import { createShotOutcome, type SurvivalSim } from '../systems/survival/sim';
import type { TurretShot } from '../systems/survival/turrets';
import { HostEconomyReport } from './economy-sync';
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
import type { HostEndpoint, Link, Transport } from './transport';

/** Why the host refuses a command, in words fit to show the player. */
export const REFUSAL = {
  notReady: 'not ready yet',
  rate: 'too fast',
  reach: 'out of reach',
  body: 'a player is in the way',
  failed: 'could not change that block',
  down: 'you are down',
  over: 'the run is over',
  nothing: 'nothing to salvage there',
  depleted: 'nothing left there',
  poolFull: 'the pool is full',
  changed: 'that block has changed',
} as const;

export interface HostSessionOptions {
  scheduler: Scheduler;
  world: WorldBinding;
  /** The host player's display name. */
  name: string;
  /** The host's own token (kept by the browser). */
  token: string;
  /**
   * Where a player in this slot starts. Given the place a player fell when the Core brings them back,
   * it may choose a spawn near it (a Bed) instead of the slot's seat.
   */
  spawnFor?: (slot: number, near?: Vec3) => { x: number; y: number; z: number };
  /** The survival simulation this host runs. Absent where only the world is under test. */
  survival?: SurvivalSim;
  /**
   * A fresh simulation for the next run, built after the world has been rebuilt for it (it reads
   * the new world). Without it the host cannot start over.
   */
  newRun?: () => SurvivalSim;
  /** The seed of a new valley, for `restartRun('new')`: a whole number that is not the current one. */
  nextSeed?: () => number;
}

interface Member {
  readonly id: PlayerId;
  readonly slot: number;
  name: string;
  readonly token: string;
  /** Null for the host's own player. */
  readonly link: Link | null;
  readonly guard: MoveGuard;
  sample: PlayerSample | null;
  /** When `sample` was taken, on the host's clock. */
  sampleTime: number;
  stateSeq: number | null;
  epoch: number;
  readonly sync: ClockSync;
  readonly track: RemoteTrack;
  rtt: number | null;
  lastHeard: number;
  editTokens: number;
  editAt: number;
  /** What this guest was last told about its own Health and Energy; null before the first word. */
  vitalsSent: VitalsSent | null;
  /** When that word was sent, on the host's clock. */
  vitalsAt: number;
  /** When this player last stripped a heap of debris, on the host's clock. */
  harvestAt: number;
}

/** The part of a guest's meters that is news when it changes: whole points, the charge field, and the two countdowns. */
interface VitalsSent {
  health: number;
  energy: number;
  charging: boolean;
  returnIn: number;
  shaken: number;
}

interface Pending {
  readonly link: Link;
  cancel: () => void;
}

interface Departed {
  readonly id: PlayerId;
  readonly slot: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const DEFAULT_SPAWN = (slot: number) => ({
  x: 0.5 + (slot % 2) * 2,
  y: 0,
  z: 0.5 + Math.floor(slot / 2) * 2,
});

/** What a host without a simulation shows: the first morning, held, and nothing to announce. */
const IDLE_SURVIVAL: SurvivalView = {
  read(out) {
    out.elapsed = 0;
    out.cycle = 1;
    out.phase = 'day';
    out.into = 0;
    out.left = 0;
    out.sky = 0;
    out.running = false;
    out.coreHealth = 0;
    out.coreMax = 0;
    out.over = false;
    out.overWhy = null;
    out.respawns = 0;
    out.respawnMax = 0;
    return out;
  },
  onEvent: () => () => undefined,
};

/** What a host without a simulation shows for its own player: nothing to read, so the bars are drawn full. */
const IDLE_VITALS: VitalsView = {
  read(out) {
    out.health = 0;
    out.healthMax = 0;
    out.energy = 0;
    out.energyMax = 0;
    out.speedScale = 1;
    out.handScale = 1;
    out.charging = false;
    out.returnIn = 0;
    out.shaken = 0;
    return out;
  },
};

/** Time a refused or finished link is given to flush its last frame before it is closed. */
const GOODBYE_GRACE_MS = 400;
/** A returning guest whose old link has been quiet this long takes its old seat back. */
const TAKEOVER_SILENCE_MS = 3000;
/** A shot aimed along a vector shorter than this has no direction to speak of. */
const MIN_AIM_LENGTH = 0.5;
/** Where a shot ends is told to this fine a grid: a hundredth of a block, which no screen can show. */
const SHOT_GRID = 100;

/**
 * The authority. It runs single-player (no room open), and opens a room on request. It owns the
 * player table, validates every command, applies the resulting events to the world and fans
 * them out, checks guests' own movement, and relays everyone's state to everyone else.
 */
export class HostSession implements GameSession {
  private readonly scheduler: Scheduler;
  private readonly binding: WorldBinding;
  private readonly spawnFor: (slot: number, near?: Vec3) => { x: number; y: number; z: number };

  private readonly members = new Map<PlayerId, Member>();
  private readonly departed = new Map<string, Departed>();
  private readonly pending = new Set<Pending>();
  private nextId = HOST_PLAYER_ID + 1;
  private eventSeq = 0;
  private relaySeq = 0;
  private readonly stall: StallWatch;
  private lastRelay = -Infinity;
  private relayDirty = false;
  private lastPing = 0;

  private sim: SurvivalSim | null;
  private readonly newRun: (() => SurvivalSim) | null;
  private readonly nextSeed: (() => number) | null;
  /** Which run this is: 1 for the first, one more each time the host starts over. */
  private runValue = 1;
  /** A start-over is waiting for the world to be rebuilt. */
  private restarting = false;
  private readonly survivalView: SurvivalView;
  private readonly vitalsView: VitalsView;
  /** What the guests are told of the economy of the run being played now, and what the host's screen reads of it. */
  private readonly economyReport = new HostEconomyReport(() => this.sim?.economy ?? null);
  /** Scratch space for reading a guest's meters without allocating every tick. */
  private readonly vitalsScratch: VitalsReading = createVitalsReading();
  private localActive = false;
  private survivalAt: number;
  private survivalRunning = false;
  private survivalDirty = false;
  /** The Core's health as the guests were last told it; a different number is news. */
  private coreSent = -1;
  private lastSurvivalSend = -Infinity;
  private readonly survivalQueue: SurvivalEvent[] = [];
  /** Where the machines were after each step, drawn from the same way a guest draws them from the host's packets. */
  private readonly enemyMirror = new EnemyMirror();
  private readonly enemyStates: EnemyState[] = Array.from(
    { length: NET.maxEnemies },
    createEnemyState,
  );
  private enemySeq = 0;
  private lastEnemySend = -Infinity;
  /** How many machines the guests were last told about; a list that has just emptied still has to be sent. */
  private enemiesSent = 0;
  /** The same for the valley's wildlife: its own mirror, packet numbers and clock, drawn from by the host's screen and the shot judge. */
  private readonly wildMirror = new EnemyMirror(NET.maxWildlife);
  private readonly wildStates: WildState[] = Array.from(
    { length: NET.maxWildlife },
    createWildState,
  );
  private wildSeq = 0;
  private lastWildSend = -Infinity;
  private wildSent = 0;
  /** The blocks the machines chewed through, between the simulation and the world. */
  private readonly gnawed: NavCell[] = [];
  private readonly turretShots: TurretShot[] = [];
  /** Scratch space for deciding a shot: what a guest's frame said, the line it flies along and how it ended. */
  private readonly shotFrom: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly shotToward: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly muzzle: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly aim: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly outcome = createShotOutcome();

  private endpoint: HostEndpoint | null = null;
  private brokerOnline = true;
  private stopTimer: (() => void) | null = null;
  private roleValue: SessionRole = 'solo';
  private phaseValue: SessionPhase = 'open';
  private closedInfo: CloseInfo | null = null;

  private readonly events = new Emitter<WorldEvent>();
  private readonly rejections = new Emitter<Rejection>();
  private readonly shots = new Emitter<ShotEvent>();
  private readonly playerChanges = new Emitter<void>();
  private readonly phases = new Emitter<SessionPhase>();
  private readonly corrections = new Emitter<Correction>();
  private readonly survivalEvents = new Emitter<SurvivalEvent>();
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

  constructor(options: HostSessionOptions) {
    this.scheduler = options.scheduler;
    this.binding = options.world;
    this.spawnFor = options.spawnFor ?? DEFAULT_SPAWN;
    const now = this.scheduler.now();
    const spawn = this.spawnFor(0);
    const host = this.makeMember(
      HOST_PLAYER_ID,
      0,
      cleanName(options.name, defaultName(options.token)),
      options.token,
      null,
      now,
    );
    host.guard.place(spawn.x, spawn.y, spawn.z, now);
    this.members.set(HOST_PLAYER_ID, host);
    this.stall = new StallWatch(NET.relayIntervalMs, now);
    this.sim = options.survival ?? null;
    this.newRun = options.newRun ?? null;
    this.nextSeed = options.nextSeed ?? null;
    this.sim?.addPlayer(HOST_PLAYER_ID);
    this.survivalAt = now;
    this.survivalView = this.sim ? this.viewOf() : IDLE_SURVIVAL;
    this.vitalsView = this.sim ? this.vitalsOf() : IDLE_VITALS;
    this.stopTimer = this.scheduler.every(NET.relayIntervalMs, () => this.step());
  }

  // --------------------------------------------------------------------------------------------
  // GameSession.
  // --------------------------------------------------------------------------------------------

  get role(): SessionRole {
    return this.roleValue;
  }
  get phase(): SessionPhase {
    return this.phaseValue;
  }
  get localId(): PlayerId {
    return HOST_PLAYER_ID;
  }
  get roomCode(): string | null {
    return this.endpoint ? this.endpoint.code : null;
  }
  get closed(): CloseInfo | null {
    return this.closedInfo;
  }
  get roomOnline(): boolean {
    return this.brokerOnline;
  }
  get stats(): Readonly<NetStats> {
    return this.counters;
  }
  get survival(): SurvivalView {
    return this.survivalView;
  }
  get vitals(): VitalsView {
    return this.vitalsView;
  }
  get economy(): EconomyView {
    return this.economyReport.view;
  }
  get run(): number {
    return this.runValue;
  }
  /** The simulation itself, for the debug hook and the tests. Null where there is none. */
  get survivalSim(): SurvivalSim | null {
    return this.sim;
  }
  get players(): readonly RosterEntry[] {
    return [...this.members.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((m) => ({
        id: m.id,
        slot: m.slot,
        name: m.name,
        isHost: m.id === HOST_PLAYER_ID,
        pingMs: m.id === HOST_PLAYER_ID ? null : m.rtt,
      }));
  }

  sendCommand(command: BlockCommand): void {
    if (this.phaseValue !== 'open') return;
    this.runCommand(this.members.get(HOST_PLAYER_ID) as Member, null, command);
  }

  /** The host's own shots are judged against the machines as its own screen drew them, `NET.enemyHostDelayMs` behind its newest step. */
  fire(origin: Vec3, dir: Vec3): void {
    if (this.phaseValue !== 'open') return;
    const host = this.members.get(HOST_PLAYER_ID) as Member;
    this.runShot(host, origin, dir, this.scheduler.now() - NET.enemyHostDelayMs);
  }

  setLocalActive(active: boolean): void {
    this.localActive = active;
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

  publishState(sample: PlayerSample): void {
    if (this.phaseValue !== 'open') return;
    const host = this.members.get(HOST_PLAYER_ID) as Member;
    const now = this.scheduler.now();
    host.sample ??= createPlayerSample();
    Object.assign(host.sample, sample);
    host.sampleTime = now;
    host.lastHeard = now;
    if (this.endpoint) this.relayDirty = true;
  }

  sampleRemotes(): readonly RemotePose[] {
    const renderTime = this.scheduler.now() - NET.interpDelayMs;
    this.poses.length = 0;
    let used = 0;
    for (const member of this.members.values()) {
      if (member.id === HOST_PLAYER_ID) continue;
      if (!member.track.sample(renderTime, this.poseOut)) continue;
      const pose = (this.poseSlots[used] ??= newPose());
      pose.id = member.id;
      pose.slot = member.slot;
      pose.name = member.name;
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

  sampleEnemies(): readonly EnemyPose[] {
    return this.enemyMirror.sample(this.scheduler.now() - NET.enemyHostDelayMs);
  }

  sampleWildlife(): readonly WildPose[] {
    return this.wildMirror.sample(this.scheduler.now() - NET.enemyHostDelayMs);
  }

  close(): void {
    if (this.phaseValue === 'closed') return;
    this.closeRoom();
    this.stopTimer?.();
    this.stopTimer = null;
    this.closedInfo = closeInfo('left');
    this.setPhase('closed');
  }

  // --------------------------------------------------------------------------------------------
  // Rooms.
  // --------------------------------------------------------------------------------------------

  /** Opens a room: guests can join with the returned code. Rejects with a `NetError` if the broker cannot be reached. */
  async openRoom(transport: Transport): Promise<string> {
    if (this.endpoint) return this.endpoint.code;
    if (this.isClosed()) throw new Error('The session is closed.');
    const endpoint = await transport.openHost();
    if (this.isClosed()) {
      endpoint.close();
      throw new Error('The session is closed.');
    }
    this.endpoint = endpoint;
    endpoint.onLink((link) => this.accept(link));
    endpoint.onBroker?.((online) => {
      if (this.endpoint !== endpoint || online === this.brokerOnline) return;
      this.brokerOnline = online;
      this.playerChanges.emit();
    });
    this.roleValue = 'host';
    this.playerChanges.emit();
    return endpoint.code;
  }

  /**
   * Changes the host player's display name. Only while no room is open: the protocol has no way
   * to tell guests about a new name, and a name picked in the lobby is never changed mid-game.
   */
  rename(raw: string): void {
    if (this.endpoint) return;
    const host = this.members.get(HOST_PLAYER_ID) as Member;
    const name = cleanName(raw, host.name);
    if (name === host.name) return;
    host.name = name;
    this.playerChanges.emit();
  }

  /** Closes the room (guests are told, and see the host-left screen) and goes back to single-player. */
  closeRoom(): void {
    const endpoint = this.endpoint;
    if (!endpoint && this.members.size <= 1 && this.pending.size === 0) return;
    this.endpoint = null;
    const farewell = encodeFrame({ t: 'bye', why: 'closed' });
    for (const member of [...this.members.values()]) {
      if (!member.link) continue;
      this.sendTo(member, farewell);
      this.dropLink(member.link);
      this.members.delete(member.id);
      this.sim?.removePlayer(member.id);
    }
    for (const entry of [...this.pending]) {
      entry.link.sendControl(farewell);
      entry.cancel();
      this.pending.delete(entry);
      this.dropLink(entry.link);
    }
    endpoint?.close();
    this.departed.clear();
    this.brokerOnline = true;
    this.roleValue = 'solo';
    this.playerChanges.emit();
  }

  /** Closes a link after a short grace, so its last frame has a chance to be delivered. */
  private dropLink(link: Link): void {
    this.scheduler.after(GOODBYE_GRACE_MS, () => link.close());
  }

  private accept(link: Link): void {
    if (this.phaseValue === 'closed' || !this.endpoint) {
      link.close();
      return;
    }
    const entry: Pending = {
      link,
      cancel: this.scheduler.after(NET.helloTimeoutMs, () => {
        this.pending.delete(entry);
        link.close();
      }),
    };
    this.pending.add(entry);
    link.attach({
      control: (text) => this.onControl(entry, text),
      // State sent before hello belongs to nobody: `onState` ignores a link with no member.
      state: (bytes) => this.onState(link, bytes),
      closed: () => {
        entry.cancel();
        this.pending.delete(entry);
        const member = this.memberOf(link);
        if (member) this.leave(member, 'left');
      },
    });
  }

  private memberOf(link: Link): Member | undefined {
    for (const member of this.members.values()) if (member.link === link) return member;
    return undefined;
  }

  // --------------------------------------------------------------------------------------------
  // Frames from guests.
  // --------------------------------------------------------------------------------------------

  private onControl(entry: Pending, text: string): void {
    const frame = decodeGuestFrame(text);
    if (!frame) {
      this.counters.badFrames++;
      return;
    }
    const member = this.memberOf(entry.link);
    if (!member) {
      if (frame.t === 'hello') this.onHello(entry, frame);
      else this.counters.badFrames++;
      return;
    }
    member.lastHeard = this.scheduler.now();
    switch (frame.t) {
      case 'cmd':
        this.runCommand(member, frame.id, frame.c);
        break;
      case 'fire':
        this.shotFrom.x = frame.o[0];
        this.shotFrom.y = frame.o[1];
        this.shotFrom.z = frame.o[2];
        this.shotToward.x = frame.d[0];
        this.shotToward.y = frame.d[1];
        this.shotToward.z = frame.d[2];
        this.runShot(member, this.shotFrom, this.shotToward, frame.at);
        break;
      case 'ping':
        member.rtt = frame.rtt > 0 ? frame.rtt : member.rtt;
        this.sendTo(member, encodeFrame({ t: 'pong', n: frame.n }));
        break;
      case 'bye':
        this.leave(member, 'left');
        entry.link.close();
        break;
      case 'hello':
        break;
    }
  }

  private onHello(entry: Pending, hello: Extract<GuestFrame, { t: 'hello' }>): void {
    const link = entry.link;
    entry.cancel();
    this.pending.delete(entry);
    if (hello.v !== NET.protocolVersion) return this.deny(link, 'version');
    if (!this.endpoint) return this.deny(link, 'closed');

    const now = this.scheduler.now();
    // A guest that reloaded its page comes back before the old link has timed out: give it the old seat.
    for (const existing of [...this.members.values()]) {
      if (
        existing.link &&
        existing.token === hello.token &&
        now - existing.lastHeard >= TAKEOVER_SILENCE_MS
      ) {
        this.leave(existing, 'left');
        this.dropLink(existing.link);
      }
    }

    const taken = new Set([...this.members.values()].map((m) => m.slot));
    const live = [...this.members.values()].some((m) => m.token === hello.token);
    const back = live ? undefined : this.departed.get(hello.token);
    if (this.members.size >= NET.maxPlayers) return this.deny(link, 'full');

    let slot = back?.slot ?? 0;
    if (!back || taken.has(slot)) {
      slot = 0;
      while (taken.has(slot)) slot++;
    }
    const id = back && !this.members.has(back.id) ? back.id : this.nextId++;
    const spawn = back ?? this.spawnFor(slot);
    const name = cleanName(hello.name, back?.name ?? defaultName(hello.token));
    const member = this.makeMember(id, slot, name, hello.token, link, now);
    member.guard.place(spawn.x, spawn.y, spawn.z, now);
    this.members.set(id, member);
    this.sim?.addPlayer(id);
    this.departed.delete(hello.token);

    const edits: EditRecord[] = [];
    const world = this.binding.current();
    world.forEachEdit((x, y, z, state) => edits.push({ x, y, z, state }));
    const per = NET.snapshotEditsPerFrame;
    const parts = Math.ceil(edits.length / per);
    const players: PlayerWire[] = this.wireRoster();
    this.sendTo(
      member,
      encodeFrame({
        t: 'welcome',
        v: NET.protocolVersion,
        id,
        slot,
        hostId: HOST_PLAYER_ID,
        seed: world.seed,
        seq: this.eventSeq,
        hostTime: now,
        spawn: { x: spawn.x, y: spawn.y, z: spawn.z },
        epoch: member.epoch,
        run: this.runValue,
        players,
        parts,
        edits: edits.length,
      }),
    );
    for (let i = 0; i < parts; i++) {
      this.sendTo(member, encodeFrame({ t: 'snap', i, b: encodeEdits(edits, i * per, per) }));
    }
    // The newcomer should see the time at once, not at the next regular word.
    if (this.sim) {
      this.sendTo(member, this.survivalFrame());
      this.sendVitals(member, now);
      for (const frame of this.economyReport.hello()) this.sendTo(member, frame);
    }

    const joined = encodeFrame({ t: 'join', p: { id, slot, name } });
    for (const other of this.members.values()) {
      if (other.link && other !== member) this.sendTo(other, joined);
    }
    // The newcomer should see everyone at once, not at the next idle relay.
    this.relayDirty = true;
    this.playerChanges.emit();
  }

  private deny(link: Link, reason: DenyReason): void {
    link.sendControl(encodeFrame({ t: 'deny', reason }));
    this.dropLink(link);
  }

  private makeMember(
    id: PlayerId,
    slot: number,
    name: string,
    token: string,
    link: Link | null,
    now: number,
  ): Member {
    return {
      id,
      slot,
      name,
      token,
      link,
      guard: new MoveGuard(),
      sample: null,
      sampleTime: now,
      stateSeq: null,
      epoch: 0,
      sync: new ClockSync(),
      track: new RemoteTrack(),
      rtt: null,
      lastHeard: now,
      editTokens: NET.editBurst,
      editAt: now,
      vitalsSent: null,
      vitalsAt: now,
      harvestAt: -Infinity,
    };
  }

  private wireRoster(): PlayerWire[] {
    return [...this.members.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((m) => ({ id: m.id, slot: m.slot, name: m.name }));
  }

  private onState(link: Link, bytes: Uint8Array): void {
    const member = this.memberOf(link);
    if (!member) return;
    const packet = decodeGuestState(bytes);
    if (!packet) {
      this.counters.badFrames++;
      return;
    }
    const now = this.scheduler.now();
    member.lastHeard = now;
    if (packet.epoch !== member.epoch) return;
    if (member.stateSeq !== null && !seqNewer(packet.seq, member.stateSeq)) {
      this.counters.staleDropped++;
      return;
    }
    member.stateSeq = packet.seq;
    member.sync.observe(now, packet.time);

    const verdict = member.guard.check(packet.sample, now, this.binding.current());
    if (!verdict.ok) {
      this.correct(member);
      return;
    }
    const at = member.sync.toLocal(packet.time);
    member.track.push(at, packet.sample);
    if (!member.sample || at >= member.sampleTime) {
      member.sample = packet.sample;
      member.sampleTime = at;
    }
    this.relayDirty = true;
    if (now - this.lastRelay >= NET.relayIntervalMs) this.relay(now);
  }

  /** Moves a guest back to the last spot that passed the movement check. */
  private correct(member: Member): void {
    if (!member.link) return;
    const now = this.scheduler.now();
    const at = member.guard.position;
    member.guard.restore(now);
    this.sendFix(member, at);
  }

  /** Tells a guest where it stands now; what it sent before the word arrives is from another epoch and is ignored. */
  private sendFix(member: Member, at: Vec3): void {
    member.epoch = (member.epoch + 1) & 0xff;
    member.stateSeq = null;
    member.track.clear();
    this.counters.corrections++;
    this.sendTo(member, encodeFrame({ t: 'fix', epoch: member.epoch, x: at.x, y: at.y, z: at.z }));
  }

  /**
   * Puts a player on their seat's spawn point as far as the host is concerned: the movement check,
   * the avatar everyone draws and the machines' idea of where their prey is all go there at once,
   * so nothing still sees them where they were. Returns the spot. Telling the player is the
   * caller's part. `near` is where a player fell, for a spawn that goes by it.
   */
  private seat(member: Member, now: number, near?: Vec3): Vec3 {
    const to = this.spawnFor(member.slot, near);
    member.guard.place(to.x, to.y, to.z, now);
    const sample = member.sample;
    if (sample) {
      sample.x = to.x;
      sample.y = to.y;
      sample.z = to.z;
      sample.vx = 0;
      sample.vy = 0;
      sample.vz = 0;
      sample.onGround = true;
      sample.reset = true;
    }
    this.sim?.observe(member.id, to.x, to.y, to.z, 0, true);
    this.relayDirty = true;
    return to;
  }

  /**
   * The Core has brought a player back: they stand at the Bed nearest to where they fell, or at the
   * base on their seat's spawn point where no Bed has room. A guest is told with a correction; the
   * host's own player is moved by the same word to its screen.
   */
  private placeAtBase(id: PlayerId): void {
    const member = this.members.get(id);
    if (!member) return;
    const now = this.scheduler.now();
    const fell = member.sample;
    const to = this.seat(member, now, fell ? { x: fell.x, y: fell.y, z: fell.z } : undefined);
    if (!member.link) {
      this.corrections.emit({ x: to.x, y: to.y, z: to.z });
      return;
    }
    this.sendFix(member, to);
    // Every screen shows the move at once, as a jump and not a glide, not at the guest's next report.
    if (member.sample) member.track.push(now, member.sample);
  }

  // --------------------------------------------------------------------------------------------
  // Starting over.
  // --------------------------------------------------------------------------------------------

  restartRun(kind: RestartKind): void {
    if (!this.sim?.over || !this.newRun || this.restarting || this.phaseValue === 'closed') return;
    const seed = kind === 'retry' ? this.binding.current().seed : this.freshSeed();
    this.restarting = true;
    this.binding.load(seed, []).then(
      () => this.startRun(seed),
      (error: unknown) => {
        this.restarting = false;
        console.error(error);
      },
    );
  }

  /** A seed for a new valley: whatever the game draws, and never the one being played. */
  private freshSeed(): number {
    const current = this.binding.current().seed;
    for (let attempt = 0; attempt < 8; attempt++) {
      const seed = this.nextSeed?.();
      if (seed !== undefined && Number.isSafeInteger(seed) && seed !== current) return seed;
    }
    return current + 1;
  }

  /**
   * The world has been rebuilt for the new run: a new simulation, every player back on their seat
   * with their meters full, and each guest told to rebuild its world and stand where it is put.
   * What the old run left (events, machines, blocks the machines were chewing, who was last heard
   * from where) is dropped.
   */
  private startRun(seed: number): void {
    this.restarting = false;
    const make = this.newRun;
    if (!make || this.phaseValue === 'closed') return;
    const now = this.scheduler.now();
    const sim = make();
    this.sim = sim;
    this.runValue++;
    this.survivalQueue.length = 0;
    this.gnawed.length = 0;
    this.survivalAt = now;
    this.survivalRunning = false;
    this.survivalDirty = true;
    this.economyReport.reset();
    this.coreSent = -1;
    this.lastSurvivalSend = -Infinity;
    this.enemyMirror.clear();
    this.enemiesSent = 0;
    this.lastEnemySend = -Infinity;
    this.wildMirror.clear();
    this.wildSent = 0;
    this.lastWildSend = -Infinity;
    this.departed.clear();
    for (const member of this.members.values()) {
      sim.addPlayer(member.id);
      member.vitalsSent = null;
      member.vitalsAt = now;
      member.editTokens = NET.editBurst;
      member.editAt = now;
      member.stateSeq = null;
      member.track.clear();
      if (member.link) member.sample = null;
      const to = this.seat(member, now);
      if (!member.link) {
        this.corrections.emit({ x: to.x, y: to.y, z: to.z });
        continue;
      }
      member.epoch = (member.epoch + 1) & 0xff;
      this.sendTo(
        member,
        encodeFrame({
          t: 'run',
          n: this.runValue,
          seed,
          seq: this.eventSeq,
          spawn: { x: to.x, y: to.y, z: to.z },
          epoch: member.epoch,
        }),
      );
    }
    this.runs.emit(this.runValue);
  }

  // --------------------------------------------------------------------------------------------
  // Commands.
  // --------------------------------------------------------------------------------------------

  private runCommand(member: Member, commandId: number | null, command: BlockCommand): void {
    const refusal = this.refusal(member, command);
    if (refusal) {
      this.reject(member, commandId, command, refusal);
      return;
    }
    if (command.type === 'harvest') {
      this.runHarvest(member, commandId, command);
      return;
    }
    if (command.type === 'upgrade') {
      this.runUpgrade(member, commandId, command);
      return;
    }
    const state = command.type === 'place' ? command.state : 0;
    // What a block was made of before it is broken, for the refund.
    const broken =
      command.type === 'break'
        ? this.binding.current().getBlock(command.x, command.y, command.z)
        : 0;
    if (!this.applyEdit(command.x, command.y, command.z, state, member.id)) {
      this.reject(member, commandId, command, REFUSAL.failed);
      return;
    }
    // The crew's pool pays for a block that was placed (the refusal checked that it could) and gets back one that was broken.
    const economy = this.sim?.economy;
    if (command.type === 'place') {
      economy?.pay(command.state);
      economy?.placed(command.state);
    } else economy?.refund(broken);
    this.sim?.playerBuilt(member.id, command.type === 'place');
  }

  /** Turns a command away: counts it, and tells the guest that sent it, or the host's own screen when the host did. */
  private reject(
    member: Member,
    commandId: number | null,
    command: BlockCommand,
    reason: string,
  ): void {
    this.counters.rejections++;
    if (member.link && commandId !== null) {
      this.sendTo(member, encodeFrame({ t: 'rej', id: commandId, r: reason }));
    } else if (!member.link) {
      this.rejections.emit({ command, reason });
    }
  }

  /**
   * Changes a cell and tells everyone: the one path every change to the world takes, whether a
   * player asked for it or the machines chewed through a block. False when the world refused.
   */
  private applyEdit(x: number, y: number, z: number, state: number, by: PlayerId): boolean {
    if (!this.binding.current().setBlock(x, y, z, state)) return false;
    this.sim?.blockChanged(x, y, z);
    const event: BlockSetEvent = { type: 'set', x, y, z, state, by };
    this.eventSeq++;
    const frame = encodeFrame({ t: 'ev', s: this.eventSeq, e: event });
    for (const other of this.members.values()) if (other.link) this.sendTo(other, frame);
    this.events.emit(event);
    return true;
  }

  /** The host's rules on top of the world's own: who is asking, how fast, from where, and who is in the way. */
  private refusal(member: Member, command: BlockCommand): string | null {
    if (this.sim?.isDown(member.id)) return REFUSAL.down;
    const now = this.scheduler.now();
    if (member.link) {
      member.editTokens = Math.min(
        NET.editBurst,
        member.editTokens + ((now - member.editAt) / 1000) * NET.editRatePerSecond,
      );
      member.editAt = now;
      if (member.editTokens < 1) return REFUSAL.rate;
      member.editTokens -= 1;
    }

    const sample = member.sample;
    if (!sample && member.link) return REFUSAL.notReady;
    if (sample) {
      const dx = command.x + 0.5 - sample.x;
      const dy = command.y + 0.5 - (sample.y + PLAYER.eyeHeight);
      const dz = command.z + 0.5 - sample.z;
      const reach = NET.editReach + NET.editReachSlack;
      if (dx * dx + dy * dy + dz * dz > reach * reach) return REFUSAL.reach;
    }

    if (command.type === 'harvest') return this.harvestRefusal(member, command);

    const world: BlockWorld = this.binding.current();
    if (command.type === 'upgrade') return this.upgradeRefusal(world, command);
    if (command.type === 'place') {
      const reason = world.checkPlace(command.x, command.y, command.z, command.state);
      if (reason) return reason;
      for (const other of this.members.values()) {
        if (other.sample && overlapsCell(other.sample, command.x, command.y, command.z)) {
          return REFUSAL.body;
        }
      }
      // Then the economy's: a heap of debris keeps its ground clear, and the pool must hold the cost.
      const economy = this.sim?.economy;
      return economy?.placementRefusal(command.x, command.y, command.z, command.state) ?? null;
    }
    return world.checkBreak(command.x, command.y, command.z);
  }

  // --------------------------------------------------------------------------------------------
  // Salvage.
  // --------------------------------------------------------------------------------------------

  /** Why player `member` cannot strip the heap in the cell right now, or null when they can. */
  private harvestRefusal(
    member: Member,
    command: Extract<BlockCommand, { type: 'harvest' }>,
  ): string | null {
    const economy = this.sim?.economy;
    if (!this.sim || !economy) return REFUSAL.nothing;
    if (this.sim.over) return REFUSAL.over;
    const node = economy.nodeAt(command.x, command.y, command.z);
    if (!node) return REFUSAL.nothing;
    if (economy.leftOf(node.index) <= 0) return REFUSAL.depleted;
    const sample = member.sample;
    if (sample) {
      const dx = node.x - sample.x;
      const dy = node.y + DEBRIS.lift - (sample.y + PLAYER.eyeHeight);
      const dz = node.z - sample.z;
      const reach = DEBRIS.reach + NET.editReachSlack;
      if (dx * dx + dy * dy + dz * dz > reach * reach) return REFUSAL.reach;
    }
    const now = this.scheduler.now();
    if (now - member.harvestAt < DEBRIS.cooldown * 1000) return REFUSAL.rate;
    return null;
  }

  /** Strips the heap a checked command names: the strip goes into the pool and everyone is told. */
  private runHarvest(
    member: Member,
    commandId: number | null,
    command: Extract<BlockCommand, { type: 'harvest' }>,
  ): void {
    const economy = this.sim?.economy;
    const node = economy?.nodeAt(command.x, command.y, command.z);
    const result = economy && node ? economy.harvest(node.index, member.id) : null;
    if (!result || !result.ok) {
      const reason = result?.reason === 'full' ? REFUSAL.poolFull : REFUSAL.nothing;
      this.reject(member, commandId, command, reason);
      return;
    }
    member.harvestAt = this.scheduler.now();
    this.broadcast(this.economyReport.harvested(result.event));
  }

  // --------------------------------------------------------------------------------------------
  // Upgrades.
  // --------------------------------------------------------------------------------------------

  /**
   * Why the piece in the cell cannot be upgraded now, or null when it can: it is not what the
   * player saw (it was upgraded, broken or rebuilt since), nothing is better, the better material is
   * not researched, or the pool cannot pay for it. A host with no run charges and locks nothing.
   */
  private upgradeRefusal(
    world: BlockWorld,
    command: Extract<BlockCommand, { type: 'upgrade' }>,
  ): string | null {
    const state = world.getBlock(command.x, command.y, command.z);
    const step = upgradeStep(state);
    if (!step) return upgradeBlocker(state);
    if (step.to !== command.state) return REFUSAL.changed;
    return this.sim?.economy?.upgradeRefusal(state) ?? null;
  }

  /** Upgrades the piece a checked command names: the better piece takes the cell and the pool pays its price. */
  private runUpgrade(
    member: Member,
    commandId: number | null,
    command: Extract<BlockCommand, { type: 'upgrade' }>,
  ): void {
    if (!this.applyEdit(command.x, command.y, command.z, command.state, member.id)) {
      this.reject(member, commandId, command, REFUSAL.failed);
      return;
    }
    this.sim?.economy?.pay(command.state);
    this.sim?.playerUpgraded(member.id);
  }

  // --------------------------------------------------------------------------------------------
  // Shots.
  // --------------------------------------------------------------------------------------------

  /**
   * Decides one shot of the pulse blaster and tells everyone what became of it. The bolt is judged
   * against the machines as the shooter's screen drew them, `at` on this clock but no further back
   * than `NET.maxRewindMs`, so a shot that looked true is true; the blow lands on the machine as it
   * is now. Ignored: a shot with no direction, a guest's before the host has heard where it stands,
   * and one the shooter's blaster is not ready for.
   */
  private runShot(member: Member, origin: Vec3, dir: Vec3, at: number): void {
    const sim = this.sim;
    if (!sim) return;
    const length = Math.hypot(dir.x, dir.y, dir.z);
    if (!(length >= MIN_AIM_LENGTH) || !Number.isFinite(length + origin.x + origin.y + origin.z)) {
      return;
    }
    const aim = this.aim;
    aim.x = dir.x / length;
    aim.y = dir.y / length;
    aim.z = dir.z / length;

    const muzzle = this.muzzle;
    muzzle.x = origin.x;
    muzzle.y = origin.y;
    muzzle.z = origin.z;
    if (member.link) {
      // A guest says where its camera is. The host trusts that only near where the guest stands,
      // by the host's idea of it: a claim from farther away starts the bolt from the guest's eyes.
      const sample = member.sample;
      if (!sample) return;
      const eyeY = sample.y + PLAYER.eyeHeight;
      const dx = origin.x - sample.x;
      const dy = origin.y - eyeY;
      const dz = origin.z - sample.z;
      if (dx * dx + dy * dy + dz * dz > NET.shotOriginSlack * NET.shotOriginSlack) {
        muzzle.x = sample.x;
        muzzle.y = eyeY;
        muzzle.z = sample.z;
      }
    }

    const now = this.scheduler.now();
    const then = Math.min(now, Math.max(now - NET.maxRewindMs, at));
    const bodies = this.enemyMirror.sample(then);
    const creatures = this.wildMirror.sample(then);
    const out = this.outcome;
    if (
      !sim.fire(member.id, muzzle, aim, bodies, bodies.length, out, creatures, creatures.length)
    ) {
      return;
    }

    this.announceShot({
      by: member.id,
      x: roundTo(out.x, SHOT_GRID),
      y: roundTo(out.y, SHOT_GRID),
      z: roundTo(out.z, SHOT_GRID),
      flags: out.flags,
      enemy: out.enemy,
    });
  }

  /** Tells everyone of a shot: the guests by a frame, and this screen by the event. */
  private announceShot(shot: ShotEvent): void {
    if (this.hasGuests()) {
      const end = [shot.x, shot.y, shot.z] as const;
      this.broadcast(
        encodeFrame(
          shot.turret
            ? { t: 'sh', p: shot.by, c: shot.turret, e: end, f: shot.flags, h: shot.enemy }
            : { t: 'sh', p: shot.by, e: end, f: shot.flags, h: shot.enemy },
        ),
      );
    }
    this.shots.emit(shot);
  }

  /**
   * Tells everyone of the shots the crew's turrets fired in the steps just played, the way a
   * player's are told: where each bolt ended and what became of it, and the cell of the turret.
   */
  private reportTurrets(sim: SurvivalSim): void {
    sim.drainTurretShots(this.turretShots);
    for (const fired of this.turretShots) {
      this.announceShot({
        by: NO_PLAYER,
        x: roundTo(fired.ex, SHOT_GRID),
        y: roundTo(fired.ey, SHOT_GRID),
        z: roundTo(fired.ez, SHOT_GRID),
        flags: fired.flags,
        enemy: fired.enemy,
        turret: [fired.x, fired.y, fired.z],
      });
    }
    this.turretShots.length = 0;
  }

  // --------------------------------------------------------------------------------------------
  // The tick: relay, pings and timeouts.
  // --------------------------------------------------------------------------------------------

  private step(): void {
    const now = this.scheduler.now();
    const late = this.stall.lateBy(now);
    this.stepSurvival(now);
    if (!this.endpoint) return;
    // Our own page was blocked, so the guests' packets are still waiting to be read: their silence
    // during the stall is not theirs.
    if (late > 0) {
      for (const member of this.members.values()) {
        member.lastHeard = Math.min(now, member.lastHeard + late);
      }
    }
    const since = now - this.lastRelay;
    // Idle rooms still relay once a second, so a quiet host or a hidden tab does not look like a dead one.
    if (since >= NET.relayIntervalMs && (this.relayDirty || since >= 1000)) this.relay(now);

    for (const member of [...this.members.values()]) {
      if (member.link && now - member.lastHeard > NET.timeoutMs) {
        this.leave(member, 'timeout');
        this.dropLink(member.link);
      }
    }
    if (now - this.lastPing >= NET.pingIntervalMs) {
      this.lastPing = now;
      const pings: [PlayerId, number][] = [];
      for (const member of this.members.values()) {
        if (member.link && member.rtt !== null) pings.push([member.id, member.rtt]);
      }
      if (pings.length > 0) {
        const frame = encodeFrame({ t: 'pings', p: pings });
        for (const member of this.members.values()) if (member.link) this.sendTo(member, frame);
      }
    }
  }

  /** Sends every player's latest state to every guest (each one minus themselves). */
  private relay(now: number): void {
    this.lastRelay = now;
    this.relayDirty = false;
    const entries: RelayEntry[] = [];
    for (const member of this.members.values()) {
      if (!member.sample) continue;
      entries.push({
        id: member.id,
        age: now - member.sampleTime,
        sample: member.sample,
      });
    }
    if (entries.length === 0) return;
    const seq = this.relaySeq++;
    for (const member of this.members.values()) {
      if (!member.link) continue;
      const others = entries.filter((entry) => entry.id !== member.id);
      if (others.length === 0) continue;
      member.link.sendState(encodeRelay({ seq, hostTime: now, entries: others }));
    }
  }

  private leave(member: Member, why: 'left' | 'timeout' | 'closed'): void {
    if (!this.members.delete(member.id)) return;
    this.sim?.removePlayer(member.id);
    if (member.link) this.rememberDeparted(member);
    const frame = encodeFrame({ t: 'leave', id: member.id, why });
    for (const other of this.members.values()) if (other.link) this.sendTo(other, frame);
    this.playerChanges.emit();
  }

  /** Keeps a guest's seat and last safe spot for its token, so a reload or a return picks up where it left off. */
  private rememberDeparted(member: Member): void {
    this.departed.delete(member.token);
    this.departed.set(member.token, {
      id: member.id,
      slot: member.slot,
      name: member.name,
      x: member.guard.position.x,
      y: member.guard.position.y,
      z: member.guard.position.z,
    });
    while (this.departed.size > NET.departedKept) {
      const oldest = this.departed.keys().next();
      if (oldest.done) break;
      this.departed.delete(oldest.value);
    }
  }

  // --------------------------------------------------------------------------------------------
  // Survival: the simulation, paced by real time, and what the guests are told about it.
  // --------------------------------------------------------------------------------------------

  /** The run as the host's own screen reads it: always the simulation of the run being played now. */
  private viewOf(): SurvivalView {
    return {
      read: (out: SurvivalReading) => {
        if (!this.sim) return IDLE_SURVIVAL.read(out);
        this.sim.read(out);
        out.running = this.refreshRunning();
        return out;
      },
      onEvent: (listener) => this.survivalEvents.on(listener),
    };
  }

  private hasGuests(): boolean {
    for (const member of this.members.values()) if (member.link) return true;
    return false;
  }

  /**
   * Whether the run is going right now: with guests in the room it always is; alone, only while
   * the player is playing; and never once the Core has fallen. A change is noted so the guests
   * hear of it at the next tick.
   */
  private refreshRunning(): boolean {
    const running = (this.hasGuests() || this.localActive) && !this.sim?.over;
    if (running !== this.survivalRunning) {
      this.survivalRunning = running;
      this.survivalDirty = true;
    }
    return running;
  }

  /**
   * Plays the real time since the last tick, unless the run is held: alone in the world, it waits
   * for the player to be playing (the mouse captured), so a menu, a hidden tab or a forgotten
   * page does not cost a night. With guests in the room it never waits.
   */
  private stepSurvival(now: number): void {
    const sim = this.sim;
    if (!sim) return;
    const dt = (now - this.survivalAt) / 1000;
    this.survivalAt = now;
    const guests = this.hasGuests();
    const running = this.refreshRunning();
    if (running) {
      this.observePlayers(sim);
      sim.advance(dt);
      this.breakGnawed(sim);
      this.reportTurrets(sim);
    }
    this.reportEnemies(sim, now, guests);
    this.reportWildlife(sim, now, guests);

    sim.drainEvents(this.survivalQueue);
    for (const event of this.survivalQueue) {
      if (event.k === 'back') this.placeAtBase(event.p);
      if (event.k === 'dawn') this.economyReport.markList();
      if (guests) this.broadcast(encodeFrame({ t: 'se', e: event }));
      this.survivalDirty = true;
      this.survivalEvents.emit(event);
    }
    this.survivalQueue.length = 0;

    // A change to the Core's health is sent soon, but not at once: a fight at the base can change
    // it every step, and a fifth of a second is as fast as anyone can read a gauge.
    const sinceSend = now - this.lastSurvivalSend;
    const coreNews = sim.coreHealth !== this.coreSent && sinceSend >= NET.coreIntervalMs;
    const due = running && sinceSend >= NET.survivalIntervalMs;
    if (guests && (this.survivalDirty || due || coreNews)) {
      this.lastSurvivalSend = now;
      this.broadcast(this.survivalFrame());
    }
    this.survivalDirty = false;

    if (guests) {
      for (const frame of this.economyReport.due(now)) this.broadcast(frame);
      for (const member of this.members.values()) {
        if (!member.link) continue;
        const due = member.vitalsSent === null || now - member.vitalsAt >= NET.vitalsIntervalMs;
        if (due) this.sendVitals(member, now);
      }
    }
  }

  /** Breaks the blocks the machines have chewed through, as the world's own change: everyone sees it go. */
  private breakGnawed(sim: SurvivalSim): void {
    sim.drainBreaks(this.gnawed);
    for (const cell of this.gnawed) this.applyEdit(cell.x, cell.y, cell.z, 0, NO_PLAYER);
    this.gnawed.length = 0;
  }

  /**
   * Notes where the machines are for the host's own screen, and tells the guests ten times a
   * second: all of them, in one packet. A list that has just emptied is sent at once so the guests
   * clear their screens; after that, an empty one only about once a second, which is enough to put
   * right a guest whose packet was lost.
   */
  private reportEnemies(sim: SurvivalSim, now: number, guests: boolean): void {
    const machines = sim.enemies;
    if (!machines) return;
    const count = machines.write(this.enemyStates);
    this.enemyMirror.push(now, this.enemyStates, count);
    if (!guests || now - this.lastEnemySend < NET.enemyIntervalMs) return;
    if (count === 0 && this.enemiesSent === 0 && now - this.lastEnemySend < NET.enemyKeepAliveMs) {
      return;
    }
    this.lastEnemySend = now;
    this.enemiesSent = count;
    const packet = encodeEnemies(this.enemySeq++, now, this.enemyStates, count);
    for (const member of this.members.values()) member.link?.sendState(packet);
  }

  /**
   * The same for the valley's wildlife: notes where the creatures are for the host's own screen and the
   * shot judge, and tells the guests ten times a second, all of them in one packet. A valley with no
   * wildlife (it is off, or the run has no ground) sends nothing.
   */
  private reportWildlife(sim: SurvivalSim, now: number, guests: boolean): void {
    const wild = sim.wildlife;
    if (!wild) return;
    const count = wild.write(this.wildStates);
    this.wildMirror.push(now, this.wildStates, count);
    if (!guests || now - this.lastWildSend < NET.wildlifeIntervalMs) return;
    if (count === 0 && this.wildSent === 0 && now - this.lastWildSend < NET.wildlifeKeepAliveMs) {
      return;
    }
    this.lastWildSend = now;
    this.wildSent = count;
    const packet = encodeWildlife(this.wildSeq++, now, this.wildStates, count);
    for (const member of this.members.values()) member.link?.sendState(packet);
  }

  /** Tells the simulation where every player we have heard from is, so sprinting costs Energy and the Core's field can charge them. */
  private observePlayers(sim: SurvivalSim): void {
    for (const member of this.members.values()) {
      const s = member.sample;
      if (s) sim.observe(member.id, s.x, s.y, s.z, Math.hypot(s.vx, s.vz), s.onGround);
    }
  }

  /** The host's own player's meters, straight from the simulation of the run being played now. */
  private vitalsOf(): VitalsView {
    return {
      read: (out: VitalsReading) =>
        this.sim?.readVitals(HOST_PLAYER_ID, out) ?? IDLE_VITALS.read(out),
    };
  }

  /**
   * Tells a guest its own Health and Energy if they have changed since it was last told, and at
   * most `NET.vitalsIntervalMs` after the last word; the first word goes at once.
   */
  private sendVitals(member: Member, now: number): void {
    const sim = this.sim;
    if (!sim || !member.link) return;
    const reading = sim.readVitals(member.id, this.vitalsScratch);
    if (!reading) return;
    const sent = member.vitalsSent;
    if (
      sent &&
      sent.health === reading.health &&
      sent.energy === reading.energy &&
      sent.charging === reading.charging &&
      sent.returnIn === reading.returnIn &&
      sent.shaken === reading.shaken
    ) {
      return;
    }
    member.vitalsSent = {
      health: reading.health,
      energy: reading.energy,
      charging: reading.charging,
      returnIn: reading.returnIn,
      shaken: reading.shaken,
    };
    member.vitalsAt = now;
    this.sendTo(
      member,
      encodeFrame({
        t: 'vt',
        hp: [reading.health, reading.healthMax],
        en: [reading.energy, reading.energyMax],
        chg: reading.charging,
        rt: reading.returnIn,
        sk: reading.shaken,
      }),
    );
  }

  private survivalFrame(): string {
    const sim = this.sim;
    const core = sim?.coreHealth ?? 0;
    this.coreSent = core;
    const why = sim?.overWhy ?? null;
    return encodeFrame({
      t: 'sv',
      tick: sim?.tick ?? 0,
      run: this.refreshRunning(),
      core: [core, sim?.coreMax ?? 1],
      over: sim?.over ?? false,
      ...(why ? { why } : {}),
      rc: [sim?.respawns ?? 0, sim?.respawnMax ?? 0],
      st: [
        sim?.felled ?? 0,
        sim?.placed ?? 0,
        sim?.revived ?? 0,
        sim?.gathered ?? 0,
        sim?.upgraded ?? 0,
      ],
    });
  }

  private broadcast(frame: string): void {
    for (const member of this.members.values()) this.sendTo(member, frame);
  }

  private sendTo(member: Member, frame: string): void {
    member.link?.sendControl(frame);
  }

  private isClosed(): boolean {
    return this.phaseValue === 'closed';
  }

  private setPhase(phase: SessionPhase): void {
    if (this.phaseValue === phase) return;
    this.phaseValue = phase;
    this.phases.emit(phase);
  }
}

function newPose(): RemotePose {
  return {
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
  };
}

/** Whether a player's body overlaps the unit cell at (x, y, z), with a little margin. */
function overlapsCell(sample: PlayerSample, x: number, y: number, z: number): boolean {
  const margin = 0.05;
  const half = PLAYER.halfWidth + margin;
  return (
    sample.x + half > x &&
    sample.x - half < x + 1 &&
    sample.y + PLAYER.height + margin > y &&
    sample.y - margin < y + 1 &&
    sample.z + half > z &&
    sample.z - half < z + 1
  );
}
