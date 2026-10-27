import { dbToGain } from '../../shared/audio';
import { hash32, unitFloat } from '../../shared/hash';
import type { Cue, VoiceName } from '../../shared/intro-sound';
import type { NoiseBank, NoiseColor } from './noise';

/**
 * The noises the film is made of, each a short recipe of oscillators, noise and filters that is
 * started at a moment and then left to run out: a boom, a clang of metal, a groan of the hull, a
 * bell, a held note of strings. A recipe reads only its cue (how loud, what pitch, how long) and
 * a seed, so the same cue sounds the same every time. They are written against `BaseAudioContext`,
 * which the live context and the one that renders a file both are.
 */

export interface VoiceEnv {
  readonly ctx: BaseAudioContext;
  /** Where sound goes to be heard as it is. */
  readonly dry: AudioNode;
  /** The reverb's input. */
  readonly wet: AudioNode;
  readonly noise: NoiseBank;
  /** The film's own volume, which the voice that dips the mix works on. */
  readonly bus: GainNode;
}

export type Voice = (env: VoiceEnv, when: number, cue: Cue) => void;

/** Exponential ramps cannot reach zero, so a sound is let fall as far as this (80 decibels down) and then stopped. */
const FLOOR = 0.0001;

/** Soft clipping: a wave pushed through it comes out rounder and richer in harmonics, so that a low note is still heard on small speakers. */
export const SOFT_CLIP = ((): Float32Array<ArrayBuffer> => {
  const size = 2048;
  const curve = new Float32Array(size);
  const drive = 2.2;
  for (let i = 0; i < size; i++)
    curve[i] = Math.tanh(drive * ((i / (size - 1)) * 2 - 1)) / Math.tanh(drive);
  return curve;
})();

/** A number from 0 to 1 that depends only on the seed and a slot, for the little differences between plays. */
function chance(seed: number, slot: number): number {
  return unitFloat(hash32(seed + Math.imul(slot, 0x9e3779b1)));
}

/**
 * The last stage of a voice, which its sounds are connected to: it sets the cue's level, its place
 * between the speakers and how much of it goes to the reverb (`habit` unless the cue says), and
 * hands back the node to connect into.
 */
function output(env: VoiceEnv, cue: Cue, habit: number): GainNode {
  const { ctx } = env;
  const gain = ctx.createGain();
  gain.gain.value = dbToGain(cue.level);
  let tail: AudioNode = gain;
  if (cue.pan) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, cue.pan));
    gain.connect(panner);
    tail = panner;
  }
  tail.connect(env.dry);
  const send = cue.send ?? habit;
  if (send > 0) {
    const share = ctx.createGain();
    share.gain.value = send;
    tail.connect(share);
    share.connect(env.wet);
  }
  return gain;
}

/**
 * Writes the loudness of a sound: up to `peak` over `attack` seconds, held for `hold`, then down
 * to silence over `decay` (a fall that loses the same share each moment, as a struck thing does).
 * Returns the second the sound is silent.
 */
function shape(
  param: AudioParam,
  when: number,
  peak: number,
  attack: number,
  hold: number,
  decay: number,
): number {
  param.setValueAtTime(FLOOR, when);
  param.linearRampToValueAtTime(peak, when + attack);
  if (hold > 0) param.setValueAtTime(peak, when + attack + hold);
  param.exponentialRampToValueAtTime(FLOOR, when + attack + hold + decay);
  return when + attack + hold + decay;
}

/** An oscillator that runs from `when` to `until`, at a pitch that may glide to `glideTo` over `glide` seconds. */
function oscillator(
  ctx: BaseAudioContext,
  type: OscillatorType,
  hz: number,
  when: number,
  until: number,
  glideTo = hz,
  glide = 0,
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, when);
  if (glideTo !== hz) osc.frequency.exponentialRampToValueAtTime(glideTo, when + glide);
  osc.start(when);
  osc.stop(until);
  return osc;
}

