import type { Game } from '../engine/game';
import { el, keycap } from './dom';

/**
 * The status panel at the bottom right of the reference HUD: the name of the area you are in and
 * a few key hints, including the camera toggle. It shows while the mouse is taken.
 */

export interface StatusPanel {
  readonly element: HTMLElement;
  /** Brings the camera hint in line with the current view. Call whenever the view switches. */
  refresh(): void;
}

const AREA_NAME = 'Proving ground';

export function createStatusPanel(game: Game): StatusPanel {
  const root = el('aside', 'hud-panel status-panel');
  root.setAttribute('aria-label', 'Status');
  root.hidden = true;

  root.append(el('p', 'status-area', AREA_NAME));
  const hints = el('ul', 'status-hints');
  const hint = (key: string, label: string): HTMLElement => {
    const item = el('li');
    const text = el('span', 'control-label', label);
    item.append(keycap(key), text);
    hints.append(item);
    return text;
  };
  const cameraHint = hint('V', '');
  hint('F3', 'Frame times');
  hint('Esc', 'Free the mouse');
  root.append(hints);

  const refresh = (): void => {
    cameraHint.textContent = game.rig.mode === 'first' ? 'First person' : 'Third person';
  };
  refresh();

  return { element: root, refresh };
}
