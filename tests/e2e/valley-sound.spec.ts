import { expect, test, type Page } from '@playwright/test';
import { DAY_SECONDS, NIGHT_SECONDS } from '../../src/shared/daycycle';
import { ENEMIES } from '../../src/systems/survival/balance';
import { planNight } from '../../src/systems/survival/waves';

// The sound of the valley is made in code, so this is where it is checked in a page: that nothing
// sounds before the page is clicked, that the wind, the Core's hum and the low note start with the
// click, that the music waits while the clock does, that the host's words (nightfall, a wave, the
// dawn) are answered with a sound, and that the intro film has the valley to itself while it
// plays. Nothing here needs speakers: the sound reports what it started.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 150_000 });

const STATE_TIMEOUT = 60_000;
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });

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
  // The run and the sound that follows it load after the game is up.
  await page.waitForFunction(() => !!window.__ashbound?.mp && !!window.__ashbound.sound, null, {
    timeout: STATE_TIMEOUT,
  });
  return problems;
}

/** What the page has made of the sound of the valley. */
interface Heard {
  /** The audio context's state; null when none has been made. */
  context: string | null;
  /** Null when the valley has no sound playing. */
  stats: { voices: number; beds: number; failed: number; state: string } | null;
  scene: { night: number; danger: number; nearCore: number; held: boolean };
  /** The names of everything it started, bed or cue, in order. */
  names: string[];
}

const heard = (page: Page): Promise<Heard> =>
  page.evaluate(() => {
    const app = window.__ashbound;
    const sound = app?.sound;
    if (!sound) throw new Error('window.__ashbound.sound is missing; is ?debug on?');
    const { night, danger, nearCore, held } = sound.scene;
    return {
      context: app?.audio?.hub.context?.state ?? null,
      stats: sound.live ? { ...sound.live.stats } : null,
      scene: { night, danger, nearCore, held },
      names: sound.events.map((event) => event.name),
    };
  });

/** When each thing was started, on the audio clock: for the spacing of a stinger. */
const startedAt = (page: Page, name: string): Promise<number[]> =>
  page.evaluate(
    (name) =>
      (window.__ashbound?.sound?.events ?? [])
        .filter((event) => event.name === name)
        .map((event) => event.when),
    name,
  );

const count = (names: readonly string[], name: string): number =>
  names.filter((entry) => entry === name).length;

/** Moves the run's clock on by `seconds`, a few at a time, taking the machines off the field on the way so that they do not reach the Core. */
const warp = (page: Page, seconds: number): Promise<void> =>
  page.evaluate((total) => {
    const mp = window.__ashbound?.mp;
    if (!mp) throw new Error('window.__ashbound.mp is missing; is ?debug on?');
    mp.clearEnemies();
    for (let left = total; left > 1e-9;) {
      const step = Math.min(10, left);
      mp.warp(step);
      mp.clearEnemies();
      left -= step;
    }
  }, seconds);

const clockAt = (page: Page): Promise<number> =>
  page.evaluate(() => window.__ashbound?.mp?.clock().elapsed ?? -1);

/** Clicks Play: the click unlocks the audio, and the mouse it asks for starts the run's clock. */
async function play(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked', {
    timeout: STATE_TIMEOUT,
  });
}

