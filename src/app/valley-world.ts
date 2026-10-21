import type { MistZones } from '../engine/atmosphere';
import type { GameWorld, SpawnPoint } from '../engine/game';
import type { Stage } from '../engine/stage';
import type { TerrainMode } from '../shared/view-flags';
import { ValleyView } from '../world/render/valley-view';
import { createTerrainGround } from '../world/terrain/collision';
import { CRASH, LAKE, WATER_LEVEL, WORLD_HALF } from '../world/terrain/field';
import { bakeTerrain, type Terrain } from '../world/terrain/terrain';
import { SHOTS, SPAWN_SHOT, createFlyRoute, yawFromBearing } from '../world/terrain/viewpoints';
import { buildDemo, isDemoName } from '../world/voxels/demo';
import { createWorld, type VoxelWorld } from '../world/voxels/world';

/** The colored mist pockets sit over the lake and the crash site, wherever the seed puts the hills. */
export const VALLEY_MIST: MistZones = {
  lake: { x: LAKE.x, z: LAKE.z, radius: 46, top: WATER_LEVEL + 5.5 },
  crash: { x: CRASH.x, z: CRASH.z, radius: CRASH.radius * 1.5, top: CRASH.floor + 4 },
};

/** The invisible wall that keeps a player on the terrain, in meters from the middle. */
const EDGE_WALL = WORLD_HALF - 1;
const RADIANS_PER_DEGREE = Math.PI / 180;

/** The game world of this build: the seeded valley with whatever players have built on it. */
export interface ValleyWorld extends GameWorld {
  readonly terrain: Terrain;
  /** The blocks players have placed, which is everything that is not the seeded terrain. */
  readonly voxels: VoxelWorld;
  readonly view: ValleyView;
}

/**
 * Builds the valley for a seed and draws it on the stage. The terrain answers collision as smooth
 * ground and the voxel world answers it as cells, so a player stands on both. The seed alone makes
 * the terrain, so a joining player builds the same hills from the host's number. `demo` names a
 * structure from `world/voxels/demo.ts` to raise before the first frame, for looking at the blocks.
 */
export function createValleyWorld(
  stage: Stage,
  seed: number,
  mode: TerrainMode,
  demo: string | null = null,
): ValleyWorld {
  const started = performance.now();
  const terrain = bakeTerrain(seed);
  const voxels = createWorld(seed, terrain);
  const built = isDemoName(demo) ? buildDemo(voxels, demo) : null;
  const view = new ValleyView(stage, terrain, mode, voxels, built ? [built.clearing] : []);
  // A demo is on screen from the first frame; blocks that arrive in play go through the remesh budget.
  if (built) view.structures.meshAll();
  const { grid } = terrain;
  const groundAt = (x: number, z: number): number => grid.groundAt(x, z);

  const spawnShot = SHOTS[SPAWN_SHOT];
  if (!spawnShot) throw new Error(`Unknown spawn viewpoint "${SPAWN_SHOT}"`);
  const spawn: SpawnPoint = {
    x: spawnShot.x,
    z: spawnShot.z,
    yaw: yawFromBearing(spawnShot.bearing),
    pitch: spawnShot.pitch * RADIANS_PER_DEGREE,
  };

  return {
    seed,
    terrain,
    voxels,
    view,
    collision: {
      isSolid: (x, y, z) => voxels.isSolid(x, y, z),
      ground: createTerrainGround(grid, EDGE_WALL),
    },
    spawn,
    route: createFlyRoute(groundAt),
    info: {
      terrain: mode,
      build: {
        field: terrain.buildMs.field,
        grid: terrain.buildMs.grid,
        mesh: view.buildMs.mesh,
        scatter: view.buildMs.scatter,
        total: performance.now() - started,
      },
    },
    groundAt,
    dispose() {
      view.dispose();
    },
  };
}
