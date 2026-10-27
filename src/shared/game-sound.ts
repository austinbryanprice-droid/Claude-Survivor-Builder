import { dbToGain, lerp, noteHz } from './audio';
import { DUSK_SECONDS } from './daycycle';
import { createRng, hash32 } from './hash';
import type { Cue } from './intro-sound';
import type { DayPhase, SurvivalEvent } from './survival-state';

/**
 * What the valley sounds like while it is played, with nothing of the browser in it: how loud each
 * long sound is for the hour and the danger, the notes the sparse music plays, and the stinger
 * ahead of a wave. `engine/audio/live.ts` turns these into Web Audio; the numbers are here so that
 * a test reads the mix and the music the way the player hears them. The sounds themselves are the
 * film's (`engine/audio/voices.ts`, `beds.ts`): the same wind, the same Core hum and the same
 * low note, steered by the clock instead of by the film.
 */

/** A sound to start now: a cue of the film without its place in a score. */
export type LiveCue = Omit<Cue, 'at'>;

/** How the valley stands, once a frame: everything the long sounds and the music follow. */
export interface SoundScene {
  /** 0 by day and 1 by night, following the sky through the dusk and the dawn. */
  readonly night: number;
  /** 0 while the valley is quiet and 1 with the machines at the walls. */
  readonly danger: number;
  /** 0 far from the Core's hum and 1 beside it. */
  readonly nearCore: number;
  /** The run's clock is held (the mouse is free) or the run is over: the music waits, and the long sounds go on. */
  readonly held: boolean;
}

/** A scene with nothing happening in it: broad day, no machines, far from the Core. */
export const QUIET_SCENE: SoundScene = { night: 0, danger: 0, nearCore: 0, held: false };

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smooth(value: number): number {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
}

/**
 * How far into the night the sky is, 0 by day and 1 in the dark of the night. The light changes over
 * `DUSK_SECONDS` after nightfall and again before the dawn, as the sky does (`sunElevationAt`).
 */
export function nightAmount(phase: DayPhase, into: number, left: number): number {
  if (phase === 'day') return 0;
  return Math.min(smooth(into / DUSK_SECONDS), smooth(left / DUSK_SECONDS));
}

/** Blocks within which a machine is at the player's back, and beyond which the valley is quiet. */
export const DANGER = { near: 14, far: 64, floor: 0.2 } as const;

/**
 * How tense the night is for one player: nothing while no machine lives, a little while they are
 * far away and more as the nearest closes in. `nearest` is its distance in blocks, or null where
 * there is none.
 */
export function dangerFrom(nearest: number | null): number {
  if (nearest === null) return 0;
  const close = clamp01((DANGER.far - nearest) / (DANGER.far - DANGER.near));
  return DANGER.floor + (1 - DANGER.floor) * close;
}

/** Blocks within which the Core's hum is at its loudest, and beyond which it is at its quietest. */
export const HUM_RANGE = { near: 10, far: 70 } as const;

/** 1 beside the Core, falling to 0 at `HUM_RANGE.far` blocks; `distance` is from the player to the Core. */
export function nearCoreFrom(distance: number): number {
  return 1 - smooth((distance - HUM_RANGE.near) / (HUM_RANGE.far - HUM_RANGE.near));
}

/** Moves `current` toward `target` the way a one-pole filter does: after `seconds` it has covered about two thirds of the way. */
export function follow(current: number, target: number, dt: number, seconds: number): number {
  if (!(dt > 0) || !(seconds > 0)) return current;
  return current + (target - current) * (1 - Math.exp(-dt / seconds));
}

/** Seconds the tension takes to follow a machine closing in, and to let go once it has gone. */
export const TENSION_SECONDS = { rise: 0.8, fall: 4 } as const;

/** What the sound is told about the valley each frame, in the game's own terms. */
export interface SceneInputs {
  readonly phase: DayPhase;
  /** Seconds into the phase and seconds left in it. */
  readonly into: number;
  readonly left: number;
  /** Blocks to the nearest machine, or null where there is none. */
  readonly nearestMachine: number | null;
  /** Blocks to the Core, or null where there is none to hear. */
  readonly coreDistance: number | null;
  /** False while the clock is held (the mouse is free). */
  readonly running: boolean;
  /** True once the run has ended. */
  readonly over: boolean;
}

