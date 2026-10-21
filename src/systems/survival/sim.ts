import { CYCLE_SECONDS, DAY_SECONDS } from '../../shared/daycycle';
import {
  SIM_HZ,
  SIM_STEP_SECONDS,
  readClock,
  type SurvivalEvent,
  type SurvivalReading,
} from '../../shared/survival-state';
import { SURVIVAL } from './balance';

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
}

/**
 * The host's survival simulation: the day and night clock and the Outpost Core now, and the
 * vitals, the machines and the waves as the later parts arrive. It is pure (no DOM, no three.js,
 * no network) and it advances in fixed 20 Hz steps, so a Worker, a test and the browser all play
 * the same run.
 *
 * Time is counted in whole steps. The caller feeds it real time with `advance`, which turns it
 * into steps, and decides whether the run is held (single-player with the mouse free) by simply
 * not calling it. Once the Core falls the run is over: the clock stops where it was and nothing
 * moves again.
 */
export class SurvivalSim {
  private tickValue: number;
  /** Real time not yet turned into a step, in steps: always in [0, 1). */
  private carry = 0;
  private health: number;
  private fell = false;
  private readonly pending: SurvivalEvent[] = [];

  constructor(options: SurvivalOptions = {}) {
    this.tickValue = Math.max(0, Math.round((options.startAt ?? 0) * SIM_HZ));
    const max = SURVIVAL.core.maxHealth;
    this.health = Math.min(max, Math.max(1, options.coreHealth ?? max));
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

  /** True once the Core has fallen. The run does not start again; a new run is a new simulation. */
  get over(): boolean {
    return this.fell;
  }

  /**
   * Plays `dt` seconds of real time. A gap longer than `SURVIVAL.maxCatchUpSeconds` is cut to
   * that, and what is left over after the last whole step waits for the next call.
   */
  advance(dt: number): void {
    if (this.fell || !(dt > 0)) return;
    this.carry += Math.min(dt, SURVIVAL.maxCatchUpSeconds) * SIM_HZ;
    const steps = Math.floor(this.carry + STEP_EPSILON);
    this.carry = Math.max(0, this.carry - steps);
    for (let i = 0; i < steps && !this.fell; i++) this.step();
  }

  /** Jumps `seconds` ahead by taking every step in between, so nothing that should happen on the way is skipped. */
  warp(seconds: number): void {
    const steps = Math.max(0, Math.round(seconds * SIM_HZ));
    for (let i = 0; i < steps && !this.fell; i++) this.step();
  }

  /**
   * Wounds the Core by `amount` points. Returns true when this blow felled it, which ends the run
   * and announces it. A blow after that, or one that is not a positive number, does nothing.
   */
  hurtCore(amount: number): boolean {
    if (this.fell || !(amount > 0)) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health > 0) return false;
    this.fell = true;
    this.pending.push({ k: 'overrun', n: this.cycle });
    return true;
  }

  /** Moves everything that happened since the last call into `out` (oldest first). */
  drainEvents(out: SurvivalEvent[]): void {
    for (const event of this.pending) out.push(event);
    this.pending.length = 0;
  }

  /** The run as it stands, with the part of a step not yet taken counted in. `running` is false once the run is over. */
  read(out: SurvivalReading): SurvivalReading {
    readClock(this.elapsed + (this.fell ? 0 : this.carry * SIM_STEP_SECONDS), out);
    out.running = !this.fell;
    out.coreHealth = this.coreHealth;
    out.coreMax = this.coreMax;
    out.over = this.fell;
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
    else if (inCycle === 0) this.pending.push({ k: 'dawn', n: this.cycle - 1 });
    if (beginsByDay) {
      this.health = Math.min(SURVIVAL.core.maxHealth, this.health + MEND_PER_STEP);
    }
  }
}
