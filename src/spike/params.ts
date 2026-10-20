import { TIME_PRESETS } from '../shared/daycycle';
import { readQuality, type QualityName } from '../shared/quality';

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
  /** Hide the HUD. */
  readonly hud: boolean;
  /** Freeze animation (clouds, wind, water) so screenshots are repeatable. */
  readonly freeze: boolean;
  /** Run the benchmark overlay (cycles all presets along a fixed camera path). */
  readonly bench: boolean;
  /** Forced internal render scale (disables the adaptive governor), or null. */
  readonly scale: number | null;
  readonly debug: boolean;
}

export function readLookParams(search: string): LookParams {
  const p = new URLSearchParams(search);
  const time = p.get('time');
  const seed = Number(p.get('seed'));
  const scale = Number(p.get('scale'));
  return {
    quality: readQuality(search),
    seed: Number.isFinite(seed) && p.has('seed') ? seed | 0 : 20261020,
    time: time && time in TIME_PRESETS ? time : null,
    clock: p.has('clock') && p.get('clock') !== '0',
    shot: p.get('shot'),
    hud: p.get('hud') !== '0',
    freeze: p.has('freeze') && p.get('freeze') !== '0',
    bench: p.has('bench') && p.get('bench') !== '0',
    scale: p.has('scale') && Number.isFinite(scale) && scale > 0 ? Math.min(1, scale) : null,
    debug: p.has('debug'),
  };
}
