import type { SolidQuery } from './solid';

/**
 * Opaque value of one voxel cell. 0 is empty. Anything else packs a shape and a material (see
 * `blocks.ts`), and the net layer never looks inside it, so new shapes and tiers do not change
 * the wire format.
 */
export type CellState = number;

/**
 * What the command path and the game need from the voxel world. The world is a pure data
 * structure: it never decides who may build, only whether the world's own state allows an edit.
 * Reach, cost, "not inside a player" and rate limits are the host's rules, added on top of
 * `checkPlace` and `checkBreak` in `src/net`.
 *
 * Every peer, the host included, changes the world through `setBlock` only, and only with edits
 * the host has accepted. Cells are addressed by integer coordinates.
 */
export interface BlockWorld extends SolidQuery {
  /** Terrain seed. A joiner builds its terrain from the host's seed. */
  readonly seed: number;

  /** The state of a cell, or 0 when it is empty or outside the buildable area. */
  getBlock(x: number, y: number, z: number): CellState;

  /**
   * Applies an authoritative edit and marks the affected chunks dirty. Returns true when the cell
   * changed, so it is idempotent: setting a cell to the state it already has does nothing. It
   * never remeshes (a late-join snapshot calls it for every edit), and it ignores coordinates
   * outside the buildable area and values that are not a 16-bit whole number.
   */
  setBlock(x: number, y: number, z: number, state: CellState): boolean;

  /**
   * World-state legality of placing `state` at a cell: inside the buildable area, the cell is
   * empty, not buried in the terrain, touching a block or the terrain surface, and a known
   * piece. Returns null when legal, otherwise a short reason such as 'occupied'.
   */
  checkPlace(x: number, y: number, z: number, state: CellState): string | null;

  /** World-state legality of breaking a cell: a player-made block is there. Null when legal. */
  checkBreak(x: number, y: number, z: number): string | null;

  /**
   * Every player-made cell (cells that differ from the seeded base world), in a deterministic
   * order that does not depend on the order of the edits. Used for late-join snapshots and saves.
   */
  forEachEdit(visit: (x: number, y: number, z: number, state: CellState) => void): void;
}
