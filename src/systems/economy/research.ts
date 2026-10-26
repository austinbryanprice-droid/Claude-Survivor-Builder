import { MATERIALS, materialTier } from '../../shared/blocks';
import { RESEARCH } from './balance';

/**
 * Research (SPEC sections 9 and 10): the points the crew earns by surviving nights and the ladder of
 * what they open. A point is never spent, so the ladder is read by the total: a step is open for good
 * once the points reach it. Pure and without a clock; the survival simulation tells it when a night
 * has been survived. In Phase 5c the points open the material tiers at the dawn they are reached;
 * from 5d a Research Terminal has to stand for the crew to claim what they have earned.
 */

/** One row of the ladder: the total points that open it, and the material tier it unlocks. */
export interface ResearchStep {
  readonly points: number;
  readonly tier: number;
}

/** The ladder, in rising order of points. */
export const RESEARCH_STEPS: readonly ResearchStep[] = RESEARCH.steps;

/** The highest material tier these points have opened: 1 (Scrap) with none. */
export function tierAt(points: number): number {
  let tier = 1;
  for (const step of RESEARCH_STEPS) if (points >= step.points) tier = Math.max(tier, step.tier);
  return tier;
}

/** The next row these points have not reached, or null when the whole ladder is climbed. */
export function nextStep(points: number): ResearchStep | null {
  return RESEARCH_STEPS.find((step) => step.points > points) ?? null;
}

/** How many points open `tier`: nothing for the tier the crew starts with, and Infinity for one the ladder never opens. */
export function pointsForTier(tier: number): number {
  if (tier <= 1) return 0;
  return RESEARCH_STEPS.find((step) => step.tier >= tier)?.points ?? Infinity;
}

/** What the player calls the material a tier is made of, such as "Reinforced Composite". */
export function tierName(tier: number): string {
  return MATERIALS.find((material) => material.tier === tier)?.name ?? `Tier ${tier}`;
}

/**
 * Why a material is closed to a crew with `points`: how many it has and how many open it, or null
 * when the crew may use it.
 */
export function researchLock(
  material: number,
  points: number,
): { readonly have: number; readonly need: number } | null {
  const tier = materialTier(material);
  return tier > tierAt(points) ? { have: points, need: pointsForTier(tier) } : null;
}

/** One run's research as the host keeps it. */
export class Research {
  private total = 0;
  private lastNight = 0;

  /** The points the crew has earned. */
  get points(): number {
    return this.total;
  }

  /** The highest material tier the points have opened. */
  get tier(): number {
    return tierAt(this.total);
  }

  /**
   * Night `night` was survived: its points are credited, once (the same night again, or an earlier
   * one, adds nothing), a little more for a night in which the Core took no damage. Returns what
   * was added.
   */
  credit(night: number, clean: boolean): number {
    if (!Number.isInteger(night) || night <= this.lastNight) return 0;
    this.lastNight = night;
    const before = this.total;
    this.total = Math.min(
      RESEARCH.max,
      this.total + RESEARCH.perNight + (clean ? RESEARCH.cleanNight : 0),
    );
    return this.total - before;
  }

  /** Sets the total outright, from 0 to the most. For the `?research=` switch, tests and the debug page. */
  set(points: number): void {
    if (!Number.isFinite(points)) return;
    this.total = Math.min(RESEARCH.max, Math.max(0, Math.floor(points)));
  }
}
