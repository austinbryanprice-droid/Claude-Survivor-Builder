import { CAPTIONS, type Caption } from '../../shared/intro';
import { NARRATION, fitRate, pickVoice, speakingSeconds } from '../../shared/narration';
import type { Speech } from '../speech';
import type { IntroNarrationPort } from './director';

/**
 * Speaks the film's captions as it plays. The film's clock is the only clock: every frame the
 * director tells this where the film is, and a line is begun when the film reaches its place. The
 * words are the browser's own speech, whose voice nobody here has heard, so the narrator works
 * from what it measures: how long the browser took to begin the line it asked for (the next is asked
 * for that much earlier), and how long the voice took to say it (the next is spoken faster or
 * slower to fit its place). A line is never cut off to make room for the next one; if a slow voice
 * is still at it when the next is due, the next waits, and is dropped when it is too late to be
 * worth saying. The captions are on the screen all the while, so a line that is not spoken is read.
 *
 * The browser is timed by the time the page was running, not the time that went by: a frame that
 * stalls for seconds (a shader compiling, a slow machine) is worth no more than a moment, as it is
 * to the film, because the browser's answers reach the page only between frames and a page that
 * was away did not hear them; without that, a long frame would read as a browser that had stopped.
 *
 * Nothing here is needed by the film: a browser that cannot or will not speak plays the film with
 * its captions, and says so once.
 */

/** Told of the voice starting and stopping, so that the film's music can step aside for it. */
export type SpeakingListener = (speaking: boolean) => void;

export interface NarratorOptions {
  readonly speech: Speech;
  /** The film's lines; the captions are what the film says. */
  readonly lines?: readonly Caption[];
  /** The loudness to speak a line at, 0 to 1, asked as each line begins. */
  readonly volume: () => number;
  /** The id of the voice the player chose, or '' for the best the browser has; asked as each line begins. */
  readonly voice: () => string;
  /** The player's language, for choosing among voices. */
  readonly language?: string;
  readonly onSpeaking?: SpeakingListener;
  /** Seconds on a clock that runs whatever the film does; the narrator times the browser by the time the page spent running on it (see `NARRATION.stall`). */
  readonly now?: () => number;
}

export interface NarrationStats {
  /** Lines the browser has begun to say. */
  spoken: number;
  /** Lines that were not said: the film moved past them while another was being said, or was moved on. */
  skipped: number;
  /** Lines the browser would not say. */
  failed: number;
  /** The rate the last line was asked for at. */
  rate: number;
  /** How long the voice takes against the estimate: 1 as guessed, 2 twice as slow. */
  speed: number;
  /** Seconds the browser takes to begin a line once asked, as measured. */
  lead: number;
  state: 'waiting' | 'speaking' | 'done';
}

export interface Narrator extends IntroNarrationPort {
  readonly stats: NarrationStats;
}

/** The line being asked for or said. */
interface Active {
  readonly line: Caption;
  readonly rate: number;
  /** What the estimate says the line takes at the voice's own pace. */
  readonly base: number;
  readonly askedAt: number;
  startedAt: number | null;
}

/** Errors that mean the browser is not going to speak at all, so that the rest of the film's lines are not even asked for. */
const REFUSALS = new Set([
  'not-allowed',
  'synthesis-unavailable',
  'audio-hardware',
  'service-not-allowed',
]);

const defaultNow = (): number => performance.now() / 1000;

