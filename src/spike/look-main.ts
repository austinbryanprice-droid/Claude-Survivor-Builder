import '../ui/styles.css';
import './look.css';
import { QUALITY_PRESETS, type QualityName } from '../shared/quality';
import { PresetSweep } from './bench';
import { HudDemo } from './hud-demo';
import { LookScene } from './look-scene';
import { BenchPanel, StatsOverlay, Toast, describeMachine } from './panels';
import { readLookParams } from './params';
import { SHOTS } from './shots';

/** What the look page exposes on `window` for tests and screenshot scripts (`?debug`). */
export interface LookHandle {
  readonly scene: LookScene;
  readonly hud: HudDemo;
  readonly sweep: PresetSweep;
  /** Draws a frame right now, regardless of freeze. */
  renderNow(): void;
  frames: number;
}

declare global {
  interface Window {
    __look?: LookHandle;
  }
}

/** Order the P key cycles through (also the default order of the benchmark). */
const QUALITY_CYCLE: readonly QualityName[] = ['low', 'balanced', 'ultra'];
/** Order the T key cycles through. */
const MOMENT_CYCLE = ['golden', 'morning', 'noon', 'afternoon', 'sunset', 'dusk', 'night'] as const;

function showFatal(message: string): void {
  const el = document.querySelector<HTMLElement>('#fatal');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function main(): Promise<void> {
  const params = readLookParams(window.location.search);
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  const hudParent = document.querySelector<HTMLElement>('#hud');
  const overlayParent = document.querySelector<HTMLElement>('#look-overlay');
  if (!canvas || !hudParent || !overlayParent) throw new Error('Missing page elements');
  document.body.classList.toggle('no-hud', !params.hud);

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    showFatal('The graphics context was lost. Reload the page to continue.');
  });

  // Let the "Generating the valley" text paint before the synchronous build starts.
  await nextPaint();

  let look: LookScene;
  try {
    look = new LookScene(canvas, params);
  } catch (error) {
    console.error(error);
    showFatal('Ashbound Outpost needs WebGL 2, which this browser could not start.');
    return;
  }

  const hud = new HudDemo(hudParent, look);
  const toast = new Toast();
  let momentName = params.time ?? 'golden';
  const overlay = new StatsOverlay(overlayParent, look, () => momentName);
  overlay.element.hidden = !params.stats;
  let panel: BenchPanel | null = null;
  const sweep = new PresetSweep(
    look,
    params.benchSeconds,
    params.benchPresets,
    () => describeMachine(look),
    () => panel?.refresh(),
  );
  panel = new BenchPanel(sweep, look);
  document.body.append(toast.element, panel.banner, panel.results);

  const handle: LookHandle = {
    scene: look,
    hud,
    sweep,
    frames: 0,
    renderNow: () => {
      look.frame(0, 0);
      handle.frames++;
    },
  };
  if (params.debug) window.__look = handle;

  const cycle = <T>(list: readonly T[], current: T): T =>
    list[(Math.max(0, list.indexOf(current)) + 1) % list.length] as T;

  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Escape') {
      sweep.cancel('Stopped with Esc.');
      return;
    }
    if (sweep.active) return;
    switch (event.code) {
      case 'KeyP': {
        const next = cycle(QUALITY_CYCLE, look.quality.name);
        look.applyQuality(next);
        toast.show(`Quality: ${QUALITY_PRESETS[next].name.toUpperCase()}`);
        break;
      }
      case 'KeyT': {
        momentName = cycle(MOMENT_CYCLE, momentName as (typeof MOMENT_CYCLE)[number]);
        look.setMoment(momentName);
        toast.show(`Time: ${momentName}`);
        break;
      }
      case 'KeyN': {
        const next = cycle(Object.keys(SHOTS), look.shot ?? '');
        look.setShot(next);
        momentName = SHOTS[next]?.time ?? momentName;
        toast.show(`Shot: ${SHOTS[next]?.note ?? next}`);
        break;
      }
      case 'KeyH':
        hud.toggle();
        break;
      case 'KeyV':
        overlay.element.hidden = !overlay.element.hidden;
        break;
      case 'KeyB':
        sweep.start();
        break;
      default:
    }
  });

  let last = performance.now();
  const loop = (now: number): void => {
    const frameMs = now - last;
    const dt = Math.min(0.1, frameMs / 1000);
    last = now;
    if (sweep.active) {
      const started = performance.now();
      sweep.beforeFrame(frameMs);
      look.frame(dt, 0);
      handle.frames++;
      sweep.afterFrame(frameMs, performance.now() - started);
      panel?.refresh();
    } else if (!params.freeze || look.dirty || look.moving) {
      look.frame(dt, frameMs);
      handle.frames++;
    }
    hud.update(params.freeze ? 0 : dt);
    overlay.frame(frameMs, now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  document.querySelector('#look-loading')?.remove();
  document.documentElement.dataset.ready = 'true';
  if (params.bench) sweep.start();
}

void main();
