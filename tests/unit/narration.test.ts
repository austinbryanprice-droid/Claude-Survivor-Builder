import { describe, expect, it } from 'vitest';
import { dbToGain } from '../../src/shared/audio';
import { CAPTIONS, SCENES, sceneAt } from '../../src/shared/intro';
import {
  DUCK_GAIN,
  NARRATION,
  SAMPLE_LINE,
  fitRate,
  pickVoice,
  rankVoices,
  speakingSeconds,
  voiceScore,
  wordCount,
  type VoiceInfo,
} from '../../src/shared/narration';

const voice = (name: string, lang = 'en-US', extra: Partial<VoiceInfo> = {}): VoiceInfo => ({
  id: name,
  name,
  lang,
  local: true,
  isDefault: false,
  ...extra,
});

describe('how long a line takes to say', () => {
  it('counts words the way a listener would', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('   ')).toBe(0);
    expect(wordCount('Wake up.')).toBe(2);
    expect(wordCount("Vesper's machines — all of them, 12 in all.")).toBe(8);
    expect(wordCount('well-known voices')).toBe(2);
  });

  it('takes longer for more words, and a breath at each full stop and comma', () => {
    const plain = speakingSeconds('We mean to keep it');
    expect(plain).toBeGreaterThan(1);
    expect(speakingSeconds('We mean to keep it.')).toBeGreaterThan(plain);
    expect(speakingSeconds('We mean to keep it. We mean to keep it.')).toBeGreaterThan(plain * 2);
    expect(speakingSeconds('We mean, to keep it.')).toBeGreaterThan(
      speakingSeconds('We mean to keep it.'),
    );
    expect(speakingSeconds('')).toBe(0);
  });

  it('is about a hundred and sixty words a minute for plain prose', () => {
    const prose = 'one two three four five six seven eight nine ten';
    expect(speakingSeconds(prose)).toBeCloseTo(3.8, 6);
    expect(wordCount(prose) / (speakingSeconds(prose) / 60)).toBeGreaterThan(140);
    expect(wordCount(prose) / (speakingSeconds(prose) / 60)).toBeLessThan(180);
  });
});

describe('the rate that makes a line fit its place', () => {
  it('is the pace that fills most of the place, and 1 when that is the voice’s own', () => {
    // 3 seconds of speech in a 3.2 second place: 3 / (3.2 * fill).
    expect(fitRate(3, 3.2)).toBeCloseTo(3 / (3.2 * NARRATION.fill), 9);
    // A voice twice as slow as the estimate needs to go twice as fast.
    expect(fitRate(1.5, 3, 2)).toBeCloseTo(fitRate(3, 3), 9);
  });

  it('stays inside what sounds like a person, whatever the place', () => {
    expect(fitRate(10, 1)).toBe(NARRATION.rateMax);
    expect(fitRate(0.2, 30)).toBe(NARRATION.rateMin);
    expect(fitRate(3, 0)).toBe(NARRATION.rateMax);
    expect(fitRate(3, -2)).toBe(NARRATION.rateMax);
    expect(fitRate(3, Number.NaN)).toBe(NARRATION.rateMax);
    for (let seconds = 0.5; seconds < 8; seconds += 0.37) {
      for (let place = 0.4; place < 9; place += 0.43) {
        const rate = fitRate(seconds, place);
        expect(rate).toBeGreaterThanOrEqual(NARRATION.rateMin);
        expect(rate).toBeLessThanOrEqual(NARRATION.rateMax);
      }
    }
  });
});

describe('the lines of the film against the voice that will say them', () => {
  /** The seconds a caption leaves for its words: from the first word's moment to the last word's. */
  const placeOf = (caption: (typeof CAPTIONS)[number]): number =>
    caption.to - NARRATION.finishBefore - (caption.from + NARRATION.startAfter);

  it('gives every line a place it can be said in without hurrying, by a voice that is as quick as the estimate', () => {
    for (const caption of CAPTIONS) {
      const base = speakingSeconds(caption.text);
      const rate = fitRate(base, placeOf(caption));
      expect(rate, caption.text).toBeLessThanOrEqual(NARRATION.rateMax);
      // At that rate the words are done inside the place.
      expect(base / rate, caption.text).toBeLessThanOrEqual(placeOf(caption) + 1e-9);
    }
  });

  it('never needs the fastest rate except for the one line that is long for its place', () => {
    const rushed = CAPTIONS.filter(
      (caption) => fitRate(speakingSeconds(caption.text), placeOf(caption)) >= NARRATION.rateMax,
    );
    expect(rushed.length).toBeLessThanOrEqual(1);
  });

  it('puts a rest between one line and the next, so that the voice breathes', () => {
    for (let i = 1; i < CAPTIONS.length; i++) {
      const before = CAPTIONS[i - 1];
      const line = CAPTIONS[i];
      if (!before || !line) throw new Error('lines are missing');
      expect(line.from - before.to, line.text).toBeGreaterThanOrEqual(0.25);
    }
  });

  it('starts a line only when its caption is up and ends before the scene does', () => {
    for (const caption of CAPTIONS) {
      const scene = sceneAt(caption.from);
      expect(caption.from + NARRATION.startAfter).toBeLessThan(caption.to);
      expect(caption.to).toBeLessThanOrEqual(scene.to);
      expect(SCENES).toContain(scene);
    }
  });
});

