import { describe, expect, it } from 'vitest';
import { CYCLE_SECONDS, DAY_SECONDS } from '../../src/shared/daycycle';
import { ENEMY_KIND, createEnemyState, type EnemyState } from '../../src/shared/enemy-state';
import { angleDelta } from '../../src/shared/look';
import { nightStart, SIM_HZ, type SurvivalEvent } from '../../src/shared/survival-state';
import { ENEMIES, WAVES } from '../../src/systems/survival/balance';
import { SurvivalSim, type SurvivalOptions } from '../../src/systems/survival/sim';
import {
  healthScaleOnNight,
  kindsOnNight,
  machinesOnNight,
  planNight,
  type WaveKind,
} from '../../src/systems/survival/waves';
import { flatWorld } from './helpers/nav-world';

const count = (kinds: readonly WaveKind[], kind: WaveKind): number =>
  kinds.filter((candidate) => candidate === kind).length;

describe('the plan of a night', () => {
  it('follows the notes of the spec for the first four nights: 6, 8, 10, then 12 and one armored', () => {
    expect([1, 2, 3, 4].map(machinesOnNight)).toEqual([6, 8, 10, 13]);
    expect(count(kindsOnNight(4), 'armored')).toBe(1);
    expect(count(kindsOnNight(4), 'crawler')).toBe(12);
  });

  it('adds two a night after that, the special kinds among them', () => {
    expect([5, 6, 7, 8, 9, 10].map(machinesOnNight)).toEqual([15, 17, 19, 21, 23, 25]);
    for (let night = 1; night <= 40; night++) {
      expect(kindsOnNight(night)).toHaveLength(machinesOnNight(night));
    }
  });

  it('takes a night that is not a whole number from 1 on as the night it falls in', () => {
    expect(machinesOnNight(0)).toBe(6);
    expect(machinesOnNight(-4)).toBe(6);
    expect(machinesOnNight(Number.NaN)).toBe(6);
    expect(machinesOnNight(2.9)).toBe(8);
    expect(planNight(2.9).night).toBe(2);
  });

  it('is plain drones for three nights, then an armored one, flyers from the fifth and breachers from the ninth', () => {
    for (const night of [1, 2, 3]) {
      expect(new Set(kindsOnNight(night))).toEqual(new Set(['crawler']));
    }
    const specials = (night: number) => ({
      armored: count(kindsOnNight(night), 'armored'),
      flyer: count(kindsOnNight(night), 'flyer'),
      breacher: count(kindsOnNight(night), 'breacher'),
    });
    expect(specials(4)).toEqual({ armored: 1, flyer: 0, breacher: 0 });
    expect(specials(5)).toEqual({ armored: 1, flyer: 1, breacher: 0 });
    expect(specials(8)).toEqual({ armored: 2, flyer: 1, breacher: 0 });
    expect(specials(9)).toEqual({ armored: 2, flyer: 2, breacher: 1 });
    expect(specials(13)).toEqual({ armored: 4, flyer: 3, breacher: 2 });
  });

  it('puts the tougher kinds last, so that they come with the last wave of the night', () => {
    for (const night of [4, 5, 9, 12]) {
      const kinds = kindsOnNight(night);
      const firstSpecial = kinds.findIndex((kind) => kind !== 'crawler');
      expect(firstSpecial).toBeGreaterThan(0);
      expect(kinds.slice(firstSpecial).every((kind) => kind !== 'crawler')).toBe(true);
      const last = planNight(night).waves.at(-1)!;
      expect(last.kinds.at(-1)).not.toBe('crawler');
    }
  });

  it('makes the machines a little tougher from the third night, and 8 percent tougher each night from the fifth', () => {
    expect(healthScaleOnNight(1)).toBe(1);
    expect(healthScaleOnNight(2)).toBe(1);
    expect(healthScaleOnNight(3)).toBeCloseTo(1.1, 10);
    expect(healthScaleOnNight(4)).toBeCloseTo(1.1, 10);
    expect(healthScaleOnNight(5)).toBeCloseTo(1.1 * 1.08, 10);
    expect(healthScaleOnNight(10) / healthScaleOnNight(9)).toBeCloseTo(1.08, 10);
    expect(healthScaleOnNight(1)).toBeLessThan(healthScaleOnNight(7));
  });

  it('brings a night in waves of about six, and in no more than six waves', () => {
    expect([1, 2, 3, 4, 5, 7, 10, 99].map((night) => planNight(night).waves.length)).toEqual([
      1, 2, 2, 3, 3, 4, 5, 6,
    ]);
  });

  it('shares the machines out as evenly as it can, the larger waves last, and loses none', () => {
    for (let night = 1; night <= 60; night++) {
      const plan = planNight(night);
      const sizes = plan.waves.map((wave) => wave.kinds.length);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(plan.total);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
      expect(plan.waves.flatMap((wave) => wave.kinds)).toEqual(kindsOnNight(night));
    }
  });

  it('spaces the waves: the first soon after nightfall, the last in time to be met, and the crew told ten seconds ahead', () => {
    const { firstAt, lastAt, maxGap, warning } = WAVES.timing;
    for (let night = 1; night <= 40; night++) {
      const { waves } = planNight(night);
      expect(waves[0]?.comesAt).toBe(firstAt);
      expect(waves.at(-1)?.comesAt).toBeLessThanOrEqual(lastAt);
      for (const [i, wave] of waves.entries()) {
        expect(wave.warnAt).toBe(Math.max(0, wave.comesAt - warning));
        if (i > 0) {
          const gap = wave.comesAt - (waves[i - 1] as { comesAt: number }).comesAt;
          expect(gap).toBeGreaterThan(0);
          expect(gap).toBeLessThanOrEqual(maxGap + 1e-9);
        }
      }
    }
    // The pace on the first nights: one wave at 14 s; then 14 s and 84 s; then three 70 s apart.
    expect(planNight(1).waves.map((wave) => wave.comesAt)).toEqual([14]);
    expect(planNight(2).waves.map((wave) => wave.comesAt)).toEqual([14, 84]);
    expect(planNight(4).waves.map((wave) => wave.comesAt)).toEqual([14, 84, 154]);
  });
});

