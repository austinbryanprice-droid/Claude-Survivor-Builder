import type { Game } from '../engine/game';
import { createTitleDrift } from '../engine/title-drift';
import { TITLE } from '../shared/title';
import { createTitleScreen } from '../ui/title-screen';
import { createTitleRoute } from '../world/terrain/viewpoints';

/**
 * Opens the page on the title screen: the valley drifts by under the name of the game until the
 * player presses Play, which asks for the mouse, fades the picture to black and starts the intro
 * film (or, for a player who has turned the film off, glides the camera into the run). Nothing of
 * the run is touched: the screen is a camera and some words, the run's clock stays stopped, and
 * the mouse is held deaf until the film or the glide has handed it over. When a film follows, Play
 * also unlocks the game's audio, which the browser allows only inside a click, so that it has its sound.
 */

/** Said under Play when the browser would not hand over the mouse. */
const REFUSED_HINT =
  'The browser did not hand over the mouse. Wait a moment, then click Play again.';
/** Seconds the picture takes to come back from black when the film would not start. */
const RETURN_SECONDS = 0.6;

/** Where the screen is: waiting for Play, fading out for the film, gliding into the run, or gone (the film has the camera, or the run has). */
export type TitlePhase = 'waiting' | 'leaving' | 'gliding' | 'done';

export interface TitleOptions {
  readonly game: Game;
  /** Whether the player's system asks for less motion, which holds the camera still: asked as the screen comes up. */
  readonly calm: () => boolean;
  /** Whether Play is followed by the film: asked at the click. */
  readonly film: () => boolean;
  /** Gets the film's code ready; false when it cannot be had, and Play glides into the run instead. */
  readonly prepareFilm: () => Promise<boolean>;
  /** Starts the film, with the mouse already asked for; false when it would not start. */
  readonly playFilm: () => boolean;
}

export interface TitleController {
  readonly phase: TitlePhase;
  /** Seconds the camera has drifted over the valley. */
  readonly seconds: number;
  dispose(): void;
}

/** What `promise` says, or `fallback` if it says nothing within `ms` or fails. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    const settle = (value: T): void => {
      window.clearTimeout(timer);
      resolve(value);
    };
    promise.then(settle, () => settle(fallback));
  });
}

export function createTitle({
  game,
  calm,
  film,
  prepareFilm,
  playFilm,
}: TitleOptions): TitleController {
  const { input } = game;
  const screen = createTitleScreen();
  document.body.classList.add('title-showing');

  let phase: TitlePhase = 'waiting';
  let hadMouse = false;
  /** Counts the presses of Play, so that a wait for the film's code that outlives its press is ignored. */
  let presses = 0;
  let leadTimer = 0;
  let stopWatching: (() => void) | null = null;
  let stopHiding: (() => void) | null = null;

  const unwatch = (): void => {
    stopWatching?.();
    stopWatching = null;
  };

  /** Takes the screen away once the next frame is drawn: the film's first frame is black, and the picture must not show in between. */
  const clearAway = (): void => {
    document.body.classList.remove('title-showing');
    stopHiding?.();
    stopHiding = game.onFrame(() => {
      stopHiding?.();
      stopHiding = null;
      screen.hide();
    });
  };

  const drift = createTitleDrift({
    route: createTitleRoute(game.world.groundAt),
    calm: calm(),
    onEnd: () => {
      // The film took the camera, or the glide has flown it into the run, which is the player's from here.
      if (drift.gliding) input.hold(false);
      phase = 'done';
      window.clearTimeout(leadTimer);
      unwatch();
      clearAway();
    },
  });
  game.setCinematic(drift);

  /** The mouse did not come, or the player let go of it before the film began: the screen is as it was, waiting for another Play. */
  const retreat = (refused: boolean): void => {
    window.clearTimeout(leadTimer);
    unwatch();
    phase = 'waiting';
    input.hold(false);
    screen.restore();
    screen.setHint(refused ? REFUSED_HINT : null);
  };

  const watchMouse = (): void => {
    if (phase !== 'leaving') return;
    if (input.captured) hadMouse = true;
    else if (input.blocked || hadMouse) retreat(input.blocked && !hadMouse);
  };

  const glide = (): void => {
    unwatch();
    phase = 'gliding';
    // The picture comes back from black, if it went there for a film that would not start.
    screen.leave(false, RETURN_SECONDS);
    drift.glide(TITLE.glideSeconds);
  };

  const proceed = async (withFilm: boolean, press: number): Promise<void> => {
    const ready = withFilm && (await within(prepareFilm(), TITLE.filmWaitSeconds * 1000, false));
    // The player let go of the mouse while the film's code was coming: they are back at the title, or on to another press.
    if (press !== presses || phase !== 'leaving') return;
    // When the film starts it takes the camera, which ends the drift and the screen with it.
    if (ready && playFilm()) return;
    glide();
  };

  /** Play was pressed: the mouse is asked for here, inside the click, and held deaf from the first moment so that nothing the player presses reaches the run before it is theirs. */
  const onPlay = (): void => {
    if (phase !== 'waiting') return;
    phase = 'leaving';
    hadMouse = input.captured;
    const withFilm = film();
    // The browser only lets a page make sound from inside a click or a key press, and the film's sound starts later than this one. A glide has none.
    if (withFilm) game.audio.unlock();
    const press = ++presses;
    screen.setHint(null);
    screen.leave(withFilm, TITLE.leadSeconds);
    // The timer is set first: a browser that says no at once takes the screen back, which stops it.
    leadTimer = window.setTimeout(() => void proceed(withFilm, press), TITLE.leadSeconds * 1000);
    // The hold is made before anyone watches: holding tells every listener, and until the request below
    // clears it the input still carries the refusal of the last Play, which would read as a new one.
    input.hold(true);
    stopWatching = input.onChange(watchMouse);
    input.requestLock();
  };

  const stopPlay = screen.onPlay(onPlay);
  // Enter and Space play too, wherever the focus is: the screen has one thing to do.
  const onKey = (event: KeyboardEvent): void => {
    if (phase !== 'waiting' || event.repeat || event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    if (event.code !== 'Enter' && event.code !== 'Space') return;
    event.preventDefault();
    onPlay();
  };
  window.addEventListener('keydown', onKey);

  return {
    get phase() {
      return phase;
    },
    get seconds() {
      return drift.seconds;
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(leadTimer);
      stopPlay();
      if (game.cinematic === drift) game.setCinematic(null);
      unwatch();
      stopHiding?.();
      stopHiding = null;
      document.body.classList.remove('title-showing');
      screen.dispose();
      phase = 'done';
    },
  };
}
