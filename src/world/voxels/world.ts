import type { BlockWorld, CellState } from '../../shared/block-world';
import { isCellState, isKnownState } from '../../shared/blocks';
import { WORLD_HALF } from '../terrain/field';
import { bakeTerrain, type Terrain } from '../terrain/terrain';
import {
  CHUNK_KEY_RANGE,
  CHUNK_MASK,
  CHUNK_SHIFT,
  cellIndex,
  chunkKey,
  createChunk,
  type Chunk,
} from './chunk';

/** Cells this close to the edge of the valley stay free, so nothing is built against the invisible wall. */
const BUILD_MARGIN = 4;
/** Tall enough to tower over the highest terrain (the ground tops out below 72). */
const BUILD_HEIGHT = 96;

/** The cells a player may build in, both ends included. */
export const BUILD_BOUNDS = {
  minX: -WORLD_HALF + BUILD_MARGIN,
  maxX: WORLD_HALF - BUILD_MARGIN - 1,
  minY: 0,
  maxY: BUILD_HEIGHT - 1,
  minZ: -WORLD_HALF + BUILD_MARGIN,
  maxZ: WORLD_HALF - BUILD_MARGIN - 1,
} as const;

export function inBuildBounds(x: number, y: number, z: number): boolean {
  return (
    x >= BUILD_BOUNDS.minX &&
    x <= BUILD_BOUNDS.maxX &&
    y >= BUILD_BOUNDS.minY &&
    y <= BUILD_BOUNDS.maxY &&
    z >= BUILD_BOUNDS.minZ &&
    z <= BUILD_BOUNDS.maxZ
  );
}

const CX_MIN = BUILD_BOUNDS.minX >> CHUNK_SHIFT;
const CX_MAX = BUILD_BOUNDS.maxX >> CHUNK_SHIFT;
const CY_MAX = BUILD_BOUNDS.maxY >> CHUNK_SHIFT;
const CZ_MIN = BUILD_BOUNDS.minZ >> CHUNK_SHIFT;
const CZ_MAX = BUILD_BOUNDS.maxZ >> CHUNK_SHIFT;
if (
  CX_MIN < CHUNK_KEY_RANGE.minXZ ||
  CX_MAX > CHUNK_KEY_RANGE.maxXZ ||
  CZ_MIN < CHUNK_KEY_RANGE.minXZ ||
  CZ_MAX > CHUNK_KEY_RANGE.maxXZ ||
  CY_MAX > CHUNK_KEY_RANGE.maxY
) {
  throw new Error('The buildable area does not fit in a chunk key');
}

/** A cell whose lowest corner is this close to the ground, or closer, rests on it. */
const TOUCH_DISTANCE = 0.05;

/** Why a placement or a break is refused. The strings are what `checkPlace` and `checkBreak` return. */
export type PlaceRefusal =
  'unknown-block' | 'out-of-bounds' | 'occupied' | 'buried' | 'unsupported';
export type BreakRefusal = 'out-of-bounds' | 'empty';

export type ChunkDirtyListener = (cx: number, cy: number, cz: number) => void;

/**
 * The voxel world: every block players have built on top of the seeded valley. Terrain is static
 * in version 1 and never travels over the wire, so the cells held here are exactly the edits.
 *
 * Edits go through `setBlock`, which is idempotent and cheap. It marks the chunk and any chunk
 * whose mesh can see the cell as dirty and does nothing else; the renderer drains the dirty
 * list once per frame and re-meshes what it can afford.
 */
export class VoxelWorld implements BlockWorld {
  private readonly chunks = new Map<number, Chunk>();
  private readonly dirty = new Set<number>();
  private readonly dirtyListeners = new Set<ChunkDirtyListener>();
  private lastChunk: Chunk | null = null;
  private cellCount = 0;
  private editCount = 0;

  constructor(
    readonly seed: number,
    readonly terrain: Terrain,
  ) {}

  /** How many cells hold a block. */
  get blockCount(): number {
    return this.cellCount;
  }

  /** Counts every change to a cell, so a reader can tell cheaply that something moved. */
  get revision(): number {
    return this.editCount;
  }

