import { describe, expect, it } from 'vitest';
import {
  CYCLE_SECONDS,
  DAY_SECONDS,
  NIGHT_SECONDS,
  sunElevationAt,
} from '../../src/shared/daycycle';
import { createReading, nightStart, readClock } from '../../src/shared/survival-state';

function clockAt(elapsed: number) {
  return { ...readClock(elapsed, createReading()) };
}

describe('the run clock', () => {
  it('lasts eight minutes of day and four of night, as Austin approved', () => {
    expect(DAY_SECONDS).toBe(480);
    expect(NIGHT_SECONDS).toBe(240);
    expect(CYCLE_SECONDS).toBe(720);
  });

  it('starts on the first morning with the whole day ahead', () => {
    expect(clockAt(0)).toMatchObject({
      elapsed: 0,
      cycle: 1,
      phase: 'day',
      into: 0,
      left: DAY_SECONDS,
      sky: 0,
    });
  });

  it('turns to night at the end of the day and to the next day at the end of the night', () => {
    expect(clockAt(DAY_SECONDS - 0.05)).toMatchObject({ cycle: 1, phase: 'day' });
    expect(clockAt(DAY_SECONDS)).toMatchObject({ cycle: 1, phase: 'night', into: 0 });
    expect(clockAt(DAY_SECONDS + 100)).toMatchObject({ phase: 'night', into: 100, left: 140 });
    expect(clockAt(CYCLE_SECONDS - 0.05)).toMatchObject({ cycle: 1, phase: 'night' });
    expect(clockAt(CYCLE_SECONDS)).toMatchObject({ cycle: 2, phase: 'day', into: 0 });
    expect(clockAt(2 * CYCLE_SECONDS + DAY_SECONDS + 1)).toMatchObject({
      cycle: 3,
      phase: 'night',
    });
  });

  it('counts the time left in each phase down to zero as the phase ends', () => {
    expect(clockAt(10)).toMatchObject({ into: 10, left: 470 });
    const lastStep = clockAt(DAY_SECONDS - 0.05);
    expect(lastStep.left).toBeCloseTo(0.05, 9);
  });

  it('puts the sky a third of the way round at noon and two thirds at nightfall', () => {
    expect(clockAt(DAY_SECONDS / 2).sky).toBeCloseTo(1 / 3, 12);
    expect(clockAt(DAY_SECONDS).sky).toBeCloseTo(2 / 3, 12);
    expect(clockAt(CYCLE_SECONDS).sky).toBe(0);
  });

  it('reads a negative time as the start and leaves "running" for the caller', () => {
    const reading = createReading();
    reading.running = true;
    readClock(-5, reading);
    expect(reading).toMatchObject({ elapsed: 0, cycle: 1, phase: 'day', running: true });
  });

  it('starts night n at the right second', () => {
    expect(nightStart(1)).toBe(DAY_SECONDS);
    expect(nightStart(2)).toBe(CYCLE_SECONDS + DAY_SECONDS);
    expect(nightStart(5)).toBe(4 * CYCLE_SECONDS + DAY_SECONDS);
    expect(nightStart(0)).toBe(DAY_SECONDS);
    for (const n of [1, 2, 5, 10]) {
      expect(clockAt(nightStart(n))).toMatchObject({ cycle: n, phase: 'night', into: 0 });
    }
  });

  it('gives the sky no jump anywhere, including the turn of the light', () => {
    // The sky is a pure function of the clock's phase; walk it in 0.05 s steps across two cycles.
    let last = sunElevationAt(0);
    let worst = 0;
    for (let t = 0.05; t <= 2 * CYCLE_SECONDS; t += 0.05) {
      const elevation = sunElevationAt(readClock(t, createReading()).sky);
      worst = Math.max(worst, Math.abs(elevation - last));
      last = elevation;
    }
    // The fastest the sun moves is through dusk and dawn, 26 degrees in 40 seconds.
    expect(worst).toBeLessThan(0.7);
  });
});
