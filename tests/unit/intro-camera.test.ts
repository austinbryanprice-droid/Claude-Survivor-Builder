import { describe, expect, it } from 'vitest';
import type { CameraPose } from '../../src/shared/camera-pose';
import {
  MIN_CLEARANCE,
  aimAt,
  aimTrack,
  blendPose,
  createCrashFrame,
  createTrackSample,
  frameCoordinates,
  placeInFrame,
  rampBetween,
  sampleTrack,
  shakePose,
  turnBetween,
  type CameraKey,
  type CrashSite,
  type Point3,
} from '../../src/shared/intro-camera';

/** A crash site on a gentle slope, with the furrow running from the north-west down to the crater. */
const SITE: CrashSite = {
  groundAt: (x) => 10 + 0.01 * x,
  crater: { x: 0, z: 0, radius: 13 },
  furrow: [
    [-6, -8],
    [-26, -24],
    [-44, -36],
  ],
  spawn: { x: 12, z: 7 },
  core: { x: 0, y: 13, z: 0 },
};

/** The way a camera with this pose faces: yaw 0 looks down -z and a positive yaw turns left. */
function facing(pose: CameraPose): Point3 {
  return {
    x: -Math.sin(pose.yaw) * Math.cos(pose.pitch),
    y: Math.sin(pose.pitch),
    z: -Math.cos(pose.yaw) * Math.cos(pose.pitch),
  };
}

const pose = (overrides: Partial<CameraPose> = {}): CameraPose => ({
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  ...overrides,
});

describe('the crash frame', () => {
  const frame = createCrashFrame(SITE);

  it('runs forward along the furrow toward the crater, with right at a right angle to it', () => {
    expect(Math.hypot(frame.fx, frame.fz)).toBeCloseTo(1, 9);
    expect(Math.hypot(frame.rx, frame.rz)).toBeCloseTo(1, 9);
    expect(frame.fx * frame.rx + frame.fz * frame.rz).toBeCloseTo(0, 9);
    // The far end of the furrow is behind the crater: forward points from it toward the crater.
    const [f] = frameCoordinates(frame, -44, -36);
    expect(f).toBeLessThan(0);
    expect(frame.x).toBe(0);
    expect(frame.z).toBe(0);
  });

  it('puts the right hand to the right, seen from above with z to the south', () => {
    // Looking along forward (toward +x, +z) the right hand is toward -x, +z, i.e. (-fz, fx).
    expect(frame.rx).toBeCloseTo(-frame.fz, 12);
    expect(frame.rz).toBeCloseTo(frame.fx, 12);
  });

  it('refuses a site with no furrow', () => {
    expect(() => createCrashFrame({ ...SITE, furrow: [] })).toThrow(/furrow/);
  });

  it('places a point by how far forward, right and above the ground it is, and reads it back', () => {
    const at = placeInFrame(frame, 30, -12, 2.5, { x: 0, y: 0, z: 0 });
    expect(at.y).toBeCloseTo(SITE.groundAt(at.x, at.z) + 2.5, 9);
    const [f, r] = frameCoordinates(frame, at.x, at.z);
    expect(f).toBeCloseTo(30, 9);
    expect(r).toBeCloseTo(-12, 9);
  });
});

describe('a camera track', () => {
  const keys: CameraKey[] = [
    { t: 0, at: [0, 0, 1], look: [10, 0, 1], fov: 50 },
    { t: 2, at: [10, 4, 2], look: [20, 0, 1], fov: 60, follow: 1, roll: 4 },
    { t: 5, at: [30, 4, 5], look: [20, 10, 3], fov: 40 },
  ];

  it('passes through every key at its time', () => {
    const sample = createTrackSample();
    for (const key of keys) {
      sampleTrack(keys, key.t, sample);
      expect(sample.at).toEqual(key.at.map((v) => expect.closeTo(v, 9)));
      expect(sample.look).toEqual(key.look.map((v) => expect.closeTo(v, 9)));
      expect(sample.fov).toBeCloseTo(key.fov, 9);
      expect(sample.roll).toBeCloseTo(key.roll ?? 0, 9);
      expect(sample.follow).toBeCloseTo(key.follow ?? 0, 9);
    }
  });

  it('holds still before the first key and after the last', () => {
    const sample = createTrackSample();
    sampleTrack(keys, -3, sample);
    expect(sample.at).toEqual([0, 0, 1]);
    sampleTrack(keys, 99, sample);
    expect(sample.at).toEqual([30, 4, 5]);
    expect(sample.fov).toBe(40);
  });

  it('moves smoothly between the keys', () => {
    const a = createTrackSample();
    const b = createTrackSample();
    for (let t = 0; t < 5; t += 0.01) {
      sampleTrack(keys, t, a);
      sampleTrack(keys, t + 0.01, b);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs((b.at[i] as number) - (a.at[i] as number))).toBeLessThan(0.5);
      }
    }
  });

  it('needs a key to stand on', () => {
    expect(() => sampleTrack([], 0, createTrackSample())).toThrow(/key/);
  });
});

