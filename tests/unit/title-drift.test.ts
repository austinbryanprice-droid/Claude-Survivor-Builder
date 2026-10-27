import { describe, expect, it, vi } from 'vitest';
import { createTitleDrift } from '../../src/engine/title-drift';
import type { CameraPose, CameraRoute } from '../../src/shared/camera-pose';
import { TITLE, driftShare } from '../../src/shared/title';

const blank = (): CameraPose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });

/** A route along x: where it is says how far along it the camera is. */
const line: CameraRoute = {
  sample(fraction, out) {
    out.x = fraction * 10;
    out.y = 5;
    out.z = 0;
    out.yaw = 0;
    out.pitch = -0.1;
    out.fov = 64;
    out.roll = 0;
    return out;
  },
};

/** Where the player's own camera is, once the title is over. */
const view: CameraPose = { x: 100, y: 3, z: -40, yaw: 1, pitch: 0.2, fov: 70 };

describe('the camera of the title screen', () => {
  it('opens at the start of its path and drifts along it as time passes', () => {
    const drift = createTitleDrift({ route: line, calm: false, onEnd: () => {} });
    const out = blank();
    expect(drift.update(0.1, view, out)).toBe(true);
    expect(out.x).toBeCloseTo(driftShare(0.1) * 10, 9);
    const before = out.x;
    for (let i = 0; i < 600; i++) drift.update(0.1, view, out);
    expect(drift.seconds).toBeCloseTo(60.1, 6);
    expect(out.x).toBeCloseTo(driftShare(60.1) * 10, 9);
    expect(out.x).toBeGreaterThan(before);
  });

  it('holds still at the start of its path for a player whose system asks for less motion', () => {
    const drift = createTitleDrift({ route: line, calm: true, onEnd: () => {} });
    const out = blank();
    for (let i = 0; i < 100; i++) drift.update(0.5, view, out);
    expect(out.x).toBe(0);
    expect(drift.seconds).toBeCloseTo(50, 6);
  });

  it('carries on until it is asked to glide', () => {
    const drift = createTitleDrift({ route: line, calm: false, onEnd: () => {} });
    expect(drift.gliding).toBe(false);
    for (let i = 0; i < 1000; i++) expect(drift.update(0.5, view, blank())).toBe(true);
  });

  it('flies into the player view and is over when it gets there, with no jump on the way', () => {
    const drift = createTitleDrift({ route: line, calm: false, onEnd: () => {} });
    const out = blank();
    drift.update(0.5, view, out);
    drift.glide(TITLE.glideSeconds);
    expect(drift.gliding).toBe(true);
    let previous = { ...out };
    let frames = 0;
    let going = true;
    while (going) {
      going = drift.update(1 / 30, view, out);
      frames++;
      // The camera never leaps: each frame moves it a fraction of the way to the view, and in the right direction.
      expect(Math.abs(out.x - previous.x)).toBeLessThan(10);
      expect(out.x).toBeGreaterThanOrEqual(previous.x - 1e-9);
      previous = { ...out };
      expect(frames).toBeLessThan(1000);
    }
    expect(frames * (1 / 30)).toBeGreaterThanOrEqual(TITLE.glideSeconds);
    expect(frames * (1 / 30)).toBeLessThan(TITLE.glideSeconds + 0.1);
    // The last frame is the player's own view.
    expect(out.x).toBeCloseTo(view.x, 9);
    expect(out.y).toBeCloseTo(view.y, 9);
    expect(out.z).toBeCloseTo(view.z, 9);
    expect(out.yaw).toBeCloseTo(view.yaw, 9);
    expect(out.pitch).toBeCloseTo(view.pitch, 9);
    expect(out.fov).toBeCloseTo(70, 9);
    expect(out.roll ?? 0).toBeCloseTo(0, 9);
  });

  it('follows a player view that moves while it glides, so the hand-over is still not a cut', () => {
    const drift = createTitleDrift({ route: line, calm: false, onEnd: () => {} });
    const moving: CameraPose = { ...view };
    const out = blank();
    drift.glide(1);
    let going = true;
    while (going) {
      moving.x += 0.5;
      going = drift.update(0.1, moving, out);
    }
    expect(out.x).toBeCloseTo(moving.x, 9);
  });

  it('says it has ended once, however many times it is told', () => {
    const onEnd = vi.fn();
    const drift = createTitleDrift({ route: line, calm: false, onEnd });
    drift.update(0.1, view, blank());
    expect(onEnd).not.toHaveBeenCalled();
    drift.end();
    drift.end();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('takes the first glide it is asked for and keeps to it', () => {
    const drift = createTitleDrift({ route: line, calm: false, onEnd: () => {} });
    drift.glide(1);
    drift.glide(50);
    let seconds = 0;
    while (drift.update(0.1, view, blank())) seconds += 0.1;
    expect(seconds).toBeLessThan(1.2);
  });
});
