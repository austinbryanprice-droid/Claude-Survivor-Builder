/**
 * The arithmetic of sound that the synth and the scores share, with nothing of the browser in it:
 * pitches, decibels, and how the volume slider maps to a gain. The Web Audio code that makes the
 * noises is the engine's (`engine/audio`); what plays when is the script's (`intro-sound.ts`).
 */

const SEMITONES: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** The frequency in Hz of a note named like `D4`, `F#3` or `Bb2` in equal temperament, with A4 at 440 Hz. */
export function noteHz(name: string): number {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!match) throw new Error(`Not a note name: "${name}"`);
  const [, letter, accidental, octave] = match as unknown as [string, string, string, string];
  const semitone =
    (SEMITONES[letter] as number) + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
  // MIDI note 69 is A4; C4 is 60.
  const midi = (Number(octave) + 1) * 12 + semitone;
  return 440 * 2 ** ((midi - 69) / 12);
}

/** The gain (a multiplier on the signal) that is `db` decibels louder than 1. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** The level of a gain in decibels; silence is -Infinity. */
export function gainToDb(gain: number): number {
  return 20 * Math.log10(gain);
}

/**
 * The gain the master volume asks for. The ear hears loudness on a curve, so the slider is squared:
 * halfway down the slider is about 12 dB quieter, not 6, and the quiet end has room to move.
 */
export function gainOfVolume(volume: number): number {
  const v = volume < 0 ? 0 : volume > 1 ? 1 : volume;
  return v * v;
}

/** Where a value lies between two others in a straight line, `share` 0 giving `from` and 1 giving `to`. */
export function lerp(from: number, to: number, share: number): number {
  return from + (to - from) * share;
}

/** The same, but along a curve that changes by the same ratio each second, the way pitch is heard. Both ends must be above zero. */
export function lerpLog(from: number, to: number, share: number): number {
  return from * (to / from) ** share;
}
