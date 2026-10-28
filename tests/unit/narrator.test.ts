import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNarrator, type NarratorOptions } from '../../src/engine/intro/narration';
import type { SpeakEvents, SpeakRequest, Speech } from '../../src/engine/speech';
import { CAPTIONS, INTRO_SECONDS, type Caption } from '../../src/shared/intro';
import { NARRATION, fitRate, speakingSeconds, type VoiceInfo } from '../../src/shared/narration';

interface Asked {
  readonly request: SpeakRequest;
  readonly events: SpeakEvents;
  /** The narrator's clock when the line was asked for. */
  readonly at: number;
}

/** A browser's speech that says nothing: it keeps what it was asked and lets the test play the part of the voice. */
class FakeSpeech implements Speech {
  list: VoiceInfo[] = [];
  readonly asked: Asked[] = [];
  cancels = 0;
  warms = 0;
  disposed = false;
  failToSpeak: Error | null = null;
  onAsk: ((asked: Asked) => void) | null = null;

  constructor(private readonly clock: () => number) {}

  voices(): readonly VoiceInfo[] {
    return this.list;
  }

  onVoices(): () => void {
    return () => undefined;
  }

  speak(request: SpeakRequest, events: SpeakEvents): void {
    if (this.failToSpeak) throw this.failToSpeak;
    const asked = { request, events, at: this.clock() };
    this.asked.push(asked);
    this.onAsk?.(asked);
  }

  cancel(): void {
    this.cancels++;
  }

  warm(): void {
    this.warms++;
  }

  dispose(): void {
    this.disposed = true;
  }
}

function rig(options: Partial<NarratorOptions> = {}) {
  let clock = 100;
  let film = 0;
  const speech = new FakeSpeech(() => clock);
  const heard: boolean[] = [];
  const volume = vi.fn(() => 1);
  const voice = vi.fn(() => '');
  const narrator = createNarrator({
    speech,
    volume,
    voice,
    language: 'en-US',
    onSpeaking: (speaking) => heard.push(speaking),
    now: () => clock,
    ...options,
  });
  return {
    speech,
    narrator,
    heard,
    volume,
    voice,
    /** The film is at `time`, which the narrator is told on a frame. */
    update(time: number): void {
      film = time;
      narrator.update(time);
    },
    /** Seconds go by with the page running frames at 30 a second, the film standing where it last was. */
    advance(seconds: number): void {
      for (let left = seconds; left > 1e-9; left -= 1 / 30) {
        clock += Math.min(left, 1 / 30);
        narrator.update(film);
      }
    },
    /** Seconds go by with no frame run: the page is stalled. */
    pass(seconds: number): void {
      clock += seconds;
    },
    get clock(): number {
      return clock;
    },
  };
}

type Rig = ReturnType<typeof rig>;

const line = (index: number): Caption => CAPTIONS[index] as Caption;
/** The film second at which a line's first word is meant to sound. */
const startOf = (index: number): number => line(index).from + NARRATION.startAfter;
/** The film second at which the narrator asks for it, with the first guess at the browser's delay. */
const askAt = (index: number): number => startOf(index) - NARRATION.lead;

const aVoice = (name: string, extra: Partial<VoiceInfo> = {}): VoiceInfo => ({
  id: name,
  name,
  lang: 'en-US',
  local: true,
  isDefault: false,
  ...extra,
});

