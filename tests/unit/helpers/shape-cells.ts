import { SHAPE } from '../../../src/shared/blocks';
import { shapeBoxes, type CellBox } from '../../../src/shared/shapes';
import { SparseCells } from '../../../src/shared/solid';

/** Sparse cells whose ids are shape ids, so a cell can hold a slab or a wedge as well as a cube. */
export class ShapeCells extends SparseCells {
  boxesAt(x: number, y: number, z: number): readonly CellBox[] | null {
    return shapeBoxes(this.get(x, y, z));
  }

  /** Fills every cell of the box with the shape. */
  fillShape(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    shape: number = SHAPE.cube,
  ): void {
    this.fillBox(x0, y0, z0, x1, y1, z1, shape);
  }
}

/** A flat floor of cubes whose top is at y = 0, with room for shapes above it. */
export function shapeFloor(): ShapeCells {
  const world = new ShapeCells();
  world.fillShape(-32, -1, -32, 31, -1, 31);
  return world;
}
