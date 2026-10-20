import { expect, test } from '@playwright/test';

test('boots to a lit scene with the pause panel up and no console errors', async ({
  page,
}, testInfo) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));

  await page.goto('./?debug');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');

  const box = await page.locator('canvas#game').boundingBox();
  expect(box?.width).toBeGreaterThan(300);
  expect(box?.height).toBeGreaterThan(200);

  // Render once more and read pixels in the same task, before the browser composites the frame.
  // That proves the canvas itself holds the scene (a sky above, ground below), not just the page.
  const pixels = await page.evaluate(() => {
    const stage = window.__ashbound?.stage;
    if (!stage) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
    stage.renderer.render(stage.scene, stage.camera);
    const gl = stage.renderer.getContext();
    const read = (x: number, y: number): number[] => {
      const out = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return Array.from(out);
    };
    const { width, height } = gl.canvas;
    return { sky: read(width >> 1, height - 8), ground: read(width >> 1, 8) };
  });
  const [skyR = 0, , skyB = 0] = pixels.sky;
  const [groundR = 0, groundG = 0, groundB = 0] = pixels.ground;
  expect(skyB).toBeGreaterThan(skyR);
  expect(skyB).toBeGreaterThan(80);
  expect(groundR + groundG + groundB).toBeGreaterThan(60);
  expect(pixels.sky).not.toEqual(pixels.ground);

  await expect(page.locator('#build-tag')).toContainText('Ashbound Outpost');
  await expect(page.locator('.pause')).toBeVisible();
  await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'free');
  await expect(page.locator('#fatal')).toBeHidden();

  const screenshot = testInfo.outputPath('first-frame.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('first-frame', { path: screenshot, contentType: 'image/png' });
  expect(problems).toEqual([]);
});
