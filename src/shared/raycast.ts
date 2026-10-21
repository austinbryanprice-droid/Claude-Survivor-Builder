import type { BlockWorld } from './block-world';
import { stateShape } from './blocks';
import type { GroundQuery } from './ground';
import type { Vec3 } from './look';
import { shapeGeometry, type ShapeFace, type ShapeGeometry } from './shapes';

/**
 * Where a ray first meets the world: a block (found cell by cell) or the smooth terrain (found by
 * marching along the ray through the ground's signed distance). The build controls aim with it, and
 * the host could run the same code to check a click. Cell (x, y, z) is the unit cube that spans
 * [x, x + 1] in each axis, as everywhere else.
 *
 * A slab or a wedge fills only part of its cell, and the ray meets only that part: it goes on past
 * the empty half of a lower slab, and lands on the slope of a wedge where the slope is.
 */

/** What a ray found. One object is reused between calls, so read it before the next `castRay`. */
export interface RayHit {
  kind: 'block' | 'terrain';
  /** How far along the ray the hit is, in blocks. */
  distance: number;
  /**
   * For a block, the cell that was hit. For terrain, the cell the ground surface passes through at
   * the hit, which is where a new block would rest on it.
   */
  x: number;
  y: number;
  z: number;
  /**
   * Which way the face that was hit points, as the step to the cell a new block would take: one of
   * the six axis directions. A face on the edge of its cell names the neighbor across it. A face
   * inside the cell (the top of a lower slab) or a slanting one (the slope of a wedge) names the
   * axis it faces most, and the vertical one when it faces two equally. For terrain, the axis its
   * surface faces most.
   */
  nx: number;
  ny: number;
  nz: number;
}

