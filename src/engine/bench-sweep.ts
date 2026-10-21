import { createBenchmark, type Benchmark } from './bench';
import type { BenchEnvironment, BenchReport } from '../shared/bench-report';
import { TICK_SECONDS, createFixedStepper } from '../shared/fixed-step';
import { summarizeFrames } from '../shared/frame-stats';
import type { QualityName } from '../shared/quality';
import type { PresetRun } from '../shared/sweep-report';

/** What the sweep needs from the game, so tests can stand in for it. */
export interface SweepTarget {
  readonly quality: { readonly name: QualityName };
  /** Size and counts of the latest frame, all passes included. */
  readonly stats: {
    readonly value: {
      readonly width: number;
      readonly height: number;
      readonly drawCalls: number;
      readonly triangles: number;
    } | null;
  };
  /** GPU milliseconds of the latest finished frame, when the browser can time it. */
  readonly gpuMs: number | null;
  /** Counts finished GPU measurements, so a reader can tell a new one from the last. */
  readonly gpuSerial: number;
  applyQuality(name: QualityName): void;
  setMoment(name: string): void;
  /** The adaptive resolution governor would hide the cost of a preset, so the sweep turns it off. */
  setGovernor(on: boolean): void;
  /** Puts the camera `seconds` along the route, which takes `routeSeconds` to fly. */
  placeOnRoute(seconds: number, routeSeconds: number): void;
  /** Takes the camera off the route and back to the view the sweep started from. */
  endRoute(): void;
}

export type SweepState = 'idle' | 'running' | 'done' | 'cancelled';

/**
 * The game's `?bench=1`, flown through the valley once per preset. Each flight is one run of the
 * benchmark state machine (`bench.ts`): the same warm-up, the same route counted in simulation
 * ticks so every machine sees the same views, and the same report and pass mark. The sweep
 * switches presets between runs with the adaptive resolution governor off, and it keeps GPU time
 * and draw counts for each one.
 */
export class PresetSweep {
  state: SweepState = 'idle';
  /** Why the sweep stopped early, when it did. */
  note = '';
  readonly runs: PresetRun[] = [];

  private readonly bench: Benchmark;
  private readonly stepper = createFixedStepper();
  private readonly gpu: number[] = [];
  private presetIndex = 0;
  private startedQuality: QualityName = 'balanced';
  private drawCalls = 0;
  private triangles = 0;
  private measured = 0;
  private lastGpuSerial = 0;

  constructor(
    private readonly target: SweepTarget,
    /** Length of the route per preset, in seconds. */
    readonly seconds: number,
    private readonly presets: readonly QualityName[],
    describe: () => BenchEnvironment,
    private readonly onChange: () => void,
  ) {
    this.bench = createBenchmark(seconds, {
      prepare: () => {
        this.stepper.reset();
        this.target.placeOnRoute(0, this.seconds);
      },
      describe,
    });
    this.bench.onChange(() => {
      // A hidden tab ends the run; the next preset after a finished one starts after its frame.
      if (this.state === 'running' && this.bench.state === 'cancelled') {
        this.end('cancelled', this.bench.note);
      }
    });
  }

  get active(): boolean {
    return this.state === 'running';
  }

  /** The preset being flown, or null when no sweep is running. */
  get preset(): QualityName | null {
    return this.active ? (this.presets[this.presetIndex] ?? null) : null;
  }

  get presetCount(): number {
    return this.presets.length;
  }

  /** Position of the current preset in the sweep, from 0. */
  get presetNumber(): number {
    return this.presetIndex;
  }

  get warmingUp(): boolean {
    return this.bench.state === 'warmup';
  }

  /** 0 to 1 through the current preset's measured route; 0 during warm-up. */
  get progress(): number {
    return this.bench.progress;
  }

  start(): void {
    this.runs.length = 0;
    this.note = '';
    this.presetIndex = 0;
    this.startedQuality = this.target.quality.name;
    this.target.setMoment('golden');
    this.target.setGovernor(false);
    this.state = 'running';
    this.beginPreset();
  }

  /** Stops the sweep and keeps what it measured so far. */
  cancel(reason = 'Stopped with Esc.'): void {
    if (this.state !== 'running') return;
    this.bench.cancel(reason);
    if (this.state === 'running') this.end('cancelled', reason);
  }

  /**
   * Call before drawing each frame while the sweep is active: plays the simulation ticks this
   * frame covers and puts the camera where the route is.
   */
  beforeFrame(frameMs: number): void {
    if (this.state !== 'running') return;
    const ticks = this.stepper.advance(frameMs / 1000);
    for (let i = 0; i < ticks; i++) this.bench.advance();
    const along = this.bench.progress * this.seconds + this.stepper.alpha * TICK_SECONDS;
    this.target.placeOnRoute(Math.min(along, this.seconds), this.seconds);
  }

  /** Call after the frame is drawn, with the frame interval and the CPU time the frame took. */
  afterFrame(frameMs: number, cpuMs: number): void {
    if (this.state !== 'running') return;
    const measuring = this.bench.state === 'running';
    this.bench.recordFrame(frameMs, cpuMs);
    if (measuring) this.sample();
    if (this.bench.state === 'done') this.finishPreset();
  }

  dispose(): void {
    this.bench.dispose();
  }

  private beginPreset(): void {
    const preset = this.presets[this.presetIndex] as QualityName;
    this.target.applyQuality(preset);
    this.gpu.length = 0;
    this.drawCalls = 0;
    this.triangles = 0;
    this.measured = 0;
    this.lastGpuSerial = this.target.gpuSerial;
    this.bench.start();
    this.onChange();
  }

  private sample(): void {
    const stats = this.target.stats.value;
    if (stats) {
      this.drawCalls += stats.drawCalls;
      this.triangles += stats.triangles;
    }
    const serial = this.target.gpuSerial;
    if (this.target.gpuMs !== null && serial !== this.lastGpuSerial) {
      this.gpu.push(this.target.gpuMs);
    }
    this.lastGpuSerial = serial;
    this.measured++;
  }

  private finishPreset(): void {
    const size = this.target.stats.value;
    this.runs.push({
      preset: this.presets[this.presetIndex] as QualityName,
      width: size?.width ?? 0,
      height: size?.height ?? 0,
      report: this.bench.report as BenchReport,
      gpu: this.gpu.length > 0 ? summarizeFrames(this.gpu) : null,
      drawCalls: this.drawCalls / Math.max(1, this.measured),
      triangles: this.triangles / Math.max(1, this.measured),
    });
    this.presetIndex++;
    if (this.presetIndex >= this.presets.length) this.end('done', '');
    else this.beginPreset();
  }

  private end(state: 'done' | 'cancelled', note: string): void {
    this.state = state;
    this.note = note;
    this.target.endRoute();
    this.target.setGovernor(true);
    this.target.applyQuality(this.startedQuality);
    this.onChange();
  }
}
