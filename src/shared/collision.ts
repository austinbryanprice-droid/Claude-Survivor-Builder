import type { SolidQuery } from './solid';

/** Gap left between a box and the face it stopped against, so rounding never leaves them overlapping. */
export const SKIN = 1e-4;

/** How far past a face a box may already sit before that face counts as behind it. */
const BEHIND = 1e-5;

/** Overlap smaller than this does not count, so rounding noise cannot make a box touch its neighbor's cell. */
const TOUCH = 1e-6;

/** A climb has to get the body this much further than the plain slide to be taken, so noise never triggers one. */
const CLIMB_GAIN = 1e-6;

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

/** The cell at `index` along `axis`, where `a` and `b` index the two other axes in cyclic order. */
function cellCoords(
  axis: Axis,
  index: number,
  a: number,
  b: number,
): readonly [number, number, number] {
  if (axis === 0) return [index, a, b];
  if (axis === 1) return [b, index, a];
  return [a, b, index];
}

/** The part of a body's extents across a sweep that decides which cells and boxes it can meet. */
interface Across {
  readonly axisA: number;
  readonly axisB: number;
  readonly lowA: number;
  readonly highA: number;
  readonly lowB: number;
  readonly highB: number;
  readonly a0: number;
  readonly a1: number;
  readonly b0: number;
  readonly b1: number;
}

const across: { -readonly [K in keyof Across]: Across[K] } = {
  axisA: 0,
  axisB: 0,
  lowA: 0,
  highA: 0,
  lowB: 0,
  highB: 0,
  a0: 0,
  a1: 0,
  b0: 0,
  b1: 0,
};

/**
 * The nearest face a body sweeping forward would meet in one layer of cells (the cells at `index`
 * along the sweep axis), among faces that are not already behind its leading edge. Going up an
 * axis that is the lowest `min` of any box; going down it is the highest `max`. A whole cube has
 * its faces on the cell's boundary; a slab or a wedge has boxes inside the cell. Returns
 * Infinity (or -Infinity going down) when the layer holds nothing in the way.
 */
function nearestFace(
  world: SolidQuery,
  axis: Axis,
  index: number,
  forward: boolean,
  limit: number,
): number {
  const { axisA, axisB, lowA, highA, lowB, highB, a0, a1, b0, b1 } = across;
  let best = forward ? Infinity : -Infinity;
  for (let a = a0; a <= a1; a++) {
    for (let b = b0; b <= b1; b++) {
      const [x, y, z] = cellCoords(axis, index, a, b);
      if (!world.isSolid(x, y, z)) continue;
      const boxes = world.boxesAt?.(x, y, z);
      if (!boxes) {
        // A whole cube: its near face is the cell's own boundary.
        if (forward) {
          if (index >= limit && index < best) best = index;
        } else if (index + 1 <= limit && index + 1 > best) {
          best = index + 1;
        }
        continue;
      }
      for (const box of boxes) {
        // Does the box overlap the body across the sweep? Touching does not count.
        if (a + (box[axisA] as number) >= highA - TOUCH) continue;
        if (a + (box[axisA + 3] as number) <= lowA + TOUCH) continue;
        if (b + (box[axisB] as number) >= highB - TOUCH) continue;
        if (b + (box[axisB + 3] as number) <= lowB + TOUCH) continue;
        if (forward) {
          const near = index + (box[axis] as number);
          if (near >= limit && near < best) best = near;
        } else {
          const far = index + (box[axis + 3] as number);
          if (far <= limit && far > best) best = far;
        }
      }
    }
  }
  return best;
}

function shift(body: Body, axis: Axis, amount: number): void {
  if (axis === 0) body.x += amount;
  else if (axis === 1) body.y += amount;
  else body.z += amount;
}

/**
 * Slides the body along one axis until it would enter something solid. Every cell between the
 * start and the end of the move is checked, so a fast body cannot tunnel through a thin wall.
 * Faces the body already sits past are ignored for that axis, which lets a body that starts inside
 * a block walk out of it. Returns true when something stopped the body short.
 */
function sweep(body: Body, axis: Axis, delta: number, world: SolidQuery): boolean {
  if (delta === 0 || !Number.isFinite(delta)) return false;
  readExtents(body);
  const a = ACROSS_A[axis];
  const b = ACROSS_B[axis];
  across.axisA = a;
  across.axisB = b;
  across.lowA = lo[a] as number;
  across.highA = hi[a] as number;
  across.lowB = lo[b] as number;
  across.highB = hi[b] as number;
  across.a0 = Math.floor(across.lowA + TOUCH);
  across.a1 = Math.ceil(across.highA - TOUCH) - 1;
  across.b0 = Math.floor(across.lowB + TOUCH);
  across.b1 = Math.ceil(across.highB - TOUCH) - 1;

  let moved = delta;
  let blocked = false;
  if (delta > 0) {
    const edge = hi[axis] as number;
    const first = Math.floor(edge - BEHIND);
    const last = Math.floor(edge + delta);
    for (let layer = first; layer <= last; layer++) {
      const near = nearestFace(world, axis, layer, true, edge - BEHIND);
      if (near <= edge + delta) {
        moved = Math.max(0, near - edge - SKIN);
        blocked = true;
        break;
      }
    }
  } else {
    const edge = lo[axis] as number;
    const first = Math.ceil(edge + BEHIND) - 1;
    const last = Math.ceil(edge + delta) - 1;
    for (let layer = first; layer >= last; layer--) {
      const far = nearestFace(world, axis, layer, false, edge + BEHIND);
      if (far >= edge + delta) {
        moved = Math.min(0, far - edge + SKIN);
        blocked = true;
        break;
      }
    }
  }
  shift(body, axis, moved);
  return blocked;
}

