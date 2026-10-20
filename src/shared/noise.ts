/**
 * Smooth value noise and fractal sums built on the integer hash in `hash.ts`.
 *
 * Determinism rule: everything here uses only +, -, *, /, floor and integer math, so every
 * browser produces bit-identical results. Terrain and scatter depend on that. Do not add
 * Math.sin, Math.pow, Math.exp or Math.hypot here (they may differ in the last bit between
 * engines).
 */
import { hash32 } from './hash';

const TWO_POW_32 = 4294967296;

/** Lattice value in [0, 1) for a 2D integer point under a seed. */
function lattice2(seed: number, ix: number, iy: number): number {
  const h = hash32((hash32((ix ^ seed) | 0) + Math.imul(iy | 0, 0x27d4eb2d)) | 0);
  return h / TWO_POW_32;
}

/** Lattice value in [0, 1) for a 3D integer point under a seed. */
function lattice3(seed: number, ix: number, iy: number, iz: number): number {
  const h = hash32(
    (hash32((hash32((ix ^ seed) | 0) + Math.imul(iy | 0, 0x27d4eb2d)) | 0) +
      Math.imul(iz | 0, 0x165667b1)) |
      0,
  );
  return h / TWO_POW_32;
}

/** Quintic fade, continuous in its first and second derivative. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Value noise in [0, 1). */
export function noise2(seed: number, x: number, y: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const u = fade(x - fx);
  const v = fade(y - fy);
  const a = lattice2(seed, fx, fy);
  const b = lattice2(seed, fx + 1, fy);
  const c = lattice2(seed, fx, fy + 1);
  const d = lattice2(seed, fx + 1, fy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Value noise in [0, 1). */
export function noise3(seed: number, x: number, y: number, z: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const u = fade(x - fx);
  const v = fade(y - fy);
  const w = fade(z - fz);
  const c000 = lattice3(seed, fx, fy, fz);
  const c100 = lattice3(seed, fx + 1, fy, fz);
  const c010 = lattice3(seed, fx, fy + 1, fz);
  const c110 = lattice3(seed, fx + 1, fy + 1, fz);
  const c001 = lattice3(seed, fx, fy, fz + 1);
  const c101 = lattice3(seed, fx + 1, fy, fz + 1);
  const c011 = lattice3(seed, fx, fy + 1, fz + 1);
  const c111 = lattice3(seed, fx + 1, fy + 1, fz + 1);
  const x00 = c000 + (c100 - c000) * u;
  const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u;
  const x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

/** Octave seeds are spread so octaves never share a lattice. */
const OCTAVE_STRIDE = 0x9e3779b9;
/** Each octave turns the domain by a 3-4-5 triangle angle (about 37 degrees), exact in floats. */
const ROT_COS = 0.8;
const ROT_SIN = 0.6;

/** Fractal sum of 2D value noise, normalized to [-1, 1]. */
export function fbm2(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (noise2((seed + Math.imul(i, OCTAVE_STRIDE)) | 0, x, y) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    const rx = (x * ROT_COS - y * ROT_SIN) * 2;
    y = (x * ROT_SIN + y * ROT_COS) * 2;
    x = rx;
  }
  return sum / norm;
}

/** Fractal sum of 3D value noise, normalized to [-1, 1]. */
export function fbm3(seed: number, x: number, y: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (noise3((seed + Math.imul(i, OCTAVE_STRIDE)) | 0, x, y, z) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    const rx = (x * ROT_COS - z * ROT_SIN) * 2;
    z = (x * ROT_SIN + z * ROT_COS) * 2;
    x = rx;
    y *= 2;
  }
  return sum / norm;
}

/** Ridged fractal in [0, 1]: sharp crests where the underlying noise crosses zero. */
export function ridge2(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = noise2((seed + Math.imul(i, OCTAVE_STRIDE)) | 0, x, y) * 2 - 1;
    const r = 1 - (n < 0 ? -n : n);
    sum += r * r * amp;
    norm += amp;
    amp *= 0.5;
    const rx = (x * ROT_COS - y * ROT_SIN) * 2;
    y = (x * ROT_SIN + y * ROT_COS) * 2;
    x = rx;
  }
  return sum / norm;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite smoothstep; `a` may be greater than `b` for a falling edge. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Smooth minimum (polynomial). Blends two signed distances with radius `k`. */
export function smin(a: number, b: number, k: number): number {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return b + (a - b) * h - k * h * (1 - h);
}
