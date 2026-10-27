import { describe, expect, it } from 'vitest';
import { MATERIAL, MODULE, moduleShape, packState } from '../../src/shared/blocks';
import {
  ENEMY_KIND,
  createEnemyPose,
  createEnemyState,
  type EnemyPose,
} from '../../src/shared/enemy-state';
import type { Vec3 } from '../../src/shared/look';
import { SHOT_FLAG } from '../../src/shared/shot';
import { createReading, nightStart, type SurvivalEvent } from '../../src/shared/survival-state';
import { POOL } from '../../src/systems/economy/balance';
import { BLASTER, ENEMIES } from '../../src/systems/survival/balance';
import { SurvivalSim, createShotOutcome } from '../../src/systems/survival/sim';
import type { ModuleSite, TurretShot } from '../../src/systems/survival/turrets';
import { flatWorld } from './helpers/nav-world';

const FLOOR = 10;
const PLAYER = 2;
const TURRET_STATE = packState(moduleShape(MODULE.turret, 0), 1);
const ARMORED = ENEMIES.armored;
const CELLS = ARMORED.drop?.amount ?? 0;
const FLYER = ENEMIES.flyer;
const FLYER_CELLS = FLYER.drop?.amount ?? 0;
const BREACHER = ENEMIES.breacher;
const BREACHER_CELLS = BREACHER.drop?.amount ?? 0;

/** Blows that fell an armored crawler of the first night: its health over the share it takes. */
const FELLING = ARMORED.health / ARMORED.takes;

/** A run on flat ground at 10 with the Core, a player, a turret list, and an armored crawler 14 blocks west of the Core. */
function field() {
  const flat = flatWorld({ height: () => FLOOR });
  const sites: ModuleSite[] = [];
  const sim = new SurvivalSim({
    core: flat.core,
    nav: flat.world,
    seed: 9,
    startAt: nightStart(1),
    waves: false,
    ray: {
      blocks: { getBlock: (x, y, z) => flat.cells.get(x, y, z) },
      ground: { distance: (_x, y) => y - FLOOR },
    },
    modules: (visit) => {
      for (const site of sites) visit(site);
    },
  });
  sim.addPlayer(PLAYER);
  const machines = sim.enemies!;
  const economy = sim.economy!;
  const put = (kind: number, west = 14, dz = 0): number =>
    machines.spawnAt(flat.core.x - west, flat.core.z + dz, 1, kind) as number;
  const armored = put(ENEMY_KIND.armored);
  const poses = (): EnemyPose[] => {
    const states = Array.from({ length: 128 }, createEnemyState);
    const count = machines.write(states);
    return states.slice(0, count).map((state) => ({ ...createEnemyPose(), ...state, health: 1 }));
  };
  /** The health byte the first machine carries on the wire, 255 for a whole one. */
  const healthByte = (): number => {
    const states = Array.from({ length: 4 }, createEnemyState);
    machines.write(states);
    return (states[0] as { health: number }).health;
  };
  const events = (): SurvivalEvent[] => {
    const out: SurvivalEvent[] = [];
    sim.drainEvents(out);
    return out;
  };
  const energy = (): number => economy.pool.amount(MATERIAL.energy);
  const shooter = { x: flat.core.x - 4, y: FLOOR + 0.5, z: flat.core.z };
  const west: Vec3 = { x: -1, y: 0, z: 0 };
  const out = createShotOutcome();
  const shoot = (): boolean => {
    sim.playerVitals(PLAYER)!.step(BLASTER.interval, null);
    return sim.fire(PLAYER, shooter, west, poses(), poses().length, out);
  };
  /** A shot at a point, from where the shooter stands: true when the bolt went. */
  const shootAtPoint = (x: number, y: number, z: number): boolean => {
    sim.playerVitals(PLAYER)!.step(BLASTER.interval, null);
    const dx = x - shooter.x;
    const dy = y - shooter.y;
    const dz = z - shooter.z;
    const length = Math.hypot(dx, dy, dz);
    const dir: Vec3 = { x: dx / length, y: dy / length, z: dz / length };
    return sim.fire(PLAYER, shooter, dir, poses(), poses().length, out);
  };
  const stand = (x: number, z: number): void => {
    sites.push({ x, y: FLOOR, z, state: TURRET_STATE });
    flat.place(x, FLOOR, z, TURRET_STATE);
  };
  return {
    flat,
    sim,
    machines,
    economy,
    armored,
    put,
    poses,
    healthByte,
    events,
    energy,
    shoot,
    shootAtPoint,
    out,
    stand,
  };
}

