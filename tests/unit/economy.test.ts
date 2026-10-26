import { describe, expect, it } from 'vitest';
import { MATERIAL, MODULE, SHAPE, moduleShape, packState } from '../../src/shared/blocks';
import { createEconomyReading, type DebrisNode } from '../../src/shared/economy';
import { DEBRIS, POOL } from '../../src/systems/economy/balance';
import {
  DEBRIS_IN_THE_WAY,
  FULLY_UPGRADED,
  NOTHING_TO_UPGRADE,
  needsResearch,
  notEnough,
  upgradeStep,
} from '../../src/systems/economy/build-rules';
import { Economy, cellKey, evenStock, stripYield } from '../../src/systems/economy/economy';
import { RESEARCH_STEPS } from '../../src/systems/economy/research';

function heap(index: number, overrides: Partial<DebrisNode> = {}): DebrisNode {
  return {
    index,
    x: 20.4 + index * 10,
    y: 10.2,
    z: -6.7,
    yaw: 0,
    scale: 1,
    harvests: 3,
    grade: MATERIAL.scrap,
    from: 0,
    ...overrides,
  };
}

/** Two heaps from the start (three strips and two) and one a dawn uncovers. */
function field(): DebrisNode[] {
  return [heap(0), heap(1, { harvests: 2 }), heap(2, { from: 1, harvests: 4 })];
}

