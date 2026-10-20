import { expect, test } from '@playwright/test';

test('boots to a rendered canvas without console errors', async ({ page }, testInfo) => {
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

  // Render once more and read a pixel in the same task, before the browser composites the
  // frame. That proves the canvas itself holds the scene background (#1a2633), not just
  // the page behind it.
  const pixel = await page.evaluate(() => {
    const stage = window.__ashbound?.stage;
    if (!stage) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
    stage.renderer.render(stage.scene, stage.camera);
    const gl = stage.renderer.getContext();
    const out = new Uint8Array(4);
    gl.readPixels(8, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return Array.from(out);
  });
  const expected = [0x1a, 0x26, 0x33];
  expected.forEach((channel, i) => {
    expect(Math.abs((pixel[i] ?? -99) - channel)).toBeLessThanOrEqual(2);
  });

  await expect(page.locator('#build-tag')).toContainText('Ashbound Outpost');
  await expect(page.locator('#fatal')).toBeHidden();

  const screenshot = testInfo.outputPath('first-frame.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('first-frame', { path: screenshot, contentType: 'image/png' });
  expect(problems).toEqual([]);
});
