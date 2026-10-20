/**
 * Where the vegetation goes: trees on a jittered grid, grass and flowers per cell. Everything
 * is a pure function of the seed and the ground, built from integer hashes, so every client
 * grows the same forest. Rendering lives in render/vegetation-render.ts.
 */
import { createRng, hash3 } from '../shared/hash';
import { clamp01, fbm2, noise2, smoothstep } from '../shared/noise';
import { CRASH, LAKE, WATER_LEVEL, WORLD_HALF, WORLD_SIZE } from './terrain/field';
import type { SdfGrid } from './terrain/grid';

export const TREE_PINE = 0;
export const TREE_BROADLEAF = 1;

export interface TreeSpawn {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly kind: typeof TREE_PINE | typeof TREE_BROADLEAF;
  /** Size multiplier of the model. */
  readonly scale: number;
  /** Rotation about the vertical axis in radians. */
  readonly yaw: number;
  /** Color variation, 0..1. */
  readonly tint: number;
}

/** Ground cover weights from the painted splat map, each 0..1. */
export interface Cover {
  dirt: number;
  ash: number;
  sand: number;
  lush: number;
}

export interface ScatterGround {
  groundAt(x: number, z: number): number;
  /** Writes the cover weights at a point into `out`. */
  coverAt(x: number, z: number, out: Cover): void;
  /** True when a point lies inside a rock outcrop. */
  solidAt(x: number, y: number, z: number): boolean;
  /** Upward component of the ground normal, 1 on flat ground. */
  flatnessAt(x: number, z: number): number;
}

export interface SplatBytes {
  readonly data: Uint8Array;
  readonly size: number;
}

export function createScatterGround(grid: SdfGrid, splat: SplatBytes): ScatterGround {
  const { data, size } = splat;
  const texel = WORLD_SIZE / size;
  const channel = (i: number, j: number, c: number): number => {
    const ci = Math.min(size - 1, Math.max(0, i));
    const cj = Math.min(size - 1, Math.max(0, j));
    return ((data[(cj * size + ci) * 4 + c] as number) ?? 0) / 255;
  };
  const bilinear = (x: number, z: number, c: number): number => {
    const fx = (x + WORLD_HALF) / texel - 0.5;
    const fz = (z + WORLD_HALF) / texel - 0.5;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = channel(i, j, c);
    const b = channel(i + 1, j, c);
    const d = channel(i, j + 1, c);
    const e = channel(i + 1, j + 1, c);
    return a + (b - a) * u + (d - a) * v + (a - b - d + e) * u * v;
  };
  return {
    groundAt: (x, z) => grid.groundAt(x, z),
    coverAt(x, z, out) {
      out.dirt = bilinear(x, z, 0);
      out.ash = bilinear(x, z, 1);
      out.sand = bilinear(x, z, 2);
      out.lush = bilinear(x, z, 3);
    },
    solidAt: (x, y, z) => grid.sample(x, y, z) < 0.05,
    flatnessAt(x, z) {
      const dx = (grid.groundAt(x + 1, z) - grid.groundAt(x - 1, z)) * 0.5;
      const dz = (grid.groundAt(x, z + 1) - grid.groundAt(x, z - 1)) * 0.5;
      return 1 / Math.sqrt(1 + dx * dx + dz * dz);
    },
  };
}

const TREE_CELL = 4.4;
/** Distance from the crash site center beyond which the forest may start. */
const CLEARING = CRASH.radius + 9;

/** Grass cells are squares of this size in meters. */
export const GRASS_CELL = 8;
export const GRASS_CELLS_PER_SIDE = WORLD_SIZE / GRASS_CELL;
/** Floats per grass or flower clump: x, y, z, scale, yaw, rank. */
export const CLUMP_STRIDE = 6;
const GRASS_PER_CELL = 460;
const FLOWER_PER_CELL = 14;

const TWO_PI = 6.283185307179586;

