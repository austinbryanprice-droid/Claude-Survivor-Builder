import { describe, expect, it } from 'vitest';
import { createEnemyPose, createEnemyState, type EnemyPose } from '../../src/shared/enemy-state';
import type { Vec3 } from '../../src/shared/look';
import { SHOT_FLAG } from '../../src/shared/shot';
import { nightStart } from '../../src/shared/survival-state';
import { BLASTER, ENEMIES, RESPAWN, VITALS } from '../../src/systems/survival/balance';
import { SurvivalSim, createShotOutcome } from '../../src/systems/survival/sim';
import { SCRAP, flatWorld } from './helpers/nav-world';

const PLAYER = 2;
const FLOOR = 10;

/** A run on flat ground at 10 with the Core, a player who has been seen, and a crawler 12 blocks west of the Core. */
function field() {
  const flat = flatWorld({ height: () => FLOOR });
  const sim = new SurvivalSim({
    core: flat.core,
    nav: flat.world,
    seed: 9,
    startAt: nightStart(1),
    ray: {
      blocks: { getBlock: (x, y, z) => flat.cells.get(x, y, z) },
      ground: { distance: (_x, y) => y - FLOOR },
    },
  });
  sim.addPlayer(PLAYER);
  const machines = sim.enemies!;
  const id = machines.spawnAt(flat.core.x - 14, flat.core.z)!;
  expect(id).not.toBeNull();

  /** The poses of the machines as they stand now, the way the host's mirror reports them. */
  const poses = (): EnemyPose[] => {
    const states = Array.from({ length: 128 }, createEnemyState);
    const count = machines.write(states);
    return states.slice(0, count).map((state) => ({ ...createEnemyPose(), ...state, health: 1 }));
  };
  // A muzzle low enough to be level with a crawler's back: they stand a block tall.
  const shooter = { x: flat.core.x - 4, y: FLOOR + 0.5, z: flat.core.z };
  const west: Vec3 = { x: -1, y: 0, z: 0 };
  const out = createShotOutcome();
  /** Pulls the trigger as it is, with whatever the blaster has ready. */
  const trigger = (
    dir: Vec3 = west,
    from: Vec3 = shooter,
    bodies: readonly EnemyPose[] = poses(),
  ) => sim.fire(PLAYER, from, dir, bodies, bodies.length, out);
  /** Lets the blaster get ready (without moving the machines), then fires. */
  const shoot = (
    dir: Vec3 = west,
    from: Vec3 = shooter,
    bodies: readonly EnemyPose[] = poses(),
  ) => {
    sim.playerVitals(PLAYER)!.step(BLASTER.interval, null);
    return trigger(dir, from, bodies);
  };
  return { flat, sim, machines, id, poses, shooter, west, out, shoot, trigger };
}

