import { TIME_PRESETS } from '../shared/daycycle';
import { DEFAULT_BENCH_SECONDS, readFlags } from '../shared/flags';
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
  /** Start the benchmark at load: the game's `?bench=1`, flown through the valley once per preset. */
  readonly bench: boolean;
  /** Length of the benchmark route per preset, in seconds (the game's `?benchSeconds=`). */
  readonly benchSeconds: number;
  /** Presets the benchmark runs, in order; all three by default. */
  readonly benchPresets: readonly QualityName[];
  /** Forced internal render scale (disables the adaptive governor), or null. */
  readonly scale: number | null;
  readonly debug: boolean;
}

const ALL_PRESETS: readonly QualityName[] = ['low', 'balanced', 'ultra'];
/** Shortest and longest route; the game page stops at 1 s, tests here use a fraction of a second. */
const MIN_BENCH_SECONDS = 0.1;
const MAX_BENCH_SECONDS = 300;

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
  // The benchmark and debug switches are the game's own, so both pages read them the same way.
  const flags = readFlags(search);
  const time = p.get('time');
  const seed = Number(p.get('seed'));
  const scale = Number(p.get('scale'));
  const benchSeconds = Number(p.get('benchSeconds'));
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
    bench: flags.bench,
    benchSeconds:
      p.has('benchSeconds') && Number.isFinite(benchSeconds)
        ? Math.min(MAX_BENCH_SECONDS, Math.max(MIN_BENCH_SECONDS, benchSeconds))
        : DEFAULT_BENCH_SECONDS,
    benchPresets: readBenchPresets(p.get('benchPresets')),
    scale: p.has('scale') && Number.isFinite(scale) && scale > 0 ? Math.min(1, scale) : null,
    debug: flags.debug,
  };
}
