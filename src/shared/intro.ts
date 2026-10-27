/**
 * The intro film: what happens when, in seconds from its first frame. Pure data and arithmetic, so
 * the director that flies the camera, the overlay that letterboxes and captions it and the tests
 * all read one script. The picture itself (the fall, the crater, the machines in the dark) is the
 * engine's; this file says when each part is on, what the captions say and how the sky runs.
 *
 * The film is a short, skippable prologue to a fresh run, with no dialogue and no choices: the
 * station's reactor falls out of the dusk, lands in the valley, the machines of the wreck wake in
 * the night and the dawn that follows is the first morning of the run. Its sky is the game's own
 * day-night cycle run through in a few seconds, and it ends on exactly the sky the run opens with,
 * so the hand-over to the player is not a cut.
 */
import { CYCLE_SECONDS, DAY_SECONDS } from './daycycle';

/** What the captions call the station. */
export const STATION_NAME = 'Vesper';

/** The title card. */
export const INTRO_TITLE = {
  title: 'Ashbound Outpost',
  subtitle: 'Scavenge by day. Hold the line by night.',
} as const;

export type SceneName = 'skyfall' | 'skid' | 'crater' | 'eyes' | 'dawn' | 'wake';

interface SceneSeed {
  readonly name: SceneName;
  readonly seconds: number;
}

/** The scenes in order and how long each one runs. */
const SCENE_SEEDS: readonly SceneSeed[] = [
  { name: 'skyfall', seconds: 8 },
  { name: 'skid', seconds: 6.5 },
  { name: 'crater', seconds: 8 },
  { name: 'eyes', seconds: 7 },
  { name: 'dawn', seconds: 8.5 },
  { name: 'wake', seconds: 5.5 },
];

export interface Scene {
  readonly name: SceneName;
  /** Seconds from the start of the film to this scene's first frame. */
  readonly from: number;
  /** Seconds from the start of the film to the end of this scene. */
  readonly to: number;
}

export const SCENES: readonly Scene[] = (() => {
  let at = 0;
  return SCENE_SEEDS.map(({ name, seconds }) => {
    const scene = { name, from: at, to: at + seconds };
    at += seconds;
    return scene;
  });
})();

/** How long the film runs, in seconds. */
export const INTRO_SECONDS = SCENES[SCENES.length - 1]?.to ?? 0;

/** The scene that plays at `time`; the last one for a time past the end. */
export function sceneAt(time: number): Scene {
  for (const scene of SCENES) if (time < scene.to) return scene;
  return SCENES[SCENES.length - 1] as Scene;
}

/** Seconds from the start of the film to `seconds` into the named scene. */
export function sceneTime(name: SceneName, seconds = 0): number {
  const scene = SCENES.find((s) => s.name === name);
  if (!scene) throw new Error(`The intro has no scene "${name}"`);
  return scene.from + seconds;
}