/** A disc where no tree may grow (camera spots, building sites). */
export interface KeepClear {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** Trees for the whole valley, in a stable order. */
export function scatterTrees(
  seed: number,
  ground: ScatterGround,
  keepClear: readonly KeepClear[] = [],
): TreeSpawn[] {
  const sForest = (seed + 301) | 0;
  const sKind = (seed + 302) | 0;
  const sGrove = (seed + 303) | 0;
  const trees: TreeSpawn[] = [];
  const cover: Cover = { dirt: 0, ash: 0, sand: 0, lush: 0 };
  const cells = Math.floor((WORLD_SIZE - 4) / TREE_CELL);
  const start = -WORLD_HALF + 2;

  for (let cz = 0; cz < cells; cz++) {
    for (let cx = 0; cx < cells; cx++) {
      const rng = createRng(hash3(seed, cx, cz, 4011));
      const jx = rng();
      const jz = rng();
      const roll = rng();
      const kindRoll = rng();
      const sizeRoll = rng();
      const yawRoll = rng();
      const tintRoll = rng();
      const x = start + (cx + 0.15 + 0.7 * jx) * TREE_CELL;
      const z = start + (cz + 0.15 + 0.7 * jz) * TREE_CELL;
      const radial = Math.sqrt(x * x + z * z);
      const crash = Math.sqrt((x - CRASH.x) ** 2 + (z - CRASH.z) ** 2);
      if (crash < CLEARING) continue;
      if (keepClear.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.radius * c.radius)) continue;
      const y = ground.groundAt(x, z);
      if (y < WATER_LEVEL + 0.9) continue;
      if (ground.flatnessAt(x, z) < 0.74) continue;
      ground.coverAt(x, z, cover);
      if (cover.dirt > 0.35 || cover.ash > 0.25 || cover.sand > 0.2) continue;
      if (ground.solidAt(x, y + 0.6, z)) continue;

      // Forest thickens away from the clearing and gathers into groves.
      const ring = smoothstep(26, 66, radial);
      const grove = fbm2(sForest, x * 0.022, z * 0.022, 3) * 0.5 + 0.5;
      const meadow = smoothstep(0.5, 0.72, grove) * 0.42;
      // Woods line the lake: a band that starts a little back from the waterline.
      const lx = (x - LAKE.x) / LAKE.rx;
      const lz = (z - LAKE.z) / LAKE.rz;
      const lakeD = Math.sqrt(lx * lx + lz * lz);
      const shore = smoothstep(0.58, 0.72, lakeD) * smoothstep(1.35, 0.95, lakeD) * 0.7;
      const density = clamp01(ring * (0.42 + 0.85 * smoothstep(0.22, 0.6, grove)) + meadow + shore);
      const edge = smoothstep(WORLD_HALF - 3, WORLD_HALF - 12, Math.max(Math.abs(x), Math.abs(z)));
      if (roll > density * (0.55 + 0.45 * edge)) continue;

      const highland = smoothstep(14, 30, y);
      const pine = clamp01(
        0.26 + 0.55 * highland + (noise2(sKind, x * 0.02, z * 0.02) - 0.5) * 0.9,
      );
      const kind = kindRoll < pine ? TREE_PINE : TREE_BROADLEAF;
      const big = 0.72 + 0.62 * sizeRoll * sizeRoll + 0.12 * noise2(sGrove, x * 0.05, z * 0.05);
      trees.push({
        x,
        y,
        z,
        kind,
        scale: kind === TREE_PINE ? big * 1.08 : big,
        yaw: yawRoll * TWO_PI,
        tint: tintRoll,
      });
    }
  }
  return trees;
}

/** Clumps in one grass cell; `grass` and `flowers` are packed with CLUMP_STRIDE floats each. */
export interface GrassCell {
  readonly grass: Float32Array;
  readonly flowers: Float32Array;
}

/**
 * Grass and flowers, generated per cell on demand and cached. Each clump carries a random rank
 * in [0, 1); the renderer keeps the clumps whose rank is under the density it wants at their
 * distance, so thinning with distance is stable and never pops.
 */
export class GrassField {
  private readonly cache = new Map<number, GrassCell>();
  private readonly sFlower: number;
  private readonly sTall: number;

  constructor(
    private readonly seed: number,
    private readonly ground: ScatterGround,
    private readonly trees: readonly TreeSpawn[],
  ) {
    this.sFlower = (seed + 311) | 0;
    this.sTall = (seed + 312) | 0;
  }

  /** The cell at integer cell coordinates (0 .. GRASS_CELLS_PER_SIDE - 1). */
  cell(cx: number, cz: number): GrassCell {
    const key = cz * GRASS_CELLS_PER_SIDE + cx;
    let cell = this.cache.get(key);
    if (!cell) {
      cell = this.build(cx, cz);
      this.cache.set(key, cell);
    }
    return cell;
  }

