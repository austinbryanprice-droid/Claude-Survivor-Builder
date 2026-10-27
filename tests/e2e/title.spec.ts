import { expect, test, type Page, type Route } from '@playwright/test';
import { TITLE } from '../../src/shared/title';
import { TITLE_VIEWS } from '../../src/world/terrain/viewpoints';

// The title screen runs in the same software-rendered loop as the game, a few frames a second, so
// these tests wait on its state rather than on the clock, and use the Low preset to go faster.
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

/** Waits until the run's host is up, so that what Play starts is the whole run and not half of it. */
const waitForTheRun = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => !!window.__ashbound?.mp, null, { timeout: STATE_TIMEOUT });

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

/** Where the title is: waiting for Play, fading out, gliding into the run, or gone. */
const phase = (page: Page): Promise<string | null> =>
  page.evaluate(() => window.__ashbound?.title?.phase ?? null);

/** What the mouse is doing, as the game sees it. */
const mouse = (page: Page): Promise<{ captured: boolean; locked: boolean; held: boolean }> =>
  page.evaluate(() => {
    const input = window.__ashbound?.game.input;
    if (!input) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
    return { captured: input.captured, locked: input.locked, held: input.held };
  });

const play = (page: Page) => page.getByRole('button', { name: 'Play' });

