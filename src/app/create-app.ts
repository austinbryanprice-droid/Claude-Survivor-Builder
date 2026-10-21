import { DEFAULT_MOMENT, createStage } from '../engine/stage';
import { createGame, type Game } from '../engine/game';
import { readFlags } from '../shared/flags';
import { readViewFlags } from '../shared/view-flags';
import { createHud, type Hud } from '../ui/hud';
import { loadSettings } from '../ui/settings-store';
import { SHOTS, shotPose } from '../world/terrain/viewpoints';
import { VALLEY_MIST, createValleyWorld } from './valley-world';

export interface AppOptions {
  readonly canvas: HTMLCanvasElement;
  /** The page's query string, which carries the development and view switches. */
  readonly search: string;
  readonly buildId: string;
}

export interface App {
  readonly game: Game;
  readonly hud: Hud;
  start(): void;
  dispose(): void;
}

/**
 * The composition root: reads the URL and the saved settings, builds the stage and the valley on
 * it, hands both to the game loop and puts the HUD over the canvas. This is the one place that
 * knows the engine, the world and the interface together.
 */
export function createApp({ canvas, search, buildId }: AppOptions): App {
  const flags = readFlags(search);
  const view = readViewFlags(search);
  const settings = loadSettings();
  // A named viewpoint brings its own time of day, unless the URL asks for another one.
  const shot = view.shot ? SHOTS[view.shot] : undefined;
  // A bare `?demo` raises the outpost.
  const demo = view.demo === '' ? 'outpost' : view.demo;

  const stage = createStage({
    canvas,
    quality: view.quality ?? settings.quality,
    scale: view.scale,
    freeze: view.freeze,
    moment: view.clock ? null : (view.time ?? shot?.time ?? DEFAULT_MOMENT),
    mist: VALLEY_MIST,
  });
  const game = createGame({
    stage,
    settings,
    flags,
    benchPresets: view.benchPresets,
    buildId,
    seed: view.seed,
    createWorld: (seed) => createValleyWorld(stage, seed, view.terrain, demo),
  });
  if (shot) game.setPhoto(shotPose(shot, game.world.groundAt));

  document.body.classList.toggle('no-hud', !view.hud);
  const hud = createHud(game, { flags, view, buildId });
  if (flags.debug) window.__ashbound = { stage, game };

  return {
    game,
    hud,
    start: () => game.start(),
    dispose() {
      hud.dispose();
      game.dispose();
    },
  };
}
