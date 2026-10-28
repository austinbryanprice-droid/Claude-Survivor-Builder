import type { VoiceInfo } from '../shared/narration';

/**
 * The browser's own speech, behind a small port so that the narrator and the pause card never touch
 * `speechSynthesis` themselves and the tests can give them a stand-in. Nothing is downloaded and
 * nothing is shipped: the voices are whatever the player's system and browser have, which is as
 * good as an Edge "Natural" voice or as plain as an old system one, so everything that depends on
 * how a voice sounds (its pace, its latency) is measured by the narrator rather than assumed here.
 *
 * It is small on purpose: the pause card reads it from the first load, the narrator from the film's
 * chunk.
 */

export interface SpeakRequest {
  readonly text: string;
  /** The id of the voice to use, or null for the browser's own pick for `lang`. */
  readonly voice: string | null;
  readonly lang: string;
  /** 1 is the voice's own pace. */
  readonly rate: number;
  /** 0 (silent) to 1. */
  readonly volume: number;
}

export interface SpeakEvents {
  /** The first word is sounding. */
  start(): void;
  /** The line has been said. */
  end(): void;
  /** The browser could not say it, or it was cut off (`canceled`: on purpose, by `cancel`). */
  error(reason: string, canceled: boolean): void;
}

export interface Speech {
  /** The voices the browser has now. Some browsers have none until a moment after the page loads (see `onVoices`). */
  voices(): readonly VoiceInfo[];
  /** Calls `listener` when the browser's list of voices changes; returns the way to stop. */
  onVoices(listener: () => void): () => void;
  /** Speaks one line. Asking is not speaking: `events.start` says when the first word sounds. */
  speak(request: SpeakRequest, events: SpeakEvents): void;
  /** Silences whatever is being said and drops whatever is waiting. */
  cancel(): void;
  /** Wakes the browser's voice with a silent word, so that the first real line is not late. */
  warm(): void;
  dispose(): void;
}

/** The part of the page that speech lives on, for the tests to stand in for. */
export interface SpeechHost {
  readonly speechSynthesis?: SpeechSynthesis;
  readonly SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  readonly document?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
}

/** The browser's speech, or null for a page that has none (a browser without it, a server). */
export function createBrowserSpeech(
  host: SpeechHost | null = typeof window === 'undefined' ? null : window,
): Speech | null {
  const synth = host?.speechSynthesis;
  const Utterance = host?.SpeechSynthesisUtterance;
  if (!host || !synth || !Utterance) return null;

  /**
   * The line in the speaker. A browser may drop an utterance nobody holds before it has said its
   * last word, and then never fire its end, so each is kept here until it is over.
   */
  const live = new Set<SpeechSynthesisUtterance>();
  let natives: ReadonlyMap<string, SpeechSynthesisVoice> = new Map();

  const list = (): readonly VoiceInfo[] => {
    const found = synth.getVoices();
    natives = new Map(found.map((voice) => [voice.voiceURI || voice.name, voice]));
    return found.map((voice) => ({
      id: voice.voiceURI || voice.name,
      name: voice.name,
      lang: voice.lang,
      local: voice.localService,
      isDefault: voice.default,
    }));
  };
  list();

  const cancel = (): void => {
    live.clear();
    synth.cancel();
  };
  // A line that outlives its page or its tab would be said over whatever comes next.
  const onHidden = (): void => {
    if (host.document?.hidden) cancel();
  };
  host.addEventListener('pagehide', cancel);
  host.document?.addEventListener('visibilitychange', onHidden);

  return {
    voices: list,
    onVoices(listener) {
      synth.addEventListener('voiceschanged', listener);
      return () => synth.removeEventListener('voiceschanged', listener);
    },
    speak(request, events) {
      const utterance = new Utterance(request.text);
      list();
      const voice = request.voice === null ? undefined : natives.get(request.voice);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? request.lang;
      utterance.rate = request.rate;
      utterance.volume = request.volume;
      utterance.onstart = () => events.start();
      utterance.onend = () => {
        live.delete(utterance);
        events.end();
      };
      utterance.onerror = (event) => {
        live.delete(utterance);
        const reason = event.error;
        events.error(reason, reason === 'canceled' || reason === 'interrupted');
      };
      live.add(utterance);
      synth.speak(utterance);
    },
    cancel,
    warm() {
      const utterance = new Utterance(' ');
      utterance.volume = 0;
      live.add(utterance);
      const done = (): void => {
        live.delete(utterance);
      };
      utterance.onend = done;
      utterance.onerror = done;
      synth.speak(utterance);
    },
    dispose() {
      host.removeEventListener('pagehide', cancel);
      host.document?.removeEventListener('visibilitychange', onHidden);
      cancel();
    },
  };
}