/** A source of noise that plays `seconds` of it, from a place in the loop picked by the seed. */
function hiss(
  env: VoiceEnv,
  color: NoiseColor,
  when: number,
  seconds: number,
  seed: number,
): AudioBufferSourceNode {
  const buffer = env.noise[color];
  const src = env.ctx.createBufferSource();
  src.buffer = buffer;
  const length = Math.min(seconds, buffer.duration - 0.1);
  src.start(when, chance(seed, 99) * (buffer.duration - length - 0.05), length);
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

/** A sound of one oscillator and its loudness, joined to `to`: the shape of most of the pings and thumps. */
function partial(
  ctx: BaseAudioContext,
  to: AudioNode,
  type: OscillatorType,
  hz: number,
  when: number,
  peak: number,
  decay: number,
  glideTo = hz,
  glide = 0,
  attack = 0.003,
): void {
  const gain = ctx.createGain();
  const end = shape(gain.gain, when, peak, attack, 0, decay);
  oscillator(ctx, type, hz, when, end + 0.02, glideTo, glide).connect(gain);
  gain.connect(to);
}

/** A great impact: a falling sub-bass that the ear feels more than hears, a thump, a crash of noise that darkens, and the crack of the first instant. */
const boom: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.3);
  const seconds = cue.seconds ?? 3.4;
  const sub = ctx.createOscillator();
  sub.frequency.setValueAtTime(92, when);
  sub.frequency.exponentialRampToValueAtTime(33, when + 0.75);
  const subGain = ctx.createGain();
  const subEnd = shape(subGain.gain, when, 0.5, 0.004, 0, seconds * 0.8);
  const drive = ctx.createWaveShaper();
  drive.curve = SOFT_CLIP;
  sub.connect(drive);
  drive.connect(subGain);
  subGain.connect(out);
  sub.start(when);
  sub.stop(subEnd + 0.02);

  partial(ctx, out, 'triangle', 190, when, 0.4, 0.6, 55, 0.22, 0.003);

  const crash = hiss(env, 'white', when, seconds * 0.6, cue.seed);
  const dark = filter(ctx, 'lowpass', 7500, 0.7);
  dark.frequency.setValueAtTime(7500, when);
  dark.frequency.exponentialRampToValueAtTime(320, when + seconds * 0.5);
  const crashGain = ctx.createGain();
  shape(crashGain.gain, when, 0.28, 0.002, 0, seconds * 0.55);
  crash.connect(dark);
  dark.connect(crashGain);
  crashGain.connect(out);

  const crack = hiss(env, 'white', when, 0.1, cue.seed + 1);
  const bright = filter(ctx, 'highpass', 1800);
  const crackGain = ctx.createGain();
  shape(crackGain.gain, when, 0.25, 0.001, 0, 0.05);
  crack.connect(bright);
  bright.connect(crackGain);
  crackGain.connect(out);
};

/** A heavy thing landing on the ground: a short falling thump and a puff of dust. */
const thud: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.2);
  const hz = cue.hz ?? 85;
  partial(ctx, out, 'sine', hz * 1.7, when, 0.6, 0.35, hz, 0.1, 0.002);
  const dust = hiss(env, 'brown', when, 0.2, cue.seed);
  const dull = filter(ctx, 'lowpass', 800);
  const gain = ctx.createGain();
  shape(gain.gain, when, 0.25, 0.002, 0, 0.14);
  dust.connect(dull);
  dull.connect(gain);
  gain.connect(out);
};

const CLANG_RATIOS = [1, 2.17, 3.64, 5.12, 6.97] as const;
const CLANG_LEVELS = [0.4, 0.26, 0.18, 0.12, 0.08] as const;
const CLANG_DECAYS = [1.3, 0.8, 0.55, 0.38, 0.26] as const;

/** Metal struck: five partials that are not whole multiples of one another, which is what makes a plate sound like a plate and not a bell. */
const clang: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.3);
  const hz = cue.hz ?? 240;
  CLANG_RATIOS.forEach((ratio, i) => {
    const detune = 1 + (chance(cue.seed, i) - 0.5) * 0.008;
    partial(
      ctx,
      out,
      'sine',
      hz * ratio * detune,
      when,
      CLANG_LEVELS[i] as number,
      CLANG_DECAYS[i] as number,
      hz * ratio * detune,
      0,
      0.001,
    );
  });
  const strike = hiss(env, 'white', when, 0.06, cue.seed + 2);
  const bright = filter(ctx, 'highpass', 1400);
  const gain = ctx.createGain();
  shape(gain.gain, when, 0.18, 0.001, 0, 0.03);
  strike.connect(bright);
  bright.connect(gain);
  gain.connect(out);
};