describe('the pulse blaster in the simulation', () => {
  it('hurts the machine it is aimed at, and three shots fell a crawler', () => {
    const { machines, id, shoot, out, shooter, flat } = field();
    // The crawler stands 10 blocks from the muzzle, and its box is a little deeper than its body.
    expect(shoot()).toBe(true);
    expect(out.flags).toBe(SHOT_FLAG.enemy);
    expect(out.enemy).toBe(id);
    expect(out.x).toBeCloseTo(flat.core.x - 14 + ENEMIES.crawler.hitbox.halfWidth, 6);
    expect(out.y).toBeCloseTo(shooter.y, 9);
    expect(machines.count).toBe(1);
    expect(shoot()).toBe(true);
    expect(out.flags).toBe(SHOT_FLAG.enemy);
    expect(machines.count).toBe(1);
    expect(shoot()).toBe(true);
    expect(out.flags).toBe(SHOT_FLAG.enemy | SHOT_FLAG.kill);
    expect(machines.count).toBe(0);
    expect(BLASTER.damage * 3).toBeGreaterThanOrEqual(ENEMIES.crawler.health);
    expect(BLASTER.damage * 2).toBeLessThan(ENEMIES.crawler.health);
  });

  it('wounds the machine by the damage and no more, and the next report says so', () => {
    const { machines, id, shoot, poses } = field();
    shoot();
    const states = Array.from({ length: 4 }, createEnemyState);
    expect(machines.write(states)).toBe(1);
    const state = states[0]!;
    expect(state.id).toBe(id);
    expect(state.health).toBe(
      Math.round(((ENEMIES.crawler.health - BLASTER.damage) / ENEMIES.crawler.health) * 255),
    );
    expect(poses()).toHaveLength(1);
  });

  it('costs the shooter Energy for every shot, hit or miss, and nobody else', () => {
    const { sim, shoot, shooter, out } = field();
    sim.addPlayer(7);
    const energyOf = (id: number) => sim.playerVitals(id)!.energy;
    expect(energyOf(PLAYER)).toBe(VITALS.maxEnergy);
    // Twelve shots into empty sky: 0.6 each, 7.2 in all.
    for (let i = 0; i < 12; i++) {
      shoot({ x: 0, y: 1, z: 0 }, shooter, []);
    }
    expect(out.flags).toBe(0);
    expect(energyOf(PLAYER)).toBe(VITALS.maxEnergy - Math.floor(12 * VITALS.energy.perShot));
    expect(energyOf(7)).toBe(VITALS.maxEnergy);
  });

  it('flies its whole range when nothing is in the way', () => {
    const { shoot, shooter, out } = field();
    expect(shoot({ x: 0, y: 0, z: 1 })).toBe(true);
    expect(out.flags).toBe(0);
    expect(out.enemy).toBe(0);
    expect(out.x).toBeCloseTo(shooter.x, 9);
    expect(out.y).toBeCloseTo(shooter.y, 9);
    expect(out.z).toBeCloseTo(shooter.z + BLASTER.range, 9);
  });

  it('is stopped by a block, and the machine behind it is not hurt', () => {
    const { flat, machines, shoot, shooter, out } = field();
    flat.place(Math.floor(shooter.x) - 3, FLOOR, Math.floor(shooter.z), SCRAP);
    flat.place(Math.floor(shooter.x) - 3, FLOOR + 1, Math.floor(shooter.z), SCRAP);
    expect(shoot()).toBe(true);
    expect(out.flags).toBe(SHOT_FLAG.world);
    expect(out.enemy).toBe(0);
    expect(out.x).toBeCloseTo(Math.floor(shooter.x) - 2, 6);
    shoot();
    shoot();
    shoot();
    expect(machines.count).toBe(1);
  });

  it('is stopped by the ground', () => {
    const { shoot, out, shooter } = field();
    expect(shoot({ x: 0, y: -1, z: 0 })).toBe(true);
    expect(out.flags).toBe(SHOT_FLAG.world);
    expect(out.y).toBeCloseTo(FLOOR, 1);
    expect(out.x).toBeCloseTo(shooter.x, 9);
  });

  it('goes through a machine that was shot dead a moment ago, though it is still on the old screen', () => {
    const { machines, shoot, poses, out } = field();
    const old = poses();
    shoot();
    shoot();
    shoot();
    expect(machines.count).toBe(0);
    expect(shoot(undefined, undefined, old)).toBe(true);
    expect(out.flags).toBe(0);
    expect(out.enemy).toBe(0);
  });

  it('strikes where the machine was on the screen the shot was aimed on, not where it is now', () => {
    const { machines, shoot, poses, id, shooter, out } = field();
    // The shooter's screen drew the crawler five blocks to the south of where it stands now.
    const then = poses().map((pose) => ({ ...pose, z: pose.z + 5 }));
    const line: Vec3 = { x: -1, y: 0, z: 0 };
    const from = { ...shooter, z: shooter.z + 5 };
    expect(shoot(line, from, then)).toBe(true);
    expect(out.flags).toBe(SHOT_FLAG.enemy);
    expect(out.enemy).toBe(id);
    // The blow lands on the machine as it is: it is hurt where it stands.
    const states = Array.from({ length: 2 }, createEnemyState);
    expect(machines.write(states)).toBe(1);
    expect(states[0]!.health).toBeLessThan(255);
    // The same shot, aimed at where it stands now, passes it by in the old picture.
    expect(shoot(line, shooter, then)).toBe(true);
    expect(out.flags).toBe(0);
  });

  it('does nothing for someone who is not in the run, or once the Core has fallen', () => {
    const { sim, machines, shoot, out, shooter, poses } = field();
    expect(sim.fire(99, shooter, { x: -1, y: 0, z: 0 }, poses(), 1, out)).toBe(false);
    sim.hurtCore(100_000);
    expect(sim.over).toBe(true);
    expect(shoot()).toBe(false);
    expect(machines.count).toBe(1);
    expect(sim.playerVitals(PLAYER)!.energy).toBe(VITALS.maxEnergy);
  });

  it('has nothing to hurt on ground that gave the run no machines, but still flies', () => {
    const sim = new SurvivalSim({ startAt: nightStart(1) });
    sim.addPlayer(PLAYER);
    const out = createShotOutcome();
    expect(sim.fire(PLAYER, { x: 0, y: 5, z: 0 }, { x: 1, y: 0, z: 0 }, [], 0, out)).toBe(true);
    expect(out.flags).toBe(0);
    expect(out.x).toBeCloseTo(BLASTER.range, 9);
  });
  it('keeps two shots ready, and then waits for the hands', () => {
    const { sim, trigger } = field();
    const hands = sim.playerVitals(PLAYER)!;
    expect(trigger()).toBe(true);
    expect(trigger()).toBe(true);
    expect(trigger()).toBe(false);
    // Not quite an interval is not enough; a whole one is.
    hands.step(BLASTER.interval * 0.9, null);
    expect(trigger()).toBe(false);
    hands.step(BLASTER.interval * 0.2, null);
    expect(trigger()).toBe(true);
    expect(trigger()).toBe(false);
    // Time does not bank more than the burst.
    hands.step(60, null);
    expect(trigger()).toBe(true);
    expect(trigger()).toBe(true);
    expect(trigger()).toBe(false);
  });

  it('takes nothing from the shooter for a shot it refuses', () => {
    const { sim, trigger } = field();
    trigger();
    trigger();
    const before = sim.playerVitals(PLAYER)!.energy;
    for (let i = 0; i < 20; i++) expect(trigger()).toBe(false);
    expect(sim.playerVitals(PLAYER)!.energy).toBe(before);
  });

  it('is slower in the hands of someone with no Energy left', () => {
    const { sim, trigger } = field();
    const hands = sim.playerVitals(PLAYER)!;
    hands.set({ energy: 0 });
    trigger();
    trigger();
    // Half the rate: one interval is not enough, two are.
    hands.step(BLASTER.interval, null);
    expect(trigger()).toBe(false);
    hands.step(BLASTER.interval, null);
    expect(trigger()).toBe(true);
    // And an empty bar does not lock the blaster: it still fires.
    expect(hands.energy).toBe(0);
  });
});

