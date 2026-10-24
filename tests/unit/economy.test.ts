import { describe, expect, it } from 'vitest';
import { MATERIAL } from '../../src/shared/blocks';
import { createEconomyReading, type DebrisNode } from '../../src/shared/economy';
import { DEBRIS, POOL } from '../../src/systems/economy/balance';
import { Economy, cellKey, stripYield } from '../../src/systems/economy/economy';

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
    expect(economy.dawn(2)).toBe(0);
    expect(economy.version).toBe(before);
    expect(economy.dawn(1)).toBe(1);
    expect(economy.leftOf(2)).toBe(4);
    expect(economy.version).toBeGreaterThan(before);
    economy.harvest(2, 1);
    expect(economy.dawn(1)).toBe(0);
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
