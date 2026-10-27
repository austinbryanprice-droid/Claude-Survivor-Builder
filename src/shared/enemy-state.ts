/**
 * What the machines that come for the Core look like from outside: the numbers the host reports
 * about each one, and the smoothed picture a screen draws from them. Pure types and a few
 * constants, so the host's simulation, the packet codec, the guests' mirror and the drawing all
 * read them the same way.
 */

/** The kinds of machine. A kind is a number on the wire; the table of what each one is lives with the simulation. */
export const ENEMY_KIND = {
  crawler: 0,
  /** The crawler's plated cousin: bigger, slower, takes less of every hit, and leaves Tier 4 cells (Phase 5i1). */
  armored: 1,
  /** The flying skimmer: small and quick, it hovers over walls and water and zaps from above (Phase 5i2). */
  flyer: 2,
} as const;

/** How many kinds the wire accepts: a packet naming one past this is refused. */
export const ENEMY_KIND_COUNT = 3;

/** The bits of an enemy's `flags`. */
export const ENEMY_FLAG = {
  /** It is winding up a bite, which the drawing shows as a lunge. */
  attack: 1,
  /** A blow landed a moment ago, which the drawing shows as a flash. */
  hurt: 2,
} as const;

/** Every flag the wire knows; the rest of the bits are dropped. */
export const ENEMY_FLAGS_MASK = ENEMY_FLAG.attack | ENEMY_FLAG.hurt;

/**
 * One enemy as the host reports it, in the exact values that travel: a position in blocks, a
 * heading in radians, and Health as a part of 255 of the full bar (1 for the last sliver, never 0
 * for one that is alive).
 *
 * The heading is where the machine faces: it goes toward `(sin yaw, cos yaw)` in x and z, and the
 * model's front is +Z.
 */
export interface EnemyState {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  flags: number;
}

export function createEnemyState(): EnemyState {
  return { id: 0, kind: 0, x: 0, y: 0, z: 0, yaw: 0, health: 255, flags: 0 };
}

/** The most Health a state carries: the full bar. */
export const ENEMY_HEALTH_FULL = 255;

/**
 * One enemy as it is drawn: smoothed between the host's reports, with how fast it is moving (for
 * the legs) and Health as a fraction of the full bar. The object is reused from call to call.
 */
export interface EnemyPose {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Blocks a second across the ground. */
  speed: number;
  /** Health as a fraction of the full bar, in (0, 1]. */
  health: number;
  flags: number;
}

export function createEnemyPose(): EnemyPose {
  return { id: 0, kind: 0, x: 0, y: 0, z: 0, yaw: 0, speed: 0, health: 1, flags: 0 };
}
