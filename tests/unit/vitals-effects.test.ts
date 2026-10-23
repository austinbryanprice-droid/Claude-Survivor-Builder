import { describe, expect, it } from 'vitest';
import { followVitals } from '../../src/app/vitals-effects';
import { VitalsMirror } from '../../src/net/vitals-mirror';
import { VITALS } from '../../src/systems/survival/balance';

function fakeGame() {
  const listeners = new Set<() => void>();
  const speeds: number[] = [];
  const holds: boolean[] = [];
  return {
    onFrame(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSpeedScale(scale: number) {
      speeds.push(scale);
    },
    setFrozen(frozen: boolean) {
      holds.push(frozen);
    },
    frame() {
      listeners.forEach((listener) => listener());
    },
    listeners,
    speeds,
    holds,
  };
}

function fakeHands() {
  const scales: number[] = [];
  const downs: boolean[] = [];
  return {
    setHandScale(scale: number) {
      scales.push(scale);
    },
    setDown(down: boolean) {
      downs.push(down);
    },
    scales,
    downs,
  };
}

describe('what the player’s Energy does to the legs and the hands', () => {
  it('hands both the scales to the game and the hands once a frame', () => {
    const game = fakeGame();
    const hands = fakeHands();
    const mirror = new VitalsMirror();
    followVitals(game, hands, mirror);
    mirror.apply(100, 100, 100, 100, false);
    game.frame();
    expect(game.speeds.at(-1)).toBe(1);
    expect(hands.scales.at(-1)).toBe(1);

    mirror.apply(100, 100, 0, 100, false);
    game.frame();
    expect(game.speeds.at(-1)).toBeCloseTo(VITALS.energy.emptySpeed, 10);
    expect(hands.scales.at(-1)).toBeCloseTo(VITALS.energy.emptyHands, 10);
    expect(game.speeds).toHaveLength(2);
  });

  it('leaves the player at full speed until the host has spoken', () => {
    const game = fakeGame();
    const hands = fakeHands();
    followVitals(game, hands, new VitalsMirror());
    game.frame();
    expect(game.speeds).toEqual([1]);
    expect(hands.scales).toEqual([1]);
  });

  it('stops when told to, and gives the player their speed back', () => {
    const game = fakeGame();
    const hands = fakeHands();
    const mirror = new VitalsMirror();
    mirror.apply(100, 100, 0, 100, false);
    const stop = followVitals(game, hands, mirror);
    game.frame();
    expect(game.speeds.at(-1)).toBeLessThan(1);
    stop();
    expect(game.listeners.size).toBe(0);
    expect(game.speeds.at(-1)).toBe(1);
    expect(hands.scales.at(-1)).toBe(1);
  });
});

describe('what going down does to the legs and the hands', () => {
  it('holds the player still with idle hands while they have no Health, and lets them go when they are back', () => {
    const game = fakeGame();
    const hands = fakeHands();
    const mirror = new VitalsMirror();
    followVitals(game, hands, mirror);
    mirror.apply(100, 100, 100, 100, false);
    game.frame();
    expect(game.holds.at(-1)).toBe(false);
    expect(hands.downs.at(-1)).toBe(false);

    mirror.apply(0, 100, 100, 100, false, 4, 0);
    game.frame();
    expect(game.holds.at(-1)).toBe(true);
    expect(hands.downs.at(-1)).toBe(true);

    mirror.apply(100, 100, 50, 100, false, 0, 45);
    game.frame();
    expect(game.holds.at(-1)).toBe(false);
    expect(hands.downs.at(-1)).toBe(false);
  });

  it('does not hold anyone before the host has spoken, when there is no Health bar to be empty', () => {
    const game = fakeGame();
    const hands = fakeHands();
    followVitals(game, hands, new VitalsMirror());
    game.frame();
    expect(game.holds).toEqual([false]);
    expect(hands.downs).toEqual([false]);
  });

  it('puts the player back on their feet when it stops, even if they were down', () => {
    const game = fakeGame();
    const hands = fakeHands();
    const mirror = new VitalsMirror();
    mirror.apply(0, 100, 100, 100, false);
    const stop = followVitals(game, hands, mirror);
    game.frame();
    expect(game.holds.at(-1)).toBe(true);
    stop();
    expect(game.holds.at(-1)).toBe(false);
    expect(hands.downs.at(-1)).toBe(false);
  });
});
