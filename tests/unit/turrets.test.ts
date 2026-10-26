import { describe, expect, it } from 'vitest';
import { MODULE, moduleShape, packState } from '../../src/shared/blocks';
import { SHOT_FLAG } from '../../src/shared/shot';
import { createReading, nightStart } from '../../src/shared/survival-state';
import { TURRET_GUN, turretMuzzle } from '../../src/shared/turret';
import { BLASTER, ENEMIES, TURRET } from '../../src/systems/survival/balance';
import { SurvivalSim } from '../../src/systems/survival/sim';
import { turretLevel, type ModuleSite, type TurretShot } from '../../src/systems/survival/turrets';
import { SCRAP, flatWorld } from './helpers/nav-world';

const FLOOR = 10;
const TURRET_STATE = packState(moduleShape(MODULE.turret, 0), 1);
const TERMINAL_STATE = packState(moduleShape(MODULE.terminal, 0), 1);
/** Steps in a second of the run. */
const STEP = 0.05;

/**
 * A run on flat ground at 10 with the Core, and a list of the modules the world holds. A turret
 * stands 8 blocks west of the Core's middle, and crawlers are put at a distance from it.
 */
function field(options: { waves?: boolean } = {}) {
  const flat = flatWorld({ height: () => FLOOR });
  const sites: ModuleSite[] = [];
  const sim = new SurvivalSim({
    core: flat.core,
    nav: flat.world,
    seed: 9,
    startAt: nightStart(1),
    waves: options.waves ?? false,
    ray: {
      blocks: { getBlock: (x, y, z) => flat.cells.get(x, y, z) },
      ground: { distance: (_x, y) => y - FLOOR },
    },
    modules: (visit) => {
      for (const site of sites) visit(site);
    },
  });
  const machines = sim.enemies!;
  const cx = Math.floor(flat.core.x);
  const cz = Math.floor(flat.core.z);
  const base = { x: cx - 8, y: FLOOR, z: cz };
  /** Stands a module in a cell: in the world as a block, and in the list the simulation walks. */
  const stand = (x: number, z: number, state = TURRET_STATE, y = FLOOR): ModuleSite => {
    const site = { x, y, z, state };
    sites.push(site);
    flat.place(x, y, z, state);
    return site;
  };
  /** Takes a module away, as breaking it does. */
  const remove = (site: ModuleSite): void => {
    sites.splice(sites.indexOf(site), 1);
    flat.remove(site.x, site.y, site.z);
  };
  /** Puts a crawler `west` blocks west of the Core's middle, level with it. */
  const crawler = (west: number, dz = 0): number => {
    const id = machines.spawnAt(flat.core.x - west, flat.core.z + dz);
    expect(id).not.toBeNull();
    return id as number;
  };
  /** Plays `steps` steps and returns the shots the turrets fired in them. */
  const play = (steps: number): TurretShot[] => {
    const shots: TurretShot[] = [];
    for (let i = 0; i < steps; i++) {
      sim.warp(STEP);
      sim.drainTurretShots(shots);
    }
    return shots;
  };
  return { flat, sim, machines, base, stand, remove, crawler, play, cx, cz };
}

describe('the turret table', () => {
  it('has a first level that sees, hurts and waits', () => {
    const level = turretLevel(1);
    expect(level.range).toBeGreaterThan(0);
    expect(level.damage).toBeGreaterThan(0);
    expect(level.interval).toBeGreaterThan(0);
    expect(TURRET.tries).toBeGreaterThanOrEqual(1);
  });

  it('is the last level it has for a level the table does not have, and the first for a level below it', () => {
    const last = TURRET.levels[TURRET.levels.length - 1];
    expect(turretLevel(99)).toBe(last);
    expect(turretLevel(0)).toBe(TURRET.levels[0]);
    expect(turretLevel(-3)).toBe(TURRET.levels[0]);
    expect(turretLevel(1.9)).toBe(TURRET.levels[0]);
  });

  it('does a little over a third of what the blaster does a second, so a crew still plays', () => {
    const level = turretLevel(1);
    const blaster = BLASTER.damage / BLASTER.interval;
    expect(level.damage / level.interval).toBeGreaterThan(blaster * 0.25);
    expect(level.damage / level.interval).toBeLessThan(blaster * 0.5);
  });
});

