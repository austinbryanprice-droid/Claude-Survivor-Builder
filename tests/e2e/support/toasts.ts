import type { Page } from '@playwright/test';

/**
 * Records every message the HUD shows, from now on: a message stays up for under two seconds and a
 * frame can take longer than that, so a test that only looks now and then would miss it. Messages
 * the game sets in one go collapse into the last of them, as they do on the screen. Read them back
 * with `toasts`.
 */
export const recordToasts = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __toasts: string[] }).__toasts = seen;
    const toast = document.querySelector('.toast');
    if (!toast) throw new Error('there is no toast element');
    let last = '';
    new MutationObserver(() => {
      const text = toast.textContent ?? '';
      if (toast.classList.contains('on') && text !== '' && text !== last) seen.push(text);
      last = toast.classList.contains('on') ? text : '';
    }).observe(toast, { attributes: true, childList: true, characterData: true, subtree: true });
  });

/** Every message `recordToasts` has seen on the page, oldest first. */
export const toasts = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as unknown as { __toasts: string[] }).__toasts]);
