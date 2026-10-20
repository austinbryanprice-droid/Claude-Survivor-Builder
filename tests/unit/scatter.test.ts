import { describe, expect, it } from 'vitest';
import {
  CLUMP_STRIDE,
  GRASS_CELLS_PER_SIDE,
  GrassField,
  TREE_BROADLEAF,
  TREE_PINE,
  scatterTrees,
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
