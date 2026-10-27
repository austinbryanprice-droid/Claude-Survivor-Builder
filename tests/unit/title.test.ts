import { describe, expect, it } from 'vitest';
import { INTRO_TITLE } from '../../src/shared/intro';
import { TITLE, driftShare, titleWanted, type TitleWish } from '../../src/shared/title';

describe('the title screen', () => {
  it('says the name and the line the film ends on, so that the words are the same everywhere', () => {
    expect(TITLE.name).toBe(INTRO_TITLE.title);
    expect(TITLE.tagline).toBe(INTRO_TITLE.subtitle);
    expect(TITLE.play).toBe('Play');
  });

  it('fades out for a moment before the film, which opens out of black, and glides in a little longer', () => {
    expect(TITLE.leadSeconds).toBeGreaterThan(0.3);
    expect(TITLE.leadSeconds).toBeLessThan(1.5);
    expect(TITLE.glideSeconds).toBeGreaterThan(TITLE.leadSeconds);
    expect(TITLE.glideSeconds).toBeLessThan(4);
  });

  it('waits a few seconds in black for the film, long enough for a slow connection and not so long that a stuck one holds the player', () => {
    expect(TITLE.filmWaitSeconds).toBeGreaterThan(TITLE.leadSeconds);
    expect(TITLE.filmWaitSeconds).toBeGreaterThanOrEqual(3);
    expect(TITLE.filmWaitSeconds).toBeLessThanOrEqual(10);
  });
});

describe('the drift of the title camera', () => {
  it('starts at the beginning of its path, reaches the far end half a period later and comes back', () => {
    const period = TITLE.driftSeconds;
    expect(driftShare(0)).toBeCloseTo(0, 12);
    expect(driftShare(period / 2)).toBeCloseTo(1, 12);
    expect(driftShare(period)).toBeCloseTo(0, 12);
    expect(driftShare(period * 1.5)).toBeCloseTo(1, 12);
    expect(driftShare(period / 4)).toBeCloseTo(0.5, 12);
  });

  it('stays on its path and slows to a stop at each end, with no jerk', () => {
    const period = TITLE.driftSeconds;
    for (let i = 0; i <= 400; i++) {
      const share = driftShare((i / 400) * period * 3);
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
    }
    // A second from either end the camera has hardly moved; at the middle it moves fastest.
    expect(driftShare(1)).toBeLessThan(0.002);
    expect(driftShare(period / 2 - 1)).toBeGreaterThan(0.998);
    const speed = (at: number): number => Math.abs(driftShare(at + 0.5) - driftShare(at - 0.5));
    expect(speed(period / 4)).toBeGreaterThan(speed(2) * 5);
  });

  it('is slow enough to read as a drift: the whole path takes more than a minute', () => {
    expect(TITLE.driftSeconds).toBeGreaterThan(60);
    const perSecond = Math.abs(
      driftShare(TITLE.driftSeconds / 4 + 0.5) - driftShare(TITLE.driftSeconds / 4 - 0.5),
    );
    expect(perSecond).toBeLessThan(0.05);
  });
});

describe('when the page opens on the title screen', () => {
  const plain: TitleWish = { mode: 'auto', automated: false, custom: false };

  it('does for a person at the keyboard who asked for nothing special', () => {
    expect(titleWanted(plain)).toBe(true);
  });

  it('stays out of the way of scripts and custom pages, which have nobody to press Play', () => {
    expect(titleWanted({ ...plain, automated: true })).toBe(false);
    expect(titleWanted({ ...plain, custom: true })).toBe(false);
  });

  it('is settled by the address when it says so', () => {
    expect(titleWanted({ mode: 'on', automated: true, custom: true })).toBe(true);
    expect(titleWanted({ ...plain, mode: 'off' })).toBe(false);
  });
});
