import { MODULE, moduleDef, moduleFacing, moduleOfShape, stateShape } from '../shared/blocks';
import type { Vec3 } from '../shared/look';
import { PLAYER } from '../shared/movement';
import type { SolidQuery } from '../shared/solid';
import type { ModuleSource } from '../systems/survival/turrets';
import { SEAT_LIFT, standingAt, type GroundHeight } from './seat-spawn';

/**
 * Where a Bed puts a player back (SPEC section 9, "Bed / respawn point"). When the Core brings a
 * player back, the standing Bed nearest to where they fell is their spawn: they step out of it onto
 * the ground in front of it, or beside or behind it where that is walled in or too far off its level,
 * or stand on it when it has no room round it. A Bed with no room at all is passed over for the next
 * nearest, and where none has room the base's seat is the spawn as it was.
 */

/**
 * The cell next to a module that faces 0 to 3, as a step from its own: ahead of it is +x, +z, -x or
 * -z, the four ways a module can face.
 */
const AHEAD = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

/** The steps to try round a Bed, as quarter turns from the way it faces: in front, to either side, behind. */
const TURNS = [0, 1, 3, 2] as const;

/** The lowest the feet may stand under the floor of the Bed's cell: ground that falls away from it, but not the ground under a floor. */
const STEP_DOWN = 1.5;
/** The highest the feet may stand over the floor of the Bed's cell: a slope up from it, but not the top of a wall, which is a block higher. */
const STEP_UP = 0.9;

interface BedSite {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: number;
  /** How far the middle of its cell is from where the player fell, squared. */
  readonly d2: number;
}

/** How high the Bed rises in its cell, which is where a player on top of it stands. */
const BED_TOP = moduleDef(MODULE.bed)?.body[4] ?? 0.5;

/** The ground beside a Bed that a player can be put on, in the order to try, or null where it is all walled in or off its level. */
function besideBed(bed: BedSite, world: GroundHeight, solid: SolidQuery): Vec3 | null {
  for (const turn of TURNS) {
    const [dx, dz] = AHEAD[(bed.facing + turn) & 3] as readonly [number, number];
    const spot = standingAt(world, solid, bed.x + 0.5 + dx, bed.z + 0.5 + dz);
    const rise = spot.y - bed.y;
    if (rise >= -STEP_DOWN && rise <= STEP_UP) return spot;
  }
  return null;
}

/** The top of the Bed, if the ground has not swallowed it and there is room for a body above it. */
function onBed(bed: BedSite, world: GroundHeight, solid: SolidQuery): Vec3 | null {
  const x = bed.x + 0.5;
  const z = bed.z + 0.5;
  const y = bed.y + BED_TOP + SEAT_LIFT;
  if (world.groundAt(x, z) > y) return null;
  const head = Math.floor(y + PLAYER.height);
  for (let cell = bed.y + 1; cell <= head; cell++)
    if (solid.isSolid(bed.x, cell, bed.z)) return null;
  return { x, y, z };
}

/**
 * Where a player who fell at `near` is put back by a Bed: the feet's place at the nearest standing Bed
 * that has room, or null when no Bed stands or none has room. `beds` is the walk over the world's
 * modules; Beds are found among them.
 */
export function bedSpawn(
  beds: ModuleSource,
  world: GroundHeight,
  solid: SolidQuery,
  near: Vec3,
): Vec3 | null {
  const found: BedSite[] = [];
  beds((site) => {
    const shape = stateShape(site.state);
    if (moduleOfShape(shape)?.id !== MODULE.bed) return;
    const dx = site.x + 0.5 - near.x;
    const dy = site.y + 0.5 - near.y;
    const dz = site.z + 0.5 - near.z;
    found.push({
      x: site.x,
      y: site.y,
      z: site.z,
      facing: moduleFacing(shape),
      d2: dx * dx + dy * dy + dz * dz,
    });
  });
  // The walk is in no order, and two Beds as near as each other are told apart by their cells.
  found.sort((a, b) => a.d2 - b.d2 || a.y - b.y || a.z - b.z || a.x - b.x);
  for (const bed of found) {
    const spot = besideBed(bed, world, solid) ?? onBed(bed, world, solid);
    if (spot) return spot;
  }
  return null;
}
