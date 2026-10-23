import type { Game } from '../engine/game';
import type { BlockWorld } from '../shared/block-world';
import type { NetFlags } from '../shared/net-flags';
import type { PlayerSample } from '../shared/protocol';
import type { RayWorld } from '../shared/raycast';
import { createReading, nightStart } from '../shared/survival-state';
import type { NavWorld } from '../systems/survival/nav';
import { SurvivalSim } from '../systems/survival/sim';
import type { Outpost } from '../world/outpost';
import { createMultiplayer, type Multiplayer } from './multiplayer';
import { seatSpawn } from './seat-spawn';

/**
 * Puts multiplayer on a running game. This is the only file that knows both sides: it shows the
 * game's player, world and mouse to the net glue as the narrow views that glue asks for, and
 * runs the glue once per frame. It is loaded on demand, so a page that never goes online (and
 * the `?bench=1` page, which must not) never downloads the networking code.
 */

export interface AttachOptions {
  game: Game;
  /** The blocks of the world being played now. It is a new object after each `game.loadWorld`. */
  voxels(): BlockWorld;
  /** Where the Outpost Core stands in the world being played now, or null where there is none. */
  outpost(): Outpost | null;
  /** The ground the machines walk in the world being played now, or null where there is none. */
  navigation(): NavWorld | null;
  /** What stops a bolt of the pulse blaster in the world being played now (its blocks, its ground and the Core), or null where there is none. */
  rayWorld(): RayWorld | null;
  flags: NetFlags;
  buildId: string;
  /** Begin the run at the start of this night (the `?night=` switch), or at the first morning when null. */
  night: number | null;
  /** The sky follows the run's clock. False when the page holds a moment or runs its own demo clock. */
  skyFollowsClock: boolean;
}

/** The cells players have built in a world. */
function editsOf(world: BlockWorld): { x: number; y: number; z: number }[] {
  const cells: { x: number; y: number; z: number }[] = [];
  world.forEachEdit((x, y, z) => cells.push({ x, y, z }));
  return cells;
}

export function attachMultiplayer({
  game,
  voxels,
  outpost,
  navigation,
  rayWorld,
  flags,
  buildId,
  night,
  skyFollowsClock,
}: AttachOptions): Multiplayer {
  const multiplayer = createMultiplayer({
    flags,
    buildId,
    player: {
      read(out: PlayerSample) {
        const { player, look } = game;
        out.x = player.x;
        out.y = player.y;
        out.z = player.z;
        out.vx = player.vx;
        out.vy = player.vy;
        out.vz = player.vz;
        out.yaw = look.yaw;
        out.pitch = look.pitch;
        out.onGround = player.onGround;
        return true;
      },
      teleport: (x, y, z) => game.teleport(x, y, z),
    },
    world: {
      world: voxels,
      loadWorld(seed) {
        // The same valley with nothing built on it is already what the host's snapshot builds on.
        const current = voxels();
        if (current.seed !== seed || editsOf(current).length > 0) {
          game.loadWorld(seed);
          // A page opened with `?demo=` raises its structure in every valley it builds. A room's
          // world is the host's blocks alone, so the demo goes before the snapshot arrives.
          const fresh = voxels();
          for (const { x, y, z } of editsOf(fresh)) fresh.setBlock(x, y, z, 0);
        }
        return Promise.resolve(voxels());
      },
      spawnPoint: (slot) => seatSpawn(game.world, voxels(), slot),
      survival: () =>
        new SurvivalSim({
          startAt: night === null ? 0 : nightStart(night),
          core: outpost(),
          nav: navigation(),
          ray: rayWorld(),
          seed: game.world.seed,
        }),
    },
    groundAt: (x, z) => game.world.groundAt(x, z),
    scene: game.stage.world,
    registry: game.stage.registry,
    input: game.input,
  });
  const stopUpdates = game.onBeforeRender((_camera, dt) => multiplayer.update(dt));

  // From here on the light follows the run: sunrise, a long golden day, dusk, night, dawn.
  const reading = createReading();
  if (skyFollowsClock) {
    game.stage.setSkyDriver(() => multiplayer.lobby.hub.survival.read(reading).sky);
    game.stage.setMoment(null);
  }

  return {
    ...multiplayer,
    dispose() {
      if (skyFollowsClock) game.stage.setSkyDriver(null);
      stopUpdates();
      multiplayer.dispose();
    },
  };
}
