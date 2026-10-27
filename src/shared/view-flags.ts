import { TIME_PRESETS } from './daycycle';
import type { IntroMode } from './intro';
import { QUALITY_NAMES, isQualityName, type QualityName } from './quality';
import type { TitleMode } from './title';

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
  /** Start the run at the beginning of this night (1 is the first), for trying the later nights; null starts at the first morning. */
  readonly night: number | null;
  /** False keeps the nights empty (`?waves=0`), for pictures and tests that want a quiet night; the waves come by default. */
  readonly waves: boolean;
  /** Open the crew's pool with this much of every material (`?stock=200`; the pool's ceiling still holds), to build without gathering; null opens it as the economy's table says. */
  readonly stock: number | null;
  /** Open the run with this many research points (`?research=55` has Composite and Alloy researched), to build with the better materials without surviving the nights; null earns them by surviving as usual. */
  readonly research: number | null;
  /** Named viewpoint to take photos from (see `world/terrain/viewpoints.ts`); the player walks when absent. */
  readonly shot: string | null;
  readonly terrain: TerrainMode;
  /** Name of a structure that builds itself on the valley (see `world/voxels/demo.ts`), or null. */
  readonly demo: string | null;
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
  /** `?intro=on` plays the opening film whatever else the URL asks for, `?intro=off` never plays it; by default it plays once on a plain start. */
  readonly intro: IntroMode;
  /** `?introAt=12.5` shows the film as it is 12.5 seconds in and holds it there, for pictures and tests; null plays it as normal. */
  readonly introAt: number | null;
  /** `?title=on` opens on the title screen whatever else the URL asks for, `?title=off` never does; by default every plain start opens on it. */
  readonly title: TitleMode;
}

/** The latest night `?night=` can ask for. */
export const MAX_START_NIGHT = 99;

/** `?night=5` starts the run at nightfall of the fifth night. Anything that is not a whole night from 1 on is ignored. */
function readNight(value: string | null): number | null {
  if (value === null || !/^\d{1,3}$/.test(value)) return null;
  const night = Number(value);
  return night >= 1 && night <= MAX_START_NIGHT ? night : null;
}

/** The most `?stock=` can ask for; the pool's own ceiling is lower. */
export const MAX_START_STOCK = 9999;

/** `?stock=200` opens the pool with 200 of every material. Anything that is not a whole number from 0 up is ignored. */
function readStock(value: string | null): number | null {
  if (value === null || !/^\d{1,4}$/.test(value)) return null;
  return Math.min(MAX_START_STOCK, Number(value));
}

/** The most `?research=` can ask for; the economy's own ceiling for research points is the same. */
export const MAX_START_RESEARCH = 9999;

/** `?research=55` opens the run with 55 research points. Anything that is not a whole number from 0 up is ignored. */
function readResearch(value: string | null): number | null {
  if (value === null || !/^\d{1,4}$/.test(value)) return null;
  return Math.min(MAX_START_RESEARCH, Number(value));
}

/**
 * A switch with three states: `?name` and `?name=on` ask for the thing, `?name=off` (or 0) for none
 * of it, and anything else leaves it to the page. The intro film and the title screen read it.
 */
function readSwitch(value: string | null): TitleMode {
  if (value === null) return 'auto';
  const word = value.toLowerCase();
  if (word === 'off' || word === '0' || word === 'false') return 'off';
  if (word === '' || word === 'on' || word === '1' || word === 'true') return 'on';
  return 'auto';
}

/** `?introAt=12.5` holds the film at 12.5 seconds. Anything that is not a number of seconds from 0 up is ignored. */
function readIntroAt(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
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
    night: readNight(p.get('night')),
    waves: p.get('waves') !== '0',
    stock: readStock(p.get('stock')),
    research: readResearch(p.get('research')),
    shot: p.get('shot'),
    terrain: p.get('terrain') === 'heightfield' ? 'heightfield' : 'surface-nets',
    demo: p.get('demo'),
    hud: p.get('hud') !== '0',
    stats: p.get('stats') !== '0',
    freeze: p.has('freeze') && p.get('freeze') !== '0',
    scale: p.has('scale') && Number.isFinite(scale) && scale > 0 ? Math.min(1, scale) : null,
    benchPresets: readBenchPresets(p.get('benchPresets')),
    intro: readSwitch(p.get('intro')),
    introAt: readIntroAt(p.get('introAt')),
    title: readSwitch(p.get('title')),
  };
}
