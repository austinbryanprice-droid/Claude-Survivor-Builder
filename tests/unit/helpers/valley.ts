import { bakeGroundMaps } from '../../../src/world/render/terrain-render';
import { createScatterGround, type ScatterGround } from '../../../src/world/scatter';
import { createTerrainField, type TerrainField } from '../../../src/world/terrain/field';
import { bakeGrid, type SdfGrid } from '../../../src/world/terrain/grid';
import type { Terrain } from '../../../src/world/terrain/terrain';

/** The seed the look spike opens with; the golden values in the tests belong to it. */
export const TEST_SEED = 20261020;

export interface TestValley {
  readonly field: TerrainField;
  readonly grid: SdfGrid;
  readonly ground: ScatterGround;
}

let cached: TestValley | null = null;

/** The whole valley for the default seed, built once per test file (about half a second). */
export function valley(): TestValley {
  if (cached) return cached;
  const field = createTerrainField(TEST_SEED);
  const grid = bakeGrid(field);
  const maps = bakeGroundMaps(field, grid);
  const ground = createScatterGround(grid, { data: maps.splatData, size: maps.splatSize });
  cached = { field, grid, ground };
  return cached;
}

/** The same valley as a `Terrain`, which is what the voxel world is built on. */
export function terrain(): Terrain {
  const { field, grid } = valley();
  return { seed: TEST_SEED, field, grid };
}