/**
 * Turns what a frame shows into the scene the sound follows. The tension is the one part that
 * jumps (a machine comes out of the ground, another falls), so it rises over a moment and lets go
 * slowly, which is also how a heart behaves; the hour and the Core's hum change smoothly already.
 * The scene it returns is reused from call to call.
 */
export class SceneTracker {
  private danger = 0;
  private readonly scene = { night: 0, danger: 0, nearCore: 0, held: false };

  update(dt: number, inputs: SceneInputs): SoundScene {
    const target = dangerFrom(inputs.nearestMachine);
    const seconds = target > this.danger ? TENSION_SECONDS.rise : TENSION_SECONDS.fall;
    this.danger = follow(this.danger, target, dt, seconds);
    const { scene } = this;
    scene.night = nightAmount(inputs.phase, inputs.into, inputs.left);
    scene.danger = this.danger;
    scene.nearCore = inputs.coreDistance === null ? 0 : nearCoreFrom(inputs.coreDistance);
    scene.held = !inputs.running || inputs.over;
    return scene;
  }
}

/** What each long sound should be, for a scene. The engine eases toward these, never jumps. */
export interface Ambience {
  /** How loud each bed is, as a share of its own full level (the unit of `BedScore.gain`). */
  readonly wind: number;
  readonly hum: number;
  readonly drone: number;
  /** The wind's band in Hz, the third of the Core's chord in Hz, and the cutoff in Hz that darkens the drone. */
  readonly windHz: number;
  readonly thirdHz: number;
  readonly droneHz: number;
}

/**
 * How loud each long sound is, as the fader of its bed. The film runs them at 0.12 for the wind and a
 * little under 0.09 for the Core's hum under its music, and the film is the loudest thing in the
 * game; the valley is what is heard for hours, so the wind and the hum sit about ten decibels under
 * that and the low note of the night is brought up, which leaves the stingers and the heartbeat
 * their room.
 */
export const MIX = {
  wind: { day: 0.04, night: 0.02 },
  windHz: { day: 620, night: 360 },
  hum: 0.026,
  /** The share of the hum still heard far from the Core. */
  humFar: 0.3,
  drone: dbToGain(-20) * 0.8,
  droneHz: { calm: 180, tense: 420 },
  /** The third in the Core's chord: F sharp by day, F by night, as in the film's morning. */
  third: { day: noteHz('F#3'), night: noteHz('F3') },
  /** Seconds the long sounds take to follow a change of scene (the time constant of the ease). */
  ease: { level: 2.2, tone: 4 },
} as const;

export function ambienceFor(scene: SoundScene): Ambience {
  const { night, danger, nearCore } = scene;
  return {
    wind: lerp(MIX.wind.day, MIX.wind.night, night),
    hum: MIX.hum * lerp(MIX.humFar, 1, nearCore),
    drone: MIX.drone * night * night * lerp(0.7, 1, danger),
    windHz: lerp(MIX.windHz.day, MIX.windHz.night, night),
    thirdHz: lerp(MIX.third.day, MIX.third.night, smooth(night * 2)),
    droneHz: lerp(MIX.droneHz.calm, MIX.droneHz.tense, danger),
  };
}

/** One sound the music asks for, `after` seconds from the moment it was asked. */
export interface MusicCue {
  readonly after: number;
  readonly cue: LiveCue;
}

/** The notes the music plays: a major pentatonic of D in the day and the minor one by night. */
const SCALES = {
  day: ['D4', 'E4', 'F#4', 'A4', 'B4', 'D5', 'E5', 'F#5'].map(noteHz),
  night: ['D3', 'F3', 'G3', 'A3', 'C4', 'D4', 'F4'].map(noteHz),
} as const;

/** The chord a held pad plays, root first: D major by day and D minor by night. */
const CHORDS = {
  day: ['D3', 'A3', 'F#4'].map(noteHz),
  night: ['D3', 'A3', 'F4'].map(noteHz),
} as const;

