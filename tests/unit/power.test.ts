import { describe, expect, it } from 'vitest';
import { MODULE, moduleShape, packState } from '../../src/shared/blocks';
import { PLAYER } from '../../src/shared/movement';
import { inReach, reachDistance, reachEdge } from '../../src/shared/power';
import { createVitalsReading } from '../../src/shared/vitals-state';
import { POWER, TURRET as TURRET_TABLE, VITALS } from '../../src/systems/survival/balance';
import { PowerGrid, reachOfModule } from '../../src/systems/survival/power';
import { SurvivalSim } from '../../src/systems/survival/sim';
import type { ModuleSite } from '../../src/systems/survival/turrets';
import { PlayerVitals } from '../../src/systems/survival/vitals';
import { CORE_FOOTPRINT, CORE_HEIGHT, outpostFor } from '../../src/world/outpost';

const GENERATOR = packState(moduleShape(MODULE.generator, 0), 1);
const TERMINAL = packState(moduleShape(MODULE.terminal, 0), 1);
const TURRET = packState(moduleShape(MODULE.turret, 0), 1);
const NODE = packState(moduleShape(MODULE.node, 0), 1);
const STEP = 0.05;
/** Half the height of a player: their body is measured from the middle. */
const HALF = PLAYER.height / 2;

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

/** Plays this many seconds in steps of the simulation's size. */
function play(vitals: PlayerVitals, seconds: number, generators: PowerGrid | null): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) vitals.step(STEP, null, generators);
}

/** Puts a player on the level of the cell a Generator stands in, `gap` blocks east of its middle, standing still. */
function standBeside(vitals: PlayerVitals, site: ModuleSite, gap: number): void {
  vitals.observe(site.x + 0.5 + gap, site.y + 0.5 - HALF, site.z + 0.5, 0, true);
}

describe('power by radius', () => {
  it('measures from the middle of the cell to the middle of a body', () => {
    // Feet half a body below the middle of the cell, in its column: the same point.
    expect(reachDistance(4, 10, -3, 4.5, 10.5 - HALF, -2.5)).toBeCloseTo(0, 10);
    // Three blocks east and four above: a five-block hypotenuse.
    expect(reachDistance(4, 10, -3, 7.5, 14.5 - HALF, -2.5)).toBeCloseTo(5, 10);
    // Feet on the floor of the cell are a little under the middle of the body.
    expect(reachDistance(0, 0, 0, 0.5, 0, 0.5)).toBeCloseTo(HALF - 0.5, 10);
  });

  it('reaches exactly as far as the radius, in every direction', () => {
    const near = POWER.generator.radius;
    for (const [dx, dz] of [
      [near, 0],
      [-near, 0],
      [0, near],
      [0, -near],
    ] as const) {
      expect(inReach(0, 0, 0, near, 0.5 + dx, 0.5 - HALF, 0.5 + dz)).toBe(true);
      expect(inReach(0, 0, 0, near, 0.5 + dx * 1.01, 0.5 - HALF, 0.5 + dz * 1.01)).toBe(false);
    }
  });

  it('agrees with the distance it measures', () => {
    for (const [x, y, z] of [
      [3, 1, 2],
      [-5, 0, 1],
      [0.2, 4, -4],
      [6, 0, 6],
    ] as const) {
      const d = reachDistance(0, 0, 0, x, y, z);
      expect(inReach(0, 0, 0, d + 1e-6, x, y, z)).toBe(true);
      expect(inReach(0, 0, 0, d - 1e-6, x, y, z)).toBe(false);
    }
  });

  it('counts a player on a rise above the Generator as farther from it than one on the level', () => {
    // Five blocks out on the level, and five out with the ground four blocks higher: a 6.4 block reach.
    const level = reachDistance(0, 10, 0, 5.5, 10.5 - HALF, 0.5);
    const hill = reachDistance(0, 10, 0, 5.5, 14.5 - HALF, 0.5);
    expect(level).toBeCloseTo(5, 10);
    expect(hill).toBeCloseTo(Math.hypot(5, 4), 10);
    expect(inReach(0, 10, 0, POWER.generator.radius, 5.5, 10.5 - HALF, 0.5)).toBe(true);
    expect(inReach(0, 10, 0, POWER.generator.radius, 5.5, 14.5 - HALF, 0.5)).toBe(false);
  });
});

