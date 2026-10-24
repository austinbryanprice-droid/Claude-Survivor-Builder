import type { Game } from '../engine/game';
import { BUILD_KEYS } from './build-hud';
import { el, keycap } from './dom';

/**
 * The status panel at the bottom right of the reference HUD: the name of the area you are in and
 * a few key hints, including the camera toggle. It shows while the mouse is taken. In Build Mode
 * the hints are the keys of building instead.
 */

export interface StatusPanel {
  readonly element: HTMLElement;
  /** Brings the camera and graphics hints in line with the game. Call whenever either changes. */
  refresh(): void;
  /** Swaps the hints for the keys of Build Mode, and back. */
  setBuildMode(on: boolean): void;
}

const AREA_NAME = 'Ashbound Valley';

export function createStatusPanel(game: Game): StatusPanel {
  const root = el('aside', 'hud-panel status-panel');
  root.setAttribute('aria-label', 'Status');
  root.hidden = true;

  root.append(el('p', 'status-area', AREA_NAME));
  const mode = el('p', 'status-mode', 'Build Mode');
  mode.hidden = true;
  root.append(mode);
  const hints = el('ul', 'status-hints');
  const hint = (key: string, label: string): HTMLElement => {
    const item = el('li');
    const text = el('span', 'control-label', label);
    item.append(keycap(key), text);
    hints.append(item);
    return text;
  };
  const cameraHint = hint('V', '');
  const qualityHint = hint('P', '');
  hint('E', 'Strip debris');
  hint('F3', 'Frame times');
  hint('Esc', 'Free the mouse');
  root.append(hints);

  const buildHints = el('ul', 'status-hints');
  buildHints.hidden = true;
  for (const row of BUILD_KEYS) {
    const item = el('li');
    item.append(...row.keys.map(keycap), el('span', 'control-label', row.label));
    buildHints.append(item);
  }
  root.append(buildHints);

  const refresh = (): void => {
    cameraHint.textContent = game.rig.mode === 'first' ? 'First person' : 'Third person';
    const { name } = game.stage.quality;
    qualityHint.textContent = `Graphics: ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  };
  refresh();

  const setBuildMode = (on: boolean): void => {
    mode.hidden = !on;
    hints.hidden = on;
    buildHints.hidden = !on;
    root.toggleAttribute('data-build', on);
  };

  return { element: root, refresh, setBuildMode };
}