/** A run on flat ground with the Core on it, at the start of a night unless told otherwise. */
function run(options: SurvivalOptions = {}): SurvivalSim {
  const flat = flatWorld();
  return new SurvivalSim({
    core: flat.core,
    nav: flat.world,
    seed: 7,
    startAt: nightStart(1),
    ...options,
  });
}

function eventsOf(sim: SurvivalSim): SurvivalEvent[] {
  const out: SurvivalEvent[] = [];
  sim.drainEvents(out);
  return out;
}

function machinesOf(sim: SurvivalSim): EnemyState[] {
  const states = Array.from({ length: ENEMIES.maxAlive }, createEnemyState);
  const n = sim.enemies!.write(states);
  return states.slice(0, n).map((state) => ({ ...state }));
}

/**
 * Plays `seconds` and takes the machines off the field after each second, so that none of them
 * reaches the Core and the run goes on. Returns how many came out of the ground: ids count up from 1.
 */
function playClearing(sim: SurvivalSim, seconds: number): number {
  let highest = 0;
  for (let t = 0; t < seconds; t++) {
    sim.warp(1);
    for (const machine of machinesOf(sim)) highest = Math.max(highest, machine.id);
    sim.enemies!.clear();
  }
  return highest;
}

/**
 * Plays a night up to the step that brings out the last machine of its last wave, clearing the field
 * every second on the way, so that the machines of that wave are the only ones on it.
 */
function playClearingUntilLast(sim: SurvivalSim, night: number): void {
  const last = planNight(night).waves.at(-1)!;
  const release = Math.round(WAVES.timing.release * SIM_HZ);
  const lastStep = Math.round(last.comesAt * SIM_HZ) + (last.kinds.length - 1) * release;
  const wholeSeconds = Math.floor(lastStep / SIM_HZ) - 1;
  playClearing(sim, wholeSeconds);
  sim.warp((lastStep - wholeSeconds * SIM_HZ) / SIM_HZ);
}