/** The pace of the music, in seconds between one thing and the next. All of it is sparse: a note, then a long quiet. */
export const MUSIC = {
  note: { day: [7, 15], night: [10, 20] },
  pad: [55, 85],
  /** Seconds before the first note and the first pad after the game begins, so that the film's last chord has time to die. */
  firstNote: 6,
  firstPad: 24,
  /** The chance that a note is followed by a second one close behind it. */
  answer: 0.4,
  /** Levels in decibels. */
  level: { day: -16, night: -18, pad: -23 },
  /** A heartbeat joins the night once a machine is about: its gap in seconds is `calm` with the valley quiet and `tense` at the walls. */
  heart: { from: 0.08, calm: 1.7, tense: 0.72, quiet: -20, loud: -9 },
  /** Drums come in only when the machines are close: a hit every few seconds. */
  drum: { from: 0.55, gap: [3.2, 5.5], quiet: -22, loud: -12 },
} as const;

function between(rng: () => number, range: readonly [number, number] | readonly number[]): number {
  const [low, high] = range as readonly [number, number];
  return low + (high - low) * rng();
}

/**
 * The wait for the next thing once one has fallen due: `interval` seconds from when it fell due, which was `-left` seconds ago
 * (a step does not end on the dot), so that the pace does not depend on the size of the step. After a stall the next thing still
 * waits half an interval, so that the music does not catch up in a burst.
 */
function rearm(left: number, interval: number): number {
  return Math.max(left + interval, interval / 2);
}

/**
 * The sparse music, made as it goes: a bell-like note every so often, a pad now and then, and by
 * night, with the machines about, a heartbeat that quickens and a drum. It is a function of its seed
 * and of the scenes it is shown, so a test can listen to a whole night in a moment, and it holds
 * still while the clock is held.
 */
export class Composer {
  private readonly rng: () => number;
  private untilNote: number = MUSIC.firstNote;
  private untilPad: number = MUSIC.firstPad;
  private untilBeat = 0;
  private untilDrum = 0;
  private counter = 0;

  constructor(seed: number) {
    this.rng = createRng(hash32(seed ^ 0x6d757369));
  }

  /** Lets `dt` seconds of the game pass in `scene`, and returns what the music asks for in them. */
  advance(dt: number, scene: SoundScene): MusicCue[] {
    const out: MusicCue[] = [];
    if (scene.held || !(dt > 0)) return out;
    const dark = scene.night >= 0.5;
    const mode = dark ? 'night' : 'day';

    this.untilNote -= dt;
    if (this.untilNote <= 0) {
      this.untilNote = rearm(this.untilNote, between(this.rng, MUSIC.note[mode]));
      const notes = SCALES[mode];
      const first = Math.floor(this.rng() * notes.length);
      const pan = (this.rng() - 0.5) * 0.6;
      const level = MUSIC.level[mode];
      out.push(this.pluck(0, notes[first] as number, level, pan));
      if (this.rng() < MUSIC.answer) {
        // The answer is a step up or down the scale, a little softer, and comes a breath later.
        const step = this.rng() < 0.5 ? -1 : 1;
        const second = Math.min(notes.length - 1, Math.max(0, first + step));
        out.push(this.pluck(0.5 + this.rng() * 0.5, notes[second] as number, level - 3, pan));
      }
    }

    this.untilPad -= dt;
    if (this.untilPad <= 0) {
      this.untilPad = rearm(this.untilPad, between(this.rng, MUSIC.pad));
      for (const hz of CHORDS[mode]) {
        out.push({
          after: 0,
          cue: {
            voice: 'pad',
            level: MUSIC.level.pad,
            hz,
            seconds: 7,
            attack: 4,
            release: 5,
            seed: this.nextSeed(),
          },
        });
      }
    }

    if (dark && scene.danger >= MUSIC.heart.from) {
      this.untilBeat -= dt;
      if (this.untilBeat <= 0) {
        const tension = clamp01(scene.danger);
        this.untilBeat = rearm(this.untilBeat, lerp(MUSIC.heart.calm, MUSIC.heart.tense, tension));
        const level = lerp(MUSIC.heart.quiet, MUSIC.heart.loud, tension);
        // Two beats close together, the second a little softer: a heart, not a clock.
        out.push({ after: 0, cue: { voice: 'heart', level, hz: 55, seed: this.nextSeed() } });
        out.push({
          after: 0.26,
          cue: { voice: 'heart', level: level - 4, hz: 50, seed: this.nextSeed() },
        });
      }
    } else {
      this.untilBeat = 0;
    }

    if (dark && scene.danger >= MUSIC.drum.from) {
      this.untilDrum -= dt;
      if (this.untilDrum <= 0) {
        this.untilDrum = rearm(this.untilDrum, between(this.rng, MUSIC.drum.gap));
        const tension = clamp01((scene.danger - MUSIC.drum.from) / (1 - MUSIC.drum.from));
        out.push({
          after: 0,
          cue: {
            voice: 'timp',
            level: lerp(MUSIC.drum.quiet, MUSIC.drum.loud, tension),
            hz: 70,
            seed: this.nextSeed(),
          },
        });
      }
    } else {
      this.untilDrum = 0;
    }
    return out;
  }

