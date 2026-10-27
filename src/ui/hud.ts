import type { Game } from '../engine/game';
import { createEconomyReading, type EconomyView } from '../shared/economy';
import type { Flags } from '../shared/flags';
import { nextQuality } from '../shared/quality';
import { createReading, type RestartKind, type SurvivalView } from '../shared/survival-state';
import type { ViewFlags } from '../shared/view-flags';
import type { VitalsView } from '../shared/vitals-state';
import { createBenchPanel } from './bench-panel';
import type { BuildHudSource } from './build-hud';
import { el } from './dom';
import { createFrameOverlay } from './frame-overlay';
import { createPausePanel } from './pause-panel';
import { createPlaceholderHud } from './placeholder-hud';
import { harvestMessage, messageFor, resultsForHud, runLine, type Namer } from './run-hud';
import { PoolWatcher } from './pool-hud';
import { ResearchWatcher } from './research-hud';
import { createRunResults } from './run-results';
import { saveSettings } from './settings-store';
import { createStatusPanel } from './status-panel';
import { createToast } from './toast';
import './hud.css';

/** Who starts the next run once this one is lost, and how: the host (or a player alone), by a choice on the results card. */
export interface RunControls {
  /** True where this screen makes the choice; a guest's waits for the host's. */
  canChoose(): boolean;
  /** The name of the player a guest waits for. */
  hostName(): string;
  /** Asks for the next run: the same valley again (`retry`) or another one (`new`). */
  restart(kind: RestartKind): void;
}

export interface Hud {
  /**
   * Shows the run's clock and objective from this view, and a message when the light changes or a
   * player goes down or comes back; `nameOf` says how those messages name a player.
   */
  setSurvival(view: SurvivalView | null, nameOf?: Namer): void;
  /** Says who may start the next run when this one is lost, so the results card can offer the choice or wait for it. */
  setRun(controls: RunControls | null): void;
  /** Shows the player's own Health, Energy and status icons from this view; null shows full bars. */
  setVitals(view: VitalsView | null): void;
  /**
   * Shows the crew's pool on the block slots of the hotbar from this view, a message when the
   * player `localId()` names strips a heap, and one when the crew's research grows or opens a
   * material; null shows no counts.
   */
  setEconomy(view: EconomyView | null, localId?: () => number): void;
  dispose(): void;
}

export interface HudOptions {
  readonly flags: Flags;
  readonly view: ViewFlags;
  readonly buildId: string;
  /** The player's building hands: the hotbar's blocks, the selection and Build Mode. */
  readonly build: BuildHudSource;
  /** Plays the intro film now, for the pause card's "Watch the intro"; the card offers none without it. */
  readonly watchIntro?: () => void;
}

const BANNER_INTERVAL_MS = 200;
/** The run is read for the pause card's line and the results card this often. */
const RUN_LINE_INTERVAL_MS = 500;
/** A player still in the game when the run is lost keeps the mouse this long, to see it end, before the results card asks for it. */
const RESULTS_AFTER_MS = 1500;
/** A long frame (a hidden tab, a breakpoint) is not time passing for the HUD's timers. */
const MAX_HUD_STEP_SECONDS = 0.1;

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Builds the HUD over the canvas and keeps it in step with the game: pointer lock, the benchmark,
 * the camera and the graphics preset. The player HUD of the reference sits underneath the panels.
 */
