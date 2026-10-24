import type { CellState } from '../../shared/block-world';
import { MATERIALS } from '../../shared/blocks';
import {
  createEconomyReading,
  type DebrisNode,
  type EconomyReading,
  type HarvestEvent,
} from '../../shared/economy';
import { hash3 } from '../../shared/hash';
import { DEBRIS, POOL } from './balance';
import { DEBRIS_IN_THE_WAY, heapInTheWay, pieceCost, shortfall } from './build-rules';
import { Pool } from './pool';

/**
 * The host's economy for one run: the crew's shared pool and the field of debris that fills it.
 * It is pure (no DOM, no three.js, no network) and keeps no clock of its own; the survival
 * simulation tells it when a dawn comes, and the session tells it when a player strips a heap,
 * places a block (which the pool pays for) or breaks one (which the pool gets back).
 * What a strip yields comes from a hash of the seed, the heap and how many strips it has given,
 * so a run plays the same every time and a test can say what the next strip gives.
 */

const YIELD_SALT = 0x91e1d;

/** Why a strip did not happen: there is no heap there, it has nothing left, or the pool has no room. */
export type HarvestRefusal = 'nothing' | 'depleted' | 'full';

export type HarvestResult =
  | { readonly ok: true; readonly event: HarvestEvent }
  | { readonly ok: false; readonly reason: HarvestRefusal };

/** An opening stock of `amount` of every material, for the `?stock=` switch and for tests that build a lot. */
export function evenStock(amount: number): Record<number, number> {
  return Object.fromEntries(MATERIALS.map((material) => [material.id, amount]));
}

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
  /** Whether each heap has come up out of the ground: the heaps of the first batch have, the others wait for a dawn. */
  private readonly risen: boolean[];
  /** The heap that lies in each cell (by `cellKey`), so a command that names a cell finds it. */
  private readonly byCell = new Map<number, number>();
  private gatheredTotal = 0;
  private versionValue = 0;

  /** `start` is what the pool opens with, by material id; the table's start unless a test or the `?stock=` switch says otherwise. */
  constructor(
    private readonly seed: number,
    readonly nodes: readonly DebrisNode[],
    start: Readonly<Record<number, number>> = POOL.start,
  ) {
    this.pool = new Pool(POOL.cap, start);
    this.risen = nodes.map((node) => node.from === 0);
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

  /**
   * A dawn: the heaps that night `night` and the nights before it leave uncovered come up out of the
   * ground for the day. Returns how many did. A heap whose ground has a block built on it
   * (`builtOver` says so) waits for a later dawn, when the block may be gone, rather than rise
   * through the crew's work or take it down.
   */
  dawn(night: number, builtOver?: (node: DebrisNode) => boolean): number {
    let uncovered = 0;
    for (const node of this.nodes) {
      if (node.from > night || this.risen[node.index]) continue;
      if (builtOver?.(node)) continue;
      this.risen[node.index] = true;
      this.left[node.index] = node.harvests;
      uncovered++;
    }
    if (uncovered > 0) this.versionValue++;
    return uncovered;
  }

  /**
   * Why the crew cannot place `state` at a cell, in the host's words, or null when it can: a heap
   * of debris lying there keeps the cell clear, and the pool must hold what the piece costs.
   */
  placementRefusal(x: number, y: number, z: number, state: CellState): string | null {
    if (heapInTheWay(this, x, y, z)) return DEBRIS_IN_THE_WAY;
    return shortfall((material) => this.pool.amount(material), state);
  }

  /** The crew pays for a piece it has placed. False, and nothing taken, when the pool cannot pay. */
  pay(state: CellState): boolean {
    const cost = pieceCost(state);
    return cost === null || this.pool.take(cost.material, cost.amount);
  }

  /** A piece the crew broke goes back into the pool, as far as the ceiling allows. Returns what went in. */
  refund(state: CellState): number {
    const cost = pieceCost(state);
    return cost === null ? 0 : this.pool.add(cost.material, cost.amount);
  }

  /** Fills `out` with the pool as it stands. */
  read(out: EconomyReading = createEconomyReading()): EconomyReading {
    this.pool.read(out.stock);
    out.cap = this.pool.cap;
    return out;
  }
}
