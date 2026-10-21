import { TIME_PRESETS } from './daycycle';
import { QUALITY_NAMES, isQualityName, type QualityName } from './quality';

/** How the terrain mesh is built: the real mesher, or the smoothed heightfield it is measured against. */
export type TerrainMode = 'surface-nets' | 'heightfield';

/** The seed of the valley the game opens with; the golden values in the tests belong to it. */
export const DEFAULT_SEED = 20261020;

/**
 * URL switches for how the world looks and what the benchmark runs, next to the development
 * switches in `flags.ts`. All of them are optional; the defaults give the hero view.
 */
export interface ViewFlags {
  /** Starting preset, or null to use the one saved in the settings. */
  readonly quality: QualityName | null;
  /** Seed of the valley. */
  readonly seed: number;
  /** A named moment from TIME_PRESETS when the URL asks for one. */
  readonly time: string | null;
  /** Run the day-night cycle (compressed to about two minutes) instead of a fixed moment. */
  readonly clock: boolean;
  /** Named viewpoint to take photos from (see `world/terrain/viewpoints.ts`); the player walks when absent. */
  readonly shot: string | null;
  readonly terrain: TerrainMode;
  /** False hides the whole HUD, for clean screenshots. */
  readonly hud: boolean;
  /** False keeps the frame overlay off even when `?bench` or `?debug` would show it. */
  readonly stats: boolean;
  /** Freeze animation (clouds, wind, water) so screenshots are repeatable. */
  readonly freeze: boolean;
  /** Forced internal render scale (disables the adaptive governor), or null. */
  readonly scale: number | null;
  /** Presets the benchmark runs, in order; all three by default. */
  readonly benchPresets: readonly QualityName[];
}

/** `?benchPresets=balanced,ultra` picks which presets the benchmark runs. */
function readBenchPresets(value: string | null): readonly QualityName[] {
  const picked = (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(isQualityName);
  return picked.length > 0 ? [...new Set(picked)] : QUALITY_NAMES;
}

export function readViewFlags(search: string): ViewFlags {
  const p = new URLSearchParams(search);
  const time = p.get('time');
  const quality = p.get('quality');
  const seed = Number(p.get('seed'));
  const scale = Number(p.get('scale'));
  return {
    quality: isQualityName(quality) ? quality : null,
    seed: p.has('seed') && Number.isFinite(seed) ? seed | 0 : DEFAULT_SEED,
    time: time && time in TIME_PRESETS ? time : null,
    clock: p.has('clock') && p.get('clock') !== '0',
    shot: p.get('shot'),
    terrain: p.get('terrain') === 'heightfield' ? 'heightfield' : 'surface-nets',
    hud: p.get('hud') !== '0',
    stats: p.get('stats') !== '0',
    freeze: p.has('freeze') && p.get('freeze') !== '0',
    scale: p.has('scale') && Number.isFinite(scale) && scale > 0 ? Math.min(1, scale) : null,
    benchPresets: readBenchPresets(p.get('benchPresets')),
  };
}
