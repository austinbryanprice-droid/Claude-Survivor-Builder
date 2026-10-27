import { createOutputChain } from '../engine/audio/hub';
import { createLiveSound } from '../engine/audio/live';
import type { RenderedSound } from '../engine/intro/sound-render';
import type { Effect, Listener } from '../shared/effect-sound';
import { QUIET_SCENE, type SoundScene } from '../shared/game-sound';

/**
 * What people do in the valley, drawn to samples with no one listening, which is how the sound of it
 * is measured here (nothing can be heard in the sandbox the game is built in): the same effects,
 * governor, voices and output chain as the live game, on a context that renders a file. A script says
 * where the listener stands and what happens, and when; the valley's long sounds run underneath as
 * they do in play (a quiet morning with the music held, unless the script says another scene), so the
 * effects are heard at the level they have against it.
 *
 * It goes the way a game plays: the context is stopped every few thousandths of a second, the
 * sound is told where the listener stands, and what is due in the next moment is handed over then and
 * not before. The mix comes up over the first three seconds, as it does when the game starts, so
 * effects are best scripted from the fourth second on.
 */

/** One thing in the script: either the listener moves, or an effect happens. */
export type EffectScriptItem =
  | { readonly at: number; readonly listener: Listener }
  | { readonly at: number; readonly effect: Effect };

export interface EffectRenderOptions {
  /** Samples a second; the browser's usual 44100 by default. */
  readonly sampleRate?: number;
  /** The master volume the render is made at (1 is the slider at the top). */
  readonly volume?: number;
  /** Fixes the music: the same seed plays the same notes. */
  readonly seed?: number;
  /** Seconds to draw. */
  readonly seconds: number;
  /** What happens, and when, in seconds from the start. Listed in any order. */
  readonly script: readonly EffectScriptItem[];
  /** How the valley stands under it: a quiet morning with the music held unless this says otherwise. */
  readonly scene?: SoundScene;
}

/** The audio thread works in blocks of this many samples, and a context can only be stopped between them. */
const BLOCK = 128;
/** Blocks between the moments the sound is told how the valley stands: a little under a frame at 60 a second. */
const BLOCKS_PER_FRAME = 6;

export async function renderEffectSound({
  sampleRate = 44100,
  volume = 1,
  seed = 1,
  seconds,
  script,
  scene = { ...QUIET_SCENE, held: true },
}: EffectRenderOptions): Promise<RenderedSound> {
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * seconds), sampleRate);
  const chain = createOutputChain(ctx, volume);
  const sound = createLiveSound(ctx, { output: chain.input, live: false, seed });
  const items = [...script].sort((a, b) => a.at - b.at);
  let next = 0;

  const frame = (BLOCK * BLOCKS_PER_FRAME) / sampleRate;
  const step = (t: number): void => {
    for (let item = items[next]; item && item.at <= t; item = items[++next]) {
      if ('listener' in item) sound.listen(item.listener);
      else sound.effect(item.effect);
    }
    sound.update(frame, scene);
  };

  step(0);
  for (let at = frame; at < seconds; at += frame) {
    void ctx.suspend(at).then(() => {
      step(ctx.currentTime);
      return ctx.resume();
    });
  }
  const buffer = await ctx.startRendering();
  return { sampleRate, left: buffer.getChannelData(0), right: buffer.getChannelData(1) };
}
