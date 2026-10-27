import { Vector3 } from 'three';
import type { Game } from '../engine/game';
import type { GameSession } from '../net/session';
import type { CellState } from '../shared/block-world';
import { stateShape } from '../shared/blocks';
import { IDLE_ECONOMY } from '../shared/economy';
import type { Vec3 } from '../shared/look';
import { PLAYER } from '../shared/movement';
import { SHOT_FLAG } from '../shared/shot';
import type { ValleyView } from '../world/render/valley-view';
import { BuildController, type BuildHudState, type BuildView } from './build-controller';
import type { ValleyWorld } from './valley-world';

/**
 * Puts the player's building hands on the running game: the mouse buttons, the number keys, the
 * wheel, B, Q, R and E go to the build controller; each frame it aims from the camera and shows the
 * ghost block and the outline of the block a click would break; and its commands go to the session. The
 * game, the valley and the session each change over the life of a page (a joining player's valley
 * replaces the first one, and the session arrives when the network code has loaded), so all three
 * are read when they are needed.
 */

/** How long after the mouse is first captured the renderer prepares the blocks, if nothing asked sooner. */
export const IDLE_WARM_UP_MS = 3000;

/** The part of a session that the player's hands use. */
export type BuildSession = Pick<
  GameSession,
  | 'phase'
  | 'localId'
  | 'sendCommand'
  | 'fire'
  | 'onRejected'
  | 'onShot'
  | 'sampleRemotes'
  | 'economy'
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
    targetState: CellState;
    breakRefusal: string | null;
    hasPlace: boolean;
    place: { x: number; y: number; z: number };
    /** The piece a click would place there, turned the way the aim decides. */
    state: CellState;
    placeRefusal: string | null;
    distance: number;
  };
  /** The hotbar selection, the kind of shape and its turn, Build Mode, the crosshair and the notice, as the HUD has them. */
  hands(): BuildHudState;
  /** Whether the ghost block and the break outline are on screen, and the shape id each is drawn in. */
  ghost(): { ghost: boolean; target: boolean; ghostShape: number; targetShape: number };
  /** The ring that shows how far a module's power reaches: the cell it is drawn round and its radius, or null while it is not on screen. */
  reach(): { x: number; y: number; z: number; radius: number } | null;
  /** How fast a held mouse button repeats, as a fraction of normal; low Energy slows it. */
  handScale(): number;
  /** Whether the player is down, which leaves the hands idle. */
  isDown(): boolean;
  /** The heap of debris the cursor is on, as of the last frame: its place in the run's list (-1 for none), the strips it has left and how far off it is. */
  salvage(): { index: number; left: number; distance: number };
}

export interface BuildControls {
  readonly controller: BuildController;
  /** Connects the commands to a session; null disconnects them. Refusals come back as notices. */
  setSession(session: BuildSession | null): void;
  /** Calls `listener` with the camera and the way it looks each time a shot of the blaster goes to the session. */
  onFire(listener: (origin: Vec3, dir: Vec3) => void): () => void;
  /** Calls `listener` each time a click or a key of the hands is turned away, whether this screen saw why or the host said so. */
  onRefused(listener: () => void): () => void;
  readonly debug: BuildControlsDebug;
  dispose(): void;
}

