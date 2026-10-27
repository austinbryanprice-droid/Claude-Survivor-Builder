import { createCueCursor } from '../../shared/cue-cursor';
import { INTRO_SECONDS, lidsAt, sceneTime } from '../../shared/intro';
import {
  INTRO_BEDS,
  INTRO_CUES,
  SOUND_SECONDS,
  lidCutoffAt,
  type BedName,
  type BedScore,
  type Cue,
} from '../../shared/intro-sound';
import { BEDS, type BedRig } from '../audio/beds';
import { createNoiseBank } from '../audio/noise';
import { createReverb } from '../audio/reverb';
import { VOICES, type VoiceEnv } from '../audio/voices';

/**
 * Plays the film's sound. The film's clock is the only clock: every frame the director tells this
 * where the film is, and everything that starts within a short lookahead is handed to the audio
 * thread to start at exactly the matching moment (a cue is a recipe started once; a bed is built
 * when it is first due, steered along its curves in small steps and stopped when it is over). Since
 * the sound is placed from the film's clock afresh each frame, a stall that holds the picture holds
 * the sound back with it, and a film that runs slow is never more than a lookahead out of step.
 *
 * Nothing here is needed by the film: a failure in a recipe is reported once and the film goes on
 * in silence where it failed.
 */

/** Seconds ahead of the film's clock that sound is handed to the audio thread: enough to survive a late frame, short enough to stay with the picture. */
const LOOKAHEAD = 0.2;
/** Seconds between the points a bed's curves are written at; the audio thread draws straight lines between them. */
const STEP = 0.05;
/** The lowpass over the mix starts to follow the survivor's eyelids this long before the eyes are shut. */
const LID_FROM = sceneTime('wake', 0) - 0.1;
/** A cue that the film's clock has already left this far behind is dropped, not played late: the film was moved on (a seek), and a burst of its past would be noise. */
const STALE = 0.25;
/** The last of the ringing tail is faded over this many seconds, so that taking the sound apart cannot click. */
const FINAL_FADE = 0.4;

/** One thing the sound started, for tests and the debug page. */
export interface SoundEvent {
  readonly kind: 'cue' | 'bed';
  readonly name: string;
  /** Seconds of the film it belongs to. */
  readonly at: number;
  /** Seconds on the audio clock it was started at. */
  readonly when: number;
}

export interface IntroSoundStats {
  /** Cues started. */
  voices: number;
  /** Beds started. */
  beds: number;
  /** Cues dropped because the browser had not let the page make sound yet. */
  skipped: number;
  /** Cues or beds whose recipe threw. */
  failed: number;
  state: 'playing' | 'fading' | 'ringing' | 'stopped';
}

export interface IntroSound {
  /** Tells the sound where the film is, which hands over what starts in the next moment. Called every frame the film is playing. */
  update(filmTime: number): void;
  /** Hands over everything from `filmTime` to `until` at once, laid out on the audio clock as the film's clock was at `filmTime`: a file is rendered this way. */
  advance(filmTime: number, until: number): void;
  /** The film was skipped or cut, or a new film begins over this one's ringing tail: the sound fades out over `seconds` and is taken apart. */
  fadeOut(seconds: number): void;
  /** The film ran to its end: what is left is handed over and left to ring out into the first moments of play. */
  finish(): void;
  readonly stats: IntroSoundStats;
}

export interface IntroSoundOptions {
  /** Where the film's sound is sent: the game's output, or the chain of a render. */
  readonly output: AudioNode;
  /** True for a context that plays in real time, whose clock the sound follows. False for one that renders a file, which has no clock to wait on. */
  readonly live: boolean;
  readonly lookahead?: number;
  /** Told of everything the sound starts. */
  readonly trace?: (event: SoundEvent) => void;
}

interface Bed {
  readonly name: BedName;
  readonly score: BedScore;
  rig: BedRig | null;
  /** The film's second its curves have been written up to. */
  t: number;
  done: boolean;
}

