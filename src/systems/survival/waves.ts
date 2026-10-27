import { CYCLE_SECONDS, DAY_SECONDS } from '../../shared/daycycle';
import { createRng, hash32 } from '../../shared/hash';
import { SIM_HZ, type SurvivalEvent } from '../../shared/survival-state';
import { WAVES } from './balance';
import type { EnemySim } from './enemies';

/**
 * The waves of each night, and the director that sends them in. A night's machines come in a few
 * waves spread over the first three quarters of it, each from one side of the ring round the Core,
 * and the crew is told ten seconds before each. At dawn the machines still standing fall back.
 *
 * The plan of a night (`planNight`) is plain arithmetic on the night's number, so a test, the
 * balance simulator of Phase 5 and the host all read the same one. Where each machine comes in is
 * drawn from the world's seed and the number of the night and of the wave, nothing else: the same
 * seed plays the same waves however the crew played the nights before, which is what Retry needs.
 */

/** A kind of machine in the plan. The body each one has is in `WAVES.kinds`: the breacher fights as a crawler until 5i3. */
export type WaveKind = keyof typeof WAVES.kinds;

/** One wave of a night. */
export interface WavePlan {
  /** Seconds after nightfall that the crew is told. */
  readonly warnAt: number;
  /** Seconds after nightfall that its first machine comes out of the ground. */
  readonly comesAt: number;
  /** The machines of the wave, in the order they come. */
  readonly kinds: readonly WaveKind[];
}

/** Everything a night holds. */
export interface NightPlan {
  readonly night: number;
  /** How many times a crawler's Health a machine of the plain kind has tonight. */
  readonly healthScale: number;
  /** Every machine of the night, in order. */
  readonly total: number;
  readonly waves: readonly WavePlan[];
}

const CYCLE_TICKS = CYCLE_SECONDS * SIM_HZ;
const DAY_TICKS = DAY_SECONDS * SIM_HZ;
const RELEASE_TICKS = Math.max(1, Math.round(WAVES.timing.release * SIM_HZ));
const TWO_PI = Math.PI * 2;

/** The number of a night as a whole number from 1 on. */
function wholeNight(night: number): number {
  return Number.isFinite(night) ? Math.max(1, Math.floor(night)) : 1;
}

/** How many machines come on a night, the special kinds among them. */
export function machinesOnNight(night: number): number {
  const n = wholeNight(night);
  const totals = WAVES.totals;
  const last = totals[totals.length - 1] as number;
  return n <= totals.length
    ? (totals[n - 1] as number)
    : last + (n - totals.length) * WAVES.perNightAfter;
}

/**
 * The kind of every machine that comes on a night, the plain ones first. The special kinds take
 * their places among the night's total, and the plain kind has the rest.
 */
export function kindsOnNight(night: number): WaveKind[] {
  const n = wholeNight(night);
  const total = machinesOnNight(n);
  const kinds: WaveKind[] = [];
  for (const { kind, from, every } of WAVES.specials) {
    if (n < from) continue;
    const count = 1 + Math.floor((n - from) / every);
    for (let i = 0; i < count && kinds.length < total; i++) kinds.push(kind);
  }
  const plain: WaveKind[] = new Array<WaveKind>(total - kinds.length).fill('crawler');
  return [...plain, ...kinds];
}

/** How many times a crawler's Health the machines have on a night. */
export function healthScaleOnNight(night: number): number {
  const n = wholeNight(night);
  const { toughFrom, tough, growsFrom, grows } = WAVES.health;
  if (n < toughFrom) return 1;
  return tough * Math.pow(grows, Math.max(0, n - growsFrom + 1));
}

/** The waves of a night: when each is announced, when it comes, and what is in it. */
export function planNight(night: number): NightPlan {
  const n = wholeNight(night);
  const kinds = kindsOnNight(n);
  const total = kinds.length;
  const count = Math.min(WAVES.maxWaves, Math.max(1, Math.ceil(total / WAVES.perWave)));
  const { firstAt, lastAt, maxGap, warning } = WAVES.timing;
  const gap = count > 1 ? Math.min(maxGap, (lastAt - firstAt) / (count - 1)) : 0;
  // As even as can be, the larger waves last.
  const base = Math.floor(total / count);
  const larger = total % count;
  const waves: WavePlan[] = [];
  let taken = 0;
  for (let i = 0; i < count; i++) {
    const comesAt = firstAt + i * gap;
    const size = base + (i >= count - larger ? 1 : 0);
    waves.push({
      warnAt: Math.max(0, comesAt - warning),
      comesAt,
      kinds: kinds.slice(taken, taken + size),
    });
    taken += size;
  }
  return { night: n, healthScale: healthScaleOnNight(n), total, waves };
}