describe('the muzzle of a turret', () => {
  it('lies the gun’s reach from the head’s pivot, toward the target', () => {
    const out = { x: 0, y: 0, z: 0 };
    turretMuzzle(4, 10, -2, 4.5 + 10, 10.6, -1.5, out);
    expect(out.x).toBeCloseTo(4.5 + TURRET_GUN.reach, 9);
    expect(out.y).toBeCloseTo(10 + TURRET_GUN.pivot, 9);
    expect(out.z).toBeCloseTo(-1.5, 9);
  });

  it('points up and down with the target, at the same distance from the pivot', () => {
    const out = { x: 0, y: 0, z: 0 };
    turretMuzzle(0, 0, 0, 0.5, 20, 0.5, out);
    expect(out.x).toBeCloseTo(0.5, 9);
    expect(out.y).toBeCloseTo(TURRET_GUN.pivot + TURRET_GUN.reach, 9);
    turretMuzzle(0, 0, 0, 3.5, TURRET_GUN.pivot - 4, 0.5 + 3, out);
    expect(Math.hypot(out.x - 0.5, out.y - TURRET_GUN.pivot, out.z - 0.5)).toBeCloseTo(
      TURRET_GUN.reach,
      9,
    );
    expect(out.y).toBeLessThan(TURRET_GUN.pivot);
  });

  it('is the pivot itself for a target at the pivot', () => {
    const out = { x: 9, y: 9, z: 9 };
    turretMuzzle(2, 3, 4, 2.5, 3 + TURRET_GUN.pivot, 4.5, out);
    expect(out).toEqual({ x: 2.5, y: 3 + TURRET_GUN.pivot, z: 4.5 });
  });
});

