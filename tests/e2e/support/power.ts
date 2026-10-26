import type { Page } from '@playwright/test';

/** A spot on the ground, as the debug hooks give one. */
export interface Spot {
  x: number;
  z: number;
}

/** The offsets, in cells from the player's own, where a test puts something it will aim at (see `lowGroundNear`). */
const CELLS_NEAR: number[][] = [
  [3, 0],
  [3, 1],
  [3, -1],
  [-3, 0],
  [-3, 1],
  [4, 0],
  [-4, 0],
];

/**
 * A spot on gentle ground at least thirty blocks from the Outpost Core, to its east (`side` 1) or its
 * west (-1), with a cell near it whose ground is low (`lowGroundNear`): the Core's own charge field
 * reaches eight blocks and a Generator's six, so nothing here is charged but by the Generator a test
 * stands there. Null when none of the places it tries is open (a fall or a rise of more than three
 * blocks within eight of it).
 */
export function openGroundFarFromTheCore(page: Page, side: 1 | -1): Promise<Spot | null> {
  return page.evaluate<Spot | null>(`(() => {
    const { game } = window.__ashbound;
    const core = game.world.voxels.outpost;
    const spread = (cx, cz) => {
      let low = Infinity;
      let high = -Infinity;
      for (let dx = -8; dx <= 8; dx += 2) {
        for (let dz = -8; dz <= 8; dz += 2) {
          const ground = game.world.groundAt(cx + dx, cz + dz);
          low = Math.min(low, ground);
          high = Math.max(high, ground);
        }
      }
      return high - low;
    };
    const lowCell = (x, z) =>
      ${JSON.stringify(CELLS_NEAR)}.some(([dx, dz]) => {
        const ground = game.world.groundAt(Math.floor(x) + dx + 0.5, Math.floor(z) + dz + 0.5);
        return ground - Math.floor(ground) < 0.3;
      });
    for (const [dx, dz] of [[32, 0], [32, 12], [32, -12], [44, 0], [44, 12], [44, -12], [56, 0]]) {
      const x = core.x + ${side} * dx + 0.5;
      const z = core.z + dz + 0.5;
      if (spread(x, z) < 3 && lowCell(x, z)) return { x, z };
    }
    return null;
  })()`);
}

/** Puts the player on the ground at (x, z), facing -z. */
export function standAt(page: Page, x: number, z: number): Promise<void> {
  return page.evaluate(
    ([tx, tz]) => {
      const game = window.__ashbound?.game;
      if (game) game.teleport(tx!, game.world.groundAt(tx!, tz!) + 0.05, tz!, 0);
    },
    [x, z] as const,
  );
}

/**
 * Where, near the player, a module shows above the ground: a cell stands at the floor of the ground's
 * height, so on a rise the cursor would meet the ground before the module's body. Returns the offset in
 * cells from the player's own, for `placeNear`, or null when none of the cells tried has low ground.
 */
export function lowGroundNear(page: Page): Promise<{ dx: number; dz: number } | null> {
  return page.evaluate((cells) => {
    const { game, mp } = window.__ashbound!;
    const me = mp!.position();
    for (const [dx, dz] of cells as [number, number][]) {
      const ground = game.world.groundAt(Math.floor(me.x) + dx + 0.5, Math.floor(me.z) + dz + 0.5);
      if (ground - Math.floor(ground) < 0.3) return { dx, dz };
    }
    return null;
  }, CELLS_NEAR);
}

/**
 * Puts the player on the ring `radius` blocks out from the Outpost Core, at the bearing they stand
 * from it turned by `turn` radians, and returns where. A guest cannot be moved far at once: the host
 * brings back a player it sees move faster than they could (fourteen blocks banked, a little more
 * than nine a second), so a test that moves a guest to somewhere the Core's field does not reach does
 * it in one short hop from where they were seated, and sends two players different ways with
 * different turns.
 */
export function hopFromTheCore(page: Page, radius: number, turn: number): Promise<Spot> {
  return page.evaluate<Spot>(`(() => {
    const { game } = window.__ashbound;
    const core = game.world.voxels.outpost;
    const bearing = Math.atan2(game.player.z - core.z, game.player.x - core.x) + ${turn};
    const x = core.x + Math.cos(bearing) * ${radius};
    const z = core.z + Math.sin(bearing) * ${radius};
    game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
    return { x, z };
  })()`);
}
