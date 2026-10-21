import { DEFAULT_MOMENT, createStage } from '../engine/stage';
import { createGame, type Game } from '../engine/game';
import { readFlags } from '../shared/flags';
import { readNetFlags } from '../shared/net-flags';
import { readViewFlags } from '../shared/view-flags';
import { createHud, type Hud } from '../ui/hud';
import { loadSettings } from '../ui/settings-store';
import { SHOTS, shotPose } from '../world/terrain/viewpoints';
import type { Multiplayer } from './multiplayer';
import { VALLEY_MIST, createValleyWorld, type ValleyWorld } from './valley-world';

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
  // The valley being played, which carries the blocks the net layer syncs. Set by each `createWorld`.
  let valley: ValleyWorld | null = null;
  const game = createGame({
    stage,
    settings,
    flags,
    benchPresets: view.benchPresets,
    buildId,
    seed: view.seed,
    // Only the first valley raises the demo. A valley swapped in later is a room's, and it gets
    // its blocks from the host, so a demo there would be blocks the host does not have.
    createWorld: (seed) =>
      (valley = createValleyWorld(stage, seed, view.terrain, valley ? null : demo)),
  });
  if (shot) game.setPhoto(shotPose(shot, game.world.groundAt));

  document.body.classList.toggle('no-hud', !view.hud);
  const hud = createHud(game, { flags, view, buildId });
  if (flags.debug) window.__ashbound = { stage, game };

  // Playing together loads after the game is up, and never in the benchmark, which measures the
  // game alone.
  let multiplayer: Multiplayer | null = null;
  let disposed = false;
  if (!flags.bench) {
    void import('./attach-multiplayer')
      .then(({ attachMultiplayer }) => {
        if (disposed) return;
        multiplayer = attachMultiplayer({
          game,
          voxels: () => {
            if (!valley) throw new Error('The valley is not built yet');
            return valley.voxels;
          },
          flags: readNetFlags(search, { secure: window.location.protocol === 'https:' }),
          buildId,
        });
        if (flags.debug && window.__ashbound) window.__ashbound.mp = multiplayer.debug;
      })
      .catch((error: unknown) => {
        // The game still plays; only the "Play together" card is missing.
        console.error('Playing together could not start.', error);
      });
  }

  return {
    game,
    hud,
    start: () => game.start(),
    dispose() {
      disposed = true;
      multiplayer?.dispose();
      hud.dispose();
      game.dispose();
    },
  };
}