  private build(cx: number, cz: number): GrassCell {
    const rng = createRng(hash3(this.seed, cx, cz, 9173));
    const ground = this.ground;
    const cover: Cover = { dirt: 0, ash: 0, sand: 0, lush: 0 };
    const x0 = -WORLD_HALF + cx * GRASS_CELL;
    const z0 = -WORLD_HALF + cz * GRASS_CELL;
    const grass = new Float32Array(GRASS_PER_CELL * CLUMP_STRIDE);
    let g = 0;
    for (let i = 0; i < GRASS_PER_CELL; i++) {
      const x = x0 + rng() * GRASS_CELL;
      const z = z0 + rng() * GRASS_CELL;
      const scaleRoll = rng();
      const yaw = rng() * TWO_PI;
      const rank = rng();
      const y = ground.groundAt(x, z);
      if (y < WATER_LEVEL + 0.3) continue;
      if (ground.flatnessAt(x, z) < 0.66) continue;
      ground.coverAt(x, z, cover);
      const bare = Math.max(cover.dirt * 1.15, cover.ash * 1.3, cover.sand * 1.5);
      if (bare > 0.62) continue;
      if (ground.solidAt(x, y + 0.25, z)) continue;
      const tall = noise2(this.sTall, x * 0.06, z * 0.06);
      const scale = (0.7 + 0.55 * scaleRoll + 0.35 * tall) * (1 - 0.7 * bare);
      const o = g * CLUMP_STRIDE;
      grass[o] = x;
      grass[o + 1] = y;
      grass[o + 2] = z;
      grass[o + 3] = scale;
      grass[o + 4] = yaw;
      grass[o + 5] = rank;
      g++;
    }

    const flowers = new Float32Array(FLOWER_PER_CELL * CLUMP_STRIDE);
    let f = 0;
    for (let i = 0; i < FLOWER_PER_CELL; i++) {
      const x = x0 + rng() * GRASS_CELL;
      const z = z0 + rng() * GRASS_CELL;
      const scaleRoll = rng();
      const yaw = rng() * TWO_PI;
      const rank = rng();
      const patch = fbm2(this.sFlower, x * 0.07, z * 0.07, 2) * 0.5 + 0.5;
      if (patch < 0.52) continue;
      const y = ground.groundAt(x, z);
      if (y < WATER_LEVEL + 0.5) continue;
      if (ground.flatnessAt(x, z) < 0.8) continue;
      ground.coverAt(x, z, cover);
      if (cover.dirt > 0.3 || cover.ash > 0.2 || cover.sand > 0.2) continue;
      if (ground.solidAt(x, y + 0.25, z)) continue;
      const o = f * CLUMP_STRIDE;
      flowers[o] = x;
      flowers[o + 1] = y;
      flowers[o + 2] = z;
      flowers[o + 3] = 0.8 + 0.5 * scaleRoll;
      flowers[o + 4] = yaw;
      flowers[o + 5] = rank;
      f++;
    }
    // Keep clumps away from trunks: a clump at a tree's base would show through the bark.
    const near = this.trees.filter(
      (t) => t.x > x0 - 1 && t.x < x0 + GRASS_CELL + 1 && t.z > z0 - 1 && t.z < z0 + GRASS_CELL + 1,
    );
    return {
      grass: clearOfTrunks(grass, g, near),
      flowers: clearOfTrunks(flowers, f, near),
    };
  }
}

/** The first `count` clumps of `clumps` that are not within a trunk's reach of a tree. */
function clearOfTrunks(
  clumps: Float32Array,
  count: number,
  trees: readonly TreeSpawn[],
): Float32Array {
  const out = new Float32Array(count * CLUMP_STRIDE);
  let kept = 0;
  for (let i = 0; i < count; i++) {
    const o = i * CLUMP_STRIDE;
    const x = clumps[o] as number;
    const z = clumps[o + 2] as number;
    let blocked = false;
    for (const tree of trees) {
      const dx = tree.x - x;
      const dz = tree.z - z;
      if (dx * dx + dz * dz < 0.55) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    out.set(clumps.subarray(o, o + CLUMP_STRIDE), kept * CLUMP_STRIDE);
    kept++;
  }
  return out.slice(0, kept * CLUMP_STRIDE);
}
