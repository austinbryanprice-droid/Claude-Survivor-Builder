import { describe, expect, it } from 'vitest';
import { dbToGain, gainOfVolume, gainToDb, lerp, lerpLog, noteHz } from '../../src/shared/audio';

describe('noteHz', () => {
  it('puts A4 at 440 Hz and the other notes in equal temperament around it', () => {
    expect(noteHz('A4')).toBe(440);
    expect(noteHz('C4')).toBeCloseTo(261.6256, 3);
    expect(noteHz('D2')).toBeCloseTo(73.4162, 3);
    expect(noteHz('E4')).toBeCloseTo(329.6276, 3);
    expect(noteHz('D6')).toBeCloseTo(1174.659, 2);
    expect(noteHz('A0')).toBeCloseTo(27.5, 6);
  });

  it('doubles the pitch for each octave up and keeps the ratio of a semitone', () => {
    for (const letter of ['C', 'D', 'E', 'F', 'G', 'A', 'B']) {
      for (let octave = 1; octave < 6; octave++) {
        expect(noteHz(`${letter}${octave + 1}`) / noteHz(`${letter}${octave}`)).toBeCloseTo(2, 9);
      }
    }
    expect(noteHz('A#4') / noteHz('A4')).toBeCloseTo(2 ** (1 / 12), 9);
  });

  it('reads sharps and flats, which meet at the same pitch', () => {
    expect(noteHz('F#3')).toBeCloseTo(noteHz('Gb3'), 9);
    expect(noteHz('A#2')).toBeCloseTo(noteHz('Bb2'), 9);
    expect(noteHz('C#4')).toBeCloseTo(noteHz('Db4'), 9);
    expect(noteHz('F#3')).toBeGreaterThan(noteHz('F3'));
    expect(noteHz('Bb1')).toBeLessThan(noteHz('B1'));
  });

  it('refuses a name that is not a note, so that a typo in the score cannot play the wrong pitch', () => {
    for (const bad of ['', 'H4', 'a4', 'A', '4', 'A##4', 'A44', 'Cb', ' A4']) {
      expect(() => noteHz(bad)).toThrow(/Not a note name/);
    }
  });
});

describe('decibels', () => {
  it('turns decibels into a multiplier on the signal, 20 to a factor of ten', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(20)).toBeCloseTo(10, 12);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 12);
    expect(dbToGain(-6)).toBeCloseTo(0.5012, 4);
    expect(dbToGain(6)).toBeCloseTo(1.9953, 4);
  });

  it('goes back again, and silence is minus infinity', () => {
    for (const db of [-60, -24, -9.5, 0, 3, 12]) expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 9);
    expect(gainToDb(0)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('gainOfVolume', () => {
  it('is silent at 0 and full at 1, and squares what is between', () => {
    expect(gainOfVolume(0)).toBe(0);
    expect(gainOfVolume(1)).toBe(1);
    expect(gainOfVolume(0.5)).toBe(0.25);
    expect(gainToDb(gainOfVolume(0.5))).toBeCloseTo(-12.04, 2);
  });

  it('never goes up with a slider turned back, and never past the top', () => {
    let before = -1;
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const gain = gainOfVolume(v);
      expect(gain).toBeGreaterThanOrEqual(before);
      before = gain;
    }
    expect(gainOfVolume(7)).toBe(1);
    expect(gainOfVolume(-3)).toBe(0);
  });
});

describe('lerp and lerpLog', () => {
  it('lerp runs straight between its ends', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerp(5, -5, 0.5)).toBe(0);
  });

  it('lerpLog changes by the same ratio each step, so that a pitch glide sounds even', () => {
    expect(lerpLog(100, 400, 0)).toBe(100);
    expect(lerpLog(100, 400, 1)).toBeCloseTo(400, 9);
    expect(lerpLog(100, 400, 0.5)).toBeCloseTo(200, 9);
    expect(lerpLog(440, 880, 1 / 12)).toBeCloseTo(440 * 2 ** (1 / 12), 9);
    expect(lerpLog(8000, 500, 0.5)).toBeCloseTo(2000, 9);
  });
});