/** The last line the browser was asked for. */
const lastAsked = (r: Rig): Asked => r.speech.asked[r.speech.asked.length - 1] as Asked;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the narrator and the film’s clock', () => {
  it('asks for nothing until the film reaches a line, then asks for it once, a moment early', () => {
    const r = rig();
    r.update(0);
    r.update(askAt(0) - 0.01);
    expect(r.speech.asked).toHaveLength(0);
    r.update(askAt(0));
    expect(r.speech.asked).toHaveLength(1);
    expect(lastAsked(r).request.text).toBe(line(0).text);
    r.update(askAt(0) + 0.1);
    r.update(startOf(0) + 1);
    expect(r.speech.asked).toHaveLength(1);
    expect(r.narrator.stats).toMatchObject({ spoken: 0, skipped: 0, failed: 0, state: 'waiting' });
  });

  it('asks in the voice the player chose, as quickly as their browser allows and as loudly as the film', () => {
    const r = rig();
    r.speech.list = [aVoice('Daniel', { lang: 'en-GB' }), aVoice('Google US English')];
    r.voice.mockReturnValue('Daniel');
    r.volume.mockReturnValue(0.4);
    r.update(askAt(0));
    const { request } = lastAsked(r);
    expect(request).toMatchObject({
      text: line(0).text,
      voice: 'Daniel',
      lang: 'en-GB',
      volume: 0.4,
    });
    const base = speakingSeconds(line(0).text);
    const room = line(0).to - NARRATION.finishBefore - startOf(0);
    expect(request.rate).toBeCloseTo(fitRate(base, room - 0 * NARRATION.lead), 1);
    expect(request.rate).toBeGreaterThanOrEqual(NARRATION.rateMin);
    expect(request.rate).toBeLessThanOrEqual(NARRATION.rateMax);
  });

  it('speaks with the best English voice when the player chose none, and the browser’s own when it has none', () => {
    const r = rig();
    r.speech.list = [
      aVoice('French', { lang: 'fr-FR' }),
      aVoice('Plain'),
      aVoice('Microsoft Aria Online (Natural)', { local: false }),
    ];
    r.update(askAt(0));
    expect(lastAsked(r).request.voice).toBe('Microsoft Aria Online (Natural)');

    const bare = rig();
    bare.update(askAt(0));
    expect(lastAsked(bare).request).toMatchObject({ voice: null, lang: 'en-US' });
  });

  it('keeps to the captions when the browser has voices and none of them is in English', () => {
    const r = rig();
    r.speech.list = [
      aVoice('Thomas', { lang: 'fr-FR' }),
      aVoice('Anna', { lang: 'de-DE', isDefault: true }),
    ];
    r.update(askAt(0));
    expect(r.speech.asked).toHaveLength(0);
    expect(r.narrator.stats).toMatchObject({ spoken: 0, skipped: 1, state: 'done' });
    expect(console.warn).toHaveBeenCalledTimes(1);
    r.update(askAt(1));
    expect(r.speech.asked).toHaveLength(0);

    // But a voice the player picked for themselves is theirs to pick, whatever language it speaks.
    const chosen = rig();
    chosen.speech.list = [aVoice('Thomas', { lang: 'fr-FR' })];
    chosen.voice.mockReturnValue('Thomas');
    chosen.update(askAt(0));
    expect(chosen.speech.asked).toHaveLength(1);
    expect(lastAsked(chosen).request).toMatchObject({ voice: 'Thomas', lang: 'fr-FR' });
  });

  it('keeps the loudness it is asked for inside what a voice can be told', () => {
    for (const [asked, given] of [
      [1.7, 1],
      [-3, 0],
      [0, 0],
      [0.25, 0.25],
    ] as const) {
      const r = rig();
      r.volume.mockReturnValue(asked);
      r.update(askAt(0));
      expect(lastAsked(r).request.volume).toBe(given);
    }
  });

  it('asks about the volume and the voice as each line begins, so that the settings turn it up and down mid-film', () => {
    const r = rig();
    r.update(askAt(0));
    expect(r.voice).toHaveBeenCalledTimes(1);
    expect(r.volume).toHaveBeenCalledTimes(1);
    lastAsked(r).events.start();
    lastAsked(r).events.end();
    r.volume.mockReturnValue(0.2);
    r.update(startOf(1));
    expect(r.voice).toHaveBeenCalledTimes(2);
    expect(lastAsked(r).request.volume).toBe(0.2);
  });

  it('says the film’s own lines when it is not given others, and others when it is', () => {
    const own = rig();
    own.update(askAt(0));
    expect(lastAsked(own).request.text).toBe(CAPTIONS[0]?.text);

    const lines: Caption[] = [{ from: 1, to: 4, text: 'Another story.' }];
    const other = rig({ lines });
    other.update(0.5);
    expect(other.speech.asked).toHaveLength(0);
    other.update(1.15 - NARRATION.lead);
    expect(lastAsked(other).request.text).toBe('Another story.');
  });
});

