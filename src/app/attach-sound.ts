import { createLiveSound, type LiveSound, type LiveSoundEvent } from '../engine/audio/live';
import type { Game } from '../engine/game';
import type { GameSession } from '../net/session';
import { QUIET_SCENE, SceneTracker, cuesForEvent, type SoundScene } from '../shared/game-sound';
import { createReading, type SurvivalEvent } from '../shared/survival-state';

/**
 * The sound of the valley while it is played: the wind, the Core's hum and the low note of the
 * night under everything, a sparse music over them, and a stinger ahead of each wave. It follows
 * the run the way the sky does, by reading the clock, the machines and the Core once a frame and by
 * listening for what the host announces (nightfall, a wave coming, the dawn), so a guest hears
 * what the host's player hears.
 *
 * It loads on its own once the game is up. Browsers keep a page silent until it has been clicked,
 * so the first click or key press on the page unlocks the audio, whatever it was for. The intro
 * film has its own score and the camera: while it plays, the valley is silent, and a film that
 * begins over a valley already sounding takes it away (a moment's fade), so that two scores
 * never play at once. When the film ends the valley comes up under the last chord.
 */

/** Seconds the valley takes to fade out when the intro film begins over it. */
const HUSH_SECONDS = 0.6;
/** Events kept for the debug page: enough for a night. */
const KEPT_EVENTS = 400;
/** What counts as a gesture that lets the page make sound. */
const GESTURES = ['pointerdown', 'mousedown', 'keydown', 'touchend'] as const;

export interface SoundAttachOptions {
  readonly game: Game;
  /** The run as this peer sees it: the clock, what the host announces and where the machines are. */
  readonly session: Pick<GameSession, 'survival' | 'sampleEnemies'>;
  /** Where the Core stands in the valley being played, or null where there is none. */
  readonly core: () => { readonly x: number; readonly z: number } | null;
}

/** What the `?debug` page and the tests can see of the sound. */
export interface SoundDebug {
  /** The sound that is playing now; null before the audio is unlocked, while the film plays, and for a page kept silent. */
  readonly live: LiveSound | null;
  /** The scene the sound heard on its last frame. */
  readonly scene: SoundScene;
  /** The last things it started, the newest last. */
  readonly events: readonly LiveSoundEvent[];
}

export interface GameSound {
  readonly debug: SoundDebug;
  dispose(): void;
}

export function attachSound({ game, session, core }: SoundAttachOptions): GameSound {
  const { audio } = game;
  const reading = createReading();
  const tracker = new SceneTracker();
  const events: LiveSoundEvent[] = [];
  let live: LiveSound | null = null;
  let scene: SoundScene = QUIET_SCENE;
  let disposed = false;
  /** Set once the browser has refused to make the sound: it is told once and not tried again. */
  let refused = false;

  const wake = (): void => audio.unlock();
  const listen = (): void => {
    for (const gesture of GESTURES) window.addEventListener(gesture, wake, true);
  };
  const stopListening = (): void => {
    for (const gesture of GESTURES) window.removeEventListener(gesture, wake, true);
  };
  listen();

  /** Blocks from the player to the nearest machine in the horizontal plane, or null with none about. */
  const nearestMachine = (): number | null => {
    const { player } = game;
    let nearest = Number.POSITIVE_INFINITY;
    for (const machine of session.sampleEnemies()) {
      const distance = Math.hypot(machine.x - player.x, machine.z - player.z);
      if (distance < nearest) nearest = distance;
    }
    return Number.isFinite(nearest) ? nearest : null;
  };

  const coreDistance = (): number | null => {
    const where = core();
    if (!where) return null;
    const { player } = game;
    return Math.hypot(where.x - player.x, where.z - player.z);
  };

  /** Builds the sound once the page has an audio context to make it in. */
  const open = (): LiveSound | null => {
    const { context, input } = audio;
    if (!context || !input || audio.volume <= 0) return null;
    try {
      return createLiveSound(context, {
        output: input,
        live: true,
        seed: game.world.seed,
        trace: (event) => {
          events.push(event);
          if (events.length > KEPT_EVENTS) events.splice(0, events.length - KEPT_EVENTS);
        },
      });
    } catch (error) {
      // The sound is a courtesy: a browser that cannot make it plays the game in silence, and says so once.
      refused = true;
      console.error('The valley could not make its sound; the game goes on without it.', error);
      return null;
    }
  };

  /** Fades the sound out and lets go of it: the next one is built fresh. */
  const hush = (seconds: number): void => {
    const going = live;
    live = null;
    try {
      going?.fadeOut(seconds);
    } catch (error) {
      console.error('The valley’s sound could not be faded.', error);
    }
  };

  const stopFrames = game.onBeforeRender((_camera, dt) => {
    // Built as soon as there is an audio context to build it in, behind the film when one is playing:
    // its room and its noise take about a tenth of a second to make, which is better spent in the dark
    // of the title's fade than on the frame that hands the run over. It makes no sound until it is
    // updated, and a frame of its own goes by before that.
    if (!live) {
      if (!refused) live = open();
      return;
    }
    // The film has its own score, and the valley comes up when it is over.
    if (game.cinematic) return;
    const clock = session.survival.read(reading);
    scene = tracker.update(dt, {
      phase: clock.phase,
      into: clock.into,
      left: clock.left,
      nearestMachine: nearestMachine(),
      coreDistance: coreDistance(),
      running: clock.running,
      over: clock.over,
    });
    live.update(dt, scene);
    // Once the page is let make sound there is nothing left to wake.
    if (audio.context?.state === 'running') stopListening();
  });

  const stopFilm = game.onCinematicChange(() => {
    if (!game.cinematic || !live) return;
    // A sound that has not started anything waits behind the film as it is.
    if (live.stats.beds > 0 || live.stats.voices > 0) hush(HUSH_SECONDS);
  });

  /** The host's words that have a sound (nightfall, a wave coming, the dawn), played when they come. */
  const stopEvents = session.survival.onEvent((event: SurvivalEvent) => {
    if (!live || game.cinematic) return;
    live.playAll(cuesForEvent(event, game.world.seed));
  });

  return {
    debug: {
      get live() {
        return live;
      },
      get scene() {
        return scene;
      },
      events,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopFrames();
      stopFilm();
      stopEvents();
      stopListening();
      hush(0.2);
    },
  };
}
