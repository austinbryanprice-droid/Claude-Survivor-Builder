import type { Object3D } from 'three';
import type { Game } from '../engine/game';
import type { IntroSite } from '../engine/intro/director';
import { CRYSTAL_Y } from '../world/render/core-render';
import { CRASH, FURROW } from '../world/terrain/field';
import { createIntroController, type IntroController } from './intro';
import type { ValleyWorld } from './valley-world';

export interface IntroAttachOptions {
  readonly game: Game;
  /** The valley being played, or null while there is none. */
  readonly valley: () => ValleyWorld | null;
  /** Whether a fresh run should open with the film, asked when the mouse is first requested. */
  readonly wanted: () => boolean;
}

/** Seconds between looks for the heaps of debris, which come with the multiplayer code and so can turn up after the film has begun. */
const HEAPS_LOOK_EVERY = 0.25;

/**
 * Loads on its own once the game is up, and only when a film is wanted, so that a page that never
 * plays it pays nothing for it. This is the one place that knows both the film and the valley: it
 * tells the film where the crash site is and how to put the wreck on and take it off.
 */
export function attachIntro({ game, valley, wanted }: IntroAttachOptions): IntroController {
  let heaps: Object3D | null = null;
  let lookedAt = Number.NEGATIVE_INFINITY;
  const findHeaps = (): Object3D | null => {
    if (heaps?.parent) return heaps;
    const now = performance.now() / 1000;
    if (now - lookedAt < HEAPS_LOOK_EVERY) return null;
    lookedAt = now;
    heaps = game.stage.world.getObjectByName('debris-field') ?? null;
    return heaps;
  };

  const site = (): IntroSite | null => {
    const world = valley();
    if (!world) return null;
    const stand = world.view.core?.object.position;
    return {
      groundAt: (x, z) => game.world.groundAt(x, z),
      crater: { x: CRASH.x, z: CRASH.z, radius: CRASH.radius },
      furrow: FURROW,
      spawn: { x: game.world.spawn.x, z: game.world.spawn.z },
      core: stand
        ? { x: stand.x, y: stand.y + CRYSTAL_Y, z: stand.z }
        : { x: CRASH.x, y: game.world.groundAt(CRASH.x, CRASH.z) + CRYSTAL_Y, z: CRASH.z },
      showWreck(shown) {
        // The Core and the heaps of debris came with the crash: before it, there is nothing at the site.
        const core = world.view.core;
        if (core) core.object.visible = shown;
        const field = findHeaps();
        if (field) field.visible = shown;
      },
    };
  };
  return createIntroController({ game, site, wanted });
}