export function createHud(
  game: Game,
  { flags, view, buildId, build, watchIntro }: HudOptions,
): Hud {
  const root = el('div');
  root.id = 'hud';
  root.hidden = !view.hud;

  const playerHud = createPlaceholderHud(root, game, build);
  const overlay = createFrameOverlay(game);
  const pause = createPausePanel(game, buildId, { skyPreview: flags.debug, watchIntro });
  const bench = createBenchPanel(game, render);
  const status = createStatusPanel(game);
  const toast = createToast();
  let controls: RunControls | null = null;
  let overSince = 0;
  const results = createRunResults((kind) => {
    // The click is the gesture the browser wants before it hands over the mouse, so the new run
    // opens with the player already in it. The mouse is kept for the time the run takes to start.
    overSince = performance.now();
    controls?.restart(kind);
    game.input.requestLock();
  });
  root.append(
    overlay.element,
    status.element,
    pause.element,
    results.element,
    bench.banner,
    bench.results,
    toast.element,
  );
  // Before #fatal, so the "WebGL failed" message always sits on top.
  document.body.insertBefore(root, document.querySelector('#fatal'));

  overlay.setVisible(view.stats && (flags.bench || flags.debug));

  let run: SurvivalView | null = null;
  let economy: EconomyView | null = null;
  let researchWatch = new ResearchWatcher();
  let poolWatch = new PoolWatcher();
  let stopRunEvents: (() => void) | null = null;
  let stopStrips: (() => void) | null = null;
  const runReading = createReading();
  const poolReading = createEconomyReading();
  let runLineText: string | null = null;
  let over = false;
  /**
   * Reads the run once: the pause card's line, and the results card once the run is lost. True when
   * the run has just been lost or started over, which changes what is on screen.
   */
  function refreshRun(): boolean {
    const reading = run ? run.read(runReading) : null;
    const pool = economy ? economy.read(poolReading) : null;
    const lost = reading
      ? resultsForHud(reading, pool && pool.cap > 0 ? pool.research : null)
      : null;
    const line = reading && !lost ? runLine(reading) : null;
    if (line !== runLineText) {
      runLineText = line;
      pause.setRun(line);
    }
    if (lost) {
      results.show(lost, controls?.canChoose() ? null : (controls?.hostName() ?? 'the host'));
    } else {
      results.clear();
    }
    const changed = (lost !== null) !== over;
    over = lost !== null;
    if (changed && over) overSince = performance.now();
    return changed;
  }

  /** Shows the card the screen calls for: the run being played, the pause card, the results of a lost run, the benchmark's, or nothing while the intro film plays. */
  function place(): void {
    const playing = game.input.locked;
    const driven = game.sweep.active;
    const filming = game.cinematic !== null;
    const benchResults = bench.showingResults && !playing;
    pause.element.hidden = playing || driven || benchResults || over || filming;
    results.element.hidden = playing || driven || benchResults || !over || filming;
    status.element.hidden = !playing || driven;
    root.dataset.pointer = playing ? 'locked' : 'free';
    root.dataset.bench = game.sweep.state;
    root.dataset.intro = filming ? 'on' : 'off';
  }

  function render(): void {
    bench.refresh();
    refreshRun();
    place();
    pause.refresh();
  }

  const stopInput = game.input.onChange(render);
  const stopSweep = game.onSweepChange(render);
  const stopFilm = game.onCinematicChange(render);
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
    // The points that arrived and the materials they opened are told in the order they come, then the room a Storage made.
    if (economy) {
      const pool = economy.read(poolReading);
      for (const message of researchWatch.update(pool)) toast.queue(message);
      for (const message of poolWatch.update(pool)) toast.queue(message);
    }
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
    if (now - lastRunLine >= RUN_LINE_INTERVAL_MS) {
      lastRunLine = now;
      if (refreshRun()) place();
    }
    // A player who is still playing when the run is lost sees it end, and then the mouse is freed
    // for the results card.
    if (over && game.input.locked && now - overSince >= RESULTS_AFTER_MS) game.input.releaseLock();
  });

  render();

  return {
    setSurvival(view, nameOf) {
      stopRunEvents?.();
      stopRunEvents = null;
      run = view;
      playerHud.setSurvival(view);
      if (view) {
        stopRunEvents = view.onEvent((event) => {
          const words = messageFor(event, nameOf);
          if (words !== null) toast.queue(words);
        });
      }
      // The run takes the sky when it arrives, which the pause card's Time of day should show.
      pause.refresh();
      if (refreshRun()) place();
    },
    setRun(next) {
      controls = next;
      // The card is drawn for whoever chooses, which may just have changed.
      results.clear();
      if (refreshRun()) place();
    },
    setVitals(view) {
      playerHud.setVitals(view);
    },
    setEconomy(view, localId) {
      stopStrips?.();
      stopStrips = null;
      economy = view;
      researchWatch = new ResearchWatcher();
      poolWatch = new PoolWatcher();
      playerHud.setEconomy(view);
      // The player's own strips are answered with what they brought in; the others' are seen in the pool.
      if (view && localId) {
        stopStrips = view.debris.onHarvest((event) => {
          if (event.by === localId()) toast.show(harvestMessage(event));
        });
      }
    },
    dispose() {
      stopStrips?.();
      stopRunEvents?.();
      stopInput();
      stopSweep();
      stopFilm();
      stopQuality();
      stopActions();
      stopFrames();
      playerHud.dispose();
      toast.dispose();
      root.remove();
    },
  };
}
