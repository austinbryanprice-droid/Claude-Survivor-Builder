import { describe, expect, it } from 'vitest';
import {
  AdaptiveScale,
  DEFAULT_GOVERNOR,
  FRAME_BUDGET_MS,
  FrameStats,
  MAX_INTERNAL_PIXELS,
  scaleForPixelBudget,
  summarizeFrames,
} from '../../src/engine/perf';

describe('summarizeFrames', () => {
  it('returns zeros for no samples', () => {
    expect(summarizeFrames([])).toEqual({
      frames: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      worstMs: 0,
      fps: 0,
      overBudget: 0,
    });
  });

  it('computes the average, percentiles, frame rate and the share over budget', () => {
    const s = summarizeFrames([10, 10, 10, 20, 30]);
    expect(s.frames).toBe(5);
    expect(s.avgMs).toBe(16);
    expect(s.p50Ms).toBe(10);
    expect(s.p95Ms).toBe(30);
    expect(s.worstMs).toBe(30);
    expect(s.fps).toBeCloseTo(62.5, 9);
    expect(s.overBudget).toBeCloseTo(0.4, 9);
  });

  it('does not depend on the order of the samples', () => {
    expect(summarizeFrames([30, 10, 20, 10, 10])).toEqual(summarizeFrames([10, 10, 10, 20, 30]));
  });

  it('keeps a ring of the most recent frames', () => {
    const stats = new FrameStats(4);
    for (const ms of [100, 1, 2, 3, 4]) stats.push(ms);
    const s = stats.summary();
    expect(s.frames).toBe(4);
    expect(s.worstMs).toBe(4);
    stats.reset();
    expect(stats.summary().frames).toBe(0);
  });
});

describe('scaleForPixelBudget', () => {
  it('leaves a canvas inside its budget alone', () => {
    expect(scaleForPixelBudget(1920, 1080, MAX_INTERNAL_PIXELS.balanced, 1)).toBe(1);
    expect(scaleForPixelBudget(1280, 720, MAX_INTERNAL_PIXELS.low, 0.75)).toBe(0.75);
  });

  it('scales a large canvas down to fit the pixel budget', () => {
    const scale = scaleForPixelBudget(3840, 2160, MAX_INTERNAL_PIXELS.balanced, 1);
    expect(scale).toBeCloseTo(Math.sqrt(MAX_INTERNAL_PIXELS.balanced / (3840 * 2160)), 9);
    expect(3840 * 2160 * scale * scale).toBeLessThanOrEqual(MAX_INTERNAL_PIXELS.balanced + 1);
  });
});

/**
 * A stand-in for a GPU: the frame needs `cost` milliseconds at full scale, scaling with the
 * pixel count, and a vsynced display shows it at the next multiple of the refresh interval.
 */
function simulate(
  governor: AdaptiveScale,
  cost: (frame: number) => number,
  frames: number,
): { changes: number; lastCost: number } {
  let changes = 0;
  let lastCost = 0;
  for (let frame = 0; frame < frames; frame++) {
    lastCost = cost(frame) * governor.scale * governor.scale;
    const shown = Math.max(1, Math.ceil(lastCost / FRAME_BUDGET_MS - 1e-9)) * FRAME_BUDGET_MS;
    if (governor.update(shown)) changes++;
  }
  return { changes, lastCost };
}

describe('AdaptiveScale', () => {
  it('stays at full scale when the GPU has headroom', () => {
    const governor = new AdaptiveScale(1, 0.7, 1);
    const { changes } = simulate(governor, () => 9, 3000);
    expect(changes).toBe(0);
    expect(governor.scale).toBe(1);
  });

  it('steps down until the frame fits the budget, and not below the floor', () => {
    const governor = new AdaptiveScale(1, 0.7, 1);
    const { lastCost } = simulate(governor, () => 24, 3000);
    expect(governor.scale).toBeLessThan(1);
    expect(governor.scale).toBeGreaterThanOrEqual(0.7);
    expect(lastCost).toBeLessThanOrEqual(FRAME_BUDGET_MS * 1.2);
  });

  it('stops at the floor when even that is too slow', () => {
    const governor = new AdaptiveScale(1, 0.7, 1);
    simulate(governor, () => 60, 4000);
    expect(governor.scale).toBeCloseTo(0.7, 9);
  });

  it('climbs back up when the load goes away', () => {
    const governor = new AdaptiveScale(1, 0.7, 1);
    simulate(governor, (frame) => (frame < 1500 ? 28 : 9), 12000);
    expect(governor.scale).toBe(1);
  });

  it('does not flutter when the scene really needs the lower scale', () => {
    const governor = new AdaptiveScale(1, 0.7, 1);
    const { changes } = simulate(governor, () => 22, 12000);
    // A few steps down, then a rare probe that fails and backs off.
    expect(changes).toBeLessThan(20);
  });

  it('climbs at once on a fast display with room to spare', () => {
    const governor = new AdaptiveScale(0.7, 0.7, 1);
    // Each step waits for the measuring window to refill, about 48 frames.
    for (let i = 0; i < 600; i++) governor.update(6);
    expect(governor.scale).toBe(1);
  });

  it('ignores outliers such as a paused tab', () => {
    const governor = new AdaptiveScale(1, 0.7, 1);
    for (let i = 0; i < 200; i++) expect(governor.update(5000)).toBe(false);
    expect(governor.update(0)).toBe(false);
    expect(governor.update(-4)).toBe(false);
    expect(governor.scale).toBe(1);
  });

  it('clamps a starting scale into its range', () => {
    expect(new AdaptiveScale(2, 0.7, 1).scale).toBe(1);
    expect(new AdaptiveScale(0.1, 0.7, 1).scale).toBe(0.7);
  });

  it('defends a 60 Hz frame', () => {
    expect(DEFAULT_GOVERNOR.targetMs).toBeCloseTo(16.667, 2);
  });
});