describe('where the reach ends on the ground', () => {
  const radius = POWER.generator.radius;
  /** A Generator in the cell (4, 10, -2) with the ground under it at 10 unless the test says otherwise. */
  const cell = { x: 4, y: 10, z: -2 };
  const edge = (dirX: number, dirZ: number, ground: (x: number, z: number) => number) =>
    reachEdge(cell.x, cell.y, cell.z, radius, dirX, dirZ, ground);

  it('is a little inside the radius on level ground, where the body is above the middle of the cell', () => {
    const dy = 10 + HALF - (cell.y + 0.5);
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [Math.SQRT1_2, -Math.SQRT1_2],
    ] as const) {
      expect(edge(dx, dz, () => 10)).toBeCloseTo(Math.sqrt(radius * radius - dy * dy), 2);
    }
  });

  it('is pulled in where the ground climbs away from the cell, and where it drops', () => {
    const level = edge(1, 0, () => 10);
    const climbing = edge(1, 0, (x) => 10 + (x - 4.5) * 0.5);
    const dropping = edge(1, 0, (x) => 10 - (x - 4.5) * 0.5);
    expect(climbing).toBeLessThan(level - 0.2);
    expect(dropping).toBeLessThan(level - 0.2);
    // Down the slope the other way pulls it in as well, and along the contour it stays where it was.
    expect(edge(-1, 0, (x) => 10 + (x - 4.5) * 0.5)).toBeLessThan(level - 0.2);
    expect(edge(0, 1, (x) => 10 + (x - 4.5) * 0.5)).toBeCloseTo(level, 2);
  });

  it('puts a point on the ring in reach and a point just past it out of reach', () => {
    const slope = (x: number, z: number) => 10 + (x - 4.5) * 0.4 + (z + 1.5) * 0.1;
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      const out = edge(dirX, dirZ, slope);
      const at = (d: number) => {
        const x = cell.x + 0.5 + dirX * d;
        const z = cell.z + 0.5 + dirZ * d;
        return inReach(cell.x, cell.y, cell.z, radius, x, slope(x, z), z);
      };
      expect(at(out - 0.01)).toBe(true);
      expect(at(out + 0.01)).toBe(false);
    }
  });

  it('is nothing for a cell that hangs far above the ground', () => {
    expect(edge(1, 0, () => 10 - radius - 2)).toBe(0);
  });

  it('is the whole radius when the ground there is exactly as far from the cell as the radius', () => {
    // Ground at the height where the middle of a body is level with the middle of the cell.
    expect(edge(1, 0, () => cell.y + 0.5 - HALF)).toBe(radius);
  });
});

describe('the table of power', () => {
  it('has a Generator that reaches and gives, slower and smaller than the Core', () => {
    expect(POWER.generator.radius).toBeGreaterThan(0);
    expect(POWER.generator.perSecond).toBeGreaterThan(0);
    expect(POWER.generator.radius).toBeLessThan(VITALS.chargeField.radius);
    expect(POWER.generator.perSecond).toBeLessThan(VITALS.chargeField.perSecond);
    // It is worth standing in: it more than pays for being alive, and for running too.
    expect(POWER.generator.perSecond).toBeGreaterThan(
      VITALS.energy.idlePerSecond + VITALS.energy.sprintPerSecond,
    );
  });

  it('has a Node that carries power on farther than a Generator reaches, so a few of them cross a base', () => {
    expect(POWER.node.radius).toBeGreaterThan(POWER.generator.radius);
    expect(TURRET_TABLE.poweredRate).toBeGreaterThan(1);
  });

  it('says how far a module’s power reaches, and 0 for one that gives none', () => {
    expect(reachOfModule(MODULE.generator)).toBe(POWER.generator.radius);
    expect(reachOfModule(MODULE.node)).toBe(POWER.node.radius);
    expect(reachOfModule(MODULE.turret)).toBe(0);
    expect(reachOfModule(MODULE.terminal)).toBe(0);
    expect(reachOfModule(0)).toBe(0);
    expect(reachOfModule(99)).toBe(0);
  });
});

