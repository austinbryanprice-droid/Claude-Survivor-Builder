import { CYCLE_SECONDS, DAY_SECONDS, NIGHT_SECONDS } from './daycycle';

/**
 * What the survival loop looks like from outside: the run's clock, the events the host announces,
 * and the read-only view every peer (the host and the guests alike) gives the screen. Pure types
 * and arithmetic, so the host's simulation, the guests' mirror, the HUD and the sky all read the
 * same numbers the same way.
 */

export type Unsubscribe = () => void;

/** The simulation advances in steps of this size: 20 a second. The wire counts steps, not seconds. */
export const SIM_HZ = 20;
export const SIM_STEP_SECONDS = 1 / SIM_HZ;

export type DayPhase = 'day' | 'night';

/** What ended a run: the Outpost Core fell, or every player was down with no respawn charge left. */
export type OverrunCause = 'core' | 'crew';

/**
 * How a lost run starts over: `retry` plays the same valley again (the same seed, so the same
 * waves come, with nothing built on it) and `new` draws another valley.
 */
export type RestartKind = 'retry' | 'new';

/**
 * What a screen needs to know about the run, read once a frame. The object is reused from call to
 * call, so read what you need and do not keep it.
 */
export interface SurvivalReading {
  /** Seconds the run has been played. Time the clock was held does not count. */
  elapsed: number;
  /** 1 for the first day and the night after it, 2 for the next pair, and so on. */
  cycle: number;
  phase: DayPhase;
  /** Seconds into the phase. */
  into: number;
  /** Seconds left in the phase. */
  left: number;
  /** Where the sky is in its cycle, in [0, 1): 0 at sunrise, 2/3 at nightfall. */
  sky: number;
  /** False while the clock is held (single-player with the mouse free). */
  running: boolean;
  /** The Outpost Core's health, from 0 to `coreMax`. */
  coreHealth: number;
  /** The Core's full health. 0 where there is no Core to show, which hides its gauge. */
  coreMax: number;
  /** True once the run has ended (the Core fell or the whole crew is down): the clock no longer moves. */
  over: boolean;
  /** What ended the run; null while it goes on. */
  overWhy: OverrunCause | null;
  /** The crew's respawn charges, shared by every player. */
  respawns: number;
  /** The most the crew can hold now (so many for each player). 0 where there is no run to show, which hides the count. */
  respawnMax: number;
  /** Machines the crew's blasters have felled this run. Counted until the run is over, then final. */
  felled: number;
  /** Blocks the crew has placed this run. */
  placed: number;
  /** Respawn charges the Core has spent bringing players back this run. */
  revived: number;
}

export function createReading(): SurvivalReading {
  return {
    elapsed: 0,
    cycle: 1,
    phase: 'day',
    into: 0,
    left: DAY_SECONDS,
    sky: 0,
    running: false,
    coreHealth: 0,
    coreMax: 0,
    over: false,
    overWhy: null,
    respawns: 0,
    respawnMax: 0,
    felled: 0,
    placed: 0,
    revived: 0,
  };
}

/**
 * Fills `out` with the clock at `elapsed` seconds into the run: day 1 first, then night 1, then
 * day 2, and so on, each pair `CYCLE_SECONDS` long. `running` is left as it was.
 */
export function readClock(elapsed: number, out: SurvivalReading): SurvivalReading {
  const total = elapsed > 0 ? elapsed : 0;
  const cycle = Math.floor(total / CYCLE_SECONDS);
  const within = total - cycle * CYCLE_SECONDS;
  const night = within >= DAY_SECONDS;
  out.elapsed = total;
  out.cycle = cycle + 1;
  out.phase = night ? 'night' : 'day';
  out.into = night ? within - DAY_SECONDS : within;
  out.left = (night ? NIGHT_SECONDS : DAY_SECONDS) - out.into;
  out.sky = within / CYCLE_SECONDS;
  return out;
}

/** Seconds into the run at which night `n` (1 is the first) begins. */
export function nightStart(n: number): number {
  return (Math.max(1, Math.floor(n)) - 1) * CYCLE_SECONDS + DAY_SECONDS;
}

/** How many whole nights the crew has held out: the nights that ended in a dawn. */
export function nightsSurvived(cycle: number): number {
  return Math.max(0, Math.floor(cycle) - 1);
}

/** What the host announces as it happens. Late joiners do not get the past; the snapshot says where things stand. */
export type SurvivalEvent =
  /** Night `n` has begun. */
  | { readonly k: 'nightfall'; readonly n: number }
  /** Wave `i` of the `of` on night `n` comes out of the ground in ten seconds, `c` machines strong. */
  | {
      readonly k: 'wave';
      readonly n: number;
      readonly i: number;
      readonly of: number;
      readonly c: number;
    }
  /** Night `n` is over and day `n + 1` has begun. */
  | { readonly k: 'dawn'; readonly n: number }
  /** The run has ended during day or night `n`, so `n - 1` nights were survived; `why` says what ended it. */
  | { readonly k: 'overrun'; readonly n: number; readonly why: OverrunCause }
  /** Player `p` has no Health left during day or night `n`: they lie where they fell. */
  | { readonly k: 'down'; readonly n: number; readonly p: number }
  /** The Core has brought player `p` back at the base; `c` respawn charges are left. */
  | { readonly k: 'back'; readonly n: number; readonly p: number; readonly c: number };

export const SURVIVAL_EVENT_KINDS: readonly SurvivalEvent['k'][] = [
  'nightfall',
  'wave',
  'dawn',
  'overrun',
  'down',
  'back',
];

/**
 * The survival loop as a screen sees it. The host reads it straight from the simulation and a
 * guest reads the mirror of the host's last word; the screen cannot tell which.
 */
export interface SurvivalView {
  /** Fills `out` with the run as it stands now and returns it. */
  read(out: SurvivalReading): SurvivalReading;
  onEvent(listener: (event: SurvivalEvent) => void): Unsubscribe;
}