  /** How many chunks hold at least one block. */
  get chunkCount(): number {
    return this.chunks.size;
  }

  getBlock(x: number, y: number, z: number): CellState {
    if (!inBuildBounds(x, y, z)) return 0;
    const cx = x >> CHUNK_SHIFT;
    const cy = y >> CHUNK_SHIFT;
    const cz = z >> CHUNK_SHIFT;
    let chunk = this.lastChunk;
    if (chunk === null || chunk.cx !== cx || chunk.cy !== cy || chunk.cz !== cz) {
      chunk = this.chunks.get(chunkKey(cx, cy, cz)) ?? null;
      if (chunk === null) return 0;
      this.lastChunk = chunk;
    }
    return chunk.cells[cellIndex(x & CHUNK_MASK, y & CHUNK_MASK, z & CHUNK_MASK)] as number;
  }

  /** True when the cell holds a block, which is what movement and the camera ask. */
  isSolid(x: number, y: number, z: number): boolean {
    return this.getBlock(x, y, z) !== 0;
  }

  setBlock(x: number, y: number, z: number, state: CellState): boolean {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return false;
    if (!inBuildBounds(x, y, z) || !isCellState(state)) return false;
    const cx = x >> CHUNK_SHIFT;
    const cy = y >> CHUNK_SHIFT;
    const cz = z >> CHUNK_SHIFT;
    const lx = x & CHUNK_MASK;
    const ly = y & CHUNK_MASK;
    const lz = z & CHUNK_MASK;
    const index = cellIndex(lx, ly, lz);
    const key = chunkKey(cx, cy, cz);
    let chunk = this.chunks.get(key);
    const previous = chunk ? (chunk.cells[index] as number) : 0;
    if (previous === state) return false;
    if (!chunk) {
      chunk = createChunk(cx, cy, cz);
      this.chunks.set(key, chunk);
    }
    chunk.cells[index] = state;
    chunk.version++;
    this.editCount++;
    const delta = (state !== 0 ? 1 : 0) - (previous !== 0 ? 1 : 0);
    chunk.count += delta;
    this.cellCount += delta;
    if (chunk.count === 0) {
      this.chunks.delete(key);
      if (this.lastChunk === chunk) this.lastChunk = null;
    }
    this.markDirty(cx, cy, cz, lx, ly, lz);
    return true;
  }

