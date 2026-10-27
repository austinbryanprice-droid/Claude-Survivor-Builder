import { expect, test, type Page } from '@playwright/test';
import { INTRO_SECONDS, TOUCHDOWN_AT, sceneTime } from '../../src/shared/intro';
import { SOUND_SECONDS } from '../../src/shared/intro-sound';

// The film's sound is made in code, so this is where it is heard: the soundtrack is drawn to
// samples without playing it and measured (loudness, silence, its shape scene by scene), and the
// live film is checked for what a player's page does with it (the click that unlocks the audio,
// the key that fades it, the page that is told to be silent). Nothing here needs speakers.
test.use({ viewport: { width: 960, height: 540 } });

const STATE_TIMEOUT = 60_000;

/** Opens the page and records every console error and uncaught error it has from then on. */
async function open(page: Page, query: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(`./${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', {
    timeout: STATE_TIMEOUT,
  });
  return problems;
}

/** Waits until the film's code has loaded and the run's host is up, so that the first click is the one that starts it. */
async function waitForTheFilm(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.__ashbound?.intro && !!window.__ashbound.mp, null, {
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

/** What the page has made of the film's sound: the audio context, and the film's own counts. */
interface Heard {
  /** Null when no audio context has been made. */
  context: string | null;
  volume: number | null;
  /** Null when the film has no sound. */
  stats: { voices: number; beds: number; skipped: number; failed: number; state: string } | null;
}

const heard = (page: Page): Promise<Heard> =>
  page.evaluate(() => {
    const app = window.__ashbound;
    const sound = app?.intro?.sound;
    return {
      context: app?.audio?.hub.context?.state ?? null,
      volume: app?.audio?.hub.volume ?? null,
      stats: sound ? { ...sound.stats } : null,
    };
  });

const soundState = (page: Page): Promise<string | null> =>
  page.evaluate(() => window.__ashbound?.intro?.sound?.stats.state ?? null);

test.describe('the intro film’s sound', () => {
  // Each of these builds a film's worth of scenery and waits on a few frames a second of software
  // rendering, which is longer than the default 30 s on a slow machine.
  test.describe.configure({ timeout: 120_000 });

  test('is a soundtrack with the shape it was written to have: silent to begin with, a great hit at the touchdown, quiet in the crater, muffled behind the closed eyes, and fading to nothing', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const problems = await open(page, '?debug&quality=low&title=off');
    await page.waitForFunction(() => !!window.__ashbound?.audio, null, { timeout: STATE_TIMEOUT });

    const scenes = [
      ['sky', 0, sceneTime('skid', 0)],
      ['skid', sceneTime('skid', 0), sceneTime('crater', 0)],
      ['crater', sceneTime('crater', 0), sceneTime('eyes', 0)],
      ['eyes', sceneTime('eyes', 0), sceneTime('dawn', 0)],
      ['dawn', sceneTime('dawn', 0), sceneTime('wake', 0)],
      ['wake', sceneTime('wake', 0), INTRO_SECONDS],
      ['tail', INTRO_SECONDS, SOUND_SECONDS],
    ] as const;
    // The seconds just before the touchdown, where the whole mix is dipped for a breath.
    const duckFrom = TOUCHDOWN_AT - 0.18;

    const analysis = await test.step('draws the whole soundtrack to samples and measures it', () =>
      page.evaluate(
        async ({ scenes, touchdown, duckFrom, wake }) => {
          const audio = window.__ashbound?.audio;
          if (!audio) throw new Error('window.__ashbound.audio is missing; is ?debug on?');
          const { sampleRate: rate, left, right } = await audio.render({ volume: 1 });

          const db = (power: number): number => 10 * Math.log10(power + 1e-14);
          const length = left.length;
          // Running sums of power, so that the power of any stretch is two reads.
          const sums = new Float64Array(length + 1);
          let bad = 0;
          let peak = 0;
          let cross = 0;
          let powerL = 0;
          let powerR = 0;
          for (let i = 0; i < length; i++) {
            const l = left[i] as number;
            const r = right[i] as number;
            if (!Number.isFinite(l) || !Number.isFinite(r)) bad++;
            peak = Math.max(peak, Math.abs(l), Math.abs(r));
            cross += l * r;
            powerL += l * l;
            powerR += r * r;
            sums[i + 1] = (sums[i] as number) + (l * l + r * r) / 2;
          }
          const power = (from: number, to: number): number => {
            const a = Math.min(length, Math.floor(from * rate));
            const b = Math.min(length, Math.floor(to * rate));
            return b > a ? ((sums[b] as number) - (sums[a] as number)) / (b - a) : 0;
          };
          // How much of a stretch is fast movement: the size of the sample-to-sample change against the size of the sample.
          const busy = (from: number, to: number): number => {
            const a = Math.floor(from * rate) + 1;
            const b = Math.floor(to * rate);
            let diff = 0;
            let all = 0;
            for (let i = a; i < b; i++) {
              const d = (left[i] as number) - (left[i - 1] as number);
              diff += d * d;
              all += (left[i] as number) ** 2;
            }
            return Math.sqrt(diff / (all + 1e-18));
          };

          // The loudest tenth of a second, to the nearest hundredth.
          const span = Math.floor(0.05 * rate);
          let loudest = 0;
          let loudestAt = 0;
          for (let i = 0; i + span < length; i += Math.floor(0.01 * rate)) {
            const p = ((sums[i + span] as number) - (sums[i] as number)) / span;
            if (p > loudest) {
              loudest = p;
              loudestAt = i / rate;
            }
          }

          const scenePower: Record<string, number> = {};
          for (const [name, from, to] of scenes) scenePower[name] = db(power(from, to));
          return {
            rate,
            length,
            seconds: length / rate,
            bad,
            peak,
            first: db(power(0, 0.25)),
            last: db(power(length / rate - 0.05, length / rate)),
            scenes: scenePower,
            loudestAt,
            before: db(power(touchdown - 0.7, touchdown - 0.3)),
            duck: db(power(duckFrom, touchdown - 0.02)),
            after: db(power(touchdown, touchdown + 0.1)),
            open: busy(wake - 3, wake - 0.5),
            shut: busy(wake + 0.1, wake + 0.8),
            correlation: cross / Math.sqrt(powerL * powerR),
          };
        },
        {
          scenes,
          touchdown: TOUCHDOWN_AT,
          duckFrom,
          wake: sceneTime('wake', 0),
        },
      ));

    await test.step('is as long as the film and its tail, whole, and clear of the top', () => {
      expect(analysis.rate).toBe(44100);
      expect(analysis.length).toBe(Math.ceil(SOUND_SECONDS * 44100));
      expect(analysis.bad).toBe(0);
      expect(analysis.peak).toBeGreaterThan(0.3);
      // Full volume peaks a little under the top of the range, as it was set to.
      expect(analysis.peak).toBeLessThan(0.99);
    });

    await test.step('begins in silence and ends in it', () => {
      expect(analysis.first).toBeLessThan(-90);
      expect(analysis.last).toBeLessThan(-55);
    });

    await test.step('has its loudest moment at the touchdown, preceded by the dip of a held breath', () => {
      expect(analysis.loudestAt).toBeGreaterThan(TOUCHDOWN_AT - 0.1);
      expect(analysis.loudestAt).toBeLessThan(TOUCHDOWN_AT + 1);
      expect(analysis.duck).toBeLessThan(analysis.before - 8);
      expect(analysis.duck).toBeLessThan(analysis.after - 15);
    });

    await test.step('is loudest in the skid, quieter in the crater, and dies away after the picture ends', () => {
      const { skid, crater, wake, tail, sky, eyes, dawn } = analysis.scenes as Record<
        string,
        number
      >;
      for (const level of [sky, skid, crater, eyes, dawn, wake]) {
        expect(level).toBeGreaterThan(-32);
        expect(level).toBeLessThan(-10);
      }
      for (const level of [sky, crater, eyes, dawn, wake]) {
        expect(level as number).toBeLessThan((skid as number) - 4);
      }
      expect(crater).toBeLessThan((skid as number) - 6);
      expect(tail).toBeLessThan((wake as number) - 6);
      expect(tail).toBeGreaterThan(-60);
    });

    await test.step('is muffled behind the survivor’s closed eyes and clear again when they open', () => {
      expect(analysis.shut).toBeLessThan(analysis.open * 0.6);
    });

    await test.step('is two ears’ worth, not one sound in both', () => {
      expect(Math.abs(analysis.correlation)).toBeLessThan(0.97);
    });

    await test.step('is the same sound every time it is drawn, and the volume slider only turns it down', () =>
      page
        .evaluate(async () => {
          const audio = window.__ashbound?.audio;
          if (!audio) throw new Error('window.__ashbound.audio is missing; is ?debug on?');
          const a = await audio.render({ volume: 1, seconds: 9 });
          const b = await audio.render({ volume: 1, seconds: 9 });
          const half = await audio.render({ volume: 0.5, seconds: 9 });
          let again = 0;
          let scaled = 0;
          let peak = 0;
          for (const key of ['left', 'right'] as const) {
            const x = a[key];
            const y = b[key];
            const z = half[key];
            for (let i = 0; i < x.length; i++) {
              again = Math.max(again, Math.abs((x[i] as number) - (y[i] as number)));
              // The slider is squared: half way is a quarter of the gain, after the limiter.
              scaled = Math.max(scaled, Math.abs(0.25 * (x[i] as number) - (z[i] as number)));
              peak = Math.max(peak, Math.abs(x[i] as number));
            }
          }
          return { again, scaled, peak };
        })
        .then(({ again, scaled, peak }) => {
          expect(peak).toBeGreaterThan(0.05);
          // The browser's wave shaper rounds the last digit of a sample one way in one drawing and
          // another in the next, so "the same" means the same to a hundred-thousandth of the top
          // of the range. A sound with any chance left in it would differ by a thousand times more.
          expect(again).toBeLessThan(1e-5);
          expect(scaled).toBeLessThan(1e-5);
        }));

    expect(problems).toEqual([]);
  });

  test('is unlocked by the click on Play, heard with the picture as the film plays, and faded out by a key', async ({
    page,
  }) => {
    const problems = await open(page, '?title=on&intro=on&debug&quality=low');
    await waitForTheFilm(page);

    // Before the click there is no audio context to unlock, and no sound to play.
    expect(await heard(page)).toEqual({ context: null, volume: 1, stats: null });

    await page.getByRole('button', { name: 'Play' }).click();
    await filmPast(page, 3);
    const playing = await heard(page);
    expect(playing.context).toBe('running');
    expect(playing.stats).toMatchObject({ state: 'playing', skipped: 0, failed: 0 });
    // The fall has begun: its wind, drone and roar are running and the hull has groaned.
    expect(playing.stats?.beds).toBeGreaterThanOrEqual(2);
    expect(playing.stats?.voices).toBeGreaterThan(0);

    // A key fades the sound with the picture, and takes it apart when it has gone.
    await page.keyboard.press('Space');
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
      timeout: STATE_TIMEOUT,
    });
    await page.waitForFunction(
      () => window.__ashbound?.intro?.sound?.stats.state === 'stopped',
      null,
      { timeout: STATE_TIMEOUT },
    );
    const after = await heard(page);
    expect(after.stats?.failed).toBe(0);
    // The page's audio goes on being ready for the game.
    expect(after.context).toBe('running');
    expect(problems).toEqual([]);
  });

  test('is cut off at once when the mouse is let go, and the click on the pause card unlocks it for a film started from there', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&intro=on&quality=low');
    await waitForTheFilm(page);
    expect((await heard(page)).context).toBeNull();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
      timeout: STATE_TIMEOUT,
    });
    await filmPast(page, 1);
    expect((await heard(page)).context).toBe('running');
    expect(await soundState(page)).toBe('playing');

    await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
      timeout: STATE_TIMEOUT,
    });
    await page.waitForFunction(
      () => window.__ashbound?.intro?.sound?.stats.state === 'stopped',
      null,
      { timeout: STATE_TIMEOUT },
    );
    expect((await heard(page)).stats?.failed).toBe(0);

    // Watching it again from the card hears it again, from the start.
    await page.getByRole('button', { name: 'Watch the intro' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
      timeout: STATE_TIMEOUT,
    });
    await filmPast(page, 1);
    expect(await soundState(page)).toBe('playing');
    expect(problems).toEqual([]);
  });

  test('stays silent for a page that is told to be, and makes no audio context', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&intro=on&quality=low&sound=off');
    await waitForTheFilm(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
      timeout: STATE_TIMEOUT,
    });
    await filmPast(page, 1);
    expect(await heard(page)).toEqual({ context: null, volume: 1, stats: null });
    expect(problems).toEqual([]);
  });

  test('stays silent for a player who has turned the volume to nothing, and has its sound when they turn it up and watch again', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&intro=on&quality=low');
    await waitForTheFilm(page);
    await page.getByLabel('Volume').fill('0');
    expect((await heard(page)).volume).toBe(0);
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
      timeout: STATE_TIMEOUT,
    });
    await filmPast(page, 1);
    expect(await heard(page)).toEqual({ context: null, volume: 0, stats: null });

    // Turned up from the pause card, the next film is heard.
    await page.keyboard.press('Space');
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
      timeout: STATE_TIMEOUT,
    });
    await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('.pause')).toBeVisible();
    await page.getByLabel('Volume').fill('0.6');
    expect((await heard(page)).volume).toBeCloseTo(0.6, 9);
    await page.getByRole('button', { name: 'Watch the intro' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
      timeout: STATE_TIMEOUT,
    });
    await filmPast(page, 1);
    const now = await heard(page);
    expect(now.context).toBe('running');
    expect(now.stats?.state).toBe('playing');
    expect(problems).toEqual([]);
  });

  test('plays the film in silence when the browser cannot make its sound, and the run still begins', async ({
    page,
  }) => {
    // A browser whose audio cannot make the room the sound is set up with.
    await page.addInitScript(() => {
      AudioContext.prototype.createConvolver = function () {
        throw new DOMException('Refused for the test', 'NotSupportedError');
      };
    });
    const problems = await open(page, '?debug&intro=on&quality=low');
    await waitForTheFilm(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
      timeout: STATE_TIMEOUT,
    });
    await filmPast(page, 1);
    // The audio is up for the game, and the film has no sound to follow.
    expect(await heard(page)).toEqual({ context: 'running', volume: 1, stats: null });

    // A key skips the film, and the run is there with the mouse in hand.
    await page.keyboard.press('Space');
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
      timeout: STATE_TIMEOUT,
    });
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
    // The only complaint is the sound's own, once.
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('could not make its sound');
  });
});
