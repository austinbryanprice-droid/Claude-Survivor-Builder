import { expect, test, type Page } from '@playwright/test';
import { CAPTIONS, INTRO_SECONDS } from '../../src/shared/intro';
import { NARRATION, SAMPLE_LINE } from '../../src/shared/narration';

// The film is told by a narrator that speaks its captions in the browser's own voice. No voice can
// be heard here (the browser in the cloud sandbox has none, and nobody is listening), so these
// tests give the page a stand-in for `speechSynthesis` that keeps every line it is asked to say and
// plays the part of the voice: it takes a moment to begin, takes a moment per word, and can be told
// to refuse. What they check is everything the page does with a voice: which line it asks for when,
// in which voice, how it steps the music aside, how it stops when the film is skipped, and what the
// film is without one.
test.use({ viewport: { width: 960, height: 540 } });

const STATE_TIMEOUT = 60_000;

interface FakeVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

/** One line the page asked the browser to say, and what became of it. */
interface SpokenLine {
  text: string;
  /** The address of the voice it was given, or null for the browser's own pick. */
  voice: string | null;
  lang: string;
  rate: number;
  volume: number;
  started: boolean;
  ended: boolean;
  canceled: boolean;
}

interface VoiceLog {
  /** What was asked for aloud, in order. */
  lines: SpokenLine[];
  /** The silent words that wake the voice. */
  warms: { volume: number }[];
  cancels: number;
}

declare global {
  interface Window {
    __voice?: VoiceLog;
  }
}

const DANIEL: FakeVoice = {
  voiceURI: 'Test Daniel',
  name: 'Test Daniel',
  lang: 'en-GB',
  localService: true,
  default: true,
};
const GOOGLE: FakeVoice = {
  voiceURI: 'Test Google US English',
  name: 'Google US English',
  lang: 'en-US',
  localService: false,
  default: false,
};
const THOMAS: FakeVoice = {
  voiceURI: 'Test Thomas',
  name: 'Thomas',
  lang: 'fr-FR',
  localService: true,
  default: false,
};

interface VoiceSetup {
  /** The voices the browser lists. */
  voices: FakeVoice[];
  /** Milliseconds between being asked and the first word. */
  latency?: number;
  /** Milliseconds each word takes at the pace asked for. */
  perWord?: number;
  /** An error to answer every line with instead of saying it. */
  refuse?: string;
}

/** Gives the page a `speechSynthesis` that says nothing aloud and keeps a log of what it was asked (`window.__voice`). */
async function installVoice(page: Page, setup: VoiceSetup): Promise<void> {
  await page.addInitScript(
    (config) => {
      interface Entry {
        utterance: FakeUtterance;
        line: SpokenLine | null;
      }
      class FakeUtterance {
        text: string;
        voice: FakeVoice | null = null;
        lang = '';
        rate = 1;
        volume = 1;
        onstart: (() => void) | null = null;
        onend: (() => void) | null = null;
        onerror: ((event: { error: string }) => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      }
      const log: VoiceLog = { lines: [], warms: [], cancels: 0 };
      const queue: Entry[] = [];
      let current: Entry | null = null;
      let timers: number[] = [];
      const pump = (): void => {
        if (current) return;
        const next = queue.shift();
        if (!next) return;
        current = next;
        const { utterance, line } = next;
        if (config.refuse) {
          timers.push(
            window.setTimeout(() => {
              current = null;
              utterance.onerror?.({ error: config.refuse as string });
              pump();
            }, 5),
          );
          return;
        }
        timers.push(
          window.setTimeout(() => {
            if (line) line.started = true;
            utterance.onstart?.();
            const words = utterance.text.trim().split(/\s+/).filter(Boolean).length;
            timers.push(
              window.setTimeout(
                () => {
                  if (line) line.ended = true;
                  current = null;
                  utterance.onend?.();
                  pump();
                },
                Math.max(20, (words * config.perWord) / utterance.rate),
              ),
            );
          }, config.latency),
        );
      };
      const synth = Object.assign(new EventTarget(), {
        getVoices: () => config.voices,
        speak(utterance: FakeUtterance) {
          let line: SpokenLine | null = null;
          if (utterance.text.trim() === '') {
            log.warms.push({ volume: utterance.volume });
          } else {
            line = {
              text: utterance.text,
              voice: utterance.voice ? utterance.voice.voiceURI : null,
              lang: utterance.lang,
              rate: utterance.rate,
              volume: utterance.volume,
              started: false,
              ended: false,
              canceled: false,
            };
            log.lines.push(line);
          }
          queue.push({ utterance, line });
          pump();
        },
        cancel() {
          log.cancels++;
          for (const timer of timers) window.clearTimeout(timer);
          timers = [];
          queue.length = 0;
          const gone = current;
          current = null;
          if (gone) {
            if (gone.line) gone.line.canceled = true;
            gone.utterance.onerror?.({ error: 'canceled' });
          }
        },
      });
      Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', {
        value: FakeUtterance,
        configurable: true,
        writable: true,
      });
      window.__voice = log;
    },
    { latency: 30, perWord: 25, refuse: '', ...setup },
  );
}

