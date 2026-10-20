/**
 * Voxel storage is split into 16 by 16 by 16 chunks. Each chunk is a flat array of cell states
 * (see `shared/blocks.ts`), and chunks exist only where a block does, so an empty valley costs
 * nothing. A chunk is also the unit that gets meshed and re-meshed.
 */

export const CHUNK_SHIFT = 4;
/** Cells along one side of a chunk. */
export const CHUNK_SIZE = 1 << CHUNK_SHIFT;
export const CHUNK_MASK = CHUNK_SIZE - 1;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_AREA * CHUNK_SIZE;

export interface Chunk {
  /** Chunk coordinates: the chunk spans cells cx * 16 to cx * 16 + 15 along x, and likewise for y and z. */
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly key: number;
  /** One state per cell, 0 when empty. Index = (ly * 16 + lz) * 16 + lx, so a horizontal layer is contiguous. */
  readonly cells: Uint16Array;
  /** How many cells are not empty. */
  count: number;
  /** Bumped by every change, so a mesher can tell whether the mesh it holds is current. */
  version: number;
}

/** Index of a cell inside its chunk from its local coordinates (each 0 to 15). */
export function cellIndex(lx: number, ly: number, lz: number): number {
  return (ly << (2 * CHUNK_SHIFT)) | (lz << CHUNK_SHIFT) | lx;
}

const KEY_SPAN = 64;
const KEY_BIAS = 32;

/** Chunk coordinate ranges the key can hold: x and z from -32 to 31, y from 0 to 63. */
export const CHUNK_KEY_RANGE = {
  minXZ: -KEY_BIAS,
  maxXZ: KEY_SPAN - KEY_BIAS - 1,
  maxY: KEY_SPAN - 1,
};

/**
 * A number that names a chunk, for Map keys. Sorting keys sorts chunks by y, then z, then x,
 * which is the order every deterministic walk over the world uses.
 */
export function chunkKey(cx: number, cy: number, cz: number): number {
  return (cy * KEY_SPAN + (cz + KEY_BIAS)) * KEY_SPAN + (cx + KEY_BIAS);
}

export interface ChunkCoords {
  cx: number;
  cy: number;
  cz: number;
}

/** The inverse of `chunkKey`. */
export function chunkCoords(key: number, out: ChunkCoords): ChunkCoords {
  out.cx = (key % KEY_SPAN) - KEY_BIAS;
  const rest = Math.floor(key / KEY_SPAN);
  out.cz = (rest % KEY_SPAN) - KEY_BIAS;
  out.cy = Math.floor(rest / KEY_SPAN);
  return out;
}

export function createChunk(cx: number, cy: number, cz: number): Chunk {
  return {
    cx,
    cy,
    cz,
    key: chunkKey(cx, cy, cz),
    cells: new Uint16Array(CHUNK_VOLUME),
    count: 0,
    version: 0,
  };
}
