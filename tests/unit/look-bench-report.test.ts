import { describe, expect, it } from 'vitest';
import {
  AVG_FPS_FLOOR,
  P95_LIMIT_MS,
  estimateRefreshHz,
  holdsTarget,
  type BenchReport,
} from '../../src/shared/bench-report';
import { summarizeFrames } from '../../src/shared/frame-stats';
import type { QualityName } from '../../src/shared/quality';
import { formatSweepReport, type PresetRun, type SweepExtras } from '../../src/spike/bench-report';

function reportFor(samples: readonly number[]): BenchReport {
  const frames = summarizeFrames(samples);
  return {
    scriptSeconds: 30,
    wallSeconds: 30.2,
    frames,
    cpu: summarizeFrames(samples.map(() => 4.2)),
    refreshHz: estimateRefreshHz(frames),
    environment: {
      buildId: 'abc1234',
      gpu: 'ANGLE (Test GPU)',
      userAgent: 'TestBrowser/1.0',
      canvasWidth: 1920,
      canvasHeight: 1080,
      devicePixelRatio: 1,
      drawCalls: 90,
      triangles: 800_000,
    },
    finishedAt: '2026-10-20T12:00:00.000Z',
  };
}

function run(preset: QualityName, frameMs: number, withGpu = true): PresetRun {
  const samples = new Array<number>(600).fill(frameMs);
  return {
    preset,
    width: 1920,
    height: 1080,
    report: reportFor(samples),
    gpu: withGpu ? summarizeFrames(samples.map(() => 9.1)) : null,
    drawCalls: 96.4,
    triangles: 812_345,
  };
}

const EXTRAS: SweepExtras = {
  timerQueries: true,
  terrain: 'surface-nets',
  build: { field: 3, grid: 160, mesh: 150, scatter: 70, total: 520 },
};

describe('formatSweepReport', () => {
  const text = formatSweepReport(
    [run('low', 1000 / 144), run('balanced', 1000 / 60), run('ultra', 1000 / 40)],
    EXTRAS,
  );

  it('leads with a verdict for each preset, using the game page pass mark', () => {
    expect(text).toContain('look benchmark, build abc1234');
    expect(text).toContain(
      'Result: Low holds 60 FPS, Balanced holds 60 FPS, Ultra is below 60 FPS',
    );
    expect(text).toContain(`at least ${AVG_FPS_FLOOR} FPS`);
    expect(text).toContain(`at most ${P95_LIMIT_MS} ms`);
  });

  it('names the machine, the route and the valley build once', () => {
    expect(text).toContain('Graphics adapter: ANGLE (Test GPU)');
    expect(text).toContain('Browser: TestBrowser/1.0');
    expect(text).toContain('Canvas: 1920x1080 px at device pixel ratio 1.00');
    expect(text).toContain('Route: 30 s through the valley per preset');
    expect(text).toContain('terrain surface-nets');
    expect(text).toContain('GPU timer queries: available');
    expect(text).toContain('total 520 ms');
  });

  it('has one table row per preset with the same numbers as the game page report', () => {
    const rows = text.split('\n').filter((line) => /^\| (Low|Balanced|Ultra) /.test(line));
    expect(rows).toHaveLength(3);
    const balanced = rows[1] ?? '';
    expect(balanced).toContain('| Balanced | 1920x1080 | 60.0 | 16.7 |');
    expect(balanced).toContain('| 4.2 | 9.1 / 9.1 | 96 | 812k | yes |');
    expect(rows[2]).toContain('| no |');
  });

  it('shows a dash when the browser has no GPU timer', () => {
    const none = formatSweepReport([run('balanced', 16.7, false)], {
      ...EXTRAS,
      timerQueries: false,
    });
    expect(none).toContain('not available (frame intervals only)');
    expect(none).toMatch(/\| 4\.2 \| - \| 96 \|/);
  });

  it('agrees with the shared verdict on a slow tail', () => {
    // The average is 57.1 FPS, enough on its own, but one frame in ten is slow.
    const tail = reportFor([...new Array<number>(540).fill(15), ...new Array<number>(60).fill(40)]);
    const slowTail: PresetRun = { ...run('balanced', 15), report: tail };
    expect(holdsTarget(tail.frames)).toBe(false);
    expect(formatSweepReport([slowTail], EXTRAS)).toContain('Balanced is below 60 FPS');
  });

  it('copes with a sweep that stopped before any preset finished', () => {
    const empty = formatSweepReport([], EXTRAS);
    expect(empty).toContain('look benchmark');
    expect(empty).not.toContain('Result:');
  });
});
