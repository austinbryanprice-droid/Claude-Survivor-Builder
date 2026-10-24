import type { DebrisView } from '../../shared/economy';
import type { Vec3 } from '../../shared/look';
import { DEBRIS } from './balance';

/**
 * Which heap of debris the cursor is on. A heap is a ball (its middle a little above the ground,
 * its radius from the table and its size) and the cursor is a ray, so the answer is the nearest ball
 * the ray enters, within the player's reach of the eyes and in front of whatever block or hill the
 * view meets first. The host judges a strip by the same reach, so a heap that is aimed at here is one
 * it will let the player strip. Pure, so a test can aim.
 */

/** The answer of `aimAtDebris`. One object is reused, so read it before the next call. */
export interface DebrisAim {
  /** The heap's place in the run's list, or -1 when the cursor is on none a player could strip. */
  index: number;
  /** Strips it has left; 0 when `index` is -1. */
  left: number;
  /** How far along the view the cursor meets it, in blocks. */
  distance: number;
}

export function createDebrisAim(): DebrisAim {
  return { index: -1, left: 0, distance: 0 };
}

export interface DebrisAimInput {
  /** The heaps and what is left of each. */
  debris: Pick<DebrisView, 'nodes' | 'leftOf'>;
  /** Where the view starts, and the unit vector it looks along. In third person the view is behind the player. */
  origin: Vec3;
  dir: Vec3;
  /** The player's eyes: reach is measured from here, as the host measures it. */
  eye: Vec3;
  /** How far along the view (from where it starts level with the eyes) the first block or hill is, or `Infinity`. */
  blockedAt: number;
}

/** A heap this much nearer than the blocks the view meets still counts as in front of them. */
const FRONT_MARGIN = 0.05;

/** Aims: writes the heap the cursor is on (or none) into `out`, and says whether there is one. */
export function aimAtDebris(out: DebrisAim, input: DebrisAimInput): boolean {
  out.index = -1;
  out.left = 0;
  out.distance = 0;
  const { debris, origin, dir, eye } = input;
  const nodes = debris.nodes;
  if (nodes.length === 0) return false;

  // In third person the view sits behind the player; start the ray level with the eyes so that
  // what is behind the player can not be picked.
  const skip = Math.max(
    0,
    (eye.x - origin.x) * dir.x + (eye.y - origin.y) * dir.y + (eye.z - origin.z) * dir.z,
  );
  const sx = origin.x + dir.x * skip;
  const sy = origin.y + dir.y * skip;
  const sz = origin.z + dir.z * skip;
  const limit = input.blockedAt + FRONT_MARGIN;

  let nearest = Infinity;
  for (const node of nodes) {
    const left = debris.leftOf(node.index);
    if (left <= 0) continue;
    const cy = node.y + DEBRIS.lift;
    if (Math.hypot(node.x - eye.x, cy - eye.y, node.z - eye.z) > DEBRIS.reach) continue;
    const radius = DEBRIS.radius * node.scale;
    const ox = sx - node.x;
    const oy = sy - cy;
    const oz = sz - node.z;
    const along = ox * dir.x + oy * dir.y + oz * dir.z;
    const outside = ox * ox + oy * oy + oz * oz - radius * radius;
    // Starting outside the ball and looking away from it, the ray never meets it.
    if (outside > 0 && along > 0) continue;
    const gap = along * along - outside;
    if (gap < 0) continue;
    // Starting inside the ball, the cursor is on it from the first step.
    const t = Math.max(0, -along - Math.sqrt(gap));
    if (t > limit || t >= nearest) continue;
    nearest = t;
    out.index = node.index;
    out.left = left;
    out.distance = t;
  }
  return out.index >= 0;
}
