import { describe, expect, it } from 'vitest';
import { fbm2, fbm3, mix, noise2, noise3, ridge2, smin, smoothstep } from '../../src/shared/noise';

describe('value noise', () => {
  it('repeats exactly for the same seed and point', () => {
    expect(noise2(7, 1.3, -2.7)).toBe(noise2(7, 1.3, -2.7));
    expect(noise3(7, 1.3, -2.7, 4.1)).toBe(noise3(7, 1.3, -2.7, 4.1));
    expect(fbm2(7, 1.3, -2.7, 4)).toBe(fbm2(7, 1.3, -2.7, 4));
  });

  it('matches the recorded values, so a change to the terrain function is noticed', () => {
    expect(noise2(7, 1.3, -2.7)).toBeCloseTo(0.6381024225848273, 12);
    expect(noise3(7, 1.3, -2.7, 4.1)).toBeCloseTo(0.4954714590769085, 12);
    expect(fbm2(7, 1.3, -2.7, 4)).toBeCloseTo(0.1380595015622039, 12);
    expect(fbm3(7, 1.3, -2.7, 4.1, 3)).toBeCloseTo(-0.0692804454847956, 12);
    expect(ridge2(7, 1.3, -2.7, 3)).toBeCloseTo(0.59275575278504, 12);
  });

  it('differs between seeds', () => {
    expect(noise2(7, 1.3, -2.7)).not.toBe(noise2(8, 1.3, -2.7));
  });

  it('stays in range over a sweep', () => {
    for (let i = 0; i < 400; i++) {
      const x = i * 0.37 - 80;
      const y = i * 0.53 - 100;
      const n2 = noise2(3, x, y);
      const n3 = noise3(3, x, y, x * 0.5);
      expect(n2).toBeGreaterThanOrEqual(0);
      expect(n2).toBeLessThan(1);
      expect(n3).toBeGreaterThanOrEqual(0);
      expect(n3).toBeLessThan(1);
      expect(Math.abs(fbm2(3, x, y, 4))).toBeLessThanOrEqual(1);
      expect(Math.abs(fbm3(3, x, y, x, 3))).toBeLessThanOrEqual(1);
      const r = ridge2(3, x, y, 4);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it('is continuous: nearby points give nearby values', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.71;
      const y = i * 0.43 + 5;
      expect(Math.abs(noise2(5, x + 0.01, y) - noise2(5, x, y))).toBeLessThan(0.05);
      expect(Math.abs(fbm2(5, x, y + 0.01, 3) - fbm2(5, x, y, 3))).toBeLessThan(0.1);
    }
  });
});

describe('shaping helpers', () => {
  it('smoothstep rises and falls and clamps outside its edges', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
    // A falling edge, as the terrain uses for the lake basin.
    expect(smoothstep(1, 0, 1.5)).toBe(0);
    expect(smoothstep(1, 0, -0.5)).toBe(1);
  });

  it('smin never exceeds either input and is a plain minimum far apart', () => {
    expect(smin(1, 5, 1.3)).toBeLessThanOrEqual(1);
    expect(smin(2, 2, 1.3)).toBeLessThan(2);
    expect(smin(-6, 4, 1.3)).toBeCloseTo(-6, 12);
    expect(smin(4, -6, 1.3)).toBeCloseTo(-6, 12);
  });

  it('mix interpolates linearly', () => {
    expect(mix(2, 10, 0)).toBe(2);
    expect(mix(2, 10, 1)).toBe(10);
    expect(mix(2, 10, 0.25)).toBe(4);
  });
});
