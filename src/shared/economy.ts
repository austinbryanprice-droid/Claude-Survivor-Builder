import { MATERIALS } from './blocks';
import type { Unsubscribe } from './survival-state';

/**
 * What the economy looks like from outside: the crew's shared pool of materials, the heaps of
 * debris lying in the valley that fill it, and the read-only views every peer (the host and the
 * guests alike) gives the screen. Pure types and arithmetic, so the host's simulation, the guests'
 * mirror and the HUD read the same numbers the same way. The rules that move the numbers are in
 * `systems/economy`.
 */

/** The materials the shared pool keeps, in tier order. A stock is an array in this order. */
export const POOL_MATERIALS: readonly number[] = MATERIALS.map((material) => material.id);
export const POOL_SLOTS = POOL_MATERIALS.length;

/** Where a material sits in a stock, or -1 for an id the pool does not keep. */
export function poolSlot(material: number): number {
  return POOL_MATERIALS.indexOf(material);
}

/**
 * What a screen needs to know about the pool, read once a frame. The object is reused from call to
 * call, so read what you need and do not keep it.
 */
export interface EconomyReading {
  /** How much of each material the crew holds, in `POOL_MATERIALS` order. */
  stock: number[];
  /** The most the pool holds of any one material. 0 where there is no run to show. */
  cap: number;
  /** The research points the crew has earned this run. They are never spent. */
  research: number;
  /** The points a Research Terminal has read: the part of `research` that has opened anything. */
  claimed: number;
  /** The highest material tier the crew has researched: 1 (Scrap) until a Terminal has read points that say more. */
  tier: number;
}

export function createEconomyReading(): EconomyReading {
  return { stock: new Array<number>(POOL_SLOTS).fill(0), cap: 0, research: 0, claimed: 0, tier: 1 };
}

/**
 * A heap of wreckage the crew can strip for materials. The valley's seed and the host's ground
 * make the list once per run; the host sends it to every guest, so no two screens can disagree
 * about where a heap is even if their floating-point sums differ in the last place.
 */
export interface DebrisNode {
  /** Position in the run's list; the list is the same on every peer, so this names a node. */
  readonly index: number;
  /** The middle of the heap where it meets the ground, in blocks. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Which way it lies, in radians about the vertical axis. */
  readonly yaw: number;
  /** How big it is drawn, around 1. */
  readonly scale: number;
  /** How many times it can be stripped before it is gone. */
  readonly harvests: number;
  /** The material it gives, as a `MATERIAL` id. */
  readonly grade: number;
  /** 0 for a heap that lies there from the start, otherwise the number of the night whose dawn uncovers it. */
  readonly from: number;
}

/** A player stripped a heap: who, which heap, what they got and what is left of it. */
export interface HarvestEvent {
  /** The player who did it. */
  readonly by: number;
  readonly node: number;
  readonly material: number;
  /** What went into the pool. Less than the heap offered when the pool was nearly full. */
  readonly gained: number;
  /** Strips the heap has left; 0 means it is gone. */
  readonly left: number;
  /** True when the pool had no room for all of it. */
  readonly full: boolean;
}

/** The heaps in the valley and what is left of each, as this peer sees them. */
export interface DebrisView {
  /** The run's list of heaps; replaced as a whole when a run starts over. */
  readonly nodes: readonly DebrisNode[];
  /** Strips a heap has left: 0 for one that is gone or not uncovered yet, and for an index there is no heap at. */
  leftOf(index: number): number;
  /** Changes whenever a heap is stripped, uncovered or the list is replaced, so a renderer knows when to look again. */
  readonly version: number;
  /** A heap was stripped, by anyone. */
  onHarvest(listener: (event: HarvestEvent) => void): Unsubscribe;
}

/** The economy as a screen reads it. */
export interface EconomyView {
  read(out: EconomyReading): EconomyReading;
  readonly debris: DebrisView;
}

/** What a host without an economy shows: an empty pool, no heaps. */
export const IDLE_ECONOMY: EconomyView = {
  read(out) {
    out.stock.fill(0);
    out.cap = 0;
    out.research = 0;
    out.claimed = 0;
    out.tier = 1;
    return out;
  },
  debris: {
    nodes: [],
    leftOf: () => 0,
    version: 0,
    onHarvest: () => () => undefined,
  },
};
