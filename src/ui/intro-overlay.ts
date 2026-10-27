import { INTRO_TITLE, type IntroFrame } from '../shared/intro';
import { el, keycap } from './dom';
import './intro-overlay.css';

/**
 * What the intro film wears over the picture: the letterbox bars, the captions, the title card,
 * the white flashes, the black between cuts, the eyelids of the survivor waking and the prompt to
 * skip. It draws whatever frame it is given, so the film's script (`shared/intro.ts`) decides
 * what is on screen and when.
 */
export interface IntroOverlay {
  readonly element: HTMLElement;
  /** Puts the film's next frame on screen; the overlay shows itself if it was hidden. */
  set(frame: IntroFrame): void;
  /**
   * Takes the overlay off the screen. With `fade` seconds it first holds the screen black and
   * clears it over that long, so the picture behind it can change unseen; without, it is gone at once.
   */
  hide(fade?: number): void;
  /** True while the overlay is on the screen, fading out included. */
  readonly shown: boolean;
  dispose(): void;
}

/** The widest picture the bars frame, as width over height: the cinema's own. */
const CINEMA_ASPECT = 2.39;

const clampShare = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function createIntroOverlay(): IntroOverlay {
  const root = el('div', 'intro');
  root.hidden = true;
  root.setAttribute('role', 'presentation');

  const black = el('div', 'intro-black');
  const flash = el('div', 'intro-flash');
  const lidTop = el('div', 'intro-lid intro-lid-top');
  const lidBottom = el('div', 'intro-lid intro-lid-bottom');
  const barTop = el('div', 'intro-bar intro-bar-top');
  const barBottom = el('div', 'intro-bar intro-bar-bottom');
  const caption = el('p', 'intro-caption');
  caption.setAttribute('role', 'status');
  const title = el('div', 'intro-title');
  title.append(
    el('h1', 'intro-name', INTRO_TITLE.title),
    el('p', 'intro-tagline', INTRO_TITLE.subtitle),
  );
  const skip = el('p', 'intro-skip');
  skip.append(keycap('Any key'), el('span', undefined, 'to skip'));
  for (const decoration of [black, flash, lidTop, lidBottom, barTop, barBottom, skip]) {
    decoration.setAttribute('aria-hidden', 'true');
  }
  root.append(flash, lidTop, lidBottom, barTop, barBottom, title, caption, skip, black);
  document.body.append(root);

  // Writing a style the browser already has still costs a recalculation, so only changes are written.
  const last: IntroFrame = {
    black: -1,
    flash: -1,
    bars: -1,
    lids: -1,
    caption: null,
    captionAlpha: -1,
    title: -1,
    skipHint: -1,
  };
  let lastBarHeight = -1;
  let lastCaption: string | null = '';
  let fadeTimer = 0;
  let shown = false;

  /** The height of one bar, as a share of the screen, so that the picture between them is the cinema's shape. */
  const barShare = (): number => {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    return Math.max(0, (1 - aspect / CINEMA_ASPECT) / 2);
  };

  const show = (): void => {
    window.clearTimeout(fadeTimer);
    black.style.transition = '';
    root.hidden = false;
    shown = true;
  };

  return {
    element: root,
    get shown() {
      return shown;
    },
    set(frame) {
      if (!shown || black.style.transition !== '') show();
      if (frame.black !== last.black) {
        black.style.opacity = String(clampShare(frame.black));
        last.black = frame.black;
      }
      if (frame.flash !== last.flash) {
        flash.style.opacity = String(clampShare(frame.flash));
        last.flash = frame.flash;
      }
      const share = barShare();
      if (frame.bars !== last.bars || share !== lastBarHeight) {
        const height = `${(share * clampShare(frame.bars) * 100).toFixed(3)}%`;
        barTop.style.height = height;
        barBottom.style.height = height;
        // The caption sits in the lower bar when there is one, and over the picture when there is not.
        root.style.setProperty('--intro-bar', `${(share * 100).toFixed(3)}%`);
        last.bars = frame.bars;
        lastBarHeight = share;
      }
      if (frame.lids !== last.lids) {
        // Each lid is half the screen and a little more; shut, they meet in the middle.
        const open = 1 - clampShare(frame.lids);
        lidTop.style.transform = `translateY(${(-open * 100).toFixed(2)}%)`;
        lidBottom.style.transform = `translateY(${(open * 100).toFixed(2)}%)`;
        last.lids = frame.lids;
      }
      if (frame.caption !== lastCaption) {
        caption.textContent = frame.caption ?? '';
        lastCaption = frame.caption;
      }
      if (frame.captionAlpha !== last.captionAlpha) {
        caption.style.opacity = String(clampShare(frame.captionAlpha));
        last.captionAlpha = frame.captionAlpha;
      }
      if (frame.title !== last.title) {
        const arrived = clampShare(frame.title);
        title.style.opacity = String(arrived);
        title.style.setProperty('--arrived', arrived.toFixed(3));
        last.title = frame.title;
      }
      if (frame.skipHint !== last.skipHint) {
        skip.style.opacity = String(clampShare(frame.skipHint));
        last.skipHint = frame.skipHint;
      }
    },
    hide(fade = 0) {
      window.clearTimeout(fadeTimer);
      if (!shown) return;
      if (fade <= 0) {
        root.hidden = true;
        shown = false;
        return;
      }
      // Everything but the black goes at once; the black clears over the fade.
      for (const part of [flash, lidTop, lidBottom, barTop, barBottom, title, caption, skip]) {
        part.style.opacity = '0';
      }
      barTop.style.height = '0';
      barBottom.style.height = '0';
      black.style.transition = 'none';
      black.style.opacity = '1';
      last.black = 1;
      void black.offsetWidth;
      black.style.transition = `opacity ${fade}s ease-out`;
      black.style.opacity = '0';
      fadeTimer = window.setTimeout(
        () => {
          root.hidden = true;
          shown = false;
          black.style.transition = '';
        },
        fade * 1000 + 60,
      );
    },
    dispose() {
      window.clearTimeout(fadeTimer);
      root.remove();
      shown = false;
    },
  };
}
