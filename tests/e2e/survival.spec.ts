import { expect, test, type Page } from '@playwright/test';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });

const STATE_TIMEOUT = 45_000;
/** The length of the day, in seconds (src/shared/daycycle.ts). */
const DAY_SECONDS = 480;

async function open(page: Page, query: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(`./${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  // Playing together loads after the game is up, and the run lives in it.
  await page.waitForFunction(() => !!window.__ashbound?.mp, null, { timeout: STATE_TIMEOUT });
  return problems;
}

interface Clock {
  elapsed: number;
  cycle: number;
  phase: 'day' | 'night';
  left: number;
  running: boolean;
}

const clock = (page: Page): Promise<Clock> =>
  page.evaluate(() => {
    const mp = window.__ashbound?.mp;
    if (!mp) throw new Error('window.__ashbound.mp is missing; is the ?debug switch on?');
    return mp.clock();
  });

const skyNight = (page: Page): Promise<number> =>
  page.evaluate(() => window.__ashbound?.stage.sky.night ?? -1);

test.describe('the day and night clock', () => {
  test.describe.configure({ timeout: 120_000 });

  test('runs while the player plays, waits while they are away, and the light follows it', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&quality=low&waves=0');

    // The first morning: the pill by the compass, the line on the pause card and a bright sky.
    await expect(page.locator('.ph-clock')).toContainText('Day 1');
    await expect(page.locator('.ph-clock')).toContainText('8:00');
    await expect(page.locator('.run-line')).toContainText('Day 1 · 8:00 until nightfall');
    await expect(page.locator('.ph-banner-title')).toHaveText('Build up before nightfall');
    expect(await skyNight(page)).toBe(0);

    // With the mouse free the clock waits.
    expect(await clock(page)).toMatchObject({ elapsed: 0, running: false });
    await page.waitForTimeout(1500);
    expect((await clock(page)).elapsed).toBe(0);
    await expect(page.locator('.run-line')).toContainText('the clock waits while you are away');

    // Playing starts it.
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
    await expect
      .poll(async () => (await clock(page)).elapsed, { timeout: STATE_TIMEOUT })
      .toBeGreaterThan(1);
    expect((await clock(page)).running).toBe(true);

    // Stepping away stops it where it stands.
    await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'free');
    await expect.poll(async () => (await clock(page)).running).toBe(false);
    const stopped = (await clock(page)).elapsed;
    await page.waitForTimeout(1500);
    expect((await clock(page)).elapsed).toBe(stopped);

    // Jump to the last seconds of the day: the pill turns urgent, then night falls with a message.
    await page.evaluate((to) => {
      const mp = window.__ashbound?.mp;
      if (mp) mp.warp(to - mp.clock().elapsed);
    }, DAY_SECONDS - 10);
    await expect(page.locator('.ph-clock')).toHaveAttribute('data-soon', '');
    await page.evaluate(() => window.__ashbound?.mp?.warp(12));
    await expect(page.locator('.ph-clock')).toContainText('Night 1');
    await expect(page.locator('.ph-clock')).toHaveAttribute('data-phase', 'night');
    await expect(page.locator('.toast')).toContainText('Night 1 has fallen');
    await expect(page.locator('.ph-banner-title')).toHaveText('Hold the outpost until dawn');

    // Deep in the night the sky has gone dark, and the dawn after it brings the light back.
    await page.evaluate(() => window.__ashbound?.mp?.warp(60));
    await expect.poll(() => skyNight(page), { timeout: STATE_TIMEOUT }).toBeGreaterThan(0.9);
    await page.evaluate(() => {
      const mp = window.__ashbound?.mp;
      if (mp) mp.warp(720 - mp.clock().elapsed + 30);
    });
    await expect(page.locator('.ph-clock')).toContainText('Day 2');
    await expect(page.locator('.toast')).toContainText('Dawn breaks on day 2');
    await expect.poll(() => skyNight(page), { timeout: STATE_TIMEOUT }).toBeLessThan(0.1);
    expect(problems).toEqual([]);
  });

  test('?night=3 opens at nightfall of the third night, and a fixed moment keeps its sky', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&quality=low&night=3&time=noon&waves=0');
    await expect(page.locator('.ph-clock')).toContainText('Night 3');
    expect(await clock(page)).toMatchObject({ cycle: 3, phase: 'night' });
    // The page asked for noon, so the sky stays at noon whatever the clock says.
    await page.evaluate(() => window.__ashbound?.mp?.warp(60));
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    expect(await page.evaluate(() => window.__ashbound?.stage.moment)).toBe('noon');
    expect(await skyNight(page)).toBe(0);
    expect(problems).toEqual([]);
  });
});