describe('the economy of a run', () => {
  it('opens with the starting stock of Scrap and nothing gathered', () => {
    const economy = new Economy(5, field());
    const reading = economy.read(createEconomyReading());
    expect(reading.stock).toEqual([POOL.start[MATERIAL.scrap], 0, 0, 0]);
    expect(reading.cap).toBe(POOL.cap);
    expect(economy.gathered).toBe(0);
  });

  it('has the heaps of the first batch lying there and the rest not uncovered yet', () => {
    const economy = new Economy(5, field());
    expect([0, 1, 2].map((i) => economy.leftOf(i))).toEqual([3, 2, 0]);
    expect(economy.leftOf(9)).toBe(0);
    expect(economy.leftOf(-1)).toBe(0);
  });

  it('finds a heap by the cell its middle is in', () => {
    const economy = new Economy(5, field());
    expect(economy.nodeAt(20, 10, -7)?.index).toBe(0);
    expect(economy.nodeAt(30, 10, -7)?.index).toBe(1);
    expect(economy.nodeAt(21, 10, -7)).toBeUndefined();
    expect(cellKey(20, 10, -7)).not.toBe(cellKey(-7, 10, 20));
  });

  it('puts a strip into the pool and counts it as gathered', () => {
    const economy = new Economy(5, field());
    const result = economy.harvest(0, 3);
    if (!result.ok) throw new Error(result.reason);
    const worth = stripYield(5, 0, 0);
    expect(worth).toBeGreaterThanOrEqual(DEBRIS.yield.min);
    expect(worth).toBeLessThanOrEqual(DEBRIS.yield.max);
    expect(result.event).toEqual({
      by: 3,
      node: 0,
      material: MATERIAL.scrap,
      gained: worth,
      left: 2,
      full: false,
    });
    expect(economy.pool.amount(MATERIAL.scrap)).toBe(POOL.start[MATERIAL.scrap]! + worth);
    expect(economy.gathered).toBe(worth);
    expect(economy.leftOf(0)).toBe(2);
  });

  it('says what the next strip is worth before it is taken, and takes exactly that', () => {
    const economy = new Economy(11, field());
    for (let strip = 0; strip < 3; strip++) {
      const promised = economy.nextYield(0);
      expect(promised).toBe(stripYield(11, 0, strip));
      const result = economy.harvest(0, 1);
      expect(result.ok && result.event.gained).toBe(promised);
    }
    expect(economy.nextYield(0)).toBe(0);
    expect(economy.nextYield(2)).toBe(0);
  });

  it('gives the same strips every time for a seed, and other ones for another', () => {
    const a = [0, 1, 2, 3].map((strip) => stripYield(5, 0, strip));
    expect([0, 1, 2, 3].map((strip) => stripYield(5, 0, strip))).toEqual(a);
    const spread = new Set<number>();
    for (let node = 0; node < 40; node++)
      for (let strip = 0; strip < 4; strip++) {
        spread.add(stripYield(5, node, strip));
      }
    // Every whole number from the table's minimum to its maximum turns up.
    expect(spread.size).toBe(DEBRIS.yield.max - DEBRIS.yield.min + 1);
  });

  it('empties a heap after its last strip and refuses it from then on', () => {
    const economy = new Economy(5, field());
    expect(economy.harvest(1, 1).ok).toBe(true);
    const last = economy.harvest(1, 1);
    expect(last.ok && last.event.left).toBe(0);
    const stock = economy.pool.amount(MATERIAL.scrap);
    expect(economy.harvest(1, 1)).toEqual({ ok: false, reason: 'depleted' });
    expect(economy.pool.amount(MATERIAL.scrap)).toBe(stock);
  });

  it('refuses a heap that is not there and one that is not uncovered yet', () => {
    const economy = new Economy(5, field());
    expect(economy.harvest(7, 1)).toEqual({ ok: false, reason: 'nothing' });
    expect(economy.harvest(-1, 1)).toEqual({ ok: false, reason: 'nothing' });
    expect(economy.harvest(2, 1)).toEqual({ ok: false, reason: 'depleted' });
  });

  it('takes what the pool has room for and uses the strip up, and refuses when there is no room at all', () => {
    const economy = new Economy(5, field());
    economy.pool.set(MATERIAL.scrap, POOL.cap - 3);
    const partial = economy.harvest(0, 1);
    expect(partial.ok && partial.event.gained).toBe(3);
    expect(partial.ok && partial.event.full).toBe(true);
    expect(partial.ok && partial.event.left).toBe(2);
    expect(economy.pool.amount(MATERIAL.scrap)).toBe(POOL.cap);
    expect(economy.harvest(0, 1)).toEqual({ ok: false, reason: 'full' });
    // Refused for room: the strip was not used up.
    expect(economy.leftOf(0)).toBe(2);
    expect(economy.gathered).toBe(3);
  });

  it('uncovers the heaps of a night at its dawn, once', () => {
    const economy = new Economy(5, field());
    const before = economy.version;
    expect(economy.dawn(0)).toBe(0);
    expect(economy.version).toBe(before);
    expect(economy.dawn(1)).toBe(1);
    expect(economy.leftOf(2)).toBe(4);
    expect(economy.version).toBeGreaterThan(before);
    economy.harvest(2, 1);
    // The same dawn again, or a later one, does not bring a stripped heap back.
    expect(economy.dawn(1)).toBe(0);
    expect(economy.dawn(2)).toBe(0);
    expect(economy.leftOf(2)).toBe(3);
  });

  it('moves its version whenever a heap changes, so a renderer knows to look', () => {
    const economy = new Economy(5, field());
    const v0 = economy.version;
    economy.harvest(0, 1);
    expect(economy.version).toBe(v0 + 1);
    economy.harvest(9, 1);
    expect(economy.version).toBe(v0 + 1);
  });

  it('lists the strips left of every heap in order', () => {
    const economy = new Economy(5, field());
    economy.harvest(0, 1);
    expect(economy.leftAll()).toEqual([2, 2, 0]);
  });
});

