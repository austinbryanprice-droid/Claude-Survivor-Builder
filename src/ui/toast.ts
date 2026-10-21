import { el } from './dom';

/** A short message that fades out, for key presses that change something. */
export interface Toast {
  readonly element: HTMLElement;
  show(text: string): void;
  dispose(): void;
}

const SHOWN_MS = 1600;

export function createToast(): Toast {
  const element = el('div', 'toast');
  element.setAttribute('role', 'status');
  let timer = 0;
  return {
    element,
    show(text) {
      element.textContent = text;
      element.classList.add('on');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => element.classList.remove('on'), SHOWN_MS);
    },
    dispose() {
      window.clearTimeout(timer);
      element.remove();
    },
  };
}
