import type { CollisionWorld } from '../../../src/shared/ground';
import type { SolidQuery } from '../../../src/shared/solid';
import { createTerrainGround } from '../../../src/world/terrain/collision';
import type { SdfGrid } from '../../../src/world/terrain/grid';

/**
 * A planar ground tilted by `angle` radians about the z axis, passing through the origin. It rises
 * toward +x, so walking toward -x goes downhill. Only the two methods the terrain queries use exist.
 */
export function tiltedPlane(angle: number): SdfGrid {
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  return {
    sample: (x: number, y: number) => x * nx + y * ny,
    gradient: (_x: number, _y: number, _z: number, out: Float32Array | number[]) => {
      out[0] = nx;
      out[1] = ny;
      out[2] = 0;
    },
  } as unknown as SdfGrid;
}

/** Terrain only, or terrain with cells on it, the way the game stands a player on both. */
export function groundWorld(
  grid: SdfGrid,
  bound = 1000,
  cells: SolidQuery = { isSolid: () => false },
): CollisionWorld {
  return { isSolid: (x, y, z) => cells.isSolid(x, y, z), ground: createTerrainGround(grid, bound) };
}
