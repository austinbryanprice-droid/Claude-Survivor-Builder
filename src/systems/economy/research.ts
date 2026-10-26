import { MATERIALS, materialTier } from '../../shared/blocks';
import { RESEARCH } from './balance';

/**
 * Research (SPEC sections 9 and 10): the points the crew earns by surviving nights and the ladder of
 * what they open. A point is never spent, so the ladder is read by the total: a step is open for good
 * once the points reach it. Pure and without a clock; the survival simulation tells it when a night
 * has been survived. The points are only earned, though: what they open is what a Research Terminal
 * has read, so the ladder is worked out from the points the crew has claimed (5d2), and a crew that
 * has not built a Terminal holds its points unread. A row of the ladder opens a material or, from the
 * Power group on (5g), a group of modules.
 */

/** One row of the ladder: the total points that open it, and the material tier it unlocks. */
export interface ResearchStep {
  readonly points: number;
  readonly tier: number;
}

/** The ladder of materials, in rising order of points. */
export const RESEARCH_STEPS: readonly ResearchStep[] = RESEARCH.steps;

/** One group of modules the points open, such as Power, which holds the Generator. */
export interface ResearchGroup {
  readonly id: string;
  /** What the Terminal's ladder and the messages call it. */
  readonly name: string;
  /** The total points that open it. */
  readonly points: number;
  /** The modules (`MODULE` ids) it opens. */
  readonly modules: readonly number[];
}

/** The groups of modules, in rising order of points. */
export const RESEARCH_GROUPS: readonly ResearchGroup[] = RESEARCH.groups;

/** The highest material tier these points have opened: 1 (Scrap) with none. */
export function tierAt(points: number): number {
  let tier = 1;
  for (const step of RESEARCH_STEPS) if (points >= step.points) tier = Math.max(tier, step.tier);
  return tier;
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

/** One row of the whole ladder: what the points open at a total, a material or a group of modules. */
export interface ResearchRow {
  readonly points: number;
  /** "Reinforced Composite" or "Power". */
  readonly name: string;
  readonly kind: 'material' | 'modules';
}

/** The whole ladder, materials and groups together in rising order of points (a material first where the two tie). */
export const RESEARCH_ROWS: readonly ResearchRow[] = [
  ...RESEARCH_STEPS.map((step): ResearchRow => ({
    points: step.points,
    name: tierName(step.tier),
    kind: 'material',
  })),
  ...RESEARCH_GROUPS.map((group): ResearchRow => ({
    points: group.points,
    name: group.name,
    kind: 'modules',
  })),
].sort((a, b) => a.points - b.points);

/** The next row these points have not reached, or null when the whole ladder is climbed. */
export function nextRow(points: number): ResearchRow | null {
  return RESEARCH_ROWS.find((row) => row.points > points) ?? null;
}

/** The rows that `after` points reach and `before` points do not, in the ladder's order. */
export function rowsReached(before: number, after: number): readonly ResearchRow[] {
  return RESEARCH_ROWS.filter((row) => row.points > before && row.points <= after);
}

/** The group a module (a `MODULE` id) waits on, or undefined for one that no research gates. */
export function groupOfModule(module: number): ResearchGroup | undefined {
  return RESEARCH_GROUPS.find((group) => group.modules.includes(module));
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

/**
 * Why a module is closed to a crew whose Terminal has read `points`: how many points it has and how many
 * open the module's group, or null when no group gates the module or the points reach it.
 */
export function moduleLock(
  module: number,
  points: number,
): { readonly have: number; readonly need: number } | null {
  const group = groupOfModule(module);
  return group && points < group.points ? { have: points, need: group.points } : null;
}

/** One run's research as the host keeps it. */
export class Research {
  private total = 0;
  private claimedTotal = 0;
  private lastNight = 0;

  /** The points the crew has earned. */
  get points(): number {
    return this.total;
  }

  /** The points a Research Terminal has read. What the ladder opens is worked out from these, never from the points earned. */
  get claimed(): number {
    return this.claimedTotal;
  }

  /** The highest material tier the claimed points have opened. */
  get tier(): number {
    return tierAt(this.claimedTotal);
  }

  /** True while the crew holds points that no Terminal has read. */
  get waiting(): boolean {
    return this.total > this.claimedTotal;
  }

  /** A standing Terminal reads every point the crew has earned, for good. Returns how many it had not read. */
  claim(): number {
    const read = this.total - this.claimedTotal;
    this.claimedTotal = this.total;
    return read;
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

  /**
   * Sets the total outright, from 0 to the most, and has it read unless `claim` is false (a test of
   * the points that wait). For the `?research=` switch, tests and the debug page.
   */
  set(points: number, claim = true): void {
    if (!Number.isFinite(points)) return;
    this.total = Math.min(RESEARCH.max, Math.max(0, Math.floor(points)));
    this.claimedTotal = claim ? this.total : Math.min(this.claimedTotal, this.total);
  }
}
