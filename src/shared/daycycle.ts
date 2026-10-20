/**
 * Time of day: where the sun and moon are, and the whole palette that follows from it (sky,
 * fog, light, grade). Pure data and arithmetic, so the host clock, tests and the renderer all
 * agree. Colors are sRGB triples in 0..1; the renderer converts them to linear.
 *
 * The day is a long golden afternoon (the sun stays between 12 and 45 degrees) and the night
 * is cool blue. See docs/art-direction.md.
 */

export type Rgb = readonly [number, number, number];

/** Everything the renderer needs for one moment. Colors are sRGB 0..1 unless noted. */
export interface SkyState {
  /** Unit vector toward the sun, world space (+x east, +y up, -z north). */
  readonly sunDir: readonly [number, number, number];
  /** Unit vector toward the moon. */
  readonly moonDir: readonly [number, number, number];
  /** Sun elevation above the horizon, in degrees. */
  readonly sunElevation: number;
  readonly zenith: Rgb;
  readonly mid: Rgb;
  /** Horizon color away from the sun. */
  readonly horizon: Rgb;
  /** Horizon glow toward the sun. */
  readonly horizonSun: Rgb;
  /** Direct light color (sRGB) and its intensity in linear units. */
  readonly sunColor: Rgb;
  readonly sunIntensity: number;
  readonly moonColor: Rgb;
  readonly moonIntensity: number;
  readonly ambientSky: Rgb;
  readonly ambientGround: Rgb;
  readonly ambientIntensity: number;
  readonly fog: Rgb;
  readonly fogSun: Rgb;
  readonly fogDensity: number;
  readonly cloudLit: Rgb;
  readonly cloudShade: Rgb;
  readonly cloudCover: number;
  /** 0 by day, 1 at night. */
  readonly night: number;
  readonly exposure: number;
  readonly bloom: number;
  readonly saturation: number;
  readonly contrast: number;
  /** Grade tint applied to shadows and to highlights (sRGB, 0.5 gray = no change). */
  readonly shadowTint: Rgb;
  readonly highlightTint: Rgb;
}

/** A palette stop, keyed by sun elevation in degrees. */
interface Stop {
  readonly elevation: number;
  readonly zenith: string;
  readonly mid: string;
  readonly horizon: string;
  readonly horizonSun: string;
  readonly sunColor: string;
  readonly sunIntensity: number;
  readonly ambientSky: string;
  readonly ambientGround: string;
  readonly ambientIntensity: number;
  readonly fog: string;
  readonly fogSun: string;
  readonly fogDensity: number;
  readonly cloudLit: string;
  readonly cloudShade: string;
  readonly cloudCover: number;
  readonly exposure: number;
  readonly bloom: number;
  readonly saturation: number;
  readonly contrast: number;
  readonly shadowTint: string;
  readonly highlightTint: string;
}

