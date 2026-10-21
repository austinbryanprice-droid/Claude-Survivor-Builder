import type { Game } from '../engine/game';
import type { BlockWorld } from '../shared/block-world';
import type { NetFlags } from '../shared/net-flags';
import type { PlayerSample } from '../shared/protocol';
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
  flags: NetFlags;
  buildId: string;
}

export function attachMultiplayer({ game, voxels, flags, buildId }: AttachOptions): Multiplayer {
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
        let built = false;
        current.forEachEdit(() => {
          built = true;
        });
        if (current.seed !== seed || built) game.loadWorld(seed);
        return Promise.resolve(voxels());
      },
      spawnPoint: (slot) => seatSpawn(game.world, voxels(), slot),
    },
    groundAt: (x, z) => game.world.groundAt(x, z),
    scene: game.stage.world,
    registry: game.stage.registry,
    input: game.input,
  });
  const stopUpdates = game.onBeforeRender((_camera, dt) => multiplayer.update(dt));

  return {
    ...multiplayer,
    dispose() {
      stopUpdates();
      multiplayer.dispose();
    },
  };
}
