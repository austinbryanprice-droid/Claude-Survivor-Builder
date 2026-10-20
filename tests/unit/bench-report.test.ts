import { describe, expect, it } from 'vitest';
import {
  estimateRefreshHz,
  formatBenchReport,
  holdsTarget,
  type BenchReport,
} from '../../src/shared/bench-report';
import { summarizeFrames, type FrameSummary } from '../../src/shared/frame-stats';

const steady = (hz: number, frames = 600): FrameSummary =>
  summarizeFrames(new Array<number>(frames).fill(1000 / hz));

function reportFor(frames: FrameSummary): BenchReport {
  return {
    scriptSeconds: 30,
    wallSeconds: 30.1,
    frames,
    cpu: summarizeFrames([2.1, 2.3, 2.2, 5.8]),
    refreshHz: estimateRefreshHz(frames),
    environment: {
      buildId: 'abc1234',
      gpu: 'ANGLE (Test GPU)',
      userAgent: 'Test Browser/1.0',
      canvasWidth: 1920,
      canvasHeight: 1080,
      devicePixelRatio: 1,
      drawCalls: 41,
      triangles: 61234,
    },
    finishedAt: '2026-10-20T12:00:00.000Z',
  };
}

describe('holdsTarget', () => {
  it('holds at a steady 60, 120 and 144 FPS', () => {
    expect(holdsTarget(steady(60))).toBe(true);
    expect(holdsTarget(steady(120))).toBe(true);
    expect(holdsTarget(steady(144))).toBe(true);
  });

  it('allows a little timer jitter around 60 Hz', () => {
    const jittery = Array.from({ length: 600 }, (_, i) => 16.67 + (i % 2 === 0 ? 0.9 : -0.9));
    expect(holdsTarget(summarizeFrames(jittery))).toBe(true);
  });

  it('fails at 30 and 45 FPS', () => {
    expect(holdsTarget(steady(30))).toBe(false);
    expect(holdsTarget(steady(45))).toBe(false);
  });

  it('fails when the average is fine but one frame in ten stutters', () => {
    const frames = Array.from({ length: 600 }, (_, i) => (i % 10 === 0 ? 40 : 13));
    const summary = summarizeFrames(frames);
    expect(summary.fps).toBeGreaterThan(57);
    expect(holdsTarget(summary)).toBe(false);
  });

  it('fails with no frames at all', () => {
    expect(holdsTarget(summarizeFrames([]))).toBe(false);
  });
});

describe('estimateRefreshHz', () => {
  it('rounds the typical frame time to a whole refresh rate', () => {
    expect(estimateRefreshHz(steady(60))).toBe(60);
    expect(estimateRefreshHz(steady(144))).toBe(144);
    expect(estimateRefreshHz(summarizeFrames([]))).toBe(0);
  });
});

describe('formatBenchReport', () => {
  it('leads with the verdict and carries the numbers Austin will paste back', () => {
    const text = formatBenchReport(reportFor(steady(60)));
    const lines = text.split('\n');
    expect(lines[0]).toBe('Ashbound Outpost benchmark, build abc1234');
    expect(lines[1]).toBe('Result: Holds 60 FPS');
    expect(text).toContain('Average 60.0 FPS (16.67 ms)');
    expect(text).toContain('95th percentile 16.7 ms');
    expect(text).toContain('display about 60 Hz');
    expect(text).toContain(
      'Canvas: 1920x1080 px at device pixel ratio 1.00; 41 draw calls, 61,234 triangles',
    );
    expect(text).toContain('GPU: ANGLE (Test GPU)');
    expect(text).toContain('Browser: Test Browser/1.0');
  });

  it('says plainly when the target was missed and what counts as holding it', () => {
    const text = formatBenchReport(reportFor(steady(30)));
    expect(text).toContain('Result: Below 60 FPS');
    expect(text).toContain('at least 57');
    expect(text).toContain('18.5 ms');
    expect(text).toContain('frames over 33 ms: 0');
  });
});
