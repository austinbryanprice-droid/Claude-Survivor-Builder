/** Frame-time statistics for the overlay and the benchmark. Times are milliseconds per frame. */

export interface FrameSummary {
  frames: number;
  /** Mean frame time. */
  avgMs: number;
  /** Frames per second implied by the mean frame time. */
  fps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** Frames per second over the slowest 1% of frames (their mean frame time, inverted). */
  low1PctFps: number;
  /** Frames that took longer than 33.3 ms, i.e. missed two 60 Hz refreshes. */
  slowFrames: number;
}

export const EMPTY_SUMMARY: FrameSummary = {
  frames: 0,
  avgMs: 0,
  fps: 0,
  p50Ms: 0,
  p95Ms: 0,
  p99Ms: 0,
  maxMs: 0,
  low1PctFps: 0,
  slowFrames: 0,
};

/** The frame time that counts as a missed 60 Hz refresh, with a little slack for timer jitter. */
export const SLOW_FRAME_MS = 33.4;

/** Nearest-rank percentile of an ascending array; `p` is in [0, 1]. */
export function percentile(sortedAscending: ArrayLike<number>, p: number): number {
  const n = sortedAscending.length;
  if (n === 0) return 0;
  const rank = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
  return sortedAscending[rank] ?? 0;
}

export function summarizeFrames(samples: ArrayLike<number>): FrameSummary {
  const n = samples.length;
  if (n === 0) return EMPTY_SUMMARY;
  const sorted = Float64Array.from(samples).sort();
  let sum = 0;
  let slowFrames = 0;
  for (let i = 0; i < n; i++) {
    const ms = sorted[i] ?? 0;
    sum += ms;
    if (ms > SLOW_FRAME_MS) slowFrames++;
  }
  const avgMs = sum / n;
  const worst = Math.max(1, Math.ceil(n * 0.01));
  let worstSum = 0;
  for (let i = n - worst; i < n; i++) worstSum += sorted[i] ?? 0;
  return {
    frames: n,
    avgMs,
    fps: avgMs > 0 ? 1000 / avgMs : 0,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted[n - 1] ?? 0,
    low1PctFps: worstSum > 0 ? 1000 / (worstSum / worst) : 0,
    slowFrames,
  };
}

/** A fixed-size ring of the most recent samples, oldest first when read back. */
export class SampleWindow {
  private readonly values: Float64Array;
  private next = 0;
  private filled = 0;

  constructor(readonly capacity: number) {
    this.values = new Float64Array(capacity);
  }

  get length(): number {
    return this.filled;
  }

  push(value: number): void {
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
  }

  clear(): void {
    this.next = 0;
    this.filled = 0;
  }

  /** The sample `age` frames back; 0 is the newest. */
  fromNewest(age: number): number {
    if (age < 0 || age >= this.filled) return 0;
    return this.values[(this.next - 1 - age + this.capacity * 2) % this.capacity] ?? 0;
  }

  toArray(): number[] {
    const out: number[] = [];
    for (let age = this.filled - 1; age >= 0; age--) out.push(this.fromNewest(age));
    return out;
  }

  summary(): FrameSummary {
    return summarizeFrames(this.toArray());
  }
}
