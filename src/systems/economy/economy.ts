import {
  createEconomyReading,
  type DebrisNode,
  type EconomyReading,
  type HarvestEvent,
} from '../../shared/economy';
import { hash3 } from '../../shared/hash';
import { DEBRIS, POOL } from './balance';
import { Pool } from './pool';

/**
 * The host's economy for one run: the crew's shared pool and the field of debris that fills it.
 * It is pure (no DOM, no three.js, no network) and keeps no clock of its own; the survival
 * simulation tells it when a dawn comes, and the session tells it when a player strips a heap.
 * What a strip yields comes from a hash of the seed, the heap and how many strips it has given,
 * so a run plays the same every time and a test can say what the next strip gives.
 */

const YIELD_SALT = 0x91e1d;

/** Why a strip did not happen: there is no heap there, it has nothing left, or the pool has no room. */
export type HarvestRefusal = 'nothing' | 'depleted' | 'full';

export type HarvestResult =
  | { readonly ok: true; readonly event: HarvestEvent }
  | { readonly ok: false; readonly reason: HarvestRefusal };

/** What a cell holds in the lookup of heaps: one number for each cell of the valley, large enough for any height. */
export function cellKey(x: number, y: number, z: number): number {
  return ((x + 1024) * 2048 + (z + 1024)) * 128 + y;
}

/** What the strip number `ordinal` (counting from 0) of a heap gives. */
export function stripYield(seed: number, node: number, ordinal: number): number {
  const span = DEBRIS.yield.max - DEBRIS.yield.min + 1;
  return DEBRIS.yield.min + (hash3(seed, YIELD_SALT, node, ordinal) % span);
}

export class Economy {
  readonly pool: Pool;
  private readonly left: number[];
  /** The heap that lies in each cell (by `cellKey`), so a command that names a cell finds it. */
  private readonly byCell = new Map<number, number>();
  private gatheredTotal = 0;
  private versionValue = 0;

  constructor(
    private readonly seed: number,
    readonly nodes: readonly DebrisNode[],
  ) {
    this.pool = new Pool(POOL.cap, POOL.start);
    this.left = nodes.map((node) => (node.from === 0 ? node.harvests : 0));
    for (const node of nodes) {
      this.byCell.set(
        cellKey(Math.floor(node.x), Math.floor(node.y), Math.floor(node.z)),
        node.index,
      );
    }
  }

  /** Everything the crew has gathered this run, all materials together. */
  get gathered(): number {
    return this.gatheredTotal;
  }

  /** Changes whenever a heap is stripped or uncovered. */
  get version(): number {
    return this.versionValue;
  }

  /** Strips a heap has left: 0 for a heap that is gone or not uncovered yet. */
  leftOf(index: number): number {
    return this.left[index] ?? 0;
  }

  /** Every heap's strips left, in list order. */
  leftAll(): readonly number[] {
    return this.left;
  }

  /** The heap whose middle is in the cell, or undefined. */
  nodeAt(x: number, y: number, z: number): DebrisNode | undefined {
    const index = this.byCell.get(cellKey(x, y, z));
    return index === undefined ? undefined : this.nodes[index];
  }

  /** The strip a heap would give next: what it is worth, or 0 for a heap with nothing left. */
  nextYield(index: number): number {
    const node = this.nodes[index];
    const left = this.left[index] ?? 0;
    return node && left > 0 ? stripYield(this.seed, index, node.harvests - left) : 0;
  }

  /**
   * Player `by` strips heap `index`: the strip goes into the pool, as much of it as the pool has
   * room for. A heap with nothing left, and a pool that is full of what the heap gives, refuse.
   */
  harvest(index: number, by: number): HarvestResult {
    const node = this.nodes[index];
    if (!node) return { ok: false, reason: 'nothing' };
    const left = this.left[index] as number;
    if (left <= 0) return { ok: false, reason: 'depleted' };
    const offered = stripYield(this.seed, index, node.harvests - left);
    const gained = this.pool.add(node.grade, offered);
    if (gained <= 0) return { ok: false, reason: 'full' };
    this.left[index] = left - 1;
    this.gatheredTotal += gained;
    this.versionValue++;
    return {
      ok: true,
      event: {
        by,
        node: index,
        material: node.grade,
        gained,
        left: left - 1,
        full: gained < offered,
      },
    };
  }

  /** A dawn: the heaps that night `night` leaves uncovered are there for the day. Returns how many. */
  dawn(night: number): number {
    let uncovered = 0;
    for (const node of this.nodes) {
      if (node.from !== night || (this.left[node.index] as number) > 0) continue;
      this.left[node.index] = node.harvests;
      uncovered++;
    }
    if (uncovered > 0) this.versionValue++;
    return uncovered;
  }

  /** Fills `out` with the pool as it stands. */
  read(out: EconomyReading = createEconomyReading()): EconomyReading {
    this.pool.read(out.stock);
    out.cap = this.pool.cap;
    return out;
  }
}
