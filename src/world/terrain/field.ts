/**
 * The valley as a function of a seed: a ground height, rock outcrops as signed distance
 * features, and the painted ground cover (paths, ash, beach) that the shader blends.
 *
 * Everything here is deterministic (integer-hash noise, no trig, no pow), so every browser
 * builds the same valley from the same seed. Units are meters, +x east, +z south, +y up. The
 * playable area is WORLD_SIZE by WORLD_SIZE around the origin.
 */
import { createRng } from '../../shared/hash';
import { fbm2, fbm3, mix, noise2, ridge2, smin, smoothstep } from '../../shared/noise';

export const WORLD_SIZE = 192;
export const WORLD_HALF = WORLD_SIZE / 2;
/** Samples run from y = 0 up to Y_MAX; the ground is soft-capped below it. */
export const Y_MAX = 72;
export const WATER_LEVEL = 7;

export interface LakeShape {
  readonly x: number;
  readonly z: number;
  /** Radii of the basin ellipse in meters (the waterline is about 0.6 of these). */
  readonly rx: number;
  readonly rz: number;
}

export interface CrashSite {
  readonly x: number;
  readonly z: number;
  /** Radius of the flattened clearing in meters. */
  readonly radius: number;
  /** Ground height of the clearing. */
  readonly floor: number;
}

export interface RockFeature {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
  /** Rotation about the Y axis as a cosine and sine, so no trigonometry is needed. */
  readonly c: number;
  readonly s: number;
  /** Amplitude of the lumpy displacement in meters. */
  readonly bump: number;
  readonly seed: number;
  /** Smallest radius; scales the distance estimate. */
  readonly minR: number;
  /** Bounding radius for cheap rejection. */
  readonly bound: number;
}

export interface SplatSample {
  /** Worn path and bare patches. */
  readonly dirt: number;
  /** Scorched ground around the crash site. */
  readonly ash: number;
  /** Beach pebbles at the waterline. */
  readonly sand: number;
  /** Lushness 0..1, a large-scale tint variation. */
  readonly lush: number;
}

export const LAKE: LakeShape = { x: 54, z: 8, rx: 46, rz: 36 };
export const CRASH: CrashSite = { x: -2, z: -4, radius: 13, floor: 11.2 };

/** Polylines of the worn paths, as x, z pairs. */
const PATHS: readonly (readonly [number, number][])[] = [
  [
    [4, -2],
    [12, 2],
    [22, 6],
    [30, 9],
  ],
  [
    [-2, 6],
    [-6, 22],
    [-18, 40],
    [-26, 62],
  ],
  [
    [-6, -10],
    [-18, -24],
    [-36, -34],
    [-44, -52],
  ],
];

/** The furrow the station fragment carved while skidding in. */
const FURROW: readonly [number, number][] = [
  [-6, -8],
  [-26, -24],
  [-44, -36],
];

function distToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + abx * t);
  const dz = pz - (az + abz * t);
  return Math.sqrt(dx * dx + dz * dz);
}

