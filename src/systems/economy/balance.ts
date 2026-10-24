import { MATERIAL } from '../../shared/blocks';

/**
 * Every number that shapes the economy, in one table so it can be tuned and tested without
 * hunting through the code (docs/decisions.md, Phase 5a). They are first guesses to be tuned by
 * playing, and later by the balance simulator: the spec asks for enough materials in a day for one
 * or two meaningful upgrades, and for progress to feel fast early and earned later.
 */

/** The crew's shared pool of materials. */
export const POOL = {
  /** What the pool holds when a run begins, by material id; a material that is not listed starts at 0. */
  start: { [MATERIAL.scrap]: 30 } as Readonly<Record<number, number>>,
  /** The most the pool holds of any one material, until Storage (Phase 5g) raises it. */
  cap: 400,
} as const;

/**
 * Heaps of wreckage in the valley: the station came down in pieces, and the crew strips what it
 * can use from them (SPEC section 8: debris nodes are finite and deplete; new ones appear slowly,
 * or farther away). The whole field is drawn from the seed when the run starts; the first heaps
 * lie in the open and the rest are uncovered, a few at a time, at each dawn.
 */
export const DEBRIS = {
  /** Heaps lying in the valley when the run begins. */
  initial: 22,
  /** Heaps each dawn uncovers, and how many dawns do (the field is finite and generated up front). */
  perDawn: 4,
  dawns: 12,

  /**
   * How far from the middle of the Core a heap lies, in blocks: the first heaps between `inner`
   * and `outer`, and the heaps of each later dawn in a band that starts `ringStep` farther out
   * than the dawn before it, up to `limit`. The machines come in from 46 blocks out, so the farther
   * heaps are the riskier ones to fetch by night.
   */
  inner: 16,
  outer: 40,
  ringStep: 1.5,
  ringWidth: 18,
  limit: 62,

  /** No two heaps lie closer than this, and none lies closer than this to the edge of the valley. */
  gap: 6,
  edge: 10,
  /** The ground under a heap is level enough (the cosine of the slope) and this much above the water. */
  flatness: 0.9,
  dry: 0.8,
  /** How hard the generator tries to find a place for each heap before it gives up on it. */
  attempts: 60,

  /** Strips a heap gives before it is gone, and what each strip gives, both whole numbers from `min` to `max`. */
  harvests: { min: 2, max: 4 },
  yield: { min: 8, max: 12 },
  /** How big a heap is drawn: a multiple of its model, from `min` to `max`. */
  size: { min: 0.85, max: 1.25 },

  /** How far from a player's eyes the middle of a heap can be for the player to strip it, in blocks. */
  reach: 4.5,
  /** How high above the ground the middle of a heap is, in blocks: reach is measured to it and the cursor aims at it. */
  lift: 0.75,
  /** How far from its middle the cursor can be and still be on a heap, in blocks, before its size is counted in. */
  radius: 1.5,
  /** Seconds the host makes a player wait between strips. */
  cooldown: 0.5,
  /**
   * Seconds a player's own hands wait between the strips their screen asks for: a little longer than
   * the host's cooldown, so that the jitter of a network never makes the host refuse a strip the
   * hands were slow enough to ask for. Low Energy stretches it, as it does the blaster's pace.
   */
  pace: 0.6,
} as const;
