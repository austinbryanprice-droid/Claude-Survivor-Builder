import { TITLE } from '../shared/title';
import { el } from './dom';
import './title-screen.css';

/**
 * What the game opens on: the valley behind the name of the game and one large Play button. It
 * draws the words and says when Play was pressed; the controller (`app/title.ts`) decides what
 * follows.
 */
export interface TitleScreen {
  readonly element: HTMLElement;
  /** Called by a click on Play, or Enter or Space on it, while the gesture the browser wants for the mouse is still on the stack. */
  onPlay(listener: () => void): () => void;
  /**
   * Starts to leave: the words fade out and, with `black`, the picture fades to black over
   * `seconds` as well, for a film to open out of. The screen takes no clicks from here on.
   */
  leave(black: boolean, seconds: number): void;
  /** Brings the words back and clears the black: Play did not get the mouse, and the screen waits for another. */
  restore(): void;
  /** Says why Play did not work, under the button; null clears it. */
  setHint(text: string | null): void;
  /** Takes the screen off the page. */
  hide(): void;
  readonly shown: boolean;
  dispose(): void;
}

export function createTitleScreen(): TitleScreen {
  const root = el('main', 'title');
  root.setAttribute('aria-label', TITLE.name);
  root.dataset.leaving = 'no';

  const scrim = el('div', 'title-scrim');
  const card = el('div', 'title-card');
  const name = el('h1', 'title-name', TITLE.name);
  const rule = el('div', 'title-rule');
  rule.append(el('i'));
  const tagline = el('p', 'title-tagline', TITLE.tagline);
  const play = el('button', 'title-play', TITLE.play);
  play.type = 'button';
  const hint = el('p', 'title-hint');
  hint.setAttribute('role', 'status');
  card.append(name, rule, tagline, play, hint);
  const veil = el('div', 'title-veil');
  for (const decoration of [scrim, rule, veil]) decoration.setAttribute('aria-hidden', 'true');
  root.append(scrim, card, veil);
  document.body.append(root);

  const listeners = new Set<() => void>();
  play.addEventListener('click', (event) => {
    event.stopPropagation();
    if (root.dataset.leaving !== 'no') return;
    listeners.forEach((listener) => listener());
  });

  let shown = true;
  return {
    element: root,
    get shown() {
      return shown;
    },
    onPlay(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    leave(black, seconds) {
      root.style.setProperty('--title-lead', `${seconds}s`);
      root.dataset.leaving = black ? 'black' : 'words';
    },
    restore() {
      root.dataset.leaving = 'no';
    },
    setHint(text) {
      hint.textContent = text ?? '';
      hint.classList.toggle('warn', text !== null);
    },
    hide() {
      root.hidden = true;
      shown = false;
    },
    dispose() {
      listeners.clear();
      root.remove();
      shown = false;
    },
  };
}
