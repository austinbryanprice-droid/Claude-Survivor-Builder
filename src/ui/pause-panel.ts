import type { Game } from '../engine/game';
import { SETTINGS_LIMITS } from '../shared/settings';
import { el, keycap } from './dom';
import { saveSettings } from './settings-store';

/**
 * The screen shown whenever the mouse is free: how to play, a few preferences and a big button.
 * Browsers only allow pointer lock after a click, so this doubles as the "click to play" prompt.
 */

export interface PausePanel {
  readonly element: HTMLElement;
  /** Updates the hint line (for example after the browser refused the mouse). */
  refresh(): void;
}

interface Control {
  keys: string[];
  label: string;
}

const CONTROLS: Control[] = [
  { keys: ['W', 'A', 'S', 'D'], label: 'Move' },
  { keys: ['Space'], label: 'Jump (hold to keep hopping)' },
  { keys: ['Shift'], label: 'Sprint' },
  { keys: ['V', 'F5'], label: 'First or third person' },
  { keys: ['F3'], label: 'Frame times' },
  { keys: ['Esc'], label: 'Free the mouse' },
];

export function createPausePanel(game: Game, buildId: string): PausePanel {
  const root = el('section', 'pause');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Paused');

  const card = el('div', 'hud-panel pause-card');
  card.append(el('p', 'kicker', 'Ashbound Outpost'));
  card.append(el('h1', undefined, 'Click to play'));
  card.append(
    el(
      'p',
      'lede',
      'A walled test deck for running, jumping and climbing. The real world arrives in the next phases.',
    ),
  );

  const button = el('button', 'play-button', 'Play');
  button.type = 'button';
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    game.input.requestLock();
  });
  card.append(button);

  const hint = el('p', 'hint');
  hint.setAttribute('role', 'status');
  card.append(hint);

  const controls = el('ul', 'controls');
  for (const { keys, label } of CONTROLS) {
    const item = el('li');
    const caps = el('span', 'caps');
    keys.forEach((key) => caps.append(keycap(key)));
    item.append(caps, el('span', 'control-label', label));
    controls.append(item);
  }
  card.append(controls);

  const settingsBlock = el('div', 'settings');
  const slider = (
    label: string,
    key: 'mouseSensitivity' | 'fov',
    format: (value: number) => string,
  ): void => {
    const { min, max, step } = SETTINGS_LIMITS[key];
    const row = el('label', 'setting');
    const input = el('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(game.settings[key]);
    const value = el('output', undefined, format(game.settings[key]));
    input.addEventListener('input', () => {
      const next = Number(input.value);
      game.settings[key] = next;
      value.textContent = format(next);
      saveSettings(game.settings);
    });
    row.append(el('span', undefined, label), input, value);
    settingsBlock.append(row);
  };
  slider('Mouse sensitivity', 'mouseSensitivity', (v) => `${v.toFixed(2)}x`);
  slider('Field of view', 'fov', (v) => `${Math.round(v)}°`);

  const invert = el('label', 'setting toggle');
  const invertBox = el('input');
  invertBox.type = 'checkbox';
  invertBox.checked = game.settings.invertY;
  invertBox.addEventListener('change', () => {
    game.settings.invertY = invertBox.checked;
    saveSettings(game.settings);
  });
  invert.append(invertBox, el('span', undefined, 'Invert vertical look'));
  settingsBlock.append(invert);
  card.append(settingsBlock);

  card.append(el('p', 'footnote', `Build ${buildId}`));
  root.append(card);

  // Any click counts as "click to play", except on the settings, which are for clicking.
  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.settings')) return;
    game.input.requestLock();
  });

  const refresh = (): void => {
    hint.textContent = game.input.blocked
      ? 'The browser did not hand over the mouse. Wait a moment, then click Play again.'
      : 'Esc frees the mouse at any time. F5 will not reload the page while you are playing.';
    hint.classList.toggle('warn', game.input.blocked);
  };
  refresh();

  return { element: root, refresh };
}
