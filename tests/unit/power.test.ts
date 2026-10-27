import { describe, expect, it } from 'vitest';
import { MODULE, moduleShape, packState } from '../../src/shared/blocks';
import { PLAYER } from '../../src/shared/movement';
import { inReach, reachDistance, reachEdge } from '../../src/shared/power';
import { createVitalsReading } from '../../src/shared/vitals-state';
import { POWER, VITALS } from '../../src/systems/survival/balance';
import { Generators } from '../../src/systems/survival/power';
import { SurvivalSim } from '../../src/systems/survival/sim';
import type { ModuleSite } from '../../src/systems/survival/turrets';
import { PlayerVitals } from '../../src/systems/survival/vitals';
import { CORE_FOOTPRINT, CORE_HEIGHT, outpostFor } from '../../src/world/outpost';

const GENERATOR = packState(moduleShape(MODULE.generator, 0), 1);
const TERMINAL = packState(moduleShape(MODULE.terminal, 0), 1);
const TURRET = packState(moduleShape(MODULE.turret, 0), 1);
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
function play(vitals: PlayerVitals, seconds: number, generators: Generators | null): void {
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
});

describe('the Generators that stand', () => {
  it('know of none in a world with no modules', () => {
    const generators = new Generators(world().source);
    generators.refresh();
    expect(generators.standing).toBe(0);
    expect(generators.chargeAt(0, 0, 0)).toBe(0);
  });

  it('know of none before they have looked', () => {
    const generators = new Generators(world({ x: 0, y: 0, z: 0, state: GENERATOR }).source);
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
    const generators = new Generators(held.source);
    generators.refresh();
    expect(generators.standing).toBe(2);
  });

  it('give what the table says to a player in reach, and nothing outside it', () => {
    const generators = new Generators(world({ x: 10, y: 5, z: 10, state: GENERATOR }).source);
    generators.refresh();
    const field = POWER.generator;
    expect(generators.chargeAt(10.5, 5, 10.5)).toBe(field.perSecond);
    expect(generators.chargeAt(10.5 + field.radius - 0.5, 5.5 - HALF, 10.5)).toBe(field.perSecond);
    expect(generators.chargeAt(10.5 + field.radius + 0.5, 5.5 - HALF, 10.5)).toBe(0);
    expect(generators.chargeAt(10.5, 5 + field.radius + 1, 10.5)).toBe(0);
  });

  it('do not add up: a player in the reach of two gets what one gives', () => {
    const generators = new Generators(
      world({ x: 0, y: 0, z: 0, state: GENERATOR }, { x: 2, y: 0, z: 0, state: GENERATOR }).source,
    );
    generators.refresh();
    expect(generators.standing).toBe(2);
    expect(generators.chargeAt(1.5, 0, 0.5)).toBe(POWER.generator.perSecond);
  });

  it('notice one placed or broken at the next look, and not before', () => {
    const held = world();
    const generators = new Generators(held.source);
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

  function standing(): Generators {
    const generators = new Generators(world(site).source);
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
    play(vitals, 5, new Generators(world(site).source));
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
    const generators = new Generators(world(beside).source);
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

  it('charge nobody when the only module that stands is a Terminal or a turret', () => {
    const { sim } = run({ ...site, state: TERMINAL }, { ...site, x: 6, state: TURRET });
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