export function createBuildControls({ game, valley }: BuildControlsOptions): BuildControls {
  const { input } = game;
  let session: BuildSession | null = null;
  let stopRefusals: (() => void) | null = null;
  let stopHits: (() => void) | null = null;

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
  const fireListeners = new Set<(origin: Vec3, dir: Vec3) => void>();
  const refusedListeners = new Set<() => void>();
  const controller = new BuildController({
    blocks: () => current().voxels,
    ground: () => game.world.collision.ground,
    send(command) {
      if (!session || session.phase !== 'open') return false;
      session.sendCommand(command);
      return true;
    },
    fire(origin, dir) {
      if (!session || session.phase !== 'open') return false;
      // The bolt is drawn first: when this screen is the host's, its word on the shot is back before `fire` returns.
      for (const listener of fireListeners) listener(origin, dir);
      session.fire(origin, dir);
      return true;
    },
    bodies() {
      bodies.length = 0;
      bodies.push(game.player);
      if (session) for (const remote of session.sampleRemotes()) bodies.push(remote);
      return bodies;
    },
    warmUp,
    economy: () => session?.economy ?? IDLE_ECONOMY,
    power: (x, y, z) => valley()?.power.stateAt(x, y, z) ?? 'none',
    refused() {
      for (const listener of refusedListeners) listener();
    },
  });

  // The player's eyes are where reach is measured from; the camera is where the cursor looks from.
  const view: BuildView = {
    origin: { x: 0, y: 0, z: 0 },
    dir: { x: 0, y: 0, z: 0 },
    eye: { x: 0, y: 0, z: 0 },
  };
  const forward = new Vector3();

  // The benchmark has no hands: while it flies the valley, the buttons, the number keys, the wheel,
  // B, Q, R and E do nothing, and nothing is prepared for them, so it measures the game alone.
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
      if (game.sweep.active) return;
      if (action === 'toggleBuild') controller.toggleBuildMode();
      else if (action === 'cycleShape') controller.cycleShape();
      else if (action === 'turnPiece') controller.turnPiece();
      else if (action === 'interact') controller.interact();
    }),
  ];

  // A player who has the mouse and is looking around will likely build soon; get the blocks ready
  // while they look, so that the first one does not wait on the graphics driver.
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const stopLock = input.onChange(() => {
    if (!input.locked) {
      controller.releaseAll();
      controller.clearAim();
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
    const reach = world.view.reach;
    if (!input.locked || game.sweep.active) {
      ghost.setGhost(null);
      ghost.setTarget(null);
      reach.show(null);
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
      ghost.setGhost(
        aim.hasPlace ? aim.place : null,
        aim.placeRefusal === null,
        stateShape(aim.state),
      );
      ghost.setTarget(
        aim.on === 'block' ? aim.target : null,
        aim.breakRefusal === null,
        stateShape(aim.targetState),
      );
      // A module that gives by radius shows how far, where it would stand if it is in hand, else where it stands.
      const { cell, radius } = controller.reach;
      reach.show(cell, radius);
    } else {
      ghost.setGhost(null);
      ghost.setTarget(null);
      reach.show(null);
    }
  });

  const debug: BuildControlsDebug = {
    aim: () => {
      const {
        on,
        target,
        targetState,
        breakRefusal,
        hasPlace,
        place,
        state,
        placeRefusal,
        distance,
      } = controller.target;
      return {
        on,
        target: { ...target },
        targetState,
        breakRefusal,
        hasPlace,
        place: { ...place },
        state,
        placeRefusal,
        distance,
      };
    },
    hands: () => ({ ...controller.hudState() }),
    handScale: () => controller.handScale,
    isDown: () => controller.isDown,
    salvage: () => ({ ...controller.salvageTarget }),
    reach: () => valley()?.view.reach.shown ?? null,
    ghost: () => {
      const shown = valley()?.view.ghost.shown;
      return {
        ghost: shown?.ghost ?? false,
        target: shown?.target ?? false,
        ghostShape: shown?.ghostShape ?? 0,
        targetShape: shown?.targetShape ?? 0,
      };
    },
  };

  return {
    controller,
    setSession(next) {
      stopRefusals?.();
      stopRefusals = null;
      stopHits?.();
      stopHits = null;
      session = next;
      if (next) {
        stopRefusals = next.onRejected((rejection) => controller.noteRejection(rejection.reason));
        // The host's word on the player's own shots is what the hit marker shows.
        stopHits = next.onShot((shot) => {
          if (shot.by !== next.localId || (shot.flags & (SHOT_FLAG.enemy | SHOT_FLAG.wild)) === 0) {
            return;
          }
          controller.noteHit((shot.flags & SHOT_FLAG.kill) !== 0);
        });
      }
    },
    onFire(listener) {
      fireListeners.add(listener);
      return () => {
        fireListeners.delete(listener);
      };
    },
    onRefused(listener) {
      refusedListeners.add(listener);
      return () => {
        refusedListeners.delete(listener);
      };
    },
    debug,
    dispose() {
      stopRefusals?.();
      stopHits?.();
      stopFrames();
      stopLock();
      for (const stop of stops) stop();
      fireListeners.clear();
      refusedListeners.clear();
      if (idleTimer !== undefined) clearTimeout(idleTimer);
    },
  };
}
