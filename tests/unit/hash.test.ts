import { describe, expect, it } from 'vitest';
import { createRng, hash3, hash32, unitFloat } from '../../src/shared/hash';

function popcount(value: number): number {
  let count = 0;
  for (let x = value >>> 0; x !== 0; x >>>= 1) count += x & 1;
  return count;
}

describe('hash32', () => {
  it('matches pinned vectors (shared seeds and saves depend on these never changing)', () => {
    const inputs = [0, 1, 2, 12345, -1, 2 ** 31, 0xdeadbeef];
    expect(inputs.map(hash32)).toEqual([
      0, 1753845952, 3507691905, 2435775735, 1734902346, 3427483940, 3861431939,
    ]);
  });

  it('returns unsigned 32-bit integers', () => {
    for (let i = -500; i < 500; i++) {
      const h = hash32(i * 7919);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });

  it('flips about half of the output bits when one input bit flips', () => {
    let flipped = 0;
    let trials = 0;
    for (let i = 1; i <= 2000; i++) {
      const base = Math.imul(i, 0x9e3779b1);
      for (let bit = 0; bit < 32; bit++) {
        flipped += popcount(hash32(base) ^ hash32(base ^ (1 << bit)));
        trials++;
      }
    }
    const average = flipped / trials;
    expect(average).toBeGreaterThan(15.5);
    expect(average).toBeLessThan(16.5);
  });

  it('fills 16 buckets evenly over sequential inputs', () => {
    const buckets = new Array<number>(16).fill(0);
    const samples = 65536;
    for (let i = 0; i < samples; i++) {
      const bucket = Math.floor(unitFloat(hash32(i)) * 16);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    const expected = samples / 16;
    for (const count of buckets) {
      expect(Math.abs(count - expected)).toBeLessThan(expected * 0.08);
    }
  });
});

describe('hash3', () => {
  it('matches pinned vectors', () => {
    expect(hash3(1337, 0, 0, 0)).toBe(1902051370);
    expect(hash3(1337, 1, 2, 3)).toBe(2062939764);
    expect(hash3(1337, 3, 2, 1)).toBe(842361634);
    expect(hash3(42, -5, 17, 1000)).toBe(2127764123);
  });

  it('depends on every coordinate, their order and the seed', () => {
    const base = hash3(7, 10, 20, 30);
    expect(hash3(7, 11, 20, 30)).not.toBe(base);
    expect(hash3(7, 10, 21, 30)).not.toBe(base);
    expect(hash3(7, 10, 20, 31)).not.toBe(base);
    expect(hash3(7, 30, 20, 10)).not.toBe(base);
    expect(hash3(8, 10, 20, 30)).not.toBe(base);
  });

  it('is repeatable', () => {
    expect(hash3(99, -3, 4, -5)).toBe(hash3(99, -3, 4, -5));
  });
});

describe('unitFloat', () => {
  it('stays inside [0, 1)', () => {
    expect(unitFloat(0)).toBe(0);
    expect(unitFloat(0xffffffff)).toBeLessThan(1);
  });
});

describe('createRng', () => {
  it('repeats for the same seed and differs between seeds', () => {
    const a = createRng(2024);
    const b = createRng(2024);
    const c = createRng(2025);
    const first = [a(), a(), a(), a()];
    expect([b(), b(), b(), b()]).toEqual(first);
    expect([c(), c(), c(), c()]).not.toEqual(first);
  });

  it('matches pinned values', () => {
    const rng = createRng(2024);
    expect([rng(), rng(), rng(), rng()].map((v) => Math.floor(v * 1e9))).toEqual([
      811762373, 710821494, 650525885, 685326264,
    ]);
  });

  it('stays inside [0, 1) with a mean near one half', () => {
    const rng = createRng(1);
    let sum = 0;
    const samples = 100000;
    for (let i = 0; i < samples; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(Math.abs(sum / samples - 0.5)).toBeLessThan(0.01);
  });
});
