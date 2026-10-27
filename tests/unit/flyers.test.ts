import { describe, expect, it } from 'vitest';
import {
  ENEMY_FLAG,
  ENEMY_KIND,
  createEnemyState,
  type EnemyState,
} from '../../src/shared/enemy-state';
import { SIM_STEP_SECONDS } from '../../src/shared/survival-state';
import { ENEMIES } from '../../src/systems/survival/balance';
import { EnemySim, type Strikes, type Target } from '../../src/systems/survival/enemies';
import { NavGrid, type NavCell } from '../../src/systems/survival/nav';
import { flatWorld, type FlatOptions } from './helpers/nav-world';

const FLYER = ENEMIES.flyer;
const { hover: HOVER } = FLYER.flies;
const GROUND = 10;
const FLYING = ENEMY_KIND.flyer;

/** The machines of a field of flat ground at 10 (or the terrain given), the targets they go after and the blows they strike. */
function sky(options?: FlatOptions, seed = 7) {
  const flat = flatWorld(options);
  const nav = new NavGrid(flat.world, flat.core);
  const sim = new EnemySim(nav, { core: flat.core, seed });
  const core: number[] = [];
  const players: [number, number][] = [];
  const targets: Target[] = [];
  const strikes: Strikes = {
    hurtPlayer(id, amount) {
      players.push([id, amount]);
      return amount;
    },
    hurtCore(amount) {
      core.push(amount);
      return false;
    },
  };
  const states = Array.from({ length: ENEMIES.maxAlive }, createEnemyState);
  const where = (): EnemyState[] => {
    const n = sim.write(states);
    return states.slice(0, n).map((state) => ({ ...state }));
  };
  return {
    flat,
    nav,
    sim,
    core,
    players,
    targets,
    where,
    /** Plays this many seconds, calling `watch` with the machines after every step. */
    run(seconds: number, watch?: (machines: EnemyState[]) => void): void {
      const steps = Math.round(seconds / SIM_STEP_SECONDS);
      for (let i = 0; i < steps; i++) {
        sim.step(SIM_STEP_SECONDS, targets, targets.length, strikes);
        if (watch) watch(where());
      }
    },
  };
}

/** A wall of the crew's blocks: `height` rows from the ground, along a line of cells in x or in z. */
function wall(
  f: ReturnType<typeof sky>,
  from: { x: number; z: number },
  to: { x: number; z: number },
  height: number,
  base = GROUND,
): void {
  for (let x = from.x; x <= to.x; x++) {
    for (let z = from.z; z <= to.z; z++) {
      for (let y = base; y < base + height; y++) {
        f.flat.place(x, y, z);
        f.sim.blockChanged(x, y, z);
      }
    }
  }
}

/** How far a point is from the Core's walls, sideways, in blocks. */
function awayFromCore(f: ReturnType<typeof sky>, e: EnemyState): number {
  const core = f.flat.core;
  const dx = Math.max(core.cellX - e.x, 0, e.x - (core.cellX + 3));
  const dz = Math.max(core.cellZ - e.z, 0, e.z - (core.cellZ + 3));
  return Math.hypot(dx, dz);
}

describe('the flying skimmer’s coming', () => {
  it('is anywhere on the ring, over a lake where nothing could walk, at its hover height over the water', () => {
    const lake = (x: number, z: number): number =>
      Math.hypot(x + 1.5, z + 3.5) > 12 ? -5 : GROUND;
    const f = sky({ height: lake, waterLevel: 0 });
    // Walkers have nowhere to stand on the ring.
    expect(f.sim.spawn(5)).toBe(0);
    expect(f.sim.spawn(5, 1, undefined, FLYING)).toBe(5);
    const machines = f.where();
    expect(machines).toHaveLength(5);
    for (const machine of machines) {
      const radius = Math.hypot(machine.x - f.flat.core.x, machine.z - f.flat.core.z);
      expect(radius).toBeGreaterThanOrEqual(ENEMIES.spawnRadius - ENEMIES.spawnJitter - 0.01);
      expect(radius).toBeLessThanOrEqual(ENEMIES.spawnRadius + ENEMIES.spawnJitter + 0.01);
      expect(machine.kind).toBe(FLYING);
      // Over the surface of the water, not the lake bed under it.
      expect(machine.y).toBeCloseTo(0 + HOVER, 6);
    }
  });

  it('is at its hover height over level ground, and anywhere on the map for a machine that is put, but not off it', () => {
    const f = sky();
    const id = f.sim.spawnAt(f.flat.core.x - 20, f.flat.core.z + 5, 1, FLYING);
    expect(id).not.toBeNull();
    expect(f.where()[0]?.y).toBeCloseTo(GROUND + HOVER, 6);
    // A spot where a walker cannot be put: inside a block of the crew's wall.
    f.flat.place(-30, GROUND, 0);
    f.sim.blockChanged(-30, GROUND, 0);
    expect(f.sim.spawnAt(-29.5, 0.5, 1, ENEMY_KIND.crawler)).toBeNull();
    expect(f.sim.spawnAt(-29.5, 0.5, 1, FLYING)).not.toBeNull();
    // Off the map there is nothing to fly over.
    expect(f.sim.spawnAt(f.flat.core.x + 500, f.flat.core.z, 1, FLYING)).toBeNull();
  });
});