const positions = (sim: SurvivalSim): [number, number][] =>
  machinesOf(sim).map((machine) => [machine.x, machine.z]);

describe('the waves of a run', () => {
  it('send nothing by day', () => {
    const sim = run({ startAt: 0 });
    sim.warp(DAY_SECONDS - 1);
    expect(sim.enemies?.count).toBe(0);
    expect(eventsOf(sim)).toEqual([]);
  });

  it('warn ten seconds ahead, then bring the machines out of the ground a little apart', () => {
    const sim = run();
    sim.warp(3.95);
    expect(eventsOf(sim)).toEqual([]);
    sim.warp(0.05);
    expect(eventsOf(sim)).toEqual([{ k: 'wave', n: 1, i: 1, of: 1, c: 6 }]);
    sim.warp(9.9);
    expect(sim.enemies?.count).toBe(0);
    sim.warp(0.1);
    expect(sim.enemies?.count).toBe(1);
    sim.warp(0.4);
    expect(sim.enemies?.count).toBe(2);
    sim.warp(1.2);
    expect(sim.enemies?.count).toBe(5);
    sim.warp(0.4);
    expect(sim.enemies?.count).toBe(6);
    sim.warp(4);
    expect(sim.enemies?.count).toBe(6);
    expect(eventsOf(sim)).toEqual([]);
  });

  it('announce the second wave of a night when it is due, with the number of the wave and its size', () => {
    const sim = run({ startAt: nightStart(2) });
    sim.warp(80);
    expect(eventsOf(sim)).toEqual([
      { k: 'wave', n: 2, i: 1, of: 2, c: 4 },
      { k: 'wave', n: 2, i: 2, of: 2, c: 4 },
    ]);
  });

  it('tell the nightfall, the waves and the dawn in the order they come', () => {
    const sim = run({ startAt: DAY_SECONDS - 1 });
    expect(playClearing(sim, 1 + 238)).toBe(machinesOnNight(1));
    sim.warp(2);
    expect(eventsOf(sim).map((event) => event.k)).toEqual(['nightfall', 'wave', 'dawn']);
  });

  it('bring every machine of every night, whatever the night', () => {
    for (const night of [1, 2, 3, 4, 5, 9, 10, 20]) {
      const sim = run({ startAt: nightStart(night) });
      expect(playClearing(sim, 200), `night ${night}`).toBe(machinesOnNight(night));
    }
  });

  it('let the machines still standing at dawn fall back', () => {
    const sim = run({ startAt: nightStart(1) + 236 });
    sim.enemies!.spawn(3);
    sim.warp(3.9);
    expect(sim.enemies?.count).toBe(3);
    sim.warp(0.1);
    expect(sim.enemies?.count).toBe(0);
    expect(eventsOf(sim).map((event) => event.k)).toEqual(['dawn']);
  });

  it('make the machines tougher with the nights, and the armored one tougher still', () => {
    // A crawler has 30 points: ten blows fell it on the first night.
    const first = run();
    first.warp(14);
    const [lone] = machinesOf(first);
    expect(first.enemies!.hurt(lone!.id, 29.9)).toBe(false);
    expect(first.enemies!.hurt(lone!.id, 0.2)).toBe(true);

    // On the third night it has a tenth more: 33.
    const third = run({ startAt: nightStart(3) });
    third.warp(14);
    const [tougher] = machinesOf(third);
    expect(third.enemies!.hurt(tougher!.id, 32.9)).toBe(false);
    expect(third.enemies!.hurt(tougher!.id, 0.2)).toBe(true);

    // The armored one of the fourth night comes last, with two and a half times that (82.5 points), and
    // its plating lets only 60 percent of every blow through: it takes 137.5 points of blows to fell.
    const fourth = run({ startAt: nightStart(4) });
    playClearingUntilLast(fourth, 4);
    const armored = machinesOf(fourth).at(-1)!;
    expect(armored.kind).toBe(ENEMY_KIND.armored);
    expect(fourth.enemies!.hurt(armored.id, 137.5 - 0.1)).toBe(false);
    expect(fourth.enemies!.hurt(armored.id, 0.2)).toBe(true);
  });

  it('bring the armored ones as armored crawlers, and the flyers and breachers as crawlers until their parts are built', () => {
    const sim = run({ startAt: nightStart(9) });
    // Every machine of the night, once, with the kind it came as.
    const kinds = new Map<number, number>();
    for (let t = 0; t < 200; t++) {
      sim.warp(1);
      for (const machine of machinesOf(sim)) kinds.set(machine.id, machine.kind);
      sim.enemies!.clear();
    }
    const plan = kindsOnNight(9);
    expect(kinds.size).toBe(plan.length);
    const count = (kind: number): number => [...kinds.values()].filter((k) => k === kind).length;
    expect(count(ENEMY_KIND.armored)).toBe(plan.filter((kind) => kind === 'armored').length);
    expect(count(ENEMY_KIND.armored)).toBe(2);
    // The plain ones, the two flyers and the breacher all walk as crawlers.
    expect(count(ENEMY_KIND.crawler)).toBe(plan.length - 2);
  });

  it('bring a wave in from one side of the ring, and the next from another', () => {
    const sim = run({ startAt: nightStart(3) });
    const { core } = flatWorld();
    const around = (machine: EnemyState) => Math.atan2(machine.z - core.z, machine.x - core.x);
    sim.warp(17);
    const first = machinesOf(sim);
    expect(first).toHaveLength(5);
    for (const machine of first) {
      expect(Math.abs(angleDelta(around(machine), around(first[0]!)))).toBeLessThan(2 * WAVES.arc);
    }
    sim.enemies!.clear();
    sim.warp(70);
    const second = machinesOf(sim);
    expect(second.length).toBeGreaterThan(0);
    // The two sides are drawn apart; for this seed they are not the same.
    expect(Math.abs(angleDelta(around(second[0]!), around(first[0]!)))).toBeGreaterThan(0.1);
  });

  it('play the same waves from the same seed, however the earlier nights went, and other waves from another', () => {
    // A run that came through the first night and the day after it, and one that opens on the second.
    const long = run();
    playClearing(long, CYCLE_SECONDS - DAY_SECONDS);
    long.warp(DAY_SECONDS);
    long.warp(20);
    const short = run({ startAt: nightStart(2) });
    short.warp(20);
    expect(positions(short).length).toBeGreaterThan(0);
    expect(positions(long)).toEqual(positions(short));

    const other = run({ startAt: nightStart(2), seed: 8 });
    other.warp(20);
    expect(positions(other)).not.toEqual(positions(short));
  });

  it('stop at the cap: a full field takes no more machines and the run goes on', () => {
    const sim = run();
    expect(sim.enemies!.spawn(ENEMIES.maxAlive)).toBe(ENEMIES.maxAlive);
    sim.warp(16);
    expect(sim.enemies?.count).toBe(ENEMIES.maxAlive);
    expect(sim.over).toBe(false);
  });

  it('skip the waves whose time has passed when a run opens in the middle of a night', () => {
    const sim = run({ startAt: nightStart(1) + 100 });
    sim.warp(139);
    expect(sim.enemies?.count).toBe(0);
    sim.warp(1);
    expect(eventsOf(sim).map((event) => event.k)).toEqual(['dawn']);
  });

  it('are off with waves: false, and where the world gave the run no ground', () => {
    const quiet = run({ waves: false });
    quiet.warp(60);
    expect(quiet.enemies?.count).toBe(0);
    expect(eventsOf(quiet)).toEqual([]);

    const bare = new SurvivalSim({ startAt: nightStart(1) });
    bare.warp(60);
    expect(eventsOf(bare)).toEqual([]);
  });
});
