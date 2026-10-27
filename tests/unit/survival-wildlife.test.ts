import { describe, expect, it } from 'vitest';
import { MODULE, moduleShape, packState } from '../../src/shared/blocks';
import { createEnemyPose, createEnemyState, type EnemyPose } from '../../src/shared/enemy-state';
import type { Vec3 } from '../../src/shared/look';
import { SHOT_FLAG } from '../../src/shared/shot';
import { nightStart, type SurvivalEvent } from '../../src/shared/survival-state';
import {
  WILD_FLAG,
  WILD_SPECIES,
  createWildPose,
  createWildState,
  type WildPose,
} from '../../src/shared/wildlife-state';
import { BLASTER, VITALS } from '../../src/systems/survival/balance';
import {
  SurvivalSim,
  createShotOutcome,
  type SurvivalOptions,
} from '../../src/systems/survival/sim';
import { SPECIES, WILDLIFE, type Species } from '../../src/systems/wildlife/balance';
import { SCRAP, flatWorld } from './helpers/nav-world';

const FLOOR = 10;
const SHOOTER = 2;
const BYSTANDER = 3;
const STEP = 0.05;
const TURRET_STATE = packState(moduleShape(MODULE.turret, 0), 1);

/** A run on flat ground at 10 with the Core and wildlife on, the valley emptied so the test brings its own creatures. */
function field(options: SurvivalOptions = {}, emptied = true) {
  const flat = flatWorld({ height: () => FLOOR });
  const sim = new SurvivalSim({
    core: flat.core,
    nav: flat.world,
    seed: 9,
    startAt: nightStart(1),
    waves: false,
    wildlife: true,
    ray: {
      blocks: { getBlock: (x, y, z) => flat.cells.get(x, y, z) },
      ground: { distance: (_x, y) => y - FLOOR },
    },
    ...options,
  });
  sim.addPlayer(SHOOTER);
  sim.addPlayer(BYSTANDER);
  if (emptied) sim.wildlife!.clear();
  const wild = sim.wildlife!;
  const machines = sim.enemies!;

  /** The creatures as they stand now, the way the host's mirror reports them. */
  const creatures = (): WildPose[] => {
    const states = Array.from({ length: WILDLIFE.maxAlive }, createWildState);
    const count = wild.write(states);
    return states.slice(0, count).map((state) => ({ ...createWildPose(), ...state, health: 1 }));
  };
  const poses = (): EnemyPose[] => {
    const states = Array.from({ length: 128 }, createEnemyState);
    const count = machines.write(states);
    return states.slice(0, count).map((state) => ({ ...createEnemyPose(), ...state, health: 1 }));
  };
  const out = createShotOutcome();
  /** Lets the blaster get ready, then fires from `from` along `dir` at what is in the world now. */
  const shoot = (dir: Vec3, from: Vec3) => {
    sim.playerVitals(SHOOTER)!.step(BLASTER.interval, null);
    const bodies = poses();
    const seen = creatures();
    return sim.fire(SHOOTER, from, dir, bodies, bodies.length, out, seen, seen.length);
  };
  /** Stands a player at a spot, as the host does when it has heard where they are. */
  const stand = (id: number, x: number, z: number) => sim.observe(id, x, FLOOR, z, 0, true);
  const play = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += STEP) sim.advance(STEP);
  };
  return { flat, sim, wild, machines, creatures, poses, shoot, stand, play, out };
}

const eyes = (x: number, z: number): Vec3 => ({ x, y: FLOOR + 1.1, z });

/** The unit vector from a point to the middle of a creature's body. */
function toward(from: Vec3, pose: Pick<WildPose, 'x' | 'y' | 'z'>, height: number): Vec3 {
  const dx = pose.x - from.x;
  const dy = pose.y + height / 2 - from.y;
  const dz = pose.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  return { x: dx / length, y: dy / length, z: dz / length };
}