describe('the pulse blaster after going down', () => {
  it('does not fire for a player who is down, and costs them nothing', () => {
    const { sim, trigger, out } = field();
    sim.hurtPlayer(PLAYER, VITALS.maxHealth);
    const energy = sim.playerVitals(PLAYER)!.energy;
    expect(trigger()).toBe(false);
    expect(out.flags).toBe(0);
    expect(sim.playerVitals(PLAYER)!.energy).toBe(energy);
  });

  it('fires again once the Core has brought them back, with the blaster ready', () => {
    const { sim, trigger } = field();
    sim.hurtPlayer(PLAYER, VITALS.maxHealth);
    sim.warp(RESPAWN.delaySeconds + 0.5);
    expect(sim.isDown(PLAYER)).toBe(false);
    expect(trigger()).toBe(true);
  });

  it('hits softer while shaken: the same shots leave a crawler with more of its Health', () => {
    const steady = field();
    const shaken = field();
    shaken.sim.hurtPlayer(PLAYER, VITALS.maxHealth);
    shaken.sim.warp(RESPAWN.delaySeconds + 0.5);
    // Both machines have walked a little by now; put them back where the shots were aimed.
    for (const run of [steady, shaken]) {
      run.machines.clear();
      run.machines.spawnAt(run.flat.core.x - 14, run.flat.core.z);
    }
    steady.shoot();
    shaken.shoot();
    const healthOf = (run: ReturnType<typeof field>): number => {
      const states = Array.from({ length: 4 }, createEnemyState);
      expect(run.machines.write(states)).toBe(1);
      return states[0]!.health;
    };
    expect(healthOf(shaken)).toBeGreaterThan(healthOf(steady));
    expect(healthOf(shaken)).toBe(
      Math.round(
        ((ENEMIES.crawler.health - BLASTER.damage * RESPAWN.shaken.damageScale) /
          ENEMIES.crawler.health) *
          255,
      ),
    );
  });

  it('hits at full strength again when the shaking has passed', () => {
    const run = field();
    run.sim.hurtPlayer(PLAYER, VITALS.maxHealth);
    run.sim.warp(RESPAWN.delaySeconds + RESPAWN.shaken.seconds + 2);
    run.machines.clear();
    run.machines.spawnAt(run.flat.core.x - 14, run.flat.core.z);
    run.shoot();
    const states = Array.from({ length: 4 }, createEnemyState);
    expect(run.machines.write(states)).toBe(1);
    expect(states[0]!.health).toBe(
      Math.round(((ENEMIES.crawler.health - BLASTER.damage) / ENEMIES.crawler.health) * 255),
    );
  });
});
