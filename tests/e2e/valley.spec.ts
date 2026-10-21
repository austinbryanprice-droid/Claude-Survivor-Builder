import { expect, test, type Page } from '@playwright/test';

// Software WebGL draws a few frames a second, so these tests use the Low preset and a small
// window, and wait on game state rather than on time.
test.use({ viewport: { width: 800, height: 450 } });
test.describe.configure({ timeout: 90_000 });

const STATE_TIMEOUT = 45_000;

async function open(page: Page, query: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(`./${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  return problems;
}

/** Reads a value off the running game. Needs `?debug`. */
const read = <T>(page: Page, expression: string): Promise<T> =>
  page.evaluate<T>(`(() => {
    const game = window.__ashbound && window.__ashbound.game;
    if (!game) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
    return ${expression};
  })()`);

async function settleOnTheGround(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ashbound?.game.player.onGround === true, null, {
    timeout: STATE_TIMEOUT,
  });
}

/** How different the picture is from place to place: the number of distinct colors in a grid of samples. */
async function colorVariety(page: Page): Promise<number> {
  return page.evaluate(() => {
    const app = window.__ashbound;
    if (!app) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
    app.game.renderNow();
    const gl = app.stage.renderer.getContext();
    const { width, height } = gl.canvas;
    const seen = new Set<string>();
    const out = new Uint8Array(4);
    for (let i = 1; i < 8; i++) {
      for (let j = 1; j < 6; j++) {
        gl.readPixels((width * i) >> 3, (height * j) / 6, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
        // Coarse buckets, so noise does not count as variety.
        seen.add(`${out[0]! >> 4}/${out[1]! >> 4}/${out[2]! >> 4}`);
      }
    }
    return seen.size;
  });
}

test.describe('the valley', () => {
  test('the named viewpoints draw the valley, each from its own place', async ({
    page,
  }, testInfo) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
    const poses: string[] = [];
    for (const shot of ['lake', 'valley', 'crash']) {
      await page.goto(`./?debug&quality=low&freeze=1&hud=0&shot=${shot}`);
      await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
      expect(await colorVariety(page), shot).toBeGreaterThan(8);
      poses.push(await read<string>(page, 'game.stage.camera.position.toArray().join()'));
      const path = testInfo.outputPath(`${shot}.png`);
      await page.screenshot({ path });
      await testInfo.attach(shot, { path, contentType: 'image/png' });
    }
    expect(new Set(poses).size).toBe(3);
    expect(problems).toEqual([]);
  });

  test('a named viewpoint brings its own time of day unless the URL asks for another', async ({
    page,
  }) => {
    await open(page, '?debug&quality=low&hud=0&shot=sunset');
    expect(await read<string | null>(page, 'game.stage.moment')).toBe('sunset');
    await open(page, '?debug&quality=low&hud=0&shot=sunset&time=noon');
    expect(await read<string | null>(page, 'game.stage.moment')).toBe('noon');
    await open(page, '?debug&quality=low&hud=0&shot=sunset&clock');
    expect(await read<string | null>(page, 'game.stage.moment')).toBeNull();
  });

  test('hud=0 hides the whole interface, the build tag too', async ({ page }) => {
    await open(page, '?debug&quality=low&hud=0');
    await expect(page.locator('#hud')).toBeHidden();
    await expect(page.locator('#build-tag')).toBeHidden();
  });

  test('the game starts at the lake shore, on the ground, looking across the water', async ({
    page,
  }) => {
    await open(page, '?debug&quality=low');
    await settleOnTheGround(page);
    const { feet, ground, x, z, yaw } = await read<{
      feet: number;
      ground: number;
      x: number;
      z: number;
      yaw: number;
    }>(
      page,
      `({
        feet: game.player.y,
        ground: game.world.groundAt(game.player.x, game.player.z),
        x: game.player.x,
        z: game.player.z,
        yaw: game.look.yaw,
      })`,
    );
    expect(Math.abs(feet - ground)).toBeLessThan(0.3);
    expect(x).toBeCloseTo(12, 0);
    expect(z).toBeCloseTo(7, 0);
    // Bearing 92 degrees: just south of east.
    expect(yaw).toBeCloseTo((-92 * Math.PI) / 180, 3);
  });

  test('a player dropped from the sky lands on the terrain, and so does one in the lake', async ({
    page,
  }) => {
    await open(page, '?debug&quality=low');
    for (const at of [
      { x: -30, z: 25 },
      { x: 40, z: 8 },
    ]) {
      await page.evaluate(({ x, z }) => {
        const game = window.__ashbound?.game;
        if (!game) throw new Error('missing');
        game.teleport(x, game.world.groundAt(x, z) + 14, z);
      }, at);
      // The teleport clears the ground flag, so waiting for it proves the player fell and landed.
      await settleOnTheGround(page);
      const gap = await read<number>(
        page,
        'Math.abs(game.player.y - game.world.groundAt(game.player.x, game.player.z))',
      );
      expect(gap, `at ${at.x}, ${at.z}`).toBeLessThan(0.4);
    }
  });

  test('the seed in the URL builds that valley, and loadWorld swaps it without leaking', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&quality=low&seed=7');
    expect(await read<number>(page, 'game.world.seed')).toBe(7);
    await settleOnTheGround(page);
    const children = await read<number>(page, 'game.stage.world.children.length');
    const ground = await read<number>(page, 'game.world.groundAt(12, 7)');

    await page.evaluate(() => window.__ashbound?.game.loadWorld(9));
    expect(await read<number>(page, 'game.world.seed')).toBe(9);
    expect(await read<number>(page, 'game.stage.world.children.length')).toBe(children);
    expect(await read<number>(page, 'game.world.groundAt(12, 7)')).not.toBe(ground);
    await settleOnTheGround(page);
    expect(problems).toEqual([]);
  });
});
