import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../shared/settings';

const STORAGE_KEY = 'ashbound.settings.v1';

/** Reads saved preferences; storage can be unavailable (private windows, blocked cookies), so any failure means defaults. */
export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not being able to remember a preference is not worth interrupting play for.
  }
}
