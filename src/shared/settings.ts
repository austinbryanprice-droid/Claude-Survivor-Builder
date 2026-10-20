/** Player preferences that the engine reads every frame. The UI edits them and stores them. */
export interface Settings {
  /** Multiplier on the base turn rate; 1 is the default feel. */
  mouseSensitivity: number;
  /** Vertical field of view in degrees. */
  fov: number;
  invertY: boolean;
}

export const SETTINGS_LIMITS = {
  mouseSensitivity: { min: 0.1, max: 4, step: 0.05 },
  fov: { min: 55, max: 110, step: 1 },
} as const;

export const DEFAULT_SETTINGS: Settings = {
  mouseSensitivity: 1,
  fov: 70,
  invertY: false,
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Turns anything read back from storage into valid settings; unknown or broken fields fall back to defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const { mouseSensitivity, fov } = SETTINGS_LIMITS;
  return {
    mouseSensitivity: clampNumber(
      source.mouseSensitivity,
      mouseSensitivity.min,
      mouseSensitivity.max,
      DEFAULT_SETTINGS.mouseSensitivity,
    ),
    fov: clampNumber(source.fov, fov.min, fov.max, DEFAULT_SETTINGS.fov),
    invertY: typeof source.invertY === 'boolean' ? source.invertY : DEFAULT_SETTINGS.invertY,
  };
}
