import type { BlockWorld, CellState } from './block-world';
import type { GroundQuery } from './ground';
import type { Vec3 } from './look';
import { PLAYER } from './movement';
import { castRay, createRayHit, type RayHit } from './raycast';

/**
 * What a click would do where the cursor points. `updateAim` turns a ray into the block under the
 * cursor (a click breaks it), the cell a new block would take (a click places one) and, for each,
 * the reason it is refused. The rules are the host's, so a click that passes here passes there:
 * reach from the eyes, then the world's own rules, then nobody standing in the cell.
 */

/** How far from the player's eyes a block can be placed or broken, in blocks. */
export const BUILD_REACH = 6;
/** The cursor looks this much farther than a click reaches, so a target just out of reach shows as that. */
export const AIM_EXTRA = 2;
/** The player's body is treated as this much bigger when asking whether a block would trap it. */
export const BODY_MARGIN = 0.05;

/** Why a click is refused here, apart from the world's own reasons (`BlockWorld.checkPlace`). */
export const AIM_REFUSAL = {
  outOfReach: 'out-of-reach',
  inTheWay: 'in-the-way',
} as const;

export interface Cell {
  x: number;
  y: number;
  z: number;
}

/** The answer of `updateAim`. One object is reused, so read it before the next call. */
export interface Aim {
  /** What the cursor is on: nothing in range, a player-made block, or the terrain. */
  on: 'nothing' | 'block' | 'terrain';
  /** The block under the cursor; meaningful when `on` is 'block'. */
  target: Cell;
  /** Why a click would not break `target`; null when it would. Meaningful when `on` is 'block'. */
  breakRefusal: string | null;
  /** True when there is a cell a new block would take (a piece is selected and the cursor is on something). */
  hasPlace: boolean;
  /** The cell a new block would take; meaningful when `hasPlace`. */
  place: Cell;
  /** Why a click would not place the piece there; null when it would. Meaningful when `hasPlace`. */
  placeRefusal: string | null;
  /** How far the cursor's hit is from the eyes, in blocks. Meaningful when `on` is not 'nothing'. */
  distance: number;
}

export function createAim(): Aim {
  return {
    on: 'nothing',
    target: { x: 0, y: 0, z: 0 },
    breakRefusal: null,
    hasPlace: false,
    place: { x: 0, y: 0, z: 0 },
    placeRefusal: null,
    distance: 0,
  };
}

export interface AimInput {
  /** The blocks, and the rules for changing them. */
  blocks: Pick<BlockWorld, 'getBlock' | 'checkPlace' | 'checkBreak'>;
  ground?: Pick<GroundQuery, 'distance'>;
  /** Where the view starts, and the unit vector it looks along. In third person the view is behind the player. */
  origin: Vec3;
  dir: Vec3;
  /** The player's eyes: reach is measured from here, as the host measures it. */
  eye: Vec3;
  /** The piece a click would place, or 0 when the selected item is not a block. */
  piece: CellState;
  /** The feet of every player who could be standing where a block goes, the local one included. */
  bodies: readonly Vec3[];
  reach?: number;
}

const hit: RayHit = createRayHit();
const start: Vec3 = { x: 0, y: 0, z: 0 };

/** Whether a player standing with their feet at `body` touches the cell (x, y, z), with a small margin. */
export function bodyOverlapsCell(body: Vec3, x: number, y: number, z: number): boolean {
  const half = PLAYER.halfWidth + BODY_MARGIN;
  return (
    body.x + half > x &&
    body.x - half < x + 1 &&
    body.y + PLAYER.height + BODY_MARGIN > y &&
    body.y - BODY_MARGIN < y + 1 &&
    body.z + half > z &&
    body.z - half < z + 1
  );
}

/** How far the eyes are from the middle of a cell. */
function distanceToCell(eye: Vec3, x: number, y: number, z: number): number {
  return Math.hypot(x + 0.5 - eye.x, y + 0.5 - eye.y, z + 0.5 - eye.z);
}

/** Aims: writes what the cursor is on, and what a click would do there, into `aim`. */
export function updateAim(aim: Aim, input: AimInput): void {
  const { blocks, eye, piece, bodies } = input;
  const reach = input.reach ?? BUILD_REACH;
  aim.on = 'nothing';
  aim.breakRefusal = null;
  aim.hasPlace = false;
  aim.placeRefusal = null;
  aim.distance = 0;

  // In third person the view sits behind the player; start the ray level with the eyes so that
  // what is between the camera and the player can be neither hit nor placed on.
  const { origin, dir } = input;
  const skip = Math.max(
    0,
    (eye.x - origin.x) * dir.x + (eye.y - origin.y) * dir.y + (eye.z - origin.z) * dir.z,
  );
  start.x = origin.x + dir.x * skip;
  start.y = origin.y + dir.y * skip;
  start.z = origin.z + dir.z * skip;
  if (!castRay({ blocks, ground: input.ground }, start, dir, reach + AIM_EXTRA, hit)) return;

  let placeX = hit.x;
  let placeY = hit.y;
  let placeZ = hit.z;
  if (hit.kind === 'block') {
    aim.on = 'block';
    aim.target.x = hit.x;
    aim.target.y = hit.y;
    aim.target.z = hit.z;
    aim.breakRefusal =
      distanceToCell(eye, hit.x, hit.y, hit.z) > reach
        ? AIM_REFUSAL.outOfReach
        : blocks.checkBreak(hit.x, hit.y, hit.z);
    placeX += hit.nx;
    placeY += hit.ny;
    placeZ += hit.nz;
  } else {
    aim.on = 'terrain';
  }
  aim.distance = Math.hypot(
    start.x + dir.x * hit.distance - eye.x,
    start.y + dir.y * hit.distance - eye.y,
    start.z + dir.z * hit.distance - eye.z,
  );

  if (piece === 0) return;
  aim.hasPlace = true;
  aim.place.x = placeX;
  aim.place.y = placeY;
  aim.place.z = placeZ;
  if (distanceToCell(eye, placeX, placeY, placeZ) > reach) {
    aim.placeRefusal = AIM_REFUSAL.outOfReach;
    return;
  }
  const refusal = blocks.checkPlace(placeX, placeY, placeZ, piece);
  if (refusal) {
    aim.placeRefusal = refusal;
    return;
  }
  for (const body of bodies) {
    if (bodyOverlapsCell(body, placeX, placeY, placeZ)) {
      aim.placeRefusal = AIM_REFUSAL.inTheWay;
      return;
    }
  }
}