describe('a run with wildlife', () => {
  it('has none unless it is asked for, or without the ground for it to walk', () => {
    const flat = flatWorld({ height: () => FLOOR });
    const plain = new SurvivalSim({ core: flat.core, nav: flat.world, seed: 9 });
    expect(plain.wildlife).toBeNull();
    const grounded = new SurvivalSim({ core: flat.core, nav: flat.world, seed: 9, wildlife: true });
    expect(grounded.wildlife).not.toBeNull();
    expect(grounded.wildlife!.count).toBeGreaterThan(0);
    const groundless = new SurvivalSim({ wildlife: true });
    expect(groundless.wildlife).toBeNull();
  });

  it('moves the creatures with the clock, and holds them when the run is held', () => {
    const { sim, wild, play } = field({}, false);
    const where = (): string => {
      const out: string[] = [];
      wild.forEach((id, _species, x, _y, z) => out.push(`${id}:${x.toFixed(2)},${z.toFixed(2)}`));
      return out.join(' ');
    };
    const before = where();
    play(5);
    expect(where()).not.toBe(before);
    // Nothing advances unless the host advances the run.
    const frozen = where();
    expect(sim.tick).toBeGreaterThan(0);
    expect(where()).toBe(frozen);
  });

  it('plays the same nights with or without them: the machines do not know they are there', () => {
    const run = (wildlife: boolean) => {
      const flat = flatWorld({ height: () => FLOOR });
      const sim = new SurvivalSim({
        core: flat.core,
        nav: flat.world,
        seed: 21,
        startAt: nightStart(2),
        wildlife,
      });
      sim.addPlayer(SHOOTER);
      sim.observe(SHOOTER, flat.core.x + 3, FLOOR, flat.core.z, 0, true);
      for (let t = 0; t < 120; t += STEP) sim.advance(STEP);
      const states = Array.from({ length: 128 }, createEnemyState);
      const count = sim.enemies!.write(states);
      return { machines: JSON.stringify(states.slice(0, count)), core: sim.coreHealth };
    };
    const without = run(false);
    expect(JSON.parse(without.machines).length).toBeGreaterThan(0);
    expect(run(true)).toEqual(without);
  });
});

