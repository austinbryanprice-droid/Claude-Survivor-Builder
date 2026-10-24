import type {
  DebrisNode,
  DebrisView,
  EconomyReading,
  EconomyView,
  HarvestEvent,
} from '../shared/economy';
import type { EnemyPose } from '../shared/enemy-state';
import type { Vec3 } from '../shared/look';
import type {
  BlockCommand,
  CloseInfo,
  PlayerId,
  PlayerSample,
  RemotePose,
  WorldEvent,
} from '../shared/protocol';
import type { ShotEvent } from '../shared/shot';
import type {
  RestartKind,
  SurvivalEvent,
  SurvivalReading,
  SurvivalView,
} from '../shared/survival-state';
import type { VitalsReading, VitalsView } from '../shared/vitals-state';
import { Emitter } from './emitter';
import type {
  Correction,
  GameSession,
  NetStats,
  Rejection,
  RosterEntry,
  SessionPhase,
  SessionRole,
  Unsubscribe,
} from './session';

/** Sessions are told apart by the version, which counts the swaps too: a new session's heaps are never taken for the last one's. */
const SWAP_VERSION_STEP = 1_000_000_000;

/** The heaps of whichever session is current. */
class HubDebrisView implements DebrisView {
  swaps = 0;
  readonly harvests = new Emitter<HarvestEvent>();

  constructor(private readonly current: () => DebrisView) {}

  get nodes(): readonly DebrisNode[] {
    return this.current().nodes;
  }

  get version(): number {
    return this.swaps * SWAP_VERSION_STEP + this.current().version;
  }

  leftOf(index: number): number {
    return this.current().leftOf(index);
  }

  onHarvest(listener: (event: HarvestEvent) => void): Unsubscribe {
    return this.harvests.on(listener);
  }
}

/**
 * The one session object the rest of the game holds on to. Behind it the real session changes: a
 * player starts alone, may open a room (still the same session), may join someone else's (a
 * different one), and may end up alone again. The hub forwards everything to the current session
 * and re-points its listeners when the session is swapped, so input, drawing and the HUD never
 * have to know.
 */
export class SessionHub implements GameSession {
  private session: GameSession;
  private unbind: Unsubscribe[] = [];
  private localActive = false;

  private readonly events = new Emitter<WorldEvent>();
  private readonly rejections = new Emitter<Rejection>();
  private readonly shots = new Emitter<ShotEvent>();
  private readonly playerChanges = new Emitter<void>();
  private readonly phases = new Emitter<SessionPhase>();
  private readonly corrections = new Emitter<Correction>();
  private readonly runs = new Emitter<number>();
  private readonly swaps = new Emitter<GameSession>();
  private readonly vitalsView: VitalsView = {
    read: (out: VitalsReading) => this.session.vitals.read(out),
  };
  private readonly debrisView = new HubDebrisView(() => this.session.economy.debris);
  private readonly economyView: EconomyView = {
    read: (out: EconomyReading) => this.session.economy.read(out),
    debris: this.debrisView,
  };
  private readonly survivalEvents = new Emitter<SurvivalEvent>();
  private readonly survivalView: SurvivalView = {
    read: (out: SurvivalReading) => this.session.survival.read(out),
    onEvent: (listener) => this.survivalEvents.on(listener),
  };

  constructor(initial: GameSession) {
    this.session = initial;
    this.bind();
  }

  /** The session behind the hub right now. */
  get current(): GameSession {
    return this.session;
  }

  /**
   * Makes `next` the session. The old one is left as it is (the caller closes it when that is
   * wanted). Listeners hear about the change as a phase and a player-list update, and `onSwap`
   * listeners get the new session so they can drop anything tied to the old one.
   */
  swap(next: GameSession): void {
    if (next === this.session) return;
    for (const stop of this.unbind) stop();
    this.unbind = [];
    this.session = next;
    this.debrisView.swaps++;
    next.setLocalActive(this.localActive);
    this.bind();
    this.swaps.emit(next);
    this.phases.emit(next.phase);
    this.playerChanges.emit();
  }

  onSwap(listener: (session: GameSession) => void): Unsubscribe {
    return this.swaps.on(listener);
  }

  private bind(): void {
    const session = this.session;
    this.unbind = [
      session.onEvent((event) => this.events.emit(event)),
      session.onRejected((rejection) => this.rejections.emit(rejection)),
      session.onShot((shot) => this.shots.emit(shot)),
      session.onPlayers(() => this.playerChanges.emit()),
      session.onPhase((phase) => this.phases.emit(phase)),
      session.onCorrection((correction) => this.corrections.emit(correction)),
      session.onRun((run) => this.runs.emit(run)),
      session.survival.onEvent((event) => this.survivalEvents.emit(event)),
      session.economy.debris.onHarvest((event) => this.debrisView.harvests.emit(event)),
    ];
  }

  get role(): SessionRole {
    return this.session.role;
  }
  get phase(): SessionPhase {
    return this.session.phase;
  }
  get localId(): PlayerId {
    return this.session.localId;
  }
  get roomCode(): string | null {
    return this.session.roomCode;
  }
  get players(): readonly RosterEntry[] {
    return this.session.players;
  }
  get closed(): CloseInfo | null {
    return this.session.closed;
  }
  get roomOnline(): boolean {
    return this.session.roomOnline;
  }
  get stats(): Readonly<NetStats> {
    return this.session.stats;
  }
  /** One view for the life of the hub: it reads whichever session is current and hears from each in turn. */
  get survival(): SurvivalView {
    return this.survivalView;
  }
  get vitals(): VitalsView {
    return this.vitalsView;
  }
  get economy(): EconomyView {
    return this.economyView;
  }
  get run(): number {
    return this.session.run;
  }

  sendCommand(command: BlockCommand): void {
    this.session.sendCommand(command);
  }
  fire(origin: Vec3, dir: Vec3): void {
    this.session.fire(origin, dir);
  }
  restartRun(kind: RestartKind): void {
    this.session.restartRun(kind);
  }
  setLocalActive(active: boolean): void {
    this.localActive = active;
    this.session.setLocalActive(active);
  }
  publishState(sample: PlayerSample): void {
    this.session.publishState(sample);
  }
  sampleRemotes(): readonly RemotePose[] {
    return this.session.sampleRemotes();
  }
  sampleEnemies(): readonly EnemyPose[] {
    return this.session.sampleEnemies();
  }
  close(): void {
    this.session.close();
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
}
