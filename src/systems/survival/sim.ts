import { CYCLE_SECONDS, DAY_SECONDS } from '../../shared/daycycle';
import type { EnemyPose } from '../../shared/enemy-state';
import type { Vec3 } from '../../shared/look';
import type { RayWorld } from '../../shared/raycast';
import { SHOT_FLAG, createShotTrace, traceShot } from '../../shared/shot';
import {
  SIM_HZ,
  SIM_STEP_SECONDS,
  readClock,
  type OverrunCause,
  type SurvivalEvent,
  type SurvivalReading,
} from '../../shared/survival-state';
import type { VitalsReading } from '../../shared/vitals-state';
import type { Outpost } from '../../world/outpost';
import { BLASTER, RESPAWN, SURVIVAL, VITALS, hitboxOf } from './balance';
import { EnemySim, type Target } from './enemies';
import { NavGrid, type NavCell, type NavWorld } from './nav';
import { PlayerVitals } from './vitals';
import { WaveDirector } from './waves';

const CYCLE_TICKS = CYCLE_SECONDS * SIM_HZ;
const DAY_TICKS = DAY_SECONDS * SIM_HZ;
/** Fractions of a step that a floating-point sum can lose are not allowed to cost a whole step. */
const STEP_EPSILON = 1e-9;
const MEND_PER_STEP = SURVIVAL.core.mendPerSecond / SIM_HZ;

export interface SurvivalOptions {
  /** Seconds into the run to start at (the `?night=` switch); 0 is sunrise of day 1. */
  startAt?: number;
  /** The Core's health at the start, for tests and the debug page; full by default. */
  coreHealth?: number;
  /** Where the Core stands, for its charge field. Without it no one is ever charged. */
  core?: Outpost | null;
  /**
   * The ground the machines walk, as the valley gives it. Without it (or without a Core to walk to)
   * there are no machines.
   */
  nav?: NavWorld | null;
  /** The world's seed, which the machines' spawns are drawn from: the same seed plays the same nights. */
  seed?: number;
  /**
   * What a bolt of the blaster meets on its way: the blocks players built and the ground, the Core
   * included. Without it nothing stops a bolt but the machines it strikes.
   */
  ray?: RayWorld | null;
  /**
   * False keeps the nights empty: the machines come only when something puts them there (the
   * `?waves=0` switch, for pictures and tests that want a quiet night). The waves are on by default.
   */
  waves?: boolean;
}

/** How a shot of the blaster ended. One object is filled by every call to `fire`. */
export interface ShotOutcome {
  /** Where the bolt ended, in blocks. */
  x: number;
  y: number;
  z: number;
  /** `SHOT_FLAG` bits. */
  flags: number;
  /** The machine it struck, or 0. */
  enemy: number;
}

export function createShotOutcome(): ShotOutcome {
  return { x: 0, y: 0, z: 0, flags: 0, enemy: 0 };
}

/**
 * The host's survival simulation: the day and night clock, the Outpost Core, each player's Health
 * and Energy and the machines that come for the Core now, and the waves as the later parts arrive.
 * It is pure (no DOM, no three.js, no network) and it advances in fixed 20 Hz steps, so a Worker,
 * a test and the browser all play the same run.
 *
 * Time is counted in whole steps. The caller feeds it real time with `advance`, which turns it
 * into steps, and decides whether the run is held (single-player with the mouse free) by simply
 * not calling it. Once the Core falls, or every player is down with no respawn charge left, the
 * run is over: the clock stops where it was and nothing moves again.
 *
 * A player at no Health is down. The crew holds a pool of respawn charges (so many for each player
 * to begin with, one more for each at every dawn, up to a cap); the Core brings the players who are
 * down back at the base, in the order they fell, a few seconds after each fell and one charge each.
 */
export class SurvivalSim {
  private tickValue: number;
  /** Real time not yet turned into a step, in steps: always in [0, 1). */
  private carry = 0;
  private health: number;
  /** The Core has fallen. */
  private fell = false;
  /** Every player is down and the crew has no charge left to bring any of them back. */
  private wiped = false;
  /** The crew's respawn charges. */
  private charges = 0;
  /** The players whose charges are in the pool, so a player who leaves and comes back does not add theirs twice. */
  private readonly brought = new Set<number>();
  /** The players who are down, in the order they fell. */
  private readonly fallen: number[] = [];
  private readonly core: Outpost | null;
  private readonly players = new Map<number, PlayerVitals>();
  private readonly pending: SurvivalEvent[] = [];
  private readonly machines: EnemySim | null;
  private readonly waves: WaveDirector | null;
  /** The players the machines can go after in this step, kept between steps so a step allocates nothing. */
  private readonly targets: Target[] = [];
  private readonly feet = { x: 0, y: 0, z: 0 };
  private readonly ray: RayWorld | null;
  private readonly trace = createShotTrace();
  private readonly isAlive = (id: number): boolean => this.machines?.has(id) ?? false;

