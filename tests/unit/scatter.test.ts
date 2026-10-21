import { describe, expect, it } from 'vitest';
import {
  CLUMP_STRIDE,
  GRASS_CELLS_PER_SIDE,
  GrassField,
  TREE_BROADLEAF,
  TREE_PINE,
  rootBuried,
  scatterTrees,
  trunkBlocked,
  type Obstacles,
} from '../../src/world/scatter';
import { CRASH, WATER_LEVEL, WORLD_HALF } from '../../src/world/terrain/field';
import { TEST_SEED, valley } from './helpers/valley';

describe('tree scatter', () => {
  const { ground } = valley();
  const clear = [{ x: 12, z: 7, radius: 13 }];
  const trees = scatterTrees(TEST_SEED, ground, clear);

  it('grows the same forest from the same seed and another from a different one', () => {
    expect(scatterTrees(TEST_SEED, ground, clear)).toEqual(trees);
    expect(scatterTrees(TEST_SEED + 1, ground, clear)).not.toEqual(trees);
  });

  it('plants a forest of a plausible size', () => {
    expect(trees.length).toBeGreaterThan(400);
    expect(trees.length).toBeLessThan(2400);
    expect(trees.some((t) => t.kind === TREE_PINE)).toBe(true);
    expect(trees.some((t) => t.kind === TREE_BROADLEAF)).toBe(true);
  });

  it('keeps trees out of the water, the clearing, the keep-clear discs and the rocks', () => {
    for (const t of trees) {
      expect(t.y).toBeGreaterThan(WATER_LEVEL);
      expect(Math.hypot(t.x - CRASH.x, t.z - CRASH.z)).toBeGreaterThan(CRASH.radius + 8);
      for (const c of clear)
        expect(Math.hypot(t.x - c.x, t.z - c.z)).toBeGreaterThanOrEqual(c.radius);
      expect(ground.solidAt(t.x, t.y + 0.6, t.z)).toBe(false);
      expect(Math.abs(t.x)).toBeLessThan(WORLD_HALF);
      expect(Math.abs(t.z)).toBeLessThan(WORLD_HALF);
    }
  });

  it('stands every tree on the ground with sane size and variation', () => {
    for (const t of trees) {
      expect(t.y).toBeCloseTo(ground.groundAt(t.x, t.z), 6);
      expect(t.scale).toBeGreaterThan(0.6);
      expect(t.scale).toBeLessThan(2.2);
      expect(t.tint).toBeGreaterThanOrEqual(0);
      expect(t.tint).toBeLessThan(1);
      expect(t.yaw).toBeGreaterThanOrEqual(0);
      expect(t.yaw).toBeLessThan(Math.PI * 2 + 1e-9);
    }
  });
});

describe('grass field', () => {
  const { ground } = valley();
  const trees = scatterTrees(TEST_SEED, ground);
  const grass = new GrassField(TEST_SEED, ground, trees);

  it('builds a cell the same way every time and caches it', () => {
    const a = grass.cell(10, 12);
    const again = new GrassField(TEST_SEED, ground, trees).cell(10, 12);
    expect(Array.from(again.grass)).toEqual(Array.from(a.grass));
    expect(grass.cell(10, 12)).toBe(a);
  });

  it('packs whole clumps with ranks in [0, 1) and nothing under water', () => {
    let clumps = 0;
    for (let cz = 6; cz < 14; cz++) {
      for (let cx = 6; cx < 14; cx++) {
        const cell = grass.cell(cx, cz);
        expect(cell.grass.length % CLUMP_STRIDE).toBe(0);
        expect(cell.flowers.length % CLUMP_STRIDE).toBe(0);
        for (let i = 0; i < cell.grass.length; i += CLUMP_STRIDE) {
          clumps++;
          expect(cell.grass[i + 1] as number).toBeGreaterThan(WATER_LEVEL);
          expect(cell.grass[i + 5] as number).toBeGreaterThanOrEqual(0);
          expect(cell.grass[i + 5] as number).toBeLessThan(1);
        }
      }
    }
    expect(clumps).toBeGreaterThan(1000);
  });

  it('keeps clumps away from trunks', () => {
    const tree = trees[Math.floor(trees.length / 2)];
    expect(tree).toBeDefined();
    if (!tree) return;
    const cx = Math.min(GRASS_CELLS_PER_SIDE - 1, Math.floor((tree.x + WORLD_HALF) / 8));
    const cz = Math.min(GRASS_CELLS_PER_SIDE - 1, Math.floor((tree.z + WORLD_HALF) / 8));
    const cell = grass.cell(cx, cz);
    for (let i = 0; i < cell.grass.length; i += CLUMP_STRIDE) {
      const d = Math.hypot(
        (cell.grass[i] as number) - tree.x,
        (cell.grass[i + 2] as number) - tree.z,
      );
      expect(d).toBeGreaterThan(0.7);
    }
  });
});

describe('plants and the blocks players build', () => {
  /** A world with solid cells at the given positions. */
  function blocks(...cells: [number, number, number][]): Obstacles {
    const solid = new Set(cells.map((c) => c.join(',')));
    return { blockCount: solid.size, isSolid: (x, y, z) => solid.has(`${x},${y},${z}`) };
  }

  it('buries a plant rooted inside a block', () => {
    const world = blocks([4, 10, -3]);
    expect(rootBuried(world, 4.4, 10.5, -2.6)).toBe(true);
  });

  it('buries a plant rooted on top of a block, but not one beside it', () => {
    const world = blocks([4, 10, -3]);
    // Ground at the top face of the block: the root sits on it.
    expect(rootBuried(world, 4.5, 11, -2.5)).toBe(true);
    // The same height one cell over has nothing under it.
    expect(rootBuried(world, 5.5, 11, -2.5)).toBe(false);
    // And the block's neighbour at ground level is open ground.
    expect(rootBuried(world, 5.5, 10.5, -2.5)).toBe(false);
  });

  it('finds the cell of a negative coordinate by flooring, not by truncating', () => {
    const world = blocks([-1, 5, -1]);
    expect(rootBuried(world, -0.4, 5.5, -0.4)).toBe(true);
    expect(rootBuried(world, 0.4, 5.5, 0.4)).toBe(false);
  });

  it('stops a trunk that a block stands in, up to head height', () => {
    const foot = [4.5, 10.2, -2.5] as const;
    expect(trunkBlocked(blocks([4, 10, -3]), ...foot)).toBe(true);
    expect(trunkBlocked(blocks([4, 11, -3]), ...foot)).toBe(true);
    expect(trunkBlocked(blocks([4, 12, -3]), ...foot)).toBe(true);
    // A roof well above a person leaves the tree alone, as does a wall beside it.
    expect(trunkBlocked(blocks([4, 14, -3]), ...foot)).toBe(false);
    expect(trunkBlocked(blocks([5, 10, -3], [3, 11, -3]), ...foot)).toBe(false);
  });

  it('hides nothing while there are no blocks', () => {
    const none: Obstacles = {
      blockCount: 0,
      isSolid: () => {
        throw new Error('nothing to ask');
      },
    };
    expect(rootBuried(none, 1, 2, 3)).toBe(false);
    expect(trunkBlocked(none, 1, 2, 3)).toBe(false);
  });
});