describe('a shot in a run with wildlife', () => {
  it('hurts the creature it meets, and tells it apart from a machine', () => {
    const { wild, creatures, shoot, out, machines } = field();
    const id = wild.spawnAt(WILD_SPECIES.stag, 8, 30);
    expect(id).toBeGreaterThan(0);
    const from = eyes(8, 12);
    const stag = creatures()[0]!;
    expect(shoot(toward(from, stag, 1.5), from)).toBe(true);
    expect(out.flags).toBe(SHOT_FLAG.wild);
    expect(out.enemy).toBe(id);
    // The bolt ends on the near face of the stag's box.
    expect(Math.hypot(out.x - 8, out.z - 30)).toBeLessThan(1.2);
    const health = creatures()[0]!;
    expect(health).toBeDefined();
    const states = Array.from({ length: 4 }, createWildState);
    wild.write(states);
    expect(states[0]!.health).toBe(Math.round((50 / 60) * 255));
    expect(machines.count).toBe(0);
  });

  it('fells a hare in two, tells the kill, and counts nothing, drops nothing and spends the same Energy', () => {
    const { sim, wild, creatures, shoot, out } = field();
    const id = wild.spawnAt(WILD_SPECIES.hare, 8, 24);
    const from = eyes(8, 12);
    const energy = sim.playerVitals(SHOOTER)!.energy;
    shoot(toward(from, creatures()[0]!, 0.55), from);
    expect(out.flags).toBe(SHOT_FLAG.wild);
    shoot(toward(from, creatures()[0]!, 0.55), from);
    expect(out.flags).toBe(SHOT_FLAG.wild | SHOT_FLAG.kill);
    expect(out.enemy).toBe(id);
    expect(wild.count).toBe(0);
    // The run's tally of machines felled is the machines'.
    expect(sim.felled).toBe(0);
    const events: SurvivalEvent[] = [];
    sim.drainEvents(events);
    expect(events.filter((event) => event.k === 'drop')).toEqual([]);
    // Two shots at the price of any shot; the meter shows whole points.
    const spent = energy - sim.playerVitals(SHOOTER)!.energy;
    expect(spent).toBeGreaterThanOrEqual(Math.floor(2 * VITALS.energy.perShot));
    expect(spent).toBeLessThanOrEqual(Math.ceil(2 * VITALS.energy.perShot));
  });

  it('hurts whichever of a creature and a machine it reaches first', () => {
    const { wild, machines, creatures, poses, shoot, out } = field();
    const from = eyes(8, 12);
    const stag = wild.spawnAt(WILD_SPECIES.stag, 8, 22)!;
    const crawler = machines.spawnAt(8, 32)!;
    expect(crawler).not.toBeNull();
    // Level with both of them, the stag is in the way.
    const level: Vec3 = { x: 0, y: -0.02, z: 1 };
    shoot(level, from);
    expect(out.flags).toBe(SHOT_FLAG.wild);
    expect(out.enemy).toBe(stag);
    // With the stag out of the way, the crawler behind it is what the same shot meets.
    wild.clear();
    expect(creatures()).toHaveLength(0);
    shoot(toward(from, poses()[0]!, 1), from);
    expect(out.flags).toBe(SHOT_FLAG.enemy);
    expect(out.enemy).toBe(crawler);
    // And a crawler nearer than the stag takes the bolt that would have gone on to it.
    const far = wild.spawnAt(WILD_SPECIES.stag, 8, 40)!;
    machines.clear();
    const near = machines.spawnAt(8, 24)!;
    shoot(level, from);
    expect(out.enemy).toBe(near);
    expect(out.flags & SHOT_FLAG.enemy).toBe(SHOT_FLAG.enemy);
    expect(wild.has(far)).toBe(true);
  });

  it('is stopped by a wall before it reaches the creature behind it', () => {
    const { flat, wild, shoot, out } = field();
    for (let x = -10; x <= 30; x++) {
      for (let y = FLOOR; y < FLOOR + 4; y++) flat.place(x, y, 20, SCRAP);
    }
    const stag = wild.spawnAt(WILD_SPECIES.stag, 8, 30)!;
    shoot({ x: 0, y: 0, z: 1 }, eyes(8, 12));
    expect(out.flags).toBe(SHOT_FLAG.world);
    expect(out.enemy).toBe(0);
    const states = Array.from({ length: 4 }, createWildState);
    wild.write(states);
    expect(states[0]!.health).toBe(255);
    expect(wild.has(stag)).toBe(true);
  });

  it('misses a creature that is not there any more, and spares the creatures when the host has none to show', () => {
    const { sim, wild, creatures, poses, out } = field();
    const id = wild.spawnAt(WILD_SPECIES.hare, 8, 24);
    const from = eyes(8, 12);
    const aim = toward(from, creatures()[0]!, 0.55);
    // The pose the shooter saw is of a creature that has since been felled.
    wild.hurt(id, 1000, SHOOTER, 8, 12);
    sim.playerVitals(SHOOTER)!.step(BLASTER.interval, null);
    const seen = [{ ...createWildPose(), id, kind: WILD_SPECIES.hare, x: 8, y: FLOOR, z: 24 }];
    expect(sim.fire(SHOOTER, from, aim, poses(), 0, out, seen, 1)).toBe(true);
    expect(out.flags & SHOT_FLAG.wild).toBe(0);
    // A host that passes no creatures at all (an old test, a run without wildlife) shoots as before.
    const other = wild.spawnAt(WILD_SPECIES.hare, 8, 24);
    sim.playerVitals(SHOOTER)!.step(BLASTER.interval, null);
    expect(sim.fire(SHOOTER, from, toward(from, creatures()[0]!, 0.55), poses(), 0, out)).toBe(
      true,
    );
    expect(out.flags & SHOT_FLAG.wild).toBe(0);
    expect(wild.has(other)).toBe(true);
  });
});

