import { DEFAULT_MOMENT, createStage } from '../engine/stage';
import { createGame, type Game } from '../engine/game';
import { stateMaterial } from '../shared/blocks';
import { readFlags } from '../shared/flags';
import { introWanted } from '../shared/intro';
import { readNetFlags } from '../shared/net-flags';
import { createReading } from '../shared/survival-state';
import { readViewFlags } from '../shared/view-flags';
import { valleyNavigation } from '../systems/survival/valley-nav';
import { createHud, type Hud } from '../ui/hud';
import { loadSettings } from '../ui/settings-store';
import type { CoreLook } from '../world/render/core-render';
import { SHOTS, shotPose } from '../world/terrain/viewpoints';
import { createBuildControls } from './build-controls';
import type { IntroController } from './intro';
import type { Multiplayer } from './multiplayer';
import { VALLEY_MIST, createValleyWorld, type ValleyWorld } from './valley-world';
import { followVitals } from './vitals-effects';

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
  // What the Core's crystal shows. It has the run to ask once the run exists, and shows a whole Core until then.
  let coreLook: (() => CoreLook | null) | null = null;
  const game = createGame({
    stage,
    settings,
    flags,
    benchPresets: view.benchPresets,
    buildId,
    seed: view.seed,
    createWorld: (seed) => {
      valley = createValleyWorld(stage, seed, view.terrain, demo);
      valley.view.core?.follow(() => coreLook?.() ?? null);
      return valley;
    },
  });
  if (shot) game.setPhoto(shotPose(shot, game.world.groundAt));

  // The player's building hands: the mouse, the hotbar keys and Build Mode, aimed from the camera.
  const building = createBuildControls({ game, valley: () => valley });

  // The intro film opens a fresh run for a player alone (or a host with nobody in the room), once per
  // page, unless the URL, the settings or the browser say otherwise. Its code loads only when it is
  // wanted, or when the pause card is asked to show it.
  let multiplayer: Multiplayer | null = null;
  let introController: IntroController | null = null;
  let introLoading: Promise<IntroController | null> | null = null;
  let disposed = false;
  // A page opened from an invite link is going to join somebody else's run, not open one of its own.
  const netFlags = readNetFlags(search, { secure: window.location.protocol === 'https:' });
  const plainStart =
    netFlags.join === null &&
    !flags.debug &&
    !flags.bench &&
    view.hud &&
    view.shot === null &&
    view.demo === null &&
    view.time === null &&
    !view.clock &&
    view.night === null &&
    view.stock === null &&
    view.research === null;
  const wantsIntro = (): boolean =>
    introWanted({
      mode: view.introAt !== null ? 'on' : view.intro,
      setting: settings.intro,
      automated: navigator.webdriver === true,
      custom: !plainStart,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    }) &&
    (multiplayer === null || multiplayer.lobby.hub.role === 'solo');
  const loadIntro = (): Promise<IntroController | null> => {
    introLoading ??= import('./attach-intro')
      .then(({ attachIntro }) => {
        if (disposed) return null;
        introController = attachIntro({ game, valley: () => valley, wanted: wantsIntro });
        if (flags.debug && window.__ashbound) window.__ashbound.intro = introController;
        return introController;
      })
      .catch((error: unknown) => {
        // The game still plays; it just opens without the film.
        console.error('The intro could not load.', error);
        return null;
      });
    return introLoading;
  };

  document.body.classList.toggle('no-hud', !view.hud);
  const hud = createHud(game, {
    flags,
    view,
    buildId,
    build: building.controller,
    watchIntro: () => void loadIntro().then((controller) => controller?.replay()),
  });
  if (flags.debug) window.__ashbound = { stage, game, build: building.debug };
  if (view.introAt !== null) {
    const heldAt = view.introAt;
    void loadIntro().then((controller) => controller?.hold(heldAt));
  } else if (wantsIntro()) {
    void loadIntro();
  }

  // Playing together loads after the game is up, and never in the benchmark, which measures the
  // game alone.
  let stopVitals: (() => void) | null = null;
  let stopFire: (() => void) | null = null;
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
          outpost: () => valley?.voxels.outpost ?? null,
          navigation: () => (valley ? valleyNavigation(valley) : null),
          // A bolt stops at the blocks, the hills and the Core, which the ground the cursor aims at already includes.
          rayWorld: () =>
            valley ? { blocks: valley.voxels, ground: valley.collision.ground } : null,
          // The heap the cursor is on glows.
          aimedDebris: () => building.controller.salvageTarget.index,
          // The host's turrets are the modules that stand, and a turret's head turns on every screen when it fires.
          forEachModule: (visit) => valley?.voxels.forEachModule(visit),
          aimTurret: (x, y, z, tx, ty, tz) => valley?.view.modules.aim(x, y, z, tx, ty, tz),
          levelOfTurret: (x, y, z) => stateMaterial(valley?.voxels.getBlock(x, y, z) ?? 0),
          flags: netFlags,
          buildId,
          night: view.night,
          waves: view.waves,
          stock: view.stock,
          research: view.research,
          // A fixed moment (`?time=`, a named `?shot=`) or the demo clock (`?clock`) keeps the sky to itself.
          skyFollowsClock: view.time === null && !view.clock && !shot,
        });
        // Blocks are placed and broken by asking the session, which is the host's rules in solo play too.
        building.setSession(multiplayer.lobby.hub);
        // A shot of the blaster is drawn at the click, from what this screen shows, before the host has answered.
        const shooting = multiplayer;
        stopFire = building.onFire((origin, dir) => shooting.predictShot(origin, dir));
        // The clock by the compass and the objective come from the run, which lives in the session.
        const hub = multiplayer.lobby.hub;
        const survival = hub.survival;
        // The messages about a player going down or coming back name them as the room does, and speak to the local player as "you".
        hud.setSurvival(survival, (id) =>
          id === hub.localId
            ? null
            : (hub.players.find((player) => player.id === id)?.name ?? 'A crewmate'),
        );
        // When the run is lost the host chooses what comes next, and a guest waits for them.
        hud.setRun({
          canChoose: () => hub.role !== 'guest',
          hostName: () => hub.players.find((player) => player.isHost)?.name ?? 'the host',
          restart: (kind) => hub.restartRun(kind),
        });
        const reading = createReading();
        coreLook = () => {
          survival.read(reading);
          if (reading.coreMax <= 0) return null;
          return { health: reading.coreHealth / reading.coreMax, fallen: reading.coreHealth <= 0 };
        };
        // Health and Energy come from the run too: the corner of the HUD shows them, and low Energy
        // slows the legs and the hands.
        const vitals = multiplayer.lobby.hub.vitals;
        hud.setVitals(vitals);
        stopVitals = followVitals(game, building.controller, vitals);
        // The pool of materials the crew's strips fill is on the block slots of the hotbar.
        hud.setEconomy(hub.economy, () => hub.localId);
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
      introController?.dispose();
      building.dispose();
      stopFire?.();
      stopVitals?.();
      multiplayer?.dispose();
      coreLook = null;
      hud.setSurvival(null);
      hud.setRun(null);
      hud.setVitals(null);
      hud.setEconomy(null);
      hud.dispose();
      game.dispose();
    },
  };
}
