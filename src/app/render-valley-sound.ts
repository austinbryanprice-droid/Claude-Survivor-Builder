import { createOutputChain } from '../engine/audio/hub';
import { createLiveSound } from '../engine/audio/live';
import type { RenderedSound } from '../engine/intro/sound-render';
import { CYCLE_SECONDS, DAY_SECONDS, NIGHT_SECONDS } from '../shared/daycycle';
import { SceneTracker, cuesForEvent } from '../shared/game-sound';
import { createReading, readClock, type SurvivalEvent } from '../shared/survival-state';
import { ENEMIES } from '../systems/survival/balance';
import { planNight } from '../systems/survival/waves';

/**
 * A night of the valley drawn to samples with no one listening, which is how its sound is measured
 * here (nothing can be heard in the sandbox the game is built in): the same plan, voices and output
 * chain as the live game, on a context that renders a file. The player and the machines follow a
 * script instead of a person: the player stands a few blocks from the Core, the night's waves are
 * the game's own (`planNight`) and come out of the ring the game spawns them on, walk in at a
 * crawler's pace to the walls and are fought there for a while, and the host's three words
 * (nightfall, each wave's warning, the dawn) fall due when the plan says.
 *
 * The render goes the way a game plays: the context is stopped every few thousandths of a second,
 * the sound is told how the valley stands, and what falls due in the next moment is handed over then
 * and not before, so the number of sounds alive at once, and with it the cost, is the player's.
 */

export interface ValleyRenderOptions {
  /** Samples a second; the browser's usual 44100 by default. */
  readonly sampleRate?: number;
  /** The master volume the render is made at (1 is the slider at the top). */
  readonly volume?: number;
  /** The night drawn, from 1: its waves are the game's plan for it. */
  readonly night?: number;
  /** Seconds of day drawn before nightfall, and of morning after the dawn. */
  readonly leadIn?: number;
  readonly tail?: number;
  /** Seconds to draw from the start, all of it by default. */
  readonly seconds?: number;
  /** Fixes the music: the same seed plays the same notes. */
  readonly seed?: number;
  /** Blocks the player stands from the Core, and the nearest a machine comes to the player. */
  readonly coreDistance?: number;
  readonly holdAt?: number;
  /** Seconds a wave is fought for once its machines are as near as they come. */
  readonly fight?: number;
  /** Holds the run's clock the whole time, as the pause card does: the music waits and the long sounds go on. */
  readonly held?: boolean;
}

/** The audio thread works in blocks of this many samples, and a context can only be stopped between them. */
const BLOCK = 128;
/** Blocks between the moments the sound is told how the valley stands: a little under a frame at 60 a second. */
const BLOCKS_PER_FRAME = 6;

export async function renderValleySound({
  sampleRate = 44100,
  volume = 1,
  night: nightNumber = 1,
  leadIn = 45,
  tail = 30,
  seconds,
  seed = 1,
  coreDistance = 8,
  holdAt = 13,
  fight = 22,
  held = false,
}: ValleyRenderOptions = {}): Promise<RenderedSound> {
  const night = Math.max(1, Math.floor(nightNumber));
  const plan = planNight(night);
  const length = Math.min(seconds ?? Number.POSITIVE_INFINITY, leadIn + NIGHT_SECONDS + tail);
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * length), sampleRate);
  const chain = createOutputChain(ctx, volume);
  const sound = createLiveSound(ctx, { output: chain.input, live: false, seed });
  const tracker = new SceneTracker();
  const reading = createReading();

  // The run's clock at the first sample, and when each of the host's words falls due.
  const startAt = (night - 1) * CYCLE_SECONDS + DAY_SECONDS - leadIn;
  const words: { at: number; event: SurvivalEvent }[] = [
    { at: leadIn, event: { k: 'nightfall', n: night } },
    ...plan.waves.map((wave, i): { at: number; event: SurvivalEvent } => ({
      at: leadIn + wave.warnAt,
      event: { k: 'wave', n: night, i: i + 1, of: plan.waves.length, c: wave.kinds.length },
    })),
    { at: leadIn + NIGHT_SECONDS, event: { k: 'dawn', n: night } },
  ];
  let nextWord = 0;

  const { spawnRadius } = ENEMIES;
  const pace = ENEMIES.crawler.speed;
  const walk = (spawnRadius - holdAt) / pace;
  /** Blocks from the player to the nearest machine at `t` seconds, or null with none on the field. */
  const nearestAt = (t: number): number | null => {
    let nearest: number | null = null;
    for (const wave of plan.waves) {
      const into = t - (leadIn + wave.comesAt);
      if (into < 0 || into > walk + fight) continue;
      const distance = Math.max(holdAt, spawnRadius - pace * into);
      if (nearest === null || distance < nearest) nearest = distance;
    }
    return nearest;
  };

  const frame = (BLOCK * BLOCKS_PER_FRAME) / sampleRate;
  const step = (t: number): void => {
    const clock = readClock(startAt + t, reading);
    for (let word = words[nextWord]; word && word.at <= t; word = words[++nextWord]) {
      sound.playAll(cuesForEvent(word.event, seed));
    }
    const scene = tracker.update(frame, {
      phase: clock.phase,
      into: clock.into,
      left: clock.left,
      nearestMachine: nearestAt(t),
      coreDistance,
      running: !held,
      over: false,
    });
    sound.update(frame, scene);
  };

  step(0);
  for (let at = frame; at < length; at += frame) {
    void ctx.suspend(at).then(() => {
      step(ctx.currentTime);
      return ctx.resume();
    });
  }
  const buffer = await ctx.startRendering();
  return { sampleRate, left: buffer.getChannelData(0), right: buffer.getChannelData(1) };
}