/** The hull under stress: a sawtooth sliding down through a narrow band that moves with it, wobbling a little, with the rasp of friction. */
const groan: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.3);
  const seconds = cue.seconds ?? 2;
  const hz = cue.hz ?? 110;
  const end = when + seconds;
  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.setValueAtTime(hz, when);
  saw.frequency.linearRampToValueAtTime(cue.to ?? hz * 0.8, end);
  const wobble = oscillator(ctx, 'sine', 5.2, when, end + 0.05);
  const wobbleDepth = ctx.createGain();
  wobbleDepth.gain.value = 28;
  wobble.connect(wobbleDepth);
  wobbleDepth.connect(saw.detune);
  const band = filter(ctx, 'bandpass', 380, 7);
  band.frequency.setValueAtTime(380, when);
  band.frequency.linearRampToValueAtTime(260, end);
  const gain = ctx.createGain();
  shape(gain.gain, when, 0.9, seconds * 0.3, seconds * 0.2, seconds * 0.5);
  saw.connect(band);
  band.connect(gain);
  gain.connect(out);
  saw.start(when);
  saw.stop(end + 0.1);

  const rasp = hiss(env, 'pink', when, seconds, cue.seed);
  const raspBand = filter(ctx, 'bandpass', 700, 2);
  const raspGain = ctx.createGain();
  shape(raspGain.gain, when, 0.1, seconds * 0.3, seconds * 0.2, seconds * 0.5);
  rasp.connect(raspBand);
  raspBand.connect(raspGain);
  raspGain.connect(out);
};

/** A vent letting go: a hiss of high noise that comes up quickly and dies away slowly. */
const steam: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.15);
  const seconds = Math.min(cue.seconds ?? 1.4, 3.6);
  const src = hiss(env, 'white', when, seconds + 0.1, cue.seed);
  const clear = filter(ctx, 'highpass', 900);
  const band = filter(ctx, 'bandpass', cue.hz ?? 3500, 0.8);
  const gain = ctx.createGain();
  shape(gain.gain, when, 0.3, 0.05, seconds * 0.3, seconds * 0.6);
  src.connect(clear);
  clear.connect(band);
  band.connect(gain);
  gain.connect(out);
};

/** A small bright knock of glass or cooling metal. */
const tick: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.5);
  const hz = cue.hz ?? 3000;
  partial(ctx, out, 'sine', hz, when, 0.12, 0.14, hz, 0, 0.001);
  partial(ctx, out, 'sine', hz * 1.52, when, 0.06, 0.09, hz * 1.52, 0, 0.001);
  const tap = hiss(env, 'white', when, 0.03, cue.seed);
  const bright = filter(ctx, 'highpass', 4000);
  const gain = ctx.createGain();
  shape(gain.gain, when, 0.05, 0.0005, 0, 0.01);
  tap.connect(bright);
  bright.connect(gain);
  gain.connect(out);
};

/** One snap of a fire: a few thousandths of a second of noise in a narrow band. */
const crackle: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.1);
  const seconds = 0.012 + chance(cue.seed, 1) * 0.03;
  const src = hiss(env, 'white', when, seconds + 0.01, cue.seed);
  const band = filter(ctx, 'bandpass', cue.hz ?? 1800, 1.6);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.7, when);
  gain.gain.exponentialRampToValueAtTime(FLOOR, when + seconds);
  src.connect(band);
  band.connect(gain);
  gain.connect(out);
};

/** The Core's glass note: a pure tone with a slightly sour partner above it, ringing a long time in the room. */
const ping: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.8);
  const hz = cue.hz ?? 880;
  partial(ctx, out, 'sine', hz, when, 0.18, 3.2, hz, 0, 0.004);
  partial(ctx, out, 'sine', hz * 2.41, when, 0.05, 1.4, hz * 2.41, 0, 0.004);
};

/** The Core's pulse in the chest: a low note that swells and falls, and its octave. */
const whoom: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.25);
  const hz = cue.hz ?? 73;
  const swell = ctx.createGain();
  const end = shape(swell.gain, when, 0.55, 0.05, 0.1, 2.0);
  oscillator(ctx, 'sine', hz * 1.6, when, end + 0.02, hz, 0.35).connect(swell);
  swell.connect(out);
  partial(ctx, out, 'sine', hz * 2, when, 0.18, 1.2, hz * 2, 0, 0.05);
};

