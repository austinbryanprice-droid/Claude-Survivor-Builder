import { DEFAULT_QUALITY, isQualityName, type QualityName } from './quality';

/** Player preferences that the engine reads every frame. The UI edits them and stores them. */
export interface Settings {
  /** Multiplier on the base turn rate; 1 is the default feel. */
  mouseSensitivity: number;
  /** Vertical field of view in degrees. */
  fov: number;
  invertY: boolean;
  /** Graphics preset; a `?quality=` switch overrides it for one visit. */
  quality: QualityName;
  /** Opens a fresh game with the intro film. It can always be skipped, or watched again from the pause card. */
  intro: boolean;
  /** Master volume of everything the game sounds, 0 (silent) to 1. The film's mix is set to peak just under the top at 1, so the slider only turns it down. */
  volume: number;
}

export const SETTINGS_LIMITS = {
  mouseSensitivity: { min: 0.1, max: 4, step: 0.05 },
  fov: { min: 55, max: 110, step: 1 },
  volume: { min: 0, max: 1, step: 0.05 },
} as const;

export const DEFAULT_SETTINGS: Settings = {
  mouseSensitivity: 1,
  fov: 70,
  invertY: false,
  quality: DEFAULT_QUALITY,
  intro: true,
  volume: 1,
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Turns anything read back from storage into valid settings; unknown or broken fields fall back to defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const { mouseSensitivity, fov, volume } = SETTINGS_LIMITS;
  return {
    mouseSensitivity: clampNumber(
      source.mouseSensitivity,
      mouseSensitivity.min,
      mouseSensitivity.max,
      DEFAULT_SETTINGS.mouseSensitivity,
    ),
    fov: clampNumber(source.fov, fov.min, fov.max, DEFAULT_SETTINGS.fov),
    invertY: typeof source.invertY === 'boolean' ? source.invertY : DEFAULT_SETTINGS.invertY,
    quality:
      typeof source.quality === 'string' && isQualityName(source.quality)
        ? source.quality
        : DEFAULT_SETTINGS.quality,
    intro: typeof source.intro === 'boolean' ? source.intro : DEFAULT_SETTINGS.intro,
    volume: clampNumber(source.volume, volume.min, volume.max, DEFAULT_SETTINGS.volume),
  };
}
