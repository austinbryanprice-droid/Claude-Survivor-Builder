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
