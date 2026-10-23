import type { CellState } from '../../../src/shared/block-world';
import { MATERIAL, SHAPE, packState } from '../../../src/shared/blocks';
import { SparseCells } from '../../../src/shared/solid';
import type { NavWorld } from '../../../src/systems/survival/nav';
import { outpostFor, type Outpost } from '../../../src/world/outpost';

export const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
export const ALLOY = packState(SHAPE.cube, MATERIAL.alloy);

/** A flat plane with the Core on it and room for blocks, which is all the enemies' map needs. */
export interface FlatWorld {
  readonly world: NavWorld;
  readonly cells: SparseCells;
  readonly core: Outpost;
  /** Raises or lowers the plane under one point, for tests of slopes, cliffs and water. */
  readonly ground: { at(x: number, z: number): number };
  place(x: number, y: number, z: number, state?: CellState): void;
  remove(x: number, y: number, z: number): void;
}

export interface FlatOptions {
  /** The ground's height at a point; level at 10 by default. */
  height?: (x: number, z: number) => number;
  waterLevel?: number;
  half?: number;
}

export function flatWorld(options: FlatOptions = {}): FlatWorld {
  const height = options.height ?? (() => 10);
  const cells = new SparseCells();
  const core = outpostFor(height);
  const world: NavWorld = {
    solids: {
      isSolid: (x, y, z) => cells.isSolid(x, y, z) || core.contains(x, y, z),
    },
    blockAt: (x, y, z) => cells.get(x, y, z),
    surfaceAt: height,
    waterLevel: options.waterLevel ?? 0,
    half: options.half ?? 96,
  };
  return {
    world,
    cells,
    core,
    ground: { at: height },
    place: (x, y, z, state = SCRAP) => cells.set(x, y, z, state),
    remove: (x, y, z) => cells.set(x, y, z, 0),
  };
}
