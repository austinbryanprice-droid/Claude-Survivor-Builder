import {
  estimateRefreshHz,
  formatBenchReport,
  type BenchEnvironment,
  type BenchReport,
} from '../shared/bench-report';
import { TICK_RATE } from '../shared/fixed-step';
import { summarizeFrames } from '../shared/frame-stats';

export type BenchState = 'idle' | 'warmup' | 'running' | 'done' | 'cancelled';

/** Frames drawn before the measurement starts, so shader compilation and texture uploads are not counted. */
const WARMUP_SECONDS = 2;
/** Room for 400 frames per second, which is more than any display this targets. */
const MAX_FRAMES_PER_SECOND = 400;

export interface BenchmarkHooks {
  /** Puts the camera back at the start of the route. */
  prepare(): void;
  /** Reads the machine and scene details for the report. */
  describe(): BenchEnvironment;
}

export interface Benchmark {
  readonly state: BenchState;
  /** How far through the measured run, from 0 to 1. */
  readonly progress: number;
  readonly scriptSeconds: number;
  readonly report: BenchReport | null;
  /** Why the run stopped early, when it did. */
  readonly note: string;
  /** True while the benchmark, not the player, is in control (warm-up included). */
  readonly takesOver: boolean;
  start(): void;
  cancel(reason?: string): void;
  onChange(listener: () => void): () => void;
  /** Called once per simulation tick: counts the tick and ends the run on the last one. Read `progress` for where the route is. */
  advance(): void;
  /** Called once per rendered frame with the frame interval and the CPU time spent on it. */
  recordFrame(frameMs: number, cpuMs: number): void;
  dispose(): void;
}

export function createBenchmark(scriptSeconds: number, hooks: BenchmarkHooks): Benchmark {
  const totalTicks = Math.round(scriptSeconds * TICK_RATE);
  const capacity = Math.ceil(scriptSeconds * MAX_FRAMES_PER_SECOND) + 600;
  const frameMs = new Float32Array(capacity);
  const cpuMs = new Float32Array(capacity);
  const listeners = new Set<() => void>();

  let state: BenchState = 'idle';
  let tick = 0;
  let count = 0;
  let warmupLeft = 0;
  let report: BenchReport | null = null;
  let note = '';

  const emit = (): void => listeners.forEach((listener) => listener());
  const setState = (next: BenchState): void => {
    state = next;
    emit();
  };

  const finish = (): void => {
    const frames = summarizeFrames(frameMs.subarray(0, count));
    let wallMs = 0;
    for (let i = 0; i < count; i++) wallMs += frameMs[i] ?? 0;
    report = {
      scriptSeconds,
      wallSeconds: wallMs / 1000,
      frames,
      cpu: summarizeFrames(cpuMs.subarray(0, count)),
      refreshHz: estimateRefreshHz(frames),
      environment: hooks.describe(),
      finishedAt: new Date().toISOString(),
    };
    // eslint-disable-next-line no-console
    console.info(formatBenchReport(report));
    setState('done');
  };

  const nextTick = (): void => {
    tick++;
    if (tick >= totalTicks) finish();
  };

  const cancel = (reason = 'Cancelled.'): void => {
    if (state !== 'warmup' && state !== 'running') return;
    note = reason;
    setState('cancelled');
  };

  const onVisibility = (): void => {
    if (document.hidden) {
      cancel('The tab was hidden, so the run was stopped. Keep the tab in front and run it again.');
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    get state() {
      return state;
    },
    get progress() {
      return state === 'done' ? 1 : state === 'running' ? Math.min(1, tick / totalTicks) : 0;
    },
    scriptSeconds,
    get report() {
      return report;
    },
    get note() {
      return note;
    },
    get takesOver() {
      return state === 'warmup' || state === 'running';
    },
    start() {
      report = null;
      note = '';
      tick = 0;
      count = 0;
      warmupLeft = WARMUP_SECONDS;
      hooks.prepare();
      setState('warmup');
    },
    cancel,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    advance() {
      if (state === 'running') nextTick();
    },
    recordFrame(frameDurationMs, cpuDurationMs) {
      if (state === 'warmup') {
        warmupLeft -= frameDurationMs / 1000;
        if (warmupLeft <= 0) {
          hooks.prepare();
          tick = 0;
          setState('running');
        }
      } else if (state === 'running' && count < capacity) {
        frameMs[count] = frameDurationMs;
        cpuMs[count] = cpuDurationMs;
        count++;
      }
    },
    dispose() {
      document.removeEventListener('visibilitychange', onVisibility);
      listeners.clear();
    },
  };
}
