import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/systems/survival/balance';
import {
  NAV_BLOCKED,
  NAV_CORE,
  NAV_OPEN,
  NAV_WALLED,
  NavGrid,
  type NavWorld,
} from '../../src/systems/survival/nav';
import { valleyNavigation } from '../../src/systems/survival/valley-nav';
import { LAKE } from '../../src/world/terrain/field';
import { createWorld } from '../../src/world/voxels/world';
import { TEST_SEED, terrain } from './helpers/valley';

/** The enemies' map over the real valley of the default seed, with nothing built on it. */
function valleyMap(): { voxels: ReturnType<typeof createWorld>; nav: NavGrid; world: NavWorld } {
  const valley = terrain();
  const voxels = createWorld(TEST_SEED, valley);
  const world = valleyNavigation({ terrain: valley, voxels });
  return {
    voxels,
    world,
    nav: new NavGrid(world, voxels.outpost as NonNullable<typeof voxels.outpost>),
  };
}

describe('the enemies map of the valley', () => {
  const { voxels, nav } = valleyMap();
  const core = voxels.outpost as NonNullable<typeof voxels.outpost>;

  it('puts the goal on the Core and leaves nothing walled before anyone builds', () => {
    let goal = 0;
    let walled = 0;
    for (const state of nav.state) {
      if (state === NAV_CORE) goal++;
      if (state === NAV_WALLED) walled++;
    }
    expect(goal).toBe(9);
    expect(walled).toBe(0);
    expect(nav.stateAt(core.x, core.z)).toBe(NAV_CORE);
  });

  it('keeps out of the lake, which lies to the east, and walks the rest', () => {
    expect(nav.stateAt(LAKE.x, LAKE.z)).toBe(NAV_BLOCKED);
    expect(nav.costAt(LAKE.x, LAKE.z)).toBe(Infinity);
    expect(nav.stateAt(core.x - 30, core.z + 10)).toBe(NAV_OPEN);
  });

  it('reaches the Core from the whole ring they come in on, except across the water', () => {
    const ring = ENEMIES.spawnRadius;
    let reached = 0;
    let spawnable = 0;
    for (let degrees = 0; degrees < 360; degrees += 5) {
      const x = core.x + Math.cos((degrees * Math.PI) / 180) * ring;
      const z = core.z + Math.sin((degrees * Math.PI) / 180) * ring;
      if (nav.stateAt(x, z) !== NAV_OPEN) continue;
      spawnable++;
      const cost = nav.costAt(x, z);
      if (!Number.isFinite(cost)) continue;
      reached++;
      // The valley is open ground: the walk is hardly longer than the straight line.
      expect(cost).toBeLessThan(ring * 1.3);
      expect(cost).toBeGreaterThanOrEqual(ring - 4);
    }
    // Every open place on the ring has a way in, and most of the ring is open.
    expect(reached).toBe(spawnable);
    expect(spawnable).toBeGreaterThan(50);
  });

  it('works the routes out quickly enough to do it again after every edit', () => {
    const started = performance.now();
    for (let i = 0; i < 10; i++) nav.solve();
    // About three milliseconds on a laptop; the bound is only there to catch a mistake of an order of magnitude.
    expect((performance.now() - started) / 10).toBeLessThan(60);
  });

  it('is the same map every time for a seed', () => {
    const again = valleyMap().nav;
    expect(again.state).toEqual(nav.state);
    expect(again.costAt(core.x - 30, core.z + 10)).toBe(nav.costAt(core.x - 30, core.z + 10));
  });
});
