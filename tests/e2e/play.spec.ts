import { expect, test, type Page } from '@playwright/test';

// Software WebGL is slow (a few frames a second), and the loop runs at most five ticks per frame,
// so these tests wait on game state rather than on time, and use a smaller window to go faster.
test.use({ viewport: { width: 960, height: 540 } });

const STATE_TIMEOUT = 45_000;

interface Opened {
  problems: string[];
}

async function open(page: Page, query = '?debug'): Promise<Opened> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(`./${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  return { problems };
}

async function takeThePointer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
}

/** One frame's worth of mouse movement, the way the browser reports it under pointer lock. */
async function moveMouse(page: Page, dx: number, dy: number, times = 3): Promise<void> {
  await page.evaluate(
    ({ dx, dy, times }) => {
      // Chrome reports one stray event when the lock starts and the game ignores the first.
      for (let i = 0; i < times; i++) {
        document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy }));
      }
    },
    { dx, dy, times },
  );
}

/** Reads a value off the running game, e.g. `read<number>(page, 'game.player.z')`. Needs `?debug`. */
const read = <T>(page: Page, expression: string): Promise<T> =>
  page.evaluate<T>(`(() => {
    const game = window.__ashbound && window.__ashbound.game;
    if (!game) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
    return ${expression};
  })()`);

test.describe('playing', () => {
  test.describe.configure({ timeout: 90_000 });

  test('starts on the pause panel; Play takes the pointer and hides it', async ({ page }) => {
    const { problems } = await open(page);
    await expect(page.locator('.pause')).toBeVisible();
    await expect(page.locator('.crosshair')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Click to play' })).toBeVisible();

    await expect(page.locator('.status-panel')).toBeHidden();

    await takeThePointer(page);
    await expect(page.locator('.pause')).toBeHidden();
    await expect(page.locator('.crosshair')).toBeVisible();
    await expect(page.locator('.status-panel')).toBeVisible();
    await expect(page.locator('.status-panel')).toContainText('Proving ground');

    await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'free');
    await expect(page.locator('.pause')).toBeVisible();
    await expect(page.locator('.status-panel')).toBeHidden();
    expect(problems).toEqual([]);
  });

  test('a click anywhere on the backdrop takes the pointer too', async ({ page }) => {
    await open(page);
    await page.mouse.click(8, 530);
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
  });

  test('W walks forward, S walks back, and Shift sprints faster', async ({ page }) => {
    await open(page);
    await takeThePointer(page);
    expect(await read<number>(page, 'game.player.z')).toBeCloseTo(0.5, 2);

    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => (window.__ashbound?.game.player.z ?? 0) < 0.5 - 2, null, {
      timeout: STATE_TIMEOUT,
    });
    const walking = await read<number>(page, 'Math.hypot(game.player.vx, game.player.vz)');
    expect(walking).toBeCloseTo(4.4, 1);

    await page.keyboard.down('ShiftLeft');
    await page.waitForFunction(
      () => {
        const player = window.__ashbound?.game.player;
        return !!player && Math.hypot(player.vx, player.vz) > 7;
      },
      null,
      { timeout: STATE_TIMEOUT },
    );
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');

    const here = await read<number>(page, 'game.player.z');
    await page.keyboard.down('KeyS');
    await page.waitForFunction((z) => (window.__ashbound?.game.player.z ?? -99) > z + 1.5, here, {
      timeout: STATE_TIMEOUT,
    });
    await page.keyboard.up('KeyS');
  });

  test('Space jumps and the player lands again', async ({ page }) => {
    await open(page);
    await takeThePointer(page);
    await page.keyboard.down('Space');
    await page.waitForFunction(() => (window.__ashbound?.game.player.y ?? 0) > 0.5, null, {
      timeout: STATE_TIMEOUT,
    });
    await page.keyboard.up('Space');
    await page.waitForFunction(
      () => {
        const player = window.__ashbound?.game.player;
        return !!player && player.onGround && player.y < 0.001;
      },
      null,
      { timeout: STATE_TIMEOUT },
    );
  });

  test('keys do nothing until the pointer is taken, and stop when it is released', async ({
    page,
  }) => {
    await open(page);
    // Pressed while the mouse is free, so the game never sees it.
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1500);
    expect(await read<number>(page, 'game.player.z')).toBeCloseTo(0.5, 3);

    await takeThePointer(page);
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => (window.__ashbound?.game.player.z ?? 0) < 0.5 - 1, null, {
      timeout: STATE_TIMEOUT,
    });
    await page.evaluate(() => document.exitPointerLock());
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'free');
    // Let the loop settle; the held W must no longer push the player.
    await page.waitForFunction(
      () => {
        const player = window.__ashbound?.game.player;
        return !!player && Math.hypot(player.vx, player.vz) < 0.01;
      },
      null,
      { timeout: STATE_TIMEOUT },
    );
    await page.keyboard.up('KeyW');
  });

  test('moving the mouse turns the view, and the pitch stops short of straight up', async ({
    page,
  }) => {
    await open(page);
    await takeThePointer(page);
    const yaw = await read<number>(page, 'game.look.yaw');

    // Playwright's own mouse sends one large stray movement (-263 px) a second or so after the lock
    // starts, which may land before or after these events, and the game drops the first movement
    // after a lock. So either two or three of these events count, minus the stray: the view turns
    // between 1.2 and 2.6 radians, never far enough to wrap past straight behind.
    await moveMouse(page, 400, 0, 3);
    await page.waitForFunction(
      (before) => {
        const turned = before - (window.__ashbound?.game.look.yaw ?? before);
        return turned > 0.8 && turned < 3;
      },
      yaw,
      { timeout: STATE_TIMEOUT },
    );

    await moveMouse(page, 0, -400, 12);
    await page.waitForFunction(() => (window.__ashbound?.game.look.pitch ?? 0) > 1.5, null, {
      timeout: STATE_TIMEOUT,
    });
    expect(await read<number>(page, 'game.look.pitch')).toBeLessThanOrEqual(Math.PI / 2);
  });

  test('V and F5 switch between first and third person; F5 never reloads while playing', async ({
    page,
  }) => {
    const { problems } = await open(page);
    const hud = page.locator('#hud');
    await takeThePointer(page);
    await expect(hud).toHaveAttribute('data-camera', 'first');
    await page.evaluate(() => {
      document.documentElement.dataset.stayed = 'yes';
      window.addEventListener('keydown', (event) => {
        if (event.code === 'F5')
          document.documentElement.dataset.f5Prevented = String(event.defaultPrevented);
      });
    });

    await expect(page.locator('.status-panel')).toContainText('First person');
    await page.keyboard.press('KeyV');
    await expect(hud).toHaveAttribute('data-camera', 'third');
    await expect(page.locator('.status-panel')).toContainText('Third person');
    await page.keyboard.press('F5');
    await expect(hud).toHaveAttribute('data-camera', 'first');
    await page.keyboard.press('F5');
    await expect(hud).toHaveAttribute('data-camera', 'third');
    await page.keyboard.press('KeyV');
    await expect(hud).toHaveAttribute('data-camera', 'first');

    await expect(page.locator('html')).toHaveAttribute('data-stayed', 'yes');
    await expect(page.locator('html')).toHaveAttribute('data-f5-prevented', 'true');
    expect(problems).toEqual([]);
  });

  test('F5 is left alone while the mouse is free, so the page can still be reloaded', async ({
    page,
  }) => {
    await open(page);
    await page.evaluate(() => {
      window.addEventListener('keydown', (event) => {
        if (event.code === 'F5')
          document.documentElement.dataset.f5Prevented = String(event.defaultPrevented);
      });
    });
    await page.keyboard.press('F5').catch(() => undefined);
    // If the browser did reload, the marker is gone and this check is moot; either is fine, but
    // the page must never have been told to ignore the key.
    const marker = await page
      .evaluate(() => document.documentElement.dataset.f5Prevented ?? 'reloaded')
      .catch(() => 'reloaded');
    expect(['false', 'reloaded']).toContain(marker);
  });

  test('the third-person body appears and the camera pulls back', async ({ page }) => {
    await open(page);
    await takeThePointer(page);
    await page.keyboard.press('KeyV');
    await page.waitForFunction(() => (window.__ashbound?.game.rig.blend ?? 0) > 0.99, null, {
      timeout: STATE_TIMEOUT,
    });
    expect(await read<boolean>(page, 'game.rig.showAvatar')).toBe(true);
    expect(await read<number>(page, 'game.rig.boomLength')).toBeGreaterThan(3);
  });

  test('F3 toggles the frame overlay', async ({ page }) => {
    await open(page);
    const overlay = page.locator('.frame-overlay');
    await expect(overlay).toBeVisible();
    await page.keyboard.press('F3');
    await expect(overlay).toBeHidden();
    await page.keyboard.press('F3');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('.fo-fps')).not.toHaveText('--', { timeout: STATE_TIMEOUT });
  });

  test('the overlay is hidden until asked for when no debug switch is on', async ({ page }) => {
    await open(page, '');
    const overlay = page.locator('.frame-overlay');
    await expect(overlay).toBeHidden();
    await page.keyboard.press('F3');
    await expect(overlay).toBeVisible();
  });

  test('settings are kept between visits', async ({ page }) => {
    await open(page);
    const sensitivity = page.getByLabel('Mouse sensitivity');
    const fov = page.getByLabel('Field of view');
    await sensitivity.fill('2');
    await fov.fill('90');
    await page.getByLabel('Invert vertical look').check();
    expect(await read<number>(page, 'game.settings.mouseSensitivity')).toBe(2);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await expect(sensitivity).toHaveValue('2');
    await expect(fov).toHaveValue('90');
    await expect(page.getByLabel('Invert vertical look')).toBeChecked();
    expect(await read<number>(page, 'game.settings.fov')).toBe(90);
  });

  test('screenshot: playing in first and third person', async ({ page }, testInfo) => {
    await open(page);
    await takeThePointer(page);
    await moveMouse(page, 120, 0);
    await page.keyboard.press('KeyV');
    await page.waitForFunction(() => (window.__ashbound?.game.rig.blend ?? 0) > 0.99, null, {
      timeout: STATE_TIMEOUT,
    });
    const shot = testInfo.outputPath('third-person.png');
    await page.screenshot({ path: shot });
    await testInfo.attach('third-person', { path: shot, contentType: 'image/png' });
  });
});

test.describe('benchmark', () => {
  test('?bench=1 runs the flythrough by itself and ends with a report to copy', async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { problems } = await open(page, '?bench=1&benchSeconds=2&debug');
    const hud = page.locator('#hud');
    await expect(hud).toHaveAttribute('data-bench', 'running', { timeout: STATE_TIMEOUT });
    await expect(page.locator('.bench-banner')).toBeVisible();
    await expect(page.locator('.pause')).toBeHidden();
    await expect(page.locator('.status-panel')).toBeHidden();
    await expect(hud).toHaveAttribute('data-bench', 'done', { timeout: 150_000 });

    const card = page.locator('.results-card');
    await expect(card).toBeVisible();
    await expect(card.locator('.report-text')).toContainText('Ashbound Outpost benchmark');
    await expect(card.locator('.report-text')).toContainText('GPU:');
    await expect(card.locator('.gpu-line')).toContainText('GPU:');
    const shot = testInfo.outputPath('benchmark-results.png');
    await page.screenshot({ path: shot });
    await testInfo.attach('benchmark-results', { path: shot, contentType: 'image/png' });

    await card.getByRole('button', { name: 'Copy results' }).click();
    await expect(card.locator('.copy-status')).not.toBeEmpty();

    await card.getByRole('button', { name: 'Back to game' }).click();
    await expect(card).toBeHidden();
    await expect(page.locator('.pause')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('Escape stops a run and says so', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, '?bench=1&benchSeconds=120');
    const hud = page.locator('#hud');
    await expect(hud).toHaveAttribute('data-bench', 'running', { timeout: STATE_TIMEOUT });
    await page.keyboard.press('Escape');
    await expect(hud).toHaveAttribute('data-bench', 'cancelled');
    await expect(page.getByRole('heading', { name: 'Run stopped' })).toBeVisible();
  });

  test('the mouse cannot steer during a run, even with the pointer taken', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, '?bench=1&benchSeconds=120&debug');
    await expect(page.locator('#hud')).toHaveAttribute('data-bench', 'running', {
      timeout: STATE_TIMEOUT,
    });
    await page.mouse.click(480, 270);
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
    const before = await read<number>(page, 'game.look.yaw');
    // Two counted events of 300 px would turn the view by about 1.3 radians.
    await moveMouse(page, 300, 0);
    await page.waitForTimeout(500);
    // The route turns the view by itself, slowly, so only a small positive change is expected.
    const delta = (await read<number>(page, 'game.look.yaw')) - before;
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(delta).toBeLessThan(1);
  });
});