describe('the music stepping down for the voice', () => {
  it('is a few decibels, not a silence', () => {
    expect(NARRATION.duckDb).toBeLessThan(-3);
    expect(NARRATION.duckDb).toBeGreaterThan(-15);
    expect(DUCK_GAIN).toBeCloseTo(dbToGain(NARRATION.duckDb), 9);
    expect(DUCK_GAIN).toBeLessThan(1);
    expect(DUCK_GAIN).toBeGreaterThan(0.2);
  });

  it('goes down fast and comes back slowly, so that the first word is clear and the music returns gently', () => {
    expect(NARRATION.duckAttack).toBeLessThan(0.3);
    expect(NARRATION.duckRelease).toBeGreaterThan(NARRATION.duckAttack * 2);
  });
});

describe('which voice to speak with', () => {
  const natural = voice('Microsoft Aria Online (Natural) - English (United States)', 'en-US', {
    local: false,
  });
  const google = voice('Google UK English Male', 'en-GB', { local: false });
  const alex = voice('Alex', 'en-US', { isDefault: true });
  const espeak = voice('English (America) espeak', 'en-US');
  const novelty = voice('Zarvox', 'en-US');
  const french = voice('Thomas', 'fr-FR');
  const german = voice('Anna', 'de-DE', { isDefault: true });

  it('offers only English, and no novelty voices', () => {
    expect(voiceScore(french)).toBeNull();
    expect(voiceScore(german)).toBeNull();
    expect(voiceScore(novelty)).toBeNull();
    expect(voiceScore(voice('Bad News'))).toBeNull();
    expect(voiceScore(voice('Whisper'))).toBeNull();
    expect(voiceScore(alex)).not.toBeNull();
    expect(voiceScore(voice('Generic', 'en'))).not.toBeNull();
    // Some systems write the tag with an underscore.
    expect(voiceScore(voice('Daniel', 'en_GB'))).not.toBeNull();
    expect(voiceScore(voice('Dutch', 'enx'))).toBeNull();
  });

  it('puts the natural voices first, then the good ones systems ship, and the robotic ones last', () => {
    const order = rankVoices([espeak, alex, google, french, natural, novelty]);
    expect(order.map((v) => v.name)).toEqual([natural.name, google.name, alex.name, espeak.name]);
  });

  it('prefers the player’s own English, and the browser’s own pick, when the voices are otherwise alike', () => {
    const us = voice('Plain', 'en-US');
    const gb = voice('Plain', 'en-GB');
    expect(rankVoices([gb, us], 'en-US')[0]).toBe(us);
    expect(rankVoices([us, gb], 'en-GB')[0]).toBe(gb);
    const chosenByBrowser = voice('Other', 'en-US', { isDefault: true });
    const unchosen = voice('Other', 'en-US', { id: 'Other-2' });
    expect(rankVoices([unchosen, chosenByBrowser])[0]).toBe(chosenByBrowser);
  });

  it('lists the same voices in the same order whatever order the browser gives them', () => {
    const voices = [espeak, alex, google, natural, voice('Zed'), voice('Amy')];
    const forward = rankVoices(voices).map((v) => v.id);
    const backward = rankVoices([...voices].reverse()).map((v) => v.id);
    expect(backward).toEqual(forward);
  });

  it('keeps the voice the player chose while the browser still has it, and the best otherwise', () => {
    const voices = [alex, natural, espeak];
    expect(pickVoice(voices, '')).toBe(natural);
    expect(pickVoice(voices, espeak.id)).toBe(espeak);
    // A voice the browser lost (another machine, an update) falls back to the best, not to silence.
    expect(pickVoice(voices, 'Gone Voice')).toBe(natural);
    // A player's pick of a voice outside the ranking is theirs to make.
    expect(pickVoice([...voices, french], french.id)).toBe(french);
  });

  it('is null when the browser has no English voice, which is a film with captions alone', () => {
    expect(pickVoice([], '')).toBeNull();
    expect(pickVoice([french, german], '')).toBeNull();
    expect(pickVoice([], 'Alex')).toBeNull();
    expect(rankVoices([])).toEqual([]);
  });
});

describe('the sample line', () => {
  it('is the film’s last words, so that “Hear it” is a taste of the narration', () => {
    expect(SAMPLE_LINE).toBe(CAPTIONS[CAPTIONS.length - 1]?.text);
    expect(SAMPLE_LINE.length).toBeGreaterThan(8);
  });
});