  constructor(options: SurvivalOptions = {}) {
    this.tickValue = Math.max(0, Math.round((options.startAt ?? 0) * SIM_HZ));
    const max = SURVIVAL.core.maxHealth;
    this.health = Math.min(max, Math.max(1, options.coreHealth ?? max));
    this.core = options.core ?? null;
    this.ray = options.ray ?? null;
    this.machines =
      options.nav && this.core
        ? new EnemySim(new NavGrid(options.nav, this.core), {
            core: this.core,
            seed: options.seed ?? 0,
          })
        : null;
    this.waves =
      this.machines && options.waves !== false
        ? new WaveDirector(this.machines, options.seed ?? 0)
        : null;
  }

  /** The machines that come for the Core, or null where the world gave the run no ground for them to walk. */
  get enemies(): EnemySim | null {
    return this.machines;
  }

  /** Steps taken since the run began. */
  get tick(): number {
    return this.tickValue;
  }

  /** Seconds the run has been played. */
  get elapsed(): number {
    return this.tickValue / SIM_HZ;
  }

  /** The Core's health in whole points: 0 only once it has fallen, and never a fraction of a point above that. */
  get coreHealth(): number {
    return this.fell ? 0 : Math.ceil(this.health);
  }

  get coreMax(): number {
    return SURVIVAL.core.maxHealth;
  }

  /** True once the run has ended. The run does not start again; a new run is a new simulation. */
  get over(): boolean {
    return this.fell || this.wiped;
  }

  /** What ended the run, or null while it goes on. */
  get overWhy(): OverrunCause | null {
    return this.fell ? 'core' : this.wiped ? 'crew' : null;
  }

  /** The crew's respawn charges. */
  get respawns(): number {
    return this.charges;
  }

  /**
   * The most the crew can hold now: so many for each player in the run (or what it holds, if a
   * player has left with more than that in the pool, which the dawn then does not add to).
   */
  get respawnMax(): number {
    return Math.max(this.capacity, this.charges);
  }

  /** The most the dawn will fill the pool to: so many charges for each player in the run. */
  private get capacity(): number {
    return RESPAWN.capPerPlayer * this.players.size;
  }

  /**
   * Plays `dt` seconds of real time. A gap longer than `SURVIVAL.maxCatchUpSeconds` is cut to
   * that, and what is left over after the last whole step waits for the next call.
   */
  advance(dt: number): void {
    if (this.over || !(dt > 0)) return;
    this.carry += Math.min(dt, SURVIVAL.maxCatchUpSeconds) * SIM_HZ;
    const steps = Math.floor(this.carry + STEP_EPSILON);
    this.carry = Math.max(0, this.carry - steps);
    for (let i = 0; i < steps && !this.over; i++) this.step();
  }

  /** Jumps `seconds` ahead by taking every step in between, so nothing that should happen on the way is skipped. */
  warp(seconds: number): void {
    const steps = Math.max(0, Math.round(seconds * SIM_HZ));
    for (let i = 0; i < steps && !this.over; i++) this.step();
  }