test.describe('the title screen', () => {
  // Each of these builds the valley and waits on a few frames a second of software rendering.
  test.describe.configure({ timeout: 90_000 });

  test('opens the page on the name of the game and one Play button, with the valley drifting behind and nobody playing yet', async ({
    page,
  }) => {
    const problems = await open(page, '?title=on&debug&quality=low');
    await waitForTheRun(page);

    await expect(page.locator('.title')).toBeVisible();
    await expect(page.getByRole('heading', { name: TITLE.name })).toBeVisible();
    await expect(page.locator('.title-tagline')).toHaveText(TITLE.tagline);
    await expect(play(page)).toBeVisible();
    await expect(play(page)).toHaveCount(1);
    // Nothing else is in the way: no pause card, no HUD.
    await expect(page.locator('.pause')).toBeHidden();
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on');
    await expect(page.locator('body')).toHaveClass(/title-showing/);

    // The camera is the title's own, over the valley, and it drifts.
    const first = TITLE_VIEWS[0];
    await framesPassed(page, 3);
    const before = await page.evaluate(() => ({
      seconds: window.__ashbound?.title?.seconds ?? -1,
      x: window.__ashbound?.stage.camera.position.x ?? NaN,
      z: window.__ashbound?.stage.camera.position.z ?? NaN,
    }));
    expect(Math.hypot(before.x - first.x, before.z - first.z)).toBeLessThan(3);
    expect(before.seconds).toBeGreaterThan(0);
    await framesPassed(page, 3);
    expect(await page.evaluate(() => window.__ashbound?.title?.seconds ?? -1)).toBeGreaterThan(
      before.seconds,
    );
    expect(await phase(page)).toBe('waiting');

    // Nobody has the mouse, and the run's clock has not started.
    expect(await mouse(page)).toEqual({ captured: false, locked: false, held: false });
    expect(await page.evaluate(() => window.__ashbound?.mp?.clock().running)).toBe(false);
    expect(problems).toEqual([]);
  });

  test('plays the intro film from Play, with the mouse in hand but the game deaf to it, and a key skips into the run', async ({
    page,
  }) => {
    const problems = await open(page, '?title=on&intro=on&debug&quality=low');
    await waitForTheRun(page);
    await page.waitForFunction(() => !!window.__ashbound?.intro, null, { timeout: STATE_TIMEOUT });
    await play(page).click();

    // The picture fades to black, and the film opens out of it; the title is gone by then.
    expect(['leaving', 'done']).toContain(await phase(page));
    await page.waitForFunction(() => (window.__ashbound?.intro?.playback?.time ?? 0) > 1, null, {
      timeout: STATE_TIMEOUT,
    });
    await expect(page.locator('.intro')).toBeVisible();
    await expect(page.locator('.title')).toBeHidden({ timeout: STATE_TIMEOUT });
    await expect(page.locator('body')).not.toHaveClass(/title-showing/);
    await expect(page.locator('body')).toHaveClass(/intro-playing/);
    expect(await phase(page)).toBe('done');
    expect(await mouse(page)).toEqual({ captured: true, locked: false, held: true });
    expect(await page.evaluate(() => window.__ashbound?.mp?.clock().running)).toBe(false);

    // A key skips it, and the run is there with the same mouse in hand.
    await page.keyboard.press('Space');
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
      timeout: STATE_TIMEOUT,
    });
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
    await expect(page.locator('.pause')).toBeHidden();
    await page.waitForFunction(() => window.__ashbound?.mp?.clock().running === true, null, {
      timeout: STATE_TIMEOUT,
    });
    expect(problems).toEqual([]);
  });

  test('glides into the run when the film is off, with no cut, and hands the player the mouse', async ({
    page,
  }) => {
    const problems = await open(page, '?title=on&intro=off&debug&quality=low');
    await waitForTheRun(page);
    await play(page).click();

    // The words go at once and the camera flies to the player's own view. The glide lasts under two
    // seconds, so the mouse is read in the page on the frame that finds it gliding: a round trip
    // slowed by a busy page would otherwise read it after the glide had handed it over.
    const gliding = await page.waitForFunction(
      () => {
        const app = window.__ashbound;
        if (app?.title?.phase !== 'gliding') return false;
        return { locked: app.game.input.locked, held: app.game.input.held };
      },
      null,
      { timeout: STATE_TIMEOUT },
    );
    expect(await gliding.jsonValue()).toEqual({ locked: false, held: true });
    await expect(page.locator('.title-card')).toHaveCSS('opacity', '0');

    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off', {
      timeout: STATE_TIMEOUT,
    });
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
    await expect(page.locator('.title')).toBeHidden({ timeout: STATE_TIMEOUT });
    await expect(page.locator('.pause')).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/title-showing/);
    expect(await phase(page)).toBe('done');
    expect(await mouse(page)).toEqual({ captured: true, locked: true, held: false });
    // No film was asked for, so none was even loaded, and with no sound to make the click made no audio context.
    expect(await page.evaluate(() => window.__ashbound?.intro ?? null)).toBeNull();
    expect(
      await page.evaluate(() => window.__ashbound?.audio?.hub.context?.state ?? null),
    ).toBeNull();
    await page.waitForFunction(() => window.__ashbound?.mp?.clock().running === true, null, {
      timeout: STATE_TIMEOUT,
    });
    expect(problems).toEqual([]);
  });

  test('stays on the title with a hint when the browser will not hand over the mouse', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.requestPointerLock = function () {
        document.dispatchEvent(new Event('pointerlockerror'));
        return Promise.reject(new DOMException('Refused for the test', 'NotAllowedError'));
      };
    });
    const problems = await open(page, '?title=on&intro=off&debug&quality=low');
    await waitForTheRun(page);
    await play(page).click();

    await expect(page.locator('.title-hint')).toContainText('did not hand over the mouse', {
      timeout: STATE_TIMEOUT,
    });
    await expect(page.locator('.title')).toHaveAttribute('data-leaving', 'no');
    await expect(play(page)).toBeVisible();
    expect(await phase(page)).toBe('waiting');
    expect((await mouse(page)).held).toBe(false);
    // The run is still waiting behind it, and the camera has not left the title.
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'on');
    expect(await page.evaluate(() => window.__ashbound?.mp?.clock().running)).toBe(false);
    expect(problems).toEqual([]);
  });

  test('comes back when the mouse is let go of before the film starts, and the next Play starts it', async ({
    page,
  }) => {
    // Hold the film's code back, so that the title waits in black for it and there is a moment to let go.
    const held: Route[] = [];
    await page.route(/attach-intro-.*\.js/, (route) => {
      held.push(route);
    });
    const problems = await open(page, '?title=on&intro=on&debug&quality=low');
    await waitForTheRun(page);
    await play(page).click();
    await page.waitForFunction(
      () => window.__ashbound?.title?.phase === 'leaving' && window.__ashbound.game.input.captured,
      null,
      { timeout: STATE_TIMEOUT },
    );
    await expect(page.locator('.title')).toHaveAttribute('data-leaving', 'black');

    await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('.title')).toHaveAttribute('data-leaving', 'no', {
      timeout: STATE_TIMEOUT,
    });
    await expect(play(page)).toBeVisible();
    expect(await phase(page)).toBe('waiting');
    expect((await mouse(page)).held).toBe(false);

    // The film's code arrives, and Play starts the film from the title again.
    for (const route of held) await route.continue();
    await page.waitForFunction(() => !!window.__ashbound?.intro, null, { timeout: STATE_TIMEOUT });
    await play(page).click();
    await page.waitForFunction(() => (window.__ashbound?.intro?.playback?.time ?? 0) > 1, null, {
      timeout: STATE_TIMEOUT,
    });
    await expect(page.locator('.title')).toBeHidden({ timeout: STATE_TIMEOUT });
    expect(problems).toEqual([]);
  });

  test('glides into the run instead when the film cannot be loaded', async ({ page }) => {
    await page.route(/attach-intro-.*\.js/, (route) => route.abort());
    const problems = await open(page, '?title=on&intro=on&debug&quality=low');
    await waitForTheRun(page);
    await play(page).click();

    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked', {
      timeout: STATE_TIMEOUT,
    });
    await expect(page.locator('#hud')).toHaveAttribute('data-intro', 'off');
    await expect(page.locator('.title')).toBeHidden({ timeout: STATE_TIMEOUT });
    expect(await phase(page)).toBe('done');
    expect(await mouse(page)).toEqual({ captured: true, locked: true, held: false });
    // The only complaints are about the film's code, which was not to be had.
    expect(problems.filter((problem) => !/intro could not load|Failed to/i.test(problem))).toEqual(
      [],
    );
  });
});