describe('the narrator and a film that does not keep to its time', () => {
  it('leaves out the lines a jump has gone past and says the one the film is at', () => {
    const r = rig();
    r.update(startOf(3) + 0.5);
    expect(r.speech.asked).toHaveLength(1);
    expect(lastAsked(r).request.text).toBe(line(3).text);
    expect(r.narrator.stats.skipped).toBe(3);
    // The rate is for what is left of its place, not the whole of it.
    const base = speakingSeconds(line(3).text);
    const left = line(3).to - NARRATION.finishBefore - (startOf(3) + 0.5);
    expect(lastAsked(r).request.rate).toBeCloseTo(fitRate(base, left), 9);
  });

  it('does not start a line whose place is nearly over', () => {
    const r = rig({ lines: [{ from: 0, to: 1.5, text: 'Hold the line.' }] });
    r.update(0.7);
    expect(r.speech.asked).toHaveLength(0);
    expect(r.narrator.stats.skipped).toBe(1);
  });

  it('does not start a line that is more than a moment late, and starts one that is only a little late', () => {
    const late = rig();
    late.update(startOf(0) + NARRATION.lateAfter + 0.01);
    expect(late.speech.asked.map((a) => a.request.text)).toEqual([]);
    expect(late.narrator.stats.skipped).toBeGreaterThanOrEqual(1);

    const slightly = rig();
    slightly.update(startOf(0) + NARRATION.lateAfter - 0.01);
    expect(slightly.speech.asked.map((a) => a.request.text)).toEqual([line(0).text]);
  });

  it('keeps no line back for a film that is seeked back: it has already been said, and is not said again', () => {
    const r = rig();
    r.update(askAt(0));
    lastAsked(r).events.start();
    lastAsked(r).events.end();
    r.update(startOf(1));
    expect(r.speech.asked).toHaveLength(2);
    r.update(askAt(0));
    r.update(startOf(0) + 0.3);
    expect(r.speech.asked).toHaveLength(2);
  });

  it('waits for the line that is being said, never cutting it for the next', () => {
    const r = rig();
    r.update(askAt(0));
    lastAsked(r).events.start();
    r.advance(1);
    r.update(askAt(1));
    r.update(startOf(1) + 0.2);
    expect(r.speech.asked).toHaveLength(1);
    expect(r.speech.cancels).toBe(0);

    // The voice finishes a little late, and the next line begins at once.
    r.advance(4);
    lastAsked(r).events.end();
    r.update(startOf(1) + 0.4);
    expect(r.speech.asked).toHaveLength(2);
    expect(lastAsked(r).request.text).toBe(line(1).text);
    expect(r.speech.cancels).toBe(0);
  });

  it('gives up on a line that a slow voice made too late to say', () => {
    const r = rig();
    r.update(askAt(0));
    lastAsked(r).events.start();
    r.advance(6);
    lastAsked(r).events.end();
    // The next line's moment was 5.1 s; it is 6.5 s now.
    r.update(startOf(1) + NARRATION.lateAfter + 0.4);
    expect(r.speech.asked).toHaveLength(1);
    expect(r.narrator.stats.skipped).toBe(1);
    expect(r.narrator.stats.state).toBe('waiting');
    // And the lines after it are not held up.
    r.update(startOf(2));
    expect(lastAsked(r).request.text).toBe(line(2).text);
  });
});

