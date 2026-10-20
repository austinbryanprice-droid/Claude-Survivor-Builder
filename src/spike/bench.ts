import { summarizeFrames } from '../engine/perf';
import type { QualityName } from '../shared/quality';
import type { BenchRow } from './bench-report';
import type { LookScene } from './look-scene';

/** The route advances by a fixed step per frame, so a slow machine flies exactly the same path. */
const STEP_SECONDS = 1 / 60;

export type BenchState = 'idle' | 'running' | 'done';

/**
 * Flies the camera along the benchmark route once per preset, with the adaptive resolution
 * governor off, and records frame intervals, CPU time and (where the browser allows) GPU time.
 * The route is counted in frames, not seconds, so every machine sees the same views.
 */
export class Benchmark {
  state: BenchState = 'idle';
  readonly rows: BenchRow[] = [];

  private presetIndex = 0;
  private warmup = 0;
  private measured = 0;
  private readonly intervals: number[] = [];
  private readonly cpu: number[] = [];
  private readonly gpu: number[] = [];
  private drawCalls = 0;
  private triangles = 0;
  private lastGpuSerial = 0;
  private startedQuality: QualityName = 'balanced';

  constructor(
    private readonly scene: LookScene,
    /** Length of the route per preset, in seconds at 60 frames per second. */
    readonly seconds: number,
    private readonly presets: readonly QualityName[],
    private readonly onChange: () => void,
    /** Frames drawn before each measurement so shaders compile and caches fill. */
    private readonly warmupFrames = 90,
  ) {}

  get total(): number {
    return Math.round(this.seconds * 60);
  }

  get preset(): QualityName | null {
    return this.state === 'running' ? (this.presets[this.presetIndex] ?? null) : null;
  }

  /** 0 to 1 through the current preset's measured route; 0 during warm-up. */
  get progress(): number {
    return this.warmup > 0 ? 0 : this.measured / this.total;
  }

  start(): void {
    this.rows.length = 0;
    this.presetIndex = 0;
    this.startedQuality = this.scene.quality.name;
    this.scene.setMoment('golden');
    this.scene.setGovernor(false);
    this.state = 'running';
    this.beginPreset();
    this.onChange();
  }

  stop(): void {
    if (this.state !== 'running') return;
    this.finish();
  }

  /** Draws one frame of the route. `intervalMs` is the time since the previous frame. */
  tick(intervalMs: number): void {
    if (this.state !== 'running') return;
    this.scene.frame(STEP_SECONDS, 0);

    if (this.warmup > 0) {
      this.warmup--;
      return;
    }
    this.intervals.push(intervalMs);
    this.cpu.push(this.scene.cpuMs);
    const stats = this.scene.stats.value;
    if (stats) {
      this.drawCalls += stats.drawCalls;
      this.triangles += stats.triangles;
    }
    if (this.scene.gpuMs !== null && this.scene.gpuSerial !== this.lastGpuSerial) {
      this.gpu.push(this.scene.gpuMs);
    }
    this.lastGpuSerial = this.scene.gpuSerial;
    this.measured++;
    if (this.measured >= this.total) this.endPreset();
  }

  private beginPreset(): void {
    const preset = this.presets[this.presetIndex];
    if (!preset) return;
    this.scene.applyQuality(preset);
    this.scene.followPath(this.seconds);
    this.warmup = this.warmupFrames;
    this.measured = 0;
    this.intervals.length = 0;
    this.cpu.length = 0;
    this.gpu.length = 0;
    this.drawCalls = 0;
    this.triangles = 0;
    this.lastGpuSerial = this.scene.gpuSerial;
    this.onChange();
  }

  private endPreset(): void {
    const preset = this.presets[this.presetIndex] as QualityName;
    const frames = summarizeFrames(this.intervals);
    const gpu = this.gpu.length > 0 ? summarizeFrames(this.gpu) : null;
    const size = this.scene.stats.value;
    this.rows.push({
      preset,
      width: size?.width ?? 0,
      height: size?.height ?? 0,
      frames: frames.frames,
      fps: frames.fps,
      avgMs: frames.avgMs,
      p95Ms: frames.p95Ms,
      p99Ms: frames.p99Ms,
      worstMs: frames.worstMs,
      cpuMs: summarizeFrames(this.cpu).avgMs,
      gpuAvgMs: gpu ? gpu.avgMs : null,
      gpuP95Ms: gpu ? gpu.p95Ms : null,
      drawCalls: this.drawCalls / Math.max(1, this.measured),
      triangles: this.triangles / Math.max(1, this.measured),
    });
    this.presetIndex++;
    if (this.presetIndex >= this.presets.length) this.finish();
    else this.beginPreset();
  }

  private finish(): void {
    this.state = 'done';
    this.scene.followPath(null);
    this.scene.setGovernor(true);
    this.scene.applyQuality(this.startedQuality);
    this.scene.setShot(this.scene.shot ?? 'lake');
    this.onChange();
  }
}
