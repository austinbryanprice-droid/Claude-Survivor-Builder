import { describe, expect, it } from 'vitest';
import { DAY_SECONDS, NIGHT_SECONDS } from '../../src/shared/daycycle';
import { createReading, readClock } from '../../src/shared/survival-state';
import {
  CLOCK_SOON_SECONDS,
  clockForHud,
  messageFor,
  objectiveForRun,
  runLine,
} from '../../src/ui/run-hud';

function reading(elapsed: number, running = true) {
  const out = readClock(elapsed, createReading());
  out.running = running;
  return out;
}

describe('the clock by the compass', () => {
  it('shows the day, its number and the time until nightfall', () => {
    expect(clockForHud(reading(0))).toEqual({
      phase: 'day',
      label: 'Day 1',
      time: '8:00',
      progress: 0,
      soon: false,
    });
    const midday = clockForHud(reading(DAY_SECONDS / 2 + 12));
    expect(midday).toMatchObject({ label: 'Day 1', time: '3:48', soon: false });
    expect(midday.progress).toBeCloseTo(0.525, 3);
  });

  it('shows the night, its number and the time until dawn', () => {
    const night = clockForHud(reading(DAY_SECONDS + 60));
    expect(night).toMatchObject({ phase: 'night', label: 'Night 1', time: '3:00' });
    expect(night.progress).toBeCloseTo(60 / NIGHT_SECONDS, 6);
    expect(clockForHud(reading(720 + DAY_SECONDS + 1))).toMatchObject({ label: 'Night 2' });
    expect(clockForHud(reading(720))).toMatchObject({ phase: 'day', label: 'Day 2' });
  });

  it('turns urgent for the last half minute of the day and of the night', () => {
    expect(CLOCK_SOON_SECONDS).toBe(30);
    expect(clockForHud(reading(DAY_SECONDS - 31)).soon).toBe(false);
    expect(clockForHud(reading(DAY_SECONDS - 30)).soon).toBe(true);
    expect(clockForHud(reading(DAY_SECONDS - 1))).toMatchObject({ soon: true, time: '0:01' });
    expect(clockForHud(reading(DAY_SECONDS + 100)).soon).toBe(false);
    expect(clockForHud(reading(720 - 20)).soon).toBe(true);
  });

  it('keeps the progress within its bar', () => {
    for (let t = 0; t < 1500; t += 7.3) {
      const { progress } = clockForHud(reading(t));
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });
});

describe('what the HUD says about the run', () => {
  it('asks for building by day and for holding out at night', () => {
    expect(objectiveForRun(reading(10))).toEqual({
      place: 'The Ashbound Outpost',
      title: 'Build up before nightfall',
    });
    expect(objectiveForRun(reading(DAY_SECONDS + 10)).title).toBe('Hold the outpost until dawn');
  });

  it('puts the time on the pause card and says when the clock is waiting', () => {
    expect(runLine(reading(0))).toBe('Day 1 · 8:00 until nightfall');
    expect(runLine(reading(DAY_SECONDS + 5))).toBe('Night 1 · 3:55 until dawn');
    expect(runLine(reading(100, false))).toBe(
      'Day 1 · 6:20 until nightfall · the clock waits while you are away',
    );
  });

  it('announces the change of light', () => {
    expect(messageFor({ k: 'nightfall', n: 3 })).toBe('Night 3 has fallen');
    expect(messageFor({ k: 'dawn', n: 3 })).toBe('Dawn breaks on day 4');
  });
});
