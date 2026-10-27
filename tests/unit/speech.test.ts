import { describe, expect, it, vi } from 'vitest';
import { createBrowserSpeech, type SpeakRequest, type SpeechHost } from '../../src/engine/speech';

interface FakeVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

class FakeUtterance {
  voice: FakeVoice | null = null;
  lang = '';
  rate = 1;
  volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(readonly text: string) {}
}

/** The speaker of a browser: it keeps what it is asked to say and says nothing. */
class FakeSynth extends EventTarget {
  voices: FakeVoice[] = [];
  readonly spoken: FakeUtterance[] = [];
  cancels = 0;

  getVoices(): FakeVoice[] {
    return this.voices;
  }

  speak(utterance: FakeUtterance): void {
    this.spoken.push(utterance);
  }

  cancel(): void {
    this.cancels++;
  }
}

class FakeDocument extends EventTarget {
  hidden = false;
}

/** The part of a page that speech lives on, with the events it hears. */
class FakeHost extends EventTarget {
  readonly speechSynthesis = new FakeSynth();
  readonly SpeechSynthesisUtterance = FakeUtterance;
  readonly document = new FakeDocument();
}

const asHost = (host: object): SpeechHost => host as unknown as SpeechHost;

const voice = (name: string, extra: Partial<FakeVoice> = {}): FakeVoice => ({
  voiceURI: name,
  name,
  lang: 'en-US',
  localService: true,
  default: false,
  ...extra,
});

const request = (extra: Partial<SpeakRequest> = {}): SpeakRequest => ({
  text: 'We mean to keep it.',
  voice: null,
  lang: 'en-US',
  rate: 1.1,
  volume: 0.5,
  ...extra,
});

function make() {
  const host = new FakeHost();
  const speech = createBrowserSpeech(asHost(host));
  return { host, synth: host.speechSynthesis, speech };
}

const handlers = () => ({ start: vi.fn(), end: vi.fn(), error: vi.fn() });

