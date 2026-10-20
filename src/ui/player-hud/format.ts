/** Pure helpers for the player HUD: numbers in, display values out. No DOM here, so tests can use them. */

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Signed shortest angle from `heading` to `bearing` in degrees, within [-180, 180). */
export function relativeBearing(bearing: number, heading: number): number {
  return ((((bearing - heading) % 360) + 540) % 360) - 180;
}

/** Wraps a compass bearing into [0, 360). */
export function wrapBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** "540M" under a kilometer, "1.2KM" above, as the compass shows distances to a marker. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(0, Math.round(meters))}M`;
  return `${(meters / 1000).toFixed(1)}KM`;
}

/** "10:52" for a buff timer. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/** The letter shown at a multiple of 90 degrees, or null elsewhere. */
export function cardinalLabel(degrees: number): string | null {
  switch (wrapBearing(degrees)) {
    case 0:
      return 'N';
    case 90:
      return 'E';
    case 180:
      return 'S';
    case 270:
      return 'W';
    default:
      return null;
  }
}

/**
 * How full each segment of a segmented bar is (each 0 to 1), filling from the left. The health
 * bar is drawn in segments, so a hit empties the last one first.
 */
export function segmentFills(fraction: number, segments: number): number[] {
  const count = Math.max(1, Math.floor(segments));
  const total = clamp01(fraction) * count;
  const fills: number[] = [];
  for (let i = 0; i < count; i++) fills.push(clamp01(total - i));
  return fills;
}

/** Scale factor for the HUD from the viewport size; the layout is drawn for 1280 by 720. */
export function hudScale(width: number, height: number): number {
  const scale = Math.min(width / 1280, height / 720);
  return Math.min(1.7, Math.max(0.7, Number.isFinite(scale) ? scale : 1));
}
