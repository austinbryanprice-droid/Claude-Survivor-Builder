import type { SolidQuery } from './solid';

/**
 * Opaque cell value. 0 is empty and 1 to 65535 is whatever the voxel world packs into it (the block
 * id now, a slab or wedge shape and rotation later). The net layer carries it and never looks inside.
 */
export type CellState = number;

/**
 * What the net layer needs from the voxel world. The world implements this; the session applies
 * every authoritative event through `setBlock`, so input code never mutates the world directly.
 */
export interface BlockWorld extends SolidQuery {
  /** Terrain seed. A joiner builds its terrain from the host's seed. */
  readonly seed: number;
  /** 0 when the cell is empty. */
  getBlock(x: number, y: number, z: number): CellState;
  /** Applies an authoritative edit and marks the affected chunks dirty. True if the cell changed. */
  setBlock(x: number, y: number, z: number, state: CellState): boolean;
  /** World-state legality only: in bounds, cell empty, not inside terrain, known id. null = legal. */
  checkPlace(x: number, y: number, z: number, state: CellState): string | null;
  /** World-state legality only: a player-made block is there and may be broken. null = legal. */
  checkBreak(x: number, y: number, z: number): string | null;
  /**
   * Every player-made cell (cells that differ from the seeded terrain), in a deterministic order.
   * Used for late-join snapshots and, in Phase 6, saves.
   */
  forEachEdit(visit: (x: number, y: number, z: number, state: CellState) => void): void;
}
