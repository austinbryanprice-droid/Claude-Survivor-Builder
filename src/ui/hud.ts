import type { Game } from '../engine/game';
import type { Flags } from '../shared/flags';
import { nextQuality } from '../shared/quality';
import { createReading, type SurvivalView } from '../shared/survival-state';
import type { ViewFlags } from '../shared/view-flags';
import type { VitalsView } from '../shared/vitals-state';
import { createBenchPanel } from './bench-panel';
import type { BuildHudSource } from './build-hud';
import { el } from './dom';
import { createFrameOverlay } from './frame-overlay';
import { createPausePanel } from './pause-panel';
import { createPlaceholderHud } from './placeholder-hud';
import { messageFor, runLine } from './run-hud';
import { saveSettings } from './settings-store';
import { createStatusPanel } from './status-panel';
import { createToast } from './toast';
import './hud.css';

export interface Hud {
  /** Shows the run's clock and objective from this view, and a message when the light changes. */
  setSurvival(view: SurvivalView | null): void;
  /** Shows the player's own Health, Energy and status icons from this view; null shows full bars. */
  setVitals(view: VitalsView | null): void;
  dispose(): void;
}

export interface HudOptions {
  readonly flags: Flags;
  readonly view: ViewFlags;
  readonly buildId: string;
  /** The player's building hands: the hotbar's blocks, the selection and Build Mode. */
  readonly build: BuildHudSource;
}

const BANNER_INTERVAL_MS = 200;
/** The run line on the pause card is brought up to date this often while the card is showing. */
const RUN_LINE_INTERVAL_MS = 500;
/** A long frame (a hidden tab, a breakpoint) is not time passing for the HUD's timers. */
const MAX_HUD_STEP_SECONDS = 0.1;

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Builds the HUD over the canvas and keeps it in step with the game: pointer lock, the benchmark,
 * the camera and the graphics preset. The player HUD of the reference sits underneath the panels.
 */
export function createHud(game: Game, { flags, view, buildId, build }: HudOptions): Hud {
  const root = el('div');
  root.id = 'hud';
  root.hidden = !view.hud;

  const playerHud = createPlaceholderHud(root, game, build);
  const overlay = createFrameOverlay(game);
  const pause = createPausePanel(game, buildId, { skyPreview: flags.debug });
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

  let run: SurvivalView | null = null;
  let stopRunEvents: (() => void) | null = null;
  const runReading = createReading();
  let runLineText: string | null = null;
  function refreshRunLine(): void {
    const line = run ? runLine(run.read(runReading)) : null;
    if (line === runLineText) return;
    runLineText = line;
    pause.setRun(line);
  }

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
    refreshRunLine();
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
  let lastRunLine = 0;
  let lastFrame = performance.now();
  let camera = '';
  let buildMode = false;
  const stopFrames = game.onFrame(() => {
    const now = performance.now();
    const dt = Math.min(MAX_HUD_STEP_SECONDS, (now - lastFrame) / 1000);
    lastFrame = now;
    playerHud.update(dt);
    const building = build.hudState().buildMode;
    if (building !== buildMode) {
      buildMode = building;
      status.setBuildMode(building);
    }
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
    if (!game.input.locked && now - lastRunLine >= RUN_LINE_INTERVAL_MS) {
      lastRunLine = now;
      refreshRunLine();
    }
  });

  render();

  return {
    setSurvival(view) {
      stopRunEvents?.();
      stopRunEvents = null;
      run = view;
      playerHud.setSurvival(view);
      if (view) stopRunEvents = view.onEvent((event) => toast.show(messageFor(event)));
      // The run takes the sky when it arrives, which the pause card's Time of day should show.
      pause.refresh();
      refreshRunLine();
    },
    setVitals(view) {
      playerHud.setVitals(view);
    },
    dispose() {
      stopRunEvents?.();
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
