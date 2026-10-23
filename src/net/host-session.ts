import type { BlockWorld } from '../shared/block-world';
import { ClockSync } from '../shared/clock-sync';
import { createEnemyState, type EnemyPose, type EnemyState } from '../shared/enemy-state';
import { RemoteTrack, createPoseOut } from '../shared/interpolation';
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
import type { SurvivalEvent, SurvivalReading, SurvivalView } from '../shared/survival-state';
import { createVitalsReading, type VitalsReading, type VitalsView } from '../shared/vitals-state';
import {
  decodeGuestFrame,
  decodeGuestState,
  encodeEdits,
  encodeEnemies,
  encodeFrame,
  encodeRelay,
  seqNewer,
  type RelayEntry,
} from '../shared/wire';
import type { NavCell } from '../systems/survival/nav';
import type { SurvivalSim } from '../systems/survival/sim';
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
} as const;

export interface HostSessionOptions {
  scheduler: Scheduler;
  world: WorldBinding;
  /** The host player's display name. */
  name: string;
  /** The host's own token (kept by the browser). */
  token: string;
  /** Where a player in this slot starts. */
  spawnFor?: (slot: number) => { x: number; y: number; z: number };
  /** The survival simulation this host runs. Absent where only the world is under test. */
  survival?: SurvivalSim;
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
}

/** The part of a guest's meters that is news when it changes: whole points, and the charge field. */
interface VitalsSent {
  health: number;
  energy: number;
  charging: boolean;
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
    return out;
  },
};

/** Time a refused or finished link is given to flush its last frame before it is closed. */
const GOODBYE_GRACE_MS = 400;
/** A returning guest whose old link has been quiet this long takes its old seat back. */
const TAKEOVER_SILENCE_MS = 3000;

/**
 * The authority. It runs single-player (no room open), and opens a room on request. It owns the
 * player table, validates every command, applies the resulting events to the world and fans
 * them out, checks guests' own movement, and relays everyone's state to everyone else.
 */
export class HostSession implements GameSession {
  private readonly scheduler: Scheduler;
  private readonly binding: WorldBinding;
  private readonly spawnFor: (slot: number) => { x: number; y: number; z: number };

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

  private readonly sim: SurvivalSim | null;
  private readonly survivalView: SurvivalView;
  private readonly vitalsView: VitalsView;
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
  /** The blocks the machines chewed through, between the simulation and the world. */
  private readonly gnawed: NavCell[] = [];

  private endpoint: HostEndpoint | null = null;
  private brokerOnline = true;
  private stopTimer: (() => void) | null = null;
  private roleValue: SessionRole = 'solo';
  private phaseValue: SessionPhase = 'open';
  private closedInfo: CloseInfo | null = null;

  private readonly events = new Emitter<WorldEvent>();
  private readonly rejections = new Emitter<Rejection>();
  private readonly playerChanges = new Emitter<void>();
  private readonly phases = new Emitter<SessionPhase>();
  private readonly corrections = new Emitter<Correction>();
  private readonly survivalEvents = new Emitter<SurvivalEvent>();

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
    this.sim?.addPlayer(HOST_PLAYER_ID);
    this.survivalAt = now;
    this.survivalView = this.sim ? this.viewOf(this.sim) : IDLE_SURVIVAL;
    this.vitalsView = this.sim ? this.vitalsOf(this.sim) : IDLE_VITALS;
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

  setLocalActive(active: boolean): void {
    this.localActive = active;
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
    member.epoch = (member.epoch + 1) & 0xff;
    const at = member.guard.position;
    member.guard.restore(now);
    member.stateSeq = null;
    member.track.clear();
    this.counters.corrections++;
    this.sendTo(member, encodeFrame({ t: 'fix', epoch: member.epoch, x: at.x, y: at.y, z: at.z }));
  }

  // --------------------------------------------------------------------------------------------
  // Commands.
  // --------------------------------------------------------------------------------------------

  private runCommand(member: Member, commandId: number | null, command: BlockCommand): void {
    const refusal = this.refusal(member, command);
    if (refusal) {
      this.counters.rejections++;
      if (member.link && commandId !== null) {
        this.sendTo(member, encodeFrame({ t: 'rej', id: commandId, r: refusal }));
      } else if (!member.link) {
        this.rejections.emit({ command, reason: refusal });
      }
      return;
    }
    const state = command.type === 'place' ? command.state : 0;
    if (!this.applyEdit(command.x, command.y, command.z, state, member.id)) {
      this.counters.rejections++;
      if (member.link && commandId !== null) {
        this.sendTo(member, encodeFrame({ t: 'rej', id: commandId, r: REFUSAL.failed }));
      } else if (!member.link) {
        this.rejections.emit({ command, reason: REFUSAL.failed });
      }
      return;
    }
    this.sim?.playerBuilt(member.id);
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

    const world: BlockWorld = this.binding.current();
    if (command.type === 'place') {
      const reason = world.checkPlace(command.x, command.y, command.z, command.state);
      if (reason) return reason;
      for (const other of this.members.values()) {
        if (other.sample && overlapsCell(other.sample, command.x, command.y, command.z)) {
          return REFUSAL.body;
        }
      }
      return null;
    }
    return world.checkBreak(command.x, command.y, command.z);
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

  private viewOf(sim: SurvivalSim): SurvivalView {
    return {
      read: (out: SurvivalReading) => {
        sim.read(out);
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
    }
    this.reportEnemies(sim, now, guests);

    sim.drainEvents(this.survivalQueue);
    for (const event of this.survivalQueue) {
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

  /** Tells the simulation where every player we have heard from is, so sprinting costs Energy and the Core's field can charge them. */
  private observePlayers(sim: SurvivalSim): void {
    for (const member of this.members.values()) {
      const s = member.sample;
      if (s) sim.observe(member.id, s.x, s.y, s.z, Math.hypot(s.vx, s.vz), s.onGround);
    }
  }

  /** The host's own player's meters, straight from the simulation. */
  private vitalsOf(sim: SurvivalSim): VitalsView {
    return {
      read: (out: VitalsReading) => sim.readVitals(HOST_PLAYER_ID, out) ?? IDLE_VITALS.read(out),
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
      sent.charging === reading.charging
    ) {
      return;
    }
    member.vitalsSent = {
      health: reading.health,
      energy: reading.energy,
      charging: reading.charging,
    };
    member.vitalsAt = now;
    this.sendTo(
      member,
      encodeFrame({
        t: 'vt',
        hp: [reading.health, reading.healthMax],
        en: [reading.energy, reading.energyMax],
        chg: reading.charging,
      }),
    );
  }

  private survivalFrame(): string {
    const sim = this.sim;
    const core = sim?.coreHealth ?? 0;
    this.coreSent = core;
    return encodeFrame({
      t: 'sv',
      tick: sim?.tick ?? 0,
      run: this.refreshRunning(),
      core: [core, sim?.coreMax ?? 1],
      over: sim?.over ?? false,
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