export function createIntroSound(
  ctx: BaseAudioContext,
  { output, live, lookahead = LOOKAHEAD, trace }: IntroSoundOptions,
): IntroSound {
  // Voices and beds go to the bus; the lid filter that muffles the mix behind closed eyes sits after it.
  const bus = ctx.createGain();
  const lid = ctx.createBiquadFilter();
  lid.type = 'lowpass';
  lid.Q.value = 0.5;
  lid.frequency.value = lidCutoffAt(0);
  bus.connect(lid);
  lid.connect(output);
  const dry = ctx.createGain();
  dry.connect(bus);
  const reverb = createReverb(ctx);
  reverb.output.connect(bus);
  const env: VoiceEnv = { ctx, dry, wet: reverb.input, noise: createNoiseBank(ctx), bus };

  const cursor = createCueCursor(INTRO_CUES);
  const beds: Bed[] = (Object.keys(INTRO_BEDS) as BedName[]).map((name) => ({
    name,
    score: INTRO_BEDS[name],
    rig: null,
    t: INTRO_BEDS[name].from,
    done: false,
  }));
  /** The film's second the lid filter has been written up to. */
  let lidT = LID_FROM;
  let over = false;
  let reported = false;
  const stats: IntroSoundStats = { voices: 0, beds: 0, skipped: 0, failed: 0, state: 'playing' };

  const fail = (what: string, error: unknown): void => {
    stats.failed++;
    if (reported) return;
    reported = true;
    console.error(`The intro's sound failed at ${what}; the film goes on without it.`, error);
  };

  const play = (cue: Cue, when: number): void => {
    try {
      VOICES[cue.voice](env, when, cue);
      stats.voices++;
      trace?.({ kind: 'cue', name: cue.voice, at: cue.at, when });
    } catch (error) {
      fail(`a ${cue.voice} at ${cue.at.toFixed(2)} s`, error);
    }
  };

  /** Writes a bed's curves from where they were last written to `until`, building and starting it first if it is due. */
  const runBed = (
    bed: Bed,
    filmTime: number,
    until: number,
    whenOf: (t: number) => number,
  ): void => {
    const { score } = bed;
    if (bed.done || until < score.from) return;
    if (!bed.rig && filmTime >= score.to) {
      bed.done = true;
      return;
    }
    try {
      if (!bed.rig) {
        // A film that is joined late starts its beds where it is, not where they began.
        bed.t = Math.max(score.from, Math.min(filmTime, score.to));
        const rig = BEDS[bed.name](env);
        bed.rig = rig;
        const when = whenOf(bed.t);
        rig.gain.setValueAtTime(score.gain(bed.t), when);
        rig.tone.setValueAtTime(score.tone(bed.t), when);
        rig.rate?.setValueAtTime(score.rate?.(bed.t) ?? 0, when);
        rig.start(when);
        stats.beds++;
        trace?.({ kind: 'bed', name: bed.name, at: bed.t, when });
      }
      const rig = bed.rig;
      const end = Math.min(until, score.to);
      while (bed.t + STEP <= end) {
        bed.t += STEP;
        const when = whenOf(bed.t);
        rig.gain.linearRampToValueAtTime(score.gain(bed.t), when);
        rig.tone.linearRampToValueAtTime(score.tone(bed.t), when);
        if (rig.rate && score.rate) rig.rate.linearRampToValueAtTime(score.rate(bed.t), when);
      }
      if (until >= score.to) {
        rig.gain.linearRampToValueAtTime(score.gain(score.to), whenOf(score.to));
        rig.stop(whenOf(score.to) + STEP);
        bed.done = true;
      }
    } catch (error) {
      bed.done = true;
      fail(`the ${bed.name} bed`, error);
    }
  };

  /** Writes the cutoff of the mix's lowpass from the survivor's eyelids: closed eyes hear the world through a wall. */
  const runLid = (until: number, whenOf: (t: number) => number): void => {
    const end = Math.min(until, SOUND_SECONDS);
    while (lidT + STEP <= end) {
      lidT += STEP;
      lid.frequency.linearRampToValueAtTime(lidCutoffAt(lidsAt(lidT)), whenOf(lidT));
    }
  };

  const advance = (filmTime: number, until: number): void => {
    if (over) return;
    if (live && ctx.state !== 'running') {
      // The browser has not let the page make sound (yet): the film goes on, and the sound joins when it can.
      const before = cursor.remaining;
      cursor.skip(until);
      stats.skipped += before - cursor.remaining;
      return;
    }
    const now = ctx.currentTime;
    const whenOf = (t: number): number => Math.max(now, now + (t - filmTime));
    cursor.take(until, (cue) => play(cue, whenOf(cue.at)));
    for (const bed of beds) runBed(bed, filmTime, until, whenOf);
    if (until >= LID_FROM) runLid(until, whenOf);
  };

  /** Takes the sound apart once it has died away. */
  const teardown = (after: number): void => {
    setTimeout(
      () => {
        for (const bed of beds) {
          if (!bed.rig || bed.done) continue;
          try {
            bed.rig.stop(ctx.currentTime);
          } catch {
            // Already stopped, which is what was wanted.
          }
        }
        bus.disconnect();
        reverb.output.disconnect();
        stats.state = 'stopped';
      },
      Math.max(0, after) * 1000,
    );
  };

  return {
    update(filmTime) {
      cursor.skip(filmTime - STALE);
      advance(filmTime, filmTime + lookahead);
    },
    advance,
    fadeOut(seconds) {
      // A tail that still rings can be cut short; a sound that is fading or gone has been dealt with.
      if (over && stats.state !== 'ringing') return;
      over = true;
      stats.state = 'fading';
      const now = ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0, now + seconds);
      teardown(seconds + 0.2);
    },
    finish() {
      if (over) return;
      advance(INTRO_SECONDS, Number.POSITIVE_INFINITY);
      over = true;
      stats.state = 'ringing';
      const end = ctx.currentTime + (SOUND_SECONDS - INTRO_SECONDS);
      bus.gain.setValueAtTime(1, end - FINAL_FADE);
      bus.gain.linearRampToValueAtTime(0, end);
      teardown(SOUND_SECONDS - INTRO_SECONDS + 0.5);
    },
    stats,
  };
}
