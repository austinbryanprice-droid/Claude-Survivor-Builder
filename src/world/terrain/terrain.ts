import { createTerrainField, type TerrainField } from './field';
import { bakeGrid, type SdfGrid } from './grid';

/** The valley for one seed: the field it is defined by and the baked grid that meshing and collision read. */
export interface Terrain {
  readonly seed: number;
  readonly field: TerrainField;
  readonly grid: SdfGrid;
}

/** Builds the terrain from a seed. Every browser gets the same one; it takes about half a second. */
export function bakeTerrain(seed: number): Terrain {
  const field = createTerrainField(seed);
  return { seed, field, grid: bakeGrid(field) };
}
