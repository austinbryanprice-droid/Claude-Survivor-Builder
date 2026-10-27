import { describe, expect, it } from 'vitest';
import { MATERIAL, MODULE, moduleShape, packState } from '../../src/shared/blocks';
import { createEconomyReading } from '../../src/shared/economy';
import { POOL } from '../../src/systems/economy/balance';
import { Pool } from '../../src/systems/economy/pool';
import { SurvivalSim } from '../../src/systems/survival/sim';
import { Storehouse, ceilingWith } from '../../src/systems/survival/storehouse';
import type { ModuleSite } from '../../src/systems/survival/turrets';
import { flatWorld } from './helpers/nav-world';

const STORAGE = packState(moduleShape(MODULE.storage, 0), 1);
const TERMINAL = packState(moduleShape(MODULE.terminal, 0), 1);
const GENERATOR = packState(moduleShape(MODULE.generator, 0), 1);

/** A list of the modules a world holds, and a source that walks it as the world's own does. */
function world(...sites: ModuleSite[]) {
  const list = [...sites];
  return {
    list,
    source: (visit: (site: ModuleSite) => void): void => {
      for (const site of list) visit(site);
    },
  };
}

const site = (x: number, state: number): ModuleSite => ({ x, y: 4, z: 0, state });

describe('the pool’s ceiling with Storages standing', () => {
  it('is the table’s cap with none, and so much more for each one', () => {
    expect(ceilingWith(0)).toBe(POOL.cap);
    expect(ceilingWith(1)).toBe(POOL.cap + POOL.perStorage);
    expect(ceilingWith(4)).toBe(POOL.cap + 4 * POOL.perStorage);
  });

  it('counts a count that is not a whole number from zero up as the whole number below it', () => {
    expect(ceilingWith(-3)).toBe(POOL.cap);
    expect(ceilingWith(2.9)).toBe(POOL.cap + 2 * POOL.perStorage);
    expect(ceilingWith(Number.NaN)).toBe(POOL.cap);
  });

  it('raises the ceiling for every material at once, so Storage is worth the same whatever fills the pool', () => {
    expect(POOL.perStorage).toBeGreaterThan(0);
    expect(Number.isInteger(POOL.perStorage)).toBe(true);
  });
});

describe('the Storages that stand', () => {
  it('raise the pool’s ceiling by the table’s amount each, and no module but Storage does', () => {
    const held = world(
      site(0, TERMINAL),
      site(1, GENERATOR),
      site(2, packState(moduleShape(MODULE.turret, 3), 2)),
    );
    const pool = new Pool(POOL.cap);
    const store = new Storehouse(held.source, pool);
    store.refresh();
    expect(store.standing).toBe(0);
    expect(pool.cap).toBe(POOL.cap);
    held.list.push(site(3, STORAGE));
    store.refresh();
    expect(store.standing).toBe(1);
    expect(pool.cap).toBe(POOL.cap + POOL.perStorage);
    // Every way of facing is the same module.
    for (const facing of [1, 2, 3]) {
      held.list.push(site(4 + facing, packState(moduleShape(MODULE.storage, facing), 1)));
    }
    store.refresh();
    expect(store.standing).toBe(4);
    expect(pool.cap).toBe(POOL.cap + 4 * POOL.perStorage);
  });

  it('take their room back when one is broken, and put it back when it is built again', () => {
    const held = world(site(0, STORAGE), site(1, STORAGE));
    const pool = new Pool(POOL.cap);
    const store = new Storehouse(held.source, pool);
    store.refresh();
    expect(pool.cap).toBe(POOL.cap + 2 * POOL.perStorage);
    held.list.pop();
    store.refresh();
    expect(pool.cap).toBe(POOL.cap + POOL.perStorage);
    held.list.length = 0;
    store.refresh();
    expect(pool.cap).toBe(POOL.cap);
    held.list.push(site(7, STORAGE));
    store.refresh();
    expect(pool.cap).toBe(POOL.cap + POOL.perStorage);
  });

  it('leave what the pool holds above a lowered ceiling where it is, and let nothing more in until it is spent down', () => {
    const held = world(site(0, STORAGE));
    const pool = new Pool(POOL.cap);
    const store = new Storehouse(held.source, pool);
    store.refresh();
    pool.set(MATERIAL.scrap, POOL.cap + POOL.perStorage);
    expect(pool.amount(MATERIAL.scrap)).toBe(POOL.cap + POOL.perStorage);
    held.list.length = 0;
    store.refresh();
    expect(pool.cap).toBe(POOL.cap);
    expect(pool.amount(MATERIAL.scrap)).toBe(POOL.cap + POOL.perStorage);
    expect(pool.room(MATERIAL.scrap)).toBe(0);
    expect(pool.add(MATERIAL.scrap, 5)).toBe(0);
    // Spending it down under the ceiling opens room again, up to the ceiling and no further.
    expect(pool.take(MATERIAL.scrap, POOL.perStorage + 10)).toBe(true);
    expect(pool.room(MATERIAL.scrap)).toBe(10);
    expect(pool.add(MATERIAL.scrap, 50)).toBe(10);
  });
});

describe('Storage in the survival simulation', () => {
  /** A run in the flat test world that sees the modules the test puts in `held`. */
  function run(held: ReturnType<typeof world>): SurvivalSim {
    const flat = flatWorld();
    return new SurvivalSim({
      core: flat.core,
      nav: flat.world,
      seed: 3,
      waves: false,
      standing: () => true,
      modules: held.source,
    });
  }

  it('starts a run at the table’s cap and raises it at the first step after a Storage is placed', () => {
    const held = world();
    const sim = run(held);
    const economy = sim.economy!;
    expect(economy.pool.cap).toBe(POOL.cap);
    sim.warp(0.05);
    expect(economy.pool.cap).toBe(POOL.cap);
    held.list.push(site(2, STORAGE));
    sim.warp(0.05);
    expect(economy.pool.cap).toBe(POOL.cap + POOL.perStorage);
    expect(economy.read(createEconomyReading()).cap).toBe(POOL.cap + POOL.perStorage);
  });

  it('lets a heap be stripped into a pool that was full once a Storage makes room, and not before', () => {
    const held = world();
    const sim = run(held);
    const economy = sim.economy!;
    const heap = economy.nodes.find((node) => node.from === 0 && node.grade === MATERIAL.scrap)!;
    economy.pool.set(MATERIAL.scrap, POOL.cap);
    sim.warp(0.05);
    expect(economy.harvest(heap.index, 1)).toEqual({ ok: false, reason: 'full' });
    held.list.push(site(2, STORAGE));
    sim.warp(0.05);
    const strip = economy.harvest(heap.index, 1);
    expect(strip.ok).toBe(true);
    expect(economy.pool.amount(MATERIAL.scrap)).toBeGreaterThan(POOL.cap);
  });

  it('does nothing where the run was given no list of modules', () => {
    const flat = flatWorld();
    const sim = new SurvivalSim({ core: flat.core, nav: flat.world, seed: 3, waves: false });
    sim.warp(1);
    expect(sim.economy!.pool.cap).toBe(POOL.cap);
  });
});