function distToPolyline(px: number, pz: number, line: readonly [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as [number, number];
    const b = line[i + 1] as [number, number];
    const d = distToSegment(px, pz, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return best;
}

/** Soft ceiling so the ground never leaves the sampled volume. */
function softCap(h: number, cap: number, span: number): number {
  if (h <= cap) return h;
  const t = (h - cap) / span;
  return cap + (span * t) / (1 + t);
}

export interface TerrainField {
  readonly seed: number;
  readonly rocks: readonly RockFeature[];
  /** Ground height without rock features. */
  heightAt(x: number, z: number): number;
  /** Signed distance to the solid: negative inside the ground or a rock. */
  sdf(x: number, y: number, z: number): number;
  /** Signed distance of one rock feature (negative inside). */
  rockSdf(rock: RockFeature, x: number, y: number, z: number): number;
  /** Ground cover weights at a point, given the ground height there. */
  splatAt(x: number, z: number, groundHeight: number): SplatSample;
}

export function createTerrainField(seed: number): TerrainField {
  const sWarpA = (seed + 11) | 0;
  const sWarpB = (seed + 12) | 0;
  const sBase = (seed + 13) | 0;
  const sBump = (seed + 14) | 0;
  const sFine = (seed + 15) | 0;
  const sRidge = (seed + 16) | 0;
  const sMid = (seed + 17) | 0;
  const sMount = (seed + 18) | 0;
  const sLake = (seed + 19) | 0;
  const sLakeFloor = (seed + 20) | 0;
  const sCrash = (seed + 21) | 0;
  const sPath = (seed + 22) | 0;
  const sPatch = (seed + 23) | 0;
  const sLush = (seed + 24) | 0;
  const sAsh = (seed + 25) | 0;
  const sSand = (seed + 26) | 0;

  function heightAt(x: number, z: number): number {
    // Domain warp keeps rings and ellipses from reading as geometric.
    const wx = x + 16 * fbm2(sWarpA, x * 0.008, z * 0.008, 2);
    const wz = z + 16 * fbm2(sWarpB, x * 0.008, z * 0.008, 2);
    const rw = Math.sqrt(wx * wx + wz * wz);

    let h = 12;
    h += 3.4 * fbm2(sBase, x * 0.012, z * 0.012, 4);
    h += 1.1 * fbm2(sBump, x * 0.045, z * 0.045, 3);
    h += 0.28 * fbm2(sFine, x * 0.2, z * 0.2, 2);

    // Foothills inside the valley, then the hills that close the horizon.
    const mid = smoothstep(24, 72, rw);
    h += mid * (2.2 + 3.2 * (fbm2(sMid, x * 0.03, z * 0.03, 3) * 0.5 + 0.5));
    const rim = smoothstep(46, 104, rw);
    const rimN = 0.5 + 0.5 * fbm2(sRidge, x * 0.016, z * 0.016, 3);
    h += rim * rim * (10 + 22 * rimN);
    // Mountains for the backdrop; zero inside the playable area.
    const far = smoothstep(96, 330, rw);
    h += far * far * (34 + 170 * ridge2(sMount, x * 0.011, z * 0.011, 5));

    // The lake basin.
    const lx = (x - LAKE.x) / LAKE.rx;
    const lz = (z - LAKE.z) / LAKE.rz;
    const ld = Math.sqrt(lx * lx + lz * lz) + 0.24 * fbm2(sLake, x * 0.03, z * 0.03, 2);
    const basin = smoothstep(1.08, 0.22, ld);
    const floorH = 3.1 + 1.5 * fbm2(sLakeFloor, x * 0.05, z * 0.05, 2);
    h = mix(h, floorH, basin);

    // The crash site: a flattened clearing with a crater and a skid furrow.
    const cdx = x - CRASH.x;
    const cdz = z - CRASH.z;
    const cr = Math.sqrt(cdx * cdx + cdz * cdz) + 1.6 * fbm2(sCrash, x * 0.06, z * 0.06, 2);
    const flat = smoothstep(CRASH.radius + 12, CRASH.radius - 3, cr);
    const crater = 1.7 * smoothstep(7.5, 0, cr) - 0.7 * smoothstep(4, 0, Math.abs(cr - 9.5));
    h = mix(h, CRASH.floor - crater, flat);
    const furrowD = distToPolyline(x, z, FURROW);
    const furrow = smoothstep(4.6, 1.6, furrowD) * smoothstep(5, 14, cr);
    h -= 1.15 * furrow * (0.75 + 0.25 * fbm2(sCrash + 1, x * 0.2, z * 0.2, 2));

    // Worn paths sit slightly below the grass.
    let pathD = Infinity;
    for (const line of PATHS) pathD = Math.min(pathD, distToPolyline(x, z, line));
    h -= 0.16 * smoothstep(2.6, 0.8, pathD);

    return softCap(Math.max(h, 0.8), 58, 10);
  }

  // Rock outcrops, placed deterministically on the rim, in the valley and along the shore.
  const rocks: RockFeature[] = [];
  {
    const rng = createRng((seed ^ 0x5bd1e995) >>> 0);
    const place = (
      count: number,
      minR: number,
      maxR: number,
      zone: (x: number, z: number) => boolean,
    ): void => {
      let placed = 0;
      for (let attempt = 0; attempt < count * 80 && placed < count; attempt++) {
        const x = (rng() * 2 - 1) * (WORLD_HALF - 4);
        const z = (rng() * 2 - 1) * (WORLD_HALF - 4);
        if (!zone(x, z)) continue;
        const crashD = Math.sqrt((x - CRASH.x) ** 2 + (z - CRASH.z) ** 2);
        if (crashD < CRASH.radius + 5) continue;
        const rx = minR + (maxR - minR) * rng();
        const rz = minR + (maxR - minR) * rng();
        const ry = rx * (0.55 + 0.5 * rng());
        const cdir = rng() * 2 - 1;
        const sdir = (rng() < 0.5 ? -1 : 1) * Math.sqrt(1 - cdir * cdir);
        const g = heightAt(x, z);
        const minRr = Math.min(rx, ry, rz);
        rocks.push({
          x,
          y: g + ry * 0.25,
          z,
          rx,
          ry,
          rz,
          c: cdir,
          s: sdir,
          bump: 0.32 * minRr,
          seed: (seed + 1000 + rocks.length * 7919) | 0,
          minR: minRr,
          bound: Math.max(rx, ry, rz) + 0.32 * minRr * 1.6 + 1.5,
        });
        placed++;
      }
    };
    const radial = (x: number, z: number): number => Math.sqrt(x * x + z * z);
    const inLake = (x: number, z: number): boolean => {
      const lx = (x - LAKE.x) / LAKE.rx;
      const lz = (z - LAKE.z) / LAKE.rz;
      return Math.sqrt(lx * lx + lz * lz) < 0.62;
    };
    // Cliffs and tors on the surrounding hills.
    place(11, 5.5, 11, (x, z) => radial(x, z) > 58 && radial(x, z) < 90 && !inLake(x, z));
    // Boulders in the open valley.
    place(10, 1.6, 4.2, (x, z) => radial(x, z) < 70 && !inLake(x, z));
    // Shore rocks at the waterline.
    place(8, 1.2, 2.8, (x, z) => {
      const lx = (x - LAKE.x) / LAKE.rx;
      const lz = (z - LAKE.z) / LAKE.rz;
      const d = Math.sqrt(lx * lx + lz * lz);
      return d > 0.5 && d < 0.72;
    });
  }

  function rockSdf(rock: RockFeature, x: number, y: number, z: number): number {
    const dx = x - rock.x;
    const dz = z - rock.z;
    const lx = (dx * rock.c + dz * rock.s) / rock.rx;
    const lz = (-dx * rock.s + dz * rock.c) / rock.rz;
    const ly = (y - rock.y) / rock.ry;
    const len = Math.sqrt(lx * lx + ly * ly + lz * lz);
    return (len - 1) * rock.minR + rock.bump * fbm3(rock.seed, x * 0.3, y * 0.3, z * 0.3, 3);
  }

  function sdf(x: number, y: number, z: number): number {
    let d = y - heightAt(x, z);
    for (const rock of rocks) {
      const dx = x - rock.x;
      const dz = z - rock.z;
      if (dx * dx + dz * dz > rock.bound * rock.bound) continue;
      const dy = y - rock.y;
      if (dy > rock.bound || dy < -rock.bound) continue;
      d = smin(d, rockSdf(rock, x, y, z), 1.3);
    }
    return d;
  }

  function splatAt(x: number, z: number, groundHeight: number): SplatSample {
    let pathD = Infinity;
    for (const line of PATHS) pathD = Math.min(pathD, distToPolyline(x, z, line));
    pathD += 0.9 * (noise2(sPath, x * 0.35, z * 0.35) - 0.5);
    const path = smoothstep(2.4, 1.0, pathD);
    const patch = smoothstep(0.78, 0.88, fbm2(sPatch, x * 0.07, z * 0.07, 3) * 0.5 + 0.5);

    const cdx = x - CRASH.x;
    const cdz = z - CRASH.z;
    const cr = Math.sqrt(cdx * cdx + cdz * cdz) + 3.2 * fbm2(sAsh, x * 0.08, z * 0.08, 3);
    const furrowD = distToPolyline(x, z, FURROW);
    const ash = Math.max(
      smoothstep(CRASH.radius + 5, CRASH.radius - 4, cr),
      smoothstep(4, 1.4, furrowD),
    );

    const beachBand = smoothstep(1.1, 0.15, Math.abs(groundHeight - (WATER_LEVEL + 0.35)));
    const beach = beachBand * smoothstep(0.35, 0.6, noise2(sSand, x * 0.12, z * 0.12) + 0.25);

    const lush = fbm2(sLush, x * 0.02, z * 0.02, 3) * 0.5 + 0.5;
    return {
      dirt: Math.max(path, patch * 0.85),
      ash,
      sand: beach,
      lush,
    };
  }

  return { seed, rocks, heightAt, sdf, rockSdf, splatAt };
}