/** From the lowest sun (night) up to the highest (late morning). */
const STOPS: readonly Stop[] = [
  {
    elevation: -24,
    zenith: '#050813',
    mid: '#0b1430',
    horizon: '#15264a',
    horizonSun: '#1b2e56',
    sunColor: '#5e7fc8',
    sunIntensity: 0.0,
    ambientSky: '#2a3f78',
    ambientGround: '#101a30',
    ambientIntensity: 0.5,
    fog: '#14213f',
    fogSun: '#1a2c52',
    fogDensity: 1.0,
    cloudLit: '#3a4a78',
    cloudShade: '#0d1428',
    cloudCover: 0.5,
    exposure: 1.35,
    bloom: 0.5,
    saturation: 0.95,
    contrast: 1.1,
    shadowTint: '#3a5fb0',
    highlightTint: '#9bc2ff',
  },
  {
    elevation: -8,
    zenith: '#101a45',
    mid: '#3a3f7a',
    horizon: '#8a5a8e',
    horizonSun: '#e8794a',
    sunColor: '#ff9a5a',
    sunIntensity: 0.0,
    ambientSky: '#4a5a9a',
    ambientGround: '#3a2a3e',
    ambientIntensity: 0.6,
    fog: '#5a4a80',
    fogSun: '#d8704a',
    fogDensity: 1.1,
    cloudLit: '#d6688a',
    cloudShade: '#2a2250',
    cloudCover: 0.5,
    exposure: 1.2,
    bloom: 0.8,
    saturation: 1.1,
    contrast: 1.12,
    shadowTint: '#4a3f9a',
    highlightTint: '#ffb27a',
  },
  {
    elevation: 0,
    zenith: '#1f3f86',
    mid: '#7a5a9e',
    horizon: '#e0829a',
    horizonSun: '#ff8a3a',
    sunColor: '#ff8d4a',
    sunIntensity: 2.2,
    ambientSky: '#6a74b8',
    ambientGround: '#6a4a3a',
    ambientIntensity: 0.8,
    fog: '#c98aa0',
    fogSun: '#ff9a50',
    fogDensity: 1.25,
    cloudLit: '#ffb27a',
    cloudShade: '#6a4a8a',
    cloudCover: 0.5,
    exposure: 1.1,
    bloom: 1.1,
    saturation: 1.18,
    contrast: 1.12,
    shadowTint: '#5a4aa8',
    highlightTint: '#ffa060',
  },
  {
    elevation: 12,
    zenith: '#2a55a2',
    mid: '#8f94bd',
    horizon: '#eab4a6',
    horizonSun: '#ffae58',
    sunColor: '#ffb56c',
    sunIntensity: 3.5,
    ambientSky: '#8296c4',
    ambientGround: '#8a6a4a',
    ambientIntensity: 0.7,
    fog: '#d9a0a0',
    fogSun: '#ffa85a',
    fogDensity: 1.0,
    cloudLit: '#ffcf98',
    cloudShade: '#9a7ea6',
    cloudCover: 0.58,
    exposure: 0.95,
    bloom: 1.0,
    saturation: 1.18,
    contrast: 1.16,
    shadowTint: '#6a6aa4',
    highlightTint: '#ffb26a',
  },
  {
    elevation: 26,
    zenith: '#2f6fc0',
    mid: '#7aa2d8',
    horizon: '#d8c8c4',
    horizonSun: '#ffc888',
    sunColor: '#ffd8a0',
    sunIntensity: 4.6,
    ambientSky: '#90b2e8',
    ambientGround: '#8a7a58',
    ambientIntensity: 1.1,
    fog: '#c8cbd0',
    fogSun: '#ffd8a0',
    fogDensity: 0.8,
    cloudLit: '#fff0dc',
    cloudShade: '#9ab0d0',
    cloudCover: 0.5,
    exposure: 0.95,
    bloom: 0.8,
    saturation: 1.12,
    contrast: 1.08,
    shadowTint: '#6078b8',
    highlightTint: '#ffd8a0',
  },
  {
    elevation: 45,
    zenith: '#2f74cc',
    mid: '#80b0e4',
    horizon: '#cfd8e0',
    horizonSun: '#ffe0b0',
    sunColor: '#fff1c9',
    sunIntensity: 4.8,
    ambientSky: '#98bcf0',
    ambientGround: '#8a8060',
    ambientIntensity: 1.15,
    fog: '#c4d2e0',
    fogSun: '#ffe4b8',
    fogDensity: 0.7,
    cloudLit: '#ffffff',
    cloudShade: '#a4b8d8',
    cloudCover: 0.48,
    exposure: 0.92,
    bloom: 0.7,
    saturation: 1.08,
    contrast: 1.06,
    shadowTint: '#6a82c0',
    highlightTint: '#fff0d0',
  },
];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Length of a full day-night cycle and its parts, in seconds (see docs/decisions.md). */
export const DAY_SECONDS = 8 * 60;
export const NIGHT_SECONDS = 4 * 60;
export const DUSK_SECONDS = 40;
export const CYCLE_SECONDS = DAY_SECONDS + NIGHT_SECONDS;

/** Sun elevation in degrees for a cycle phase in [0, 1). */
export function sunElevationAt(phase: number): number {
  const day = DAY_SECONDS / CYCLE_SECONDS;
  const dusk = DUSK_SECONDS / CYCLE_SECONDS;
  const p = phase - Math.floor(phase);
  if (p < day) return 12 + 33 * Math.sin((Math.PI * p) / day);
  if (p < day + dusk) return lerp(12, -14, smooth((p - day) / dusk));
  if (p < 1 - dusk) return lerp(-14, -26, smooth((p - day - dusk) / (1 - dusk - day - dusk)));
  return lerp(-14, 12, smooth((p - (1 - dusk)) / dusk));
}

/** Compass bearing of the sun in degrees (0 north, 90 east) for a cycle phase. */
export function sunBearingAt(phase: number): number {
  const day = DAY_SECONDS / CYCLE_SECONDS;
  const p = phase - Math.floor(phase);
  if (p < day) return lerp(98, 262, p / day);
  if (p < 1 - DUSK_SECONDS / CYCLE_SECONDS) return 262 + ((p - day) / (1 - day)) * 40;
  return 98 - (1 - p) * 40 * 4;
}

function directionFrom(bearingDeg: number, elevationDeg: number): [number, number, number] {
  const b = (bearingDeg * Math.PI) / 180;
  const e = (elevationDeg * Math.PI) / 180;
  const c = Math.cos(e);
  return [Math.sin(b) * c, Math.sin(e), -Math.cos(b) * c];
}

