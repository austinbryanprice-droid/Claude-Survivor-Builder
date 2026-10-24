import { describe, expect, it } from 'vitest';
import { ENEMY_FLAG, createEnemyState, type EnemyState } from '../../src/shared/enemy-state';
import { createRng } from '../../src/shared/hash';
import { angleDelta } from '../../src/shared/look';
import { SIM_STEP_SECONDS } from '../../src/shared/survival-state';
import { ENEMIES } from '../../src/systems/survival/balance';
import { EnemySim, type Strikes, type Target } from '../../src/systems/survival/enemies';
import { NavGrid, type NavCell } from '../../src/systems/survival/nav';
import { ALLOY, SCRAP, flatWorld } from './helpers/nav-world';

const CRAWLER = ENEMIES.crawler;

interface Fight {
  flat: ReturnType<typeof flatWorld>;
  nav: NavGrid;
  sim: EnemySim;
  /** The blows struck so far. */
  core: number[];
  players: [number, number][];
  targets: Target[];
  strikes: Strikes;
  /** Plays this many seconds. */
  run(seconds: number): void;
  /** Where the enemies are, in the order the sim lists them. */
  where(): EnemyState[];
}

function fight(seed = 7, flat = flatWorld()): Fight {
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
  return {
    flat,
    nav,
    sim,
    core,
    players,
    targets,
    strikes,
    run(seconds) {
      const steps = Math.round(seconds / SIM_STEP_SECONDS);
      for (let i = 0; i < steps; i++) sim.step(SIM_STEP_SECONDS, targets, targets.length, strikes);
    },
    where() {
      const n = sim.write(states);
      return states.slice(0, n).map((state) => ({ ...state }));
    },
  };
}

const distanceToCore = (f: Fight, e: EnemyState): number => {
  const core = f.flat.core;
  const dx = Math.max(core.cellX - e.x, 0, e.x - (core.cellX + 3));
  const dz = Math.max(core.cellZ - e.z, 0, e.z - (core.cellZ + 3));
  return Math.hypot(dx, dz);
};

describe('where they come from', () => {
  it('appear on the ring round the Core, on open ground, and the same way for the same seed', () => {
    const a = fight(11);
    expect(a.sim.spawn(20)).toBe(20);
    const first = a.where();
    expect(first).toHaveLength(20);
    for (const e of first) {
      const radius = Math.hypot(e.x - a.flat.core.x, e.z - a.flat.core.z);
      expect(radius).toBeGreaterThanOrEqual(ENEMIES.spawnRadius - ENEMIES.spawnJitter - 0.01);
      expect(radius).toBeLessThanOrEqual(ENEMIES.spawnRadius + ENEMIES.spawnJitter + 0.01);
      expect(a.nav.pointClear(e.x, e.z)).toBe(true);
    }
    const again = fight(11);
    again.sim.spawn(20);
    expect(again.where()).toEqual(first);
    const other = fight(12);
    other.sim.spawn(20);
    expect(other.where()).not.toEqual(first);
  });

  it('come in as many as the cap allows and no more, each with its own id', () => {
    const f = fight();
    expect(f.sim.spawn(ENEMIES.maxAlive + 50)).toBe(ENEMIES.maxAlive);
    expect(f.sim.count).toBe(ENEMIES.maxAlive);
    expect(f.sim.spawn(1)).toBe(0);
    expect(new Set(f.where().map((e) => e.id)).size).toBe(ENEMIES.maxAlive);
  });

  it('can be brought in from one stretch of the ring, with numbers of the caller’s own', () => {
    const f = fight(11);
    const bearing = 1.2;
    const arc = 0.4;
    expect(f.sim.spawn(12, 1, { rng: createRng(99), bearing, arc })).toBe(12);
    for (const e of f.where()) {
      const angle = Math.atan2(e.z - f.flat.core.z, e.x - f.flat.core.x);
      expect(Math.abs(angleDelta(angle, bearing))).toBeLessThanOrEqual(arc + 1e-9);
    }
    // The simulation's own stream was left alone: what it brings next is what a fresh one brings first.
    f.sim.clear();
    f.sim.spawn(3);
    const fresh = fight(11);
    fresh.sim.spawn(3);
    expect(f.where().map((e) => [e.x, e.z])).toEqual(fresh.where().map((e) => [e.x, e.z]));
    // The same numbers bring them to the same places.
    const twin = fight(5);
    twin.sim.spawn(12, 1, { rng: createRng(99), bearing, arc });
    const other = fight(6);
    other.sim.spawn(12, 1, { rng: createRng(99), bearing, arc });
    expect(twin.where().map((e) => [e.x, e.z])).toEqual(other.where().map((e) => [e.x, e.z]));
  });

  it('spread out over the rest of the ring when their stretch of it is deep water', () => {
    const bearing = 1.2;
    const lake = (x: number, z: number): number => {
      const angle = Math.atan2(z + 3.5, x + 1.5);
      return Math.abs(angleDelta(angle, bearing)) < 0.5 ? -5 : 10;
    };
    const f = fight(3, flatWorld({ height: lake }));
    expect(f.sim.spawn(6, 1, { rng: createRng(4), bearing, arc: 0.3 })).toBe(6);
    for (const e of f.where()) {
      const angle = Math.atan2(e.z - f.flat.core.z, e.x - f.flat.core.x);
      expect(Math.abs(angleDelta(angle, bearing))).toBeGreaterThan(0.3);
    }
  });

  it('do not appear where there is no way to the Core', () => {
    // The Core stands in a bowl that is too steep to climb on every side.
    const flat = flatWorld({ height: (x, z) => (Math.hypot(x + 1.5, z + 3.5) < 8 ? 10 : 14) });
    const f = fight(3, flat);
    expect(f.sim.spawn(5)).toBe(0);
    expect(f.sim.count).toBe(0);
  });
});

