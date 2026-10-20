import { readFlags } from './shared/flags';
import { createGame } from './engine/game';
import { createHud } from './ui/hud';
import { loadSettings } from './ui/settings-store';
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
  const game = createGame({ canvas, settings: loadSettings(), flags, buildId: __BUILD_ID__ });
  createHud(game, flags, __BUILD_ID__);
  if (flags.debug) window.__ashbound = { stage: game.stage, game };
  game.start();
} catch (error) {
  console.error(error);
  showFatal('Ashbound Outpost needs WebGL 2, which this browser could not start.');
}
