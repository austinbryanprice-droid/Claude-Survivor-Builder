import { TARGET_FPS, holdsTarget, type BenchEnvironment } from '../shared/bench-report';
import { el } from '../ui/dom';
import type { PresetSweep } from './bench';
import { formatSweepReport, type PresetRun, type SweepExtras } from './bench-report';
import type { LookScene } from './look-scene';

/** A short message that fades out, for key presses that change something. */
export class Toast {
  readonly element = el('div', 'look-toast');
  private timer = 0;

  constructor() {
    this.element.setAttribute('role', 'status');
  }

  show(text: string): void {
    this.element.textContent = text;
    this.element.classList.add('on');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.element.classList.remove('on'), 1600);
  }
}

const KEY_HELP = [
  'WASD move · Shift sprint',
  'Space jump · F fly',
  'click for mouse look',
  '1-8 hotbar · wheel',
  'P quality · T time',
  'N shot · H HUD',
  'V this panel · B benchmark',
].join('\n');

/** Frame cost and scene counts in the lower left corner, and the key list in the lower right. */
export class StatsOverlay {
  readonly element: HTMLElement;
  private readonly stats = el('div', 'look-stats');
  private last = 0;
  private recent: number[] = [];

  constructor(
    element: HTMLElement,
    private readonly scene: LookScene,
    private readonly momentName: () => string,
  ) {
    this.element = element;
    this.element.append(this.stats, el('div', 'look-keys', KEY_HELP));
  }

  /** Call once per frame with the frame interval in milliseconds. */
  frame(intervalMs: number, now: number): void {
    if (intervalMs > 0 && intervalMs < 250) {
      this.recent.push(intervalMs);
      if (this.recent.length > 60) this.recent.shift();
    }
    if (now - this.last < 250 || this.recent.length === 0) return;
    this.last = now;
    const avg = this.recent.reduce((a, b) => a + b, 0) / this.recent.length;
    const s = this.scene.stats.value;
    const gpu = this.scene.gpuMs;
    const lines = [
      'Ashbound Outpost · look spike',
      `${this.scene.quality.name.toUpperCase()} · ${this.momentName()} · ${this.scene.shot ?? 'free'}`,
      `${s ? `${s.width}x${s.height}` : '-'} at scale ${this.scene.renderScale.toFixed(2)}`,
      `frame ${avg.toFixed(1)} ms (${(1000 / avg).toFixed(0)} fps)`,
      `cpu ${this.scene.cpuMs.toFixed(1)} ms${gpu === null ? '' : ` · gpu ${gpu.toFixed(1)} ms`}`,
      s ? `${s.drawCalls} draws · ${Math.round(s.triangles / 1000)}k tris` : '-',
    ];
    this.stats.textContent = lines.join('\n');
  }
}

function adapterName(scene: LookScene): string {
  const gl = scene.renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  if (!info) return 'unknown (browser hides it)';
  return String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
}

/** The machine and canvas as the game page's report describes them. */
export function describeMachine(scene: LookScene): BenchEnvironment {
  const size = scene.drawSize;
  const frame = scene.stats.value;
  return {
    buildId: __BUILD_ID__,
    gpu: adapterName(scene),
    userAgent: navigator.userAgent,
    canvasWidth: size.width,
    canvasHeight: size.height,
    devicePixelRatio: window.devicePixelRatio || 1,
    drawCalls: frame?.drawCalls ?? 0,
    triangles: frame?.triangles ?? 0,
  };
}

/** What this page adds to the report: the timers available and how long the valley took to build. */
export function sweepExtras(scene: LookScene): SweepExtras {
  const t = scene.timings;
  return {
    timerQueries: scene.gpuTimer.supported,
    terrain: scene.params.terrain,
    build: {
      field: t.fieldMs,
      grid: t.gridMs,
      mesh: t.meshMs,
      scatter: t.scatterMs,
      total: t.totalMs,
    },
  };
}

const presetName = (preset: string): string => preset.charAt(0).toUpperCase() + preset.slice(1);

