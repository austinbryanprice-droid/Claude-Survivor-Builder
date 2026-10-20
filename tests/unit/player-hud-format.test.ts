import { describe, expect, it } from 'vitest';
import {
  cardinalLabel,
  clamp01,
  formatClock,
  formatDistance,
  hudScale,
  relativeBearing,
  segmentFills,
  wrapBearing,
} from '../../src/ui/player-hud/format';

describe('compass math', () => {
  it('wraps bearings into [0, 360)', () => {
    expect(wrapBearing(-90)).toBe(270);
    expect(wrapBearing(360)).toBe(0);
    expect(wrapBearing(725)).toBe(5);
  });

  it('finds the shortest signed angle between a heading and a bearing', () => {
    expect(relativeBearing(350, 10)).toBe(-20);
    expect(relativeBearing(10, 350)).toBe(20);
    expect(relativeBearing(90, 90)).toBe(0);
    expect(relativeBearing(180, 0)).toBe(-180);
    expect(relativeBearing(181, 0)).toBe(-179);
  });

  it('names the four cardinal directions at any multiple of 90 degrees', () => {
    expect(cardinalLabel(0)).toBe('N');
    expect(cardinalLabel(90)).toBe('E');
    expect(cardinalLabel(180)).toBe('S');
    expect(cardinalLabel(-90)).toBe('W');
    expect(cardinalLabel(450)).toBe('E');
    expect(cardinalLabel(45)).toBeNull();
  });
});

describe('formatting', () => {
  it('shows meters under a kilometer and kilometers above', () => {
    expect(formatDistance(540)).toBe('540M');
    expect(formatDistance(539.6)).toBe('540M');
    expect(formatDistance(-3)).toBe('0M');
    expect(formatDistance(1234)).toBe('1.2KM');
  });

  it('shows a buff timer as minutes and seconds', () => {
    expect(formatClock(652)).toBe('10:52');
    expect(formatClock(59.9)).toBe('0:59');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(-5)).toBe('0:00');
  });
});

describe('bars', () => {
  it('clamps to 0..1', () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(0.3)).toBe(0.3);
  });

  it('fills segments from the left, so a hit empties the last one first', () => {
    expect(segmentFills(1, 3)).toEqual([1, 1, 1]);
    expect(segmentFills(0, 3)).toEqual([0, 0, 0]);
    expect(segmentFills(0.5, 3)).toEqual([1, 0.5, 0]);
    const part = segmentFills(0.78, 3);
    expect(part[0]).toBe(1);
    expect(part[1]).toBe(1);
    expect(part[2]).toBeCloseTo(0.34, 9);
    expect(segmentFills(0.5, 0)).toHaveLength(1);
  });
});

describe('hudScale', () => {
  it('is 1 at the 1280 by 720 the layout is drawn for and follows the smaller axis', () => {
    expect(hudScale(1280, 720)).toBe(1);
    expect(hudScale(1920, 1080)).toBe(1.5);
    expect(hudScale(2560, 720)).toBe(1);
  });

  it('stays within a readable range', () => {
    expect(hudScale(320, 180)).toBe(0.7);
    expect(hudScale(7680, 4320)).toBe(1.7);
    expect(hudScale(Number.NaN, 720)).toBe(1);
  });
});