describe('what a felled machine leaves in the pool', () => {
  it('is nothing for a plain crawler, and the crew is told nothing', () => {
    const { machines, put, energy, events } = field();
    const plain = put(ENEMY_KIND.crawler, 14, 3);
    expect(machines.hurt(plain, ENEMIES.crawler.health)).toBe(true);
    expect(energy()).toBe(0);
    expect(events()).toEqual([]);
  });

  it('is Tier 4 cells for an armored crawler, once, and the crew is told how many', () => {
    const { machines, armored, energy, events, sim, economy } = field();
    expect(CELLS).toBeGreaterThan(0);
    expect(ARMORED.drop?.material).toBe(MATERIAL.energy);
    expect(machines.hurt(armored, FELLING - 0.1)).toBe(false);
    expect(energy()).toBe(0);
    expect(events()).toEqual([]);
    expect(sim.gathered).toBe(0);

    expect(machines.hurt(armored, 0.2)).toBe(true);
    expect(energy()).toBe(CELLS);
    expect(events()).toEqual([{ k: 'drop', n: 1, m: MATERIAL.energy, c: CELLS }]);
    // They count with what the crew has gathered, for the results screen.
    expect(sim.gathered).toBe(CELLS);
    expect(economy.gathered).toBe(CELLS);
    expect(sim.read(createReading()).gathered).toBe(CELLS);
    // A blow at a machine that is gone leaves nothing more.
    machines.hurt(armored, 1000);
    expect(energy()).toBe(CELLS);
    expect(events()).toEqual([]);
  });

  it('comes from the blaster too: thirteen shots fell an armored crawler, the last one leaves the cells', () => {
    const { shoot, out, energy, events, machines, armored, healthByte } = field();
    const shots = Math.ceil(FELLING / BLASTER.damage);
    expect(shots).toBe(13);
    for (let shot = 1; shot < shots; shot++) {
      expect(shoot()).toBe(true);
      expect(out.flags).toBe(SHOT_FLAG.enemy);
      expect(out.enemy).toBe(armored);
    }
    expect(machines.count).toBe(1);
    expect(energy()).toBe(0);
    // Twelve shots have taken a share of the blow each: the plating leaves it nearly spent, not whole.
    expect(healthByte()).toBeLessThan(0.1 * 255);
    expect(healthByte()).toBeGreaterThan(0);
    expect(shoot()).toBe(true);
    expect(out.flags).toBe(SHOT_FLAG.enemy | SHOT_FLAG.kill);
    expect(machines.count).toBe(0);
    expect(energy()).toBe(CELLS);
    expect(events()).toEqual([{ k: 'drop', n: 1, m: MATERIAL.energy, c: CELLS }]);
  });

  it('comes from a turret too: the shot that fells it leaves the cells', () => {
    const { flat, machines, armored, stand, sim, energy, events } = field();
    stand(Math.floor(flat.core.x) - 8, Math.floor(flat.core.z));
    // Leave it one basic turret shot's worth of health.
    machines.hurt(armored, FELLING - 4);
    expect(machines.count).toBe(1);
    const shots: TurretShot[] = [];
    for (let i = 0; i < 20 && energy() === 0; i++) {
      sim.warp(0.05);
      sim.drainTurretShots(shots);
    }
    expect(shots.some((shot) => (shot.flags & SHOT_FLAG.kill) !== 0)).toBe(true);
    expect(machines.count).toBe(0);
    expect(energy()).toBe(CELLS);
    expect(events()).toEqual([{ k: 'drop', n: 1, m: MATERIAL.energy, c: CELLS }]);
  });

  it('is as much as the pool has room for, and nothing is said when it has none', () => {
    const { machines, armored, put, economy, energy, events } = field();
    economy.pool.add(MATERIAL.energy, POOL.cap - 1);
    expect(machines.hurt(armored, FELLING)).toBe(true);
    expect(energy()).toBe(POOL.cap);
    expect(events()).toEqual([{ k: 'drop', n: 1, m: MATERIAL.energy, c: 1 }]);
    const another = put(ENEMY_KIND.armored, 14, 3);
    expect(machines.hurt(another, FELLING)).toBe(true);
    expect(energy()).toBe(POOL.cap);
    expect(events()).toEqual([]);
  });

  it('is nothing for machines that fall back at dawn, or once the run is over', () => {
    const { machines, armored, put, sim, energy, events } = field();
    machines.clear();
    expect(energy()).toBe(0);
    const another = put(ENEMY_KIND.armored, 14, -3);
    sim.hurtCore(100_000);
    expect(sim.over).toBe(true);
    events();
    expect(machines.hurt(another, FELLING)).toBe(true);
    expect(energy()).toBe(0);
    expect(events()).toEqual([]);
    expect(machines.has(armored)).toBe(false);
  });
});

