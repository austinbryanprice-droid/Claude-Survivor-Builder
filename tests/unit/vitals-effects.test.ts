import { describe, expect, it } from 'vitest';
import { followVitals } from '../../src/app/vitals-effects';
import { VitalsMirror } from '../../src/net/vitals-mirror';
import { VITALS } from '../../src/systems/survival/balance';

function fakeGame() {
  const listeners = new Set<() => void>();
  const speeds: number[] = [];
  return {
    onFrame(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSpeedScale(scale: number) {
      speeds.push(scale);
    },
    frame() {
      listeners.forEach((listener) => listener());
    },
    listeners,
    speeds,
  };
}

function fakeHands() {
  const scales: number[] = [];
  return {
    setHandScale(scale: number) {
      scales.push(scale);
    },
    scales,
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