describe('aiming a camera', () => {
  it('faces the point it is aimed at', () => {
    const eye = { x: 3, y: 2, z: -4 };
    for (const target of [
      { x: 3, y: 2, z: -40 },
      { x: -30, y: 12, z: 5 },
      { x: 60, y: -3, z: 80 },
      { x: 3, y: 50, z: -4.5 },
    ]) {
      const out = aimAt(eye, target, 55, 0, pose());
      const want = { x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z };
      const length = Math.hypot(want.x, want.y, want.z);
      const got = facing(out);
      expect(got.x).toBeCloseTo(want.x / length, 9);
      expect(got.y).toBeCloseTo(want.y / length, 9);
      expect(got.z).toBeCloseTo(want.z / length, 9);
      expect(out.x).toBe(eye.x);
      expect(out.fov).toBe(55);
    }
  });

  it('pulls the look point toward the subject as far as the key says, and keeps the eye off the ground', () => {
    const frame = createCrashFrame(SITE);
    const sample = createTrackSample();
    const scratch = { eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
    const subject = { x: 40, y: 30, z: 40 };
    sample.at = [10, 5, -3];
    sample.look = [-20, 0, 2];
    sample.fov = 50;

    sample.follow = 0;
    aimTrack(frame, sample, subject, scratch, pose());
    const free = { ...scratch.target };
    sample.follow = 1;
    aimTrack(frame, sample, subject, scratch, pose());
    expect(scratch.target).toEqual(subject);
    expect(free).not.toEqual(subject);
    sample.follow = 0.5;
    aimTrack(frame, sample, subject, scratch, pose());
    expect(scratch.target.x).toBeCloseTo((free.x + subject.x) / 2, 9);

    // A key that asks for a camera in the ground is put just above it.
    sample.at = [10, 5, -50];
    aimTrack(frame, sample, null, scratch, pose());
    expect(scratch.eye.y).toBeCloseTo(
      SITE.groundAt(scratch.eye.x, scratch.eye.z) + MIN_CLEARANCE,
      9,
    );
  });
});

describe('turns, blends and shakes', () => {
  it('turns the short way round', () => {
    expect(turnBetween(0.1, 0.4)).toBeCloseTo(0.3, 12);
    expect(turnBetween(3, -3)).toBeCloseTo(2 * Math.PI - 6, 12);
    expect(turnBetween(-3, 3)).toBeCloseTo(6 - 2 * Math.PI, 12);
    expect(turnBetween(1, 1 + 2 * Math.PI)).toBeCloseTo(0, 9);
  });

  it('flies one pose to another, ending exactly on it and crossing the seam of the angle the short way', () => {
    const from = pose({ x: 1, y: 2, z: 3, yaw: 3, pitch: 0.4, fov: 40, roll: 0.2 });
    const to = pose({ x: 11, y: 12, z: 13, yaw: -3, pitch: -0.2, fov: 70 });

    const none = { ...from };
    blendPose(none, to, 0);
    expect(none).toMatchObject({ x: 1, y: 2, z: 3, pitch: 0.4, fov: 40 });

    const half = { ...from };
    blendPose(half, to, 0.5);
    expect(half.x).toBeCloseTo(6, 9);
    expect(half.fov).toBeCloseTo(55, 9);
    // Halfway between 3 and -3 the short way round is at the back of the circle, near pi, not at 0.
    expect(Math.abs(Math.cos(half.yaw) + 1)).toBeLessThan(0.05);

    const all = { ...from };
    blendPose(all, to, 1);
    expect(all.x).toBe(11);
    expect(all.pitch).toBeCloseTo(-0.2, 12);
    expect(Math.cos(all.yaw)).toBeCloseTo(Math.cos(-3), 12);
    expect(Math.sin(all.yaw)).toBeCloseTo(Math.sin(-3), 12);
    expect(all.roll).toBe(0);
  });

  it('shakes by no more than it is told to, the same way every time, and not at all for zero', () => {
    const still = pose({ x: 5, y: 5, z: 5, yaw: 1, pitch: 0.1 });
    const same = { ...still };
    shakePose(same, 3.3, 0);
    expect(same).toEqual(still);

    for (let seconds = 0; seconds < 20; seconds += 0.173) {
      const shaken = { ...still };
      shakePose(shaken, seconds, 0.4);
      expect(Math.abs(shaken.x - 5)).toBeLessThanOrEqual(0.2 + 1e-9);
      expect(Math.abs(shaken.y - 5)).toBeLessThanOrEqual(0.2 + 1e-9);
      expect(Math.abs(shaken.pitch - 0.1)).toBeLessThanOrEqual(0.4 * 0.012 + 1e-9);
      expect(Math.abs(shaken.roll ?? 0)).toBeLessThanOrEqual(0.4 * 0.02 + 1e-9);
      const again = { ...still };
      shakePose(again, seconds, 0.4);
      expect(again).toEqual(shaken);
    }
  });

  it('ramps a value between two moments', () => {
    expect(rampBetween(0, 1, 3, 10, 20)).toBe(10);
    expect(rampBetween(2, 1, 3, 10, 20)).toBeCloseTo(15, 9);
    expect(rampBetween(9, 1, 3, 10, 20)).toBe(20);
  });
});
