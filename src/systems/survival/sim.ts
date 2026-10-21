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

export interface SurvivalOptions {
  /** Seconds into the run to start at (the `?night=` switch); 0 is sunrise of day 1. */
  startAt?: number;
}

/**
 * The host's survival simulation: the day and night clock now, and the Core, the vitals, the
 * machines and the waves as the later parts arrive. It is pure (no DOM, no three.js, no network)
 * and it advances in fixed 20 Hz steps, so a Worker, a test and the browser all play the same run.
 *
 * Time is counted in whole steps. The caller feeds it real time with `advance`, which turns it
 * into steps, and decides whether the run is held (single-player with the mouse free) by simply
 * not calling it.
 */
export class SurvivalSim {
  private tickValue: number;
  /** Real time not yet turned into a step, in steps: always in [0, 1). */
  private carry = 0;
  private readonly pending: SurvivalEvent[] = [];

  constructor(options: SurvivalOptions = {}) {
    this.tickValue = Math.max(0, Math.round((options.startAt ?? 0) * SIM_HZ));
  }

  /** Steps taken since the run began. */
  get tick(): number {
    return this.tickValue;
  }

  /** Seconds the run has been played. */
  get elapsed(): number {
    return this.tickValue / SIM_HZ;
  }

  /**
   * Plays `dt` seconds of real time. A gap longer than `SURVIVAL.maxCatchUpSeconds` is cut to
   * that, and what is left over after the last whole step waits for the next call.
   */
  advance(dt: number): void {
    if (!(dt > 0)) return;
    this.carry += Math.min(dt, SURVIVAL.maxCatchUpSeconds) * SIM_HZ;
    const steps = Math.floor(this.carry + STEP_EPSILON);
    this.carry = Math.max(0, this.carry - steps);
    for (let i = 0; i < steps; i++) this.step();
  }

  /** Jumps `seconds` ahead by taking every step in between, so nothing that should happen on the way is skipped. */
  warp(seconds: number): void {
    const steps = Math.max(0, Math.round(seconds * SIM_HZ));
    for (let i = 0; i < steps; i++) this.step();
  }

  /** Moves everything that happened since the last call into `out` (oldest first). */
  drainEvents(out: SurvivalEvent[]): void {
    for (const event of this.pending) out.push(event);
    this.pending.length = 0;
  }

  /** The run as it stands, with the part of a step not yet taken counted in. `running` is true. */
  read(out: SurvivalReading): SurvivalReading {
    readClock(this.elapsed + this.carry * SIM_STEP_SECONDS, out);
    out.running = true;
    return out;
  }

  private step(): void {
    this.tickValue++;
    const inCycle = this.tickValue % CYCLE_TICKS;
    const cycle = Math.floor(this.tickValue / CYCLE_TICKS);
    if (inCycle === DAY_TICKS) this.pending.push({ k: 'nightfall', n: cycle + 1 });
    else if (inCycle === 0) this.pending.push({ k: 'dawn', n: cycle });
  }
}
