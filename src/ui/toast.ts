import { el } from './dom';

/** A short message that fades out, for key presses that change something and for what happens in the run. */
export interface Toast {
  readonly element: HTMLElement;
  /** Shows the message at once, in place of the one showing and any that wait. */
  show(text: string): void;
  /** Shows the message when the ones before it have had their turn: several things happen at one dawn. */
  queue(text: string): void;
  dispose(): void;
}

const SHOWN_MS = 1600;
/** The most messages that wait; the oldest are dropped, so a busy night never leaves the screen behind. */
const MAX_WAITING = 3;

export function createToast(): Toast {
  const element = el('div', 'toast');
  element.setAttribute('role', 'status');
  const waiting: string[] = [];
  let showing = false;
  let timer = 0;

  /** Shows the message that has waited longest, or clears the toast when none is left. */
  function next(): void {
    const text = waiting.shift();
    if (text === undefined) {
      showing = false;
      element.classList.remove('on');
      return;
    }
    showing = true;
    element.textContent = text;
    element.classList.add('on');
    timer = window.setTimeout(next, SHOWN_MS);
  }

  return {
    element,
    show(text) {
      window.clearTimeout(timer);
      waiting.length = 0;
      waiting.push(text);
      next();
    },
    queue(text) {
      waiting.push(text);
      while (waiting.length > MAX_WAITING) waiting.shift();
      if (!showing) next();
    },
    dispose() {
      window.clearTimeout(timer);
      element.remove();
    },
  };
}
