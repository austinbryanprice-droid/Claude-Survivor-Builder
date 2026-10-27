import { describe, expect, it } from 'vitest';
import { MATERIAL, MATERIALS, MODULE, MODULES } from '../../src/shared/blocks';
import { RESEARCH } from '../../src/systems/economy/balance';
import {
  RESEARCH_GROUPS,
  RESEARCH_ROWS,
  RESEARCH_STEPS,
  Research,
  groupOfModule,
  moduleLock,
  nextRow,
  pointsForTier,
  researchLock,
  rowsReached,
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
    const [power, composite, camp, alloy, energy] = RESEARCH_ROWS;
    expect(nextRow(0)).toBe(power);
    expect(nextRow(power!.points - 1)).toBe(power);
    expect(nextRow(power!.points)).toBe(composite);
    expect(nextRow(composite!.points)).toBe(camp);
    expect(nextRow(camp!.points)).toBe(alloy);
    expect(nextRow(energy!.points - 1)).toBe(energy);
    expect(nextRow(energy!.points)).toBeNull();
    expect(nextRow(RESEARCH.max)).toBeNull();
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

describe('the groups of modules the points open', () => {
  it('has the Power group at 10 points, the first night survived, holding the Generator and the Power Node', () => {
    expect(RESEARCH_GROUPS).toHaveLength(2);
    const power = RESEARCH_GROUPS[0]!;
    expect(power).toMatchObject({ id: 'power', name: 'Power', points: 10 });
    expect(power.modules).toEqual([MODULE.generator, MODULE.node]);
    // One night is worth at least what it takes, so the first dawn opens it.
    expect(RESEARCH.perNight).toBeGreaterThanOrEqual(power.points);
  });

  it('has the Camp group at 40 points, the fourth night survived, holding Storage and the Bed', () => {
    const camp = RESEARCH_GROUPS[1]!;
    expect(camp).toMatchObject({ id: 'camp', name: 'Camp', points: 40 });
    expect(camp.modules).toEqual([MODULE.storage, MODULE.bed]);
    // Three nights, however clean, fall short of it and four reach it: the base's comforts wait for night 4.
    expect(3 * (RESEARCH.perNight + RESEARCH.cleanNight)).toBeLessThan(camp.points);
    expect(4 * RESEARCH.perNight).toBeGreaterThanOrEqual(camp.points);
  });

  it('holds only modules the tables define, each in one group', () => {
    const held = RESEARCH_GROUPS.flatMap((group) => group.modules);
    expect(new Set(held).size).toBe(held.length);
    for (const id of held)
      expect(
        MODULES.some((module) => module.id === id),
        `module ${id}`,
      ).toBe(true);
    for (const group of RESEARCH_GROUPS) {
      expect(group.points, group.id).toBeGreaterThan(0);
      expect(group.name, group.id).not.toBe('');
    }
  });

  it('finds the group of a module, and none for a module no research gates', () => {
    expect(groupOfModule(MODULE.generator)?.id).toBe('power');
    expect(groupOfModule(MODULE.node)?.id).toBe('power');
    expect(groupOfModule(MODULE.storage)?.id).toBe('camp');
    expect(groupOfModule(MODULE.bed)?.id).toBe('camp');
    expect(groupOfModule(MODULE.terminal)).toBeUndefined();
    expect(groupOfModule(MODULE.turret)).toBeUndefined();
    expect(groupOfModule(99)).toBeUndefined();
  });

  it('shuts a module until the points of its group, and then for good', () => {
    expect(moduleLock(MODULE.generator, 0)).toEqual({ have: 0, need: 10 });
    expect(moduleLock(MODULE.generator, 9)).toEqual({ have: 9, need: 10 });
    expect(moduleLock(MODULE.generator, 10)).toBeNull();
    expect(moduleLock(MODULE.generator, 400)).toBeNull();
    expect(moduleLock(MODULE.storage, 10)).toEqual({ have: 10, need: 40 });
    expect(moduleLock(MODULE.storage, 39)).toEqual({ have: 39, need: 40 });
    expect(moduleLock(MODULE.storage, 40)).toBeNull();
    // The Bed is held by the same row, so it opens with Storage and not before.
    expect(moduleLock(MODULE.bed, 39)).toEqual({ have: 39, need: 40 });
    expect(moduleLock(MODULE.bed, 40)).toBeNull();
    expect(moduleLock(MODULE.terminal, 0)).toBeNull();
    expect(moduleLock(MODULE.turret, 0)).toBeNull();
  });
});

describe('the whole ladder', () => {
  it('is the materials and the groups together, in rising order of points', () => {
    expect(RESEARCH_ROWS.map((row) => row.name)).toEqual([
      'Power',
      'Reinforced Composite',
      'Camp',
      'Advanced Alloy',
      'Energy-Infused',
    ]);
    expect(RESEARCH_ROWS.map((row) => row.kind)).toEqual([
      'modules',
      'material',
      'modules',
      'material',
      'material',
    ]);
    const points = RESEARCH_ROWS.map((row) => row.points);
    expect(points).toEqual([...points].sort((a, b) => a - b));
  });

  it('says which rows a rise in the points reaches, in the ladder’s order', () => {
    expect(rowsReached(0, 9)).toEqual([]);
    expect(rowsReached(0, 10).map((row) => row.name)).toEqual(['Power']);
    expect(rowsReached(10, 19)).toEqual([]);
    expect(rowsReached(30, 40).map((row) => row.name)).toEqual(['Camp']);
    expect(rowsReached(5, 60).map((row) => row.name)).toEqual([
      'Power',
      'Reinforced Composite',
      'Camp',
      'Advanced Alloy',
    ]);
    expect(rowsReached(0, RESEARCH.max)).toHaveLength(RESEARCH_ROWS.length);
    // A fall, or no change, reaches nothing.
    expect(rowsReached(60, 0)).toEqual([]);
    expect(rowsReached(30, 30)).toEqual([]);
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
