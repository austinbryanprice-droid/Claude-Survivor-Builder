import { describe, expect, it } from 'vitest';
import {
  EMPTY_SUMMARY,
  SampleWindow,
  percentile,
  summarizeFrames,
} from '../../src/shared/frame-stats';

describe('percentile', () => {
  it('uses the nearest rank', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 0.5)).toBe(50);
    expect(percentile(sorted, 0.95)).toBe(95);
    expect(percentile(sorted, 0.99)).toBe(99);
    expect(percentile(sorted, 1)).toBe(100);
    expect(percentile(sorted, 0)).toBe(1);
  });

  it('handles empty and single-element input', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([7], 0.99)).toBe(7);
  });
});

describe('summarizeFrames', () => {
  it('is empty for no frames', () => {
    expect(summarizeFrames([])).toBe(EMPTY_SUMMARY);
  });

  it('reports a steady 60 FPS', () => {
    const summary = summarizeFrames(new Array<number>(600).fill(1000 / 60));
    expect(summary.frames).toBe(600);
    expect(summary.fps).toBeCloseTo(60, 6);
    expect(summary.avgMs).toBeCloseTo(16.6667, 3);
    expect(summary.p95Ms).toBeCloseTo(16.6667, 3);
    expect(summary.low1PctFps).toBeCloseTo(60, 6);
    expect(summary.slowFrames).toBe(0);
  });

  it('shows hitches in the tail and the one percent lows', () => {
    const frames = new Array<number>(1000).fill(16.7);
    for (let i = 0; i < 10; i++) frames[i * 97] = 50;
    const summary = summarizeFrames(frames);
    expect(summary.slowFrames).toBe(10);
    expect(summary.maxMs).toBe(50);
    expect(summary.p50Ms).toBe(16.7);
    expect(summary.p99Ms).toBe(16.7);
    expect(summary.low1PctFps).toBeCloseTo(20, 6);
    expect(summary.fps).toBeLessThan(60);
  });

  it('does not reorder or change the input', () => {
    const frames = [30, 10, 20];
    summarizeFrames(frames);
    expect(frames).toEqual([30, 10, 20]);
  });
});

describe('SampleWindow', () => {
  it('keeps only the newest samples, oldest first', () => {
    const window = new SampleWindow(3);
    [1, 2, 3, 4, 5].forEach((v) => window.push(v));
    expect(window.length).toBe(3);
    expect(window.toArray()).toEqual([3, 4, 5]);
    expect(window.fromNewest(0)).toBe(5);
    expect(window.fromNewest(2)).toBe(3);
    expect(window.fromNewest(3)).toBe(0);
  });

  it('summarizes what it holds and clears', () => {
    const window = new SampleWindow(4);
    [10, 20].forEach((v) => window.push(v));
    expect(window.toArray()).toEqual([10, 20]);
    expect(window.summary().avgMs).toBe(15);
    window.clear();
    expect(window.length).toBe(0);
    expect(window.summary()).toBe(EMPTY_SUMMARY);
  });
});
