import type { RestartKind } from '../shared/survival-state';
import { el } from './dom';
import type { HudResults } from './run-hud';

/**
 * The card for a lost run, in the pause card's style: how long the crew held out, how the run
 * ended, what it came to and then the next step. Whoever hosts the run (or plays alone) chooses
 * Retry, the same valley and the same waves again, or New Run, another valley; everyone else in the
 * room sees who they are waiting for.
 */

export interface RunResultsPanel {
  readonly element: HTMLElement;
  /**
   * Draws the card for these results. `waitingFor` names the player who chooses the next run when
   * that is not this one, and is null when this player chooses. A card already drawn for the same
   * things is left as it is.
   */
  show(results: HudResults, waitingFor: string | null): void;
  /** The run is not over any more: forget the choice made on the card, so the next one starts fresh. */
  clear(): void;
}

/** A choice that has brought no new run after this long is given up, and the buttons come back. */
const STARTING_TIMEOUT_MS = 8000;

const CHOICES: readonly { readonly kind: RestartKind; readonly label: string }[] = [
  { kind: 'retry', label: 'Retry' },
  { kind: 'new', label: 'New Run' },
];

export function createRunResults(onChoose: (kind: RestartKind) => void): RunResultsPanel {
  const root = el('section', 'run-results');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Outpost Overrun');
  const card = el('div', 'hud-panel overrun-card');
  root.append(card);

  let drawn = '';
  let startedAt: number | null = null;
  let buttons: HTMLButtonElement[] = [];
  let hint: HTMLElement | null = null;
  let hintText = '';

  /** The buttons and the line under them, for a choice that is waiting on the new run or is not. */
  const sync = (): void => {
    const starting = startedAt !== null;
    for (const button of buttons) button.disabled = starting;
    if (hint) hint.textContent = starting ? 'Starting the next run…' : hintText;
  };

  const choose = (kind: RestartKind): void => {
    if (startedAt !== null) return;
    startedAt = performance.now();
    sync();
    onChoose(kind);
  };

  const tile = (value: string, label: string, className = 'stat'): HTMLElement => {
    const node = el('div', className);
    node.append(el('strong', undefined, value), el('span', undefined, label));
    return node;
  };

  const draw = (results: HudResults, waitingFor: string | null): void => {
    card.replaceChildren();
    buttons = [];
    hint = null;
    card.append(el('p', 'kicker', 'Ashbound Outpost'));
    card.append(el('h1', 'bad', 'Outpost Overrun'));
    card.append(el('p', 'lede', results.cause));

    const nights = results.nights;
    card.append(
      tile(String(nights), nights === 1 ? 'night survived' : 'nights survived', 'stat hero'),
    );
    const stats = el('div', 'stats');
    for (const { label, value } of results.stats) stats.append(tile(value, label));
    card.append(stats);

    hint = el('p', 'hint');
    hint.setAttribute('role', 'status');
    if (waitingFor === null) {
      const row = el('div', 'button-row');
      CHOICES.forEach(({ kind, label }, index) => {
        const button = el('button', index === 0 ? 'play-button' : 'quiet-button', label);
        button.type = 'button';
        button.dataset.kind = kind;
        button.addEventListener('click', () => choose(kind));
        buttons.push(button);
        row.append(button);
      });
      card.append(row);
      hintText = 'Retry plays the same valley and waves again. New Run builds a different valley.';
    } else {
      hintText = `Waiting for ${waitingFor} to start the next run.`;
    }
    card.append(hint);
    sync();
  };

  return {
    element: root,
    show(results, waitingFor) {
      const key = JSON.stringify([results, waitingFor]);
      if (key !== drawn) {
        drawn = key;
        draw(results, waitingFor);
        return;
      }
      if (startedAt !== null && performance.now() - startedAt > STARTING_TIMEOUT_MS) {
        startedAt = null;
        sync();
      }
    },
    clear() {
      drawn = '';
      startedAt = null;
    },
  };
}
