import { describe, expect, it } from 'vitest';
import { MATERIAL, MATERIALS } from '../../src/shared/blocks';
import { RESEARCH } from '../../src/systems/economy/balance';
import {
  RESEARCH_STEPS,
  Research,
  nextStep,
  pointsForTier,
  researchLock,
  tierAt,
  tierName,
} from '../../src/systems/economy/research';

describe('the research ladder', () => {
  it('rises in points and in tier, with one row for each tier after Scrap', () => {
    expect(RESEARCH_STEPS.map((step) => step.tier)).toEqual([2, 3, 4]);
    const points = RESEARCH_STEPS.map((step) => step.points);
    expect(points).toEqual([...points].sort((a, b) => a - b));
    expect(new Set(points).size).toBe(points.length);
    expect(points[0]).toBeGreaterThan(0);
  });

  it('can be climbed by a crew that survives, and cannot be skipped by one that does not', () => {
    // Every row is reachable inside the dozen nights the field of heaps lasts, and none in the first.
    const top = RESEARCH_STEPS[RESEARCH_STEPS.length - 1]!.points;
    expect(RESEARCH.perNight).toBeLessThan(RESEARCH_STEPS[0]!.points);
    expect(top).toBeLessThanOrEqual(12 * (RESEARCH.perNight + RESEARCH.cleanNight));
  });

  it('opens Scrap with nothing, and a tier at the points of its row and not a point before', () => {
    expect(tierAt(0)).toBe(1);
    expect(tierAt(-5)).toBe(1);
    for (const step of RESEARCH_STEPS) {
      expect(tierAt(step.points - 1)).toBe(step.tier - 1);
      expect(tierAt(step.points)).toBe(step.tier);
    }
    expect(tierAt(RESEARCH.max)).toBe(4);
  });

  it('names the next row the points have not reached, and none once the ladder is climbed', () => {
    expect(nextStep(0)).toBe(RESEARCH_STEPS[0]);
    expect(nextStep(RESEARCH_STEPS[0]!.points - 1)).toBe(RESEARCH_STEPS[0]);
    expect(nextStep(RESEARCH_STEPS[0]!.points)).toBe(RESEARCH_STEPS[1]);
    expect(nextStep(RESEARCH_STEPS[2]!.points - 1)).toBe(RESEARCH_STEPS[2]);
    expect(nextStep(RESEARCH_STEPS[2]!.points)).toBeNull();
  });

  it('says how many points open a tier: none for the first, and never for a tier the ladder lacks', () => {
    expect(pointsForTier(0)).toBe(0);
    expect(pointsForTier(1)).toBe(0);
    for (const step of RESEARCH_STEPS) expect(pointsForTier(step.tier)).toBe(step.points);
    expect(pointsForTier(5)).toBe(Infinity);
  });

  it('has a row for every material the tables define', () => {
    for (const material of MATERIALS) {
      expect(Number.isFinite(pointsForTier(material.tier)), material.name).toBe(true);
    }
  });

  it('names the material of a tier', () => {
    expect(tierName(1)).toBe('Scrap');
    expect(tierName(2)).toBe('Reinforced Composite');
    expect(tierName(3)).toBe('Advanced Alloy');
    expect(tierName(4)).toBe('Energy-Infused');
    expect(tierName(9)).toBe('Tier 9');
  });
});

describe('what a material needs', () => {
  it('is nothing for Scrap, and for an id the tables do not know', () => {
    expect(researchLock(MATERIAL.scrap, 0)).toBeNull();
    expect(researchLock(99, 0)).toBeNull();
  });

  it('is the points the crew has and the points that open it, until they do', () => {
    expect(researchLock(MATERIAL.composite, 12)).toEqual({ have: 12, need: 20 });
    expect(researchLock(MATERIAL.composite, 20)).toBeNull();
    expect(researchLock(MATERIAL.alloy, 24)).toEqual({ have: 24, need: 55 });
    expect(researchLock(MATERIAL.alloy, 55)).toBeNull();
    expect(researchLock(MATERIAL.energy, 99)).toEqual({ have: 99, need: 100 });
    expect(researchLock(MATERIAL.energy, 100)).toBeNull();
  });
});

