import type { Game } from '../engine/game';
import type { Flags } from '../shared/flags';
import { createBenchPanel } from './bench-panel';
import { el } from './dom';
import { createFrameOverlay } from './frame-overlay';
import { createPausePanel } from './pause-panel';
import { createStatusPanel } from './status-panel';
import './hud.css';

export interface Hud {
  dispose(): void;
}

const BANNER_INTERVAL_MS = 200;

/** Builds the HUD over the canvas and keeps it in step with the game: pointer lock, benchmark and camera. */
export function createHud(game: Game, flags: Flags, buildId: string): Hud {
  const root = el('div');
  root.id = 'hud';

  const crosshair = el('div', 'crosshair');
  crosshair.setAttribute('aria-hidden', 'true');
  const overlay = createFrameOverlay(game);
  const pause = createPausePanel(game, buildId);
  const bench = createBenchPanel(game, render);
  const status = createStatusPanel(game);
  root.append(
    crosshair,
    overlay.element,
    status.element,
    pause.element,
    bench.banner,
    bench.results,
  );
  // Before #fatal, so the "WebGL failed" message always sits on top.
  document.body.insertBefore(root, document.querySelector('#fatal'));

  overlay.setVisible(flags.bench || flags.debug);

  function render(): void {
    const playing = game.input.locked;
    const driven = game.bench.takesOver;
    bench.refresh();
    const showResults = bench.showingResults && !playing;
    pause.element.hidden = playing || driven || showResults;
    crosshair.hidden = !(playing || driven);
    status.element.hidden = !playing || driven;
    root.dataset.pointer = playing ? 'locked' : 'free';
    root.dataset.bench = game.bench.state;
    pause.refresh();
  }

  const stopInput = game.input.onChange(render);
  const stopBench = game.bench.onChange(render);
  const stopActions = game.input.onAction((action) => {
    if (action === 'toggleOverlay') overlay.setVisible(!overlay.visible);
  });

  let lastBanner = 0;
  let camera = '';
  const stopFrames = game.onFrame(() => {
    overlay.update();
    if (game.rig.mode !== camera) {
      camera = game.rig.mode;
      root.dataset.camera = camera;
      status.refresh();
    }
    if (game.bench.state === 'running') {
      const now = performance.now();
      if (now - lastBanner >= BANNER_INTERVAL_MS) {
        lastBanner = now;
        bench.refresh();
      }
    }
  });

  render();

  return {
    dispose() {
      stopInput();
      stopBench();
      stopActions();
      stopFrames();
      root.remove();
    },
  };
}