describe('the Generators that stand', () => {
  it('know of none in a world with no modules', () => {
    const generators = new PowerGrid(world().source);
    generators.refresh();
    expect(generators.standing).toBe(0);
    expect(generators.chargeAt(0, 0, 0)).toBe(0);
  });

  it('know of none before they have looked', () => {
    const generators = new PowerGrid(world({ x: 0, y: 0, z: 0, state: GENERATOR }).source);
    expect(generators.standing).toBe(0);
    expect(generators.chargeAt(0.5, 0, 0.5)).toBe(0);
  });

  it('count the Generators and not the other modules', () => {
    const held = world(
      { x: 0, y: 0, z: 0, state: GENERATOR },
      { x: 3, y: 0, z: 0, state: TERMINAL },
      { x: 6, y: 0, z: 0, state: TURRET },
      { x: 9, y: 0, z: 0, state: packState(moduleShape(MODULE.generator, 3), 1) },
    );
    const generators = new PowerGrid(held.source);
    generators.refresh();
    expect(generators.standing).toBe(2);
  });

  it('give what the table says to a player in reach, and nothing outside it', () => {
    const generators = new PowerGrid(world({ x: 10, y: 5, z: 10, state: GENERATOR }).source);
    generators.refresh();
    const field = POWER.generator;
    expect(generators.chargeAt(10.5, 5, 10.5)).toBe(field.perSecond);
    expect(generators.chargeAt(10.5 + field.radius - 0.5, 5.5 - HALF, 10.5)).toBe(field.perSecond);
    expect(generators.chargeAt(10.5 + field.radius + 0.5, 5.5 - HALF, 10.5)).toBe(0);
    expect(generators.chargeAt(10.5, 5 + field.radius + 1, 10.5)).toBe(0);
  });

  it('do not add up: a player in the reach of two gets what one gives', () => {
    const generators = new PowerGrid(
      world({ x: 0, y: 0, z: 0, state: GENERATOR }, { x: 2, y: 0, z: 0, state: GENERATOR }).source,
    );
    generators.refresh();
    expect(generators.standing).toBe(2);
    expect(generators.chargeAt(1.5, 0, 0.5)).toBe(POWER.generator.perSecond);
  });

  it('notice one placed or broken at the next look, and not before', () => {
    const held = world();
    const generators = new PowerGrid(held.source);
    generators.refresh();
    const site = { x: 0, y: 0, z: 0, state: GENERATOR };
    held.list.push(site);
    expect(generators.chargeAt(0.5, 0.5 - HALF, 0.5)).toBe(0);
    generators.refresh();
    expect(generators.chargeAt(0.5, 0.5 - HALF, 0.5)).toBe(POWER.generator.perSecond);
    held.list.length = 0;
    expect(generators.chargeAt(0.5, 0.5 - HALF, 0.5)).toBe(POWER.generator.perSecond);
    generators.refresh();
    expect(generators.standing).toBe(0);
    expect(generators.chargeAt(0.5, 0.5 - HALF, 0.5)).toBe(0);
  });
});

