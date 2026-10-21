import type { Game } from '../engine/game';
import type { Flags } from '../shared/flags';
import { nextQuality } from '../shared/quality';
import type { ViewFlags } from '../shared/view-flags';
import { createBenchPanel } from './bench-panel';
import { el } from './dom';
import { createFrameOverlay } from './frame-overlay';
import { createPausePanel } from './pause-panel';
import { createPlaceholderHud } from './placeholder-hud';
import { saveSettings } from './settings-store';
import { createStatusPanel } from './status-panel';
import { createToast } from './toast';
import './hud.css';

export interface Hud {
  dispose(): void;
}

export interface HudOptions {
  readonly flags: Flags;
  readonly view: ViewFlags;
  readonly buildId: string;
}

const BANNER_INTERVAL_MS = 200;
/** A long frame (a hidden tab, a breakpoint) is not time passing for the HUD's timers. */
const MAX_HUD_STEP_SECONDS = 0.1;

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Builds the HUD over the canvas and keeps it in step with the game: pointer lock, the benchmark,
 * the camera and the graphics preset. The player HUD of the reference sits underneath the panels.
 */
export function createHud(game: Game, { flags, view, buildId }: HudOptions): Hud {
  const root = el('div');
  root.id = 'hud';
  root.hidden = !view.hud;

  const playerHud = createPlaceholderHud(root, game);
  const overlay = createFrameOverlay(game);
  const pause = createPausePanel(game, buildId);
  const bench = createBenchPanel(game, render);
  const status = createStatusPanel(game);
  const toast = createToast();
  root.append(
    overlay.element,
    status.element,
    pause.element,
    bench.banner,
    bench.results,
    toast.element,
  );
  // Before #fatal, so the "WebGL failed" message always sits on top.
  document.body.insertBefore(root, document.querySelector('#fatal'));

  overlay.setVisible(view.stats && (flags.bench || flags.debug));

  function render(): void {
    const playing = game.input.locked;
    const driven = game.sweep.active;
    bench.refresh();
    const showResults = bench.showingResults && !playing;
    pause.element.hidden = playing || driven || showResults;
    status.element.hidden = !playing || driven;
    root.dataset.pointer = playing ? 'locked' : 'free';
    root.dataset.bench = game.sweep.state;
    pause.refresh();
  }

  const stopInput = game.input.onChange(render);
  const stopSweep = game.onSweepChange(render);
  const stopQuality = game.stage.onQuality(() => {
    status.refresh();
    pause.refresh();
  });
  const stopActions = game.input.onAction((action) => {
    if (action === 'toggleOverlay') overlay.setVisible(!overlay.visible);
    if (action === 'cycleQuality' && !game.sweep.active) {
      const next = nextQuality(game.stage.quality.name);
      game.setQuality(next);
      saveSettings(game.settings);
      toast.show(`Graphics: ${capitalized(next)}`);
    }
  });

  let lastBanner = 0;
  let lastFrame = performance.now();
  let camera = '';
  const stopFrames = game.onFrame(() => {
    const now = performance.now();
    const dt = Math.min(MAX_HUD_STEP_SECONDS, (now - lastFrame) / 1000);
    lastFrame = now;
    playerHud.update(dt);
    overlay.update();
    if (game.rig.mode !== camera) {
      camera = game.rig.mode;
      root.dataset.camera = camera;
      status.refresh();
    }
    if (game.sweep.active && now - lastBanner >= BANNER_INTERVAL_MS) {
      lastBanner = now;
      bench.refresh();
    }
  });

  render();

  return {
    dispose() {
      stopInput();
      stopSweep();
      stopQuality();
      stopActions();
      stopFrames();
      playerHud.dispose();
      toast.dispose();
      root.remove();
    },
  };
}
