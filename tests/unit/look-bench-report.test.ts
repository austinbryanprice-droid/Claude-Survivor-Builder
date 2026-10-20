import { describe, expect, it } from 'vitest';
import {
  HOLD_FPS,
  HOLD_P95_MS,
  formatReport,
  holdsSixty,
  type BenchEnvironment,
  type BenchRow,
} from '../../src/spike/bench-report';

function row(partial: Partial<BenchRow>): BenchRow {
  return {
    preset: 'balanced',
    width: 1920,
    height: 1080,
    frames: 720,
    fps: 60,
    avgMs: 16.7,
    p95Ms: 17.5,
    p99Ms: 19,
    worstMs: 25,
    cpuMs: 4.2,
    gpuAvgMs: 9.1,
    gpuP95Ms: 11.4,
    drawCalls: 96.4,
    triangles: 812_345,
    ...partial,
  };
}

const ENV: BenchEnvironment = {
  adapter: 'ANGLE (Test GPU)',
  userAgent: 'TestBrowser/1.0',
  canvas: '1920x1080 (device pixel ratio 1.00)',
  timerQueries: true,
  terrain: 'surface-nets',
  seconds: 12,
  build: { field: 3, grid: 160, mesh: 150, scatter: 70, total: 520 },
};

describe('holdsSixty', () => {
  it('needs both the average rate and the slow tail', () => {
    expect(holdsSixty({ fps: 60, p95Ms: 17 })).toBe(true);
    expect(holdsSixty({ fps: HOLD_FPS, p95Ms: HOLD_P95_MS })).toBe(true);
    expect(holdsSixty({ fps: HOLD_FPS - 0.1, p95Ms: 17 })).toBe(false);
    expect(holdsSixty({ fps: 60, p95Ms: HOLD_P95_MS + 0.1 })).toBe(false);
    expect(holdsSixty({ fps: 144, p95Ms: 8 })).toBe(true);
  });
});

describe('formatReport', () => {
  it('writes the environment and one table row per preset', () => {
    const report = formatReport(
      [
        row({ preset: 'low', fps: 60, width: 1440, height: 810 }),
        row({ preset: 'balanced' }),
        row({ preset: 'ultra', fps: 38.2, p95Ms: 31.4, gpuAvgMs: null, gpuP95Ms: null }),
      ],
      ENV,
    );
    expect(report).toContain('Graphics adapter: ANGLE (Test GPU)');
    expect(report).toContain('terrain surface-nets');
    expect(report).toContain('12 s per preset');
    expect(report).toContain('| low | 1440x810 |');
    expect(report).toContain(
      '| balanced | 1920x1080 | 60.0 | 16.7 | 17.5 | 19.0 | 25.0 | 4.2 | 9.1 / 11.4 | 96 | 812k | yes |',
    );
    expect(report).toMatch(/\| ultra \| 1920x1080 \| 38\.2 \|.*\| - \| .* \| no \|/);
    expect(report.split('\n').filter((line) => line.startsWith('| '))).toHaveLength(2 + 3);
  });

  it('says so when the browser has no GPU timer', () => {
    const report = formatReport([row({})], { ...ENV, timerQueries: false });
    expect(report).toContain('not available');
  });
});