/** A small motor winding up. */
const servo: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.15);
  const seconds = cue.seconds ?? 0.6;
  const hz = cue.hz ?? 180;
  const saw = oscillator(
    ctx,
    'sawtooth',
    hz,
    when,
    when + seconds + 0.3,
    cue.to ?? hz * 2.5,
    seconds,
  );
  const band = filter(ctx, 'bandpass', 900, 5);
  const gain = ctx.createGain();
  shape(gain.gain, when, 0.3, 0.03, seconds * 0.4, 0.25);
  saw.connect(band);
  band.connect(gain);
  gain.connect(out);
  const click = hiss(env, 'white', when, 0.04, cue.seed);
  const clickBand = filter(ctx, 'bandpass', 2500, 1.5);
  const clickGain = ctx.createGain();
  shape(clickGain.gain, when, 0.1, 0.001, 0, 0.02);
  click.connect(clickBand);
  clickBand.connect(clickGain);
  clickGain.connect(out);
};

/** A machine's eye lighting: a short rising beep. */
const blip: Voice = (env, when, cue) => {
  const out = output(env, cue, 0.3);
  const hz = cue.hz ?? 1250;
  partial(env.ctx, out, 'sine', hz, when, 0.25, 0.14, hz * 1.5, 0.05, 0.004);
};

/** The ground giving way under something rising: a low roar of earth that darkens, a crunch of gravel and a thump. */
const rumble: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.2);
  const seconds = cue.seconds ?? 1;
  const earth = hiss(env, 'brown', when, seconds + 0.2, cue.seed);
  const dark = filter(ctx, 'lowpass', 380, 0.8);
  dark.frequency.setValueAtTime(380, when);
  dark.frequency.exponentialRampToValueAtTime(110, when + seconds);
  const earthGain = ctx.createGain();
  shape(earthGain.gain, when, 0.6, 0.06, seconds * 0.1, seconds * 0.8);
  earth.connect(dark);
  dark.connect(earthGain);
  earthGain.connect(out);
  const gravel = hiss(env, 'white', when, 0.4, cue.seed + 3);
  const band = filter(ctx, 'bandpass', 1400, 1);
  const gravelGain = ctx.createGain();
  shape(gravelGain.gain, when, 0.12, 0.01, 0, 0.35);
  gravel.connect(band);
  band.connect(gravelGain);
  gravelGain.connect(out);
  partial(ctx, out, 'sine', 75, when, 0.4, 0.55, 40, 0.3, 0.004);
};

/** A footfall of something heavy and mechanical, far off. */
const step: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.2);
  const hz = cue.hz ?? 120;
  partial(ctx, out, 'sine', hz * 1.4, when, 0.5, 0.14, hz * 0.6, 0.06, 0.002);
  const tap = hiss(env, 'white', when, 0.05, cue.seed);
  const band = filter(ctx, 'bandpass', 1700, 2);
  const gain = ctx.createGain();
  shape(gain.gain, when, 0.12, 0.001, 0, 0.025);
  tap.connect(band);
  band.connect(gain);
  gain.connect(out);
};

/** A bell-like note: a sine, a sour high partner that dies quickly, and an octave of warmth, through a soft lowpass. */
const pluck: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.55);
  const hz = cue.hz ?? 440;
  const seconds = cue.seconds ?? 1.8;
  const soft = filter(ctx, 'lowpass', 5000, 0.5);
  soft.connect(out);
  partial(ctx, soft, 'sine', hz, when, 0.34, seconds, hz, 0, 0.003);
  partial(ctx, soft, 'sine', hz * 2.76, when, 0.07, seconds * 0.35, hz * 2.76, 0, 0.003);
  partial(ctx, soft, 'triangle', hz * 2, when, 0.05, seconds * 0.5, hz * 2, 0, 0.003);
};

/** The detunes in cents of the saws in a pad note, which beat slowly against one another. */
const PAD_DETUNE = [-8, 8] as const;

