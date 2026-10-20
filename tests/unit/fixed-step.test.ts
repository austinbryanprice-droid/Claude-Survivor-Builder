import { describe, expect, it } from 'vitest';
import { TICK_RATE, TICK_SECONDS, createFixedStepper } from '../../src/shared/fixed-step';

function totalTicks(frameSeconds: number, seconds: number): number {
  const stepper = createFixedStepper();
  let ticks = 0;
  for (let t = 0; t < seconds; t += frameSeconds) ticks += stepper.advance(frameSeconds);
  return ticks;
}

describe('createFixedStepper', () => {
  it('runs sixty ticks per second', () => {
    expect(TICK_RATE).toBe(60);
    expect(TICK_SECONDS).toBeCloseTo(1 / 60, 12);
  });

  it('gives one tick per frame at 60 frames per second', () => {
    const stepper = createFixedStepper();
    const counts = Array.from({ length: 120 }, () => stepper.advance(1 / 60));
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(119);
    expect(Math.max(...counts)).toBeLessThanOrEqual(2);
  });

  it('keeps simulated time equal to real time at any frame rate', () => {
    for (const fps of [20, 30, 59.94, 60, 75, 120, 144, 165, 240]) {
      const ticks = totalTicks(1 / fps, 10);
      expect(Math.abs(ticks - 600)).toBeLessThanOrEqual(2);
    }
  });

  it('runs several ticks for a slow frame and none for a fast one', () => {
    const stepper = createFixedStepper();
    expect(stepper.advance(1 / 20)).toBe(3);
    expect(stepper.advance(0.001)).toBe(0);
  });

  it('exposes how far into the next tick it is', () => {
    const stepper = createFixedStepper();
    expect(stepper.alpha).toBe(0);
    stepper.advance(TICK_SECONDS * 1.5);
    expect(stepper.alpha).toBeCloseTo(0.5, 9);
    stepper.advance(TICK_SECONDS * 0.25);
    expect(stepper.alpha).toBeCloseTo(0.75, 9);
    stepper.reset();
    expect(stepper.alpha).toBe(0);
  });

  it('cuts long frames and drops the backlog instead of spiraling', () => {
    const stepper = createFixedStepper();
    // A tab that was hidden for ten seconds.
    expect(stepper.advance(10)).toBe(5);
    expect(stepper.alpha).toBe(0);
    expect(stepper.advance(TICK_SECONDS)).toBe(1);
  });

  it('ignores zero, negative and non-finite frames', () => {
    const stepper = createFixedStepper();
    expect(stepper.advance(0)).toBe(0);
    expect(stepper.advance(-1)).toBe(0);
    expect(stepper.advance(Number.NaN)).toBe(0);
    expect(stepper.alpha).toBe(0);
  });

  it('honors custom options', () => {
    const stepper = createFixedStepper({
      tickSeconds: 0.05,
      maxFrameSeconds: 1,
      maxTicksPerFrame: 100,
    });
    expect(stepper.advance(0.5)).toBe(10);
  });
});