  checkPlace(x: number, y: number, z: number, state: CellState): PlaceRefusal | null {
    if (!isKnownState(state)) return 'unknown-block';
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z))
      return 'out-of-bounds';
    if (!inBuildBounds(x, y, z)) return 'out-of-bounds';
    if (this.getBlock(x, y, z) !== 0) return 'occupied';
    const grid = this.terrain.grid;
    let lowest = Infinity;
    let highest = -Infinity;
    for (let corner = 0; corner < 8; corner++) {
      const d = grid.sample(x + (corner & 1), y + ((corner >> 1) & 1), z + ((corner >> 2) & 1));
      if (d < lowest) lowest = d;
      if (d > highest) highest = d;
    }
    // Every corner inside the ground: the block would be invisible, and a player could wall
    // themselves into the hill.
    if (highest < 0) return 'buried';
    if (lowest <= TOUCH_DISTANCE) return null;
    return this.touchesBlock(x, y, z) ? null : 'unsupported';
  }

  checkBreak(x: number, y: number, z: number): BreakRefusal | null {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z))
      return 'out-of-bounds';
    if (!inBuildBounds(x, y, z)) return 'out-of-bounds';
    return this.getBlock(x, y, z) === 0 ? 'empty' : null;
  }

  forEachEdit(visit: (x: number, y: number, z: number, state: CellState) => void): void {
    this.forEachChunk((chunk) => {
      const x0 = chunk.cx << CHUNK_SHIFT;
      const y0 = chunk.cy << CHUNK_SHIFT;
      const z0 = chunk.cz << CHUNK_SHIFT;
      const cells = chunk.cells;
      for (let i = 0; i < cells.length; i++) {
        const state = cells[i] as number;
        if (state === 0) continue;
        visit(
          x0 + (i & CHUNK_MASK),
          y0 + (i >> (2 * CHUNK_SHIFT)),
          z0 + ((i >> CHUNK_SHIFT) & CHUNK_MASK),
          state,
        );
      }
    });
  }

  /** The chunk at chunk coordinates, or undefined when it holds no block. */
  getChunk(cx: number, cy: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy, cz));
  }

  getChunkByKey(key: number): Chunk | undefined {
    return this.chunks.get(key);
  }

  /** Visits every chunk that holds a block, sorted by y, then z, then x. */
  forEachChunk(visit: (chunk: Chunk) => void): void {
    const keys = [...this.chunks.keys()].sort((a, b) => a - b);
    for (const key of keys) visit(this.chunks.get(key) as Chunk);
  }

  /**
   * Calls `listener` each time a chunk becomes dirty, meaning a block in it or next to it
   * changed since the last `drainDirty`. A chunk that is already dirty does not call it again.
   * Returns a function that removes the listener. The renderer uses this to wake up.
   */
  onChunkDirty(listener: ChunkDirtyListener): () => void {
    this.dirtyListeners.add(listener);
    return () => this.dirtyListeners.delete(listener);
  }

  /** How many chunks are waiting to be re-meshed. */
  get dirtyCount(): number {
    return this.dirty.size;
  }

  /**
   * Returns the keys of up to `limit` dirty chunks, lowest first, and marks them clean. A key may
   * name a chunk that no longer holds a block (its last block was broken), which means its mesh
   * should be removed. Read the coordinates back with `chunkCoords`.
   */
  drainDirty(limit = Infinity): number[] {
    const keys = [...this.dirty].sort((a, b) => a - b);
    const taken = limit >= keys.length ? keys : keys.slice(0, limit);
    for (const key of taken) this.dirty.delete(key);
    return taken;
  }

  private touchesBlock(x: number, y: number, z: number): boolean {
    return (
      this.getBlock(x - 1, y, z) !== 0 ||
      this.getBlock(x + 1, y, z) !== 0 ||
      this.getBlock(x, y - 1, z) !== 0 ||
      this.getBlock(x, y + 1, z) !== 0 ||
      this.getBlock(x, y, z - 1) !== 0 ||
      this.getBlock(x, y, z + 1) !== 0
    );
  }

  /**
   * Marks the chunk of a changed cell dirty, and every neighbor chunk whose mesh reads that cell.
   * A mesh looks one cell past its own edge (hidden faces, ambient occlusion, chamfers), so a
   * cell on a face, an edge or a corner of its chunk also dirties the 1, 3 or 7 chunks beside it.
   */
  private markDirty(cx: number, cy: number, cz: number, lx: number, ly: number, lz: number): void {
    const ox = lx === 0 ? -1 : lx === CHUNK_MASK ? 1 : 0;
    const oy = ly === 0 ? -1 : ly === CHUNK_MASK ? 1 : 0;
    const oz = lz === 0 ? -1 : lz === CHUNK_MASK ? 1 : 0;
    for (let a = 0; a <= (ox !== 0 ? 1 : 0); a++) {
      for (let b = 0; b <= (oy !== 0 ? 1 : 0); b++) {
        for (let c = 0; c <= (oz !== 0 ? 1 : 0); c++) {
          this.dirtyChunk(cx + a * ox, cy + b * oy, cz + c * oz);
        }
      }
    }
  }

  private dirtyChunk(cx: number, cy: number, cz: number): void {
    // No block can exist outside the buildable area, so nothing there ever needs a mesh.
    if (cx < CX_MIN || cx > CX_MAX || cz < CZ_MIN || cz > CZ_MAX || cy < 0 || cy > CY_MAX) return;
    const key = chunkKey(cx, cy, cz);
    if (this.dirty.has(key)) return;
    this.dirty.add(key);
    for (const listener of this.dirtyListeners) listener(cx, cy, cz);
  }
}

/** Builds the world for a seed: the terrain it stands on and an empty set of blocks. */
export function createWorld(seed: number, terrain: Terrain = bakeTerrain(seed)): VoxelWorld {
  return new VoxelWorld(seed, terrain);
}