describe('a player beside a Generator', () => {
  const site = { x: 20, y: 10, z: 20, state: GENERATOR };

  function standing(): PowerGrid {
    const generators = new PowerGrid(world(site).source);
    generators.refresh();
    return generators;
  }

  it('is charged at the Generator’s pace, against the idle drain, and the HUD is told', () => {
    const vitals = new PlayerVitals();
    vitals.set({ energy: 20 });
    standBeside(vitals, site, 3);
    play(vitals, 10, standing());
    const net = POWER.generator.perSecond - VITALS.energy.idlePerSecond;
    expect(vitals.energy).toBe(Math.ceil(20 + net * 10));
    expect(vitals.charging).toBe(true);
    expect(vitals.read(createVitalsReading()).charging).toBe(true);
  });

  it('stops being charged at the edge of its reach, and drains again', () => {
    const vitals = new PlayerVitals();
    vitals.set({ energy: 50 });
    standBeside(vitals, site, POWER.generator.radius + 1);
    play(vitals, 10, standing());
    expect(vitals.charging).toBe(false);
    expect(vitals.energy).toBe(Math.ceil(50 - VITALS.energy.idlePerSecond * 10));
  });

  it('is not charged by a Generator the host has not looked for', () => {
    const vitals = new PlayerVitals();
    vitals.set({ energy: 50 });
    standBeside(vitals, site, 1);
    play(vitals, 5, new PowerGrid(world(site).source));
    expect(vitals.charging).toBe(false);
  });

  it('is not charged before the host has seen them, whatever is built', () => {
    const vitals = new PlayerVitals();
    vitals.set({ energy: 50 });
    play(vitals, 5, standing());
    expect(vitals.charging).toBe(false);
    expect(vitals.energy).toBe(Math.ceil(50 - VITALS.energy.idlePerSecond * 5));
  });

  it('is charged by the better of the two fields, not by both', () => {
    const core = outpostFor(() => 10);
    // The Core's wall is 2 blocks off and a Generator stands right there too.
    const feet = core.baseY + CORE_HEIGHT / 2 - HALF;
    const x = core.x + CORE_FOOTPRINT / 2 + 2;
    const beside = {
      x: Math.floor(x),
      y: Math.floor(core.baseY + CORE_HEIGHT / 2),
      z: Math.floor(core.z),
      state: GENERATOR,
    };
    const generators = new PowerGrid(world(beside).source);
    generators.refresh();
    const both = new PlayerVitals();
    both.set({ energy: 20 });
    both.observe(x, feet, core.z, 0, true);
    const coreOnly = new PlayerVitals();
    coreOnly.set({ energy: 20 });
    coreOnly.observe(x, feet, core.z, 0, true);
    for (let i = 0; i < 100; i++) {
      both.step(STEP, core, generators);
      coreOnly.step(STEP, core, null);
    }
    expect(generators.chargeAt(x, feet, core.z)).toBeGreaterThan(0);
    expect(both.energy).toBe(coreOnly.energy);
    expect(both.charging).toBe(true);
  });

  it('is charged by the Generator when the Core is out of reach', () => {
    const core = outpostFor(() => 10);
    const vitals = new PlayerVitals();
    vitals.set({ energy: 20 });
    // Far from the Core, beside the Generator.
    standBeside(vitals, site, 2);
    for (let i = 0; i < 100; i++) vitals.step(STEP, core, standing());
    expect(vitals.charging).toBe(true);
    expect(vitals.energy).toBeGreaterThan(20);
  });

  it('is not charged while down, as at the Core', () => {
    const vitals = new PlayerVitals();
    vitals.set({ energy: 20 });
    standBeside(vitals, site, 1);
    vitals.hurt(1000);
    play(vitals, 5, standing());
    expect(vitals.charging).toBe(false);
    expect(vitals.energy).toBe(20);
  });
});

describe('the Generators in the survival simulation', () => {
  const site: ModuleSite = { x: 5, y: 12, z: 5, state: GENERATOR };

  /** A run with no ground at all (so no machines and no Core), a world that holds the given modules, and one player beside the site. */
  function run(...sites: ModuleSite[]) {
    const held = world(...sites);
    const sim = new SurvivalSim({ modules: held.source });
    sim.addPlayer(1);
    sim.playerVitals(1)?.set({ energy: 20 });
    sim.observe(1, site.x + 0.5 + 2, site.y + 0.5 - HALF, site.z + 0.5, 0, true);
    return { held, sim };
  }
  const out = createVitalsReading();

  it('charge a player in reach, with no Core and no machines in the run', () => {
    const { sim } = run(site);
    sim.advance(2);
    sim.advance(2);
    expect(sim.readVitals(1, out)).toMatchObject({ charging: true });
    expect(sim.readVitals(1, out)?.energy).toBeGreaterThan(20);
  });

  it('charge nobody in a run that was given no list of modules', () => {
    const sim = new SurvivalSim();
    sim.addPlayer(1);
    sim.playerVitals(1)?.set({ energy: 20 });
    sim.observe(1, site.x + 2.5, site.y + 0.5 - HALF, site.z + 0.5, 0, true);
    sim.advance(2);
    expect(sim.readVitals(1, out)).toMatchObject({ charging: false });
  });

  it('charge nobody when the only modules that stand are a Terminal, a turret and a Node', () => {
    const { sim } = run(
      { ...site, state: TERMINAL },
      { ...site, x: 6, state: TURRET },
      { ...site, x: 7, state: NODE },
    );
    sim.advance(2);
    expect(sim.readVitals(1, out)).toMatchObject({ charging: false });
  });

  it('stop the moment the Generator is broken, and start the moment one is placed', () => {
    const { held, sim } = run(site);
    sim.advance(1);
    expect(sim.readVitals(1, out)).toMatchObject({ charging: true });
    held.list.length = 0;
    sim.advance(1);
    expect(sim.readVitals(1, out)).toMatchObject({ charging: false });
    held.list.push(site);
    sim.advance(1);
    expect(sim.readVitals(1, out)).toMatchObject({ charging: true });
  });

  it('follow a player out of reach: charging is on in the field and off outside it', () => {
    const { sim } = run(site);
    sim.advance(1);
    expect(sim.readVitals(1, out)).toMatchObject({ charging: true });
    sim.observe(
      1,
      site.x + 0.5 + POWER.generator.radius + 2,
      site.y + 0.5 - HALF,
      site.z + 0.5,
      0,
      true,
    );
    sim.advance(1);
    expect(sim.readVitals(1, out)).toMatchObject({ charging: false });
  });
});