  /**
   * Wounds the Core by `amount` points. Returns true when this blow felled it, which ends the run
   * and announces it. A blow after the run has ended, or one that is not a positive number, does nothing.
   */
  hurtCore(amount: number): boolean {
    if (this.over || !(amount > 0)) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health > 0) return false;
    this.fell = true;
    this.pending.push({ k: 'overrun', n: this.cycle, why: 'core' });
    return true;
  }

  /**
   * Starts keeping a player's Health and Energy, both full, and adds the respawn charges they bring
   * to the crew's pool (once: a player who leaves and comes back does not bring them again). A
   * player already here keeps what they have.
   */
  addPlayer(id: number): void {
    if (this.players.has(id)) return;
    this.players.set(id, new PlayerVitals());
    if (this.brought.has(id)) return;
    this.brought.add(id);
    this.charges += RESPAWN.startPerPlayer;
  }

  /** Sets the crew's respawn charges outright, within what it can hold. For tests and the debug page. */
  setRespawns(count: number): void {
    if (!Number.isFinite(count)) return;
    this.charges = Math.min(this.capacity, Math.max(0, Math.floor(count)));
  }

  /** A player leaves the run. Their charges stay in the pool; if they were down they are no longer waited for. */
  removePlayer(id: number): void {
    this.players.delete(id);
    const index = this.fallen.indexOf(id);
    if (index >= 0) this.fallen.splice(index, 1);
  }

  /** The meters of a player this simulation keeps, for tests and the debug page. */
  playerVitals(id: number): PlayerVitals | undefined {
    return this.players.get(id);
  }

  /** True for a player this simulation keeps who is down, which stops their hands: no blocks, no shots. */
  isDown(id: number): boolean {
    const vitals = this.players.get(id);
    return vitals !== undefined && !vitals.alive;
  }

  /**
   * Tells the simulation where a player is and how fast they cross the ground, so sprinting costs
   * Energy and the Core's field can charge them. The host calls it every tick for every player it
   * has heard from.
   */
  observe(id: number, x: number, y: number, z: number, speed: number, onGround: boolean): void {
    this.players.get(id)?.observe(x, y, z, speed, onGround);
  }

  /** Wounds a player and returns the points it took (0 for someone not here, or a blow that is no use). */
  hurtPlayer(id: number, amount: number): number {
    return this.players.get(id)?.hurt(amount) ?? 0;
  }

  /** Spends a player's Energy on something they did, by the amount. */
  spendEnergy(id: number, amount: number): void {
    this.players.get(id)?.spend(amount);
  }

  /** A player placed or broke a block: it costs them a little Energy. */
  playerBuilt(id: number): void {
    this.spendEnergy(id, VITALS.energy.perEdit);
  }

  /**
   * A player fires the blaster. The bolt leaves `origin` along the unit vector `dir`, stops at the
   * first block, hill or Core in its way and hurts the first of the first `count` of `bodies` it
   * meets before that: they are where the machines were on the screen the player aimed on, so the
   * host passes the poses of a moment ago and a shot that looked true is one. The shot costs the
   * player Energy. Returns false, and does nothing, for someone not here or down, once the run is
   * over, or for a shot that comes before the blaster is ready again. A player who is shaken hits softer.
   */
  fire(
    id: number,
    origin: Vec3,
    dir: Vec3,
    bodies: readonly EnemyPose[],
    count: number,
    out: ShotOutcome,
  ): boolean {
    const vitals = this.players.get(id);
    if (!vitals || this.over || !vitals.alive || !vitals.takeShot()) return false;
    const trace = traceShot(
      this.ray,
      origin,
      dir,
      BLASTER.range,
      bodies,
      count,
      hitboxOf,
      this.isAlive,
      this.trace,
    );
    out.x = origin.x + dir.x * trace.distance;
    out.y = origin.y + dir.y * trace.distance;
    out.z = origin.z + dir.z * trace.distance;
    out.flags = trace.flags;
    out.enemy = 0;
    if (trace.flags & SHOT_FLAG.enemy) {
      const struck = (bodies[trace.index] as EnemyPose).id;
      out.enemy = struck;
      if (this.machines?.hurt(struck, BLASTER.damage * vitals.damageScale)) {
        out.flags |= SHOT_FLAG.kill;
      }
    }
    vitals.spend(VITALS.energy.perShot);
    return true;
  }

  /** Fills `out` with a player's meters, or returns null for someone not here. */
  readVitals(id: number, out: VitalsReading): VitalsReading | null {
    const vitals = this.players.get(id);
    if (!vitals) return null;
    vitals.read(out);
    out.returnIn = this.returnIn(id, vitals);
    return out;
  }

  /** A block was placed or broken: the machines' map reads the cell again. */
  blockChanged(x: number, y: number, z: number): void {
    this.machines?.blockChanged(x, y, z);
  }

  /**
   * Moves the blocks the machines have chewed through since the last call into `out`. The host
   * breaks them as it breaks any block, and then tells the run with `blockChanged`.
   */
  drainBreaks(out: NavCell[]): void {
    this.machines?.drainBreaks(out);
  }

  /** Moves everything that happened since the last call into `out` (oldest first). */
  drainEvents(out: SurvivalEvent[]): void {
    for (const event of this.pending) out.push(event);
    this.pending.length = 0;
  }

  /** The run as it stands, with the part of a step not yet taken counted in. `running` is false once the run is over. */
  read(out: SurvivalReading): SurvivalReading {
    readClock(this.elapsed + (this.over ? 0 : this.carry * SIM_STEP_SECONDS), out);
    out.running = !this.over;
    out.coreHealth = this.coreHealth;
    out.coreMax = this.coreMax;
    out.over = this.over;
    out.overWhy = this.overWhy;
    out.respawns = this.charges;
    out.respawnMax = this.respawnMax;
    return out;
  }

  /** The number of the day or night the run is in: 1 for the first day and the night after it. */
  private get cycle(): number {
    return Math.floor(this.tickValue / CYCLE_TICKS) + 1;
  }

  private step(): void {
    // A step mends the Core when it begins in daylight, so the night's last step is not a repair.
    const beginsByDay = this.tickValue % CYCLE_TICKS < DAY_TICKS;
    this.tickValue++;
    const inCycle = this.tickValue % CYCLE_TICKS;
    if (inCycle === DAY_TICKS) this.pending.push({ k: 'nightfall', n: this.cycle });
    else if (inCycle === 0) {
      this.pending.push({ k: 'dawn', n: this.cycle - 1 });
      this.grantDawnCharges();
    }
    if (beginsByDay) {
      this.health = Math.min(SURVIVAL.core.maxHealth, this.health + MEND_PER_STEP);
    }
    for (const [id, vitals] of this.players) {
      vitals.step(SIM_STEP_SECONDS, this.core);
      if (!vitals.alive && !this.fallen.includes(id)) this.goDown(id);
    }
    this.bringBack();
    this.checkWipe();
    // The night's waves come out of the ground (and at dawn the machines fall back) before the machines move.
    this.waves?.step(this.tickValue, this.pending);
    if (this.machines) this.stepMachines(this.machines);
  }

  /** The dawn gives the crew a charge for every player, up to the most it can hold. */
  private grantDawnCharges(): void {
    const room = this.capacity - this.charges;
    if (room > 0) this.charges += Math.min(room, RESPAWN.dawnPerPlayer * this.players.size);
  }

  /** A player has no Health left: they lie where they fell, and the crew is told. */
  private goDown(id: number): void {
    this.fallen.push(id);
    this.pending.push({ k: 'down', n: this.cycle, p: id });
  }

  /**
   * Brings back the players who have lain down long enough, the first to fall first, one charge
   * each. When the pool is empty the rest wait for the dawn to refill it.
   */
  private bringBack(): void {
    while (this.fallen.length > 0) {
      const id = this.fallen[0] as number;
      const vitals = this.players.get(id);
      // Someone who left, or whose Health was put back by hand, is not waited for.
      if (!vitals || vitals.alive) {
        this.fallen.shift();
        continue;
      }
      if (this.charges <= 0 || vitals.downSeconds + STEP_EPSILON < RESPAWN.delaySeconds) return;
      this.fallen.shift();
      this.charges--;
      vitals.revive();
      this.pending.push({ k: 'back', n: this.cycle, p: id, c: this.charges });
    }
  }

  /**
   * Whole seconds until the Core brings player `id` back: 0 for a player who is up, and for one
   * who is down with no charge to spend, who waits for the dawn.
   */
  private returnIn(id: number, vitals: PlayerVitals): number {
    if (vitals.alive) return 0;
    // A player felled since the last step is not in the queue yet: they stand at the back of it.
    const queued = this.fallen.indexOf(id);
    const place = queued < 0 ? this.fallen.length : queued;
    if (place >= this.charges) return 0;
    return Math.max(1, Math.ceil(RESPAWN.delaySeconds - vitals.downSeconds - STEP_EPSILON));
  }

  /** The run is lost when every player is down and the crew has no charge left to bring one back. */
  private checkWipe(): void {
    if (this.charges > 0 || this.players.size === 0) return;
    for (const vitals of this.players.values()) if (vitals.alive) return;
    this.wiped = true;
    this.pending.push({ k: 'overrun', n: this.cycle, why: 'crew' });
  }

  /** Moves the machines one step, with the players who are in the world and standing as their prey. */
  private stepMachines(machines: EnemySim): void {
    let count = 0;
    for (const [id, vitals] of this.players) {
      if (!vitals.alive || !vitals.position(this.feet)) continue;
      const target = (this.targets[count] ??= { id: 0, x: 0, y: 0, z: 0 });
      target.id = id;
      target.x = this.feet.x;
      target.y = this.feet.y;
      target.z = this.feet.z;
      count++;
    }
    machines.step(SIM_STEP_SECONDS, this.targets, count, this);
  }
}
