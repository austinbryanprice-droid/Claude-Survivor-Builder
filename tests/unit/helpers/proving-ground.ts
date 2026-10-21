import { createRng } from '../../../src/shared/hash';
import { SparseCells, type SolidQuery } from '../../../src/shared/solid';

/**
 * A walled deck with the things cell-based movement has to get right (stairs, jumping gaps,
 * doorways, tunnels, slalom pillars). It began as the Phase 1 test scene the player walked on; the
 * valley replaced it in Phase 2, and the movement and camera tests keep using it as a fixture.
 *
 * The floor's top is y = 0 and a cell is one block. The middle of the deck, out to 12 blocks in
 * every direction, is kept empty.
 */

/** Outermost cell coordinate of the deck on each side; the wall ring stands on the edge cells. */
export const DECK = { min: -25, max: 24 } as const;
export const WALL_HEIGHT = 4;
export const CLEAR_RADIUS = 12;

export const SPAWN = { x: 0.5, y: 0, z: 0.5, yaw: 0 } as const;

/** Cell ids. The renderer maps them to tints; the movement code only cares that they are non-zero. */
export const BLOCK = {
  wall: 1,
  stairs: 2,
  gap: 3,
  tower: 4,
  towerCap: 5,
  pyramid: 6,
  pillar: 7,
  gate: 8,
  tunnel: 9,
  rail: 10,
} as const;

export class ProvingGround implements SolidQuery {
  readonly cells = new SparseCells();

  isSolid(x: number, y: number, z: number): boolean {
    if (y === -1 && x >= DECK.min && x <= DECK.max && z >= DECK.min && z <= DECK.max) return true;
    return this.cells.isSolid(x, y, z);
  }
}

export function buildProvingGround(): ProvingGround {
  const world = new ProvingGround();
  const cells = world.cells;

  // The wall ring.
  const { min, max } = DECK;
  cells.fillBox(min, 0, min, max, WALL_HEIGHT - 1, min, BLOCK.wall);
  cells.fillBox(min, 0, max, max, WALL_HEIGHT - 1, max, BLOCK.wall);
  cells.fillBox(min, 0, min, min, WALL_HEIGHT - 1, max, BLOCK.wall);
  cells.fillBox(max, 0, min, max, WALL_HEIGHT - 1, max, BLOCK.wall);

  // East: six one-block steps up to a lookout that stands above the wall. A two-high rail on its
  // east edge keeps a running jump from carrying the player over the wall and out of the arena.
  for (let i = 0; i < 6; i++) cells.fillBox(13 + i, 0, -2, 13 + i, i, 1, BLOCK.stairs);
  cells.fillBox(19, 0, -3, 22, 5, 2, BLOCK.stairs);
  cells.fillBox(22, 6, -3, 22, 7, 2, BLOCK.rail);

  // North: jumping gaps of one, two, three and four blocks between low platforms. A walking jump
  // clears the short ones; the four-block gap needs a sprint.
  const platforms: [number, number][] = [
    [-22, -21],
    [-19, -18],
    [-15, -14],
    [-10, -9],
    [-4, -1],
  ];
  for (const [from, to] of platforms) cells.fillBox(from, 0, -22, to, 0, -20, BLOCK.gap);

  // West: a wall of doorways. One is two high and one wide, one is three by three, and one is
  // a one-block slot that is too low to walk through.
  cells.fillBox(-14, 0, -6, -14, 3, 6, BLOCK.gate);
  cells.clearBox(-14, 0, 0, -14, 1, 0);
  cells.clearBox(-14, 0, 3, -14, 0, 3);
  cells.clearBox(-14, 0, -4, -14, 2, -2);

  // South: a tunnel the player fits through and a lower one it does not.
  cells.fillBox(-1, 0, 14, -1, 2, 19, BLOCK.tunnel);
  cells.fillBox(1, 0, 14, 1, 2, 19, BLOCK.tunnel);
  cells.fillBox(0, 2, 14, 0, 2, 19, BLOCK.tunnel);
  cells.fillBox(4, 0, 14, 4, 1, 19, BLOCK.tunnel);
  cells.fillBox(6, 0, 14, 6, 1, 19, BLOCK.tunnel);
  cells.fillBox(5, 1, 14, 5, 1, 19, BLOCK.tunnel);

  // South-east: a stepped pyramid.
  cells.fillBox(13, 0, 14, 19, 0, 20, BLOCK.pyramid);
  cells.fillBox(14, 1, 15, 18, 1, 19, BLOCK.pyramid);
  cells.fillBox(15, 2, 16, 17, 2, 18, BLOCK.pyramid);
  cells.fillBox(16, 3, 17, 16, 3, 17, BLOCK.pyramid);

  // North-east: a tall landmark with an amber cap.
  cells.fillBox(15, 0, -18, 17, 10, -16, BLOCK.tower);
  cells.fillBox(15, 11, -18, 17, 11, -16, BLOCK.towerCap);

  // South-west: slalom pillars, placed from a fixed seed so the layout never changes.
  const rng = createRng(2024);
  const placed: [number, number][] = [];
  for (let attempt = 0; attempt < 400 && placed.length < 26; attempt++) {
    const x = -23 + Math.floor(rng() * 10);
    const z = 8 + Math.floor(rng() * 15);
    const height = 1 + Math.floor(rng() * 4);
    const crowded = placed.some(([px, pz]) => Math.abs(px - x) < 2 && Math.abs(pz - z) < 2);
    if (crowded) continue;
    placed.push([x, z]);
    cells.fillBox(x, 0, z, x, height - 1, z, BLOCK.pillar);
  }

  return world;
}
