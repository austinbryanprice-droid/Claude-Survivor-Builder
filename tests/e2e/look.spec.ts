import { expect, test, type Page } from '@playwright/test';

/** Collects console errors and page errors so a test can assert there were none. */
function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  return problems;
}

test('look spike draws a lit valley with the HUD on top', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const problems = watchProblems(page);
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('./look.html?debug&freeze=1&shot=lake&quality=low');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
  await page.waitForFunction(() => (window.__look?.frames ?? 0) >= 1, null, { timeout: 90_000 });

  // Render once more and read pixels in the same task, before the browser composites the frame.
  const stats = await page.evaluate(() => {
    const look = window.__look;
    if (!look) throw new Error('window.__look is missing; is the ?debug switch on?');
    look.renderNow();
    const gl = look.scene.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const colors = new Set<string>();
    let luminance = 0;
    let samples = 0;
    const pixel = new Uint8Array(4);
    for (let j = 1; j < 10; j++) {
      for (let i = 1; i < 10; i++) {
        gl.readPixels(
          Math.floor((i / 10) * width),
          Math.floor((j / 10) * height),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixel,
        );
        colors.add(`${pixel[0]},${pixel[1]},${pixel[2]}`);
        luminance +=
          ((pixel[0] ?? 0) * 0.2126 + (pixel[1] ?? 0) * 0.7152 + (pixel[2] ?? 0) * 0.0722) / 255;
        samples++;
      }
    }
    const frame = look.scene.stats.value;
    return {
      colors: colors.size,
      luminance: luminance / samples,
      drawCalls: frame?.drawCalls ?? 0,
      triangles: frame?.triangles ?? 0,
      quality: look.scene.quality.name,
      terrainTriangles: look.scene.terrain.stats.triangles,
    };
  });
  expect(stats.quality).toBe('low');
  expect(stats.colors).toBeGreaterThan(30);
  expect(stats.luminance).toBeGreaterThan(0.06);
  expect(stats.luminance).toBeLessThan(0.95);
  expect(stats.drawCalls).toBeGreaterThan(10);
  expect(stats.triangles).toBeGreaterThan(50_000);
  expect(stats.terrainTriangles).toBe(123_182);

  // The HUD is there: eight hotbar slots, health, compass and the objective banner.
  await expect(page.locator('.ph')).toBeVisible();
  await expect(page.locator('.ph-slot')).toHaveCount(8);
  await expect(page.locator('.ph-seg')).toHaveCount(3);
  await expect(page.locator('.ph-compass')).toBeVisible();
  await expect(page.locator('.ph-banner-title')).not.toBeEmpty();

  // The number keys pick a hotbar slot.
  await page.keyboard.press('3');
  await expect(page.locator('.ph-slot[data-selected]')).toHaveCount(1);
  await expect(page.locator('.ph-slot').nth(2)).toHaveAttribute('data-selected', '');

  await expect(page.locator('#fatal')).toBeHidden();
  const screenshot = testInfo.outputPath('look.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('look', { path: screenshot, contentType: 'image/png' });
  expect(problems).toEqual([]);
});

test('look spike hides the HUD with ?hud=0 and draws Balanced without errors', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchProblems(page);
  await page.setViewportSize({ width: 480, height: 270 });
  await page.goto('./look.html?debug&freeze=1&hud=0&quality=balanced&shot=valley');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
  await page.waitForFunction(() => (window.__look?.frames ?? 0) >= 1, null, { timeout: 90_000 });
  await expect(page.locator('.ph')).toBeHidden();
  await expect(page.locator('#look-overlay')).toBeHidden();
  const quality = await page.evaluate(() => window.__look?.scene.quality.name);
  expect(quality).toBe('balanced');
  expect(problems).toEqual([]);
});

test('look spike runs the benchmark on every preset and offers a report', async ({ page }) => {
  test.setTimeout(360_000);
  const problems = watchProblems(page);
  await page.setViewportSize({ width: 320, height: 180 });
  await page.goto('./look.html?debug&bench=1&benchSeconds=0.2&benchPresets=low,balanced,ultra');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
  await expect(page.locator('.look-bench-banner')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.look-bench-results')).toBeVisible({ timeout: 300_000 });
  await expect(page.locator('.look-bench-table tr')).toHaveCount(4);
  for (const name of ['Low', 'Balanced', 'Ultra']) {
    await expect(page.locator('.look-bench-table')).toContainText(name);
  }
  await expect(page.locator('.look-bench-table')).toContainText('Holds 60');
  await expect(page.locator('.look-bench-buttons')).toContainText('Copy report');

  const runs = await page.evaluate(
    () =>
      window.__look?.sweep.runs.map((run) => ({
        preset: run.preset,
        frames: run.report.frames.frames,
        avgMs: run.report.frames.avgMs,
        seconds: run.report.scriptSeconds,
        gpu: run.report.environment.gpu,
        drawCalls: run.drawCalls,
        triangles: run.triangles,
        width: run.width,
      })) ?? [],
  );
  expect(runs.map((run) => run.preset)).toEqual(['low', 'balanced', 'ultra']);
  for (const run of runs) {
    // A 0.2 s route is 12 simulation ticks; a slow machine plays them in a few frames.
    expect(run.frames).toBeGreaterThan(0);
    expect(run.avgMs).toBeGreaterThan(0);
    expect(run.seconds).toBe(0.2);
    expect(run.gpu).not.toBe('');
    expect(run.drawCalls).toBeGreaterThan(10);
    expect(run.width).toBeGreaterThan(100);
  }
  // Ultra draws more than Low on the same route.
  expect((runs[2]?.triangles ?? 0) > (runs[0]?.triangles ?? 0)).toBe(true);
  // The sweep puts the view and the preset back where it found them.
  const after = await page.evaluate(() => ({
    quality: window.__look?.scene.quality.name,
    state: window.__look?.sweep.state,
  }));
  expect(after).toEqual({ quality: 'balanced', state: 'done' });
  expect(problems).toEqual([]);
});

test('look spike stops the benchmark with Esc and keeps what it measured', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watchProblems(page);
  await page.setViewportSize({ width: 320, height: 180 });
  await page.goto('./look.html?debug&bench=1&benchSeconds=120&benchPresets=low');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
  await expect(page.locator('.look-bench-banner')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.look-bench-banner')).toBeHidden();
  await expect(page.locator('.look-bench-results')).toBeVisible();
  await expect(page.locator('.look-bench-results')).toContainText('Run stopped');
  const state = await page.evaluate(() => window.__look?.sweep.state);
  expect(state).toBe('cancelled');
  expect(problems).toEqual([]);
});