export function createRayHit(): RayHit {
  return { kind: 'block', distance: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
}

/** What a ray can meet: the cells of the structures, and optionally the smooth terrain. */
export interface RayWorld {
  blocks: Pick<BlockWorld, 'getBlock'>;
  ground?: Pick<GroundQuery, 'distance'>;
}

/** Spacing of the samples taken along a ray through the terrain; no feature of the ground is thinner. */
const GROUND_STEP = 0.2;
/** Halvings that pin the crossing down after the march finds it: 0.2 / 2^12 is about 0.05 mm. */
const GROUND_REFINE = 12;
/** The step the surface normal is measured over. */
const NORMAL_PROBE = 0.05;
/** How far the hit point is pushed out of the ground, along the normal, to name the cell it is in. */
const SURFACE_NUDGE = 0.02;

/**
 * Casts a ray from `origin` along the unit vector `dir`, up to `maxDistance` blocks, and writes the
 * nearest hit into `out`. Returns false when nothing is in range. The cell the ray starts in is
 * never reported, and a ray that starts inside the ground has to leave it before it can hit it.
 */
export function castRay(
  world: RayWorld,
  origin: Vec3,
  dir: Vec3,
  maxDistance: number,
  out: RayHit,
): boolean {
  // Also false for NaN, which would make the march below run forever.
  if (!(maxDistance > 0)) return false;
  const blockFound = castBlocks(world.blocks, origin, dir, maxDistance, out);
  const limit = blockFound ? out.distance : maxDistance;
  const ground = world.ground;
  if (ground) {
    const t = marchGround(ground, origin, dir, limit);
    if (t >= 0) {
      writeTerrainHit(ground, origin, dir, t, out);
      return true;
    }
  }
  return blockFound;
}

/** Walks the cells along the ray (Amanatides and Woo) and stops at the first block. */
function castBlocks(
  blocks: Pick<BlockWorld, 'getBlock'>,
  origin: Vec3,
  dir: Vec3,
  maxDistance: number,
  out: RayHit,
): boolean {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;
  const deltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const deltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const deltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  // The distance along the ray to the first wall of the grid on each axis.
  let nextX = dir.x === 0 ? Infinity : (dir.x > 0 ? x + 1 - origin.x : origin.x - x) * deltaX;
  let nextY = dir.y === 0 ? Infinity : (dir.y > 0 ? y + 1 - origin.y : origin.y - y) * deltaY;
  let nextZ = dir.z === 0 ? Infinity : (dir.z > 0 ? z + 1 - origin.z : origin.z - z) * deltaZ;

  // A ray crosses at most this many walls in `maxDistance`; the bound only guards against a loop
  // that does not end because of a bad number.
  const budget = Math.ceil(maxDistance * (Math.abs(dir.x) + Math.abs(dir.y) + Math.abs(dir.z))) + 3;
  for (let i = 0; i < budget; i++) {
    let t: number;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    if (nextX <= nextY && nextX <= nextZ) {
      t = nextX;
      x += stepX;
      nextX += deltaX;
      nx = -stepX;
    } else if (nextY <= nextZ) {
      t = nextY;
      y += stepY;
      nextY += deltaY;
      ny = -stepY;
    } else {
      t = nextZ;
      z += stepZ;
      nextZ += deltaZ;
      nz = -stepZ;
    }
    if (t > maxDistance) return false;
    const state = blocks.getBlock(x, y, z);
    if (state === 0) continue;
    // A whole cell is hit where the ray enters it; a slab or a wedge only where the ray meets the shape.
    const geometry = shapeGeometry(stateShape(state));
    if (geometry === undefined || geometry.boxes === null) {
      writeBlockHit(out, t, x, y, z);
      out.nx = nx;
      out.ny = ny;
      out.nz = nz;
      return true;
    }
    if (hitShape(geometry, origin, dir, x, y, z, maxDistance, out)) return true;
  }
  return false;
}

function writeBlockHit(out: RayHit, distance: number, x: number, y: number, z: number): void {
  out.kind = 'block';
  out.distance = distance;
  out.x = x;
  out.y = y;
  out.z = z;
}

/** A ray this close to level with a face is taken to run along it. */
const PARALLEL = 1e-9;

/**
 * Finds where the ray enters the shape standing in cell (cx, cy, cz). The shape is convex, so it is
 * the set of points inside every face plane: the ray is inside them all between the last plane it
 * enters through and the first it leaves by, and the plane it enters last is the face it hit. The
 * ray's origin lies outside the cell. On a hit, writes the distance and the step to the cell a new
 * block would take.
 */
function hitShape(
  geometry: ShapeGeometry,
  origin: Vec3,
  dir: Vec3,
  cx: number,
  cy: number,
  cz: number,
  maxDistance: number,
  out: RayHit,
): boolean {
  const ox = origin.x - cx;
  const oy = origin.y - cy;
  const oz = origin.z - cz;
  let enter = -Infinity;
  let exit = maxDistance;
  let hit = -1;
  const planes = geometry.planes;
  for (let i = 0; i < planes.length; i++) {
    const plane = planes[i] as readonly [number, number, number, number];
    const slope = plane[0] * dir.x + plane[1] * dir.y + plane[2] * dir.z;
    const room = plane[3] - (plane[0] * ox + plane[1] * oy + plane[2] * oz);
    if (Math.abs(slope) < PARALLEL) {
      // Level with this face: the ray is either inside its plane for good or outside it for good.
      if (room < 0) return false;
      continue;
    }
    const t = room / slope;
    if (slope < 0) {
      if (t > enter) {
        enter = t;
        hit = i;
      }
    } else if (t < exit) {
      exit = t;
    }
    if (enter > exit) return false;
  }
  if (hit < 0 || enter < 0) return false;

  const face = geometry.faces[hit] as ShapeFace;
  writeBlockHit(out, enter, cx, cy, cz);
  out.nx = 0;
  out.ny = 0;
  out.nz = 0;
  if (face.side >= 0) {
    // On the edge of the cell: the neighbor across it.
    const step = (face.side & 1) === 0 ? 1 : -1;
    const axis = face.side >> 1;
    if (axis === 0) out.nx = step;
    else if (axis === 1) out.ny = step;
    else out.nz = step;
    return true;
  }
  stepAlong(face.normal, out);
  return true;
}

/** Writes the axis direction a normal points along most into `out`; a tie goes to the vertical. */
function stepAlong(normal: readonly [number, number, number], out: RayHit): void {
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  if (ay >= ax - 1e-9 && ay >= az - 1e-9) out.ny = normal[1] >= 0 ? 1 : -1;
  else if (ax >= az) out.nx = normal[0] >= 0 ? 1 : -1;
  else out.nz = normal[2] >= 0 ? 1 : -1;
}

/** The distance at which the ray first enters the ground within `limit`, or -1. */
function marchGround(
  ground: Pick<GroundQuery, 'distance'>,
  origin: Vec3,
  dir: Vec3,
  limit: number,
): number {
  let previous = 0;
  let inside = ground.distance(origin.x, origin.y, origin.z) <= 0;
  for (;;) {
    const t = Math.min(previous + GROUND_STEP, limit);
    const d = ground.distance(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
    if (inside) {
      // Still underground: only coming up into the open and going down again counts as a hit.
      if (d > 0) inside = false;
    } else if (d <= 0) {
      let near = previous;
      let far = t;
      for (let i = 0; i < GROUND_REFINE; i++) {
        const mid = (near + far) / 2;
        const dm = ground.distance(
          origin.x + dir.x * mid,
          origin.y + dir.y * mid,
          origin.z + dir.z * mid,
        );
        if (dm > 0) near = mid;
        else far = mid;
      }
      return far;
    }
    if (t >= limit) return -1;
    previous = t;
  }
}

function writeTerrainHit(
  ground: Pick<GroundQuery, 'distance'>,
  origin: Vec3,
  dir: Vec3,
  t: number,
  out: RayHit,
): void {
  const px = origin.x + dir.x * t;
  const py = origin.y + dir.y * t;
  const pz = origin.z + dir.z * t;
  // The surface normal is the field's gradient.
  const h = NORMAL_PROBE;
  let gx = ground.distance(px + h, py, pz) - ground.distance(px - h, py, pz);
  let gy = ground.distance(px, py + h, pz) - ground.distance(px, py - h, pz);
  let gz = ground.distance(px, py, pz + h) - ground.distance(px, py, pz - h);
  const length = Math.sqrt(gx * gx + gy * gy + gz * gz);
  if (length > 1e-9) {
    gx /= length;
    gy /= length;
    gz /= length;
  } else {
    gx = 0;
    gy = 1;
    gz = 0;
  }
  out.kind = 'terrain';
  out.distance = t;
  out.x = Math.floor(px + gx * SURFACE_NUDGE);
  out.y = Math.floor(py + gy * SURFACE_NUDGE);
  out.z = Math.floor(pz + gz * SURFACE_NUDGE);
  const ax = Math.abs(gx);
  const ay = Math.abs(gy);
  const az = Math.abs(gz);
  out.nx = 0;
  out.ny = 0;
  out.nz = 0;
  if (ay >= ax && ay >= az) out.ny = gy >= 0 ? 1 : -1;
  else if (ax >= az) out.nx = gx >= 0 ? 1 : -1;
  else out.nz = gz >= 0 ? 1 : -1;
}