describe('the economy paying for blocks', () => {
  const scrapBlock = packState(SHAPE.cube, MATERIAL.scrap);
  const compositeBlock = packState(SHAPE.cube, MATERIAL.composite);
  const scrap = (economy: Economy) => economy.pool.amount(MATERIAL.scrap);

  it('takes what a block costs from the pool when the crew pays for it', () => {
    const economy = new Economy(5, field());
    const before = scrap(economy);
    expect(economy.pay(scrapBlock)).toBe(true);
    expect(scrap(economy)).toBe(before - 1);
    expect(economy.pay(packState(SHAPE.wedge, MATERIAL.scrap))).toBe(true);
    expect(economy.pay(packState(SHAPE.slab, MATERIAL.scrap))).toBe(true);
    expect(scrap(economy)).toBe(before - 3);
  });

  it('takes nothing from a pool that cannot pay', () => {
    const economy = new Economy(5, field());
    expect(economy.pool.amount(MATERIAL.composite)).toBe(0);
    expect(economy.pay(compositeBlock)).toBe(false);
    economy.pool.set(MATERIAL.scrap, 0);
    expect(economy.pay(scrapBlock)).toBe(false);
    expect(economy.read(createEconomyReading()).stock).toEqual([0, 0, 0, 0]);
  });

  it('gives back what a block cost when the crew breaks it, as far as the ceiling allows', () => {
    const economy = new Economy(5, field());
    const before = scrap(economy);
    expect(economy.refund(scrapBlock)).toBe(1);
    expect(scrap(economy)).toBe(before + 1);
    economy.pool.set(MATERIAL.scrap, POOL.cap);
    expect(economy.refund(scrapBlock)).toBe(0);
    expect(scrap(economy)).toBe(POOL.cap);
    expect(economy.refund(compositeBlock)).toBe(1);
    expect(economy.pool.amount(MATERIAL.composite)).toBe(1);
  });

  it('gives back nothing for a cell that held no piece the tables know', () => {
    const economy = new Economy(5, field());
    expect(economy.refund(0)).toBe(0);
    expect(economy.pay(0)).toBe(true);
    expect(scrap(economy)).toBe(POOL.start[MATERIAL.scrap]);
  });

  it('refuses a block the pool cannot pay for, in words that name the material', () => {
    const economy = new Economy(5, field());
    economy.research.set(RESEARCH_STEPS[0]!.points);
    expect(economy.placementRefusal(0, 20, 0, scrapBlock)).toBeNull();
    expect(economy.placementRefusal(0, 20, 0, compositeBlock)).toBe(
      notEnough('Reinforced Composite'),
    );
    economy.pool.set(MATERIAL.scrap, 0);
    expect(economy.placementRefusal(0, 20, 0, scrapBlock)).toBe('not enough Scrap');
  });

  it('refuses a material the crew has not researched, before it asks about the pool', () => {
    const economy = new Economy(5, field(), evenStock(50));
    const alloyBlock = packState(SHAPE.cube, MATERIAL.alloy);
    expect(economy.placementRefusal(0, 20, 0, compositeBlock)).toBe(
      needsResearch('Reinforced Composite'),
    );
    expect(economy.placementRefusal(0, 20, 0, scrapBlock)).toBeNull();
    economy.research.set(RESEARCH_STEPS[0]!.points);
    expect(economy.placementRefusal(0, 20, 0, compositeBlock)).toBeNull();
    expect(economy.placementRefusal(0, 20, 0, alloyBlock)).toBe(needsResearch('Advanced Alloy'));
    economy.research.set(RESEARCH_STEPS[1]!.points);
    expect(economy.placementRefusal(0, 20, 0, alloyBlock)).toBeNull();
    // Locked outranks short: a closed material with nothing in the pool says "needs research".
    economy.research.set(0);
    economy.pool.set(MATERIAL.composite, 0);
    expect(economy.placementRefusal(0, 20, 0, compositeBlock)).toBe(
      needsResearch('Reinforced Composite'),
    );
  });

  it('refuses a block in the room a heap that is lying there keeps clear, and no other', () => {
    const economy = new Economy(5, field());
    // Heap 0 lies at (20.4, 10.2, -6.7), size 1.
    expect(economy.placementRefusal(20, 10, -7, scrapBlock)).toBe(DEBRIS_IN_THE_WAY);
    expect(economy.placementRefusal(21, 11, -7, scrapBlock)).toBe(DEBRIS_IN_THE_WAY);
    expect(economy.placementRefusal(26, 10, -7, scrapBlock)).toBeNull();
    // Heap 2 is not uncovered yet, so it keeps nothing clear.
    expect(economy.placementRefusal(40, 10, -7, scrapBlock)).toBeNull();
    // A heap stripped bare is gone, and its ground is free.
    economy.harvest(1, 1);
    economy.harvest(1, 1);
    expect(economy.placementRefusal(30, 10, -7, scrapBlock)).toBeNull();
  });

  it('says a heap is in the way before it says the pool is short', () => {
    const economy = new Economy(5, field());
    economy.pool.set(MATERIAL.scrap, 0);
    expect(economy.placementRefusal(20, 10, -7, scrapBlock)).toBe(DEBRIS_IN_THE_WAY);
  });

  it('opens with the stock it is given, and with the table when it is given none', () => {
    expect(new Economy(5, field(), evenStock(50)).read(createEconomyReading()).stock).toEqual([
      50, 50, 50, 50,
    ]);
    expect(new Economy(5, field(), evenStock(9999)).pool.amount(MATERIAL.alloy)).toBe(POOL.cap);
    expect(new Economy(5, field(), {}).read(createEconomyReading()).stock).toEqual([0, 0, 0, 0]);
  });
});