/** The progress banner while the benchmark runs and the results card when it is done. */
export class BenchPanel {
  readonly banner = el('div', 'look-bench-banner');
  readonly results = el('div', 'look-bench-results');
  private bannerText = '';
  private drawnFor = '';

  constructor(
    private readonly sweep: PresetSweep,
    private readonly scene: LookScene,
  ) {
    this.banner.hidden = true;
    this.results.hidden = true;
  }

  refresh(): void {
    const sweep = this.sweep;
    this.banner.hidden = !sweep.active;
    if (sweep.active) {
      const where = `${presetName(sweep.preset ?? '')} (${sweep.presetNumber + 1} of ${sweep.presetCount})`;
      const percent = Math.round(sweep.progress * 100);
      const text = `Benchmark · ${where} · ${
        sweep.warmingUp ? 'warming up' : `${percent}%`
      } · press Esc to stop`;
      if (text !== this.bannerText) {
        this.bannerText = text;
        this.banner.textContent = text;
      }
    }
    const finished = sweep.state === 'done' || sweep.state === 'cancelled';
    if (!finished) {
      this.drawnFor = '';
      this.results.hidden = true;
      return;
    }
    // Draw the card once per finished sweep; closing it keeps it closed until the next one.
    const key = `${sweep.state}:${sweep.runs.length}:${sweep.runs.at(-1)?.report.finishedAt ?? ''}`;
    if (key !== this.drawnFor) {
      this.drawnFor = key;
      this.showResults();
    }
  }

  private showResults(): void {
    const sweep = this.sweep;
    const runs = sweep.runs;
    const extras = sweepExtras(this.scene);
    const report = formatSweepReport(runs, extras);
    this.results.replaceChildren();
    this.results.append(el('h2', undefined, 'Benchmark results'));
    const adapter = runs[0]?.report.environment.gpu ?? adapterName(this.scene);
    this.results.append(el('p', 'look-bench-adapter', adapter));
    if (sweep.state === 'cancelled') {
      this.results.append(el('p', 'look-bench-note', `Run stopped. ${sweep.note}`.trim()));
    }
    if (runs.length > 0) this.results.append(this.table(runs));
    const hint = el(
      'p',
      'look-bench-hint',
      `Balanced must hold ${TARGET_FPS} FPS at 1080p on a mid-range laptop. Copy the report and paste it into the thread.`,
    );
    const buttons = el('div', 'look-bench-buttons');
    const copy = el('button', 'look-button', 'Copy report');
    copy.type = 'button';
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(report).then(() => {
        copy.textContent = 'Copied';
      });
    });
    const again = el('button', 'look-button', 'Run again');
    again.type = 'button';
    again.addEventListener('click', () => {
      this.results.hidden = true;
      sweep.start();
    });
    const close = el('button', 'look-button', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => {
      this.results.hidden = true;
    });
    buttons.append(copy, again, close);
    this.results.append(hint, buttons);
    this.results.hidden = false;
  }

  private table(runs: readonly PresetRun[]): HTMLElement {
    const table = el('table', 'look-bench-table');
    const head = el('tr');
    for (const name of ['Preset', 'Size', 'FPS', 'avg ms', 'p95 ms', 'GPU ms', 'Holds 60']) {
      head.append(el('th', undefined, name));
    }
    table.append(head);
    for (const r of runs) {
      const frames = r.report.frames;
      const holds = holdsTarget(frames);
      const tr = el('tr');
      tr.dataset.holds = holds ? 'yes' : 'no';
      tr.dataset.preset = r.preset;
      for (const text of [
        presetName(r.preset),
        `${r.width}x${r.height}`,
        frames.fps.toFixed(1),
        frames.avgMs.toFixed(1),
        frames.p95Ms.toFixed(1),
        r.gpu ? r.gpu.avgMs.toFixed(1) : '-',
        holds ? 'yes' : 'no',
      ]) {
        tr.append(el('td', undefined, text));
      }
      table.append(tr);
    }
    return table;
  }
}
