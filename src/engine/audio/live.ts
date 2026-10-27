import {
  Composer,
  MIX,
  ambienceFor,
  type Ambience,
  type LiveCue,
  type MusicCue,
  type SoundScene,
} from '../../shared/game-sound';
import type { BedName } from '../../shared/intro-sound';
import { BEDS, type BedRig } from './beds';
import { createNoiseBank } from './noise';
import { createReverb } from './reverb';
import { VOICES, type VoiceEnv } from './voices';

/**
 * The sound of the valley while it is played. The film's wind, its Core hum and its low note run all
 * the while, each one eased toward the level the hour and the danger ask for (`ambienceFor`), and
 * the sparse music (`Composer`) and the stingers are struck with the film's voices as they fall due.
 * The game's clock is the only clock: every frame says how long it was and how the valley stands,
 * and anything that starts is placed a moment ahead of the audio thread's own time.
 *
 * Nothing here is needed to play: a recipe that throws is reported once and the game goes on
 * in silence where it failed.
 */

/** Seconds ahead of the audio clock that a sound is placed, so that it never starts in the past. */
const LOOKAHEAD = 0.05;
/** Seconds between one write of the long sounds' targets and the next: a frame is too often for an automation timeline. */
const STEER_EVERY = 0.1;
/** The sound comes up over this many seconds when it starts, so that the film's last chord and the first moments of play run together. */
const FADE_IN = 3;
/** Targets that moved less than this share of their value since the last write are left alone. */
const STEER_EPSILON = 0.004;

/** One thing the sound started, for tests and the debug page. */
export interface LiveSoundEvent {
  readonly kind: 'cue' | 'bed';
  readonly name: string;
  /** Seconds on the audio clock it was started at. */
  readonly when: number;
}

export interface LiveSoundStats {
  /** Cues started. */
  voices: number;
  /** Beds built and started. */
  beds: number;
  /** Cues or beds whose recipe threw. */
  failed: number;
  state: 'playing' | 'fading' | 'stopped';
}

export interface LiveSound {
  /** Lets `dt` seconds of the game pass in `scene`: steers the long sounds and starts what the music asks for. Call it every frame. */
  update(dt: number, scene: SoundScene): void;
  /** Starts a sound `after` seconds from now. */
  play(cue: LiveCue, after?: number): void;
  /** Starts every sound in a list, each at its own offset. */
  playAll(cues: readonly MusicCue[]): void;
  /** The sound fades out over `seconds` and is taken apart. */
  fadeOut(seconds: number): void;
  readonly stats: LiveSoundStats;
}

export interface LiveSoundOptions {
  /** Where the game's sound is sent: the hub's output, or the chain of a render. */
  readonly output: AudioNode;
  /** True for a context that plays in real time. False for one that renders a file, which has no clock to wait on. */
  readonly live: boolean;
  /** Fixes the music: the same seed plays the same notes. */
  readonly seed: number;
  /** Told of everything the sound starts. */
  readonly trace?: (event: LiveSoundEvent) => void;
}

/** The long sounds the valley is built of, in the order they are started. */
const BED_NAMES: readonly BedName[] = ['wind', 'hum', 'drone'];

interface Steering {
  readonly rig: BedRig;
  level: number;
  tone: number;
}

export function createLiveSound(
  ctx: BaseAudioContext,
  { output, live, seed, trace }: LiveSoundOptions,
): LiveSound {
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(output);
  const dry = ctx.createGain();
  dry.connect(bus);
  const reverb = createReverb(ctx);
  reverb.output.connect(bus);
  const env: VoiceEnv = { ctx, dry, wet: reverb.input, noise: createNoiseBank(ctx), bus };

  const composer = new Composer(seed);
  const beds = new Map<BedName, Steering>();
  const stats: LiveSoundStats = { voices: 0, beds: 0, failed: 0, state: 'playing' };
  let started = false;
  let over = false;
  let reported = false;
  let sinceSteer = STEER_EVERY;

  const fail = (what: string, error: unknown): void => {
    stats.failed++;
    if (reported) return;
    reported = true;
    console.error(`The game's sound failed at ${what}; the game goes on without it.`, error);
  };

  const strike = (cue: LiveCue, when: number): void => {
    try {
      VOICES[cue.voice](env, when, { ...cue, at: 0 });
      stats.voices++;
      trace?.({ kind: 'cue', name: cue.voice, when });
    } catch (error) {
      fail(`a ${cue.voice}`, error);
    }
  };

  /** Builds and starts the long sounds, silent, and brings the whole mix up. */
  const begin = (now: number): void => {
    started = true;
    bus.gain.setValueAtTime(0, now);
    bus.gain.setTargetAtTime(1, now, FADE_IN / 3);
    for (const name of BED_NAMES) {
      try {
        const rig = BEDS[name](env);
        rig.gain.setValueAtTime(0, now);
        rig.start(now);
        beds.set(name, { rig, level: 0, tone: Number.NaN });
        stats.beds++;
        trace?.({ kind: 'bed', name, when: now });
      } catch (error) {
        fail(`the ${name} bed`, error);
      }
    }
  };

  /** Eases a param toward `value` unless it is already there. Returns the value now aimed at. */
  const ease = (
    param: AudioParam,
    last: number,
    value: number,
    now: number,
    seconds: number,
  ): number => {
    if (Math.abs(value - last) <= Math.abs(value) * STEER_EPSILON) return last;
    param.setTargetAtTime(value, now, seconds);
    return value;
  };

  const steer = (ambience: Ambience, now: number): void => {
    const aims: Readonly<Record<string, readonly [level: number, tone: number]>> = {
      wind: [ambience.wind, ambience.windHz],
      hum: [ambience.hum, ambience.thirdHz],
      drone: [ambience.drone, ambience.droneHz],
    };
    for (const [name, bed] of beds) {
      const [level, tone] = aims[name] as readonly [number, number];
      try {
        // The first aim of a tone is written outright: a bed does not glide up from the pitch it was built on.
        if (Number.isNaN(bed.tone)) {
          bed.rig.tone.setValueAtTime(tone, now);
          bed.tone = tone;
        } else {
          bed.tone = ease(bed.rig.tone, bed.tone, tone, now, MIX.ease.tone);
        }
        bed.level = ease(bed.rig.gain, bed.level, level, now, MIX.ease.level);
      } catch (error) {
        fail(`steering the ${name} bed`, error);
      }
    }
  };

  const play = (cue: LiveCue, after = 0): void => {
    if (over) return;
    if (live && ctx.state !== 'running') return;
    strike(cue, ctx.currentTime + LOOKAHEAD + Math.max(0, after));
  };

  return {
    update(dt, scene) {
      if (over) return;
      if (live && ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (!started) begin(now);
      sinceSteer += dt;
      if (sinceSteer >= STEER_EVERY) {
        sinceSteer = 0;
        steer(ambienceFor(scene), now);
      }
      for (const { after, cue } of composer.advance(dt, scene)) play(cue, after);
    },
    play,
    playAll(cues) {
      for (const { after, cue } of cues) play(cue, after);
    },
    fadeOut(seconds) {
      if (over) return;
      over = true;
      stats.state = 'fading';
      const now = ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0, now + seconds);
      for (const { rig } of beds.values()) {
        try {
          rig.stop(now + seconds + 0.05);
        } catch {
          // Already stopped, which is what was wanted.
        }
      }
      if (live) {
        setTimeout(
          () => {
            bus.disconnect();
            reverb.output.disconnect();
            stats.state = 'stopped';
          },
          (seconds + 0.5) * 1000,
        );
      } else {
        stats.state = 'stopped';
      }
    },
    stats,
  };
}