describe('marching on the Core', () => {
  it('walks the straight way across open ground and bites the Core when it arrives', () => {
    const f = fight();
    const id = f.sim.spawnAt(20.5, -3.5);
    expect(id).not.toBeNull();
    f.run(6);
    // Six seconds at 2.6 blocks a second is not enough to cover twenty blocks.
    expect(f.core).toHaveLength(0);
    const midway = f.where()[0] as EnemyState;
    expect(midway.x).toBeGreaterThan(3);
    expect(midway.x).toBeLessThan(8);
    // It keeps to its row.
    expect(midway.z).toBeCloseTo(-3.5, 1);
    f.run(4);
    expect(f.core.length).toBeGreaterThanOrEqual(2);
    for (const blow of f.core) expect(blow).toBe(CRAWLER.bite.core);
    expect(distanceToCore(f, f.where()[0] as EnemyState)).toBeLessThanOrEqual(CRAWLER.reach.core);
  });

  it('bites once for each interval and winds up first', () => {
    const f = fight();
    f.sim.spawnAt(0.8, -3.5);
    // Close enough already: the first bite begins at once and lands after the wind-up.
    f.run(CRAWLER.bite.windup - 0.1);
    expect(f.core).toHaveLength(0);
    expect((f.where()[0] as EnemyState).flags & ENEMY_FLAG.attack).toBe(ENEMY_FLAG.attack);
    f.run(0.2);
    expect(f.core).toHaveLength(1);
    expect((f.where()[0] as EnemyState).flags & ENEMY_FLAG.attack).toBe(0);
    // The next one begins an interval after the first began, and the one after that an interval later.
    f.run(CRAWLER.bite.interval * 2 + 0.3);
    expect(f.core.length).toBeGreaterThanOrEqual(3);
    expect(f.core.length).toBeLessThanOrEqual(4);
  });

  it('crowds round the Core instead of standing on one spot', () => {
    const f = fight();
    for (let i = 0; i < 8; i++) f.sim.spawnAt(12.5 + (i % 2) * 0.1, -3.5 + i * 0.05);
    f.run(10);
    const crowd = f.where();
    let closest = Infinity;
    for (let i = 0; i < crowd.length; i++) {
      for (let j = i + 1; j < crowd.length; j++) {
        const a = crowd[i] as EnemyState;
        const b = crowd[j] as EnemyState;
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
    expect(closest).toBeGreaterThan(CRAWLER.radius * 1.4);
    // And more than one gets to bite.
    expect(f.core.length).toBeGreaterThan(8);
  });

  it('goes round a short wall', () => {
    const f = fight();
    for (let z = -6; z <= -2; z++) {
      f.flat.place(8, 10, z);
      f.nav.cellChanged(8, 10, z);
    }
    f.nav.solve();
    f.sim.spawnAt(14.5, -3.5);
    f.run(11);
    const e = f.where()[0] as EnemyState;
    // Past the wall's column, and it did not chew: every block is still there.
    expect(e.x).toBeLessThan(8);
    for (let z = -6; z <= -2; z++) expect(f.flat.world.blockAt(8, 10, z)).toBe(SCRAP);
    const out: NavCell[] = [];
    f.sim.drainBreaks(out);
    expect(out).toHaveLength(0);
  });
});

describe('chewing through walls', () => {
  /** A wall too long to go round, across the way east. */
  function longWall(state = SCRAP): Fight {
    const f = fight();
    for (let z = -30; z <= 30; z++) {
      f.flat.place(8, 10, z, state);
      f.nav.cellChanged(8, 10, z);
    }
    f.nav.solve();
    return f;
  }

  it('chews the block in its way for as long as that block holds, then asks for it to be broken', () => {
    const f = longWall();
    f.sim.spawnAt(11.5, -3.5);
    const seconds = CRAWLER.gnawSeconds[1] as number;
    // It walks up to the wall in under a second, then chews for as long as the block holds.
    f.run(1);
    const out: NavCell[] = [];
    f.sim.drainBreaks(out);
    expect(out).toHaveLength(0);
    f.run(seconds - 0.5);
    f.sim.drainBreaks(out);
    expect(out).toHaveLength(0);
    f.run(1.5);
    f.sim.drainBreaks(out);
    expect(out).toHaveLength(1);
    expect(out[0]?.x).toBe(8);
    expect(out[0]?.y).toBe(10);
    expect(out[0]?.z).toBeGreaterThanOrEqual(-5);
    expect(out[0]?.z).toBeLessThanOrEqual(-3);
  });

  it('takes longer over a tougher block', () => {
    const scrap = longWall(SCRAP);
    const alloy = longWall(ALLOY);
    scrap.sim.spawnAt(9.5, -3.5);
    alloy.sim.spawnAt(9.5, -3.5);
    const broke = (f: Fight): number => {
      const out: NavCell[] = [];
      for (let step = 0; step < 20 * 30; step++) {
        f.run(SIM_STEP_SECONDS);
        f.sim.drainBreaks(out);
        if (out.length > 0) return (step + 1) * SIM_STEP_SECONDS;
      }
      return Infinity;
    };
    const soft = broke(scrap);
    const hard = broke(alloy);
    // Standing against the wall already, it takes the block's time to the step.
    for (const [took, material] of [
      [soft, 1],
      [hard, 3],
    ] as const) {
      const holds = CRAWLER.gnawSeconds[material] as number;
      expect(took).toBeGreaterThanOrEqual(holds - 1e-6);
      expect(took).toBeLessThanOrEqual(holds + 0.15);
    }
    expect(hard).toBeGreaterThan(soft * 2);
  });

  it('chews faster together', () => {
    const lone = longWall();
    const pair = longWall();
    // Two in one column, a body apart, work at the same block.
    lone.sim.spawnAt(9.5, -3.5);
    pair.sim.spawnAt(9.5, -3.95);
    pair.sim.spawnAt(9.5, -3.05);
    const seconds = CRAWLER.gnawSeconds[1] as number;
    const out: NavCell[] = [];
    pair.run(seconds * 0.7);
    pair.sim.drainBreaks(out);
    expect(out.length).toBeGreaterThan(0);
    out.length = 0;
    lone.run(seconds * 0.7);
    lone.sim.drainBreaks(out);
    expect(out).toHaveLength(0);
  });

  it('walks on through the gap once the host has broken the block', () => {
    const f = longWall();
    f.sim.spawnAt(9.5, -3.5);
    f.run((CRAWLER.gnawSeconds[1] as number) + 1);
    const out: NavCell[] = [];
    f.sim.drainBreaks(out);
    expect(out.length).toBeGreaterThan(0);
    for (const cell of out) {
      f.flat.remove(cell.x, cell.y, cell.z);
      f.sim.blockChanged(cell.x, cell.y, cell.z);
    }
    f.run(4);
    const e = f.where()[0] as EnemyState;
    expect(e.x).toBeLessThan(7.5);
    // Through to the Core, and biting it.
    f.run(4);
    expect(f.core.length).toBeGreaterThan(0);
  });

  it('lets a half-chewed block mend when the chewer goes', () => {
    const f = longWall();
    f.sim.spawnAt(9.5, -3.5);
    const seconds = CRAWLER.gnawSeconds[1] as number;
    f.run(seconds * 0.6);
    // Take the enemy away, and let the wall alone for long enough to forget it.
    f.sim.clear();
    f.run(seconds);
    f.sim.spawnAt(9.5, -3.5);
    f.run(seconds * 0.6);
    const out: NavCell[] = [];
    f.sim.drainBreaks(out);
    expect(out).toHaveLength(0);
  });
});

describe('going after a player', () => {
  const standAt = (f: Fight, id: number, x: number, z: number, y = 10): Target => {
    const target = { id, x, y, z };
    f.targets.length = 0;
    f.targets.push(target);
    return target;
  };

  it('turns aside for a player who is near, walks up and bites', () => {
    const f = fight();
    f.sim.spawnAt(20.5, -3.5);
    standAt(f, 2, 20.5, 2.5);
    f.run(4);
    expect(f.players.length).toBeGreaterThan(0);
    for (const [id, amount] of f.players) {
      expect(id).toBe(2);
      expect(amount).toBe(CRAWLER.bite.player);
    }
    // It went for the player, not the Core.
    expect(f.core).toHaveLength(0);
    expect((f.where()[0] as EnemyState).z).toBeGreaterThan(-0.5);
  });

  it('ignores a player who is far away', () => {
    const f = fight();
    f.sim.spawnAt(20.5, -3.5);
    standAt(f, 2, 20.5, 20.5);
    f.run(4);
    expect(f.players).toHaveLength(0);
    expect((f.where()[0] as EnemyState).z).toBeCloseTo(-3.5, 1);
  });

  it('leaves a downed player alone: they are not a target any more', () => {
    const f = fight();
    f.sim.spawnAt(20.5, -3.5);
    f.targets.length = 0;
    f.run(6);
    expect(f.players).toHaveLength(0);
  });

  it('misses a player who steps out of reach during the wind-up', () => {
    const f = fight();
    f.sim.spawnAt(10.5, 0.5);
    const target = standAt(f, 2, 11.5, 0.5);
    f.run(CRAWLER.bite.windup / 2);
    expect(f.players).toHaveLength(0);
    target.x = 15;
    f.run(CRAWLER.bite.windup);
    // It followed, did not bite, and the wind-up began over again when it caught up.
    expect(f.players).toHaveLength(0);
  });

  it('cannot bite a player standing high above it', () => {
    const f = fight();
    f.sim.spawnAt(10.5, 0.5);
    standAt(f, 2, 10.5, 1.0, 14);
    f.run(3);
    expect(f.players).toHaveLength(0);
  });

  it('keeps its choice at the edge of its pull', () => {
    const f = fight();
    f.sim.spawnAt(20.5, -3.5);
    // Inside the pull: the enemy turns toward the player...
    const target = standAt(f, 2, 20.5, -3.5 + CRAWLER.aggro - 0.5);
    f.run(0.5);
    const gone = (f.where()[0] as EnemyState).z;
    expect(gone).toBeGreaterThan(-3.5);
    // ...and a step out past the pull, but not past the extra it holds on for, does not lose it.
    target.z = -3.5 + CRAWLER.aggro * 1.15;
    const before = (f.where()[0] as EnemyState).z;
    f.run(0.5);
    expect((f.where()[0] as EnemyState).z).toBeGreaterThan(before);
  });
});

describe('taking a blow', () => {
  it('flashes, loses health and dies at none', () => {
    const f = fight();
    const id = f.sim.spawnAt(20.5, -3.5) as number;
    expect((f.where()[0] as EnemyState).health).toBe(255);
    expect(f.sim.hurt(id, CRAWLER.health / 3)).toBe(false);
    const wounded = f.where()[0] as EnemyState;
    expect(wounded.health).toBeCloseTo(170, 0);
    expect(wounded.flags & ENEMY_FLAG.hurt).toBe(ENEMY_FLAG.hurt);
    f.run(ENEMIES.hurtFlashSeconds + 0.1);
    expect((f.where()[0] as EnemyState).flags & ENEMY_FLAG.hurt).toBe(0);
    expect(f.sim.hurt(id, CRAWLER.health)).toBe(true);
    expect(f.sim.count).toBe(0);
    // Nothing to hurt twice, and not a blow that is no use.
    expect(f.sim.hurt(id, 5)).toBe(false);
    const other = f.sim.spawnAt(20.5, -3.5) as number;
    expect(f.sim.hurt(other, 0)).toBe(false);
    expect(f.sim.hurt(other, -5)).toBe(false);
    expect(f.sim.count).toBe(1);
  });

  it('counts every change that comes from outside the step, so a watcher can tell', () => {
    const f = fight();
    const start = f.sim.revision;
    const id = f.sim.spawnAt(20.5, -3.5) as number;
    expect(f.sim.revision).toBeGreaterThan(start);
    const afterSpawn = f.sim.revision;
    f.run(1);
    expect(f.sim.revision).toBe(afterSpawn);
    f.sim.hurt(id, 1);
    expect(f.sim.revision).toBeGreaterThan(afterSpawn);
  });

  it('carries more health when told to (the later nights)', () => {
    const f = fight();
    const id = f.sim.spawnAt(20.5, -3.5, 2) as number;
    f.sim.hurt(id, CRAWLER.health);
    // 30 off 60 leaves half.
    expect((f.where()[0] as EnemyState).health).toBeCloseTo(128, 0);
  });
});

describe('being built on', () => {
  it('lets an enemy that a block was placed beside walk out', () => {
    const f = fight();
    const id = f.sim.spawnAt(20.5, -3.5);
    expect(id).not.toBeNull();
    // Wall it in on three sides, leaving the west open.
    for (const [x, z] of [
      [21, -4],
      [21, -3],
      [20, -5],
      [21, -5],
      [20, -2],
      [21, -2],
    ] as const) {
      f.flat.place(x, 10, z);
      f.sim.blockChanged(x, 10, z);
    }
    f.run(12);
    expect((f.where()[0] as EnemyState).x).toBeLessThan(15);
  });
});