describe('what a felled skimmer leaves in the pool', () => {
  it('is two Tier 4 cells, once, and the crew is told how many', () => {
    const { machines, put, energy, events } = field();
    const skimmer = put(ENEMY_KIND.flyer, 14, 3);
    expect(FLYER_CELLS).toBeGreaterThan(0);
    expect(FLYER.drop?.material).toBe(MATERIAL.energy);
    expect(machines.hurt(skimmer, FLYER.health - 0.1)).toBe(false);
    expect(energy()).toBe(0);
    expect(events()).toEqual([]);
    expect(machines.hurt(skimmer, 0.2)).toBe(true);
    expect(energy()).toBe(FLYER_CELLS);
    expect(events()).toEqual([{ k: 'drop', n: 1, m: MATERIAL.energy, c: FLYER_CELLS }]);
    machines.hurt(skimmer, 1000);
    expect(energy()).toBe(FLYER_CELLS);
  });

  it('comes from the blaster, aimed up at it: two shots fell one, and the second leaves the cells', () => {
    const { machines, put, poses, shootAtPoint, out, energy, events } = field();
    const skimmer = put(ENEMY_KIND.flyer, 14, -3);
    const at = poses().find((pose) => pose.id === skimmer)!;
    expect(at.y).toBeCloseTo(FLOOR + FLYER.flies.hover, 6);
    const middle = at.y + FLYER.hitbox.height / 2;
    expect(Math.ceil(FLYER.health / BLASTER.damage)).toBe(2);
    // A shot level with the ground goes under it.
    expect(shootAtPoint(at.x, FLOOR + 0.5, at.z)).toBe(true);
    expect(out.flags & SHOT_FLAG.enemy).toBe(0);
    expect(shootAtPoint(at.x, middle, at.z)).toBe(true);
    expect(out.flags).toBe(SHOT_FLAG.enemy);
    expect(out.enemy).toBe(skimmer);
    expect(machines.has(skimmer)).toBe(true);
    expect(energy()).toBe(0);
    expect(shootAtPoint(at.x, middle, at.z)).toBe(true);
    expect(out.flags).toBe(SHOT_FLAG.enemy | SHOT_FLAG.kill);
    expect(machines.has(skimmer)).toBe(false);
    expect(energy()).toBe(FLYER_CELLS);
    expect(events()).toEqual([{ k: 'drop', n: 1, m: MATERIAL.energy, c: FLYER_CELLS }]);
  });

  it('comes from a turret too, which aims up at it: the shot that fells it leaves the cells', () => {
    const { flat, machines, put, stand, sim, energy, events } = field();
    // Only the skimmer is left on the field for the turret to pick.
    machines.clear();
    const skimmer = put(ENEMY_KIND.flyer, 14, 0);
    stand(Math.floor(flat.core.x) - 8, Math.floor(flat.core.z));
    // Leave it one basic turret shot's worth of health.
    machines.hurt(skimmer, FLYER.health - 4);
    expect(energy()).toBe(0);
    const shots: TurretShot[] = [];
    for (let i = 0; i < 20 && energy() === 0; i++) {
      sim.warp(0.05);
      sim.drainTurretShots(shots);
    }
    expect(shots.some((shot) => (shot.flags & SHOT_FLAG.kill) !== 0)).toBe(true);
    expect(machines.has(skimmer)).toBe(false);
    expect(energy()).toBe(FLYER_CELLS);
    expect(events()).toEqual([{ k: 'drop', n: 1, m: MATERIAL.energy, c: FLYER_CELLS }]);
  });
});

