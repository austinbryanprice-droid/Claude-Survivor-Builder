import { describe, expect, it } from 'vitest';
import { MODULE, moduleShape, packState } from '../../src/shared/blocks';
import { PowerFlips } from '../../src/systems/survival/power-flips';
import { PowerGrid } from '../../src/systems/survival/power';
import type { ModuleSite } from '../../src/systems/survival/turrets';

const GENERATOR = packState(moduleShape(MODULE.generator, 0), 1);
const TURRET = packState(moduleShape(MODULE.turret, 0), 1);
const NODE = packState(moduleShape(MODULE.node, 0), 1);

const site = (state: number, x: number): ModuleSite => ({ x, y: 4, z: 7, state });

/** A world of modules and the grid that works out their power, looked at through `flips`. */
function crew(...sites: ModuleSite[]) {
  const list = [...sites];
  const grid = new PowerGrid((visit) => list.forEach(visit));
  const flips = new PowerFlips();
  const look = () => {
    grid.refresh();
    return flips.look((visit) => grid.forEach(visit)).map((flip) => ({ ...flip }));
  };
  return { list, look };
}

describe('the modules that come on and go dark', () => {
  it('only learns how things stand at the first look', () => {
    const { look } = crew(site(GENERATOR, 0), site(TURRET, 3), site(TURRET, 40));
    expect(look()).toEqual([]);
  });

  it('says nothing while nothing changes', () => {
    const { look } = crew(site(GENERATOR, 0), site(TURRET, 3));
    look();
    expect(look()).toEqual([]);
    expect(look()).toEqual([]);
  });

  it('reports a turret that goes dark when the Generator is taken away, once', () => {
    const { list, look } = crew(site(GENERATOR, 0), site(TURRET, 3), site(TURRET, 40));
    look();
    list.splice(0, 1);
    expect(look()).toEqual([{ x: 3, y: 4, z: 7, on: false }]);
    expect(look()).toEqual([]);
  });

  it('reports every module a new Generator lights, and a Node that carries it on', () => {
    const { list, look } = crew(site(NODE, 6), site(TURRET, 12), site(TURRET, 14));
    look();
    list.push(site(GENERATOR, 2));
    const lit = look();
    // The Generator itself was just set down: it did not change, it came.
    expect(lit.map((flip) => flip.x).sort((a, b) => a - b)).toEqual([6, 12, 14]);
    expect(lit.every((flip) => flip.on)).toBe(true);
  });

  it('does not count a module that was just set down or just broken', () => {
    const { list, look } = crew(site(GENERATOR, 0), site(TURRET, 3));
    look();
    list.push(site(TURRET, 4));
    expect(look()).toEqual([]);
    list.pop();
    expect(look()).toEqual([]);
  });

  it('follows a module that goes dark and comes back', () => {
    const { list, look } = crew(site(GENERATOR, 0), site(TURRET, 3));
    look();
    const [generator] = list.splice(0, 1) as [ModuleSite];
    expect(look().map((flip) => flip.on)).toEqual([false]);
    list.unshift(generator);
    expect(look().map((flip) => flip.on)).toEqual([true]);
  });
});
