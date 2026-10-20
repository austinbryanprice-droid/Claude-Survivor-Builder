import { el } from '../ui/dom';
import { formatReport, holdsSixty, type BenchEnvironment, type BenchRow } from './bench-report';
import type { Benchmark } from './bench';
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

export function benchEnvironment(scene: LookScene, seconds: number): BenchEnvironment {
  const t = scene.timings;
  const size = scene.drawSize;
  return {
    adapter: adapterName(scene),
    userAgent: navigator.userAgent,
    canvas: `${size.width}x${size.height} (device pixel ratio ${(window.devicePixelRatio || 1).toFixed(2)})`,
    timerQueries: scene.gpuTimer.supported,
    terrain: scene.params.terrain,
    seconds,
    build: {
      field: t.fieldMs,
      grid: t.gridMs,
      mesh: t.meshMs,
      scatter: t.scatterMs,
      total: t.totalMs,
    },
  };
}

/** The progress banner while the benchmark runs and the results card when it is done. */
export class BenchPanel {
  readonly banner = el('div', 'look-bench-banner');
  readonly results = el('div', 'look-bench-results');
  private bannerText = '';

  constructor(
    private readonly bench: Benchmark,
    private readonly scene: LookScene,
  ) {
    this.banner.hidden = true;
    this.results.hidden = true;
  }

  refresh(): void {
    const running = this.bench.state === 'running';
    this.banner.hidden = !running;
    if (running) {
      const preset = this.bench.preset;
      const percent = Math.round(this.bench.progress * 100);
      const text = `Benchmark · ${preset?.toUpperCase() ?? ''} · ${
        this.bench.progress === 0 ? 'warming up' : `${percent}%`
      } · press Esc to stop`;
      if (text !== this.bannerText) {
        this.bannerText = text;
        this.banner.textContent = text;
      }
    }
    if (this.bench.state === 'done' && this.bench.rows.length > 0) this.showResults();
    else this.results.hidden = true;
  }

  private showResults(): void {
    const rows = this.bench.rows;
    const env = benchEnvironment(this.scene, this.bench.seconds);
    const report = formatReport(rows, env);
    this.results.replaceChildren();
    this.results.append(el('h2', undefined, 'Benchmark results'));
    this.results.append(el('p', 'look-bench-adapter', env.adapter));
    this.results.append(this.table(rows));
    const hint = el(
      'p',
      'look-bench-hint',
      'Balanced must hold 60 FPS at 1080p on a mid-range laptop. Copy the report and paste it into the thread.',
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
    again.addEventListener('click', () => this.bench.start());
    const close = el('button', 'look-button', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => {
      this.results.hidden = true;
    });
    buttons.append(copy, again, close);
    this.results.append(hint, buttons);
    this.results.hidden = false;
  }

  private table(rows: readonly BenchRow[]): HTMLElement {
    const table = el('table', 'look-bench-table');
    const head = el('tr');
    for (const name of ['Preset', 'Size', 'FPS', 'avg ms', 'p95 ms', 'GPU ms', 'Holds 60']) {
      head.append(el('th', undefined, name));
    }
    table.append(head);
    for (const r of rows) {
      const tr = el('tr');
      tr.dataset.holds = holdsSixty(r) ? 'yes' : 'no';
      const gpu = r.gpuAvgMs === null ? '-' : r.gpuAvgMs.toFixed(1);
      for (const text of [
        r.preset,
        `${r.width}x${r.height}`,
        r.fps.toFixed(1),
        r.avgMs.toFixed(1),
        r.p95Ms.toFixed(1),
        gpu,
        holdsSixty(r) ? 'yes' : 'no',
      ]) {
        tr.append(el('td', undefined, text));
      }
      table.append(tr);
    }
    return table;
  }
}
