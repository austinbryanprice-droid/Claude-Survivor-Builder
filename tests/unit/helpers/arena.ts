import { DAY_SECONDS } from '../../../src/shared/daycycle';
import type { NavWorld } from '../../../src/systems/survival/nav';
import type { SurvivalOptions, SurvivalSim } from '../../../src/systems/survival/sim';
import { outpostDistance, outpostFor } from '../../../src/world/outpost';
import { TestWorld, makeRoom, type RoomOptions } from './net';

export type Room = ReturnType<typeof makeRoom>;

/** The height of the flat ground the arena stands on. */
export const FLOOR = 10;

/** A world where a block may hang in the air, which the real one forbids and these tests have no use for. */
export class HangingWorld extends TestWorld {
  override checkPlace(x: number, y: number, z: number, state: number): string | null {
    if (state < 1 || state > 1000) return 'unknown-block';
    return this.isSolid(x, y, z) ? 'occupied' : null;
  }
}

/**
 * A room whose machines walk the host's own world: flat ground at 10, the Core on it, and the
 * blocks the host world holds standing in their way, as in the game. The map is drawn when the run
 * begins, so what is built beforehand is given to `build`, which runs first. The bolts of the
 * pulse blaster are stopped by the same blocks, the ground and the Core.
 */
export function arena(
  options: RoomOptions = {},
  run: SurvivalOptions = {},
  build?: (world: TestWorld) => void,
) {
  const hostWorld = new HangingWorld(4242);
  build?.(hostWorld);
  const core = outpostFor(() => FLOOR);
  const nav: NavWorld = {
    solids: { isSolid: (x, y, z) => hostWorld.isSolid(x, y, z) || core.contains(x, y, z) },
    blockAt: (x, y, z) => hostWorld.getBlock(x, y, z),
    surfaceAt: () => FLOOR,
    waterLevel: 0,
    half: 96,
  };
  const room = makeRoom({
    ...options,
    hostWorld,
    survival: {
      core,
      nav,
      seed: 5,
      startAt: DAY_SECONDS + 1,
      // The tests put the machines where they want them; the nights' waves have tests of their own.
      waves: false,
      ray: {
        blocks: hostWorld,
        ground: { distance: (x, y, z) => Math.min(y - FLOOR, outpostDistance(core, x, y, z)) },
      },
      // The turrets among the host world's blocks shoot, as the game's do.
      modules: (visit) => hostWorld.forEachEdit((x, y, z, state) => visit({ x, y, z, state })),
      ...run,
    },
  });
  return { room, hostWorld, core, machines: () => sim(room).enemies! };
}

export function sim(room: Room): SurvivalSim {
  return room.host.survivalSim as SurvivalSim;
}

/** Plays `seconds` of the room's time, a tick at a time, letting promises settle on the way. */
export async function play(room: Room, seconds: number): Promise<void> {
  for (let t = 0; t < seconds * 1000; t += 50) {
    room.scheduler.advance(50);
    await room.flush();
  }
}
