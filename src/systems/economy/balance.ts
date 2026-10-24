import { MATERIAL } from '../../shared/blocks';

/**
 * Every number that shapes the economy, in one table so it can be tuned and tested without
 * hunting through the code (docs/decisions.md, Phases 5a to 5c). They are first guesses to be tuned
 * by playing, and later by the balance simulator: the spec asks for enough materials in a day for
 * one or two meaningful upgrades, and for progress to feel fast early and earned later.
 */

/** The crew's shared pool of materials. */
export const POOL = {
  /** What the pool holds when a run begins, by material id; a material that is not listed starts at 0. */
  start: { [MATERIAL.scrap]: 30 } as Readonly<Record<number, number>>,
  /** The most the pool holds of any one material, until Storage (Phase 5h) raises it. */
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

  /** Strips a heap of Scrap gives before it is gone, and what each strip gives, both whole numbers from `min` to `max`. */
  harvests: { min: 2, max: 4 },
  yield: { min: 8, max: 12 },
  /**
   * The better grades of heap (SPEC section 9: higher tiers "appear less frequently or require
   * research unlocks", and the notes: a heap gives 8 to 12 Scrap). Each takes one place in every
   * dawn's batch from the batch `from` on: the heap drawn `slot`th of the batch (counting from 0)
   * is of that grade. A heap of a grade whose tier is not researched yet is not uncovered at its
   * dawn; it waits for a later one. They give less than Scrap, in fewer strips, because a block
   * costs one of them and the upgrades that spend them are few (Phase 5e on).
   */
  grades: [
    {
      material: MATERIAL.composite,
      from: 2,
      slot: 3,
      harvests: { min: 2, max: 3 },
      yield: { min: 5, max: 7 },
    },
    {
      material: MATERIAL.alloy,
      from: 5,
      slot: 2,
      harvests: { min: 2, max: 2 },
      yield: { min: 4, max: 6 },
    },
  ],
  /** How big a heap is drawn: a multiple of its model, from `min` to `max`. */
  size: { min: 0.85, max: 1.25 },

  /** How far from a player's eyes the middle of a heap can be for the player to strip it, in blocks. */
  reach: 4.5,
  /** How high above the ground the middle of a heap is, in blocks: reach is measured to it and the cursor aims at it. */
  lift: 0.75,
  /** How far from its middle the cursor can be and still be on a heap, in blocks, before its size is counted in. */
  radius: 1.5,
  /**
   * The room a heap keeps clear of blocks while it lies there, so that nothing is built on top of it
   * (Phase 5b): a column round its middle, `radius` across and `height` tall for a heap of size 1
   * (a bigger heap keeps more clear), reaching `below` under the ground its middle is on. The pile
   * is drawn about as wide and tall as this; its mast is thin and goes higher.
   */
  keepClear: { radius: 1.7, height: 2.4, below: 0.5 },
  /** Seconds the host makes a player wait between strips. */
  cooldown: 0.5,
  /**
   * Seconds a player's own hands wait between the strips their screen asks for: a little longer than
   * the host's cooldown, so that the jitter of a network never makes the host refuse a strip the
   * hands were slow enough to ask for. Low Energy stretches it, as it does the blaster's pace.
   */
  pace: 0.6,
} as const;

/**
 * Research (SPEC sections 9 and 10): the points the crew earns by surviving nights, and the ladder of
 * what they open. Points are only ever added, never spent, so a step is open for good once the
 * total reaches it (docs/decisions.md, Phase 5c).
 */
export const RESEARCH = {
  /** What a night the crew has survived is worth, credited at the dawn that ends it (the notes: 8 to 12). */
  perNight: 10,
  /** Extra for a night in which the Core took no damage at all (the spec's small bonus for low base damage). */
  cleanNight: 2,
  /**
   * What the points open, by total points in rising order: the material tier they unlock. The Power
   * group (10 points) and the module upgrades (40) join with the modules that use them.
   */
  steps: [
    { points: 20, tier: 2 },
    { points: 55, tier: 3 },
    { points: 100, tier: 4 },
  ],
  /** The most points the `?research=` switch or the debug page can set. */
  max: 9999,
} as const;
