import '../ui/styles.css';
import './look.css';
import { LookScene } from './look-scene';
import { readLookParams } from './params';

/** What the look page exposes on `window` for tests and screenshot scripts (`?debug`). */
export interface LookHandle {
  readonly scene: LookScene;
  /** Draws a frame right now, regardless of freeze. */
  renderNow(): void;
  frames: number;
}

declare global {
  interface Window {
    __look?: LookHandle;
  }
}

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
  if (!canvas) throw new Error('Missing #game canvas');
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

  const handle: LookHandle = {
    scene: look,
    frames: 0,
    renderNow: () => {
      look.frame(0, 0);
      handle.frames++;
    },
  };
  if (params.debug) window.__look = handle;

  let last = performance.now();
  const loop = (now: number): void => {
    const frameMs = now - last;
    const dt = Math.min(0.1, frameMs / 1000);
    last = now;
    if (!params.freeze || look.dirty || look.moving) {
      look.frame(dt, frameMs);
      handle.frames++;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  document.querySelector('#look-loading')?.remove();
  document.documentElement.dataset.ready = 'true';
}

void main();
