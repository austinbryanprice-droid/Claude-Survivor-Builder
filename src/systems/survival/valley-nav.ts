import { WATER_LEVEL, WORLD_HALF } from '../../world/terrain/field';
import { createSurfaceQuery } from '../../world/terrain/surface';
import type { Terrain } from '../../world/terrain/terrain';
import type { VoxelWorld } from '../../world/voxels/world';
import type { NavWorld } from './nav';

/**
 * What the machines' map reads of the valley being played: the blocks players have built (and the
 * Core) as the movement code sees them, the ground the feet rest on, rocks included, and the lake.
 * The voxel world is read live, so a block placed or broken is there for the map the next time it
 * reads that cell.
 */
export function valleyNavigation(valley: {
  readonly terrain: Terrain;
  readonly voxels: VoxelWorld;
}): NavWorld {
  const { terrain, voxels } = valley;
  return {
    solids: voxels,
    blockAt: (x, y, z) => voxels.getBlock(x, y, z),
    surfaceAt: createSurfaceQuery(terrain),
    waterLevel: WATER_LEVEL,
    half: WORLD_HALF,
  };
}