describe('a turret in the simulation', () => {
  it('shoots the nearest machine in reach, and wounds it by the damage', () => {
    const { stand, base, crawler, play, machines, flat } = field();
    stand(base.x, base.z);
    const near = crawler(14);
    const far = crawler(18, 1);
    const shots = play(1);
    expect(shots).toHaveLength(1);
    const shot = shots[0] as TurretShot;
    expect(shot).toMatchObject({ x: base.x, y: base.y, z: base.z, enemy: near });
    expect(shot.flags).toBe(SHOT_FLAG.enemy);
    // The bolt ends on the face of the crawler's box that looks at the turret.
    expect(shot.ex).toBeLessThan(flat.core.x - 14 + ENEMIES.crawler.hitbox.halfWidth + 0.5);
    expect(shot.ex).toBeGreaterThan(flat.core.x - 14 - ENEMIES.crawler.hitbox.halfWidth - 0.5);
    const states = Array.from({ length: 4 }, () => ({
      id: 0,
      kind: 0,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      health: 255,
      flags: 0,
    }));
    expect(machines.write(states)).toBe(2);
    const byId = new Map(states.slice(0, 2).map((state) => [state.id, state.health]));
    expect(byId.get(near)).toBe(
      Math.round(((ENEMIES.crawler.health - turretLevel(1).damage) / ENEMIES.crawler.health) * 255),
    );
    expect(byId.get(far)).toBe(255);
  });

  it('waits its interval between shots, and then shoots again', () => {
    const { stand, base, crawler, play } = field();
    stand(base.x, base.z);
    crawler(14);
    const wait = Math.round(turretLevel(1).interval / STEP);
    expect(play(1)).toHaveLength(1);
    expect(play(wait - 1)).toHaveLength(0);
    expect(play(1)).toHaveLength(1);
  });

  it('shoots no machine beyond its range, and shoots one that comes into it', () => {
    const { stand, base, crawler, play, flat } = field();
    stand(base.x, base.z);
    const range = turretLevel(1).range;
    // The pivot is in the middle of the turret's cell, 8 blocks and a half from the Core's x.
    const farAway = flat.core.x - (base.x + 0.5) + range + 3;
    crawler(farAway);
    expect(play(2)).toHaveLength(0);
    const inside = flat.core.x - (base.x + 0.5) + range - 3;
    crawler(inside);
    expect(play(1)).toHaveLength(1);
  });

  it('is stopped by a wall, and then shoots another machine it can see', () => {
    const { stand, base, crawler, play, flat } = field();
    stand(base.x, base.z);
    const blocked = crawler(14);
    // A wall two blocks high and three wide across the way west.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = 0; dy < 2; dy++) flat.place(base.x - 2, FLOOR + dy, base.z + dz, SCRAP);
    }
    expect(play(2)).toHaveLength(0);
    // A second machine north of the turret, in the open.
    const open = crawler(8, 8);
    const shots = play(1);
    expect(shots).toHaveLength(1);
    expect(shots[0]?.enemy).toBe(open);
    expect(shots[0]?.enemy).not.toBe(blocked);
  });

  it('does not start its wait when it cannot shoot, so it fires the step the way opens', () => {
    const { stand, base, crawler, play, flat } = field();
    stand(base.x, base.z);
    crawler(14);
    const wall: [number, number, number][] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = 0; dy < 2; dy++) wall.push([base.x - 2, FLOOR + dy, base.z + dz]);
    }
    for (const [x, y, z] of wall) flat.place(x, y, z, SCRAP);
    expect(play(10)).toHaveLength(0);
    for (const [x, y, z] of wall) flat.remove(x, y, z);
    expect(play(1)).toHaveLength(1);
  });

  it('shoots over a block from a block of its own, where it could not from the ground', () => {
    const { stand, remove, base, crawler, play, flat } = field();
    // A block next to the turret, on the side the machine is.
    flat.place(base.x - 1, FLOOR, base.z, SCRAP);
    const low = stand(base.x, base.z);
    crawler(14);
    expect(play(2)).toHaveLength(0);
    // The same turret on a block of its own looks over the one beside it.
    remove(low);
    flat.place(base.x, FLOOR, base.z, SCRAP);
    stand(base.x, base.z, TURRET_STATE, FLOOR + 1);
    expect(play(1)).toHaveLength(1);
  });

  it('cannot see the foot of its own pillar, where the first block under the gun is the one it stands on', () => {
    for (const [away, fired] of [
      [2, 0],
      [4, 1],
    ] as const) {
      const { stand, base, machines, play, flat } = field();
      // A turret on a pillar three blocks high, and a machine on the ground `away` blocks from its middle.
      for (let dy = 0; dy < 3; dy++) flat.place(base.x, FLOOR + dy, base.z, SCRAP);
      stand(base.x, base.z, TURRET_STATE, FLOOR + 3);
      expect(machines.spawnAt(base.x + 0.5 + away, base.z + 0.5)).not.toBeNull();
      expect(play(2)).toHaveLength(fired);
    }
  });

  it('is stopped by a block next to it at its own level, as by any wall', () => {
    const { stand, base, crawler, play, flat } = field();
    stand(base.x, base.z);
    flat.place(base.x - 1, FLOOR, base.z, SCRAP);
    flat.place(base.x - 1, FLOOR, base.z - 1, SCRAP);
    flat.place(base.x - 1, FLOOR, base.z + 1, SCRAP);
    crawler(14);
    expect(play(2)).toHaveLength(0);
  });

  it('fells a machine in a few shots, tells the last one, and counts it with the machines felled', () => {
    const { stand, base, crawler, play, machines, sim } = field();
    stand(base.x, base.z);
    const id = crawler(12);
    const needed = Math.ceil(ENEMIES.crawler.health / turretLevel(1).damage);
    const wait = Math.round(turretLevel(1).interval / STEP);
    const shots: TurretShot[] = [];
    for (let i = 0; i < needed; i++) shots.push(...play(i === 0 ? 1 : wait));
    expect(shots).toHaveLength(needed);
    expect(shots.slice(0, -1).every((shot) => (shot.flags & SHOT_FLAG.kill) === 0)).toBe(true);
    expect(shots[needed - 1]?.flags).toBe(SHOT_FLAG.enemy | SHOT_FLAG.kill);
    expect(shots.every((shot) => shot.enemy === id)).toBe(true);
    expect(machines.count).toBe(0);
    expect(sim.felled).toBe(1);
    expect(sim.read(createReading()).felled).toBe(1);
  });

  it('lets two turrets share the work, and the second does not shoot a machine the first felled', () => {
    const { stand, base, crawler, play, machines, sim } = field();
    stand(base.x, base.z);
    stand(base.x, base.z + 2);
    const id = crawler(12);
    // Leave the crawler one hit from death.
    machines.hurt(id, ENEMIES.crawler.health - turretLevel(1).damage);
    const shots = play(1);
    // The first turret felled it; the second finds nothing left to shoot.
    expect(shots).toHaveLength(1);
    expect(shots[0]?.flags).toBe(SHOT_FLAG.enemy | SHOT_FLAG.kill);
    expect(sim.felled).toBe(1);
  });

  it('ignores a module that is not a turret', () => {
    const { stand, base, crawler, play } = field();
    stand(base.x, base.z, TERMINAL_STATE);
    crawler(12);
    expect(play(3)).toHaveLength(0);
  });

  it('shoots no more once the turret is taken away, and again when it is put back', () => {
    const { stand, remove, base, crawler, play } = field();
    const site = stand(base.x, base.z);
    crawler(12);
    expect(play(1)).toHaveLength(1);
    remove(site);
    expect(play(30)).toHaveLength(0);
    stand(base.x, base.z);
    expect(play(1)).toHaveLength(1);
  });

  it('shoots nothing in a run that was given no list of modules', () => {
    const flat = flatWorld({ height: () => FLOOR });
    const sim = new SurvivalSim({ core: flat.core, nav: flat.world, seed: 9, waves: false });
    flat.place(Math.floor(flat.core.x) - 8, FLOOR, Math.floor(flat.core.z), TURRET_STATE);
    sim.enemies!.spawnAt(flat.core.x - 12, flat.core.z);
    sim.warp(1);
    const shots: TurretShot[] = [];
    sim.drainTurretShots(shots);
    expect(shots).toEqual([]);
  });

  it('hands over its shots once, oldest first', () => {
    const { stand, base, crawler, sim } = field();
    stand(base.x, base.z);
    stand(base.x, base.z + 2);
    crawler(12);
    sim.warp(STEP);
    const first: TurretShot[] = [];
    sim.drainTurretShots(first);
    expect(first.length).toBeGreaterThanOrEqual(1);
    const second: TurretShot[] = [];
    sim.drainTurretShots(second);
    expect(second).toEqual([]);
  });

  it('stops once the run is over', () => {
    const { stand, base, crawler, play, sim } = field();
    stand(base.x, base.z);
    crawler(12);
    sim.hurtCore(100_000);
    expect(sim.over).toBe(true);
    expect(play(5)).toHaveLength(0);
    expect(sim.felled).toBe(0);
  });
});