export function createNarrator({
  speech,
  lines = CAPTIONS,
  volume,
  voice,
  language = typeof navigator === 'undefined' ? 'en-US' : navigator.language,
  onSpeaking,
  now = defaultNow,
}: NarratorOptions): Narrator {
  const stats: NarrationStats = {
    spoken: 0,
    skipped: 0,
    failed: 0,
    rate: 1,
    speed: 1,
    lead: NARRATION.lead,
    state: 'waiting',
  };
  let next = 0;
  let active: Active | null = null;
  let measured = false;
  let running = 0;
  let looked = now();
  /** No more lines will be asked for: the film was skipped or cut, or the browser will not speak. */
  let stopped = false;
  let reported = false;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;

  /** What the music has been told: it hears the voice begin and end, in turn, and never one twice. */
  let heard = false;
  const tell = (speaking: boolean): void => {
    if (speaking === heard) return;
    heard = speaking;
    try {
      onSpeaking?.(speaking);
    } catch (error) {
      // The music stepping aside is a courtesy too.
      console.error('The narrator could not tell the film’s sound to step aside.', error);
    }
  };

  /** Seconds the page has been running, counting no gap between two looks as more than a moment. */
  const pageTime = (): number => {
    const at = now();
    running += Math.min(NARRATION.stall, Math.max(0, at - looked));
    looked = at;
    return running;
  };

  const report = (what: string, error: unknown): void => {
    if (reported) return;
    reported = true;
    console.warn(`The intro's narrator ${what}; the film goes on with its captions.`, error);
  };

  /** The line is over, said or not: whoever was waiting on it can go. */
  const release = (line: Active): void => {
    if (active !== line) return;
    active = null;
    stats.state = stopped ? 'done' : 'waiting';
    // A last line that is over needs no cut-off timer.
    if (stopped && graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    tell(false);
  };

  const begin = (line: Caption, filmTime: number): void => {
    const base = speakingSeconds(line.text);
    const start = line.from + NARRATION.startAfter;
    const available = line.to - NARRATION.finishBefore - Math.max(filmTime, start);
    const rate = fitRate(base, available, stats.speed);
    const asked: Active = { line, rate, base, askedAt: pageTime(), startedAt: null };
    const voices = speech.voices();
    const chosen = pickVoice(voices, voice(), language);
    // A browser whose voices are all in other languages would read the film in an accent of its own: it keeps to its captions.
    if (!chosen && voices.length > 0) {
      stats.skipped++;
      stopped = true;
      stats.state = 'done';
      report('has no voice in English', `${voices.length} voices, none in English`);
      return;
    }
    active = asked;
    stats.rate = rate;
    try {
      speech.speak(
        {
          text: line.text,
          voice: chosen?.id ?? null,
          lang: chosen?.lang ?? 'en-US',
          rate,
          volume: Math.min(1, Math.max(0, volume())),
        },
        {
          start() {
            if (active !== asked) return;
            asked.startedAt = pageTime();
            stats.spoken++;
            stats.state = 'speaking';
            // The next line is asked for as much earlier as the browser takes to begin one.
            stats.lead = Math.min(0.8, Math.max(0, asked.startedAt - asked.askedAt));
            tell(true);
          },
          end() {
            if (active !== asked) return;
            if (asked.startedAt !== null) {
              const took = pageTime() - asked.startedAt;
              const observed = (took * asked.rate) / asked.base;
              // The first line is all there is to go on; after it each one moves the estimate part of the way.
              stats.speed = Math.min(
                2.5,
                Math.max(0.5, measured ? stats.speed * 0.4 + observed * 0.6 : observed),
              );
              measured = true;
            } else {
              // Said, though the browser never told when it began: there is nothing to learn from it.
              stats.spoken++;
            }
            release(asked);
          },
          error(reason, canceled) {
            if (active !== asked) return;
            if (!canceled) {
              stats.failed++;
              report(`could not say a line (${reason})`, reason);
              if (REFUSALS.has(reason)) stopped = true;
            }
            release(asked);
          },
        },
      );
    } catch (error) {
      stats.failed++;
      report('threw while asked to speak', error);
      stopped = true;
      release(asked);
    }
  };

  /** A browser that never begins a line, or never says it is over, must not hold up the rest. */
  const watch = (line: Active): void => {
    const at = pageTime();
    const waited =
      line.startedAt === null
        ? at - line.askedAt > NARRATION.startTimeout
        : at - line.startedAt > line.base * stats.speed * 2.5 + NARRATION.endSlack;
    if (!waited) return;
    stats.failed++;
    const neverBegan = line.startedAt === null;
    report('stopped answering', neverBegan ? 'never began' : 'never finished');
    speech.cancel();
    // A browser that would not begin a line will not begin the rest on time either: the film is left to its captions.
    if (neverBegan) stopped = true;
    release(line);
  };

  const stop = (): void => {
    if (graceTimer !== null) clearTimeout(graceTimer);
    graceTimer = null;
    stopped = true;
    if (active) {
      active = null;
      speech.cancel();
    }
    tell(false);
    stats.state = 'done';
  };

  return {
    stats,
    update(filmTime) {
      if (stopped) return;
      pageTime();
      if (active) watch(active);
      while (next < lines.length) {
        const line = lines[next] as Caption;
        const start = line.from + NARRATION.startAfter;
        if (filmTime < start - stats.lead) return;
        // The film has moved past this line (a seek, a stall), or not enough of its place is left to be worth saying.
        if (filmTime > start + NARRATION.lateAfter || line.to - filmTime < NARRATION.minLeft) {
          next++;
          stats.skipped++;
          continue;
        }
        // The last line is still being said: the next waits for it.
        if (active) return;
        next++;
        begin(line, filmTime);
        return;
      }
    },
    stop,
    finish() {
      if (stopped) return;
      // No more lines come, and the one that is being said is let finish, for a little while.
      stopped = true;
      if (active) {
        graceTimer = setTimeout(stop, NARRATION.finishGrace * 1000);
      } else {
        stats.state = 'done';
      }
    },
  };
}
