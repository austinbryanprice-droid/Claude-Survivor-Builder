import { describe, expect, it } from 'vitest';
import { CYCLE_SECONDS, DAY_SECONDS } from '../../src/shared/daycycle';
import {
  SIM_HZ,
  createReading,
  nightStart,
  type SurvivalEvent,
} from '../../src/shared/survival-state';
import { SURVIVAL } from '../../src/systems/survival/balance';
import { SurvivalSim } from '../../src/systems/survival/sim';

function eventsOf(sim: SurvivalSim): SurvivalEvent[] {
  const out: SurvivalEvent[] = [];
  sim.drainEvents(out);
  return out;
}

describe('the survival simulation', () => {
  it('starts at the first morning and counts whole steps', () => {
    const sim = new SurvivalSim();
    expect(sim.tick).toBe(0);
    expect(sim.elapsed).toBe(0);
    sim.advance(1);
    expect(sim.tick).toBe(SIM_HZ);
    expect(sim.elapsed).toBe(1);
  });

  it('keeps the part of a step it has not taken for the next call', () => {
    const sim = new SurvivalSim();
    sim.advance(0.03);
    expect(sim.tick).toBe(0);
    sim.advance(0.03);
    expect(sim.tick).toBe(1);
    // A hundred 16 ms frames are 1.6 seconds, however they fall between the steps.
    const frames = new SurvivalSim();
    for (let i = 0; i < 100; i++) frames.advance(0.016);
    expect(frames.tick).toBe(32);
  });

  it('plays the same run however the time is cut up', () => {
    const whole = new SurvivalSim();
    whole.advance(1.5);
    const cut = new SurvivalSim();
    for (let i = 0; i < 30; i++) cut.advance(0.05);
    expect(cut.tick).toBe(whole.tick);
  });

  it('cuts a long gap short instead of replaying it', () => {
    const sim = new SurvivalSim();
    sim.advance(60);
    expect(sim.elapsed).toBe(SURVIVAL.maxCatchUpSeconds);
  });

  it('ignores a gap that is not a positive number', () => {
    const sim = new SurvivalSim();
    sim.advance(0);
    sim.advance(-3);
    sim.advance(Number.NaN);
    expect(sim.tick).toBe(0);
  });

  it('starts where it is told, rounded to a step', () => {
    expect(new SurvivalSim({ startAt: nightStart(3) }).elapsed).toBe(nightStart(3));
    expect(new SurvivalSim({ startAt: 10.04 }).tick).toBe(Math.round(10.04 * SIM_HZ));
    expect(new SurvivalSim({ startAt: -5 }).tick).toBe(0);
  });

  it('announces nightfall, then dawn, as each is crossed and not before', () => {
    const sim = new SurvivalSim();
    sim.warp(DAY_SECONDS - 0.05);
    expect(eventsOf(sim)).toEqual([]);
    sim.warp(0.05);
    expect(eventsOf(sim)).toEqual([{ k: 'nightfall', n: 1 }]);
    sim.warp(CYCLE_SECONDS - DAY_SECONDS - 0.05);
    expect(eventsOf(sim)).toEqual([]);
    sim.warp(0.05);
    expect(eventsOf(sim)).toEqual([{ k: 'dawn', n: 1 }]);
  });

  it('numbers the nights and keeps every event in order across several days', () => {
    const sim = new SurvivalSim();
    sim.warp(2 * CYCLE_SECONDS + DAY_SECONDS);
    expect(eventsOf(sim)).toEqual([
      { k: 'nightfall', n: 1 },
      { k: 'dawn', n: 1 },
      { k: 'nightfall', n: 2 },
      { k: 'dawn', n: 2 },
      { k: 'nightfall', n: 3 },
    ]);
    // Drained events are gone.
    expect(eventsOf(sim)).toEqual([]);
  });

  it('does not announce the night it starts in, but does announce its dawn', () => {
    const sim = new SurvivalSim({ startAt: nightStart(4) });
    expect(eventsOf(sim)).toEqual([]);
    sim.warp(CYCLE_SECONDS - DAY_SECONDS);
    expect(eventsOf(sim)).toEqual([{ k: 'dawn', n: 4 }]);
  });

  it('announces a night that advance crosses, too', () => {
    const sim = new SurvivalSim({ startAt: DAY_SECONDS - 1 });
    sim.advance(SURVIVAL.maxCatchUpSeconds);
    expect(eventsOf(sim)).toEqual([{ k: 'nightfall', n: 1 }]);
  });

  it('reads the clock with the part of a step not yet taken counted in', () => {
    const sim = new SurvivalSim();
    sim.advance(0.07);
    const reading = sim.read(createReading());
    expect(reading.elapsed).toBeCloseTo(0.07, 9);
    expect(reading).toMatchObject({ cycle: 1, phase: 'day', running: true });
  });

  it('takes a negative or empty warp as no time at all', () => {
    const sim = new SurvivalSim();
    sim.warp(-10);
    sim.warp(0);
    expect(sim.tick).toBe(0);
  });
});

