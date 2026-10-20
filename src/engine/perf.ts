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
    return summarizeFrames(this.samples.subarray(0, this.count));
  }
}

/** Average, percentiles and frame rate of a list of frame times in milliseconds. */
export function summarizeFrames(samples: ArrayLike<number>): FrameSummary {
  const n = samples.length;
  if (n === 0) {
    return { frames: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, worstMs: 0, fps: 0, overBudget: 0 };
  }
  const sorted = Array.from(samples).sort((a, b) => a - b);
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

/** Frame time of a 60 Hz display, the budget every preset is tuned against. */
export const FRAME_BUDGET_MS = 1000 / 60;

export interface GovernorTuning {
  /** Frame time the governor defends, in milliseconds. */
  readonly targetMs: number;
  /** Fraction of recent frames allowed over 1.2 times the target before the scale drops. */
  readonly overFraction: number;
  /** How far one step down moves the scale. */
  readonly stepDown: number;
  /** How far one step up moves the scale. */
  readonly stepUp: number;
  /** Frames of calm before the first attempt at a higher scale (5 s at 60 Hz). */
  readonly probeFrames: number;
  /** Longest wait between attempts after repeated failures (60 s at 60 Hz). */
  readonly maxProbeFrames: number;
}

export const DEFAULT_GOVERNOR: GovernorTuning = {
  targetMs: FRAME_BUDGET_MS,
  overFraction: 0.2,
  stepDown: 0.08,
  stepUp: 0.04,
  probeFrames: 300,
  maxProbeFrames: 3600,
};

const GOVERNOR_WINDOW = 48;
/** Frames to wait after a change before judging again, so the window refills with new data. */
const SETTLE_FRAMES = 40;
/** A probe that survives this many frames counts as a success. */
const PROBE_TRIAL_FRAMES = 150;

/**
 * Chooses an internal render scale from frame intervals so a preset holds its frame rate on
 * slower hardware. A vsynced loop shows the same 16.7 ms whether the GPU needs 6 ms or 16 ms, so
 * headroom cannot be read from the frame times alone. The governor therefore moves down when a
 * share of recent frames runs long, climbs at once when frames come in far under budget (a fast
 * display), and otherwise probes upward after a calm spell. A probe that fails drops the scale
 * back, remembers the highest scale that has held, and doubles the wait before the next probe, so
 * a scene that really needs the lower scale settles instead of fluttering. A probe above the
 * proven scale that holds halves the wait again, so a lighter scene is found within a minute or
 * two.
 */
export class AdaptiveScale {
  scale: number;
  private readonly window = new Float32Array(GOVERNOR_WINDOW);
  private filled = 0;
  private head = 0;
  private average = 0;
  private hold = SETTLE_FRAMES;
  private calm = 0;
  private probeWait: number;
  private probeAge = -1;
  private probeAboveProven = false;
  /** Highest scale that has held for a whole trial. */
  private proven: number;

  constructor(
    initial: number,
    private readonly min: number,
    private readonly max: number,
    private readonly tuning: GovernorTuning = DEFAULT_GOVERNOR,
  ) {
    this.scale = Math.min(max, Math.max(min, initial));
    this.probeWait = tuning.probeFrames;
    this.proven = this.scale;
  }

  /** Feeds the length of one frame in milliseconds; returns true when the scale changed. */
  update(frameMs: number): boolean {
    // Paused tabs and shader compiles produce huge outliers that say nothing about the load.
    if (!(frameMs > 0) || frameMs > 250) return false;
    const { targetMs } = this.tuning;
    this.window[this.head] = frameMs;
    this.head = (this.head + 1) % GOVERNOR_WINDOW;
    this.filled = Math.min(GOVERNOR_WINDOW, this.filled + 1);
    this.average = this.average === 0 ? frameMs : this.average + (frameMs - this.average) * 0.1;
    if (this.probeAge >= 0) this.probeAge++;

    if (this.hold > 0) {
      this.hold--;
      return false;
    }
    if (this.filled < GOVERNOR_WINDOW) return false;

    let over = 0;
    for (let i = 0; i < GOVERNOR_WINDOW; i++) {
      if ((this.window[i] as number) > targetMs * 1.2) over++;
    }
    const slow =
      over / GOVERNOR_WINDOW >= this.tuning.overFraction || this.average > targetMs * 1.15;
    if (slow) {
      this.calm = 0;
      if (this.probeAge >= 0) {
        // The probe failed: what held before it is the proven scale, and the next try waits longer.
        this.proven = Math.max(this.min, this.scale - this.tuning.stepUp);
        this.probeWait = Math.min(this.tuning.maxProbeFrames, this.probeWait * 2);
        this.probeAge = -1;
      }
      return this.move(-this.tuning.stepDown);
    }

    this.calm++;
    if (this.probeAge >= PROBE_TRIAL_FRAMES) {
      this.probeAge = -1;
      this.proven = Math.max(this.proven, this.scale);
      if (this.probeAboveProven) {
        this.probeWait = Math.max(this.tuning.probeFrames, Math.floor(this.probeWait / 2));
      }
    }
    if (this.scale >= this.max) return false;
    // Frames far under budget mean a fast display with room to spare: climb without waiting.
    if (this.average < targetMs * 0.72) {
      this.proven = Math.max(this.proven, this.scale + this.tuning.stepUp);
      return this.move(this.tuning.stepUp);
    }
    if (this.calm >= this.probeWait && this.probeAge < 0) {
      this.probeAge = 0;
      this.calm = 0;
      this.probeAboveProven = this.scale + this.tuning.stepUp > this.proven + 1e-9;
      return this.move(this.tuning.stepUp);
    }
    return false;
  }

  private move(delta: number): boolean {
    const next = Math.min(this.max, Math.max(this.min, this.scale + delta));
    if (Math.abs(next - this.scale) < 0.001) return false;
    this.scale = next;
    this.hold = SETTLE_FRAMES;
    this.filled = 0;
    this.head = 0;
    this.average = 0;
    return true;
  }
}

/**
 * GPU time per frame from timer queries (`EXT_disjoint_timer_query_webgl2`), when the browser
 * offers them. Results arrive a few frames late, so each frame starts one query and reads any
 * finished ones. Without the extension every method is a no-op and `supported` is false.
 */
export class GpuTimer {
  readonly supported: boolean;
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  /** Most recent finished measurement in milliseconds, or null before the first one. */
  lastMs: number | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.supported = this.ext !== null;
  }

  /** Starts timing the work submitted from here until `end`. */
  begin(): void {
    if (!this.ext || this.active || this.pending.length > 6) return;
    const query = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Reads every finished query and returns their durations in milliseconds. */
  collect(): number[] {
    const out: number[] = [];
    if (!this.ext) return out;
    const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length > 0) {
      const query = this.pending[0] as WebGLQuery;
      if (!this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      const ns = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) as number;
      this.gl.deleteQuery(query);
      if (!disjoint) {
        this.lastMs = ns / 1e6;
        out.push(this.lastMs);
      }
    }
    return out;
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
