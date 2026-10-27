import { expect, test, type Page } from '@playwright/test';
import { CAPTIONS, INTRO_SECONDS, INTRO_TITLE, sceneTime } from '../../src/shared/intro';

// The film runs in the same software-rendered loop as the game, a few frames a second, and a long
// frame is capped at a tenth of a second of film time. So these tests wait on its state rather
// than on the clock, hold it at a moment where they can, and use the Low preset to go faster.
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

/** Waits for the game to draw `count` more frames. */
const framesPassed = (page: Page, count: number): Promise<void> =>
  page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const game = window.__ashbound?.game;
        if (!game) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
        const stop = game.onFrame(() => {
          if (--left <= 0) {
            stop();
            resolve();
          }
        });
      }),
    count,
  );

/** Seconds into the film that is playing, or null when none is. */
const filmTime = (page: Page): Promise<number | null> =>
  page.evaluate(() => window.__ashbound?.intro?.playback?.time ?? null);

/** Clicks Play and waits until the film is on the screen and moving, past the moment it ignores skips. */
async function startTheFilm(page: Page): Promise<void> {
  await waitForTheFilm(page);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
    timeout: STATE_TIMEOUT,
  });
  await page.waitForFunction(() => (window.__ashbound?.intro?.playback?.time ?? 0) > 1, null, {
    timeout: STATE_TIMEOUT,
  });
}

