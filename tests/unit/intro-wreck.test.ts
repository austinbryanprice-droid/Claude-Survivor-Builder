import { describe, expect, it } from 'vitest';
import { STOP_AT, TOUCHDOWN_AT } from '../../src/shared/intro';
import { createWreckPath, createWreckState } from '../../src/shared/intro-wreck';
import { CRASH, FURROW } from '../../src/world/terrain/field';
import { crashSiteFor } from './helpers/crash-site';

const TIMES = { appears: 0.4, touchdown: TOUCHDOWN_AT, stop: STOP_AT };
/** The wreck's middle rides this high above the ground as it ploughs, which is also the least it can be over it. */
const RIDE = 1.9;

const SEEDS = [20261020, 1, 777];

describe('the path of the wreck', () => {
  const { site, under } = crashSiteFor(SEEDS[0] as number);
  const path = createWreckPath(site, TIMES);
  const at = (time: number) => path.at(time, createWreckState());

  it('comes in high and far out, falling', () => {
    const first = at(TIMES.appears);
    expect(first.phase).toBe('fall');
    expect(Math.hypot(first.x - path.touchdown.x, first.z - path.touchdown.z)).toBeGreaterThan(
      1000,
    );
    expect(first.y).toBeGreaterThan(500);
    for (let t = TIMES.appears; t < TIMES.touchdown - 0.05; t += 0.1) {
      const state = at(t);
      expect(state.phase).toBe('fall');
      expect(state.dy, `heading at ${t}`).toBeLessThan(0);
      expect(Math.hypot(state.dx, state.dy, state.dz)).toBeCloseTo(1, 6);
      expect(state.speed).toBeGreaterThan(20);
    }
  });

  it('touches down at the far end of the furrow, ploughs it into the crater and rests there', () => {
    const touching = at(TIMES.touchdown);
    expect(touching.phase).toBe('skid');
    const start = FURROW[FURROW.length - 1] as readonly [number, number];
    expect(touching.x).toBeCloseTo(start[0], 6);
    expect(touching.z).toBeCloseTo(start[1], 6);
    expect(touching.y).toBeCloseTo(site.groundAt(start[0], start[1]) + RIDE, 6);

    const resting = at(TIMES.stop);
    expect(resting.phase).toBe('rest');
    expect(resting.speed).toBe(0);
    expect(resting.x).toBeCloseTo(CRASH.x, 6);
    expect(resting.z).toBeCloseTo(CRASH.z, 6);
    expect(path.rest.x).toBeCloseTo(CRASH.x, 9);
    expect(at(TIMES.stop + 30).x).toBe(resting.x);

    // Along the skid it never goes back, and it slows to a stop.
    let last = -1;
    let lastSpeed = Infinity;
    for (let t = TIMES.touchdown + 0.01; t < TIMES.stop; t += 0.05) {
      const state = at(t);
      expect(state.phase).toBe('skid');
      const travelled = Math.hypot(state.x - start[0], state.z - start[1]);
      expect(travelled).toBeGreaterThanOrEqual(last - 1e-6);
      expect(state.speed).toBeLessThanOrEqual(lastSpeed + 1e-6);
      last = travelled;
      lastSpeed = state.speed;
    }
  });

  it('never jumps: each step of the film moves it about as far as its speed says', () => {
    const step = 0.02;
    let before = at(TIMES.appears);
    for (let t = TIMES.appears + step; t <= TIMES.stop + 1; t += step) {
      const now = at(t);
      const moved = Math.hypot(now.x - before.x, now.y - before.y, now.z - before.z);
      const allowed = (Math.max(now.speed, before.speed) + 60) * step * 1.5;
      expect(moved, `between ${t - step} and ${t}`).toBeLessThan(allowed);
      before = now;
    }
  });

  it('measures its own skid', () => {
    expect(path.skidLength).toBeGreaterThan(40);
    const start = { x: 0, y: 0, z: 0 };
    const end = { x: 0, y: 0, z: 0 };
    path.alongSkid(0, start);
    path.alongSkid(path.skidLength + 50, end);
    expect(start.x).toBeCloseTo((FURROW[FURROW.length - 1] as readonly [number, number])[0], 9);
    expect(end.x).toBeCloseTo(CRASH.x, 9);
    expect(end.z).toBeCloseTo(CRASH.z, 9);
  });

  for (const seed of SEEDS) {
    it(`clears the hills on its way in and the ground on its way down (seed ${seed})`, () => {
      const world = crashSiteFor(seed);
      const flight = createWreckPath(world.site, TIMES);
      const state = createWreckState();
      let least = Infinity;
      for (let t = TIMES.appears; t < TIMES.touchdown; t += 0.02) {
        flight.at(t, state);
        const over = state.y - world.under(state.x, state.z);
        // The wreck is a drum 2.5 meters across the middle: its path stays well clear of the ground until it is nearly down.
        if (t < TIMES.touchdown - 0.12) expect(over, `at ${t.toFixed(2)}`).toBeGreaterThan(4);
        else expect(over).toBeGreaterThan(RIDE - 0.05);
        least = Math.min(least, over);
      }
      expect(least).toBeGreaterThan(RIDE - 0.05);
      // And the same under it through the skid, where it rides just above the furrow.
      for (let t = TIMES.touchdown; t <= TIMES.stop; t += 0.05) {
        flight.at(t, state);
        expect(state.y - world.under(state.x, state.z)).toBeCloseTo(RIDE, 6);
      }
    });
  }

  it('is a pure function of the film clock', () => {
    const a = at(5.5);
    const again = createWreckPath(site, TIMES).at(5.5, createWreckState());
    expect(again).toEqual(a);
    expect(at(TIMES.appears + 3)).toEqual(at(TIMES.appears + 3));
    expect(under(0, 0)).toBeGreaterThan(0);
  });
});
