import {
  Governor,
  NEAR,
  costOf,
  createHeard,
  dropFor,
  hearAt,
  placeCues,
  type Effect,
  type EffectKind,
  type Listener,
} from '../../shared/effect-sound';
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
 * The things people do (a block set down, a module coming on, a click turned away) are `Effect`s: they
 * are placed where the listener hears them from, held to a budget of sounds at once, and struck with
 * the same voices, through a bus of their own.
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
  /** For a cue of an effect: the kind of effect it belongs to, where it was placed between the speakers (-1 to 1) and its level in decibels once the distance had taken its share. */
  readonly effect?: EffectKind;
  readonly pan?: number;
  readonly level?: number;
}

export interface LiveSoundStats {
  /** Cues started. */
  voices: number;
  /** Beds built and started. */
  beds: number;
  /** Cues or beds whose recipe threw. */
  failed: number;
  /** Effects that sounded, and effects turned away because too many sounds were alive already. */
  effects: number;
  dropped: number;
  state: 'playing' | 'fading' | 'stopped';
}

export interface LiveSound {
  /** Lets `dt` seconds of the game pass in `scene`: steers the long sounds and starts what the music asks for. Call it every frame. */
  update(dt: number, scene: SoundScene): void;
  /** Starts a sound `after` seconds from now. */
  play(cue: LiveCue, after?: number): void;
  /** Starts every sound in a list, each at its own offset. */
  playAll(cues: readonly MusicCue[]): void;
  /** Tells the sound where the listener is and which way the view faces. Call it every frame, before the effects of that frame. */
  listen(pose: Listener): void;
  /**
   * Sounds an effect: placed where the listener hears it from (an effect with no place is in the
   * head), left out if it is beyond earshot or if too many sounds are alive for its kind. Returns
   * whether it sounded.
   */
  effect(effect: Effect): boolean;
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
  // What people do has a bus of its own into the same room, so that one place sets how loud it all is next to the valley.
  const effects = ctx.createGain();
  effects.connect(bus);
  const effectEnv: VoiceEnv = { ...env, dry: effects };
  const governor = new Governor();
  const heard = createHeard();
  let pose: Listener | null = null;

  const composer = new Composer(seed);
  const beds = new Map<BedName, Steering>();
  const stats: LiveSoundStats = {
    voices: 0,
    beds: 0,
    failed: 0,
    effects: 0,
    dropped: 0,
    state: 'playing',
  };
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

  /** Starts one voice. False where its recipe threw, which is reported and goes no further. */
  const strike = (cue: LiveCue, when: number, into: VoiceEnv = env, kind?: EffectKind): boolean => {
    try {
      VOICES[cue.voice](into, when, { ...cue, at: 0 });
      stats.voices++;
      trace?.(
        kind
          ? {
              kind: 'cue',
              name: cue.voice,
              when,
              effect: kind,
              pan: cue.pan ?? 0,
              level: cue.level,
            }
          : { kind: 'cue', name: cue.voice, when },
      );
      return true;
    } catch (error) {
      fail(`a ${cue.voice}`, error);
      return false;
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

  const effect = (made: Effect): boolean => {
    if (over) return false;
    if (live && ctx.state !== 'running') return false;
    let cues = made.cues;
    if (made.at && pose) {
      if (!hearAt(pose, made.at.x, made.at.y, made.at.z, heard, made.carries)) return false;
      cues = placeCues(cues, heard);
      if (cues.length === 0) return false;
    }
    const now = ctx.currentTime;
    // What happens within a few blocks of the player is not to be lost in a crowd of what happens farther off.
    const near = made.at !== undefined && pose !== null && heard.drop >= dropFor(NEAR);
    if (!governor.admit(made.kind, costOf(cues), now, made.key ?? 0, near)) {
      stats.dropped++;
      return false;
    }
    let started = 0;
    for (const { after, cue } of cues) {
      if (strike(cue, now + LOOKAHEAD + Math.max(0, after), effectEnv, made.kind)) started++;
    }
    if (started === 0) return false;
    stats.effects++;
    return true;
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
    listen(next) {
      pose = next;
    },
    effect,
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