test.describe('the intro film', () => {
  // Each of these builds a film's worth of scenery and waits on a few frames a second of software
  // rendering, which is longer than the default 30 s on a slow machine.
  test.describe.configure({ timeout: 90_000 });

  test('opens a fresh run from the click on Play and hands the same mouse to the player when a key skips it', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&intro=on&quality=low');
    await startTheFilm(page);

    // It has the screen to itself: bars and captions over the picture, no pause card, no HUD.
    await expect(page.locator('.intro')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/intro-playing/);
    await expect(page.locator('.pause')).toBeHidden();

    // The mouse is in hand from the click, but the game is deaf to it, and nobody is playing the
    // run yet, so its clock has not started.
    const during = await page.evaluate(() => {
      const app = window.__ashbound;
      if (!app?.mp) throw new Error('the run is not up');
      const { input } = app.game;
      return {
        captured: input.captured,
        locked: input.locked,
        held: input.held,
        running: app.mp.clock().running,
        elapsed: app.mp.clock().elapsed,
      };
    });
    expect(during).toEqual({
      captured: true,
      locked: false,
      held: true,
      running: false,
      elapsed: 0,
    });

    // Any key skips it: the picture goes black, and then there is the run, with the mouse still in hand.
    await page.keyboard.press('Space');
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
      timeout: STATE_TIMEOUT,
    });
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
    await expect(page.locator('.intro')).toBeHidden({ timeout: STATE_TIMEOUT });
    await expect(page.locator('body')).not.toHaveClass(/intro-playing/);
    expect(await filmTime(page)).toBeNull();
    await page.waitForFunction(() => window.__ashbound?.mp?.clock().running === true, null, {
      timeout: STATE_TIMEOUT,
    });
    expect(problems).toEqual([]);
  });

  test('letting go of the mouse ends it at once and leaves the pause card, and the next Play is the run itself', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&intro=on&quality=low');
    await startTheFilm(page);

    await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
      timeout: STATE_TIMEOUT,
    });
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'free');
    await expect(page.locator('.pause')).toBeVisible();
    await expect(page.locator('.intro')).toBeHidden();
    expect(await filmTime(page)).toBeNull();

    // Having left the film, the player is not shown it again by the button that starts the run.
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked', {
      timeout: STATE_TIMEOUT,
    });
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off');
    expect(await filmTime(page)).toBeNull();
    expect(problems).toEqual([]);
  });

  test('can be watched again from the pause card, and is only offered once to a page', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&intro=on&quality=low');
    await startTheFilm(page);
    await page.keyboard.press('Space');
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
      timeout: STATE_TIMEOUT,
    });
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');

    // Back to the pause card and into the run again: no second film.
    await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('.pause')).toBeVisible();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked', {
      timeout: STATE_TIMEOUT,
    });
    expect(await filmTime(page)).toBeNull();

    // But the card has a button for it.
    await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('.pause')).toBeVisible();
    await page.getByRole('button', { name: 'Watch the intro' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
      timeout: STATE_TIMEOUT,
    });
    await page.waitForFunction(() => (window.__ashbound?.intro?.playback?.time ?? 0) > 0.3, null, {
      timeout: STATE_TIMEOUT,
    });
    expect(problems).toEqual([]);
  });

  test('keeps the film when the page is too busy to read the browser’s answer about the mouse in time', async ({
    page,
  }) => {
    // The film gives up on the mouse after two and a half seconds. A page that is stalled for longer
    // than that right after asking (the film's shaders compiling in its first frame, a slow machine)
    // comes to that timer before it has read the answer the browser sent meanwhile, and must not
    // take its own silence for a refusal.
    await page.addInitScript(() => {
      const request = HTMLCanvasElement.prototype.requestPointerLock;
      HTMLCanvasElement.prototype.requestPointerLock = function (
        ...args: Parameters<typeof request>
      ) {
        const result = request.apply(this, args);
        const until = performance.now() + 3500;
        while (performance.now() < until) {
          // busy: nothing the browser says is read until this returns
        }
        return result;
      };
    });
    const problems = await open(page, '?debug&intro=on&quality=low');
    await waitForTheFilm(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
      timeout: STATE_TIMEOUT,
    });
    await page.waitForFunction(() => (window.__ashbound?.intro?.playback?.time ?? 0) > 1.5, null, {
      timeout: STATE_TIMEOUT,
    });
    const mouse = await page.evaluate(() => {
      const input = window.__ashbound?.game.input;
      return { captured: input?.captured, held: input?.held };
    });
    expect(mouse).toEqual({ captured: true, held: true });
    expect(problems).toEqual([]);
  });

  test('stays out of the way of a run that is not fresh, of the plain page under automation, and of an off switch', async ({
    page,
  }) => {
    // A scripted browser is not shown it unless the URL asks: the test pages of every other spec rely on that.
    const problems = await open(page, '?debug&quality=low');
    await page.waitForFunction(() => !!window.__ashbound?.mp, null, { timeout: STATE_TIMEOUT });
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked', {
      timeout: STATE_TIMEOUT,
    });
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off');
    expect(await page.evaluate(() => window.__ashbound?.intro ?? null)).toBeNull();
    expect(problems).toEqual([]);

    // `?intro=off` wins over `?intro=on` coming from anywhere else.
    await page.goto('./?debug&intro=off&quality=low');
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', {
      timeout: STATE_TIMEOUT,
    });
    await page.waitForFunction(() => !!window.__ashbound?.mp, null, { timeout: STATE_TIMEOUT });
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked', {
      timeout: STATE_TIMEOUT,
    });
    expect(await page.evaluate(() => window.__ashbound?.intro?.playback ?? null)).toBeNull();
  });

  test('starts by itself at the first Play of a plain page, calmer for a system that asks for less motion, and a key ends it', async ({
    page,
  }) => {
    // A system that asks for less motion must not leave the film out, only turn it down: the player
    // cannot see that their system said so, and would find Play going straight into the run.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Playwright's browser says a script drives it, which is what keeps the film out of every other
    // spec; a person's browser does not say so.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
    });
    const problems = await open(page, '?quality=low');
    // The film's code has loaded once its overlay is in the page.
    await page.locator('.intro').waitFor({ state: 'attached', timeout: STATE_TIMEOUT });
    // A plain page opens on the title screen, and the film starts from its Play.
    await expect(page.locator('.title')).toBeVisible();
    await page.getByRole('button', { name: 'Play' }).click();

    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on', {
      timeout: STATE_TIMEOUT,
    });
    await expect(page.locator('.intro')).toBeVisible();
    await expect(page.locator('.title')).toBeHidden({ timeout: STATE_TIMEOUT });
    await expect(page.locator('.pause')).toBeHidden();
    await expect(page.locator('.intro-flash')).toHaveCSS('filter', 'opacity(0.35)');

    // The prompt to skip comes up a second and a half in, which is past the moment it ignores skips.
    await expect(page.locator('.intro-skip')).not.toHaveCSS('opacity', '0', {
      timeout: STATE_TIMEOUT,
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
      timeout: STATE_TIMEOUT,
    });
    await expect(page.locator('body')).not.toHaveClass(/intro-playing/);
    await expect(page.locator('.intro')).toBeHidden({ timeout: STATE_TIMEOUT });
    expect(problems).toEqual([]);
  });

  test('draws every scene of the film without a shader error, with its caption and its title where the script says', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // The slowest of the film's tests (over three minutes on a slow runner), so it draws at half the
    // render scale and waits two frames a moment: a shader error, the caption and the title do not
    // depend on either.
    const problems = await open(page, '?debug&introAt=3&quality=low&scale=0.5');
    await page.waitForFunction(() => !!window.__ashbound?.intro?.playback, null, {
      timeout: STATE_TIMEOUT,
    });
    const caption = page.locator('.intro-caption');
    const title = page.locator('.intro-name');

    // One moment in each scene, and the end of the film, which is the hand-over to the player's own view.
    const moments = [
      sceneTime('skyfall', 4),
      sceneTime('skid', 2),
      sceneTime('skid', 5),
      sceneTime('crater', 4),
      sceneTime('eyes', 4),
      sceneTime('dawn', 5.2),
      sceneTime('wake', 2),
      INTRO_SECONDS,
    ];
    for (const moment of moments) {
      await page.evaluate((seconds) => window.__ashbound?.intro?.playback?.seek(seconds), moment);
      await framesPassed(page, 2);
      expect(await filmTime(page)).toBeCloseTo(moment, 6);
      const seen = await page.evaluate(() => {
        const opacity = (selector: string): number =>
          Number.parseFloat(getComputedStyle(document.querySelector(selector) as Element).opacity);
        return {
          caption: document.querySelector('.intro-caption')?.textContent ?? '',
          captionOpacity: opacity('.intro-caption'),
          titleOpacity: opacity('.intro-title'),
        };
      });
      const spoken = CAPTIONS.find((line) => moment > line.from + 0.8 && moment < line.to - 0.8);
      if (spoken) {
        expect(seen.caption, `at ${moment}`).toBe(spoken.text);
        expect(seen.captionOpacity).toBeGreaterThan(0.9);
      }
      if (moment === sceneTime('dawn', 5.2)) {
        await expect(title).toHaveText(INTRO_TITLE.title);
        expect(seen.titleOpacity).toBeGreaterThan(0.9);
      } else {
        expect(seen.titleOpacity).toBeLessThan(0.1);
      }
    }
    await expect(caption).toBeAttached();
    expect(problems).toEqual([]);
  });
});
