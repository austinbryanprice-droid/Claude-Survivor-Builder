import {
  AVG_FPS_FLOOR,
  P95_LIMIT_MS,
  TARGET_FPS,
  holdsTarget,
  type BenchReport,
} from '../shared/bench-report';
import type { FrameSummary } from '../shared/frame-stats';
import type { QualityName } from '../shared/quality';

/** One preset's flight along the benchmark route. */
export interface PresetRun {
  readonly preset: QualityName;
  /** Internal render size in pixels, before the final upscale to the canvas. */
  readonly width: number;
  readonly height: number;
  /** The game's own report for the run: frame and CPU summaries, display rate, canvas and machine. */
  readonly report: BenchReport;
  /** GPU time per frame, or null when the browser has no timer queries. */
  readonly gpu: FrameSummary | null;
  /** Average draw calls and triangles per frame over the run, all passes counted. */
  readonly drawCalls: number;
  readonly triangles: number;
}

/** What the look page adds to the game's report: the valley and the timers behind the numbers. */
export interface SweepExtras {
  readonly timerQueries: boolean;
  /** Terrain mesher in use: 'surface-nets' or 'heightfield'. */
  readonly terrain: string;
  /** Build timings of the valley in milliseconds. */
  readonly build: {
    readonly field: number;
    readonly grid: number;
    readonly mesh: number;
    readonly scatter: number;
    readonly total: number;
  };
}

function fixed(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '-';
}

const label = (preset: QualityName): string => preset.charAt(0).toUpperCase() + preset.slice(1);

/**
 * The sweep as Markdown, ready to paste into the thread. The pass mark and every number except
 * the GPU column come from the same report the game page's `?bench=1` prints.
 */
export function formatSweepReport(runs: readonly PresetRun[], extras: SweepExtras): string {
  const first = runs[0]?.report;
  const lines: string[] = [
    `### Ashbound Outpost look benchmark, build ${first?.environment.buildId ?? '-'}`,
    '',
  ];
  if (runs.length > 0) {
    const verdicts = runs.map(
      (r) =>
        `${label(r.preset)} ${holdsTarget(r.report.frames) ? 'holds' : 'is below'} ${TARGET_FPS} FPS`,
    );
    lines.push(`Result: ${verdicts.join(', ')}`, '');
  }
  if (first) {
    const env = first.environment;
    lines.push(
      `- Graphics adapter: ${env.gpu}`,
      `- Browser: ${env.userAgent}`,
      `- Canvas: ${env.canvasWidth}x${env.canvasHeight} px at device pixel ratio ${fixed(env.devicePixelRatio, 2)}, display about ${first.refreshHz} Hz`,
      `- GPU timer queries: ${extras.timerQueries ? 'available' : 'not available (frame intervals only)'}`,
      `- Route: ${first.scriptSeconds} s through the valley per preset at golden hour after a 2 s warm-up, adaptive resolution off, terrain ${extras.terrain}`,
      `- Valley build: field ${fixed(extras.build.field, 0)} ms, ground grid ${fixed(extras.build.grid, 0)} ms, terrain mesh ${fixed(extras.build.mesh, 0)} ms, scatter ${fixed(extras.build.scatter, 0)} ms, total ${fixed(extras.build.total, 0)} ms`,
      '',
    );
  }
  lines.push(
    '| Preset | Internal size | Avg FPS | p95 ms | Slowest 1% FPS | Frames over 33 ms | CPU ms | GPU ms avg / p95 | Draw calls | Triangles | Holds 60 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  );
  for (const r of runs) {
    const f = r.report.frames;
    const gpu = r.gpu ? `${fixed(r.gpu.avgMs)} / ${fixed(r.gpu.p95Ms)}` : '-';
    lines.push(
      `| ${label(r.preset)} | ${r.width}x${r.height} | ${fixed(f.fps)} | ${fixed(f.p95Ms)} | ${fixed(f.low1PctFps, 0)} | ${f.slowFrames} | ${fixed(r.report.cpu.avgMs)} | ${gpu} | ${Math.round(r.drawCalls)} | ${Math.round(r.triangles / 1000)}k | ${holdsTarget(f) ? 'yes' : 'no'} |`,
    );
  }
  lines.push(
    '',
    `Holding 60 means an average of at least ${AVG_FPS_FLOOR} FPS and a 95th percentile frame time of at most ${P95_LIMIT_MS} ms, the pass mark of the game page's \`?bench=1\`.`,
  );
  return lines.join('\n');
}
