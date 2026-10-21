import type { SolidQuery } from './solid';

/** What the ground query reads and corrects on a moving body: where the feet are and how fast it goes. */
export interface GroundBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/**
 * Smooth ground, which is the terrain. Structures are cells and answer to `SolidQuery`; everything
 * that is not a cell answers here. The movement code stands a vertical stack of spheres in for the
 * body, so slopes, rocks and overhangs behave the way they look. Units are blocks (meters).
 */
export interface GroundQuery {
  /** Signed distance from a point to the ground surface: negative inside the ground, positive in the open. */
  distance(x: number, y: number, z: number): number;

  /**
   * Pushes a body out of the ground. The body is a stack of spheres of `radius` whose centers sit
   * at each of `heights` above the feet. Moves the feet, and removes the velocity that points into
   * the surface. Returns true when the body rests on ground gentle enough to walk on.
   */
  pushOut(body: GroundBody, radius: number, heights: readonly number[]): boolean;

  /**
   * Sets a body that hovers just above walkable ground back on it. `height` is the center of the
   * lowest sphere, and the ground must lie within `maxDrop` below that sphere. Returns true when the
   * body was moved down and now rests on the ground.
   */
  snapDown(body: GroundBody, radius: number, height: number, maxDrop: number): boolean;
}

/**
 * Everything a moving body can hit: cells for structures, and optionally smooth ground for the
 * terrain. A world made only of cells (the test floors) leaves `ground` out.
 */
export interface CollisionWorld extends SolidQuery {
  readonly ground?: GroundQuery;
}