test.describe('the sound of the valley', () => {
  test('is silent until the page is clicked, then starts the wind, the Core’s hum and the low note, and the music plays only while the clock runs', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&quality=low&stats=0&waves=0');

    await test.step('makes no sound and no audio context before a click', async () => {
      const before = await heard(page);
      expect(before.context).toBeNull();
      expect(before.stats).toBeNull();
      expect(before.names).toEqual([]);
    });

    await test.step('starts the three long sounds with the click on Play, each once', async () => {
      await play(page);
      await poll(async () => (await heard(page)).stats?.beds).toBe(3);
      const now = await heard(page);
      expect(now.context).toBe('running');
      expect(now.stats).toMatchObject({ state: 'playing', failed: 0 });
      expect(now.names.slice(0, 3)).toEqual(['wind', 'hum', 'drone']);
      expect(count(now.names, 'wind') + count(now.names, 'hum') + count(now.names, 'drone')).toBe(
        3,
      );
    });

    await test.step('plays its first note of music once the clock has run for a few seconds', async () => {
      await poll(async () => count((await heard(page)).names, 'pluck')).toBeGreaterThan(0);
      const now = await heard(page);
      expect(now.scene.held).toBe(false);
      expect(now.scene.night).toBe(0);
      // The player stands at the Core's crater on the first morning: its hum is near.
      expect(now.scene.nearCore).toBeGreaterThan(0.5);
    });

    await test.step('makes none while the mouse is free and the clock waits, though the wind goes on', async () => {
      await page.evaluate(() => document.exitPointerLock());
      await poll(async () => (await heard(page)).scene.held).toBe(true);
      const held = await heard(page);
      const cues = (names: readonly string[]): number =>
        names.length - count(names, 'wind') - count(names, 'hum') - count(names, 'drone');
      // A moment for any note that was already due to land, then nothing new.
      await page.waitForTimeout(1500);
      const quiet = cues((await heard(page)).names);
      await page.waitForTimeout(4000);
      const later = await heard(page);
      expect(cues(later.names)).toBe(quiet);
      expect(later.stats?.beds).toBe(3);
      expect(later.stats?.state).toBe('playing');
      expect(held.stats?.failed).toBe(0);
    });

    expect(problems).toEqual([]);
  });

  test('answers the host’s words with a sound: a groan at nightfall, a riser and a drum ahead of each wave, a bell at dawn', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&quality=low&stats=0');
    await play(page);
    await poll(async () => (await heard(page)).stats?.beds).toBe(3);
    const night = planNight(1);
    const first = night.waves[0];
    if (!first) throw new Error('the first night has no waves');

    await test.step('is quiet of stingers all through the day', async () => {
      // To twelve seconds before nightfall, wherever the run's own clock has got to by now.
      await warp(page, DAY_SECONDS - 12 - (await clockAt(page)));
      const { names } = await heard(page);
      for (const name of ['groan', 'riser', 'timp', 'ping']) expect(count(names, name)).toBe(0);
    });

    await test.step('groans as night falls, and the chord turns', async () => {
      const pads = count((await heard(page)).names, 'pad');
      // To a second past it.
      await warp(page, DAY_SECONDS + 1 - (await clockAt(page)));
      await poll(async () => count((await heard(page)).names, 'groan')).toBe(1);
      const { names, scene } = await heard(page);
      // Three notes of the chord, struck together a moment after the groan.
      expect(count(names, 'pad')).toBeGreaterThanOrEqual(pads + 3);
      expect(scene.night).toBeLessThan(1);
    });

    await test.step('climbs and strikes a drum when a wave is about to come, the drum as the climb ends', async () => {
      const at = await clockAt(page);
      // `warnAt` counts from nightfall, which was a second ago.
      await warp(page, DAY_SECONDS + first.warnAt - at + 0.5);
      await poll(async () => count((await heard(page)).names, 'riser')).toBe(1);
      await poll(async () => count((await heard(page)).names, 'timp')).toBeGreaterThanOrEqual(1);
      const [riser] = await startedAt(page, 'riser');
      const drums = await startedAt(page, 'timp');
      // The drum lands as the climb tops out, 3.6 seconds on.
      expect(drums.some((when) => Math.abs(when - (riser as number) - 3.6) < 0.05)).toBe(true);
    });

    await test.step('rings a bell at dawn, after a riser for every wave of the night and a groan for the one night', async () => {
      const at = await clockAt(page);
      await warp(page, DAY_SECONDS + NIGHT_SECONDS - at + 0.5);
      await poll(async () => count((await heard(page)).names, 'ping')).toBe(1);
      const after = await heard(page);
      expect(count(after.names, 'groan')).toBe(1);
      expect(count(after.names, 'riser')).toBe(night.waves.length);
      expect(count(after.names, 'timp')).toBe(night.waves.length);
      expect(after.stats?.failed).toBe(0);
    });

    expect(problems).toEqual([]);
  });

  test('draws a night to samples with no one listening, and it has the shape it is meant to have: a quiet morning, a stinger that rises out of it and a siege louder than a night with the machines far off', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&quality=low&stats=0&waves=0');
    const first = planNight(1).waves[0];
    if (!first) throw new Error('the first night has no waves');
    const LEAD = 20;
    // Long enough for the machines of the first wave to walk in and be fought for a while.
    const SECONDS = 70;

    const analysis = await page.evaluate(
      async ({ lead, seconds, warnAt, comesAt, walk }) => {
        const audio = window.__ashbound?.audio;
        if (!audio) throw new Error('window.__ashbound.audio is missing; is ?debug on?');
        const options = { night: 1, leadIn: lead, seconds, seed: 4242 };
        const db = (power: number): number => 10 * Math.log10(power + 1e-14);

        const measure = ({
          sampleRate: rate,
          left,
          right,
        }: {
          sampleRate: number;
          left: Float32Array;
          right: Float32Array;
        }) => {
          let bad = 0;
          let peak = 0;
          // Running sums of power, so that the power of any stretch is two reads.
          const sums = new Float64Array(left.length + 1);
          for (let i = 0; i < left.length; i++) {
            const l = left[i] as number;
            const r = right[i] as number;
            if (!Number.isFinite(l) || !Number.isFinite(r)) bad++;
            peak = Math.max(peak, Math.abs(l), Math.abs(r));
            sums[i + 1] = (sums[i] as number) + (l * l + r * r) / 2;
          }
          const level = (from: number, to: number): number => {
            const x = Math.min(left.length, Math.floor(from * rate));
            const y = Math.min(left.length, Math.floor(to * rate));
            return db(y > x ? ((sums[y] as number) - (sums[x] as number)) / (y - x) : 0);
          };
          return { rate, length: left.length, bad, peak, level };
        };

        const night = await audio.renderValley(options);
        const heard = measure(night);

        // The same night again: the music is seeded, so the second drawing is the first.
        const twin = await audio.renderValley(options);
        let again = 0;
        for (let i = 0; i < night.left.length; i++) {
          again = Math.max(
            again,
            Math.abs((night.left[i] as number) - (twin.left[i] as number)),
            Math.abs((night.right[i] as number) - (twin.right[i] as number)),
          );
        }

        // And the night again with its machines kept two hundred blocks away: no siege.
        const far = measure(await audio.renderValley({ ...options, holdAt: 200 }));

        // The first wave's stinger tops out at the word, the climb and then the drum; the machines
        // are at the walls a little after they come out of the ground.
        const top = lead + warnAt + 0.2 + 3.6;
        const wall = lead + comesAt + walk;
        return {
          rate: heard.rate,
          length: heard.length,
          bad: heard.bad,
          peak: heard.peak,
          again,
          first: heard.level(0, 0.1),
          morning: heard.level(lead - 10, lead - 1),
          stinger: heard.level(top - 0.05, top + 0.45),
          siege: heard.level(wall + 2, wall + 18),
          farAway: far.level(wall + 2, wall + 18),
        };
      },
      {
        lead: LEAD,
        seconds: SECONDS,
        warnAt: first.warnAt,
        comesAt: first.comesAt,
        walk: (ENEMIES.spawnRadius - 13) / ENEMIES.crawler.speed,
      },
    );

    await test.step('is as long as asked, whole, and clear of the top of the range', () => {
      expect(analysis.rate).toBe(44100);
      expect(analysis.length).toBe(Math.ceil(SECONDS * 44100));
      expect(analysis.bad).toBe(0);
      // Not silent, and under the limiter: the loudest sample of a night's stinger and siege is well short of full scale.
      expect(analysis.peak).toBeGreaterThan(0.1);
      expect(analysis.peak).toBeLessThan(0.7);
    });

    await test.step('comes up out of silence, to a quiet morning', () => {
      expect(analysis.first).toBeLessThan(-70);
      expect(analysis.morning).toBeGreaterThan(-50);
      expect(analysis.morning).toBeLessThan(-25);
    });

    await test.step('tops out the stinger well above the morning', () => {
      expect(analysis.stinger).toBeGreaterThan(analysis.morning + 8);
    });

    await test.step('is louder with the machines at the walls than with the same night’s machines far off', () => {
      expect(analysis.siege).toBeGreaterThan(analysis.farAway + 3);
      expect(analysis.siege).toBeGreaterThan(analysis.morning + 5);
    });

    await test.step('is the same night every time it is drawn', () => {
      // The browser's wave shaper rounds the last digit of a sample either way, so "the same" is
      // the same to a hundred-thousandth of the top of the range.
      expect(analysis.again).toBeLessThan(1e-5);
    });

    expect(problems).toEqual([]);
  });

  test('is kept silent by the page’s own switch', async ({ page }) => {
    const problems = await open(page, '?debug&quality=low&stats=0&waves=0&sound=off');
    await play(page);
    await page.waitForTimeout(3000);
    const now = await heard(page);
    expect(now.context).toBeNull();
    expect(now.stats).toBeNull();
    expect(now.names).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('leaves the valley silent while the intro film plays, and brings it up under the last chord when the film ends or begins again', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&intro=on&quality=low&stats=0&waves=0');
    await page.waitForFunction(() => !!window.__ashbound?.intro, null, { timeout: STATE_TIMEOUT });

    await test.step('plays the film alone', async () => {
      await page.getByRole('button', { name: 'Play' }).click();
      await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
        timeout: STATE_TIMEOUT,
      });
      await page.waitForFunction(
        () => (window.__ashbound?.intro?.playback?.time ?? 0) > 1.5,
        null,
        {
          timeout: STATE_TIMEOUT,
        },
      );
      // The film made the audio context. The valley builds its room behind the film and starts nothing in it.
      await poll(async () => (await heard(page)).stats).not.toBeNull();
      const now = await heard(page);
      expect(now.context).toBe('running');
      expect(now.stats).toMatchObject({ voices: 0, beds: 0, failed: 0, state: 'playing' });
      expect(now.names).toEqual([]);
    });

    await test.step('comes up when the film is skipped', async () => {
      await page.keyboard.press('Space');
      await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
        timeout: STATE_TIMEOUT,
      });
      await poll(async () => (await heard(page)).stats?.beds).toBe(3);
    });

    await test.step('is taken away when the film is watched again, and comes back after it', async () => {
      const first = await page.evaluate(() => window.__ashbound?.sound?.live ?? null);
      expect(first).not.toBeNull();
      await page.evaluate(() => document.exitPointerLock());
      await page.getByRole('button', { name: 'Watch the intro' }).click();
      await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
        timeout: STATE_TIMEOUT,
      });
      // The sound that was playing is faded out and let go of; the one that takes its place has started nothing.
      await poll(async () => (await heard(page)).stats?.beds).toBe(0);
      const during = (await heard(page)).names.length;
      await page.waitForFunction(
        () => (window.__ashbound?.intro?.playback?.time ?? 0) > 1.5,
        null,
        {
          timeout: STATE_TIMEOUT,
        },
      );
      expect((await heard(page)).names.length).toBe(during);
      await page.keyboard.press('Space');
      await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
        timeout: STATE_TIMEOUT,
      });
      await poll(async () => (await heard(page)).stats?.beds).toBe(3);
      // A new sound, built fresh: its three long sounds are the second set the page has started.
      expect(count((await heard(page)).names, 'wind')).toBe(2);
    });

    expect(problems).toEqual([]);
  });

  test('plays the game in silence when the browser cannot make the sound’s room, and says so once and does not try again', async ({
    page,
  }) => {
    // A browser whose audio cannot make the room the sound is set up with.
    await page.addInitScript(() => {
      AudioContext.prototype.createConvolver = function () {
        throw new DOMException('Refused for the test', 'NotSupportedError');
      };
    });
    const problems = await open(page, '?debug&quality=low&stats=0&waves=0');
    await play(page);

    // The sound is asked for on every frame until it is built: give it plenty of them to try again.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let frames = 0;
          const tick = (): void => {
            if (++frames < 40) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        }),
    );

    // The audio is up and the run goes on, and nothing was started.
    const now = await heard(page);
    expect(now.context).toBe('running');
    expect(now.stats).toBeNull();
    expect(now.names).toEqual([]);
    expect(await clockAt(page)).toBeGreaterThan(0);
    // The one complaint is the sound's own.
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('The valley could not make its sound');
  });
});