describe('the narrator and the voice it has', () => {
  it('learns how quickly the browser begins a line, and asks for the next that much earlier', () => {
    const r = rig();
    expect(r.narrator.stats.lead).toBe(NARRATION.lead);
    r.update(askAt(0));
    r.advance(0.4);
    lastAsked(r).events.start();
    // Frames add up to the measured lead only to within a rounding, so the next ask is placed by the lead itself.
    const { lead } = r.narrator.stats;
    expect(lead).toBeCloseTo(0.4, 9);
    lastAsked(r).events.end();
    r.update(startOf(1) - lead - 0.01);
    expect(r.speech.asked).toHaveLength(1);
    r.update(startOf(1) - lead);
    expect(r.speech.asked).toHaveLength(2);
  });

  it('does not believe a browser that took many seconds to begin: the lead is a moment, not the wait', () => {
    const r = rig();
    r.update(askAt(0));
    r.advance(3);
    lastAsked(r).events.start();
    expect(r.narrator.stats.lead).toBe(0.8);
  });

  it('counts a stalled page as a moment: a long frame is not a slow browser', () => {
    const r = rig();
    r.update(askAt(0));
    // The page is stuck in a frame for ten seconds, and the browser's answer reaches it afterwards.
    r.pass(10);
    lastAsked(r).events.start();
    expect(r.narrator.stats.lead).toBeCloseTo(NARRATION.stall, 9);
    // The voice is also timed by the page's time: ten seconds of stall are not ten seconds of speech.
    r.pass(10);
    lastAsked(r).events.end();
    expect(r.narrator.stats.speed).toBeLessThan(0.6);
  });

  it('does not take a long frame for a browser that has stopped answering', () => {
    const r = rig();
    r.update(askAt(0));
    r.pass(NARRATION.startTimeout * 5);
    r.update(askAt(0) + 0.05);
    expect(r.speech.cancels).toBe(0);
    expect(r.narrator.stats).toMatchObject({ failed: 0, state: 'waiting' });
    lastAsked(r).events.start();
    r.pass(60);
    r.update(askAt(0) + 0.1);
    expect(r.speech.cancels).toBe(0);
    expect(r.narrator.stats).toMatchObject({ failed: 0, state: 'speaking' });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('learns how long the voice takes against the guess, and speaks the next line to fit', () => {
    const r = rig();
    r.update(askAt(0));
    const first = lastAsked(r);
    const base = speakingSeconds(line(0).text);
    first.events.start();
    // A voice that needs twice as long as the estimate says, at the rate it was given.
    r.advance((base * 2) / first.request.rate);
    first.events.end();
    expect(r.narrator.stats.speed).toBeCloseTo(2, 6);

    r.update(startOf(1));
    const second = lastAsked(r);
    const room = line(1).to - NARRATION.finishBefore - startOf(1);
    expect(second.request.rate).toBeCloseTo(fitRate(speakingSeconds(line(1).text), room, 2), 1);
    expect(second.request.rate).toBeGreaterThan(fitRate(speakingSeconds(line(1).text), room, 1));
  });

  it('moves the estimate part of the way with each line after the first', () => {
    const r = rig();
    const lineTook = (index: number, factor: number): void => {
      r.update(startOf(index));
      const asked = lastAsked(r);
      asked.events.start();
      r.advance((speakingSeconds(asked.request.text) * factor) / asked.request.rate);
      asked.events.end();
    };
    lineTook(0, 1.5);
    expect(r.narrator.stats.speed).toBeCloseTo(1.5, 6);
    lineTook(1, 1);
    // Between what it believed and what it saw, nearer what it saw.
    expect(r.narrator.stats.speed).toBeCloseTo(1.5 * 0.4 + 1 * 0.6, 6);
  });

  it('keeps the estimate of the voice inside what is believable', () => {
    const r = rig();
    r.update(askAt(0));
    const asked = lastAsked(r);
    asked.events.start();
    // Long, but not so long that the browser is taken to have stopped.
    r.advance(12);
    asked.events.end();
    expect(r.narrator.stats.speed).toBe(2.5);
    const quick = rig();
    quick.update(askAt(0));
    const fast = lastAsked(quick);
    fast.events.start();
    fast.events.end();
    expect(quick.narrator.stats.speed).toBeGreaterThanOrEqual(0.5);
  });

  it('counts a line as said when the browser finished it without saying that it began', () => {
    const r = rig();
    r.update(askAt(0));
    lastAsked(r).events.end();
    expect(r.narrator.stats.spoken).toBe(1);
    expect(r.narrator.stats.speed).toBe(1);
    expect(r.narrator.stats.state).toBe('waiting');
  });

  it('tells the music when the voice begins and ends, once each, in turn', () => {
    const r = rig();
    r.update(askAt(0));
    expect(r.heard).toEqual([]);
    lastAsked(r).events.start();
    expect(r.heard).toEqual([true]);
    expect(r.narrator.stats.state).toBe('speaking');
    lastAsked(r).events.end();
    expect(r.heard).toEqual([true, false]);
    // A line that never began has nothing to step aside for or to come back from.
    r.update(askAt(1));
    lastAsked(r).events.error('synthesis-failed', false);
    expect(r.heard).toEqual([true, false]);
  });

  it('plays on when the music cannot be told to step aside, and says so', () => {
    const r = rig({
      onSpeaking: () => {
        throw new Error('the gain is gone');
      },
    });
    r.update(askAt(0));
    expect(() => lastAsked(r).events.start()).not.toThrow();
    expect(() => lastAsked(r).events.end()).not.toThrow();
    expect(console.error).toHaveBeenCalled();
    r.update(startOf(1));
    expect(r.speech.asked).toHaveLength(2);
  });

  it('ignores what a line it has moved on from reports', () => {
    const r = rig();
    r.update(askAt(0));
    const old = lastAsked(r);
    old.events.start();
    // The browser stops answering; the watch lets go of the line, and the next is asked for.
    r.advance(30);
    r.update(startOf(1));
    const next = lastAsked(r);
    expect(next.request.text).toBe(line(1).text);
    next.events.start();
    // Then the old line speaks up: it changes nothing.
    const stats = { ...r.narrator.stats };
    old.events.end();
    old.events.error('synthesis-failed', false);
    expect(r.narrator.stats).toEqual(stats);
    expect(r.narrator.stats.state).toBe('speaking');
    expect(r.heard[r.heard.length - 1]).toBe(true);
  });
});

describe('the narrator and a browser that will not speak', () => {
  it('stops asking, and says once that the film goes on with its captions, when the browser refuses', () => {
    const r = rig();
    r.update(askAt(0));
    lastAsked(r).events.error('not-allowed', false);
    expect(r.narrator.stats.failed).toBe(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(
      String((console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]),
    ).toContain('captions');
    r.update(askAt(1));
    r.update(askAt(2));
    expect(r.speech.asked).toHaveLength(1);
    expect(r.narrator.stats.state).toBe('done');
  });

  it('treats every kind of refusal the same', () => {
    for (const reason of [
      'not-allowed',
      'synthesis-unavailable',
      'audio-hardware',
      'service-not-allowed',
    ]) {
      const r = rig();
      r.update(askAt(0));
      lastAsked(r).events.error(reason, false);
      r.update(askAt(1));
      expect(r.speech.asked, reason).toHaveLength(1);
    }
  });

  it('tries the next line after one the browser failed on for another reason, and does not say it twice', () => {
    const r = rig();
    r.update(askAt(0));
    lastAsked(r).events.error('network', false);
    r.update(askAt(1));
    expect(r.speech.asked).toHaveLength(2);
    lastAsked(r).events.error('network', false);
    r.update(askAt(2));
    expect(r.speech.asked).toHaveLength(3);
    expect(r.narrator.stats.failed).toBe(2);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('does not count a line that was cut on purpose as a failure', () => {
    const r = rig();
    r.update(askAt(0));
    lastAsked(r).events.error('canceled', true);
    expect(r.narrator.stats.failed).toBe(0);
    expect(console.warn).not.toHaveBeenCalled();
    expect(r.narrator.stats.state).toBe('waiting');
  });

  it('goes on with captions when the browser throws as it is asked', () => {
    const r = rig();
    r.speech.failToSpeak = new Error('speechSynthesis is broken');
    expect(() => r.update(askAt(0))).not.toThrow();
    expect(r.narrator.stats.failed).toBe(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    r.speech.failToSpeak = null;
    r.update(askAt(1));
    expect(r.speech.asked).toHaveLength(0);
    expect(r.narrator.stats.state).toBe('done');
  });

  it('lets go of a browser that never begins a line, and leaves the rest of the film to its captions', () => {
    const r = rig();
    r.update(askAt(0));
    r.advance(NARRATION.startTimeout - 0.5);
    r.update(askAt(0) + 0.2);
    expect(r.speech.cancels).toBe(0);
    r.advance(1);
    r.update(askAt(0) + 0.4);
    expect(r.speech.cancels).toBe(1);
    expect(r.narrator.stats.failed).toBe(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    r.update(askAt(1));
    r.update(askAt(2));
    expect(r.speech.asked).toHaveLength(1);
    expect(r.narrator.stats.state).toBe('done');
  });

  it('lets go of a line that never ends, and goes on with the next', () => {
    const r = rig();
    r.update(askAt(0));
    lastAsked(r).events.start();
    const base = speakingSeconds(line(0).text);
    r.advance(base * 2.5 + NARRATION.endSlack - 0.5);
    r.update(askAt(0) + 1);
    expect(r.speech.cancels).toBe(0);
    r.advance(1);
    r.update(askAt(0) + 1.1);
    expect(r.speech.cancels).toBe(1);
    expect(r.narrator.stats).toMatchObject({ failed: 1, state: 'waiting' });
    expect(r.heard).toEqual([true, false]);
    r.update(startOf(1));
    expect(r.speech.asked).toHaveLength(2);
  });
});

describe('the narrator when the film ends', () => {
  it('stops the line that is being said when the film is skipped or cut, and asks for no more', () => {
    const r = rig();
    r.update(askAt(0));
    lastAsked(r).events.start();
    r.narrator.stop();
    expect(r.speech.cancels).toBe(1);
    expect(r.heard).toEqual([true, false]);
    expect(r.narrator.stats.state).toBe('done');
    r.update(askAt(1));
    expect(r.speech.asked).toHaveLength(1);
    // The browser reports the cancel after the fact: nothing happens.
    expect(() => lastAsked(r).events.error('canceled', true)).not.toThrow();
    expect(r.heard).toEqual([true, false]);
  });

  it('cancels nothing when there is nothing being said', () => {
    const r = rig();
    r.narrator.stop();
    expect(r.speech.cancels).toBe(0);
    expect(r.narrator.stats.state).toBe('done');
    r.narrator.stop();
    expect(r.speech.cancels).toBe(0);
  });

  it('lets the last line finish when the film runs to its end, and asks for no more', () => {
    const r = rig();
    r.update(askAt(0));
    lastAsked(r).events.start();
    r.narrator.finish();
    expect(r.speech.cancels).toBe(0);
    r.update(askAt(1));
    expect(r.speech.asked).toHaveLength(1);
    expect(r.narrator.stats.state).toBe('speaking');
    lastAsked(r).events.end();
    expect(r.narrator.stats.state).toBe('done');
    expect(r.heard).toEqual([true, false]);
    expect(r.speech.cancels).toBe(0);
  });

  it('cuts a last line that goes on past the grace it is given', () => {
    vi.useFakeTimers();
    const r = rig();
    r.update(askAt(0));
    lastAsked(r).events.start();
    r.narrator.finish();
    vi.advanceTimersByTime(NARRATION.finishGrace * 1000 - 100);
    expect(r.speech.cancels).toBe(0);
    vi.advanceTimersByTime(200);
    expect(r.speech.cancels).toBe(1);
    expect(r.heard).toEqual([true, false]);
    expect(r.narrator.stats.state).toBe('done');
  });

  it('leaves no timer behind when the last line is done in time', () => {
    vi.useFakeTimers();
    const r = rig();
    r.update(askAt(0));
    lastAsked(r).events.start();
    r.narrator.finish();
    lastAsked(r).events.end();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is done at once when the film ends between lines', () => {
    vi.useFakeTimers();
    const r = rig();
    r.narrator.finish();
    expect(r.narrator.stats.state).toBe('done');
    expect(vi.getTimerCount()).toBe(0);
    r.update(askAt(0));
    expect(r.speech.asked).toHaveLength(0);
    // Stopping after finishing is harmless, and so is finishing twice.
    r.narrator.finish();
    r.narrator.stop();
    expect(r.speech.cancels).toBe(0);
  });
});

describe('the narrator with a whole film in front of it', () => {
  interface Played {
    readonly text: string;
    /** Film seconds at which the voice began and ended. */
    readonly began: number;
    ended: number;
  }

  /**
   * Plays the film at 30 frames a second with a voice that takes `speed` times the estimate to say a
   * line at the rate it is given, and `latency` seconds to begin once asked.
   */
  function playFilm(r: Rig, { latency, speed }: { latency: number; speed: number }): Played[] {
    const played: Played[] = [];
    const due: { at: number; run: () => void }[] = [];
    let film = 0;
    r.speech.onAsk = (asked) => {
      const begins = asked.at + latency;
      const ends = begins + (speakingSeconds(asked.request.text) * speed) / asked.request.rate;
      due.push({
        at: begins,
        run: () => {
          played.push({ text: asked.request.text, began: film, ended: Number.NaN });
          asked.events.start();
        },
      });
      due.push({
        at: ends,
        run: () => {
          const entry = played.find((p) => p.text === asked.request.text);
          if (entry) entry.ended = film;
          asked.events.end();
        },
      });
    };
    const step = 1 / 30;
    for (film = 0; film <= INTRO_SECONDS; film += step) {
      r.pass(step);
      for (const event of due.filter((d) => d.at <= r.clock).sort((a, b) => a.at - b.at)) {
        due.splice(due.indexOf(event), 1);
        event.run();
      }
      r.update(film);
    }
    return played;
  }

  it('says every line, in order, one at a time, with a voice as quick as the estimate, each in its own place', () => {
    const r = rig();
    const played = playFilm(r, { latency: 0.15, speed: 1 });
    expect(played.map((p) => p.text)).toEqual(CAPTIONS.map((c) => c.text));
    played.forEach((p, i) => {
      const caption = line(i);
      expect(p.began, p.text).toBeGreaterThanOrEqual(caption.from);
      expect(p.began, p.text).toBeLessThan(caption.from + 0.6);
      expect(p.ended, p.text).toBeLessThanOrEqual(caption.to + 0.15);
      if (i > 0) expect(p.began, p.text).toBeGreaterThan((played[i - 1] as Played).ended);
    });
    expect(r.narrator.stats).toMatchObject({ spoken: CAPTIONS.length, skipped: 0, failed: 0 });
    expect(r.heard).toHaveLength(CAPTIONS.length * 2);
    expect(r.heard.every((value, i) => value === (i % 2 === 0))).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('slows to the pace of a voice that is faster than the estimate, and still ends each line in its place', () => {
    const r = rig();
    const played = playFilm(r, { latency: 0.05, speed: 0.7 });
    expect(played).toHaveLength(CAPTIONS.length);
    played.forEach((p, i) => {
      expect(p.ended, p.text).toBeLessThanOrEqual(line(i).to + 0.15);
    });
    expect(r.narrator.stats.speed).toBeLessThan(0.9);
  });

  it('keeps the order and never talks over itself with a voice that is slow, and a browser that is slow to begin', () => {
    const r = rig();
    const played = playFilm(r, { latency: 0.6, speed: 1.6 });
    expect(played.length).toBeGreaterThanOrEqual(CAPTIONS.length - 3);
    const texts = CAPTIONS.map((c) => c.text);
    const places = played.map((p) => texts.indexOf(p.text));
    expect(places).toEqual([...places].sort((a, b) => a - b));
    expect(new Set(places).size).toBe(places.length);
    played.forEach((p, i) => {
      if (i > 0) expect(p.began).toBeGreaterThan((played[i - 1] as Played).ended);
    });
    // What it could not say it left out rather than crowd the rest.
    expect(played.length + r.narrator.stats.skipped).toBe(CAPTIONS.length);
    expect(r.narrator.stats.lead).toBeGreaterThan(0.4);
    expect(r.narrator.stats.failed).toBe(0);
  });

  it('is quiet all the way through with a film no one hears: a browser that refuses at the first word', () => {
    const r = rig();
    r.speech.onAsk = (asked) => asked.events.error('not-allowed', false);
    for (let film = 0; film <= INTRO_SECONDS; film += 1 / 30) {
      r.pass(1 / 30);
      r.update(film);
    }
    expect(r.speech.asked).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(r.heard).toEqual([]);
  });
});
