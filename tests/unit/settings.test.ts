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
        volume: 0.4,
      }),
    ).toEqual({
      mouseSensitivity: 1.5,
      fov: 90,
      invertY: true,
      quality: 'ultra',
      intro: false,
      volume: 0.4,
    });
  });

  it('starts at full volume, keeps the slider inside its range and replaces what is not a number', () => {
    expect(DEFAULT_SETTINGS.volume).toBe(1);
    expect(sanitizeSettings({}).volume).toBe(1);
    expect(sanitizeSettings({ volume: 0 }).volume).toBe(0);
    expect(sanitizeSettings({ volume: 0.55 }).volume).toBe(0.55);
    expect(sanitizeSettings({ volume: 7 }).volume).toBe(SETTINGS_LIMITS.volume.max);
    expect(sanitizeSettings({ volume: -2 }).volume).toBe(SETTINGS_LIMITS.volume.min);
    expect(sanitizeSettings({ volume: Number.NaN }).volume).toBe(DEFAULT_SETTINGS.volume);
    expect(sanitizeSettings({ volume: 'loud' }).volume).toBe(DEFAULT_SETTINGS.volume);
    expect(SETTINGS_LIMITS.volume).toEqual({ min: 0, max: 1, step: 0.05 });
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
