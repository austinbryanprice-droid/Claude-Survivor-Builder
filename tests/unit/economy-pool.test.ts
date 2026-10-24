import { describe, expect, it } from 'vitest';
import { MATERIAL } from '../../src/shared/blocks';
import {
  POOL_MATERIALS,
  POOL_SLOTS,
  createEconomyReading,
  poolSlot,
} from '../../src/shared/economy';
import { Pool } from '../../src/systems/economy/pool';

describe('the shared pool', () => {
  it('keeps the four materials of the spec in tier order', () => {
    expect(POOL_MATERIALS).toEqual([
      MATERIAL.scrap,
      MATERIAL.composite,
      MATERIAL.alloy,
      MATERIAL.energy,
    ]);
    expect(POOL_SLOTS).toBe(4);
    expect(poolSlot(MATERIAL.alloy)).toBe(2);
    expect(poolSlot(MATERIAL.none)).toBe(-1);
    expect(poolSlot(99)).toBe(-1);
  });

  it('starts with what it is given and nothing of the rest', () => {
    const pool = new Pool(100, { [MATERIAL.scrap]: 30, [MATERIAL.alloy]: 5 });
    expect(pool.amount(MATERIAL.scrap)).toBe(30);
    expect(pool.amount(MATERIAL.composite)).toBe(0);
    expect(pool.amount(MATERIAL.alloy)).toBe(5);
    expect(pool.amount(MATERIAL.energy)).toBe(0);
    expect(pool.cap).toBe(100);
  });

  it('never starts above its ceiling, below nothing or on a fraction', () => {
    const pool = new Pool(50, {
      [MATERIAL.scrap]: 80,
      [MATERIAL.composite]: -4,
      [MATERIAL.alloy]: 7.9,
    });
    expect(pool.amount(MATERIAL.scrap)).toBe(50);
    expect(pool.amount(MATERIAL.composite)).toBe(0);
    expect(pool.amount(MATERIAL.alloy)).toBe(7);
  });

  it('adds as much as the ceiling allows and says how much went in', () => {
    const pool = new Pool(40, { [MATERIAL.scrap]: 30 });
    expect(pool.add(MATERIAL.scrap, 8)).toBe(8);
    expect(pool.add(MATERIAL.scrap, 8)).toBe(2);
    expect(pool.amount(MATERIAL.scrap)).toBe(40);
    expect(pool.room(MATERIAL.scrap)).toBe(0);
    expect(pool.add(MATERIAL.scrap, 1)).toBe(0);
    expect(pool.room(MATERIAL.composite)).toBe(40);
  });

  it('adds nothing for a material it does not keep or an amount that is no use', () => {
    const pool = new Pool(40);
    expect(pool.add(MATERIAL.none, 5)).toBe(0);
    expect(pool.add(77, 5)).toBe(0);
    expect(pool.add(MATERIAL.scrap, 0)).toBe(0);
    expect(pool.add(MATERIAL.scrap, -3)).toBe(0);
    expect(pool.add(MATERIAL.scrap, Number.NaN)).toBe(0);
    expect(pool.amount(MATERIAL.scrap)).toBe(0);
  });

  it('takes only what it holds, and all of it or none', () => {
    const pool = new Pool(40, { [MATERIAL.scrap]: 9 });
    expect(pool.has(MATERIAL.scrap, 9)).toBe(true);
    expect(pool.has(MATERIAL.scrap, 10)).toBe(false);
    expect(pool.take(MATERIAL.scrap, 10)).toBe(false);
    expect(pool.amount(MATERIAL.scrap)).toBe(9);
    expect(pool.take(MATERIAL.scrap, 9)).toBe(true);
    expect(pool.amount(MATERIAL.scrap)).toBe(0);
    expect(pool.take(MATERIAL.scrap, 1)).toBe(false);
    expect(pool.take(MATERIAL.none, 1)).toBe(false);
  });

  it('can have its ceiling raised, and holds what it had if the ceiling is lowered', () => {
    const pool = new Pool(40, { [MATERIAL.scrap]: 40 });
    expect(pool.add(MATERIAL.scrap, 5)).toBe(0);
    pool.setCap(60);
    expect(pool.add(MATERIAL.scrap, 5)).toBe(5);
    pool.setCap(20);
    expect(pool.amount(MATERIAL.scrap)).toBe(45);
    expect(pool.add(MATERIAL.scrap, 5)).toBe(0);
    expect(pool.take(MATERIAL.scrap, 30)).toBe(true);
    expect(pool.room(MATERIAL.scrap)).toBe(5);
    pool.setCap(Number.NaN);
    expect(pool.cap).toBe(20);
  });

  it('is set outright for tests and the debug page, within its ceiling', () => {
    const pool = new Pool(40);
    pool.set(MATERIAL.composite, 12);
    pool.set(MATERIAL.alloy, 400);
    pool.set(MATERIAL.energy, Number.NaN);
    expect(pool.amount(MATERIAL.composite)).toBe(12);
    expect(pool.amount(MATERIAL.alloy)).toBe(40);
    expect(pool.amount(MATERIAL.energy)).toBe(0);
  });

  it('writes its counts in tier order, into the array it is given', () => {
    const pool = new Pool(100, { [MATERIAL.scrap]: 3, [MATERIAL.energy]: 4 });
    const reading = createEconomyReading();
    pool.read(reading.stock);
    expect(reading.stock).toEqual([3, 0, 0, 4]);
  });
});