/** A wave that is coming out of the ground, one machine at a time. */
interface Arrival {
  readonly wave: WavePlan;
  readonly rng: () => number;
  /** Where on the ring it comes from, as an angle round the Core. */
  readonly bearing: number;
  /** The machine to bring next. */
  next: number;
  /** The tick of the night at which it comes. */
  at: number;
}

/**
 * Sends the plan of each night into the machines' simulation, one step at a time. It keeps no
 * clock of its own: the survival simulation tells it which step the run has reached.
 */
export class WaveDirector {
  private night = 0;
  private plan: NightPlan | null = null;
  private warnTicks: number[] = [];
  private comeTicks: number[] = [];
  private readonly arrivals: Arrival[] = [];

  constructor(
    private readonly machines: EnemySim,
    private readonly seed: number,
  ) {}

  /** Machines of the waves that are still to come out of the ground tonight. */
  get pending(): number {
    let count = 0;
    for (const arrival of this.arrivals) count += arrival.wave.kinds.length - arrival.next;
    return count;
  }

  /**
   * Plays the step that took the run to `tick` (the number of steps taken since it began).
   * Whatever the crew must be told goes to the end of `events`. A run that opens in the middle of
   * a night skips the waves whose time has passed.
   */
  step(tick: number, events: SurvivalEvent[]): void {
    const inCycle = tick % CYCLE_TICKS;
    if (inCycle < DAY_TICKS) {
      // First light: what is left of the night's machines falls back.
      if (inCycle === 0) this.fallBack();
      return;
    }
    const night = Math.floor(tick / CYCLE_TICKS) + 1;
    if (night !== this.night) this.begin(night);
    const plan = this.plan as NightPlan;
    const inNight = inCycle - DAY_TICKS;

    for (let i = 0; i < plan.waves.length; i++) {
      const wave = plan.waves[i] as NightPlan['waves'][number];
      if (inNight === this.warnTicks[i]) {
        events.push({ k: 'wave', n: night, i: i + 1, of: plan.waves.length, c: wave.kinds.length });
      }
      if (inNight === this.comeTicks[i]) {
        const rng = createRng(
          hash32(this.seed ^ Math.imul(night, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b)),
        );
        // The first draw of a wave's own stream is the side it comes from.
        this.arrivals.push({ wave, rng, bearing: rng() * TWO_PI, next: 0, at: inNight });
      }
    }
    this.release(inNight, plan);
  }

  private begin(night: number): void {
    this.night = night;
    this.plan = planNight(night);
    this.warnTicks = this.plan.waves.map((wave) => Math.round(wave.warnAt * SIM_HZ));
    this.comeTicks = this.plan.waves.map((wave) => Math.round(wave.comesAt * SIM_HZ));
    this.arrivals.length = 0;
  }

  private fallBack(): void {
    this.arrivals.length = 0;
    this.machines.clear();
  }

  /** Brings the machines whose turn it is out of the ground. */
  private release(inNight: number, plan: NightPlan): void {
    for (let i = this.arrivals.length - 1; i >= 0; i--) {
      const arrival = this.arrivals[i] as Arrival;
      while (arrival.next < arrival.wave.kinds.length && inNight >= arrival.at) {
        const { body, health } = WAVES.kinds[arrival.wave.kinds[arrival.next] as WaveKind];
        this.machines.spawn(
          1,
          plan.healthScale * health,
          { rng: arrival.rng, bearing: arrival.bearing, arc: WAVES.arc },
          body,
        );
        arrival.next++;
        arrival.at += RELEASE_TICKS;
      }
      if (arrival.next >= arrival.wave.kinds.length) this.arrivals.splice(i, 1);
    }
  }
}
