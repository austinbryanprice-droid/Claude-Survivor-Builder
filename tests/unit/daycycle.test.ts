import { describe, expect, it } from 'vitest';
import {
  CYCLE_SECONDS,
  DAY_SECONDS,
  NIGHT_SECONDS,
  TIME_PRESETS,
  skyStateAt,
  skyStateForPhase,
  sunBearingAt,
  sunElevationAt,
  type Rgb,
} from '../../src/shared/daycycle';

/** Signed difference of two angles in degrees, within [-180, 180). */
function wrapDegrees(delta: number): number {
  return ((((delta + 180) % 360) + 360) % 360) - 180;
}

function inRange(color: Rgb): boolean {
  return color.every((c) => c >= 0 && c <= 1);
}

describe('day cycle', () => {
  it('splits the run into an 8 minute day and a 4 minute night', () => {
    expect(DAY_SECONDS).toBe(480);
    expect(NIGHT_SECONDS).toBe(240);
    expect(CYCLE_SECONDS).toBe(720);
  });

  it('keeps the sun low and golden by day and well below the horizon at night', () => {
    let max = -Infinity;
    let min = Infinity;
    for (let i = 0; i < 1000; i++) {
      const e = sunElevationAt(i / 1000);
      max = Math.max(max, e);
      min = Math.min(min, e);
    }
    expect(max).toBeLessThanOrEqual(45.01);
    expect(min).toBeGreaterThanOrEqual(-26.01);
    expect(sunElevationAt(0)).toBeCloseTo(12, 6);
    expect(sunElevationAt(DAY_SECONDS / CYCLE_SECONDS / 2)).toBeCloseTo(45, 6);
  });

  it('changes smoothly and wraps around', () => {
    for (let i = 0; i < 1000; i++) {
      const p = i / 1000;
      expect(Math.abs(sunElevationAt(p + 0.001) - sunElevationAt(p))).toBeLessThan(1);
      expect(Math.abs(wrapDegrees(sunBearingAt(p + 0.001) - sunBearingAt(p)))).toBeLessThan(2);
    }
    expect(sunElevationAt(1.25)).toBeCloseTo(sunElevationAt(0.25), 9);
    expect(sunElevationAt(-0.75)).toBeCloseTo(sunElevationAt(0.25), 9);
  });

  it('gives a sun direction that is a unit vector pointing where the elevation says', () => {
    const s = skyStateAt(13, 96);
    expect(Math.hypot(...s.sunDir)).toBeCloseTo(1, 9);
    expect(s.sunDir[0]).toBeCloseTo(0.9690323636203195, 6);
    expect(s.sunDir[1]).toBeCloseTo(0.224951054343865, 6);
    expect(s.sunDir[2]).toBeCloseTo(0.10184940552600447, 6);
    expect(s.sunDir[1]).toBeCloseTo(Math.sin((13 * Math.PI) / 180), 9);
  });

  it('is day at golden hour and night at night', () => {
    expect(skyStateAt(13, 96).night).toBe(0);
    expect(skyStateAt(-24, 300).night).toBe(1);
    const dusk = skyStateAt(-7, 278).night;
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
  });

  it('keeps every color in range across the whole elevation sweep', () => {
    for (let e = -30; e <= 50; e += 1.5) {
      const s = skyStateAt(e, 120);
      for (const c of [
        s.zenith,
        s.mid,
        s.horizon,
        s.horizonSun,
        s.sunColor,
        s.ambientSky,
        s.ambientGround,
        s.fog,
        s.fogSun,
        s.cloudLit,
        s.cloudShade,
        s.shadowTint,
        s.highlightTint,
      ]) {
        expect(inRange(c)).toBe(true);
      }
      expect(s.mist).toBeGreaterThanOrEqual(0);
      expect(s.mist).toBeLessThanOrEqual(1);
      expect(s.exposure).toBeGreaterThan(0);
    }
  });

  it('blends the palette without jumps', () => {
    for (let e = -30; e < 50; e += 0.25) {
      const a = skyStateAt(e, 120);
      const b = skyStateAt(e + 0.05, 120);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs((a.zenith[i] as number) - (b.zenith[i] as number))).toBeLessThan(0.02);
        expect(Math.abs((a.fog[i] as number) - (b.fog[i] as number))).toBeLessThan(0.02);
      }
      expect(Math.abs(a.sunIntensity - b.sunIntensity)).toBeLessThan(0.2);
    }
  });

  it('offers named moments that all produce a sky', () => {
    expect(Object.keys(TIME_PRESETS)).toEqual([
      'golden',
      'morning',
      'noon',
      'afternoon',
      'sunset',
      'dusk',
      'night',
    ]);
    for (const [name, moment] of Object.entries(TIME_PRESETS)) {
      const s = skyStateAt(moment.elevation, moment.bearing);
      expect(s.sunElevation, name).toBe(moment.elevation);
    }
  });

  it('maps a cycle phase to a sky state', () => {
    expect(skyStateForPhase(0.3).sunElevation).toBeCloseTo(44.59371523963954, 6);
    expect(skyStateForPhase(0.9).night).toBeGreaterThan(0.5);
  });
});
