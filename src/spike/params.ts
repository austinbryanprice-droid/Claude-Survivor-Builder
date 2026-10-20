import { TIME_PRESETS } from '../shared/daycycle';
import { isQualityName, readQuality, type QualityName } from '../shared/quality';
import type { TerrainMode } from '../world/render/terrain-render';

/** URL switches of the look spike. Everything is optional; the defaults give the hero view. */
export interface LookParams {
  readonly quality: QualityName;
  /** Seed of the valley. */
  readonly seed: number;
  /** A named moment from TIME_PRESETS when the URL asks for one; shots bring their own. */
  readonly time: string | null;
  /** Run the day-night cycle (compressed to about two minutes) instead of a fixed moment. */
  readonly clock: boolean;
  /** Named camera shot to start at; the hero view when absent. */
  readonly shot: string | null;
  /** Terrain mesher: surface nets, or the smoothed heightfield it is measured against. */
  readonly terrain: TerrainMode;
  /** Hide the HUD. */
  readonly hud: boolean;
  /** Show the frame cost readout and the key list; `stats=0` hides them for clean screenshots. */
  readonly stats: boolean;
  /** Freeze animation (clouds, wind, water) so screenshots are repeatable. */
  readonly freeze: boolean;
  /** Start the benchmark at load (cycles all presets along a fixed camera path). */
  readonly bench: boolean;
  /** Length of the benchmark route per preset, in seconds. */
  readonly benchSeconds: number;
  /** Frames drawn before each benchmark measurement starts. */
  readonly benchWarmup: number;
  /** Presets the benchmark runs, in order; all three by default. */
  readonly benchPresets: readonly QualityName[];
  /** Forced internal render scale (disables the adaptive governor), or null. */
  readonly scale: number | null;
  readonly debug: boolean;
}

const ALL_PRESETS: readonly QualityName[] = ['low', 'balanced', 'ultra'];

/** `?benchPresets=balanced,ultra` picks which presets the benchmark runs. */
function readBenchPresets(value: string | null): readonly QualityName[] {
  const picked = (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(isQualityName);
  return picked.length > 0 ? [...new Set(picked)] : ALL_PRESETS;
}

export function readLookParams(search: string): LookParams {
  const p = new URLSearchParams(search);
  const time = p.get('time');
  const seed = Number(p.get('seed'));
  const scale = Number(p.get('scale'));
  const benchSeconds = Number(p.get('benchSeconds'));
  const benchWarmup = Number(p.get('benchWarmup'));
  return {
    quality: readQuality(search),
    seed: Number.isFinite(seed) && p.has('seed') ? seed | 0 : 20261020,
    time: time && time in TIME_PRESETS ? time : null,
    clock: p.has('clock') && p.get('clock') !== '0',
    shot: p.get('shot'),
    terrain: p.get('terrain') === 'heightfield' ? 'heightfield' : 'surface-nets',
    hud: p.get('hud') !== '0',
    stats: p.get('stats') !== '0',
    freeze: p.has('freeze') && p.get('freeze') !== '0',
    bench: p.has('bench') && p.get('bench') !== '0',
    benchSeconds:
      p.has('benchSeconds') && Number.isFinite(benchSeconds)
        ? Math.min(120, Math.max(0.1, benchSeconds))
        : 12,
    benchPresets: readBenchPresets(p.get('benchPresets')),
    benchWarmup:
      p.has('benchWarmup') && Number.isFinite(benchWarmup)
        ? Math.min(600, Math.max(0, Math.round(benchWarmup)))
        : 90,
    scale: p.has('scale') && Number.isFinite(scale) && scale > 0 ? Math.min(1, scale) : null,
    debug: p.has('debug'),
  };
}
