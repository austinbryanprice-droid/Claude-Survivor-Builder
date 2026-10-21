import { createApp } from './app/create-app';
import './ui/styles.css';

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
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  if (!canvas) throw new Error('Missing #game canvas');

  const tag = document.querySelector<HTMLElement>('#build-tag');
  if (tag) tag.textContent = `Ashbound Outpost · build ${__BUILD_ID__}`;

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    showFatal('The graphics context was lost. Reload the page to continue.');
  });

  // Let the "Generating the valley" text paint before the synchronous build starts.
  await nextPaint();
  try {
    createApp({ canvas, search: window.location.search, buildId: __BUILD_ID__ }).start();
  } catch (error) {
    console.error(error);
    showFatal('Ashbound Outpost needs WebGL 2, which this browser could not start.');
  } finally {
    document.querySelector('#loading')?.remove();
  }
}

void main();