describe('what a felled breacher leaves in the pool', () => {
  it('is the most Tier 4 cells of any machine, once, when it is felled before it goes off', () => {
    const { machines, put, energy, events } = field();
    const breacher = put(ENEMY_KIND.breacher, 14, 3);
    expect(BREACHER_CELLS).toBeGreaterThan(FLYER_CELLS);
    expect(BREACHER_CELLS).toBeGreaterThan(CELLS);
    expect(BREACHER.drop?.material).toBe(MATERIAL.energy);
    expect(machines.hurt(breacher, BREACHER.health - 0.1)).toBe(false);
    expect(energy()).toBe(0);
    expect(events()).toEqual([]);
    expect(machines.hurt(breacher, 0.2)).toBe(true);
    expect(energy()).toBe(BREACHER_CELLS);
    expect(events()).toEqual([{ k: 'drop', n: 1, m: MATERIAL.energy, c: BREACHER_CELLS }]);
    machines.hurt(breacher, 1000);
    expect(energy()).toBe(BREACHER_CELLS);
  });

  it('comes from the blaster: nine shots fell one, and the ninth leaves the cells', () => {
    const { shoot, out, energy, events, machines, put } = field();
    machines.clear();
    const breacher = put(ENEMY_KIND.breacher, 14, 0);
    const shots = Math.ceil(BREACHER.health / BLASTER.damage);
    expect(shots).toBe(9);
    for (let shot = 1; shot < shots; shot++) {
      expect(shoot()).toBe(true);
      expect(out.flags).toBe(SHOT_FLAG.enemy);
      expect(out.enemy).toBe(breacher);
    }
    expect(energy()).toBe(0);
    expect(shoot()).toBe(true);
    expect(out.flags).toBe(SHOT_FLAG.enemy | SHOT_FLAG.kill);
    expect(machines.count).toBe(0);
    expect(energy()).toBe(BREACHER_CELLS);
    expect(events()).toEqual([{ k: 'drop', n: 1, m: MATERIAL.energy, c: BREACHER_CELLS }]);
  });

  it('comes from a turret too: the shot that fells it leaves the cells', () => {
    const { flat, machines, put, stand, sim, energy, events } = field();
    machines.clear();
    const breacher = put(ENEMY_KIND.breacher, 14, 0);
    stand(Math.floor(flat.core.x) - 8, Math.floor(flat.core.z));
    // Leave it one basic turret shot's worth of health.
    machines.hurt(breacher, BREACHER.health - 4);
    const shots: TurretShot[] = [];
    for (let i = 0; i < 20 && energy() === 0; i++) {
      sim.warp(0.05);
      sim.drainTurretShots(shots);
    }
    expect(shots.some((shot) => (shot.flags & SHOT_FLAG.kill) !== 0)).toBe(true);
    expect(machines.has(breacher)).toBe(false);
    expect(energy()).toBe(BREACHER_CELLS);
    expect(events()).toEqual([{ k: 'drop', n: 1, m: MATERIAL.energy, c: BREACHER_CELLS }]);
  });
});