/** What the narrator said in the console: the page has other warnings (the software renderer's, for one) that are none of the narrator's. */
const narratorWarnings = (warnings: readonly string[]): string[] =>
  warnings.filter((warning) => warning.includes('narrator'));

interface Watched {
  /** Console errors and uncaught errors. */
  problems: string[];
  /** Console warnings. */
  warnings: string[];
}

/** Opens the page and records every console error, uncaught error and warning it has from then on. */
async function open(page: Page, query: string): Promise<Watched> {
  const watched: Watched = { problems: [], warnings: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') watched.problems.push(`console: ${message.text()}`);
    if (message.type() === 'warning') watched.warnings.push(message.text());
  });
  page.on('pageerror', (error) => watched.problems.push(`page error: ${error.message}`));
  await page.goto(`./${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', {
    timeout: STATE_TIMEOUT,
  });
  return watched;
}

/** Waits until the film's code has loaded and the run's host is up, so that the first click is the one that starts it. */
async function waitForTheFilm(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.__ashbound?.intro && !!window.__ashbound.mp, null, {
    timeout: STATE_TIMEOUT,
  });
}

/** Clicks Play and waits until the film is on the screen. */
async function playTheFilm(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
    timeout: STATE_TIMEOUT,
  });
}

/** Waits until the film has played for `seconds` of its own clock. */
const filmPast = (page: Page, seconds: number): Promise<unknown> =>
  page.waitForFunction(
    (seconds) => (window.__ashbound?.intro?.playback?.time ?? 0) > seconds,
    seconds,
    { timeout: STATE_TIMEOUT },
  );

/** Moves the film to `seconds` and lets it play on from there (a seek holds the film where it is put). */
const seekFilm = (page: Page, seconds: number): Promise<unknown> =>
  page.evaluate((seconds) => {
    const film = window.__ashbound?.intro?.playback;
    film?.seek(seconds);
    film?.play();
  }, seconds);

/** Waits until the letterbox shows `text`: the first frame of a scene the page has not drawn yet can take seconds on a software renderer. */
const captionIs = (page: Page, text: string | undefined) =>
  expect(page.locator('.intro-caption')).toHaveText(text ?? '', { timeout: STATE_TIMEOUT });

/** Waits until the page has asked the browser to say `count` lines aloud, and says what it did ask for when it does not. */
async function linesSpoken(page: Page, count: number): Promise<void> {
  try {
    await page.waitForFunction((count) => (window.__voice?.lines.length ?? 0) >= count, count, {
      timeout: STATE_TIMEOUT,
    });
  } catch (error) {
    const seen = await page.evaluate(() => ({
      asked: window.__voice?.lines.map((line) => line.text),
      narrator: window.__ashbound?.intro?.narration?.stats ?? null,
      film: window.__ashbound?.intro?.playback?.time ?? null,
    }));
    throw new Error(
      `Waited for ${count} lines to be asked for; the page has ${JSON.stringify(seen)}`,
      {
        cause: error,
      },
    );
  }
}

const voiceLog = (page: Page): Promise<VoiceLog> =>
  page.evaluate(() => structuredClone(window.__voice) as VoiceLog);

/** What the film's narrator counts, or null when the film has none. */
const narration = (page: Page) =>
  page.evaluate(() => {
    const narrator = window.__ashbound?.intro?.narration;
    return narrator ? { ...narrator.stats } : null;
  });

const storedSettings = (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(
    () => JSON.parse(window.localStorage.getItem('ashbound.settings.v1') ?? '{}') as never,
  );

test.describe('the intro film’s narrator', () => {
  // Each of these builds a film's worth of scenery and waits on a few frames a second of software
  // rendering, which is longer than the default 30 s on a slow machine.
  test.describe.configure({ timeout: 120_000 });

  test('speaks each line of the script as the film reaches it, in the best English voice, over captions that say the same words', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await installVoice(page, { voices: [DANIEL, GOOGLE, THOMAS] });
    const { problems, warnings } = await open(page, '?title=on&intro=on&debug&quality=low');
    await waitForTheFilm(page);

    // The browser's voice is not asked to say anything before the player presses Play.
    expect(await voiceLog(page)).toEqual({ lines: [], warms: [], cancels: 0 });

    await playTheFilm(page);
    // Play wakes the voice with a word nobody hears, from inside the click that lets the page speak.
    const { warms } = await voiceLog(page);
    expect(warms.length).toBeGreaterThanOrEqual(1);
    expect(warms.every((warm) => warm.volume === 0)).toBe(true);

    // The first line comes when the film reaches it; the rest are brought to their moments by seeking.
    for (const [i, caption] of CAPTIONS.entries()) {
      if (i > 0) await seekFilm(page, caption.from + NARRATION.startAfter);
      await linesSpoken(page, i + 1);
      // What is said is what is on the screen.
      await captionIs(page, caption.text);
    }

    const log = await voiceLog(page);
    expect(log.lines.map((line) => line.text)).toEqual(CAPTIONS.map((caption) => caption.text));
    for (const line of log.lines) {
      // The best of the English voices the browser lists, for a page in English (the French one is left out).
      expect(line).toMatchObject({
        voice: GOOGLE.voiceURI,
        lang: 'en-US',
        volume: 1,
        started: true,
        canceled: false,
      });
      expect(line.rate).toBeGreaterThanOrEqual(NARRATION.rateMin);
      expect(line.rate).toBeLessThanOrEqual(NARRATION.rateMax);
    }
    expect(log.lines.slice(0, -1).every((line) => line.ended)).toBe(true);
    expect(await narration(page)).toMatchObject({ spoken: CAPTIONS.length, failed: 0 });

    // Run out to its end, nothing is cut: the last line is let finish and the narrator is done.
    await seekFilm(page, INTRO_SECONDS - 0.3);
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
      timeout: STATE_TIMEOUT,
    });
    await page.waitForFunction(
      () => window.__ashbound?.intro?.narration?.stats.state === 'done',
      null,
      {
        timeout: STATE_TIMEOUT,
      },
    );
    expect((await voiceLog(page)).cancels).toBe(0);
    expect(narratorWarnings(warnings)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('steps the music aside while a line is said, stops the voice the moment the film is skipped or cut, and tells it again from the start when it is watched again', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // A voice that takes its time, so that a line is still being said when the player acts.
    await installVoice(page, { voices: [GOOGLE], perWord: 1500 });
    const { problems, warnings } = await open(page, '?title=on&intro=on&debug&quality=low');
    await waitForTheFilm(page);
    await playTheFilm(page);

    await page.waitForFunction(() => window.__voice?.lines[0]?.started === true, null, {
      timeout: STATE_TIMEOUT,
    });
    await page.waitForFunction(() => window.__ashbound?.intro?.sound?.stats.ducked === true, null, {
      timeout: STATE_TIMEOUT,
    });
    expect(await narration(page)).toMatchObject({ spoken: 1, state: 'speaking' });

    // A key skips the film: the line stops where it is, the music comes back to its place as it fades, and nothing more is said.
    await page.keyboard.press('Space');
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
      timeout: STATE_TIMEOUT,
    });
    const skipped = await voiceLog(page);
    expect(skipped.cancels).toBeGreaterThanOrEqual(1);
    expect(skipped.lines).toHaveLength(1);
    expect(skipped.lines[0]).toMatchObject({ canceled: true, ended: false });
    expect(await narration(page)).toMatchObject({ state: 'done' });
    await page.waitForFunction(
      () => window.__ashbound?.intro?.sound?.stats.state === 'stopped',
      null,
      { timeout: STATE_TIMEOUT },
    );
    expect(await page.evaluate(() => window.__ashbound?.intro?.sound?.stats.ducked)).toBe(false);

    // Watched again from the pause card, the film is told again from its first line.
    await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('.pause')).toBeVisible();
    await page.getByRole('button', { name: 'Watch the intro' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
      timeout: STATE_TIMEOUT,
    });
    await linesSpoken(page, 2);
    await page.waitForFunction(() => window.__voice?.lines[1]?.started === true, null, {
      timeout: STATE_TIMEOUT,
    });
    expect((await voiceLog(page)).lines[1]?.text).toBe(CAPTIONS[0]?.text);

    // Letting go of the mouse cuts the film, and the voice with it.
    await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
      timeout: STATE_TIMEOUT,
    });
    const cut = await voiceLog(page);
    expect(cut.cancels).toBeGreaterThanOrEqual(2);
    expect(cut.lines[1]).toMatchObject({ canceled: true, ended: false });
    expect(cut.lines).toHaveLength(2);
    expect(narratorWarnings(warnings)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('is switched off, and its voice chosen and tried, from the pause card, and the captions tell the film either way', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await installVoice(page, { voices: [DANIEL, GOOGLE, THOMAS] });
    const { problems, warnings } = await open(page, '?debug&intro=on&quality=low');
    await waitForTheFilm(page);
    const narrate = page.getByLabel('Narrate the intro aloud');
    const voice = page.getByLabel('Narrator voice');

    // On to begin with, with the browser's best English voice named, and the others after it.
    await expect(narrate).toBeChecked();
    await expect(voice.locator('option')).toHaveText([
      'Automatic: Google US English',
      'Google US English (en-US)',
      'Test Daniel (en-GB)',
    ]);
    await expect(voice).toHaveValue('');

    // A voice is tried with the film's last words, and kept.
    await voice.selectOption({ value: DANIEL.voiceURI });
    await page.getByRole('button', { name: 'Hear it' }).click();
    await linesSpoken(page, 1);
    expect((await voiceLog(page)).lines[0]).toMatchObject({
      text: SAMPLE_LINE,
      voice: DANIEL.voiceURI,
      lang: 'en-GB',
    });
    expect(await storedSettings(page)).toMatchObject({
      narration: true,
      narrator: DANIEL.voiceURI,
    });

    // Switched off, the choice of voice goes, the choice is kept, and the film is told by its captions alone.
    await narrate.uncheck();
    await expect(voice).toBeHidden();
    expect(await storedSettings(page)).toMatchObject({ narration: false });
    await playTheFilm(page);
    await filmPast(page, 1.5);
    expect(await narration(page)).toBeNull();
    await seekFilm(page, (CAPTIONS[2]?.from ?? 0) + 1);
    await captionIs(page, CAPTIONS[2]?.text);
    const quiet = await voiceLog(page);
    expect(quiet.lines).toHaveLength(1);
    expect(quiet.warms).toEqual([]);

    // Switched on again, the next film is told in the voice that was kept.
    await page.keyboard.press('Space');
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
      timeout: STATE_TIMEOUT,
    });
    await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('.pause')).toBeVisible();
    await narrate.check();
    await expect(voice).toBeVisible();
    await expect(voice).toHaveValue(DANIEL.voiceURI);
    await page.getByRole('button', { name: 'Watch the intro' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
      timeout: STATE_TIMEOUT,
    });
    await linesSpoken(page, 2);
    expect((await voiceLog(page)).lines[1]).toMatchObject({
      text: CAPTIONS[0]?.text,
      voice: DANIEL.voiceURI,
    });

    // A volume of nothing is a film nobody could hear the voice of: it is not asked for.
    await page.keyboard.press('Space');
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
      timeout: STATE_TIMEOUT,
    });
    await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('.pause')).toBeVisible();
    await page.getByLabel('Volume').fill('0');
    await page.getByRole('button', { name: 'Watch the intro' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
      timeout: STATE_TIMEOUT,
    });
    await filmPast(page, 1.5);
    expect(await narration(page)).toBeNull();
    expect((await voiceLog(page)).lines).toHaveLength(2);
    expect(narratorWarnings(warnings)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('tells the film with its captions alone when the browser refuses to speak, and says so once', async ({
    page,
  }) => {
    await installVoice(page, { voices: [GOOGLE], refuse: 'not-allowed' });
    const { problems, warnings } = await open(page, '?title=on&intro=on&debug&quality=low');
    await waitForTheFilm(page);
    await playTheFilm(page);
    await page.waitForFunction(
      () => window.__ashbound?.intro?.narration?.stats.failed === 1,
      null,
      {
        timeout: STATE_TIMEOUT,
      },
    );
    expect(await narration(page)).toMatchObject({ spoken: 0, failed: 1, state: 'done' });

    // The film plays on, and the captions say what the voice would have.
    await filmPast(page, 1.5);
    await seekFilm(page, (CAPTIONS[3]?.from ?? 0) + 1);
    await captionIs(page, CAPTIONS[3]?.text);
    // The browser was asked once: after a refusal the rest of the film's lines are not.
    await filmPast(page, (CAPTIONS[3]?.from ?? 0) + 1.2);
    expect((await voiceLog(page)).lines).toHaveLength(1);

    expect(narratorWarnings(warnings)).toHaveLength(1);
    expect(narratorWarnings(warnings).join('\n')).toContain('captions');
    expect(problems).toEqual([]);
  });

  test('tells the film with its captions alone when the browser has voices and none of them speaks English', async ({
    page,
  }) => {
    await installVoice(page, { voices: [THOMAS] });
    const { problems, warnings } = await open(page, '?debug&intro=on&quality=low');
    await waitForTheFilm(page);
    // The card says so, and has nothing to choose from.
    const voice = page.getByLabel('Narrator voice');
    await expect(voice.locator('option')).toHaveText(['No English voice in this browser']);
    await expect(voice).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Hear it' })).toBeHidden();

    await playTheFilm(page);
    await page.waitForFunction(
      () => window.__ashbound?.intro?.narration?.stats.state === 'done',
      null,
      {
        timeout: STATE_TIMEOUT,
      },
    );
    await filmPast(page, 1.5);
    expect(await narration(page)).toMatchObject({ spoken: 0, failed: 0 });
    expect(await voiceLog(page)).toMatchObject({ lines: [] });
    await seekFilm(page, (CAPTIONS[4]?.from ?? 0) + 1);
    await captionIs(page, CAPTIONS[4]?.text);
    expect(narratorWarnings(warnings)).toHaveLength(1);
    expect(problems).toEqual([]);
  });

  test('keeps a page that is told to be silent silent, and holds no voice for a film held at a moment', async ({
    page,
  }) => {
    await installVoice(page, { voices: [GOOGLE] });
    const { problems, warnings } = await open(
      page,
      '?title=on&intro=on&debug&quality=low&sound=off',
    );
    await waitForTheFilm(page);
    await playTheFilm(page);
    await filmPast(page, 1.5);
    expect(await narration(page)).toBeNull();
    // Not even a silent word to wake a voice that will not be used.
    expect(await voiceLog(page)).toEqual({ lines: [], warms: [], cancels: 0 });
    // The captions are there all the same.
    await seekFilm(page, (CAPTIONS[2]?.from ?? 0) + 1);
    await captionIs(page, CAPTIONS[2]?.text);

    // A film held at a moment, as the pictures of it are taken, has no time passing for a voice to follow.
    await page.goto(`./?debug&introAt=${(CAPTIONS[2]?.from ?? 0) + 1}&quality=low&scale=0.5`);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', {
      timeout: STATE_TIMEOUT,
    });
    await page.waitForFunction(() => !!window.__ashbound?.intro?.playback, null, {
      timeout: STATE_TIMEOUT,
    });
    await captionIs(page, CAPTIONS[2]?.text);
    expect(await narration(page)).toBeNull();
    expect((await voiceLog(page)).lines).toEqual([]);
    expect(narratorWarnings(warnings)).toEqual([]);
    expect(problems).toEqual([]);
  });
});
