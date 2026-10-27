import type { Game } from '../engine/game';
import {
  createIntro,
  type IntroEnd,
  type IntroPlayback,
  type IntroSite,
} from '../engine/intro/director';
import { createIntroOverlay } from '../ui/intro-overlay';

/**
 * Plays the intro film when a run opens, and keeps the rest of the page out of its way. The film
 * starts inside the click that asks for the mouse, so the mouse arrives already in hand: the game
 * holds the input deaf while it plays (the run's clock stays stopped, since nobody is playing it)
 * and hands the same mouse to the player when it ends, with no second click. Any key or click skips
 * it; letting go of the mouse (Esc) ends it at once and leaves the pause card up.
 *
 * A page that opens on the title screen starts the film from there instead (`play`): the title's
 * Play asks for the mouse itself and the film follows a moment later, once the picture has faded.
 *
 * It touches nothing of the run: no commands, no events, nothing on the wire. A guest never sees
 * it, nor a host with a room open, because the run they are in is already going.
 */

/** Skip keys and clicks are ignored this long after the film starts: the click that began it can come twice. */
const SKIP_GRACE_MS = 800;
/** If the mouse has not arrived by now the browser is not going to hand it over. */
const CAPTURE_WAIT_MS = 2500;
/** Seconds the screen takes to clear from black after a skip. */
const SKIP_CLEAR_SECONDS = 0.6;

export interface IntroControllerOptions {
  readonly game: Game;
  /** The valley as the film needs it, or null while there is none to show. */
  readonly site: () => IntroSite | null;
  /** Whether a fresh run should open with the film: asked when the mouse is first requested. */
  readonly wanted: () => boolean;
  /** Whether the player's system asks for less motion, which makes the film calmer: asked as each film begins. */
  readonly calm: () => boolean;
  /** True when a title screen starts the film (`play`): the first request for the mouse of the page then starts nothing by itself. */
  readonly manual?: boolean;
}

export interface IntroController {
  /** Plays the film now, from the pause card's "Watch the intro": asks for the mouse, and the film starts with it. */
  replay(): void;
  /** Plays the film now, for a title screen that has asked for the mouse itself: the input is held from here, and the mouse that arrives is handed to the player when the film ends. False when a film is already on or the page is closing. */
  play(): boolean;
  /** Plays the film held at `seconds`, with no mouse needed: for pictures and tests. */
  hold(seconds: number): IntroPlayback | null;
  /** The film that is playing, or null. */
  readonly playback: IntroPlayback | null;
  dispose(): void;
}

/** The keys that are not a decision to skip: modifiers, the function keys the browser uses, and anything with Ctrl, Alt or Cmd down. */
function skipsOn(event: KeyboardEvent): boolean {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return false;
  if (/^(Shift|Control|Alt|Meta|CapsLock|NumLock|ScrollLock|ContextMenu|OS)/.test(event.code)) {
    return false;
  }
  return !/^F\d+$/.test(event.code);
}

export function createIntroController({
  game,
  site,
  wanted,
  calm,
  manual = false,
}: IntroControllerOptions): IntroController {
  const { input } = game;
  const overlay = createIntroOverlay();
  let playback: IntroPlayback | null = null;
  /** The film plays on the first request for the mouse of the page, and again whenever it is asked for. A run in play is not offered one, nor is a page whose title screen starts the film. */
  let offered = !manual && !input.captured;
  let requested = false;
  let startedAt = 0;
  let captured = false;
  let holding = false;
  let waitTimer = 0;
  let disposed = false;

  const skip = (event: Event): void => {
    if (!playback || performance.now() - startedAt < SKIP_GRACE_MS) return;
    event.preventDefault();
    playback.skip();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.code === 'Escape' || skipsOn(event)) skip(event);
  };
  const onMouse = (event: MouseEvent): void => skip(event);

  const stopListening = (): void => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousedown', onMouse, true);
    window.clearTimeout(waitTimer);
  };

  const onEnd = (how: IntroEnd): void => {
    playback = null;
    stopListening();
    document.body.classList.remove('intro-playing');
    // A skip fades the picture to black before it ends, so the screen clears from black; the rest end on a clear screen.
    overlay.hide(how === 'skipped' ? SKIP_CLEAR_SECONDS : 0);
    input.hold(false);
  };

  const begin = (heldAt: number | null): IntroPlayback | null => {
    const where = site();
    if (!where || playback || disposed) return null;
    holding = heldAt !== null;
    startedAt = performance.now();
    captured = input.captured;
    const film = createIntro({
      stage: game.stage,
      site: where,
      onFrame: (frame) => overlay.set(frame),
      onEnd,
      holdAt: heldAt,
      calm: calm(),
    });
    playback = film;
    document.body.classList.add('intro-playing');
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    // The mouse is held from the moment it is asked for, so it arrives deaf and the run's clock never starts.
    if (!holding) input.hold(true);
    game.setCinematic(film);
    if (!holding) {
      waitTimer = window.setTimeout(() => {
        if (playback === film && !input.captured) abort(true);
      }, CAPTURE_WAIT_MS);
    }
    return film;
  };

  /** Stops the film where it is, with no fade: the mouse is gone, or never came. */
  const abort = (offerAgain: boolean): void => {
    if (!playback) return;
    if (offerAgain) offered = true;
    game.setCinematic(null);
  };

  const stopRequests = input.onLockRequest(() => {
    if (playback) return;
    if (requested || (offered && wanted())) {
      requested = false;
      offered = false;
      begin(null);
    }
  });

  const stopChanges = input.onChange(() => {
    // The first time the mouse is had with no film, the run has begun, and a film would be a cut into the middle of it.
    if (!playback && input.captured) offered = false;
    if (!playback || holding) return;
    if (input.captured) captured = true;
    // The mouse came and went (Esc), or the browser refused it: the player is not watching a film, they are at the pause card.
    else if (captured || input.blocked) abort(input.blocked && !captured);
  });

  return {
    get playback() {
      return playback;
    },
    replay() {
      if (playback) return;
      requested = true;
      input.requestLock();
      // A browser that refuses the request has already said so through `onChange`; this is for one that says nothing.
      requested = false;
    },
    play() {
      offered = false;
      return begin(null) !== null;
    },
    hold(seconds) {
      offered = false;
      return begin(seconds);
    },
    dispose() {
      disposed = true;
      stopRequests();
      stopChanges();
      stopListening();
      if (playback) game.setCinematic(null);
      overlay.dispose();
    },
  };
}
