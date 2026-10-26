import type { CellState } from '../../shared/block-world';
import {
  MATERIAL,
  MATERIALS,
  MODULE,
  materialTier,
  moduleOfShape,
  stateShape,
} from '../../shared/blocks';
import {
  createEconomyReading,
  type DebrisNode,
  type EconomyReading,
  type HarvestEvent,
} from '../../shared/economy';
import { hash3 } from '../../shared/hash';
import { POOL } from './balance';
import {
  DEBRIS_IN_THE_WAY,
  heapInTheWay,
  lockedRefusal,
  pieceCost,
  shortfall,
  upgradeRefusal,
} from './build-rules';
import { yieldOfGrade } from './grades';
import { Pool } from './pool';
import { Research } from './research';

/**
 * The host's economy for one run: the crew's shared pool and the field of debris that fills it.
 * It is pure (no DOM, no three.js, no network) and keeps no clock of its own; the survival
 * simulation tells it when a dawn comes, and the session tells it when a player strips a heap,
 * places a block (which the pool pays for) or breaks one (which the pool gets back).
 * What a strip yields comes from a hash of the seed, the heap and how many strips it has given,
 * so a run plays the same every time and a test can say what the next strip gives. It keeps the
 * run's research too (5c), because what the crew has researched decides which materials its heaps
 * give up and which blocks it may place.
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

/** What the strip number `ordinal` (counting from 0) of a heap of this grade gives. */
export function stripYield(
  seed: number,
  node: number,
  ordinal: number,
  grade: number = MATERIAL.scrap,
): number {
  const { min, max } = yieldOfGrade(grade);
  return min + (hash3(seed, YIELD_SALT, node, ordinal) % (max - min + 1));
}

export class Economy {
  readonly pool: Pool;
  /** The points the crew has earned by surviving nights, and the material tiers they have opened. */
  readonly research = new Research();
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
    return node && left > 0 ? stripYield(this.seed, index, node.harvests - left, node.grade) : 0;
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
    const offered = stripYield(this.seed, index, node.harvests - left, node.grade);
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
   * through the crew's work or take it down, and so does a heap of a material the crew has not
   * researched yet, which comes up at the first dawn after the research is done.
   */
  dawn(night: number, builtOver?: (node: DebrisNode) => boolean): number {
    let uncovered = 0;
    for (const node of this.nodes) {
      if (node.from > night || this.risen[node.index]) continue;
      if (materialTier(node.grade) > this.research.tier) continue;
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
   * of debris lying there keeps the cell clear, the piece's material must be researched, and the
   * pool must hold what the piece costs.
   */
  placementRefusal(x: number, y: number, z: number, state: CellState): string | null {
    if (heapInTheWay(this, x, y, z)) return DEBRIS_IN_THE_WAY;
    return (
      lockedRefusal(this.research.tier, state) ??
      shortfall((material) => this.pool.amount(material), state)
    );
  }

  /**
   * Why the crew cannot upgrade the piece `state` in place now, in the host's words, or null when it
   * can: nothing is there or nothing is better, the better material is not researched, or the pool
   * cannot pay for it (Phase 5e). The crew pays the better piece's price with `pay`.
   */
  upgradeRefusal(state: CellState): string | null {
    return upgradeRefusal(this.research.tier, (material) => this.pool.amount(material), state);
  }

  /** The crew pays for a piece it has placed. False, and nothing taken, when the pool cannot pay. */
  pay(state: CellState): boolean {
    const cost = pieceCost(state);
    return cost === null || this.pool.take(cost.material, cost.amount);
  }

  /**
   * A piece the crew paid for now stands. A Research Terminal reads the points the crew has earned
   * so far, so what they open is open from this moment, and stays open if the Terminal goes.
   */
  placed(state: CellState): void {
    if (moduleOfShape(stateShape(state))?.id === MODULE.terminal) this.research.claim();
  }

  /** A piece the crew broke goes back into the pool, as far as the ceiling allows. Returns what went in. */
  refund(state: CellState): number {
    const cost = pieceCost(state);
    return cost === null ? 0 : this.pool.add(cost.material, cost.amount);
  }

  /** Fills `out` with the pool and the research as they stand. */
  read(out: EconomyReading = createEconomyReading()): EconomyReading {
    this.pool.read(out.stock);
    out.cap = this.pool.cap;
    out.research = this.research.points;
    out.claimed = this.research.claimed;
    out.tier = this.research.tier;
    return out;
  }
}