describe('the economy upgrading a piece in place', () => {
  const scrapBlock = packState(SHAPE.cube, MATERIAL.scrap);
  const compositeBlock = packState(SHAPE.cube, MATERIAL.composite);
  const alloyBlock = packState(SHAPE.cube, MATERIAL.alloy);
  const energyBlock = packState(SHAPE.cube, MATERIAL.energy);

  it('accepts a piece whose better material is researched and in the pool', () => {
    const economy = new Economy(5, field(), evenStock(5));
    economy.research.set(RESEARCH_STEPS[0]!.points);
    expect(economy.upgradeRefusal(scrapBlock)).toBeNull();
  });

  it('refuses a better material the crew has not researched, before it asks about the pool', () => {
    const economy = new Economy(5, field(), evenStock(5));
    expect(economy.upgradeRefusal(scrapBlock)).toBe(needsResearch('Reinforced Composite'));
    economy.research.set(RESEARCH_STEPS[0]!.points);
    expect(economy.upgradeRefusal(compositeBlock)).toBe(needsResearch('Advanced Alloy'));
    economy.research.set(RESEARCH_STEPS[1]!.points);
    expect(economy.upgradeRefusal(compositeBlock)).toBeNull();
    expect(economy.upgradeRefusal(alloyBlock)).toBe(needsResearch('Energy-Infused'));
  });

  it('does not count the unread points of a crew with no Terminal', () => {
    const economy = new Economy(5, field(), evenStock(5));
    economy.research.set(RESEARCH_STEPS[0]!.points, false);
    expect(economy.upgradeRefusal(scrapBlock)).toBe(needsResearch('Reinforced Composite'));
    economy.placed(packState(moduleShape(MODULE.terminal, 0), 1));
    expect(economy.upgradeRefusal(scrapBlock)).toBeNull();
  });

  it('refuses a pool short of the better material, naming it, however much Scrap it holds', () => {
    const economy = new Economy(5, field());
    economy.research.set(RESEARCH_STEPS[0]!.points);
    expect(economy.pool.amount(MATERIAL.scrap)).toBeGreaterThan(0);
    expect(economy.upgradeRefusal(scrapBlock)).toBe(notEnough('Reinforced Composite'));
  });

  it('says what stops a piece that has no better self', () => {
    const economy = new Economy(5, field(), evenStock(50));
    economy.research.set(RESEARCH_STEPS[2]!.points);
    expect(economy.upgradeRefusal(0)).toBe(NOTHING_TO_UPGRADE);
    expect(economy.upgradeRefusal(energyBlock)).toBe(FULLY_UPGRADED);
  });

  it('is paid by the better piece’s price, and the old block gives nothing back', () => {
    const economy = new Economy(5, field(), evenStock(5));
    economy.research.set(RESEARCH_STEPS[0]!.points);
    const step = upgradeStep(scrapBlock)!;
    expect(economy.pay(step.to)).toBe(true);
    expect(economy.read(createEconomyReading()).stock).toEqual([5, 4, 5, 5]);
  });
});