/** A held note of strings: two slightly detuned saws and a sine, through a lowpass that opens as the note swells. */
const pad: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.3);
  const hz = cue.hz ?? 220;
  const attack = cue.attack ?? 1.8;
  const release = cue.release ?? 2.4;
  const off = when + Math.max(attack, cue.seconds ?? 2);
  const end = off + release;
  const cutoff = Math.min(4200, Math.max(600, hz * 6));
  const tone = filter(ctx, 'lowpass', cutoff, 0.3);
  tone.frequency.setValueAtTime(cutoff * 0.45, when);
  tone.frequency.linearRampToValueAtTime(cutoff, when + attack);
  tone.frequency.setValueAtTime(cutoff, off);
  tone.frequency.exponentialRampToValueAtTime(cutoff * 0.4, end);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(FLOOR, when);
  gain.gain.linearRampToValueAtTime(0.3, when + attack);
  gain.gain.setValueAtTime(0.3, off);
  gain.gain.exponentialRampToValueAtTime(FLOOR, end);
  tone.connect(gain);
  gain.connect(out);
  const each = ctx.createGain();
  each.gain.value = 0.34;
  each.connect(tone);
  for (const cents of PAD_DETUNE) {
    const saw = oscillator(ctx, 'sawtooth', hz, when, end + 0.05);
    saw.detune.value = cents;
    saw.connect(each);
  }
  const body = ctx.createGain();
  body.gain.value = 0.5;
  body.connect(tone);
  oscillator(ctx, 'sine', hz, when, end + 0.05).connect(body);
};

/** A drum struck: the skin's note falling quickly, a second tone above, and the slap of the stick. */
const timp: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.45);
  const hz = cue.hz ?? 90;
  partial(ctx, out, 'sine', hz * 1.7, when, 0.6, 1.2, hz, 0.3, 0.004);
  partial(ctx, out, 'sine', hz * 2.4, when, 0.18, 0.5, hz * 1.3, 0.2, 0.003);
  const slap = hiss(env, 'white', when, 0.08, cue.seed);
  const band = filter(ctx, 'bandpass', 520, 1.2);
  const gain = ctx.createGain();
  shape(gain.gain, when, 0.2, 0.001, 0, 0.06);
  slap.connect(band);
  band.connect(gain);
  gain.connect(out);
};

/** A heartbeat felt through the ribs: one low soft thump. */
const heart: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.1);
  const hz = cue.hz ?? 55;
  const dull = filter(ctx, 'lowpass', 220);
  dull.connect(out);
  partial(ctx, dull, 'sine', hz * 1.5, when, 0.5, 0.3, hz * 0.85, 0.12, 0.006);
};

/** Noise climbing through a band that sweeps up, growing from almost nothing: the sound of a thing about to happen. */
const riser: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.2);
  const seconds = Math.min(cue.seconds ?? 2.5, 3.6);
  const from = cue.hz ?? 300;
  const src = hiss(env, 'white', when, seconds + 0.1, cue.seed);
  const band = filter(ctx, 'bandpass', from, 1.1);
  band.frequency.setValueAtTime(from, when);
  band.frequency.exponentialRampToValueAtTime(cue.to ?? from * 12, when + seconds);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.004, when);
  gain.gain.exponentialRampToValueAtTime(0.35, when + seconds * 0.97);
  gain.gain.linearRampToValueAtTime(0, when + seconds + 0.04);
  src.connect(band);
  band.connect(gain);
  gain.connect(out);
};

/** A breath: soft noise that rises and falls over `seconds`. */
const breath: Voice = (env, when, cue) => {
  const { ctx } = env;
  const out = output(env, cue, 0.2);
  const seconds = Math.min(cue.seconds ?? 1.5, 3.6);
  const src = hiss(env, 'pink', when, seconds + 0.1, cue.seed);
  const band = filter(ctx, 'bandpass', cue.hz ?? 1700, 0.8);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(FLOOR, when);
  gain.gain.linearRampToValueAtTime(0.3, when + seconds * 0.45);
  gain.gain.exponentialRampToValueAtTime(FLOOR, when + seconds);
  src.connect(band);
  band.connect(gain);
  gain.connect(out);
};

/** The whole mix drops away for `seconds` and comes back in an instant: the held breath before a great hit. */
const duck: Voice = (env, when, cue) => {
  const { gain } = env.bus;
  const low = dbToGain(cue.level);
  const seconds = cue.seconds ?? 0.2;
  gain.setValueAtTime(1, when);
  gain.linearRampToValueAtTime(low, when + Math.min(0.07, seconds * 0.4));
  gain.setValueAtTime(low, when + seconds - 0.002);
  gain.setValueAtTime(1, when + seconds);
};

export const VOICES: Readonly<Record<VoiceName, Voice>> = {
  boom,
  thud,
  clang,
  groan,
  steam,
  tick,
  crackle,
  ping,
  whoom,
  servo,
  blip,
  rumble,
  step,
  pluck,
  pad,
  timp,
  heart,
  riser,
  breath,
  duck,
};
