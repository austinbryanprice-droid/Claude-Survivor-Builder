import { noteHz } from '../../shared/audio';
import type { BedName } from '../../shared/intro-sound';
import { SOFT_CLIP, type VoiceEnv } from './voices';

/**
 * The film's long sounds. A cue is struck and left to ring; a bed is built once, runs for a stretch
 * of the film and is steered all the while: its loudness (`gain`), its tone and sometimes a third
 * control follow curves the score draws (`INTRO_BEDS`), which the sound director writes onto these
 * parameters a moment ahead of the film's clock.
 */

export interface BedRig {
  /** How loud the bed is, 0 to 1 of its own full level. */
  readonly gain: AudioParam;
  /** What it sounds like: the middle of its band, the pitch of one of its notes, or the cutoff that darkens it. */
  readonly tone: AudioParam;
  /** A second control, for the beds that have one. */
  readonly rate: AudioParam | null;
  start(when: number): void;
  stop(when: number): void;
}

type Maker = (env: VoiceEnv) => BedRig;

type Source = AudioScheduledSourceNode;

function oscillator(ctx: BaseAudioContext, type: OscillatorType, hz: number): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = hz;
  return osc;
}

function loop(env: VoiceEnv, color: 'white' | 'pink' | 'brown'): AudioBufferSourceNode {
  const src = env.ctx.createBufferSource();
  src.buffer = env.noise[color];
  src.loop = true;
  return src;
}

function filter(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  hz: number,
  q = 0.7,
): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = hz;
  node.Q.value = q;
  return node;
}

function gained(ctx: BaseAudioContext, value: number): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

/** The bed's last stage: silent until its curve says otherwise, heard as it is and, for `send` of it, through the reverb. */
function master(env: VoiceEnv, send: number): GainNode {
  const out = gained(env.ctx, 0);
  out.connect(env.dry);
  if (send > 0) {
    const share = gained(env.ctx, send);
    out.connect(share);
    share.connect(env.wet);
  }
  return out;
}

function rig(
  sources: readonly Source[],
  gain: AudioParam,
  tone: AudioParam,
  rate: AudioParam | null = null,
): BedRig {
  return {
    gain,
    tone,
    rate,
    start(when) {
      for (const source of sources) source.start(when);
    },
    stop(when) {
      for (const source of sources) source.stop(when);
    },
  };
}

/** The air screaming past the falling reactor: pink noise in a band that climbs, over a low rumble. */
const roar: Maker = (env) => {
  const { ctx } = env;
  const out = master(env, 0.12);
  const air = loop(env, 'pink');
  const band = filter(ctx, 'bandpass', 160, 1);
  const soften = filter(ctx, 'lowpass', 5200);
  air.connect(band);
  band.connect(soften);
  soften.connect(gained(ctx, 1.4)).connect(out);
  const low = loop(env, 'brown');
  low
    .connect(filter(ctx, 'lowpass', 170))
    .connect(gained(ctx, 1.6))
    .connect(out);
  return rig([air, low], out.gain, band.frequency);
};

/** Metal dragged over rock: a band of noise that flutters, two low saws, and a rumble, all slowing together. */
const grind: Maker = (env) => {
  const { ctx } = env;
  const out = master(env, 0.2);
  const metal = loop(env, 'white');
  const band = filter(ctx, 'bandpass', 1700, 4);
  const flutter = gained(ctx, 0.6);
  metal.connect(band);
  band.connect(flutter);
  flutter.connect(gained(ctx, 0.9)).connect(out);
  const beat = oscillator(ctx, 'sine', 14);
  beat.connect(gained(ctx, 0.4)).connect(flutter.gain);
  const low = filter(ctx, 'lowpass', 420);
  const sawA = oscillator(ctx, 'sawtooth', 58);
  const sawB = oscillator(ctx, 'sawtooth', 60.5);
  sawA.connect(low);
  sawB.connect(low);
  low.connect(gained(ctx, 0.35)).connect(out);
  const rumble = loop(env, 'brown');
  rumble
    .connect(filter(ctx, 'lowpass', 90))
    .connect(gained(ctx, 1.8))
    .connect(out);
  return rig([metal, beat, sawA, sawB, rumble], out.gain, band.frequency, beat.frequency);
};

/** Wind: pink noise in a soft band that swells and sways on two slow cycles. */
const wind: Maker = (env) => {
  const { ctx } = env;
  const out = master(env, 0.35);
  const air = loop(env, 'pink');
  const band = filter(ctx, 'bandpass', 380, 0.6);
  const gust = gained(ctx, 0.65);
  air.connect(band);
  band.connect(gust);
  gust.connect(gained(ctx, 3.2)).connect(out);
  const swell = oscillator(ctx, 'sine', 0.13);
  swell.connect(gained(ctx, 0.35)).connect(gust.gain);
  const sway = oscillator(ctx, 'sine', 0.29);
  sway.connect(gained(ctx, 90)).connect(band.frequency);
  return rig([air, swell, sway], out.gain, band.frequency);
};

/** The note the film stands on: a low D and its fifth, with a saw above them that a filter darkens or opens. */
const drone: Maker = (env) => {
  const { ctx } = env;
  const out = master(env, 0.1);
  const drive = ctx.createWaveShaper();
  drive.curve = SOFT_CLIP;
  drive.connect(gained(ctx, 0.5)).connect(out);
  const root = oscillator(ctx, 'sine', noteHz('D1'));
  root.connect(gained(ctx, 1)).connect(drive);
  const fifth = oscillator(ctx, 'sine', noteHz('A1'));
  fifth.connect(gained(ctx, 0.45)).connect(drive);
  const dark = filter(ctx, 'lowpass', 120, 0.7);
  const sawA = oscillator(ctx, 'sawtooth', noteHz('D2'));
  const sawB = oscillator(ctx, 'sawtooth', noteHz('D2'));
  sawB.detune.value = 6;
  sawA.connect(dark);
  sawB.connect(dark);
  dark.connect(gained(ctx, 0.3)).connect(drive);
  return rig([root, fifth, sawA, sawB], out.gain, dark.frequency);
};

/** The Core's hum: a D chord of pure tones whose third is the one that moves. */
const hum: Maker = (env) => {
  const { ctx } = env;
  const out = master(env, 0.4);
  const bed = gained(ctx, 0.5);
  bed.connect(out);
  const notes = [
    [noteHz('D3'), 0.5],
    [noteHz('A3'), 0.4],
    [noteHz('D4'), 0.22],
  ] as const;
  const sources: Source[] = [];
  for (const [hz, level] of notes) {
    const tone = oscillator(ctx, 'sine', hz);
    tone.connect(gained(ctx, level)).connect(bed);
    sources.push(tone);
  }
  const third = oscillator(ctx, 'sine', noteHz('F3'));
  third.connect(gained(ctx, 0.4)).connect(bed);
  sources.push(third);
  return rig(sources, out.gain, third.frequency);
};

export const BEDS: Readonly<Record<BedName, Maker>> = { roar, grind, wind, drone, hum };
