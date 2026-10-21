import { CHUNK_SIZE, chunkCoords, type ChunkCoords } from './chunk';

/**
 * The chunks waiting to be meshed. The renderer takes them nearest first, so the blocks around
 * the player change before anything far away, and a big change (a late-join snapshot, a whole
 * outpost) spreads over several frames instead of stalling one.
 */
export class RemeshQueue {
  private readonly pending = new Set<number>();
  private readonly scratch: ChunkCoords = { cx: 0, cy: 0, cz: 0 };

  get size(): number {
    return this.pending.size;
  }

  add(key: number): void {
    this.pending.add(key);
  }

  has(key: number): boolean {
    return this.pending.has(key);
  }

  delete(key: number): boolean {
    return this.pending.delete(key);
  }

  clear(): void {
    this.pending.clear();
  }

  /**
   * The waiting chunks, nearest to the point (x, y, z) first. Chunks equally far come in key
   * order, so the order never depends on how they were added.
   */
  nearestFirst(x: number, y: number, z: number): number[] {
    const half = CHUNK_SIZE / 2;
    const keys = [...this.pending];
    const distance = new Map<number, number>();
    for (const key of keys) {
      const c = chunkCoords(key, this.scratch);
      const dx = c.cx * CHUNK_SIZE + half - x;
      const dy = c.cy * CHUNK_SIZE + half - y;
      const dz = c.cz * CHUNK_SIZE + half - z;
      distance.set(key, dx * dx + dy * dy + dz * dz);
    }
    return keys.sort((a, b) => (distance.get(a) as number) - (distance.get(b) as number) || a - b);
  }
}
