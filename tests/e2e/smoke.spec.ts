import { expect, test } from '@playwright/test';

test('boots to the valley with the pause panel up and no console errors', async ({
  page,
}, testInfo) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));

  await page.goto('./?debug&quality=low');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');

  const box = await page.locator('canvas#game').boundingBox();
  expect(box?.width).toBeGreaterThan(300);
  expect(box?.height).toBeGreaterThan(200);

  // Render once more and read pixels in the same task, before the browser composites the frame.
  // That proves the canvas itself holds the scene (a sky above, ground below), not just the page.
  const pixels = await page.evaluate(() => {
    const app = window.__ashbound;
    if (!app) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
    app.game.renderNow();
    const gl = app.stage.renderer.getContext();
    const read = (x: number, y: number): number[] => {
      const out = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return Array.from(out);
    };
    const { width, height } = gl.canvas;
    return {
      sky: read(width >> 1, height - 8),
      middle: read(width >> 1, height >> 1),
      ground: read(width >> 1, 8),
    };
  });
  const [skyR = 0, , skyB = 0] = pixels.sky;
  const [groundR = 0, groundG = 0, groundB = 0] = pixels.ground;
  expect(skyB).toBeGreaterThan(skyR);
  expect(skyB).toBeGreaterThan(80);
  expect(groundR + groundG + groundB).toBeGreaterThan(60);
  expect(pixels.sky).not.toEqual(pixels.ground);
  expect(pixels.middle).not.toEqual(pixels.sky);

  await expect(page.locator('#build-tag')).toContainText('Ashbound Outpost');
  // The loading text is gone once the valley is built.
  await expect(page.locator('#loading')).toHaveCount(0);
  await expect(page.locator('.pause')).toBeVisible();
  await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'free');
  await expect(page.locator('#fatal')).toBeHidden();

  const screenshot = testInfo.outputPath('first-frame.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('first-frame', { path: screenshot, contentType: 'image/png' });
  expect(problems).toEqual([]);
});
