import type { QualityName } from '../shared/quality';

/** One preset's measurements from the benchmark route. */
export interface BenchRow {
  readonly preset: QualityName;
  /** Internal render size in pixels, before the final upscale to the canvas. */
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  readonly fps: number;
  readonly avgMs: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly worstMs: number;
  /** Average milliseconds per frame spent in JavaScript and command submission. */
  readonly cpuMs: number;
  /** GPU milliseconds per frame (average and 95th percentile), or null without timer queries. */
  readonly gpuAvgMs: number | null;
  readonly gpuP95Ms: number | null;
  readonly drawCalls: number;
  readonly triangles: number;
}

export interface BenchEnvironment {
  readonly adapter: string;
  readonly userAgent: string;
  readonly canvas: string;
  readonly timerQueries: boolean;
  /** Terrain mesher in use: 'surface-nets' or 'heightfield'. */
  readonly terrain: string;
  readonly seconds: number;
  /** Build timings of the valley in milliseconds. */
  readonly build: {
    readonly field: number;
    readonly grid: number;
    readonly mesh: number;
    readonly scatter: number;
    readonly total: number;
  };
}

/** The average frame rate and 95th percentile frame time that count as holding 60 FPS. */
export const HOLD_FPS = 57;
export const HOLD_P95_MS = 18.5;

/** Whether a preset held 60 FPS on the route: the average rate and the slow tail both count. */
export function holdsSixty(row: Pick<BenchRow, 'fps' | 'p95Ms'>): boolean {
  return row.fps >= HOLD_FPS && row.p95Ms <= HOLD_P95_MS;
}

function fixed(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '-';
}

/** The report as Markdown, ready to paste into the thread. */
export function formatReport(rows: readonly BenchRow[], env: BenchEnvironment): string {
  const lines: string[] = [
    '### Ashbound Outpost look spike benchmark',
    '',
    `- Graphics adapter: ${env.adapter}`,
    `- Browser: ${env.userAgent}`,
    `- Canvas: ${env.canvas}`,
    `- GPU timer queries: ${env.timerQueries ? 'available' : 'not available (frame intervals only)'}`,
    `- Route: ${env.seconds} s per preset at golden hour, adaptive resolution off, terrain ${env.terrain}`,
    `- Valley build: field ${fixed(env.build.field, 0)} ms, ground grid ${fixed(env.build.grid, 0)} ms, terrain mesh ${fixed(env.build.mesh, 0)} ms, scatter ${fixed(env.build.scatter, 0)} ms, total ${fixed(env.build.total, 0)} ms`,
    '',
    '| Preset | Internal size | FPS | Avg ms | p95 ms | p99 ms | Worst ms | CPU ms | GPU ms avg / p95 | Draw calls | Triangles | Holds 60 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const r of rows) {
    const gpu =
      r.gpuAvgMs === null ? '-' : `${fixed(r.gpuAvgMs)} / ${fixed(r.gpuP95Ms ?? Number.NaN)}`;
    lines.push(
      `| ${r.preset} | ${r.width}x${r.height} | ${fixed(r.fps)} | ${fixed(r.avgMs)} | ${fixed(r.p95Ms)} | ${fixed(r.p99Ms)} | ${fixed(r.worstMs)} | ${fixed(r.cpuMs)} | ${gpu} | ${Math.round(r.drawCalls)} | ${Math.round(r.triangles / 1000)}k | ${holdsSixty(r) ? 'yes' : 'no'} |`,
    );
  }
  lines.push(
    '',
    `Holding 60 means an average of at least ${HOLD_FPS} FPS and a 95th percentile frame time of at most ${HOLD_P95_MS} ms, which allows for timer jitter around a 60 Hz refresh.`,
  );
  return lines.join('\n');
}
