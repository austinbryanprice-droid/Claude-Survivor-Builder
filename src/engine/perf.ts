/**
 * Frame timing and the adaptive resolution governor. The governor is how a preset holds its
 * frame rate on slower hardware: when frames run long it lowers the internal render scale a
 * step at a time, and it raises it again when there is headroom.
 */

export interface FrameSummary {
  readonly frames: number;
  readonly avgMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly worstMs: number;
  readonly fps: number;
  /** Share of frames that took longer than 16.7 ms. */
  readonly overBudget: number;
}

/** A ring of recent frame times in milliseconds. */
export class FrameStats {
  private readonly samples: Float32Array;
  private count = 0;
  private head = 0;

  constructor(readonly capacity = 240) {
    this.samples = new Float32Array(capacity);
  }

  push(ms: number): void {
    this.samples[this.head] = ms;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  reset(): void {
    this.count = 0;
    this.head = 0;
  }

  summary(): FrameSummary {
    const n = this.count;
    if (n === 0) {
      return {
        frames: 0,
        avgMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        worstMs: 0,
        fps: 0,
        overBudget: 0,
      };
    }
    const sorted = Array.from(this.samples.subarray(0, n)).sort((a, b) => a - b);
    let sum = 0;
    let over = 0;
    for (const v of sorted) {
      sum += v;
      if (v > 16.7) over++;
    }
    const at = (q: number): number => sorted[Math.min(n - 1, Math.floor(q * n))] as number;
    const avg = sum / n;
    return {
      frames: n,
      avgMs: avg,
      p50Ms: at(0.5),
      p95Ms: at(0.95),
      p99Ms: at(0.99),
      worstMs: sorted[n - 1] as number,
      fps: avg > 0 ? 1000 / avg : 0,
      overBudget: over / n,
    };
  }
}

/**
 * Chooses a render scale from smoothed frame time. It backs off quickly when over budget and
 * recovers slowly, with a dead band so the scale does not flutter.
 */
export class AdaptiveScale {
  private smoothed = 16;
  private cooldown = 0;
  scale: number;

  constructor(
    initial: number,
    private readonly min: number,
    private readonly max: number,
    /** Target frame time in milliseconds. */
    private readonly budgetMs = 15.2,
  ) {
    this.scale = initial;
  }

  /** Feeds one frame; returns true when the scale changed. */
  update(frameMs: number): boolean {
    this.smoothed += (Math.min(frameMs, 100) - this.smoothed) * 0.08;
    if (this.cooldown > 0) {
      this.cooldown--;
      return false;
    }
    let next = this.scale;
    if (this.smoothed > this.budgetMs * 1.08) {
      next = Math.max(this.min, this.scale - 0.06);
    } else if (this.smoothed < this.budgetMs * 0.72 && this.scale < this.max) {
      next = Math.min(this.max, this.scale + 0.03);
    }
    if (Math.abs(next - this.scale) < 0.005) return false;
    this.scale = next;
    this.cooldown = next < this.scale ? 20 : 90;
    this.smoothed = this.budgetMs;
    return true;
  }
}

/** Largest number of pixels each preset renders internally, however large the canvas is. */
export const MAX_INTERNAL_PIXELS = { low: 1.0e6, balanced: 2.1e6, ultra: 3.7e6 } as const;

/** The render scale that keeps the internal resolution within the preset's pixel budget. */
export function scaleForPixelBudget(
  canvasWidth: number,
  canvasHeight: number,
  maxPixels: number,
  preferred: number,
): number {
  const full = canvasWidth * canvasHeight;
  const cap = Math.sqrt(maxPixels / Math.max(1, full));
  return Math.min(preferred, cap, 1);
}