describe('the research a run keeps', () => {
  it('begins with nothing earned and nothing read', () => {
    const research = new Research();
    expect(research.points).toBe(0);
    expect(research.claimed).toBe(0);
    expect(research.waiting).toBe(false);
    expect(research.tier).toBe(1);
  });

  it('pays a night its points, and a night the Core took no damage in a few more', () => {
    const research = new Research();
    expect(research.credit(1, false)).toBe(RESEARCH.perNight);
    expect(research.credit(2, true)).toBe(RESEARCH.perNight + RESEARCH.cleanNight);
    expect(research.points).toBe(2 * RESEARCH.perNight + RESEARCH.cleanNight);
  });

  it('pays a night once, however often it is told, and never an earlier one', () => {
    const research = new Research();
    research.credit(3, false);
    const after = research.points;
    expect(research.credit(3, true)).toBe(0);
    expect(research.credit(2, true)).toBe(0);
    expect(research.credit(0, true)).toBe(0);
    expect(research.points).toBe(after);
    expect(research.credit(4, false)).toBe(RESEARCH.perNight);
  });

  it('pays nothing for a night that is not a whole number', () => {
    const research = new Research();
    expect(research.credit(1.5, false)).toBe(0);
    expect(research.credit(Number.NaN, false)).toBe(0);
    expect(research.points).toBe(0);
  });

  it('opens the tiers as a Terminal reads points that reach their rows, and not before', () => {
    const research = new Research();
    research.credit(1, false);
    research.credit(2, false);
    expect(research.points).toBe(2 * RESEARCH.perNight);
    // Earned and unread: the row is reached and nothing is open.
    expect(tierAt(research.points)).toBe(2);
    expect(research.tier).toBe(1);
    expect(research.claim()).toBe(2 * RESEARCH.perNight);
    expect(research.tier).toBe(tierAt(2 * RESEARCH.perNight));
    research.set(RESEARCH_STEPS[2]!.points);
    expect(research.tier).toBe(4);
  });

  it('holds the points of a night unread until a Terminal reads them, and a reading is for good', () => {
    const research = new Research();
    research.credit(1, true);
    expect(research.waiting).toBe(true);
    expect(research.claimed).toBe(0);
    expect(research.claim()).toBe(research.points);
    expect(research.claimed).toBe(research.points);
    expect(research.waiting).toBe(false);
    // A Terminal that reads again finds nothing new.
    expect(research.claim()).toBe(0);
    // The next night's points wait in their turn; what was read stays read.
    const read = research.claimed;
    research.credit(2, false);
    expect(research.waiting).toBe(true);
    expect(research.claimed).toBe(read);
    expect(research.points).toBe(read + RESEARCH.perNight);
  });

  it('reads what is set outright unless told to leave it unread, and never holds more read than earned', () => {
    const research = new Research();
    research.set(55);
    expect(research.claimed).toBe(55);
    research.set(70, false);
    expect(research.points).toBe(70);
    expect(research.claimed).toBe(55);
    expect(research.waiting).toBe(true);
    research.set(30, false);
    expect(research.points).toBe(30);
    expect(research.claimed).toBe(30);
    expect(research.waiting).toBe(false);
  });

  it('holds no more than the most, and says how much a late night really added', () => {
    const research = new Research();
    research.set(RESEARCH.max - 3);
    expect(research.credit(1, true)).toBe(3);
    expect(research.points).toBe(RESEARCH.max);
    expect(research.credit(2, true)).toBe(0);
  });

  it('is set outright to a whole number from 0 to the most, and ignores what is not a number', () => {
    const research = new Research();
    research.set(55);
    expect(research.points).toBe(55);
    research.set(41.9);
    expect(research.points).toBe(41);
    research.set(-10);
    expect(research.points).toBe(0);
    research.set(1e9);
    expect(research.points).toBe(RESEARCH.max);
    research.set(Number.NaN);
    research.set(Number.POSITIVE_INFINITY);
    expect(research.points).toBe(RESEARCH.max);
  });
});