describe('what the creatures make of the players and the machines', () => {
  it('turns a stag on the player who hurt it, and only on that player', () => {
    const { sim, wild, creatures, shoot, stand, play } = field();
    const body = SPECIES[WILD_SPECIES.stag] as Species;
    const id = wild.spawnAt(WILD_SPECIES.stag, 8, 36);
    stand(SHOOTER, 8, 14);
    stand(BYSTANDER, 6, 14);
    const from = eyes(8, 14);
    shoot(toward(from, creatures()[0]!, 1.5), from);
    const health = (who: number) => sim.playerVitals(who)!.health;
    const before = [health(SHOOTER), health(BYSTANDER)];
    play(7);
    const blow = body.retaliation!.player;
    const taken = before[0]! - health(SHOOTER);
    expect(taken).toBeGreaterThanOrEqual(blow);
    expect(taken % blow).toBe(0);
    expect(health(BYSTANDER)).toBe(before[1]);
    expect(wild.has(id)).toBe(true);
    // And it lets go: nothing more comes after a while.
    play(40);
    const later = health(SHOOTER);
    play(20);
    expect(health(SHOOTER)).toBeGreaterThanOrEqual(later);
  });

  it('sends a hare running from the player who hurt it, and the hare never hurts anyone', () => {
    const { sim, wild, creatures, shoot, stand, play } = field();
    wild.spawnAt(WILD_SPECIES.hare, 8, 30);
    stand(SHOOTER, 8, 14);
    stand(BYSTANDER, 6, 14);
    const from = eyes(8, 14);
    shoot(toward(from, creatures()[0]!, 0.55), from);
    const health = [sim.playerVitals(SHOOTER)!.health, sim.playerVitals(BYSTANDER)!.health];
    play(10);
    const hare = creatures()[0]!;
    expect(Math.hypot(hare.x - 8, hare.z - 14)).toBeGreaterThan(WILDLIFE.attackerRadius - 4);
    expect([sim.playerVitals(SHOOTER)!.health, sim.playerVitals(BYSTANDER)!.health]).toEqual(
      health,
    );
  });

  it('keeps clear of the machines, and a kite does not mind them', () => {
    const { wild, machines, creatures, play } = field();
    wild.spawnAt(WILD_SPECIES.stag, 40, 40);
    wild.spawnAt(WILD_SPECIES.kite, -40, 40);
    machines.spawnAt(40, 48);
    machines.spawnAt(-40, 44);
    play(0.5);
    const [stag, kite] = creatures();
    expect(stag!.flags & WILD_FLAG.alarmed).toBe(WILD_FLAG.alarmed);
    expect(kite!.flags & WILD_FLAG.alarmed).toBe(0);
  });

  it('is left alone by the crew’s turrets, which shoot a machine in the same reach', () => {
    const flat = flatWorld({ height: () => FLOOR });
    const cx = Math.floor(flat.core.x);
    const cz = Math.floor(flat.core.z);
    const turret = { x: cx - 8, y: FLOOR, z: cz, state: TURRET_STATE };
    flat.place(turret.x, turret.y, turret.z, TURRET_STATE);
    const sim = new SurvivalSim({
      core: flat.core,
      nav: flat.world,
      seed: 9,
      startAt: nightStart(1),
      waves: false,
      wildlife: true,
      ray: {
        blocks: { getBlock: (x, y, z) => flat.cells.get(x, y, z) },
        ground: { distance: (_x, y) => y - FLOOR },
      },
      modules: (visit) => visit(turret),
    });
    sim.wildlife!.clear();
    const stag = sim.wildlife!.spawnAt(WILD_SPECIES.stag, turret.x - 6, turret.z + 2);
    const crawler = sim.enemies!.spawnAt(turret.x - 12, turret.z)!;
    expect(stag).toBeGreaterThan(0);
    for (let t = 0; t < 15; t += STEP) sim.advance(STEP);
    // The turret felled the crawler in its reach...
    expect(sim.enemies!.has(crawler)).toBe(false);
    expect(sim.felled).toBe(1);
    // ...and never so much as scratched the stag that stood in it.
    const states = Array.from({ length: 4 }, createWildState);
    sim.wildlife!.write(states);
    expect(states[0]!.health).toBe(255);
    expect(states[0]!.flags & WILD_FLAG.angry).toBe(0);
  });
});
