import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_LIMITS, sanitizeSettings } from '../../src/shared/settings';

describe('sanitizeSettings', () => {
  it('returns the defaults for anything that is not an object', () => {
    for (const raw of [undefined, null, 5, 'x', [], true]) {
      expect(sanitizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('keeps valid values', () => {
    expect(sanitizeSettings({ mouseSensitivity: 1.5, fov: 90, invertY: true })).toEqual({
      mouseSensitivity: 1.5,
      fov: 90,
      invertY: true,
    });
  });

  it('clamps out-of-range numbers and replaces broken fields one by one', () => {
    const result = sanitizeSettings({ mouseSensitivity: 99, fov: Number.NaN, invertY: 'yes' });
    expect(result.mouseSensitivity).toBe(SETTINGS_LIMITS.mouseSensitivity.max);
    expect(result.fov).toBe(DEFAULT_SETTINGS.fov);
    expect(result.invertY).toBe(DEFAULT_SETTINGS.invertY);
    expect(sanitizeSettings({ fov: 1 }).fov).toBe(SETTINGS_LIMITS.fov.min);
  });
});