/** The two horizontal sweeps, the longer component first, which makes sliding along a wall feel the same in both directions. */
function slide(body: Body, dx: number, dz: number, world: SolidQuery, contacts: Contacts): void {
  if (Math.abs(dx) >= Math.abs(dz)) {
    contacts.x = sweep(body, 0, dx, world);
    contacts.z = sweep(body, 2, dz, world);
  } else {
    contacts.z = sweep(body, 2, dz, world);
    contacts.x = sweep(body, 0, dx, world);
  }
}

/**
 * Moves the body by (dx, dy, dz), stopping at solid cells and sliding along them. Vertical motion
 * resolves first so ground contact is settled before sideways motion.
 *
 * A body that stands on something passes `stepHeight`, how high a ledge it may walk up. When a
 * sideways move is blocked, the body is lifted by up to that much, tries the move again and comes
 * back down onto whatever is there; if that gets it further than the plain slide it takes the
 * climb. This is what lets a player walk up a slab or a ramp of wedges without jumping, while a
 * whole block (one high) still stops them.
 */
export function moveBody(
  body: Body,
  dx: number,
  dy: number,
  dz: number,
  world: SolidQuery,
  contacts: Contacts,
  stepHeight = 0,
): void {
  contacts.y = sweep(body, 1, dy, world);
  const x0 = body.x;
  const y0 = body.y;
  const z0 = body.z;
  slide(body, dx, dz, world, contacts);
  if (stepHeight <= 0 || (!contacts.x && !contacts.z)) return;

  const slidX = body.x;
  const slidZ = body.z;
  const blockedX = contacts.x;
  const blockedZ = contacts.z;
  body.x = x0;
  body.z = z0;
  sweep(body, 1, stepHeight, world);
  const lift = body.y - y0;
  if (lift > 0) {
    slide(body, dx, dz, world, contacts);
    const gained = Math.hypot(body.x - x0, body.z - z0) - Math.hypot(slidX - x0, slidZ - z0);
    if (gained > CLIMB_GAIN) {
      if (sweep(body, 1, -lift, world)) contacts.y = true;
      return;
    }
  }
  // The climb got no further than the slide did: keep the slide.
  body.x = slidX;
  body.y = y0;
  body.z = slidZ;
  contacts.x = blockedX;
  contacts.z = blockedZ;
}

/**
 * Sets a body that hovers just above something solid back on it, for walking down a slope of
 * cells without falling in little steps. Returns true when a floor lies within `maxDrop` below the
 * feet; the body is moved onto it only then.
 */
export function snapToFloor(body: Body, maxDrop: number, world: SolidQuery): boolean {
  const y = body.y;
  if (sweep(body, 1, -maxDrop, world)) return true;
  body.y = y;
  return false;
}

/** True when the body's interior overlaps something solid: a whole cell, or the part of a cell a slab or wedge fills. Boxes that only touch do not overlap. */
export function overlapsSolid(body: Body, world: SolidQuery): boolean {
  readExtents(body);
  const x1 = Math.ceil(hi[0] - TOUCH) - 1;
  const y1 = Math.ceil(hi[1] - TOUCH) - 1;
  const z1 = Math.ceil(hi[2] - TOUCH) - 1;
  for (let y = Math.floor(lo[1] + TOUCH); y <= y1; y++) {
    for (let z = Math.floor(lo[2] + TOUCH); z <= z1; z++) {
      for (let x = Math.floor(lo[0] + TOUCH); x <= x1; x++) {
        if (!world.isSolid(x, y, z)) continue;
        const boxes = world.boxesAt?.(x, y, z);
        if (!boxes) return true;
        for (const box of boxes) {
          if (
            lo[0] + TOUCH < x + (box[3] as number) &&
            hi[0] - TOUCH > x + (box[0] as number) &&
            lo[1] + TOUCH < y + (box[4] as number) &&
            hi[1] - TOUCH > y + (box[1] as number) &&
            lo[2] + TOUCH < z + (box[5] as number) &&
            hi[2] - TOUCH > z + (box[2] as number)
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}
