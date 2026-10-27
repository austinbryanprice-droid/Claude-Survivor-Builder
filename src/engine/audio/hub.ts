import { gainOfVolume } from '../../shared/audio';

/**
 * The game's one way out to the speakers. Browsers keep a page silent until the person has clicked
 * or pressed a key on it, so the audio context is not made when the page loads but by `unlock`,
 * which the Play buttons call from inside their click. Everything the game sounds goes into
 * `input`, which runs through a limiter (a loud moment is held back instead of clipping) and the
 * master volume the player set.
 *
 * This file is in the main bundle, so it is kept small: the noises themselves (`voices.ts`, the
 * intro's score) load with the film.
 */

export interface AudioHub {
  /** The audio context, once `unlock` has made it; null before that, and for a page that is kept silent. */
  readonly context: AudioContext | null;
  /** Where sound is sent to be heard (through the limiter and the volume); null while there is no context. */
  readonly input: AudioNode | null;
  /** The master volume, 0 (silent) to 1. */
  readonly volume: number;
  /** False for a page that is kept silent (`?sound=off`) or whose browser has no Web Audio: nothing else the game makes should be heard on it either. */
  readonly enabled: boolean;
  /** Makes the audio context, or wakes it if the browser had it asleep. Call it inside a click or a key press, which is when browsers allow it. */
  unlock(): void;
  /** Sets the master volume, 0 to 1. */
  setVolume(volume: number): void;
  dispose(): void;
}

export interface AudioHubOptions {
  /** The master volume to start at, 0 to 1. */
  readonly volume: number;
  /** False keeps the page silent: no audio context is ever made. */
  readonly enabled?: boolean;
  /** Makes the context. Tests give a stand-in. */
  readonly create?: () => AudioContext;
}

/** The part of the output that does not depend on whether the context is live or rendering a file. */
export interface OutputChain {
  /** Everything that is to be heard connects here. */
  readonly input: AudioNode;
  /** Sets the master volume, 0 to 1, over a few milliseconds so that it does not click. */
  setVolume(volume: number): void;
}

/** Seconds the master volume takes to follow the slider. */
const VOLUME_SMOOTHING = 0.03;

/**
 * Builds the way out: a bus, a limiter and the master volume, in front of `ctx.destination`. The
 * limiter is a compressor set to catch only the loudest moments, which are the film's big hits, so
 * that a dozen sounds landing together are squeezed together instead of being cut off.
 */
export function createOutputChain(ctx: BaseAudioContext, volume: number): OutputChain {
  const input = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 12;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  const master = ctx.createGain();
  master.gain.value = gainOfVolume(volume);
  input.connect(limiter);
  limiter.connect(master);
  master.connect(ctx.destination);
  return {
    input,
    setVolume(next) {
      master.gain.setTargetAtTime(gainOfVolume(next), ctx.currentTime, VOLUME_SMOOTHING);
    },
  };
}

export function createAudioHub({
  volume: initialVolume,
  enabled = true,
  create = () => new AudioContext(),
}: AudioHubOptions): AudioHub {
  let volume = clamp01(initialVolume);
  let usable = enabled;
  let context: AudioContext | null = null;
  let chain: OutputChain | null = null;
  /** True while the context sleeps because the tab is hidden, so that coming back wakes it and nothing else does. */
  let sleeping = false;
  let disposed = false;

  const onVisibility = (): void => {
    if (!context) return;
    if (document.hidden) {
      if (context.state === 'running') {
        sleeping = true;
        void context.suspend().catch(() => undefined);
      }
    } else if (sleeping) {
      sleeping = false;
      void context.resume().catch(() => undefined);
    }
  };

  return {
    get context() {
      return context;
    },
    get input() {
      return chain?.input ?? null;
    },
    get volume() {
      return volume;
    },
    get enabled() {
      return usable;
    },
    unlock() {
      if (disposed || !usable) return;
      if (!context) {
        // Nothing to unlock for a player who has the sound off: the context is made when they turn it up and click.
        if (volume <= 0) return;
        try {
          context = create();
        } catch {
          // A browser without Web Audio: the game is silent, and that is all.
          usable = false;
          return;
        }
        chain = createOutputChain(context, volume);
        document.addEventListener('visibilitychange', onVisibility);
      }
      if (context.state === 'suspended' && !document.hidden) {
        void context.resume().catch(() => undefined);
      }
    },
    setVolume(next) {
      volume = clamp01(next);
      chain?.setVolume(volume);
    },
    dispose() {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void context?.close().catch(() => undefined);
      context = null;
      chain = null;
    },
  };
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