describe('the flying skimmer’s way', () => {
  it('is straight to the Core over a lake, a ridge too steep to climb and a wall, chewing nothing', () => {
    const terrain = (x: number): number => {
      if (x < -31) return GROUND;
      if (x < -28) return GROUND + 8;
      if (x < -20) return -5;
      return GROUND;
    };
    const f = sky({ height: (x) => terrain(x), waterLevel: 0 });
    wall(f, { x: -12, z: -30 }, { x: -12, z: 24 }, 4);
    // There is no way a walker could go from there to the Core.
    expect(f.nav.costAt(-36.5, -3.5)).toBe(Infinity);
    f.sim.spawnAt(-36.5, -3.5, 1, FLYING);
    f.run(9);
    const [there] = f.where();
    expect(awayFromCore(f, there as EnemyState)).toBeLessThanOrEqual(FLYER.reach.core + 0.3);
    f.run(4);
    // It has begun to zap the Core, and no block was chewed on the way.
    expect(f.core.length).toBeGreaterThan(0);
    expect(f.core.every((amount) => amount === FLYER.bite.core)).toBe(true);
    const broken: NavCell[] = [];
    f.sim.drainBreaks(broken);
    expect(broken).toEqual([]);
  });

  it('is up and over a wall as it comes to it, clear of the top, and back down after', () => {
    const f = sky();
    wall(f, { x: -12, z: -30 }, { x: -12, z: 24 }, 5);
    const top = GROUND + 5;
    f.sim.spawnAt(-40.5, -3.5, 1, FLYING);
    let lowestOver = Infinity;
    let highest = 0;
    f.run(12, ([machine]) => {
      const m = machine as EnemyState;
      highest = Math.max(highest, m.y);
      // Over the wall, or near enough that its hull would touch it.
      if (m.x > -12 - FLYER.radius && m.x < -11 + FLYER.radius)
        lowestOver = Math.min(lowestOver, m.y);
    });
    expect(lowestOver).toBeGreaterThanOrEqual(top);
    expect(highest).toBeLessThanOrEqual(top + HOVER + 1e-6);
    expect(highest).toBeGreaterThan(top + HOVER - 0.5);
    // Past the wall it has sunk back to the height it keeps over the ground.
    expect((f.where()[0] as EnemyState).y).toBeCloseTo(GROUND + HOVER, 6);
  });

  it('sinks and rises no faster than it can climb', () => {
    const f = sky();
    wall(f, { x: -12, z: -30 }, { x: -12, z: 24 }, 12);
    f.sim.spawnAt(-30.5, -3.5, 1, FLYING);
    let before = (f.where()[0] as EnemyState).y;
    let fastest = 0;
    f.run(10, ([machine]) => {
      const m = machine as EnemyState;
      fastest = Math.max(fastest, Math.abs(m.y - before) / SIM_STEP_SECONDS);
      before = m.y;
    });
    expect(fastest).toBeGreaterThan(FLYER.flies.climb * 0.9);
    expect(fastest).toBeLessThanOrEqual(FLYER.flies.climb + 1e-6);
  });

  it('keeps its height beside the Core and zaps it from there, not from over it', () => {
    const f = sky();
    f.sim.spawnAt(f.flat.core.x - 14, f.flat.core.z, 1, FLYING);
    const heights: number[] = [];
    f.run(8, ([machine]) => {
      const m = machine as EnemyState;
      if (m.flags & ENEMY_FLAG.attack) heights.push(m.y);
    });
    // It stopped at its reach from the Core's wall and began a zap, at the height it flies at.
    expect(heights.length).toBeGreaterThan(0);
    for (const y of heights) expect(y).toBeCloseTo(GROUND + HOVER, 6);
    const [machine] = f.where();
    expect(awayFromCore(f, machine as EnemyState)).toBeGreaterThan(FLYER.reach.core - 0.5);
    expect(awayFromCore(f, machine as EnemyState)).toBeLessThanOrEqual(FLYER.reach.core);
    // Eight seconds: the first zap after its wind-up, then one every 1.3 seconds.
    expect(f.core.length).toBeGreaterThanOrEqual(3);
    expect(f.core.every((amount) => amount === FLYER.bite.core)).toBe(true);
  });

  it('goes on following the land while it zaps: a tower raised under it lifts it', () => {
    const f = sky();
    f.sim.spawnAt(f.flat.core.x - 14, f.flat.core.z, 1, FLYING);
    f.run(7);
    expect(f.core.length).toBeGreaterThan(0);
    const [there] = f.where() as [EnemyState];
    expect(there.y).toBeCloseTo(GROUND + HOVER, 6);
    const struck = f.core.length;
    for (let y = GROUND; y < GROUND + 6; y++) {
      f.flat.place(Math.floor(there.x), y, Math.floor(there.z));
      f.sim.blockChanged(Math.floor(there.x), y, Math.floor(there.z));
    }
    f.run(1.5);
    // Lifted on its tower, still at its post, and zapping on.
    const [lifted] = f.where() as [EnemyState];
    expect(lifted.y).toBeCloseTo(GROUND + 6 + HOVER, 6);
    expect(Math.hypot(lifted.x - there.x, lifted.z - there.z)).toBeLessThan(0.01);
    f.run(3);
    expect(f.core.length).toBeGreaterThan(struck);
  });

  it('rises to clear the Core if something pushes it over the Core', () => {
    const f = sky();
    const core = f.flat.core;
    f.sim.spawnAt(core.x, core.z, 1, FLYING);
    f.run(1);
    // The Core is four blocks high: it hovers over the top of it.
    expect((f.where()[0] as EnemyState).y).toBeCloseTo(GROUND + 4 + HOVER, 6);
  });
});

