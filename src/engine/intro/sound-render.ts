import { INTRO_SECONDS } from '../../shared/intro';
import { SOUND_SECONDS } from '../../shared/intro-sound';
import { createOutputChain } from '../audio/hub';
import { createIntroSound } from './sound';

/**
 * The film's whole soundtrack drawn to samples, with no one listening: the same score, voices and
 * output chain as the live film, run on a context that renders a file. The tests measure it
 * (loudness, silence, the shape of each scene) and it is how a recording of the film's sound is
 * made, since nothing here can be heard in the sandbox the game is built in.
 *
 * The render goes the way a film plays: the context is stopped every few thousandths of a second,
 * the film's clock is told where it is, and the sound that falls due in the next moment is handed
 * over then and not before. That keeps the number of sounds alive at once, and with it the cost of
 * the render, the same as in the player's browser.
 */

export interface RenderOptions {
  /** Samples a second; the browser's usual 44100 by default. */
  readonly sampleRate?: number;
  /** The master volume the render is made at (1 is the slider at the top). */
  readonly volume?: number;
  /** Seconds of the film's sound to render, from its start; all of it by default. */
  readonly seconds?: number;
}

export interface RenderedSound {
  readonly sampleRate: number;
  readonly left: Float32Array;
  readonly right: Float32Array;
}

/** The audio thread works in blocks of this many samples, and a context can only be stopped between them. */
const BLOCK = 128;
/** Blocks between the moments the film's clock is told where it is: a little under a frame at 60 a second. */
const BLOCKS_PER_FRAME = 6;

export async function renderIntroSound({
  sampleRate = 44100,
  volume = 1,
  seconds = SOUND_SECONDS,
}: RenderOptions = {}): Promise<RenderedSound> {
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * seconds), sampleRate);
  const chain = createOutputChain(ctx, volume);
  const sound = createIntroSound(ctx, { output: chain.input, live: false });
  const frame = (BLOCK * BLOCKS_PER_FRAME) / sampleRate;
  sound.update(0);
  for (let at = frame; at < Math.min(seconds, INTRO_SECONDS); at += frame) {
    // The film's clock is the audio clock, as it is for a player whose film runs at full speed.
    void ctx.suspend(at).then(() => {
      sound.update(ctx.currentTime);
      return ctx.resume();
    });
  }
  if (seconds > INTRO_SECONDS) {
    void ctx
      .suspend(Math.ceil((INTRO_SECONDS * sampleRate) / BLOCK) * (BLOCK / sampleRate))
      .then(() => {
        sound.finish();
        return ctx.resume();
      });
  }
  const buffer = await ctx.startRendering();
  return { sampleRate, left: buffer.getChannelData(0), right: buffer.getChannelData(1) };
}
