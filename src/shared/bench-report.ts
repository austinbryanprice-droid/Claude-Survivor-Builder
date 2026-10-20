import type { FrameSummary } from './frame-stats';

/** What a benchmark report needs to know about the machine and the scene it ran on. */
export interface BenchEnvironment {
  buildId: string;
  /** The graphics adapter as the browser reports it (the unmasked renderer when allowed). */
  gpu: string;
  userAgent: string;
  /** Size of the drawing buffer in device pixels. */
  canvasWidth: number;
  canvasHeight: number;
  devicePixelRatio: number;
  drawCalls: number;
  triangles: number;
}

export interface BenchReport {
  /** Length of the scripted flythrough, in simulated seconds. */
  scriptSeconds: number;
  /** Time between the first and last measured frame, in real seconds. */
  wallSeconds: number;
  /** Frame-to-frame time as the browser presents frames. */
  frames: FrameSummary;
  /** Time our own frame callback took on the CPU, which excludes waiting for the GPU. */
  cpu: FrameSummary;
  /** Display refresh rate inferred from the typical frame time, rounded to a whole number. */
  refreshHz: number;
  environment: BenchEnvironment;
  finishedAt: string;
}

/** The target from SPEC section 1: a steady 60 frames per second. */
export const TARGET_FPS = 60;

/** Allows for timer jitter around the 16.7 ms of a 60 Hz refresh. */
const P95_LIMIT_MS = 18.5;
const AVG_FPS_FLOOR = 57;

export function holdsTarget(frames: FrameSummary): boolean {
  return frames.frames > 0 && frames.fps >= AVG_FPS_FLOOR && frames.p95Ms <= P95_LIMIT_MS;
}

export function estimateRefreshHz(frames: FrameSummary): number {
  return frames.p50Ms > 0 ? Math.round(1000 / frames.p50Ms) : 0;
}

const fixed = (value: number, digits = 1): string => value.toFixed(digits);

/** A plain-text report short enough to paste into a chat message. */
export function formatBenchReport(report: BenchReport): string {
  const { frames, cpu, environment: env } = report;
  const verdict = holdsTarget(frames)
    ? `Holds ${TARGET_FPS} FPS`
    : `Below ${TARGET_FPS} FPS (average at least ${AVG_FPS_FLOOR} and 95th percentile at most ${P95_LIMIT_MS} ms counts as holding it)`;
  return [
    `Ashbound Outpost benchmark, build ${env.buildId}`,
    `Result: ${verdict}`,
    `Average ${fixed(frames.fps)} FPS (${fixed(frames.avgMs, 2)} ms), 95th percentile ${fixed(frames.p95Ms)} ms, slowest 1% ${fixed(frames.low1PctFps, 0)} FPS`,
    `Frames: ${frames.frames} in ${fixed(report.wallSeconds)} s, display about ${report.refreshHz} Hz, frames over 33 ms: ${frames.slowFrames}`,
    `Frame time ms: avg ${fixed(frames.avgMs, 2)}, p50 ${fixed(frames.p50Ms)}, p95 ${fixed(frames.p95Ms)}, p99 ${fixed(frames.p99Ms)}, max ${fixed(frames.maxMs)}`,
    `CPU time per frame ms: avg ${fixed(cpu.avgMs, 2)}, p95 ${fixed(cpu.p95Ms, 2)}, max ${fixed(cpu.maxMs, 2)}`,
    `Canvas: ${env.canvasWidth}x${env.canvasHeight} px at device pixel ratio ${fixed(env.devicePixelRatio, 2)}; ${env.drawCalls} draw calls, ${env.triangles.toLocaleString('en-US')} triangles`,
    `GPU: ${env.gpu}`,
    `Browser: ${env.userAgent}`,
  ].join('\n');
}