describe('the Outpost Core in the simulation', () => {
  const MAX = SURVIVAL.core.maxHealth;
  const MEND = SURVIVAL.core.mendPerSecond;

  it('starts whole and says so in every reading', () => {
    const sim = new SurvivalSim();
    expect(sim.coreHealth).toBe(MAX);
    expect(sim.coreMax).toBe(MAX);
    expect(sim.over).toBe(false);
    expect(sim.read(createReading())).toMatchObject({
      coreHealth: MAX,
      coreMax: MAX,
      over: false,
      running: true,
    });
  });

  it('takes the damage it is dealt, in points', () => {
    const sim = new SurvivalSim({ startAt: nightStart(1) });
    expect(sim.hurtCore(120)).toBe(false);
    expect(sim.coreHealth).toBe(MAX - 120);
    sim.hurtCore(0.5);
    // A fraction of a point is still a point of health to the reading.
    expect(sim.coreHealth).toBe(MAX - 120);
    expect(eventsOf(sim)).toEqual([]);
  });

  it('never shows 0 while any health is left, so a gauge at 0 means it has fallen', () => {
    const sim = new SurvivalSim();
    sim.hurtCore(MAX - 0.2);
    expect(sim.over).toBe(false);
    expect(sim.coreHealth).toBe(1);
  });

  it('ignores a blow that is not a positive number', () => {
    const sim = new SurvivalSim();
    for (const amount of [0, -50, Number.NaN, Number.POSITIVE_INFINITY * 0]) {
      expect(sim.hurtCore(amount)).toBe(false);
    }
    expect(sim.coreHealth).toBe(MAX);
  });

  it('falls at 0: the run is over, announced once, with the day or night it fell in', () => {
    const sim = new SurvivalSim({ startAt: nightStart(2) });
    eventsOf(sim);
    expect(sim.hurtCore(MAX - 1)).toBe(false);
    expect(sim.hurtCore(1)).toBe(true);
    expect(sim.over).toBe(true);
    expect(sim.coreHealth).toBe(0);
    expect(eventsOf(sim)).toEqual([{ k: 'overrun', n: 2 }]);
    // A blow after the fall does nothing and says nothing.
    expect(sim.hurtCore(500)).toBe(false);
    expect(eventsOf(sim)).toEqual([]);
  });

  it('can fall by day, counting the day it fell in', () => {
    const sim = new SurvivalSim({ startAt: 3 * CYCLE_SECONDS + 10 });
    expect(sim.hurtCore(MAX)).toBe(true);
    expect(eventsOf(sim)).toEqual([{ k: 'overrun', n: 4 }]);
  });

  it('stops the clock where it fell: nothing advances, warps or announces afterwards', () => {
    const sim = new SurvivalSim({ startAt: DAY_SECONDS - 5 });
    sim.advance(1);
    const tick = sim.tick;
    sim.hurtCore(MAX);
    eventsOf(sim);
    sim.advance(2);
    sim.warp(600);
    expect(sim.tick).toBe(tick);
    expect(eventsOf(sim)).toEqual([]);
    expect(sim.read(createReading())).toMatchObject({
      elapsed: tick / SIM_HZ,
      running: false,
      over: true,
      coreHealth: 0,
    });
  });

  it('stops a warp that carries it over the fall instead of playing on', () => {
    const sim = new SurvivalSim();
    sim.warp(10);
    sim.hurtCore(MAX);
    const tick = sim.tick;
    sim.warp(CYCLE_SECONDS);
    expect(sim.tick).toBe(tick);
  });

  it('mends through the day at the table’s rate', () => {
    const sim = new SurvivalSim({ coreHealth: 400 });
    sim.warp(30);
    expect(sim.coreHealth).toBe(Math.ceil(400 + MEND * 30));
  });

  it('does not mend a point at night', () => {
    const sim = new SurvivalSim({ startAt: nightStart(1), coreHealth: 400 });
    sim.warp(60);
    expect(sim.coreHealth).toBe(400);
  });

  it('is repaired in full over the day that follows a bad night', () => {
    const sim = new SurvivalSim({ startAt: nightStart(1), coreHealth: 1 });
    sim.warp(CYCLE_SECONDS - DAY_SECONDS);
    expect(sim.coreHealth).toBe(1);
    sim.warp(DAY_SECONDS);
    expect(sim.coreHealth).toBe(MAX);
  });

  it('never mends past its full health', () => {
    const sim = new SurvivalSim({ coreHealth: MAX - 1 });
    sim.warp(60);
    expect(sim.coreHealth).toBe(MAX);
    expect(sim.read(createReading()).coreHealth).toBe(MAX);
  });

  it('takes a starting health inside what it can hold', () => {
    expect(new SurvivalSim({ coreHealth: 10 * MAX }).coreHealth).toBe(MAX);
    expect(new SurvivalSim({ coreHealth: -5 }).coreHealth).toBe(1);
  });
});
