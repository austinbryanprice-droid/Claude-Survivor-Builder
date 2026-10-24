import { describe, expect, it } from 'vitest';
import { MATERIAL } from '../../src/shared/blocks';
import { DEBRIS } from '../../src/systems/economy/balance';
import { debrisBand, debrisField } from '../../src/systems/economy/field';
import { valleyNavigation } from '../../src/systems/survival/valley-nav';
import { LAKE, WATER_LEVEL } from '../../src/world/terrain/field';
import { createWorld } from '../../src/world/voxels/world';
import { TEST_SEED, terrain } from './helpers/valley';
import { flatWorld } from './helpers/nav-world';

const TOTAL = DEBRIS.initial + DEBRIS.perDawn * DEBRIS.dawns;

describe('the field of debris on open ground', () => {
  const { world, core } = flatWorld();
  const field = debrisField(7, world, core);

  it('draws every heap the table asks for when there is room', () => {
    expect(field).toHaveLength(TOTAL);
    expect(field.filter((node) => node.from === 0)).toHaveLength(DEBRIS.initial);
    for (let night = 1; night <= DEBRIS.dawns; night++) {
      expect(field.filter((node) => node.from === night)).toHaveLength(DEBRIS.perDawn);
    }
  });

  it('numbers the heaps in the order of the list, the first batch first', () => {
    field.forEach((node, i) => expect(node.index).toBe(i));
    const nights = field.map((node) => node.from);
    expect(nights).toEqual([...nights].sort((a, b) => a - b));
  });

  it('gives the heaps what the table says: two to four strips of Scrap, a size and a way they lie', () => {
    for (const node of field) {
      expect(node.harvests).toBeGreaterThanOrEqual(DEBRIS.harvests.min);
      expect(node.harvests).toBeLessThanOrEqual(DEBRIS.harvests.max);
      expect(node.grade).toBe(MATERIAL.scrap);
      expect(node.scale).toBeGreaterThanOrEqual(DEBRIS.size.min);
      expect(node.scale).toBeLessThanOrEqual(DEBRIS.size.max);
      expect(node.yaw).toBeGreaterThanOrEqual(0);
      expect(node.yaw).toBeLessThan(Math.PI * 2);
    }
    // All three strip counts turn up: the field is not a stamp.
    expect(new Set(field.map((node) => node.harvests)).size).toBe(
      DEBRIS.harvests.max - DEBRIS.harvests.min + 1,
    );
  });

  it('keeps every heap in the band of its batch round the Core', () => {
    for (const node of field) {
      const band = debrisBand(node.from);
      const distance = Math.hypot(node.x - core.x, node.z - core.z);
      // A hundredth of a block of rounding, no more.
      expect(distance).toBeGreaterThanOrEqual(band.inner - 0.02);
      expect(distance).toBeLessThanOrEqual(band.outer + 0.02);
    }
  });

  it('lets the bands creep outward from one dawn to the next and stop at the limit', () => {
    expect(debrisBand(0)).toEqual({ inner: DEBRIS.inner, outer: DEBRIS.outer });
    let before = debrisBand(1);
    for (let batch = 2; batch <= DEBRIS.dawns; batch++) {
      const band = debrisBand(batch);
      expect(band.inner).toBeGreaterThanOrEqual(before.inner);
      expect(band.outer).toBeLessThanOrEqual(DEBRIS.limit);
      before = band;
    }
    expect(debrisBand(99).outer).toBe(DEBRIS.limit);
  });

  it('keeps the heaps apart from one another and off the edge of the valley', () => {
    for (const a of field) {
      expect(Math.abs(a.x)).toBeLessThanOrEqual(96 - DEBRIS.edge);
      expect(Math.abs(a.z)).toBeLessThanOrEqual(96 - DEBRIS.edge);
      for (const b of field) {
        if (a.index >= b.index) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(DEBRIS.gap);
      }
    }
  });

  it('rests every heap on the ground', () => {
    for (const node of field) expect(node.y).toBe(world.surfaceAt(node.x, node.z));
  });

  it('draws the same field for the same seed and another for another', () => {
    expect(debrisField(7, world, core)).toEqual(field);
    const other = debrisField(8, world, core);
    expect(other).not.toEqual(field);
    expect(other).toHaveLength(TOTAL);
  });

  it('does not let one batch change where the others lie', () => {
    // Batch 0 draws from a generator of its own: it is the same whether or not later batches find room.
    const crowded = flatWorld({
      height: (x, z) => (Math.hypot(x - core.x, z - core.z) > 45 ? -5 : 10),
    });
    const near = debrisField(7, crowded.world, crowded.core).filter((node) => node.from === 0);
    expect(near).toEqual(field.filter((node) => node.from === 0));
  });
});

describe('the field of debris on awkward ground', () => {
  it('keeps out of water, off slopes and off the tops of rocks', () => {
    const { world, core } = flatWorld({
      waterLevel: 7,
      height: (x, z) => {
        if (x > 25) return 2; // a lake to the east
        if (z > 25) return 10 + (z - 25); // a hillside to the south, steeper than a heap can lie on
        if (Math.hypot(x + 20, z + 5) < 3) return 18; // a rock standing on the plain
        return 10;
      },
    });
    for (const seed of [1, 2, 3, 4]) {
      for (const node of debrisField(seed, world, core)) {
        expect(node.x).toBeLessThan(25 - 2);
        expect(node.z).toBeLessThan(25 - 1);
        expect(Math.hypot(node.x + 20, node.z + 5)).toBeGreaterThan(3 + 1);
      }
    }
  });

  it('leaves out a heap it cannot place instead of looping', () => {
    const { world, core } = flatWorld({ height: () => 2, waterLevel: 7 });
    expect(debrisField(1, world, core)).toEqual([]);
  });
});

describe('the field of debris in the real valley', () => {
  const valley = terrain();
  const voxels = createWorld(TEST_SEED, valley);
  const core = voxels.outpost as NonNullable<typeof voxels.outpost>;
  const nav = valleyNavigation({ terrain: valley, voxels });
  const field = debrisField(TEST_SEED, nav, core);

  it('finds room for nearly all of them', () => {
    expect(field.filter((node) => node.from === 0).length).toBeGreaterThanOrEqual(
      DEBRIS.initial - 2,
    );
    expect(field.length).toBeGreaterThanOrEqual(TOTAL - 8);
  });

  it('lies on dry land, outside the lake and well away from the Core', () => {
    for (const node of field) {
      expect(node.y).toBeGreaterThanOrEqual(WATER_LEVEL + DEBRIS.dry);
      expect(Math.hypot(node.x - LAKE.x, node.z - LAKE.z)).toBeGreaterThan(20);
      expect(Math.hypot(node.x - core.x, node.z - core.z)).toBeGreaterThanOrEqual(
        DEBRIS.inner - 0.02,
      );
    }
  });

  it('is the same every time it is drawn', () => {
    expect(debrisField(TEST_SEED, nav, core)).toEqual(field);
    expect(debrisField(TEST_SEED + 1, nav, core)).not.toEqual(field);
  });
});
