import { PLAYER } from './movement';

/**
 * Power works by radius (SPEC section 9: optional synergies, "do not require a full simulation"; no
 * wiring, nothing to lay out): a module that gives something off gives it to whatever is within so many
 * blocks of the middle of its cell. The host's simulation, which works out who is charged, and the
 * screen, which draws where the reach ends, both ask the functions here, so a ring on the ground is
 * exactly where Energy comes back.
 */

/**
 * How far a player whose feet are at (x, y, z) is from the middle of the cell (cx, cy, cz), in blocks,
 * measured to the middle of their body: a player on a hill above a module is farther from it than one
 * on the level, as the Core's field measures it.
 */
export function reachDistance(
  cx: number,
  cy: number,
  cz: number,
  x: number,
  y: number,
  z: number,
): number {
  return Math.hypot(x - (cx + 0.5), y + PLAYER.height / 2 - (cy + 0.5), z - (cz + 0.5));
}

/** True when a player whose feet are at (x, y, z) is within `radius` blocks of the middle of the cell (cx, cy, cz). */
export function inReach(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  x: number,
  y: number,
  z: number,
): boolean {
  const dx = x - (cx + 0.5);
  const dy = y + PLAYER.height / 2 - (cy + 0.5);
  const dz = z - (cz + 0.5);
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

/** How finely `reachEdge` narrows its search: the edge is found to within this fraction of the radius. */
const EDGE_PRECISION = 1 / 4096;

/**
 * How far out from the middle of the cell (cx, cy, cz), level, the reach of `radius` ends along a
 * bearing, for a player who walks on the ground: the reach is a ball and not a column, so ground that
 * rises or falls from the level of the cell pulls the edge in. `dirX` and `dirZ` are the bearing, a
 * unit vector on the level; `groundAt` says where the ground is under a point. The edge is found by
 * halving the span between the cell's column and the radius, so it is a place where the ground goes
 * out of reach, and 0 when even beside the cell the ground is too far from it (the cell hangs in the
 * air). This is how the ring on the ground that shows a reach is drawn, so it is where Energy stops.
 */
export function reachEdge(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  dirX: number,
  dirZ: number,
  groundAt: (x: number, z: number) => number,
): number {
  const mx = cx + 0.5;
  const mz = cz + 0.5;
  const within = (out: number): boolean => {
    const x = mx + dirX * out;
    const z = mz + dirZ * out;
    return inReach(cx, cy, cz, radius, x, groundAt(x, z), z);
  };
  if (!within(0)) return 0;
  if (within(radius)) return radius;
  let near = 0;
  let far = radius;
  while (far - near > radius * EDGE_PRECISION) {
    const middle = (near + far) / 2;
    if (within(middle)) near = middle;
    else far = middle;
  }
  return near;
}
