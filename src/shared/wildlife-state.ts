import {
  ENEMY_HEALTH_FULL,
  createEnemyPose,
  createEnemyState,
  type EnemyPose,
  type EnemyState,
} from './enemy-state';

/**
 * The creatures that roam the valley, from outside: the numbers the host reports about each one and
 * the smoothed picture a screen draws from them. They travel the way the machines do (one packet of
 * every creature, positions in 1/16 of a block, ten times a second), so a creature is described by
 * the same record as a machine: its `kind` is the species, and the flags are its own.
 *
 * Pure types and a few constants, so the host's simulation, the packet codec, the guests' mirror
 * and the drawing all read them the same way.
 */

/** The species. A species is a number on the wire; the table of what each one is lives with the simulation. */
export const WILD_SPECIES = {
  /** A wary grazer of the meadows that goes in small herds, and puts its antlers into whoever hurts it. */
  stag: 0,
  /** A small, quick hare of the grass that bolts, and never fights. */
  hare: 1,
  /** A huge, slow, mossy tortoise of the shore that ignores everyone until it is hit. */
  mossback: 2,
  /** A school of small silver fish in the lake. */
  shoal: 3,
  /** A broad ray that glides under the lake's surface and stings the one who hurts it. */
  ray: 4,
  /** A lantern jelly that drifts and pulses, and jets away when it is hurt. */
  jelly: 5,
  /** A flock of small birds that wheels over the valley and scatters at a threat. */
  finch: 6,
  /** A big bird that soars in wide circles high up, and dives at whoever hurts it. */
  kite: 7,
} as const;

/** How many species the wire accepts: a packet naming one past this is refused. */
export const WILD_SPECIES_COUNT = 8;

/** The bits of a creature's `flags`. */
export const WILD_FLAG = {
  /** It has been startled and is running, swimming or flying away, which the drawing shows as the fast gait and a raised head. */
  alarmed: 1,
  /** A blow landed a moment ago, which the drawing shows as a flash. */
  hurt: 2,
  /** It was hurt by a player and is out for them, which the drawing shows as a red glint in the eye. */
  angry: 4,
  /** It is winding up a blow of its own (a jab, a bash, a sting, a dive), which the drawing shows as a lunge. */
  strike: 8,
} as const;

/** Every flag the wire knows; the rest of the bits are dropped. */
export const WILD_FLAGS_MASK =
  WILD_FLAG.alarmed | WILD_FLAG.hurt | WILD_FLAG.angry | WILD_FLAG.strike;

/** One creature as the host reports it: the same record as a machine, with the species in `kind`. */
export type WildState = EnemyState;

/** One creature as it is drawn: smoothed between the host's reports. The object is reused from call to call. */
export type WildPose = EnemyPose;

/** The most Health a state carries: the full bar. */
export const WILD_HEALTH_FULL = ENEMY_HEALTH_FULL;

export function createWildState(): WildState {
  return createEnemyState();
}

export function createWildPose(): WildPose {
  return createEnemyPose();
}