/** A line of caption, on screen from `from` to `to` (fades included). */
export interface Caption {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export const CAPTIONS: readonly Caption[] = [
  {
    from: sceneTime('skyfall', 1.2),
    to: sceneTime('skyfall', 6.6),
    text: `Station ${STATION_NAME} lost her reactor over an unnamed world.`,
  },
  {
    from: sceneTime('crater', 1.6),
    to: sceneTime('crater', 6.8),
    text: 'What the fall left standing, the night came to take.',
  },
  {
    from: sceneTime('eyes', 1.2),
    to: sceneTime('eyes', 6),
    text: 'The wreck was not empty. Its machines woke in the dark.',
  },
];

/** Seconds a caption takes to fade in and to fade out. */
export const CAPTION_FADE = 0.7;

/** When the title card is up (fades included), and how long it takes to arrive and to leave. */
export const TITLE_WINDOW = {
  from: sceneTime('dawn', 2.4),
  to: sceneTime('dawn', 8.2),
  fade: 1.2,
} as const;

/** Where the reactor first touches the ground: the flash, the roar and the start of the furrow. */
export const TOUCHDOWN_AT = sceneTime('skid', 0);
/** When the wreck stops in the crater. */
export const STOP_AT = sceneTime('skid', 4.4);

/** Letterbox bars slide in over this long at the start and out at the end. */
const BARS_SLIDE = 1.1;

/** The skip prompt shows from this long into the film. */
export const SKIP_HINT_FROM = 1.6;
/** And dims once it has been up this long. */
export const SKIP_HINT_DIM_AFTER = 6;

/**
 * The cuts that hide a change of place: a short dip to black at each, centered on `at` and lasting
 * `seconds` in all.
 */
export const DIPS: readonly { readonly at: number; readonly seconds: number }[] = [
  { at: sceneTime('crater', 0), seconds: 0.6 },
  { at: sceneTime('eyes', 0), seconds: 0.5 },
  { at: sceneTime('dawn', 0), seconds: 0.5 },
  { at: sceneTime('wake', 0), seconds: 0.7 },
];

/** Where the sun stands as the film runs: [seconds, cycle phase] knots, joined by straight lines. */
const SKY_KNOTS: readonly (readonly [number, number])[] = [
  // The dusk of the day the reactor fell: the sun is low on the western hills and the sky going violet.
  [0, DAY_SECONDS / CYCLE_SECONDS + 0.0125],
  [sceneTime('skid', 0), DAY_SECONDS / CYCLE_SECONDS + 0.022],
  // The night runs fast, with the last of the dusk burning off the western sky.
  [sceneTime('crater', 0), DAY_SECONDS / CYCLE_SECONDS + 0.033],
  [sceneTime('eyes', 0), 0.8],
  [sceneTime('dawn', 0), 0.935],
  // The dawn that is the first morning of the run: the sky the game opens with.
  [sceneTime('dawn', 6.5), 1],
  [INTRO_SECONDS, 1],
];

/** A position in the game's day-night cycle ([0, 1], 1 being the start of the run's first day) at `time` seconds into the film. */
export function introPhaseAt(time: number): number {
  const first = SKY_KNOTS[0] as readonly [number, number];
  if (time <= first[0]) return first[1];
  for (let i = 1; i < SKY_KNOTS.length; i++) {
    const [t1, p1] = SKY_KNOTS[i] as readonly [number, number];
    if (time <= t1) {
      const [t0, p0] = SKY_KNOTS[i - 1] as readonly [number, number];
      return t1 > t0 ? p0 + ((p1 - p0) * (time - t0)) / (t1 - t0) : p1;
    }
  }
  return (SKY_KNOTS[SKY_KNOTS.length - 1] as readonly [number, number])[1];
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Smooth start and finish: 0 at 0, 1 at 1, flat at both ends. */
export function smoothstep01(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

/** A gentler start and finish than `smoothstep01`: flat at both ends to the second order. */
export function smootherstep01(x: number): number {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** A hump that rises over `rise` seconds to 1 at `from`, holds, and falls to 0 over `fall` seconds after `to`. */
function pulse(time: number, from: number, to: number, rise: number, fall: number): number {
  const up = rise > 0 ? smoothstep01((time - (from - rise)) / rise) : time >= from ? 1 : 0;
  const down = fall > 0 ? 1 - smoothstep01((time - to) / fall) : time <= to ? 1 : 0;
  return Math.min(up, down);
}

/**
 * Everything the overlay shows over the picture at one moment of the film. The numbers are shares
 * (0 to 1) so that the overlay decides how they look.
 */
export interface IntroFrame {
  /** How far the picture is faded to black. */
  black: number;
  /** How far it is washed out by a white flash. */
  flash: number;
  /** How far the letterbox bars have slid in, of their full height. */
  bars: number;
  /** How closed the eyes are: 0 wide open, 1 shut. Only the waking at the end closes them. */
  lids: number;
  /** The caption on screen, or null, and how clearly. */
  caption: string | null;
  captionAlpha: number;
  /** How far the title card has arrived. */
  title: number;
  /** How clearly the prompt to skip shows. */
  skipHint: number;
}

export function createIntroFrame(): IntroFrame {
  return {
    black: 1,
    flash: 0,
    bars: 0,
    lids: 0,
    caption: null,
    captionAlpha: 0,
    title: 0,
    skipHint: 0,
  };
}

/** A white flash that rises in an instant at `at` and burns off over `fall` seconds, scaled by `strength`. */
function burst(time: number, at: number, fall: number, strength: number): number {
  const age = time - at;
  if (age < -0.04 || age > fall) return 0;
  if (age < 0) return (strength * (age + 0.04)) / 0.04;
  return strength * (1 - smoothstep01(age / fall)) ** 1.5;
}

/**
 * The overlay for `time` seconds into the film, written into `out`. The film opens out of black,
 * flashes white at the touchdown and when the wreck stops, dips to black at the cuts that change
 * the place, and ends with the eyes of the survivor opening on the morning.
 */
export function introFrameAt(time: number, out: IntroFrame): IntroFrame {
  let black = 1 - smoothstep01(time / 1.6);
  for (const dip of DIPS) {
    const half = dip.seconds / 2;
    const away = Math.abs(time - dip.at);
    if (away < half) black = Math.max(black, 1 - smoothstep01(away / half));
  }
  out.black = black;

  out.flash = Math.max(burst(time, TOUCHDOWN_AT, 0.55, 0.85), burst(time, STOP_AT, 0.9, 0.3));

  out.bars =
    smoothstep01(time / BARS_SLIDE) *
    (1 - smoothstep01((time - (INTRO_SECONDS - BARS_SLIDE)) / BARS_SLIDE));

  // The survivor wakes: shut at the cut, then two slow openings with a blink between them.
  const wake = time - sceneTime('wake', 0);
  let lids = 0;
  if (wake >= 0) {
    if (wake < 0.9) lids = 1;
    else if (wake < 2.3) lids = 1 - smoothstep01((wake - 0.9) / 1.4) * 0.78;
    else if (wake < 2.75) lids = 0.22 + smoothstep01((wake - 2.3) / 0.45) * 0.78;
    else if (wake < 3.4) lids = 1 - smoothstep01((wake - 2.75) / 0.65);
    else lids = 0;
  }
  out.lids = lids;

  out.caption = null;
  out.captionAlpha = 0;
  for (const caption of CAPTIONS) {
    if (time < caption.from || time > caption.to) continue;
    out.caption = caption.text;
    out.captionAlpha = Math.min(
      smoothstep01((time - caption.from) / CAPTION_FADE),
      1 - smoothstep01((time - (caption.to - CAPTION_FADE)) / CAPTION_FADE),
    );
    break;
  }

  out.title = pulse(
    time,
    TITLE_WINDOW.from + TITLE_WINDOW.fade,
    TITLE_WINDOW.to - TITLE_WINDOW.fade,
    TITLE_WINDOW.fade,
    TITLE_WINDOW.fade,
  );

  out.skipHint =
    smoothstep01((time - SKIP_HINT_FROM) / 0.8) *
    (1 - 0.6 * smoothstep01((time - SKIP_HINT_FROM - SKIP_HINT_DIM_AFTER) / 1.5)) *
    (1 - smoothstep01((time - (INTRO_SECONDS - 1.2)) / 0.8));
  return out;
}

/** What the URL says about the intro. */
export type IntroMode = 'auto' | 'on' | 'off';

/** The things that decide whether a fresh run opens with the film. */
export interface IntroWish {
  /** `?intro=on` plays it whatever else is going on and `?intro=off` never does. */
  readonly mode: IntroMode;
  /** The player's own preference, kept with their other settings. */
  readonly setting: boolean;
  /** The browser is driven by a script or a test, which a film in the way would only hold up. */
  readonly automated: boolean;
  /** The URL asks for something other than the plain start: a held time of day, a night, a viewpoint, a demo, a benchmark, no HUD. */
  readonly custom: boolean;
  /** The player's system asks for less motion, which a film of flashes and a shaking camera is not. */
  readonly reducedMotion: boolean;
}

/** Whether a fresh run should open with the film. */
export function introWanted({
  mode,
  setting,
  automated,
  custom,
  reducedMotion,
}: IntroWish): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return setting && !automated && !custom && !reducedMotion;
}