describe('the flying skimmer’s prey', () => {
  it('is the nearest player in its pull, over a wall, and not one beyond it', () => {
    // A wall of five blocks between a skimmer and a player 7.5 blocks north of it; the Core is east.
    const near = sky();
    wall(near, { x: -40, z: 6 }, { x: 10, z: 6 }, 5);
    near.targets.push({ id: 3, x: -24, y: GROUND, z: 10 });
    near.sim.spawnAt(-24.5, 2.5, 1, FLYING);
    near.run(4);
    const [skimmer] = near.where();
    expect(
      Math.hypot((skimmer as EnemyState).x + 24, (skimmer as EnemyState).z - 10),
    ).toBeLessThanOrEqual(FLYER.reach.player);
    expect(near.players.length).toBeGreaterThan(0);
    expect(near.players.every(([id, amount]) => id === 3 && amount === FLYER.bite.player)).toBe(
      true,
    );

    // A walker at the same spot cannot walk to the player in a line, so it does not go for them.
    const walker = sky();
    wall(walker, { x: -40, z: 6 }, { x: 10, z: 6 }, 5);
    walker.targets.push({ id: 3, x: -24, y: GROUND, z: 10 });
    walker.sim.spawnAt(-24.5, 2.5, 1, ENEMY_KIND.crawler);
    walker.run(4);
    expect((walker.where()[0] as EnemyState).z).toBeLessThan(6);
    expect(walker.players).toEqual([]);

    // A player past its pull is not gone after: it goes for the Core, to the east and south.
    const far = sky();
    far.targets.push({ id: 3, x: -24, y: GROUND, z: 2.5 + FLYER.aggro + 1.5 });
    far.sim.spawnAt(-24.5, 2.5, 1, FLYING);
    far.run(2);
    const [gone] = far.where();
    expect((gone as EnemyState).x).toBeGreaterThan(-24.5 + 3);
    expect((gone as EnemyState).z).toBeLessThan(2.5);
    expect(far.players).toEqual([]);
  });

  it('goes for the nearer of two players, and keeps to its choice a little past the pull', () => {
    const f = sky();
    f.targets.push({ id: 5, x: -20, y: GROUND, z: 8 }, { id: 6, x: -20, y: GROUND, z: -14 });
    f.sim.spawnAt(-20.5, -2.5, 1, FLYING);
    f.run(0.5);
    // Player 5 is 10.5 away, player 6 is 11.5: neither is in its pull of 10, and it heads for the Core.
    const [first] = f.where();
    expect((first as EnemyState).z).toBeLessThan(-2.5);
    // Player 5 walks to 9 blocks away and is chosen, being the nearer.
    f.targets[0] = { id: 5, x: -20, y: GROUND, z: 6 };
    f.run(1);
    const [second] = f.where();
    expect((second as EnemyState).z).toBeGreaterThan((first as EnemyState).z);
    // Player 5 backs off to 12 blocks, which is inside the pull it keeps on a player it has chosen (13).
    f.targets[0] = { id: 5, x: -20, y: GROUND, z: -2.5 + 12 };
    const before = (f.where()[0] as EnemyState).z;
    f.run(0.5);
    expect((f.where()[0] as EnemyState).z).toBeGreaterThan(before);
  });

  it('is zapped from above while the player is within its reach down, and not past it', () => {
    const inReach = sky();
    inReach.sim.spawnAt(-20.5, 0.5, 1, FLYING);
    const hull = (inReach.where()[0] as EnemyState).y;
    inReach.targets.push({ id: 4, x: -20, y: hull - FLYER.reach.height + 0.1, z: 1.5 });
    inReach.run(4);
    // Zaps at 0.45, 1.75 and 3.05 seconds: a wind-up, then one every 1.3 seconds.
    expect(inReach.players).toEqual([
      [4, FLYER.bite.player],
      [4, FLYER.bite.player],
      [4, FLYER.bite.player],
    ]);

    const tooLow = sky();
    tooLow.sim.spawnAt(-20.5, 0.5, 1, FLYING);
    tooLow.targets.push({ id: 4, x: -20, y: hull - FLYER.reach.height - 0.1, z: 1.5 });
    tooLow.run(6);
    expect(tooLow.players).toEqual([]);
  });

  it('is kept out of reach by a roof, over a player it hovers above and cannot touch', () => {
    const bareField = sky();
    bareField.targets.push({ id: 3, x: -20, y: GROUND, z: 0 });
    bareField.sim.spawnAt(-28.5, 0.5, 1, FLYING);
    bareField.run(8);
    expect(bareField.players.length).toBeGreaterThan(0);

    // A roof one block thick, two blocks over the player's feet and five blocks across.
    const roofed = sky();
    wall(roofed, { x: -22, z: -2 }, { x: -18, z: 2 }, 1, GROUND + 2);
    roofed.targets.push({ id: 3, x: -20, y: GROUND, z: 0 });
    roofed.sim.spawnAt(-28.5, 0.5, 1, FLYING);
    roofed.run(12);
    expect(roofed.players).toEqual([]);
    const [over] = roofed.where();
    expect((over as EnemyState).y).toBeCloseTo(GROUND + 3 + HOVER, 6);
    expect(Math.hypot((over as EnemyState).x + 20, (over as EnemyState).z)).toBeLessThan(0.5);
  });
});

