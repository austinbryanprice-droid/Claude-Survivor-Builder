import { createTerrainField, type TerrainField } from './field';
import { bakeGrid, type SdfGrid } from './grid';

/** The valley for one seed: the field it is defined by and the baked grid that meshing and collision read. */
export interface Terrain {
  readonly seed: number;
  readonly field: TerrainField;
  readonly grid: SdfGrid;
  /** How long the field and the grid took to build, in milliseconds, for the benchmark report. */
  readonly buildMs: { readonly field: number; readonly grid: number };
}

/** Builds the terrain from a seed. Every browser gets the same one; it takes about half a second. */
export function bakeTerrain(seed: number): Terrain {
  const t0 = performance.now();
  const field = createTerrainField(seed);
  const t1 = performance.now();
  const grid = bakeGrid(field);
  const t2 = performance.now();
  return { seed, field, grid, buildMs: { field: t1 - t0, grid: t2 - t1 } };
}
