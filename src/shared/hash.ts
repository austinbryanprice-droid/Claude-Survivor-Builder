/**
 * Integer hashing and a small seeded generator. Everything that must come out the same in
 * every browser (terrain, scatter, wave rolls) goes through these instead of Math.sin tricks
 * or Math.random, so a seed is enough to rebuild the world.
 */

const TWO_POW_32 = 4294967296;

/** 32-bit avalanche hash (lowbias32). Returns an unsigned 32-bit integer. */
export function hash32(value: number): number {
  let x = value | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Hash of a lattice point under a seed. Coordinates are truncated to 32-bit integers. */
export function hash3(seed: number, x: number, y: number, z: number): number {
  let h = hash32(seed);
  h = hash32((h + Math.imul(x | 0, 0x27d4eb2d)) | 0);
  h = hash32((h + Math.imul(y | 0, 0x165667b1)) | 0);
  h = hash32((h + Math.imul(z | 0, 0x85ebca6b)) | 0);
  return h;
}

/** Maps a 32-bit hash to a float in [0, 1). */
export function unitFloat(hash: number): number {
  return (hash >>> 0) / TWO_POW_32;
}

/** Seeded generator (mulberry32). Each call returns a float in [0, 1). */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / TWO_POW_32;
  };
}
