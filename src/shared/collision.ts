import type { SolidQuery } from './solid';

/** Gap left between a box and the face it stopped against, so rounding never leaves them overlapping. */
export const SKIN = 1e-4;

/** How far past a face a box may already sit before that face counts as behind it. */
const BEHIND = 1e-5;

/** Overlap smaller than this does not count, so rounding noise cannot make a box touch its neighbor's cell. */
const TOUCH = 1e-6;

/** An axis-aligned box that stands on its bottom center: x ± halfWidth, y to y + height, z ± halfWidth. */
export interface Body {
  x: number;
  y: number;
  z: number;
  halfWidth: number;
  height: number;
}

/** Which axes were blocked by the last move. */
export interface Contacts {
  x: boolean;
  y: boolean;
  z: boolean;
}

export function createContacts(): Contacts {
  return { x: false, y: false, z: false };
}

type Axis = 0 | 1 | 2;

// The two axes across a sweep along each axis, in cyclic order (x -> y -> z -> x).
const ACROSS_A = [1, 2, 0] as const;
const ACROSS_B = [2, 0, 1] as const;

const lo: [number, number, number] = [0, 0, 0];
const hi: [number, number, number] = [0, 0, 0];

function readExtents(body: Body): void {
  lo[0] = body.x - body.halfWidth;
  hi[0] = body.x + body.halfWidth;
  lo[1] = body.y;
  hi[1] = body.y + body.height;
  lo[2] = body.z - body.halfWidth;
  hi[2] = body.z + body.halfWidth;
}

/** Asks about the cell at `index` along `axis`, where `a` and `b` index the two other axes in cyclic order. */
function cellSolid(world: SolidQuery, axis: Axis, index: number, a: number, b: number): boolean {
  if (axis === 0) return world.isSolid(index, a, b);
  if (axis === 1) return world.isSolid(b, index, a);
  return world.isSolid(a, b, index);
}

function layerSolid(
  world: SolidQuery,
  axis: Axis,
  index: number,
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): boolean {
  for (let a = a0; a <= a1; a++) {
    for (let b = b0; b <= b1; b++) {
      if (cellSolid(world, axis, index, a, b)) return true;
    }
  }
  return false;
}

function shift(body: Body, axis: Axis, amount: number): void {
  if (axis === 0) body.x += amount;
  else if (axis === 1) body.y += amount;
  else body.z += amount;
}

/**
 * Slides the body along one axis until it would enter a solid cell. Every cell between the start
 * and the end of the move is checked, so a fast body cannot tunnel through a thin wall. Cells the
 * body already overlaps are ignored for that axis, which lets a body that starts inside a block
 * walk out of it. Returns true when something stopped the body short.
 */
function sweep(body: Body, axis: Axis, delta: number, world: SolidQuery): boolean {
  if (delta === 0 || !Number.isFinite(delta)) return false;
  readExtents(body);
  const a = ACROSS_A[axis];
  const b = ACROSS_B[axis];
  const a0 = Math.floor(lo[a] + TOUCH);
  const a1 = Math.ceil(hi[a] - TOUCH) - 1;
  const b0 = Math.floor(lo[b] + TOUCH);
  const b1 = Math.ceil(hi[b] - TOUCH) - 1;

  let moved = delta;
  let blocked = false;
  if (delta > 0) {
    const edge = hi[axis];
    const last = Math.floor(edge + delta);
    // `plane` is the coordinate of a cell's near face, which is also that cell's index.
    for (let plane = Math.ceil(edge - BEHIND); plane <= last; plane++) {
      if (layerSolid(world, axis, plane, a0, a1, b0, b1)) {
        moved = Math.max(0, plane - edge - SKIN);
        blocked = true;
        break;
      }
    }
  } else {
    const edge = lo[axis];
    const last = Math.ceil(edge + delta);
    // `plane` is the coordinate of a cell's near face; that cell's index is one lower.
    for (let plane = Math.floor(edge + BEHIND); plane >= last; plane--) {
      if (layerSolid(world, axis, plane - 1, a0, a1, b0, b1)) {
        moved = Math.min(0, plane - edge + SKIN);
        blocked = true;
        break;
      }
    }
  }
  shift(body, axis, moved);
  return blocked;
}

/**
 * Moves the body by (dx, dy, dz), stopping at solid cells and sliding along them. Vertical motion
 * resolves first so ground contact is settled before sideways motion, then the longer horizontal
 * component, which makes sliding along a wall feel the same in both directions.
 */
export function moveBody(
  body: Body,
  dx: number,
  dy: number,
  dz: number,
  world: SolidQuery,
  contacts: Contacts,
): void {
  contacts.y = sweep(body, 1, dy, world);
  if (Math.abs(dx) >= Math.abs(dz)) {
    contacts.x = sweep(body, 0, dx, world);
    contacts.z = sweep(body, 2, dz, world);
  } else {
    contacts.z = sweep(body, 2, dz, world);
    contacts.x = sweep(body, 0, dx, world);
  }
}

/** True when the body's interior overlaps a solid cell. Boxes that only touch do not overlap. */
export function overlapsSolid(body: Body, world: SolidQuery): boolean {
  readExtents(body);
  const x1 = Math.ceil(hi[0] - TOUCH) - 1;
  const y1 = Math.ceil(hi[1] - TOUCH) - 1;
  const z1 = Math.ceil(hi[2] - TOUCH) - 1;
  for (let y = Math.floor(lo[1] + TOUCH); y <= y1; y++) {
    for (let z = Math.floor(lo[2] + TOUCH); z <= z1; z++) {
      for (let x = Math.floor(lo[0] + TOUCH); x <= x1; x++) {
        if (world.isSolid(x, y, z)) return true;
      }
    }
  }
  return false;
}
