import { describe, expect, it } from 'vitest';
import { MATERIAL } from '../../src/shared/blocks';
import { DEBRIS } from '../../src/systems/economy/balance';
import { gradeAt, harvestsOfGrade, yieldOfGrade } from '../../src/systems/economy/grades';

describe('the grade of a heap', () => {
  it('is Scrap in the first batch and anywhere the table gives no better grade', () => {
    for (let slot = 0; slot < DEBRIS.initial; slot++) expect(gradeAt(0, slot)).toBe(MATERIAL.scrap);
    expect(gradeAt(1, 3)).toBe(MATERIAL.scrap);
    expect(gradeAt(DEBRIS.dawns, DEBRIS.perDawn + 5)).toBe(MATERIAL.scrap);
  });

  it('is the better grade at the place the table names, from the batch it names on', () => {
    for (const grade of DEBRIS.grades) {
      expect(gradeAt(grade.from - 1, grade.slot)).toBe(MATERIAL.scrap);
      for (let batch = grade.from; batch <= DEBRIS.dawns; batch++) {
        expect(gradeAt(batch, grade.slot), `batch ${batch}`).toBe(grade.material);
      }
    }
  });

  it('gives each place to one grade at most, inside a dawn’s batch', () => {
    for (let batch = 0; batch <= DEBRIS.dawns; batch++) {
      const claimed = DEBRIS.grades.filter((grade) => batch >= grade.from).map((g) => g.slot);
      expect(new Set(claimed).size).toBe(claimed.length);
    }
    for (const grade of DEBRIS.grades) {
      expect(grade.slot).toBeGreaterThanOrEqual(0);
      expect(grade.slot).toBeLessThan(DEBRIS.perDawn);
    }
  });

  it('opens Composite before Alloy, as the tiers go', () => {
    const [composite, alloy] = DEBRIS.grades;
    expect(composite?.material).toBe(MATERIAL.composite);
    expect(alloy?.material).toBe(MATERIAL.alloy);
    expect(composite!.from).toBeLessThan(alloy!.from);
  });
});

describe('what a heap of a grade gives', () => {
  it('is the table’s Scrap for Scrap, and for any material the grades do not list', () => {
    expect(harvestsOfGrade(MATERIAL.scrap)).toEqual(DEBRIS.harvests);
    expect(yieldOfGrade(MATERIAL.scrap)).toEqual(DEBRIS.yield);
    expect(harvestsOfGrade(MATERIAL.energy)).toEqual(DEBRIS.harvests);
    expect(yieldOfGrade(99)).toEqual(DEBRIS.yield);
  });

  it('is the grade’s own strips and yield for a better material, in whole numbers from the least to the most', () => {
    for (const grade of DEBRIS.grades) {
      expect(harvestsOfGrade(grade.material)).toEqual(grade.harvests);
      expect(yieldOfGrade(grade.material)).toEqual(grade.yield);
      for (const span of [grade.harvests, grade.yield]) {
        expect(Number.isInteger(span.min)).toBe(true);
        expect(Number.isInteger(span.max)).toBe(true);
        expect(span.min).toBeGreaterThan(0);
        expect(span.max).toBeGreaterThanOrEqual(span.min);
      }
    }
  });

  it('is worth less a strip than Scrap, because a block costs one of it', () => {
    for (const grade of DEBRIS.grades) {
      expect(grade.yield.max).toBeLessThan(DEBRIS.yield.max);
      expect(grade.harvests.max).toBeLessThanOrEqual(DEBRIS.harvests.max);
    }
  });
});
