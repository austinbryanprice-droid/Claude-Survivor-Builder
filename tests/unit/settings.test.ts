import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_LIMITS, sanitizeSettings } from '../../src/shared/settings';

describe('sanitizeSettings', () => {
  it('returns the defaults for anything that is not an object', () => {
    for (const raw of [undefined, null, 5, 'x', [], true]) {
      expect(sanitizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('keeps valid values', () => {
    expect(
      sanitizeSettings({
        mouseSensitivity: 1.5,
        fov: 90,
        invertY: true,
        quality: 'ultra',
        intro: false,
      }),
    ).toEqual({
      mouseSensitivity: 1.5,
      fov: 90,
      invertY: true,
      quality: 'ultra',
      intro: false,
    });
  });

  it('plays the intro unless the player turned it off', () => {
    expect(DEFAULT_SETTINGS.intro).toBe(true);
    expect(sanitizeSettings({}).intro).toBe(true);
    expect(sanitizeSettings({ intro: false }).intro).toBe(false);
    expect(sanitizeSettings({ intro: 'no' }).intro).toBe(true);
  });

  it('only keeps a graphics preset that exists', () => {
    expect(sanitizeSettings({ quality: 'low' }).quality).toBe('low');
    expect(sanitizeSettings({ quality: 'extreme' }).quality).toBe(DEFAULT_SETTINGS.quality);
    expect(sanitizeSettings({ quality: 3 }).quality).toBe(DEFAULT_SETTINGS.quality);
    expect(sanitizeSettings({}).quality).toBe(DEFAULT_SETTINGS.quality);
  });

  it('clamps out-of-range numbers and replaces broken fields one by one', () => {
    const result = sanitizeSettings({ mouseSensitivity: 99, fov: Number.NaN, invertY: 'yes' });
    expect(result.mouseSensitivity).toBe(SETTINGS_LIMITS.mouseSensitivity.max);
    expect(result.fov).toBe(DEFAULT_SETTINGS.fov);
    expect(result.invertY).toBe(DEFAULT_SETTINGS.invertY);
    expect(sanitizeSettings({ fov: 1 }).fov).toBe(SETTINGS_LIMITS.fov.min);
  });
});
