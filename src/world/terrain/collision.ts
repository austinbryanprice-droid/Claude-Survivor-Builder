/**
 * Terrain collision against the baked density grid. A body is a vertical stack of spheres whose
 * centers are pushed out of the ground along the field's gradient, and the velocity into the
 * surface is removed. The same grid that meshes the terrain answers the query, so what is drawn
 * is what is stood on, rock overhangs included. Structure blocks are not terrain: they stay
 * cell-based and use their own query.
 */
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
      position.x -= nx * d;
      position.y -= ny * d;
      position.z -= nz * d;
      if (ny > WALKABLE_NORMAL_Y) {
        grounded = true;
        if (velocity.y < 0) velocity.y = 0;
      }
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
