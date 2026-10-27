/**
 * What the intro film's narrator works from, with nothing of the browser in it: how long a line
 * takes to say, how fast to say it so that it fits its place in the film, and which of the voices
 * a browser offers is the best one to say it with. The film's words are its captions
 * (`intro.ts`); the narrator (`engine/intro/narration.ts`) speaks them through the browser's own
 * speech (`engine/speech.ts`), so every number here is a guess at a voice nobody has heard yet and
 * the narrator corrects it as it listens.
 */
import { dbToGain } from './audio';
import { CAPTIONS } from './intro';

export const NARRATION = {
  /** Seconds after a caption starts to appear that its first word should sound: the text is half in by then. */
  startAfter: 0.15,
  /** Seconds before a caption's end by which its last word should be said. */
  finishBefore: 0.2,
  /** The slowest and the fastest a line is spoken, as a multiple of the voice's own pace: slower is grave, faster is hard to follow. */
  rateMin: 0.9,
  rateMax: 1.3,
  /** The share of its place a line is meant to fill when the voice is told how fast to go. */
  fill: 0.95,
  /** Seconds past its moment that a line may still be started: after that the film has moved on without it (a stall, a seek) and it is dropped. */
  lateAfter: 1,
  /** A line with less than this left of its place is not started. */
  minLeft: 1,
  /** Seconds a browser is given to begin a line, and the allowance on top of its length before one that never says it is over is taken as over. */
  startTimeout: 4,
  endSlack: 4,
  /** Seconds a line that is still being spoken when the film ends is let run, before it is cut. */
  finishGrace: 3,
  /** The first guess at how long a browser takes between being asked and speaking, which the narrator learns as it goes. */
  lead: 0.12,
  /**
   * The most that a gap between two looks at the clock counts for, in seconds. A page that was
   * stalled (a long frame, a shader compiling) heard nothing from the browser either, however long
   * it took to come back, so what the narrator times the browser by is the time the page was
   * running, as the film's own clock is: no frame is worth more than this.
   */
  stall: 0.1,
  /** The film's sound while the narrator speaks: this many decibels down, arriving over `duckAttack` seconds and coming back over `duckRelease`. */
  duckDb: -7,
  duckAttack: 0.12,
  duckRelease: 0.6,
} as const;

/** The gain the film's sound is brought down to while the narrator speaks. */
export const DUCK_GAIN = dbToGain(NARRATION.duckDb);

const SECONDS_PER_WORD = 0.38;
const SENTENCE_PAUSE = 0.25;
const CLAUSE_PAUSE = 0.12;

/** How many words `text` has. */
export function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}

/**
 * How long a voice at its own pace takes to say `text`, in seconds: about 160 words a minute, with
 * a breath at each full stop and a smaller one at each comma. It is a guess that real voices put
 * right (`Narrator` keeps a factor for the one it has).
 */
export function speakingSeconds(text: string): number {
  const sentences = text.match(/[.!?…]+(?=\s|$)/g)?.length ?? 0;
  const clauses = text.match(/[,;:—–]/g)?.length ?? 0;
  return wordCount(text) * SECONDS_PER_WORD + sentences * SENTENCE_PAUSE + clauses * CLAUSE_PAUSE;
}

/**
 * The rate to give a voice so that `seconds` of speech (at its own pace, times `speed`, how slow or
 * fast this voice has turned out to be) fill `available` seconds, kept inside what sounds like a
 * person.
 */
export function fitRate(seconds: number, available: number, speed = 1): number {
  if (!(available > 0)) return NARRATION.rateMax;
  const rate = (seconds * speed) / (available * NARRATION.fill);
  return Math.min(NARRATION.rateMax, Math.max(NARRATION.rateMin, rate));
}

/** What the page's player is told of a voice, and what is kept to find it again. */
export interface VoiceInfo {
  /** What the browser calls it, which holds between visits: the player's choice is kept as this. */
  readonly id: string;
  readonly name: string;
  /** The language tag, like `en-GB`. */
  readonly lang: string;
  /** True when the voice runs on this machine; false when the browser sends the words to a service. */
  readonly local: boolean;
  /** The browser's own pick for the page's language. */
  readonly isDefault: boolean;
}

/** Voices that exist to amuse (some systems list them among the real ones), which no one wants reading the story. */
const NOVELTY =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|fred|good news|hysterical|jester|junior|kathy|organ|princess|ralph|superstar|trinoids|whisper|wobble|zarvox)\b/i;

/** Names of voices that are plainly good: the browsers' own neural voices, and the ones systems have long shipped. */
const WELL_KNOWN =
  /\b(alex|daniel|samantha|karen|moira|tessa|oliver|serena|kate|jenny|aria|guy|ryan)\b/i;

/** How good a voice is for reading the film, or null when it is not one to offer (not English, or a novelty). */
export function voiceScore(voice: VoiceInfo, language = 'en-US'): number | null {
  const lang = voice.lang.replace('_', '-').toLowerCase();
  if (lang !== 'en' && !lang.startsWith('en-')) return null;
  if (NOVELTY.test(voice.name)) return null;
  const name = voice.name.toLowerCase();
  let score = 0;
  if (/natural|neural/.test(name)) score += 100;
  if (/premium|siri/.test(name)) score += 70;
  else if (/enhanced/.test(name)) score += 50;
  if (name.includes('google')) score += 40;
  if (name.includes('microsoft')) score += 15;
  if (WELL_KNOWN.test(name)) score += 25;
  if (/espeak|festival|compact/.test(name)) score -= 30;
  score += lang === 'en-us' || lang === 'en-gb' ? 6 : lang === 'en' ? 2 : 3;
  // The player's own English is the one they are used to.
  if (lang === language.replace('_', '-').toLowerCase()) score += 8;
  if (voice.isDefault) score += 3;
  if (voice.local) score += 2;
  return score;
}

/** The English voices worth offering, best first (ties in name order, so the order never depends on the browser's). */
export function rankVoices(voices: readonly VoiceInfo[], language = 'en-US'): VoiceInfo[] {
  const scored: { voice: VoiceInfo; score: number }[] = [];
  for (const voice of voices) {
    const score = voiceScore(voice, language);
    if (score !== null) scored.push({ voice, score });
  }
  scored.sort((a, b) => b.score - a.score || a.voice.name.localeCompare(b.voice.name));
  return scored.map((entry) => entry.voice);
}

/**
 * The voice to speak with: the one the player chose, if the browser still has it, and otherwise the
 * best English one; null when there is none, which is a film with captions alone.
 */
export function pickVoice(
  voices: readonly VoiceInfo[],
  chosen: string,
  language = 'en-US',
): VoiceInfo | null {
  if (chosen !== '') {
    const kept = voices.find((voice) => voice.id === chosen);
    if (kept) return kept;
  }
  return rankVoices(voices, language)[0] ?? null;
}

/** A line to hear a voice say, for the pause card's button: the film's last words. */
export const SAMPLE_LINE: string = CAPTIONS[CAPTIONS.length - 1]?.text ?? 'Hold the line.';
