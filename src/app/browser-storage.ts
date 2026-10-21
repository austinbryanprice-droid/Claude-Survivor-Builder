import type { KeyValueStore } from '../net/lobby';

/**
 * A key-value store over `localStorage` or `sessionStorage` that never throws: private windows,
 * blocked site data and full quotas all just mean the page forgets what it was told.
 */
export function browserStore(pick: () => Storage): KeyValueStore {
  return {
    get(key) {
      try {
        return pick().getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        pick().setItem(key, value);
      } catch {
        // Nothing to do: the next page load starts fresh.
      }
    },
  };
}
