import { describe, expect, it } from 'vitest';
import { DAY_SECONDS, NIGHT_SECONDS } from '../../src/shared/daycycle';
import { createReading, readClock } from '../../src/shared/survival-state';
import {
  CLOCK_SOON_SECONDS,
  CORE_CRITICAL_BELOW,
  CORE_WORN_BELOW,
  clockForHud,
  coreForHud,
  messageFor,
  objectiveForRun,
  runLine,
} from '../../src/ui/run-hud';

function reading(elapsed: number, running = true) {
  const out = readClock(elapsed, createReading());
  out.running = running;
  return out;
}

/** A reading with a Core of `health` out of 1000, `over` once it has fallen. */
function withCore(elapsed: number, health: number, over = false) {
  const out = reading(elapsed, !over);
  out.coreHealth = health;
  out.coreMax = 1000;
  out.over = over;
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

describe("the Outpost Core's gauge", () => {
  it('stays out of the way by day while the Core is whole', () => {
    expect(coreForHud(withCore(10, 1000))).toBeNull();
  });

  it('is on screen all night, even whole', () => {
    expect(coreForHud(withCore(DAY_SECONDS + 10, 1000))).toEqual({
      fraction: 1,
      value: '1000',
      tone: 'sound',
    });
  });

  it('comes up by day as soon as the Core is hurt, and shows what is left', () => {
    expect(coreForHud(withCore(10, 999))).toEqual({
      fraction: 0.999,
      value: '999',
      tone: 'sound',
    });
  });

  it('turns amber below half and red below a quarter', () => {
    expect(CORE_WORN_BELOW).toBe(0.5);
    expect(CORE_CRITICAL_BELOW).toBe(0.25);
    const tone = (health: number) => coreForHud(withCore(DAY_SECONDS + 5, health))?.tone;
    expect(tone(900)).toBe('sound');
    expect(tone(500)).toBe('sound');
    expect(tone(499)).toBe('worn');
    expect(tone(250)).toBe('worn');
    expect(tone(249)).toBe('critical');
    expect(tone(1)).toBe('critical');
  });

  it('goes grey and stays up once the Core has fallen, by day or by night', () => {
    expect(coreForHud(withCore(10, 0, true))).toEqual({ fraction: 0, value: '0', tone: 'fallen' });
    expect(coreForHud(withCore(DAY_SECONDS + 10, 0, true))?.tone).toBe('fallen');
  });

  it('is absent where the run has no Core to show', () => {
    expect(coreForHud(reading(DAY_SECONDS + 10))).toBeNull();
  });

  it('keeps its bar inside its frame whatever the numbers say', () => {
    const over = withCore(DAY_SECONDS + 5, 1500);
    expect(coreForHud(over)?.fraction).toBe(1);
    const under = withCore(DAY_SECONDS + 5, -20);
    expect(coreForHud(under)?.fraction).toBe(0);
  });
});

describe('what the HUD says when the Core falls', () => {
  it('stops breathing the clock and says the Core has fallen', () => {
    const fallen = withCore(DAY_SECONDS - 10, 0, true);
    expect(clockForHud(fallen).soon).toBe(false);
    expect(objectiveForRun(fallen).title).toBe('The Outpost Core has fallen');
  });

  it('puts the end of the run on the pause card with the nights survived', () => {
    expect(runLine(withCore(DAY_SECONDS + 30, 0, true))).toBe(
      'Outpost Overrun on Night 1 · 0 nights survived',
    );
    expect(runLine(withCore(720 + DAY_SECONDS + 30, 0, true))).toBe(
      'Outpost Overrun on Night 2 · 1 night survived',
    );
    expect(runLine(withCore(2 * 720 + 100, 0, true))).toBe(
      'Outpost Overrun on Day 3 · 2 nights survived',
    );
  });

  it('announces the fall', () => {
    expect(messageFor({ k: 'overrun', n: 3 })).toBe('The Outpost Core has fallen');
  });
});
