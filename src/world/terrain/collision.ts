/**
 * Terrain collision against the baked density grid. A body is a vertical stack of spheres whose
 * centers are pushed out of the ground along the field's gradient, and the velocity into the
 * surface is removed. The same grid that meshes the terrain answers the query, so what is drawn
 * is what is stood on, rock overhangs included. Structure blocks are not terrain: they stay
 * cell-based and use their own query.
 */
import type { GroundBody, GroundQuery } from '../../shared/ground';
import type { SdfGrid } from './grid';

/** Anything with x, y and z, such as a three.js Vector3. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Steepest slope that counts as ground: the surface normal's upward component must exceed this. */
export const WALKABLE_NORMAL_Y = 0.55;

const scratch = new Float32Array(3);

/**
 * Pushes the body out of the terrain. `position` is the feet; each entry of `heights` is the
 * center of a sphere that far above them. Moves `position` and `velocity` in place and returns
 * true when the body rests on walkable ground.
 *
 * Ground gentle enough to walk on lifts the body straight up. Pushing along the surface normal
 * would shove a body standing on a slope a little downhill every tick, and slow one walking up
 * it. Anything steeper, and every ceiling, pushes along the normal and takes the velocity that
 * points into it, so a body slides along a cliff instead of climbing it.
 */
export function resolveTerrain(
  grid: SdfGrid,
  position: Vec3Like,
  velocity: Vec3Like,
  radius: number,
  heights: readonly number[],
  passes = 3,
): boolean {
  let grounded = false;
  for (let pass = 0; pass < passes; pass++) {
    for (const h of heights) {
      const x = position.x;
      const y = position.y + h;
      const z = position.z;
      const d = grid.sample(x, y, z) - radius;
      if (d >= 0) continue;
      grid.gradient(x, y, z, scratch);
      const gx = scratch[0] as number;
      const gy = scratch[1] as number;
      const gz = scratch[2] as number;
      const length = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
      const nx = gx / length;
      const ny = gy / length;
      const nz = gz / length;
      if (ny > WALKABLE_NORMAL_Y) {
        position.y -= d / ny;
        grounded = true;
        if (velocity.y < 0) velocity.y = 0;
        continue;
      }
      position.x -= nx * d;
      position.y -= ny * d;
      position.z -= nz * d;
      // Remove the part of the velocity that points into the surface.
      const into = velocity.x * nx + velocity.y * ny + velocity.z * nz;
      if (into < 0) {
        velocity.x -= nx * into;
        velocity.y -= ny * into;
        velocity.z -= nz * into;
      }
    }
  }
  return grounded;
}

/**
 * The terrain as the movement code's `GroundQuery`. The square the world covers has an invisible
 * wall `bound` meters from the middle, so a player cannot walk off the edge of the terrain mesh.
 */
export function createTerrainGround(grid: SdfGrid, bound: number): GroundQuery {
  const velocity: Vec3Like = { x: 0, y: 0, z: 0 };
  const normal = new Float32Array(3);

  const clampToWorld = (body: GroundBody): void => {
    if (body.x > bound) {
      body.x = bound;
      if (body.vx > 0) body.vx = 0;
    } else if (body.x < -bound) {
      body.x = -bound;
      if (body.vx < 0) body.vx = 0;
    }
    if (body.z > bound) {
      body.z = bound;
      if (body.vz > 0) body.vz = 0;
    } else if (body.z < -bound) {
      body.z = -bound;
      if (body.vz < 0) body.vz = 0;
    }
  };

  return {
    distance: (x, y, z) => grid.sample(x, y, z),

    pushOut(body, radius, heights) {
      velocity.x = body.vx;
      velocity.y = body.vy;
      velocity.z = body.vz;
      const grounded = resolveTerrain(grid, body, velocity, radius, heights);
      body.vx = velocity.x;
      body.vy = velocity.y;
      body.vz = velocity.z;
      clampToWorld(body);
      return grounded;
    },

    snapDown(body, radius, height, maxDrop) {
      const centerY = body.y + height;
      // How far the sphere's underside hangs above the surface, measured along the surface normal.
      const gap = grid.sample(body.x, centerY, body.z) - radius;
      if (gap <= 0 || gap > maxDrop) return false;
      grid.gradient(body.x, centerY, body.z, normal);
      const length = Math.hypot(normal[0] as number, normal[1] as number, normal[2] as number) || 1;
      const up = (normal[1] as number) / length;
      if (up <= WALKABLE_NORMAL_Y) return false;
      // Straight down is longer than the way along the normal on a slope.
      const drop = gap / up;
      if (drop > maxDrop) return false;
      body.y -= drop;
      return true;
    },
  };
}
