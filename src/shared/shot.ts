import type { EnemyPose } from './enemy-state';
import { lookDirection, rightVector, type Vec3 } from './look';
import { castRay, createRayHit, type RayWorld } from './raycast';

/**
 * What a shot of the pulse blaster is: a bolt that flies in a straight line from the player's
 * camera, stops at the first block, hill or Core in its way, and hurts the first machine it meets
 * before that. It is pure geometry (no DOM, no three.js), so the host that decides a shot and the
 * screen that draws it before the host has answered work it out the same way.
 */

/** The bits of a shot's `flags`, as the host reports what happened to it. */
export const SHOT_FLAG = {
  /** It struck a machine, which is named beside it. */
  enemy: 1,
  /** ...and the blow felled it. */
  kill: 2,
  /** A block, the ground or the Core stopped it. Without this or `enemy` it flew its whole range. */
  world: 4,
} as const;

/** Every flag the wire knows; the rest of the bits are dropped. */
export const SHOT_FLAGS_MASK = SHOT_FLAG.enemy | SHOT_FLAG.kill | SHOT_FLAG.world;

/** What the host says about one shot, to everyone in the room. */
export interface ShotEvent {
  /** Who fired it. */
  readonly by: number;
  /** Where the bolt ended, in blocks. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** `SHOT_FLAG` bits. */
  readonly flags: number;
  /** The machine it struck, or 0. */
  readonly enemy: number;
}

/** A box a machine presents to a bolt: square, standing on its feet. */
export interface Hitbox {
  readonly halfWidth: number;
  readonly height: number;
}

/** How a bolt ended. One object is reused between calls, so read it before the next `traceShot`. */
export interface ShotTrace {
  /** How far the bolt flew, in blocks. */
  distance: number;
  /** `SHOT_FLAG.enemy` or `SHOT_FLAG.world` or 0, by what ended it. */
  flags: number;
  /** Which of the bodies it struck, or -1. */
  index: number;
}

export function createShotTrace(): ShotTrace {
  return { distance: 0, flags: 0, index: -1 };
}

/** A ray this close to level with a pair of faces is taken to run along them. */
const PARALLEL = 1e-9;

/**
 * How far along the ray from (ox, oy, oz) along the unit vector (dx, dy, dz) it first meets the
 * box standing on (bx, by, bz) that is `halfWidth` either way and `height` tall, or -1 when it does
 * not within `limit`. A ray that starts inside the box meets it at 0.
 */
export function rayHitsBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  bx: number,
  by: number,
  bz: number,
  halfWidth: number,
  height: number,
  limit: number,
): number {
  let enter = 0;
  let exit = limit;
  // One slab per axis: the ray is in the box between the last slab it enters and the first it leaves.
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const low = axis === 0 ? bx - halfWidth : axis === 1 ? by : bz - halfWidth;
    const high = axis === 0 ? bx + halfWidth : axis === 1 ? by + height : bz + halfWidth;
    if (Math.abs(d) < PARALLEL) {
      // Level with this pair of faces: inside both for good, or outside one for good.
      if (o < low || o > high) return -1;
      continue;
    }
    const a = (low - o) / d;
    const b = (high - o) / d;
    const near = a < b ? a : b;
    const far = a < b ? b : a;
    if (near > enter) enter = near;
    if (far < exit) exit = far;
    if (enter > exit) return -1;
  }
  return enter;
}

const scratchHit = createRayHit();

/**
 * Flies a bolt from `origin` along the unit vector `dir`, up to `range` blocks, and writes how it
 * ended into `out`. It is stopped by what `world` holds (the blocks players built, the ground, the
 * Core) and hurts the nearest of the first `count` of `bodies` it meets before that. A machine for
 * which `alive` says no, or whose kind `hitboxOf` does not know, is not there to be hit.
 */
export function traceShot(
  world: RayWorld | null,
  origin: Vec3,
  dir: Vec3,
  range: number,
  bodies: readonly EnemyPose[],
  count: number,
  hitboxOf: (kind: number) => Hitbox | undefined,
  alive: ((id: number) => boolean) | null,
  out: ShotTrace,
): ShotTrace {
  const blocked = world !== null && castRay(world, origin, dir, range, scratchHit);
  let limit = blocked ? scratchHit.distance : range;
  let index = -1;
  const n = Math.min(count, bodies.length);
  for (let i = 0; i < n; i++) {
    const body = bodies[i] as EnemyPose;
    const box = hitboxOf(body.kind);
    if (!box || (alive && !alive(body.id))) continue;
    const t = rayHitsBox(
      origin.x,
      origin.y,
      origin.z,
      dir.x,
      dir.y,
      dir.z,
      body.x,
      body.y,
      body.z,
      box.halfWidth,
      box.height,
      limit,
    );
    if (t >= 0) {
      limit = t;
      index = i;
    }
  }
  out.distance = limit;
  out.index = index;
  out.flags = index >= 0 ? SHOT_FLAG.enemy : blocked ? SHOT_FLAG.world : 0;
  return out;
}

/** How far ahead, to the right and below the eyes the muzzle of the blaster is held. */
const MUZZLE = { ahead: 0.55, right: 0.24, below: 0.2 } as const;

const forward: Vec3 = { x: 0, y: 0, z: 0 };
const side: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Where the bolt leaves the gun for a player whose eyes are at (x, y, z) and who looks along `yaw`
 * and `pitch`: a little ahead of them, to the right and below. What the others draw and what the
 * player draws of their own shot start from the same place.
 */
export function muzzleOf(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  out: Vec3,
): Vec3 {
  lookDirection(yaw, pitch, forward);
  rightVector(yaw, side);
  // Up is right × forward, which for a view that has no roll is (sin(yaw) sin(pitch), cos(pitch), cos(yaw) sin(pitch)).
  const upX = Math.sin(yaw) * Math.sin(pitch);
  const upY = Math.cos(pitch);
  const upZ = Math.cos(yaw) * Math.sin(pitch);
  out.x = x + forward.x * MUZZLE.ahead + side.x * MUZZLE.right - upX * MUZZLE.below;
  out.y = y + forward.y * MUZZLE.ahead + side.y * MUZZLE.right - upY * MUZZLE.below;
  out.z = z + forward.z * MUZZLE.ahead + side.z * MUZZLE.right - upZ * MUZZLE.below;
  return out;
}
