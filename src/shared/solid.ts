/**
 * What the movement code asks of the world. Cell (x, y, z) is the unit cube that spans
 * [x, x + 1] × [y, y + 1] × [z, z + 1]; arguments are integers. Phase 2's voxel world will
 * implement this interface, and tests and the proving ground use `SparseCells`.
 */
export interface SolidQuery {
  isSolid(x: number, y: number, z: number): boolean;
}

const X_RANGE = 4096;
const Y_RANGE = 1024;
const X_MIN = -X_RANGE / 2;
const Y_MIN = -Y_RANGE / 2;

/** Packs a cell into one number for Map keys. Valid for -2048 <= x, z < 2048 and -512 <= y < 512. */
export function cellKey(x: number, y: number, z: number): number {
  return x - X_MIN + X_RANGE * (z - X_MIN + X_RANGE * (y - Y_MIN));
}

/** True when the cell can be packed by `cellKey` without colliding with another cell. */
export function cellInRange(x: number, y: number, z: number): boolean {
  return x >= X_MIN && x < -X_MIN && z >= X_MIN && z < -X_MIN && y >= Y_MIN && y < -Y_MIN;
}

/**
 * A sparse set of cells that each carry a small id (0 is empty). Ids are opaque here: a renderer
 * can use them to pick a tint or a material. Everything outside the packable range is empty.
 */
export class SparseCells implements SolidQuery {
  private readonly ids = new Map<number, number>();

  get size(): number {
    return this.ids.size;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return cellInRange(x, y, z) && this.ids.has(cellKey(x, y, z));
  }

  /** The id stored at a cell, or 0 when it is empty. */
  get(x: number, y: number, z: number): number {
    return cellInRange(x, y, z) ? (this.ids.get(cellKey(x, y, z)) ?? 0) : 0;
  }

  /** Stores an id (1 or more) at a cell; an id of 0 clears it. */
  set(x: number, y: number, z: number, id = 1): void {
    if (!cellInRange(x, y, z)) {
      throw new RangeError(`Cell (${x}, ${y}, ${z}) is outside the packable range`);
    }
    if (id === 0) this.ids.delete(cellKey(x, y, z));
    else this.ids.set(cellKey(x, y, z), id);
  }

  /** Fills every cell of the box with the given corners, both ends included. */
  fillBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id = 1): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, z, id);
      }
    }
  }

  /** Empties every cell of the box with the given corners, both ends included. */
  clearBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.fillBox(x0, y0, z0, x1, y1, z1, 0);
  }

  forEach(visit: (x: number, y: number, z: number, id: number) => void): void {
    for (const [key, id] of this.ids) {
      const x = (key % X_RANGE) + X_MIN;
      const rest = Math.floor(key / X_RANGE);
      const z = (rest % X_RANGE) + X_MIN;
      const y = Math.floor(rest / X_RANGE) + Y_MIN;
      visit(x, y, z, id);
    }
  }
}