const PARSED = STOPS.map((s) => ({
  elevation: s.elevation,
  zenith: hexToRgb(s.zenith),
  mid: hexToRgb(s.mid),
  horizon: hexToRgb(s.horizon),
  horizonSun: hexToRgb(s.horizonSun),
  sunColor: hexToRgb(s.sunColor),
  sunIntensity: s.sunIntensity,
  ambientSky: hexToRgb(s.ambientSky),
  ambientGround: hexToRgb(s.ambientGround),
  ambientIntensity: s.ambientIntensity,
  fog: hexToRgb(s.fog),
  fogSun: hexToRgb(s.fogSun),
  fogDensity: s.fogDensity,
  cloudLit: hexToRgb(s.cloudLit),
  cloudShade: hexToRgb(s.cloudShade),
  cloudCover: s.cloudCover,
  exposure: s.exposure,
  bloom: s.bloom,
  saturation: s.saturation,
  contrast: s.contrast,
  shadowTint: hexToRgb(s.shadowTint),
  highlightTint: hexToRgb(s.highlightTint),
}));

/** The sky state for a sun elevation and bearing, blending the palette stops. */
export function skyStateAt(sunElevation: number, sunBearing: number): SkyState {
  const first = PARSED[0];
  const last = PARSED[PARSED.length - 1];
  if (!first || !last) throw new Error('palette is empty');
  let lo = first;
  let hi = last;
  let t = 0;
  if (sunElevation <= first.elevation) {
    hi = lo = first;
  } else if (sunElevation >= last.elevation) {
    lo = hi = last;
  } else {
    for (let i = 0; i + 1 < PARSED.length; i++) {
      const a = PARSED[i];
      const b = PARSED[i + 1];
      if (a && b && sunElevation >= a.elevation && sunElevation <= b.elevation) {
        lo = a;
        hi = b;
        t = smooth((sunElevation - a.elevation) / (b.elevation - a.elevation));
        break;
      }
    }
  }
  const sunDir = directionFrom(sunBearing, sunElevation);
  // The moon rides opposite the sun, high enough to light the night.
  const moonDir = directionFrom(sunBearing + 180, Math.max(18, 28 - sunElevation * 0.4));
  const night = 1 - smooth((sunElevation + 14) / 12);
  const moonLight = night * 0.9;
  return {
    sunDir,
    moonDir,
    sunElevation,
    zenith: lerpRgb(lo.zenith, hi.zenith, t),
    mid: lerpRgb(lo.mid, hi.mid, t),
    horizon: lerpRgb(lo.horizon, hi.horizon, t),
    horizonSun: lerpRgb(lo.horizonSun, hi.horizonSun, t),
    sunColor: lerpRgb(lo.sunColor, hi.sunColor, t),
    sunIntensity: lerp(lo.sunIntensity, hi.sunIntensity, t),
    moonColor: hexToRgb('#9fbcff'),
    moonIntensity: moonLight * 0.9,
    ambientSky: lerpRgb(lo.ambientSky, hi.ambientSky, t),
    ambientGround: lerpRgb(lo.ambientGround, hi.ambientGround, t),
    ambientIntensity: lerp(lo.ambientIntensity, hi.ambientIntensity, t),
    fog: lerpRgb(lo.fog, hi.fog, t),
    fogSun: lerpRgb(lo.fogSun, hi.fogSun, t),
    fogDensity: lerp(lo.fogDensity, hi.fogDensity, t),
    cloudLit: lerpRgb(lo.cloudLit, hi.cloudLit, t),
    cloudShade: lerpRgb(lo.cloudShade, hi.cloudShade, t),
    cloudCover: lerp(lo.cloudCover, hi.cloudCover, t),
    night,
    exposure: lerp(lo.exposure, hi.exposure, t),
    bloom: lerp(lo.bloom, hi.bloom, t),
    saturation: lerp(lo.saturation, hi.saturation, t),
    contrast: lerp(lo.contrast, hi.contrast, t),
    shadowTint: lerpRgb(lo.shadowTint, hi.shadowTint, t),
    highlightTint: lerpRgb(lo.highlightTint, hi.highlightTint, t),
  };
}

/** The sky state for a position in the day-night cycle, `phase` in [0, 1). */
export function skyStateForPhase(phase: number): SkyState {
  return skyStateAt(sunElevationAt(phase), sunBearingAt(phase));
}

/** Named moments for `?time=` and screenshots. */
export const TIME_PRESETS: Readonly<Record<string, { elevation: number; bearing: number }>> = {
  golden: { elevation: 13, bearing: 96 },
  morning: { elevation: 30, bearing: 118 },
  noon: { elevation: 45, bearing: 180 },
  afternoon: { elevation: 24, bearing: 236 },
  sunset: { elevation: 1.5, bearing: 270 },
  dusk: { elevation: -7, bearing: 278 },
  night: { elevation: -24, bearing: 300 },
};
