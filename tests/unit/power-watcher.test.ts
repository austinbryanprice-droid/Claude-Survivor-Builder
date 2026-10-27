import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import { PowerWatcher } from '../../src/app/power-watcher';
import { MODULE, moduleShape, packState } from '../../src/shared/blocks';
import { POWER } from '../../src/systems/survival/balance';
import { ModuleRenderer } from '../../src/world/render/module-render';
import { createWorld } from '../../src/world/voxels/world';
import { createTestRegistry } from './helpers/registry';
import { TEST_SEED, terrain } from './helpers/valley';

const generator = packState(moduleShape(MODULE.generator, 0), 1);
const node = packState(moduleShape(MODULE.node, 0), 1);
const turret = (level = 1) => packState(moduleShape(MODULE.turret, 0), level);
const terminal = packState(moduleShape(MODULE.terminal, 0), 1);

/** A world with a renderer drawing its modules and a watcher dressing them for the power they have. */
function rig() {
  const world = createWorld(TEST_SEED, terrain());
  const renderer = new ModuleRenderer(new Group(), createTestRegistry(), world);
  const watcher = new PowerWatcher(world, renderer);
  const y = Math.floor(world.terrain.grid.groundAt(8.5, -3.5));
  /** The cell `dx` blocks east of the spot where the tests build, on its row. */
  const cell = (dx: number) => ({ x: 8 + dx, y, z: -4 });
  const put = (dx: number, state: number) => {
    const { x, z } = cell(dx);
    world.setBlock(x, y, z, state);
  };
  const lit = (dx: number) => renderer.isPowered(8 + dx, y, -4);
  const state = (dx: number) => watcher.stateAt(8 + dx, y, -4);
  return { world, renderer, watcher, put, lit, state, cell };
}

describe('the lights of a turret, as the power around it says', () => {
  it('are down for a turret with no Generator near, and up beside one', () => {
    const r = rig();
    r.put(0, turret());
    expect(r.state(0)).toBe('off');
    expect(r.lit(0)).toBe(false);
    r.put(3, generator);
    expect(r.state(0)).toBe('on');
    expect(r.lit(0)).toBe(true);
    expect(r.lit(3)).toBe(true);
  });

  it('go down again the moment the Generator is broken, and up when it is put back', () => {
    const r = rig();
    r.put(0, turret());
    r.put(3, generator);
    expect(r.lit(0)).toBe(true);
    r.put(3, 0);
    expect(r.state(0)).toBe('off');
    expect(r.lit(0)).toBe(false);
    r.put(3, generator);
    expect(r.lit(0)).toBe(true);
  });

  it('are down for a turret past the Generator’s reach', () => {
    const r = rig();
    r.put(0, turret());
    r.put(POWER.generator.radius + 1, generator);
    expect(r.lit(0)).toBe(false);
    r.put(POWER.generator.radius + 1, 0);
    r.put(POWER.generator.radius, generator);
    expect(r.lit(0)).toBe(true);
  });

  it('are put down again for a turret that is raised, which is drawn again with its lights up', () => {
    const r = rig();
    r.put(0, turret(1));
    expect(r.lit(0)).toBe(false);
    r.put(0, turret(2));
    expect(r.state(0)).toBe('off');
    expect(r.lit(0)).toBe(false);
    r.put(0, turret(3));
    expect(r.lit(0)).toBe(false);
  });

  it('stay up for a raised turret that has power', () => {
    const r = rig();
    r.put(0, turret(1));
    r.put(3, generator);
    r.put(0, turret(2));
    expect(r.lit(0)).toBe(true);
  });
});

describe('the lights of a Power Node', () => {
  it('carry power on: a turret past the Generator’s reach is lit through a Node between', () => {
    const r = rig();
    const gap = POWER.generator.radius;
    r.put(0, generator);
    r.put(gap + POWER.node.radius, turret());
    expect(r.lit(gap + POWER.node.radius)).toBe(false);
    r.put(gap, node);
    expect(r.state(gap)).toBe('on');
    expect(r.lit(gap)).toBe(true);
    expect(r.state(gap + POWER.node.radius)).toBe('on');
    expect(r.lit(gap + POWER.node.radius)).toBe(true);
  });

  it('are down for a Node nothing reaches, and a turret beside it gets nothing from it', () => {
    const r = rig();
    r.put(0, generator);
    r.put(POWER.generator.radius + 1, node);
    r.put(POWER.generator.radius + 3, turret());
    expect(r.state(POWER.generator.radius + 1)).toBe('off');
    expect(r.lit(POWER.generator.radius + 1)).toBe(false);
    expect(r.lit(POWER.generator.radius + 3)).toBe(false);
  });

  it('go down all along the chain when the Generator is broken', () => {
    const r = rig();
    r.put(0, generator);
    r.put(5, node);
    r.put(10, node);
    r.put(14, turret());
    expect([5, 10, 14].map((dx) => r.lit(dx))).toEqual([true, true, true]);
    r.put(0, 0);
    expect([5, 10, 14].map((dx) => r.lit(dx))).toEqual([false, false, false]);
  });
});

describe('the modules that take no part', () => {
  it('are never dim: a Generator has power of its own and a Terminal has none to lose', () => {
    const r = rig();
    r.put(0, generator);
    r.put(2, terminal);
    expect(r.lit(0)).toBe(true);
    expect(r.lit(2)).toBe(true);
    r.put(0, 0);
    expect(r.lit(2)).toBe(true);
    expect(r.state(2)).toBe('none');
  });

  it('say nothing of a cell with no module in it', () => {
    const r = rig();
    expect(r.state(0)).toBe('none');
    expect(r.lit(0)).toBeNull();
    r.put(0, packState(0, 1));
    expect(r.state(0)).toBe('none');
  });
});

describe('a watcher made late', () => {
  it('dresses the modules that already stand, as a player who joins a base meets them', () => {
    const world = createWorld(TEST_SEED, terrain());
    const y = Math.floor(world.terrain.grid.groundAt(8.5, -3.5));
    world.setBlock(8, y, -4, turret());
    world.setBlock(10, y, -4, turret());
    world.setBlock(12, y, -4, generator);
    const renderer = new ModuleRenderer(new Group(), createTestRegistry(), world);
    const watcher = new PowerWatcher(world, renderer);
    // Both turrets are inside the Generator's six blocks.
    expect(renderer.isPowered(8, y, -4)).toBe(true);
    expect(renderer.isPowered(10, y, -4)).toBe(true);
    expect(watcher.stateAt(8, y, -4)).toBe('on');
    world.setBlock(12, y, -4, 0);
    expect(renderer.isPowered(8, y, -4)).toBe(false);
    expect(renderer.isPowered(10, y, -4)).toBe(false);
  });

  it('leaves a world with no modules alone', () => {
    const r = rig();
    expect(r.renderer.count).toBe(0);
    expect(r.watcher.stateAt(0, 0, 0)).toBe('none');
  });
});

describe('putting the watcher away', () => {
  it('stops it listening: the lights stay as they were', () => {
    const r = rig();
    r.put(0, turret());
    expect(r.lit(0)).toBe(false);
    r.watcher.dispose();
    r.put(3, generator);
    expect(r.lit(0)).toBe(false);
  });
});
