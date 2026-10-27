import { createRng } from '../../shared/hash';

/**
 * Noise for the synth to shape, made once per audio context from a seed so that every play of the
 * film (and every offline render of it) hears the same hiss. Three colours: white (all pitches
 * alike, for crashes and steam), pink (the weight of wind and rushing air) and brown (a low
 * rumble). Each is a few seconds of stereo that loops without a seam.
 */

export type NoiseColor = 'white' | 'pink' | 'brown';

export type NoiseBank = Readonly<Record<NoiseColor, AudioBuffer>>;

/** Seconds of each colour. */
export const NOISE_SECONDS = 4;
/** Samples over which the end of the loop is faded into its start, so that the seam cannot be heard. */
const SEAM = 2048;
/** The loudness every colour is brought to (root mean square), so that a voice is as loud in any of them. */
const RMS = 0.2;

/** One channel of noise, `length` samples that run on into themselves when looped. */
function channel(color: NoiseColor, length: number, seed: number): Float32Array<ArrayBuffer> {
  const random = createRng(seed);
  const total = length + SEAM;
  const raw = new Float32Array(total);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let brown = 0;
  for (let i = 0; i < total; i++) {
    const white = random() * 2 - 1;
    if (color === 'white') {
      raw[i] = white;
    } else if (color === 'pink') {
      // Three leaky integrators at different speeds tilt white noise down 3 dB an octave.
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      raw[i] = b0 + b1 + b2 + white * 0.1848;
    } else {
      // A leaky sum of white noise falls 6 dB an octave.
      brown = (brown + 0.02 * white) / 1.02;
      raw[i] = brown;
    }
  }
  // The last SEAM samples are the lead-in to the first ones: crossfade them in, so that the loop continues where it left off.
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    if (i < SEAM) {
      const angle = (Math.PI / 2) * (i / SEAM);
      out[i] = (raw[i] as number) * Math.sin(angle) + (raw[length + i] as number) * Math.cos(angle);
    } else {
      out[i] = raw[i] as number;
    }
  }
  let sum = 0;
  for (let i = 0; i < length; i++) sum += (out[i] as number) ** 2;
  const scale = RMS / Math.sqrt(sum / length || 1);
  for (let i = 0; i < length; i++) out[i] = (out[i] as number) * scale;
  return out;
}

export function createNoiseBank(ctx: BaseAudioContext, seed = 0x6e015e): NoiseBank {
  const length = Math.round(ctx.sampleRate * NOISE_SECONDS);
  const make = (color: NoiseColor, salt: number): AudioBuffer => {
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    buffer.copyToChannel(channel(color, length, seed + salt), 0);
    buffer.copyToChannel(channel(color, length, seed + salt + 1), 1);
    return buffer;
  };
  return { white: make('white', 0), pink: make('pink', 10), brown: make('brown', 20) };
}
