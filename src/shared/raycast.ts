import type { BlockWorld } from './block-world';
import type { GroundQuery } from './ground';
import type { Vec3 } from './look';

/**
 * Where a ray first meets the world: a block (found cell by cell) or the smooth terrain (found by
 * marching along the ray through the ground's signed distance). The build controls aim with it, and
 * the host could run the same code to check a click. Cell (x, y, z) is the unit cube that spans
 * [x, x + 1] in each axis, as everywhere else.
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
   * Which way the face that was hit points, as the step to the neighbor cell across it: one of the
   * six axis directions. For terrain, the axis its surface faces most.
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
    if (blocks.getBlock(x, y, z) !== 0) {
      out.kind = 'block';
      out.distance = t;
      out.x = x;
      out.y = y;
      out.z = z;
      out.nx = nx;
      out.ny = ny;
      out.nz = nz;
      return true;
    }
  }
  return false;
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