describe('a dawn over ground the crew has built on', () => {
  it('lets a heap wait while a block stands where it would come up, and brings it up at a later dawn', () => {
    const economy = new Economy(5, field());
    const before = economy.version;
    expect(economy.dawn(1, () => true)).toBe(0);
    expect(economy.leftOf(2)).toBe(0);
    expect(economy.version).toBe(before);
    // Still built over at the next dawn, and then the block is gone.
    expect(economy.dawn(2, () => true)).toBe(0);
    expect(economy.dawn(3, () => false)).toBe(1);
    expect(economy.leftOf(2)).toBe(4);
    expect(economy.version).toBeGreaterThan(before);
  });

  it('asks about the heaps that are waiting, and only those', () => {
    const economy = new Economy(5, field());
    const asked: number[] = [];
    economy.dawn(1, (node) => {
      asked.push(node.index);
      return false;
    });
    expect(asked).toEqual([2]);
    asked.length = 0;
    economy.dawn(2, (node) => {
      asked.push(node.index);
      return false;
    });
    expect(asked).toEqual([]);
  });

  it('does not bring a heap back once the crew has stripped it bare', () => {
    const economy = new Economy(5, field());
    economy.dawn(1);
    for (let n = 0; n < 4; n++) economy.harvest(2, 1);
    expect(economy.leftOf(2)).toBe(0);
    expect(economy.dawn(2, () => false)).toBe(0);
    expect(economy.leftOf(2)).toBe(0);
  });
});

describe('heaps of a better grade', () => {
  const better = (index: number, grade: number, harvests: number) =>
    heap(index, { grade, harvests });

  it('give their own material at their own yield', () => {
    const economy = new Economy(5, [
      better(0, MATERIAL.composite, 3),
      better(1, MATERIAL.alloy, 2),
    ]);
    const composite = economy.harvest(0, 1);
    expect(composite.ok && composite.event.material).toBe(MATERIAL.composite);
    const worth = stripYield(5, 0, 0, MATERIAL.composite);
    expect(worth).toBeGreaterThanOrEqual(5);
    expect(worth).toBeLessThanOrEqual(7);
    expect(composite.ok && composite.event.gained).toBe(worth);
    expect(economy.pool.amount(MATERIAL.composite)).toBe(worth);
    expect(economy.pool.amount(MATERIAL.scrap)).toBe(POOL.start[MATERIAL.scrap]);
    const alloy = economy.harvest(1, 1);
    expect(alloy.ok && alloy.event.material).toBe(MATERIAL.alloy);
    expect(economy.pool.amount(MATERIAL.alloy)).toBe(stripYield(5, 1, 0, MATERIAL.alloy));
    expect(economy.gathered).toBe(worth + stripYield(5, 1, 0, MATERIAL.alloy));
  });

  it('say what the next strip is worth in their own terms', () => {
    const economy = new Economy(11, [better(0, MATERIAL.alloy, 2)]);
    expect(economy.nextYield(0)).toBe(stripYield(11, 0, 0, MATERIAL.alloy));
    economy.harvest(0, 1);
    expect(economy.nextYield(0)).toBe(stripYield(11, 0, 1, MATERIAL.alloy));
  });

  it('are worth a whole number inside the span the table gives their grade, and every number in it turns up', () => {
    for (const grade of DEBRIS.grades) {
      const seen = new Set<number>();
      for (let node = 0; node < 60; node++) {
        for (let strip = 0; strip < 3; strip++)
          seen.add(stripYield(5, node, strip, grade.material));
      }
      expect(Math.min(...seen)).toBe(grade.yield.min);
      expect(Math.max(...seen)).toBe(grade.yield.max);
      expect(seen.size).toBe(grade.yield.max - grade.yield.min + 1);
    }
  });

  it('take Scrap as the grade where none is said', () => {
    expect(stripYield(5, 3, 1)).toBe(stripYield(5, 3, 1, MATERIAL.scrap));
  });
});