  private pluck(after: number, hz: number, level: number, pan: number): MusicCue {
    return {
      after,
      cue: { voice: 'pluck', level, hz, seconds: 2.8, pan, seed: this.nextSeed() },
    };
  }

  private nextSeed(): number {
    this.counter++;
    return hash32(this.counter * 0x9e3779b1);
  }
}

/**
 * When the stinger starts after the word of a wave, how long its riser climbs (the riser voice
 * allows 3.6 seconds), and the levels in decibels of the riser and of the drum under its top.
 */
const STINGER = { start: 0.2, rise: 3.6, riser: -1, drum: -9 } as const;

/**
 * The stinger ahead of a wave: noise climbing for the last few seconds of the warning and a low
 * drum under its top, so that the crew hears it coming without a word on the screen. `after` is
 * seconds from the word that the wave is coming (ten seconds before it comes out of the ground).
 */
export function waveStinger(wave: number, of: number, seed: number): MusicCue[] {
  // Later waves of a night hit a little harder than the first.
  const weight = of > 1 ? (wave - 1) / (of - 1) : 0;
  const lift = lerp(0, 3, weight);
  return [
    {
      after: STINGER.start,
      cue: {
        voice: 'riser',
        level: STINGER.riser + lift,
        hz: 240,
        to: 3600,
        seconds: STINGER.rise,
        seed,
      },
    },
    {
      after: STINGER.start + STINGER.rise,
      cue: { voice: 'timp', level: STINGER.drum + lift, hz: 62, seed: hash32(seed + 1) },
    },
  ];
}

/** The word that night has fallen: the hull groans and the chord turns to the minor. */
export function nightfallCues(seed: number): MusicCue[] {
  return [
    {
      after: 0,
      cue: { voice: 'groan', level: -16, hz: 95, to: 52, seconds: 4.5, seed },
    },
    ...CHORDS.night.map((hz, i) => ({
      after: 0.6,
      cue: {
        voice: 'pad' as const,
        level: MUSIC.level.pad + 2,
        hz,
        seconds: 6,
        attack: 3,
        release: 6,
        seed: hash32(seed + 2 + i),
      },
    })),
  ];
}

/** The word that the dawn has come: the Core's glass note, and the chord turns to the major. */
export function dawnCues(seed: number): MusicCue[] {
  return [
    { after: 0, cue: { voice: 'ping', level: -13, hz: noteHz('D5'), seconds: 5, seed } },
    ...CHORDS.day.map((hz, i) => ({
      after: 0.4,
      cue: {
        voice: 'pad' as const,
        level: MUSIC.level.pad + 3,
        hz,
        seconds: 6,
        attack: 3,
        release: 6,
        seed: hash32(seed + 2 + i),
      },
    })),
  ];
}

/**
 * What the host's words sound like: a groan as night falls, a riser and a drum ahead of each wave, a
 * bell at the dawn, and nothing for the rest. Every screen turns the same word into the same sound
 * for the same world, so the crew hears one night.
 */
export function cuesForEvent(event: SurvivalEvent, worldSeed: number): MusicCue[] {
  const seedOf = (night: number, wave: number): number =>
    hash32(worldSeed + night * 1009 + wave * 31);
  switch (event.k) {
    case 'nightfall':
      return nightfallCues(seedOf(event.n, 0));
    case 'wave':
      return waveStinger(event.i, event.of, seedOf(event.n, event.i));
    case 'dawn':
      return dawnCues(seedOf(event.n, 0));
    default:
      return [];
  }
}
