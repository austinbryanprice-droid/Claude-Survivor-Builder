import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  NARRATOR_ID_MAX,
  SETTINGS_LIMITS,
  sanitizeSettings,
} from '../../src/shared/settings';

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
        narration: false,
        narrator: 'Google UK English Male',
      }),
    ).toEqual({
      mouseSensitivity: 1.5,
      fov: 90,
      invertY: true,
      quality: 'ultra',
      intro: false,
      volume: 0.4,
      narration: false,
      narrator: 'Google UK English Male',
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

  it('has the film’s narrator speak unless the player turned it off, with the browser’s best voice', () => {
    expect(DEFAULT_SETTINGS.narration).toBe(true);
    expect(DEFAULT_SETTINGS.narrator).toBe('');
    expect(sanitizeSettings({}).narration).toBe(true);
    expect(sanitizeSettings({ narration: false }).narration).toBe(false);
    expect(sanitizeSettings({ narration: 'no' }).narration).toBe(true);
    expect(sanitizeSettings({ narration: 0 }).narration).toBe(true);
  });

  it('keeps the voice a player chose as long as it is a plausible name, and otherwise the automatic choice', () => {
    expect(sanitizeSettings({ narrator: 'Daniel' }).narrator).toBe('Daniel');
    expect(sanitizeSettings({ narrator: '' }).narrator).toBe('');
    expect(sanitizeSettings({ narrator: 'x'.repeat(NARRATOR_ID_MAX) }).narrator).toHaveLength(
      NARRATOR_ID_MAX,
    );
    // What storage hands back is whatever anyone put there.
    expect(sanitizeSettings({ narrator: 'x'.repeat(NARRATOR_ID_MAX + 1) }).narrator).toBe('');
    expect(sanitizeSettings({ narrator: 7 }).narrator).toBe('');
    expect(sanitizeSettings({ narrator: { name: 'Daniel' } }).narrator).toBe('');
    expect(sanitizeSettings({ narrator: null }).narrator).toBe('');
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