describe('a dawn and what the crew has researched', () => {
  /** A heap of Scrap from the start, then one of each better grade due at night 2 and 3, and a Scrap heap due at 3. */
  function mixed(): DebrisNode[] {
    return [
      heap(0),
      heap(1, { from: 2, grade: MATERIAL.composite, harvests: 3 }),
      heap(2, { from: 3, grade: MATERIAL.alloy, harvests: 2 }),
      heap(3, { from: 3, harvests: 2 }),
    ];
  }
  const left = (economy: Economy) => [0, 1, 2, 3].map((i) => economy.leftOf(i));

  it('leaves a heap of a closed tier in the ground while the Scrap of the same dawn comes up', () => {
    const economy = new Economy(5, mixed());
    expect(economy.dawn(3)).toBe(1);
    expect(left(economy)).toEqual([3, 0, 0, 2]);
  });

  it('brings it up at the first dawn after the research is done, tier by tier', () => {
    const economy = new Economy(5, mixed());
    economy.dawn(3);
    economy.research.set(RESEARCH_STEPS[0]!.points);
    expect(economy.dawn(4)).toBe(1);
    expect(left(economy)).toEqual([3, 3, 0, 2]);
    economy.research.set(RESEARCH_STEPS[1]!.points);
    expect(economy.dawn(5)).toBe(1);
    expect(left(economy)).toEqual([3, 3, 2, 2]);
  });

  it('brings no heap up before the night it is due, whatever the crew has researched', () => {
    const economy = new Economy(5, mixed());
    economy.research.set(RESEARCH_STEPS[2]!.points);
    expect(economy.dawn(1)).toBe(0);
    expect(economy.dawn(2)).toBe(1);
    expect(left(economy)).toEqual([3, 3, 0, 0]);
  });

  it('asks whether the ground is built over only for the heaps whose tier is open', () => {
    const economy = new Economy(5, mixed());
    const asked: number[] = [];
    economy.dawn(3, (node) => {
      asked.push(node.index);
      return false;
    });
    expect(asked).toEqual([3]);
  });

  it('does not change its version for a dawn that brings nothing up', () => {
    const economy = new Economy(5, [heap(0), heap(1, { from: 2, grade: MATERIAL.composite })]);
    const before = economy.version;
    expect(economy.dawn(2)).toBe(0);
    expect(economy.version).toBe(before);
  });
});

describe('the research an economy keeps', () => {
  const scrapBlock = packState(SHAPE.cube, MATERIAL.scrap);
  const compositeBlock = packState(SHAPE.cube, MATERIAL.composite);
  const terminal = packState(moduleShape(MODULE.terminal, 0), 1);

  it('shows its points, the points read and the tier those open when it is read', () => {
    const economy = new Economy(5, field());
    expect(economy.read(createEconomyReading())).toMatchObject({
      research: 0,
      claimed: 0,
      tier: 1,
    });
    economy.research.set(60);
    expect(economy.read(createEconomyReading())).toMatchObject({
      research: 60,
      claimed: 60,
      tier: 3,
    });
  });

  it('shows points no Terminal has read as earned and not as open', () => {
    const economy = new Economy(5, field());
    economy.research.set(60, false);
    expect(economy.read(createEconomyReading())).toMatchObject({
      research: 60,
      claimed: 0,
      tier: 1,
    });
  });

  it('locks a material the unread points reach, and keeps its heaps down, until a Terminal is placed', () => {
    const economy = new Economy(5, field(), evenStock(50));
    economy.research.set(RESEARCH_STEPS[0]!.points, false);
    expect(economy.placementRefusal(0, 20, 0, compositeBlock)).toBe(
      needsResearch('Reinforced Composite'),
    );
    economy.placed(terminal);
    expect(economy.placementRefusal(0, 20, 0, compositeBlock)).toBeNull();
  });

  it('has a placed Research Terminal read every point the crew has earned', () => {
    const economy = new Economy(5, field());
    economy.research.set(30, false);
    expect(economy.research.waiting).toBe(true);
    economy.placed(terminal);
    expect(economy.research.waiting).toBe(false);
    expect(economy.research.claimed).toBe(30);
    expect(economy.research.tier).toBe(2);
  });

  it('is not moved by the placing of a block', () => {
    const economy = new Economy(5, field());
    economy.research.set(30, false);
    economy.placed(scrapBlock);
    economy.placed(compositeBlock);
    expect(economy.research.waiting).toBe(true);
  });

  it('leaves what a Terminal read open when the Terminal is broken', () => {
    const economy = new Economy(5, field(), evenStock(50));
    economy.research.set(30, false);
    economy.placed(terminal);
    economy.refund(terminal);
    expect(economy.research.tier).toBe(2);
    expect(economy.placementRefusal(0, 20, 0, compositeBlock)).toBeNull();
  });
});