describe('the flying skimmer’s company', () => {
  it('passes over the machines that walk, and spreads from the others that fly', () => {
    const mixed = sky();
    mixed.sim.spawnAt(-20.5, 0.5, 1, ENEMY_KIND.crawler);
    mixed.sim.spawnAt(-20.5, 0.5, 1, FLYING);
    mixed.run(0.05);
    const [walker, flyer] = mixed.where() as [EnemyState, EnemyState];
    // Both set off along the same line, a part of a block apart at most: neither pushed the other away.
    expect(Math.hypot(walker.x - flyer.x, walker.z - flyer.z)).toBeLessThan(0.2);

    const pair = sky();
    pair.sim.spawnAt(-20.5, 0.5, 1, FLYING);
    pair.sim.spawnAt(-20.5, 0.5, 1, FLYING);
    pair.run(0.05);
    const [a, b] = pair.where() as [EnemyState, EnemyState];
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(FLYER.radius);
    // Pushed apart sideways, they are not pushed into the ground or off their height.
    expect(a.y).toBeCloseTo(GROUND + HOVER, 6);
    expect(b.y).toBeCloseTo(GROUND + HOVER, 6);
  });

  it('falls to a blow like any machine: all the points of it, once, and the kind is told', () => {
    const f = sky();
    const felled: number[] = [];
    f.sim.onFelled = (kind) => felled.push(kind);
    const id = f.sim.spawnAt(-20.5, 0.5, 1, FLYING) as number;
    expect(f.sim.hurt(id, FLYER.health - 0.1)).toBe(false);
    expect(f.sim.hurt(id, 0.2)).toBe(true);
    expect(felled).toEqual([FLYING]);
    expect(f.sim.has(id)).toBe(false);
  });
});
