import { readFlags } from './shared/flags';
import { createStage } from './engine/stage';
import './ui/styles.css';

function showFatal(message: string): void {
  const el = document.querySelector<HTMLElement>('#fatal');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Missing #game canvas');

const tag = document.querySelector<HTMLElement>('#build-tag');
if (tag) tag.textContent = `Ashbound Outpost · scaffold build ${__BUILD_ID__}`;

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  showFatal('The graphics context was lost. Reload the page to continue.');
});

try {
  const flags = readFlags(window.location.search);
  const stage = createStage(canvas);
  if (flags.debug) window.__ashbound = { stage };
  stage.start();
} catch (error) {
  console.error(error);
  showFatal('Ashbound Outpost needs WebGL 2, which this browser could not start.');
}
