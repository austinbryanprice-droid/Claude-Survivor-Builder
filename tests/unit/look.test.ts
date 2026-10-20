import { describe, expect, it } from 'vitest';
import {
  PITCH_LIMIT,
  angleDelta,
  clampPitch,
  lookDirection,
  rightVector,
  wrapAngle,
  type Vec3,
} from '../../src/shared/look';

const v = (): Vec3 => ({ x: 0, y: 0, z: 0 });

describe('wrapAngle and angleDelta', () => {
  it('wraps into (-π, π]', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 9);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(wrapAngle(Math.PI * 2.5)).toBeCloseTo(Math.PI / 2, 9);
    expect(wrapAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('turns the short way round', () => {
    expect(angleDelta(0.1, 0.4)).toBeCloseTo(0.3, 9);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 9);
    expect(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 9);
  });
});

describe('clampPitch', () => {
  it('stops short of straight up and down', () => {
    expect(clampPitch(10)).toBe(PITCH_LIMIT);
    expect(clampPitch(-10)).toBe(-PITCH_LIMIT);
    expect(clampPitch(0.3)).toBe(0.3);
    expect(PITCH_LIMIT).toBeLessThan(Math.PI / 2);
  });
});

describe('lookDirection', () => {
  it('looks toward -z at yaw 0 and turns left as yaw grows', () => {
    const d = lookDirection(0, 0, v());
    expect(d.x).toBeCloseTo(0, 9);
    expect(d.y).toBeCloseTo(0, 9);
    expect(d.z).toBeCloseTo(-1, 9);
    const left = lookDirection(Math.PI / 2, 0, v());
    expect(left.x).toBeCloseTo(-1, 9);
    expect(left.z).toBeCloseTo(0, 9);
  });

  it('tilts up with positive pitch and is always a unit vector', () => {
    expect(lookDirection(0.7, 0.5, v()).y).toBeGreaterThan(0);
    for (const [yaw, pitch] of [
      [0, 0],
      [1.3, 0.4],
      [-2.2, -1.1],
      [3, 1.5],
    ] as const) {
      const d = lookDirection(yaw, pitch, v());
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
    }
  });
});

describe('rightVector', () => {
  it('is +x at yaw 0, level, and perpendicular to the view', () => {
    const r = rightVector(0, v());
    expect(r.x).toBeCloseTo(1, 9);
    expect(r.y).toBe(0);
    expect(r.z).toBeCloseTo(0, 9);
    const yaw = 0.8;
    const f = lookDirection(yaw, 0, v());
    const right = rightVector(yaw, v());
    expect(f.x * right.x + f.z * right.z).toBeCloseTo(0, 9);
  });
});