describe('the browser’s speech', () => {
  it('is nothing for a page that has none', () => {
    expect(createBrowserSpeech(null)).toBeNull();
    expect(
      createBrowserSpeech(asHost({ addEventListener() {}, removeEventListener() {} })),
    ).toBeNull();
    const host = new FakeHost();
    expect(
      createBrowserSpeech(
        asHost({
          speechSynthesis: host.speechSynthesis,
          addEventListener() {},
          removeEventListener() {},
        }),
      ),
    ).toBeNull();
    expect(
      createBrowserSpeech(
        asHost({
          SpeechSynthesisUtterance: FakeUtterance,
          addEventListener() {},
          removeEventListener() {},
        }),
      ),
    ).toBeNull();
  });

  it('lists the voices the browser has now, named by what keeps between visits', () => {
    const { synth, speech } = make();
    synth.voices = [
      voice('Daniel', { lang: 'en-GB', default: true }),
      voice('Google US English', { voiceURI: 'Google US English (network)', localService: false }),
    ];
    expect(speech?.voices()).toEqual([
      { id: 'Daniel', name: 'Daniel', lang: 'en-GB', local: true, isDefault: true },
      {
        id: 'Google US English (network)',
        name: 'Google US English',
        lang: 'en-US',
        local: false,
        isDefault: false,
      },
    ]);
    // Some browsers have none for a moment after load, and then have them.
    synth.voices = [];
    expect(speech?.voices()).toEqual([]);
    synth.voices = [voice('Samantha')];
    expect(speech?.voices().map((v) => v.id)).toEqual(['Samantha']);
  });

  it('names a voice by its name when the browser gives it no address', () => {
    const { synth, speech } = make();
    synth.voices = [voice('Plain', { voiceURI: '' })];
    expect(speech?.voices()[0]?.id).toBe('Plain');
  });

  it('tells its listener when the browser’s voices change, until it is told to stop', () => {
    const { synth, speech } = make();
    const listener = vi.fn();
    const stop = speech?.onVoices(listener);
    synth.dispatchEvent(new Event('voiceschanged'));
    expect(listener).toHaveBeenCalledTimes(1);
    stop?.();
    synth.dispatchEvent(new Event('voiceschanged'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('says a line in the voice, pace and loudness it was asked for', () => {
    const { synth, speech } = make();
    synth.voices = [voice('Daniel', { lang: 'en-GB' }), voice('Samantha')];
    speech?.speak(request({ voice: 'Daniel', lang: 'en-US' }), handlers());
    expect(synth.spoken).toHaveLength(1);
    const [utterance] = synth.spoken as [FakeUtterance];
    expect(utterance.text).toBe('We mean to keep it.');
    expect(utterance.voice?.name).toBe('Daniel');
    // The voice's own language, since a voice told to speak another one may be silent.
    expect(utterance.lang).toBe('en-GB');
    expect(utterance.rate).toBe(1.1);
    expect(utterance.volume).toBe(0.5);
  });

  it('leaves the voice to the browser when none was asked for, or the one asked for has gone', () => {
    const { synth, speech } = make();
    synth.voices = [voice('Samantha')];
    speech?.speak(request({ voice: null, lang: 'en-AU' }), handlers());
    speech?.speak(request({ voice: 'Gone', lang: 'en-CA' }), handlers());
    const [none, gone] = synth.spoken as [FakeUtterance, FakeUtterance];
    expect(none.voice).toBeNull();
    expect(none.lang).toBe('en-AU');
    expect(gone.voice).toBeNull();
    expect(gone.lang).toBe('en-CA');
  });

  it('passes on when the first word sounds and when the line is over', () => {
    const { synth, speech } = make();
    const events = handlers();
    speech?.speak(request(), events);
    const utterance = synth.spoken[0] as FakeUtterance;
    utterance.onstart?.();
    expect(events.start).toHaveBeenCalledTimes(1);
    expect(events.end).not.toHaveBeenCalled();
    utterance.onend?.();
    expect(events.end).toHaveBeenCalledTimes(1);
    expect(events.error).not.toHaveBeenCalled();
  });

  it('tells a line that was cut on purpose from one the browser could not say', () => {
    const { synth, speech } = make();
    const events = handlers();
    for (const reason of ['canceled', 'interrupted', 'not-allowed', 'synthesis-failed']) {
      speech?.speak(request(), events);
      (synth.spoken[synth.spoken.length - 1] as FakeUtterance).onerror?.({ error: reason });
    }
    expect(events.error.mock.calls).toEqual([
      ['canceled', true],
      ['interrupted', true],
      ['not-allowed', false],
      ['synthesis-failed', false],
    ]);
  });

  it('silences the speaker when asked to', () => {
    const { synth, speech } = make();
    speech?.speak(request(), handlers());
    speech?.cancel();
    expect(synth.cancels).toBe(1);
  });

  it('wakes the voice with a word nobody hears', () => {
    const { synth, speech } = make();
    const events = handlers();
    speech?.warm();
    expect(synth.spoken).toHaveLength(1);
    const [word] = synth.spoken as [FakeUtterance];
    expect(word.volume).toBe(0);
    expect(word.text.trim()).toBe('');
    // It has no line to report on, and ending or failing is nothing.
    expect(() => word.onend?.()).not.toThrow();
    expect(() => word.onerror?.({ error: 'not-allowed' })).not.toThrow();
    expect(events.end).not.toHaveBeenCalled();
  });

  it('stops talking when the page is hidden or left, so that a line is not said over what comes next', () => {
    const { host, synth, speech } = make();
    expect(speech).not.toBeNull();
    host.dispatchEvent(new Event('pagehide'));
    expect(synth.cancels).toBe(1);

    host.document.hidden = false;
    host.document.dispatchEvent(new Event('visibilitychange'));
    expect(synth.cancels).toBe(1);
    host.document.hidden = true;
    host.document.dispatchEvent(new Event('visibilitychange'));
    expect(synth.cancels).toBe(2);
  });

  it('lets go of the page when it is done with: the speaker is silenced, and the page’s events are ignored', () => {
    const { host, synth, speech } = make();
    speech?.dispose();
    expect(synth.cancels).toBe(1);
    host.dispatchEvent(new Event('pagehide'));
    host.document.hidden = true;
    host.document.dispatchEvent(new Event('visibilitychange'));
    expect(synth.cancels).toBe(1);
  });

  it('works on a page with no document to watch', () => {
    const host = new FakeHost();
    const speech = createBrowserSpeech(
      asHost({
        speechSynthesis: host.speechSynthesis,
        SpeechSynthesisUtterance: FakeUtterance,
        addEventListener: host.addEventListener.bind(host),
        removeEventListener: host.removeEventListener.bind(host),
      }),
    );
    expect(speech).not.toBeNull();
    speech?.speak(request(), handlers());
    expect(host.speechSynthesis.spoken).toHaveLength(1);
    expect(() => speech?.dispose()).not.toThrow();
  });
});
