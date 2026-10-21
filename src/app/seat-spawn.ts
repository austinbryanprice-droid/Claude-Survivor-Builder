import { rightVector } from '../shared/look';
import { PLAYER } from '../shared/movement';
import type { SolidQuery } from '../shared/solid';

/**
 * Where a seat starts: beside the world's spawn point, one step further along for each seat, on
 * the ground, and above anything players have built there so a late joiner never starts inside
 * a wall.
 */

/** Sideways distance from the spawn point for seats 0 to 3, in blocks (to the right of the way the spawn faces). */
const SEAT_OFFSETS = [0, 1.8, -1.8, 3.6] as const;
/** The feet start this far above the surface and settle onto it. */
const LIFT = 0.05;
/** How many cells above the ground to look for room to stand before settling for the ground. */
const MAX_CLIMB = 48;
/** Cells the body needs free above its feet. */
const BODY_CELLS = Math.ceil(PLAYER.height) + 1;

export interface SeatWorld {
  readonly spawn: { readonly x: number; readonly z: number; readonly yaw: number };
  groundAt(x: number, z: number): number;
}

const scratch = { x: 0, y: 0, z: 0 };

export function seatSpawn(
  world: SeatWorld,
  solid: SolidQuery,
  slot: number,
): { x: number; y: number; z: number } {
  const right = rightVector(world.spawn.yaw, scratch);
  const offset = SEAT_OFFSETS[slot] ?? 0;
  const x = world.spawn.x + right.x * offset;
  const z = world.spawn.z + right.z * offset;
  const ground = world.groundAt(x, z);
  const cellX = Math.floor(x);
  const cellZ = Math.floor(z);
  const base = Math.floor(ground);

  const free = (from: number): boolean => {
    for (let i = 0; i < BODY_CELLS; i++) if (solid.isSolid(cellX, from + i, cellZ)) return false;
    return true;
  };
  let climb = 0;
  while (climb < MAX_CLIMB && !free(base + climb)) climb++;
  // Standing on the ground itself, the feet sit at its exact (smooth) height; on top of blocks, on a cell edge.
  return { x, y: (climb === 0 ? ground : base + climb) + LIFT, z };
}
