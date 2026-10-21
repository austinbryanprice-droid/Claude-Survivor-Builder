import type { GroundQuery } from '../shared/ground';
import { CRASH } from './terrain/field';

/**
 * Where the Outpost Core stands and what space it takes. The Core is the station's reactor at the
 * middle of the crash site: the thing the whole run is about, because the run ends when it falls.
 * It is not made of blocks. It is part of the valley, like the lake, so it is the same for every
 * peer without a byte on the wire: every world works the same cells out from the same seed's
 * ground. This module is only geometry (no three.js, no health); the host's simulation keeps its
 * health and the renderer draws it from these cells.
 */

/** The Core stands on a square of this many cells, and fills a box this many cells tall. */
export const CORE_FOOTPRINT = 3;
export const CORE_HEIGHT = 4;

/**
 * The Core is drawn with a foundation that reaches this far below its base, so it stands on a
 * slope without a gap on the low side. The foundation is only drawn: nothing there is solid.
 */
export const CORE_SKIRT = 1;

/** The ground is sampled this finely under the footprint to find where the Core must start. */
const GROUND_SAMPLES = 7;

export interface Outpost {
  /** The lowest cell column in x and z the Core occupies. */
  readonly cellX: number;
  readonly cellZ: number;
  /** The lowest cell row: the middle height of the ground under the footprint, rounded to a cell. */
  readonly baseY: number;
  /** The middle of the Core, in blocks. */
  readonly x: number;
  readonly z: number;
  /** True when the cell is inside the box the Core fills. */
  contains(x: number, y: number, z: number): boolean;
}

/**
 * The Core for a ground: at the middle of the crash site, with its base at the middle height of
 * the ground under it (the crater floor is not level: on the default seed it falls and rises about
 * a block under the Core). The ground then lies within about a block of the base on either side, so
 * a little of the plinth is buried where the ground is high, and where it is low the drawn
 * foundation (`CORE_SKIRT`) meets it.
 */
export function outpostFor(groundAt: (x: number, z: number) => number): Outpost {
  const half = (CORE_FOOTPRINT - 1) / 2;
  const cellX = Math.floor(CRASH.x) - half;
  const cellZ = Math.floor(CRASH.z) - half;
  let lowest = Infinity;
  let highest = -Infinity;
  for (let i = 0; i < GROUND_SAMPLES; i++) {
    for (let j = 0; j < GROUND_SAMPLES; j++) {
      const x = cellX + (CORE_FOOTPRINT * i) / (GROUND_SAMPLES - 1);
      const z = cellZ + (CORE_FOOTPRINT * j) / (GROUND_SAMPLES - 1);
      const ground = groundAt(x, z);
      lowest = Math.min(lowest, ground);
      highest = Math.max(highest, ground);
    }
  }
  const baseY = Math.round((lowest + highest) / 2);
  return {
    cellX,
    cellZ,
    baseY,
    x: cellX + CORE_FOOTPRINT / 2,
    z: cellZ + CORE_FOOTPRINT / 2,
    contains: (x, y, z) =>
      x >= cellX &&
      x < cellX + CORE_FOOTPRINT &&
      z >= cellZ &&
      z < cellZ + CORE_FOOTPRINT &&
      y >= baseY &&
      y < baseY + CORE_HEIGHT,
  };
}

/**
 * How far a point is from the box the Core fills: negative inside it, positive outside, and the
 * true distance to the nearest face, edge or corner. The terrain answers the same question for
 * the ground.
 */
export function outpostDistance(outpost: Outpost, x: number, y: number, z: number): number {
  const qx = Math.abs(x - outpost.x) - CORE_FOOTPRINT / 2;
  const qy = Math.abs(y - (outpost.baseY + CORE_HEIGHT / 2)) - CORE_HEIGHT / 2;
  const qz = Math.abs(z - outpost.z) - CORE_FOOTPRINT / 2;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  return outside + Math.min(Math.max(qx, qy, qz), 0);
}

/**
 * The ground with the Core standing in it, for whatever measures the open space around a point:
 * the cursor's ray stops at the Core and builds against its faces, and the third-person camera
 * keeps out of it. Bodies are pushed out of the terrain as before; the Core's cells are solid
 * cells, which the movement code already stops at.
 */
export function withOutpost(ground: GroundQuery, outpost: Outpost): GroundQuery {
  return {
    distance: (x, y, z) => Math.min(ground.distance(x, y, z), outpostDistance(outpost, x, y, z)),
    pushOut: (body, radius, heights) => ground.pushOut(body, radius, heights),
    snapDown: (body, radius, height, maxDrop) => ground.snapDown(body, radius, height, maxDrop),
  };
}
