import { createRng } from '../../shared/hash';

/**
 * A reverb that is made, not loaded: the impulse response a convolver rings with is noise that dies
 * away over a few seconds and goes darker as it does, the way a big room swallows the high pitches
 * first. The two ears get noise of their own, which is what makes the room wide. The sound going
 * in is cleared of its lowest pitches first, so that a boom does not turn the room to mud.
 */

export interface Reverb {
  /** Sound sent into the room goes here. */
  readonly input: AudioNode;
  /** What the room gives back. */
  readonly output: AudioNode;
}

/** Seconds the room takes to fall 60 decibels. */
export const REVERB_SECONDS = 3.2;
/** Seconds before the first echo reaches the ear, which keeps a hit clear of its own reverb. */
const PRE_DELAY = 0.018;

function impulse(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.round(rate * (seconds + PRE_DELAY));
  const first = Math.round(rate * PRE_DELAY);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const random = createRng(seed + c * 7919);
    const data = new Float32Array(length);
    let low = 0;
    for (let i = first; i < length; i++) {
      const t = (i - first) / rate;
      // Falls 60 dB over `seconds`, after a quick swell so that the room does not start with a click.
      const fall = (1 - Math.exp(-t / 0.012)) * 10 ** ((-3 * t) / seconds);
      // A one-pole lowpass that closes as the sound ages: bright at first, dark by the end.
      const open = 0.06 + 0.8 * Math.exp(-t / 0.8);
      low += open * (random() * 2 - 1 - low);
      data[i] = low * fall;
    }
    buffer.copyToChannel(data, c);
  }
  return buffer;
}

export function createReverb(ctx: BaseAudioContext, seconds = REVERB_SECONDS): Reverb {
  const input = ctx.createGain();
  const clear = ctx.createBiquadFilter();
  clear.type = 'highpass';
  clear.frequency.value = 150;
  const soften = ctx.createBiquadFilter();
  soften.type = 'lowpass';
  soften.frequency.value = 6500;
  const room = ctx.createConvolver();
  room.buffer = impulse(ctx, seconds, 0x2e7b1d);
  const output = ctx.createGain();
  output.gain.value = 1;
  input.connect(clear);
  clear.connect(soften);
  soften.connect(room);
  room.connect(output);
  return { input, output };
}