describe('the grid of power', () => {
  const gen = POWER.generator.radius;
  const hop = POWER.node.radius;
  /** A module in a cell; a test may move it or change it after the grid has looked, as the world does. */
  type Standing = { -readonly [K in keyof ModuleSite]: ModuleSite[K] };
  const at = (x: number, state: number, y = 0, z = 0): Standing => ({ x, y, z, state });
  /** A grid that has looked at a world holding these modules. */
  const look = (...sites: ModuleSite[]): PowerGrid => {
    const grid = new PowerGrid(world(...sites).source);
    grid.refresh();
    return grid;
  };

  it('knows nothing before it has looked', () => {
    const grid = new PowerGrid(world(at(0, GENERATOR), at(3, TURRET)).source);
    expect(grid.powered(0, 0, 0)).toBe(false);
    expect(grid.stateAt(0, 0, 0)).toBe('none');
    expect(grid.stateAt(3, 0, 0)).toBe('none');
  });

  it('gives a Generator power of its own, standing by itself', () => {
    const grid = look(at(0, GENERATOR));
    expect(grid.powered(0, 0, 0)).toBe(true);
    expect(grid.stateAt(0, 0, 0)).toBe('on');
  });

  it('powers a turret or a Node within a Generator’s reach, from the middle of one cell to the middle of the other, and not past it', () => {
    for (const state of [TURRET, NODE]) {
      const lone = (x: number, z = 0) =>
        look(at(0, GENERATOR), at(x, state, 0, z)).stateAt(x, 0, z);
      expect(lone(gen), 'at the radius').toBe('on');
      expect(lone(gen + 1), 'a block past it').toBe('off');
      expect(lone(gen, 1), 'across and a block over').toBe('off');
      expect(lone(-gen), 'behind it').toBe('on');
    }
  });

  it('measures the reach in three dimensions, up and down as well as across', () => {
    const grid = look(
      at(0, GENERATOR),
      at(0, TURRET, gen, 0),
      at(0, TURRET, gen + 1, 3),
      at(3, TURRET, 3, 3),
      at(4, TURRET, 4, 3),
      at(0, TURRET, -gen, 6),
    );
    expect(grid.stateAt(0, gen, 0)).toBe('on');
    expect(grid.stateAt(0, gen + 1, 3)).toBe('off');
    // 3, 3 and 3 away is 5.2 blocks; 4, 4 and 3 is 6.4.
    expect(grid.stateAt(3, 3, 3)).toBe('on');
    expect(grid.stateAt(4, 4, 3)).toBe('off');
    expect(grid.stateAt(0, -gen, 6)).toBe('off');
  });

  it('lets a Node that has power carry it on, farther than the Generator reaches', () => {
    const grid = look(
      at(0, GENERATOR),
      at(gen, NODE),
      at(gen + hop, TURRET),
      at(gen + hop + 1, TURRET, 0, 2),
    );
    expect(grid.stateAt(gen, 0, 0)).toBe('on');
    expect(grid.stateAt(gen + hop, 0, 0)).toBe('on');
    expect(grid.stateAt(gen + hop + 1, 0, 2)).toBe('off');
  });

  it('carries power down a chain of Nodes, each within reach of the one before, and no farther', () => {
    const grid = look(
      at(0, GENERATOR),
      at(gen, NODE),
      at(gen + hop, NODE),
      at(gen + 2 * hop, NODE),
      at(gen + 3 * hop, TURRET),
      at(gen + 3 * hop + 1, TURRET, 0, 3),
    );
    expect(grid.stateAt(gen + 3 * hop, 0, 0)).toBe('on');
    expect(grid.stateAt(gen + 3 * hop + 1, 0, 3)).toBe('off');
  });

  it('leaves a gap in the chain dark: break the middle Node and everything past it goes off', () => {
    const middle = at(gen + hop, NODE);
    const held = world(
      at(0, GENERATOR),
      at(gen, NODE),
      middle,
      at(gen + 2 * hop, NODE),
      at(gen + 2 * hop + 4, TURRET),
    );
    const grid = new PowerGrid(held.source);
    grid.refresh();
    expect(grid.stateAt(gen + 2 * hop + 4, 0, 0)).toBe('on');
    held.list.splice(held.list.indexOf(middle), 1);
    grid.refresh();
    expect(grid.stateAt(gen + 2 * hop, 0, 0)).toBe('off');
    expect(grid.stateAt(gen + 2 * hop + 4, 0, 0)).toBe('off');
    expect(grid.stateAt(gen, 0, 0)).toBe('on');
    held.list.push(middle);
    grid.refresh();
    expect(grid.stateAt(gen + 2 * hop + 4, 0, 0)).toBe('on');
  });

  it('leaves a Node out of reach of any power dark, and the turrets round it', () => {
    const grid = look(at(0, GENERATOR), at(30, NODE), at(34, TURRET), at(30, TURRET, 0, 6));
    expect(grid.stateAt(30, 0, 0)).toBe('off');
    expect(grid.stateAt(34, 0, 0)).toBe('off');
    expect(grid.stateAt(30, 0, 6)).toBe('off');
    expect(grid.powered(30, 0, 0)).toBe(false);
  });

  it('does not let a turret pass power on: only a Generator and a Node do', () => {
    const grid = look(
      at(0, GENERATOR),
      at(gen, TURRET),
      at(gen + 4, TURRET),
      at(gen + 4, NODE, 0, 3),
    );
    expect(grid.stateAt(gen, 0, 0)).toBe('on');
    expect(grid.stateAt(gen + 4, 0, 0)).toBe('off');
    expect(grid.stateAt(gen + 4, 0, 3)).toBe('off');
  });

  it('gives power to each of two Generators’ neighbors by the nearer or the other, and a Node between two is on once', () => {
    const grid = look(
      at(0, GENERATOR),
      at(2 * gen, GENERATOR),
      at(gen, NODE),
      at(gen, TURRET, 0, 4),
    );
    expect(grid.stateAt(gen, 0, 0)).toBe('on');
    expect(grid.stateAt(gen, 0, 4)).toBe('on');
  });

  it('is the same whichever order the world lists its modules in', () => {
    const sites = [
      at(0, GENERATOR),
      at(gen, NODE),
      at(gen + hop, NODE),
      at(gen + 2 * hop, TURRET),
      at(gen + 2 * hop + 9, TURRET),
      at(40, TERMINAL),
    ];
    const forward = look(...sites);
    const backward = look(...[...sites].reverse());
    for (const { x, y, z } of sites) {
      expect(backward.stateAt(x, y, z), `cell ${x}`).toBe(forward.stateAt(x, y, z));
    }
    expect(forward.stateAt(gen + 2 * hop, 0, 0)).toBe('on');
    expect(forward.stateAt(gen + 2 * hop + 9, 0, 0)).toBe('off');
  });

  it('has no state for a Terminal or for air, and no power for them', () => {
    const grid = look(at(0, GENERATOR), at(2, TERMINAL));
    expect(grid.stateAt(2, 0, 0)).toBe('none');
    expect(grid.powered(2, 0, 0)).toBe(false);
    expect(grid.stateAt(1, 0, 0)).toBe('none');
    expect(grid.stateAt(0, 5, 0)).toBe('none');
  });

  it('gives a Node no Energy to hand to a player, however much power it has', () => {
    const grid = look(at(0, GENERATOR), at(gen, NODE));
    // Beside the Node and a block past the Generator’s reach: the Node has power, and the player nothing from it.
    expect(grid.stateAt(gen, 0, 0)).toBe('on');
    const x = gen + 0.5 + 3;
    expect(grid.chargeAt(x, 0.5 - HALF, 0.5)).toBe(0);
    expect(grid.chargeAt(0.5 + gen - 1, 0.5 - HALF, 0.5)).toBe(POWER.generator.perSecond);
  });

  it('notices a Generator broken, and the turrets it powered go off at the next look and not before', () => {
    const generator = at(0, GENERATOR);
    const held = world(generator, at(3, TURRET));
    const grid = new PowerGrid(held.source);
    grid.refresh();
    expect(grid.powered(3, 0, 0)).toBe(true);
    held.list.splice(0, 1);
    expect(grid.powered(3, 0, 0)).toBe(true);
    grid.refresh();
    expect(grid.powered(3, 0, 0)).toBe(false);
    expect(grid.stateAt(3, 0, 0)).toBe('off');
    expect(grid.standing).toBe(0);
  });

  it('notices a Node placed in a gap, and the turret beyond it comes on', () => {
    // Past the Generator’s reach and inside a Node’s, if one stood between.
    const far = gen + hop - 2;
    const held = world(at(0, GENERATOR), at(far, TURRET));
    const grid = new PowerGrid(held.source);
    grid.refresh();
    expect(grid.stateAt(far, 0, 0)).toBe('off');
    held.list.push(at(gen, NODE));
    grid.refresh();
    expect(grid.stateAt(far, 0, 0)).toBe('on');
  });

  it('notices a module that stands in another cell, or is another module, when the count is the same', () => {
    const turret = at(3, TURRET);
    const held = world(at(0, GENERATOR), turret);
    const grid = new PowerGrid(held.source);
    grid.refresh();
    expect(grid.stateAt(3, 0, 0)).toBe('on');
    // The turret is broken and another is put far away: one module in the list before, one after.
    turret.x = 40;
    grid.refresh();
    expect(grid.stateAt(3, 0, 0)).toBe('none');
    expect(grid.stateAt(40, 0, 0)).toBe('off');
    // A Terminal stands where a turret did.
    turret.x = 3;
    turret.state = TERMINAL;
    grid.refresh();
    expect(grid.stateAt(3, 0, 0)).toBe('none');
  });

  it('keeps the same answer when nothing changed, whatever level a turret has been raised to', () => {
    const turret = at(3, TURRET);
    const grid = look(at(0, GENERATOR), turret);
    expect(grid.powered(3, 0, 0)).toBe(true);
    turret.state = packState(moduleShape(MODULE.turret, 0), 3);
    grid.refresh();
    expect(grid.powered(3, 0, 0)).toBe(true);
    grid.refresh();
    expect(grid.powered(3, 0, 0)).toBe(true);
  });

  it('tells each module that takes part, and whether it has power, and not the Terminal', () => {
    const grid = look(at(0, GENERATOR), at(3, NODE), at(50, TURRET), at(2, TERMINAL, 0, 5));
    const seen: [number, number, number, boolean][] = [];
    grid.forEach((x, y, z, on) => seen.push([x, y, z, on]));
    expect(seen).toEqual([
      [0, 0, 0, true],
      [3, 0, 0, true],
      [50, 0, 0, false],
    ]);
  });

  it('is empty in a world with no modules', () => {
    const grid = look();
    const seen: number[] = [];
    grid.forEach((x) => seen.push(x));
    expect(seen).toEqual([]);
    expect(grid.stateAt(0, 0, 0)).toBe('none');
    expect(grid.standing).toBe(0);
  });
});
