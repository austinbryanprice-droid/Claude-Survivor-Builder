import { Vector3 } from 'three';
import type { Game } from '../engine/game';
import type { GameSession } from '../net/session';
import type { Vec3 } from '../shared/look';
import { PLAYER } from '../shared/movement';
import type { ValleyView } from '../world/render/valley-view';
import { BuildController, type BuildHudState, type BuildView } from './build-controller';
import type { ValleyWorld } from './valley-world';

/**
 * Puts the player's building hands on the running game: the mouse buttons, the number keys, the
 * wheel and B go to the build controller; each frame it aims from the camera and shows the ghost
 * block and the outline of the block a click would break; and its commands go to the session. The
 * game, the valley and the session each change over the life of a page (a joining player's valley
 * replaces the first one, and the session arrives when the network code has loaded), so all three
 * are read when they are needed.
 */

/** How long after the mouse is first captured the renderer prepares the blocks, if nothing asked sooner. */
export const IDLE_WARM_UP_MS = 3000;

/** The part of a session that building uses. */
export type BuildSession = Pick<
  GameSession,
  'phase' | 'sendCommand' | 'onRejected' | 'sampleRemotes'
>;

export interface BuildControlsOptions {
  readonly game: Game;
  /** The valley being played, or null before the first one is built. */
  valley(): ValleyWorld | null;
}

/** What the browser tests (and a curious console) can read. Attached by the page only with `?debug=1`. */
export interface BuildControlsDebug {
  /** What the cursor is on and what a click would do there, as of the last frame. */
  aim(): {
    on: 'nothing' | 'block' | 'terrain';
    target: { x: number; y: number; z: number };
    breakRefusal: string | null;
    hasPlace: boolean;
    place: { x: number; y: number; z: number };
    placeRefusal: string | null;
    distance: number;
  };
  /** The hotbar selection, Build Mode, the crosshair and the notice, as the HUD has them. */
  hands(): BuildHudState;
  /** Whether the ghost block and the break outline are on screen. */
  ghost(): { ghost: boolean; target: boolean };
}

export interface BuildControls {
  readonly controller: BuildController;
  /** Connects the commands to a session; null disconnects them. Refusals come back as notices. */
  setSession(session: BuildSession | null): void;
  readonly debug: BuildControlsDebug;
  dispose(): void;
}

export function createBuildControls({ game, valley }: BuildControlsOptions): BuildControls {
  const { input } = game;
  let session: BuildSession | null = null;
  let stopRefusals: (() => void) | null = null;

  const current = (): ValleyWorld => {
    const world = valley();
    if (!world) throw new Error('The valley is not built yet');
    return world;
  };

  // Every view that has had its blocks prepared; a replaced valley has a new view to prepare.
  const prepared = new WeakSet<ValleyView>();
  const warmUp = (): void => {
    const world = valley();
    if (!world || prepared.has(world.view)) return;
    prepared.add(world.view);
    const report = (error: unknown): void =>
      console.warn('Preparing the blocks failed; the first one may stutter.', error);
    world.view.structures.warmUp().catch(report);
    world.view.ghost.precompile().catch(report);
  };

  const bodies: Vec3[] = [];
  const controller = new BuildController({
    blocks: () => current().voxels,
    ground: () => game.world.collision.ground,
    send(command) {
      if (!session || session.phase !== 'open') return false;
      session.sendCommand(command);
      return true;
    },
    bodies() {
      bodies.length = 0;
      bodies.push(game.player);
      if (session) for (const remote of session.sampleRemotes()) bodies.push(remote);
      return bodies;
    },
    warmUp,
  });

  // The player's eyes are where reach is measured from; the camera is where the cursor looks from.
  const view: BuildView = {
    origin: { x: 0, y: 0, z: 0 },
    dir: { x: 0, y: 0, z: 0 },
    eye: { x: 0, y: 0, z: 0 },
  };
  const forward = new Vector3();

  // The benchmark has no hands: while it flies the valley, the buttons, the number keys, the wheel
  // and B do nothing, and nothing is prepared for them, so it measures the game alone.
  const stops = [
    input.onPointer((button, down) => {
      if (!down) controller.release(button);
      else if (!game.sweep.active) controller.press(button);
    }),
    input.onHotbar((change) => {
      if (game.sweep.active) return;
      if ('slot' in change) controller.selectSlot(change.slot);
      else controller.scrollSlot(change.step);
    }),
    input.onAction((action) => {
      if (action === 'toggleBuild' && !game.sweep.active) controller.toggleBuildMode();
    }),
  ];

  // A player who has the mouse and is looking around will likely build soon; get the blocks ready
  // while they look, so that the first one does not wait on the graphics driver.
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const stopLock = input.onChange(() => {
    if (!input.locked) {
      controller.releaseAll();
      return;
    }
    idleTimer ??= setTimeout(() => {
      if (!game.sweep.active) warmUp();
    }, IDLE_WARM_UP_MS);
  });

  const stopFrames = game.onBeforeRender((camera, dt) => {
    const world = valley();
    if (!world) return;
    const ghost = world.view.ghost;
    if (!input.locked || game.sweep.active) {
      ghost.setGhost(null);
      ghost.setTarget(null);
      return;
    }
    camera.getWorldDirection(forward);
    const { player } = game;
    view.origin.x = camera.position.x;
    view.origin.y = camera.position.y;
    view.origin.z = camera.position.z;
    view.dir.x = forward.x;
    view.dir.y = forward.y;
    view.dir.z = forward.z;
    view.eye.x = player.x;
    view.eye.y = player.y + PLAYER.eyeHeight;
    view.eye.z = player.z;
    controller.update(dt, view);

    ghost.update(dt);
    if (controller.inBuildMode) {
      const aim = controller.target;
      ghost.setGhost(aim.hasPlace ? aim.place : null, aim.placeRefusal === null);
      ghost.setTarget(aim.on === 'block' ? aim.target : null, aim.breakRefusal === null);
    } else {
      ghost.setGhost(null);
      ghost.setTarget(null);
    }
  });

  const debug: BuildControlsDebug = {
    aim: () => {
      const { on, target, breakRefusal, hasPlace, place, placeRefusal, distance } =
        controller.target;
      return {
        on,
        target: { ...target },
        breakRefusal,
        hasPlace,
        place: { ...place },
        placeRefusal,
        distance,
      };
    },
    hands: () => ({ ...controller.hudState() }),
    ghost: () => {
      const shown = valley()?.view.ghost.shown;
      return { ghost: shown?.ghost ?? false, target: shown?.target ?? false };
    },
  };

  return {
    controller,
    setSession(next) {
      stopRefusals?.();
      stopRefusals = null;
      session = next;
      if (next) {
        stopRefusals = next.onRejected((rejection) => controller.noteRejection(rejection.reason));
      }
    },
    debug,
    dispose() {
      stopRefusals?.();
      stopFrames();
      stopLock();
      for (const stop of stops) stop();
      if (idleTimer !== undefined) clearTimeout(idleTimer);
    },
  };
}
