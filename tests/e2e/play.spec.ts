import { expect, test, type Page } from '@playwright/test';

// Software WebGL is slow (a few frames a second), and the loop runs at most five ticks per frame,
// so these tests wait on game state rather than on time, and use a smaller window and the Low
// preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });

const STATE_TIMEOUT = 45_000;

/** Where the player starts, on the lake shore (see `SPAWN_SHOT`); the game puts the feet on the ground. */
const SPAWN = { x: 12, z: 7 };

interface Opened {
  problems: string[];
}

async function open(page: Page, query = '?debug&quality=low'): Promise<Opened> {
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

/**
 * Holds the view where it is for the rest of the test. Playwright's mouse sends stray movements a
 * second or so after the lock starts (see the look test below), and a walk turns with the view and
 * misses its ramp. So the page stops listening to the mouse, and the view is set once the game has
 * used any movement it had already counted.
 */
async function holdTheView(page: Page, yaw: number): Promise<void> {
  await page.evaluate(
    (yaw) =>
      new Promise<void>((resolve) => {
        window.addEventListener('mousemove', (event) => event.stopImmediatePropagation(), true);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const look = window.__ashbound?.game.look;
            if (look) {
              look.yaw = yaw;
              look.pitch = 0;
            }
            resolve();
          }),
        );
      }),
    yaw,
  );
}

/** Reads a value off the running game, e.g. `read<number>(page, 'game.player.z')`. Needs `?debug`. */
const read = <T>(page: Page, expression: string): Promise<T> =>
  page.evaluate<T>(`(() => {
    const game = window.__ashbound && window.__ashbound.game;
    if (!game) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
    return ${expression};
  })()`);

/** Horizontal distance the player is from the spawn point. */
const awayFromSpawn = (page: Page): Promise<number> =>
  read<number>(page, `Math.hypot(game.player.x - ${SPAWN.x}, game.player.z - ${SPAWN.z})`);

/** Waits for the player to settle on the ground and returns the height of the feet. */
async function standOnTheGround(page: Page): Promise<number> {
  await page.waitForFunction(() => window.__ashbound?.game.player.onGround === true, null, {
    timeout: STATE_TIMEOUT,
  });
  return read<number>(page, 'game.player.y');
}

test.describe('playing', () => {
  test.describe.configure({ timeout: 90_000 });

  test('starts on the pause panel; Play takes the pointer and hides it', async ({ page }) => {
    const { problems } = await open(page);
    await expect(page.locator('.pause')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Click to play' })).toBeVisible();
    await expect(page.locator('.ph')).toBeVisible();

    await expect(page.locator('.status-panel')).toBeHidden();

    await takeThePointer(page);
    await expect(page.locator('.pause')).toBeHidden();
    await expect(page.locator('.status-panel')).toBeVisible();
    await expect(page.locator('.status-panel')).toContainText('Ashbound Valley');

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

  test('the player starts on the ground at the lake shore', async ({ page }) => {
    await open(page);
    const feet = await standOnTheGround(page);
    const ground = await read<number>(page, 'game.world.groundAt(game.player.x, game.player.z)');
    expect(Math.abs(feet - ground)).toBeLessThan(0.3);
    expect(await awayFromSpawn(page)).toBeLessThan(0.5);
  });

  test('W walks forward, S walks back, and Shift sprints faster', async ({ page }) => {
    await open(page);
    await takeThePointer(page);
    await standOnTheGround(page);

    await page.keyboard.down('KeyW');
    await page.waitForFunction(
      ({ x, z }) => {
        const player = window.__ashbound?.game.player;
        return !!player && Math.hypot(player.x - x, player.z - z) > 2;
      },
      SPAWN,
      { timeout: STATE_TIMEOUT },
    );
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

    // Walking backward heads for the spawn point again, along the way it came.
    const far = await awayFromSpawn(page);
    await page.keyboard.down('KeyS');
    await page.waitForFunction(
      ({ x, z, far }) => {
        const player = window.__ashbound?.game.player;
        return !!player && Math.hypot(player.x - x, player.z - z) < far - 1.5;
      },
      { ...SPAWN, far },
      { timeout: STATE_TIMEOUT },
    );
    await page.keyboard.up('KeyS');
  });

  test('Space jumps and the player lands again', async ({ page }) => {
    await open(page);
    await takeThePointer(page);
    const feet = await standOnTheGround(page);
    await page.keyboard.down('Space');
    await page.waitForFunction((y) => (window.__ashbound?.game.player.y ?? 0) > y + 0.5, feet, {
      timeout: STATE_TIMEOUT,
    });
    await page.keyboard.up('Space');
    await page.waitForFunction(
      (y) => {
        const player = window.__ashbound?.game.player;
        return !!player && player.onGround && Math.abs(player.y - y) < 0.3;
      },
      feet,
      { timeout: STATE_TIMEOUT },
    );
  });

  test('walks up a ramp of wedges onto a platform and back down, without jumping', async ({
    page,
  }) => {
    const { problems } = await open(page);
    // A floor of cubes over the crash clearing, a ramp of wedges rising toward +x (shape 16), and a
    // platform one block higher, so the test does not depend on the shape of the ground.
    const ramp = await read<{ floor: number; x: number; z: number }>(
      page,
      `(() => {
        const voxels = game.world.voxels;
        const x0 = 8;
        const z0 = -4;
        let ground = 0;
        for (let dx = -4; dx < 7; dx++) {
          for (let dz = -1; dz < 4; dz++) {
            ground = Math.max(ground, game.world.groundAt(x0 + dx + 0.5, z0 + dz + 0.5));
          }
        }
        const y = Math.ceil(ground);
        for (let dx = -4; dx < 7; dx++) {
          for (let dz = -1; dz < 4; dz++) voxels.setBlock(x0 + dx, y, z0 + dz, 0x0201);
        }
        for (let dz = 0; dz < 3; dz++) {
          voxels.setBlock(x0, y + 1, z0 + dz, 0x0210);
          for (let dx = 1; dx < 6; dx++) voxels.setBlock(x0 + dx, y + 1, z0 + dz, 0x0201);
        }
        return { floor: y + 1, x: x0, z: z0 + 1.5 };
      })()`,
    );
    // Stand on the floor west of the ramp, looking east (yaw -pi/2 walks toward +x).
    await page.evaluate(({ floor, x, z }) => {
      window.__ashbound?.game.teleport(x - 2.5, floor + 0.05, z, -Math.PI / 2);
    }, ramp);
    await takeThePointer(page);
    await holdTheView(page, -Math.PI / 2);
    await page.waitForFunction(() => window.__ashbound?.game.player.onGround === true, null, {
      timeout: STATE_TIMEOUT,
    });
    expect(await read<number>(page, 'game.player.y')).toBeCloseTo(ramp.floor, 1);

    // Count the frames off the ground and note the highest point while walking.
    await page.evaluate(() => {
      const game = window.__ashbound?.game;
      if (!game) return;
      const watch = { airborne: 0, peak: game.player.y };
      Object.assign(window, { __walk: watch });
      const sample = (): void => {
        if (!game.player.onGround) watch.airborne++;
        watch.peak = Math.max(watch.peak, game.player.y);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.keyboard.down('KeyW');
    await page.waitForFunction(
      (top) => {
        const player = window.__ashbound?.game.player;
        return !!player && player.onGround && player.y > top - 0.05 && player.x > 11;
      },
      ramp.floor + 1,
      { timeout: STATE_TIMEOUT },
    );
    await page.keyboard.up('KeyW');
    expect(await read<number>(page, 'game.player.y')).toBeCloseTo(ramp.floor + 1, 1);

    // Back down: S walks backward along the ramp.
    await page.keyboard.down('KeyS');
    await page.waitForFunction(
      ({ floor, x }) => {
        const player = window.__ashbound?.game.player;
        return !!player && player.onGround && player.y < floor + 0.05 && player.x < x;
      },
      ramp,
      { timeout: STATE_TIMEOUT },
    );
    await page.keyboard.up('KeyS');

    const walk = await page.evaluate(
      () => (window as unknown as { __walk: { airborne: number; peak: number } }).__walk,
    );
    // Up and down without a jump: the highest point was the platform, and the feet never left the ground.
    expect(walk.peak).toBeLessThan(ramp.floor + 1.1);
    expect(walk.airborne).toBe(0);
    expect(problems).toEqual([]);
  });

  test('keys do nothing until the pointer is taken, and stop when it is released', async ({
    page,
  }) => {
    await open(page);
    await standOnTheGround(page);
    // Pressed while the mouse is free, so the game never sees it.
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1500);
    expect(await awayFromSpawn(page)).toBeLessThan(0.2);

    await takeThePointer(page);
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyW');
    await page.waitForFunction(
      ({ x, z }) => {
        const player = window.__ashbound?.game.player;
        return !!player && Math.hypot(player.x - x, player.z - z) > 1;
      },
      SPAWN,
      { timeout: STATE_TIMEOUT },
    );
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
    // between 1.2 and 2.6 radians, never far enough to wrap past straight behind. Yaw wraps at
    // pi, so the turn is measured the short way round.
    await moveMouse(page, 400, 0, 3);
    await page.waitForFunction(
      (before) => {
        const now = window.__ashbound?.game.look.yaw ?? before;
        const turned = Math.atan2(Math.sin(before - now), Math.cos(before - now));
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

    // The HUD redraws on a rendered frame, which software WebGL can take seconds to deliver when
    // two workers share the machine, so these waits are as long as the state waits above.
    const slow = { timeout: STATE_TIMEOUT };
    await expect(page.locator('.status-panel')).toContainText('First person', slow);
    await page.keyboard.press('KeyV');
    await expect(hud).toHaveAttribute('data-camera', 'third', slow);
    await expect(page.locator('.status-panel')).toContainText('Third person', slow);
    await page.keyboard.press('F5');
    await expect(hud).toHaveAttribute('data-camera', 'first', slow);
    await page.keyboard.press('F5');
    await expect(hud).toHaveAttribute('data-camera', 'third', slow);
    await page.keyboard.press('KeyV');
    await expect(hud).toHaveAttribute('data-camera', 'first', slow);

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
    // Playwright's mouse sends one stray movement after the lock that tips the view upward, and
    // looking up with the hill behind the player pulls the boom in (that is the camera working, and
    // the unit tests cover it). Holding the view level keeps this test about the pull back itself.
    await page.waitForFunction(
      () => {
        const game = window.__ashbound?.game;
        if (!game) return false;
        game.look.pitch = 0;
        return game.rig.blend > 0.99 && game.rig.boomLength > 3;
      },
      null,
      { timeout: STATE_TIMEOUT },
    );
    expect(await read<boolean>(page, 'game.rig.showAvatar')).toBe(true);
  });

  test('P steps through the graphics presets and says which one it chose', async ({ page }) => {
    await open(page);
    await takeThePointer(page);
    expect(await read<string>(page, 'game.stage.quality.name')).toBe('low');
    await page.keyboard.press('KeyP');
    await expect(page.locator('.toast')).toHaveText('Graphics: Balanced');
    expect(await read<string>(page, 'game.stage.quality.name')).toBe('balanced');
    expect(await read<string>(page, 'game.settings.quality')).toBe('balanced');
    await expect(page.locator('.status-panel')).toContainText('Graphics: Balanced');
    await page.keyboard.press('KeyP');
    await page.keyboard.press('KeyP');
    await expect(page.locator('.toast')).toHaveText('Graphics: Low');
    expect(await read<string>(page, 'game.stage.quality.name')).toBe('low');
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
    await expect(overlay).toContainText('low');
  });

  test('the overlay is hidden until asked for when no debug switch is on', async ({ page }) => {
    await open(page, '?quality=low');
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
    await page.getByLabel('Graphics').selectOption('low');
    expect(await read<number>(page, 'game.settings.mouseSensitivity')).toBe(2);
    expect(await read<string>(page, 'game.settings.quality')).toBe('low');

    // No ?quality= this time, so the saved preset is the one that decides.
    await page.goto('./?debug');
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await expect(sensitivity).toHaveValue('2');
    await expect(fov).toHaveValue('90');
    await expect(page.getByLabel('Invert vertical look')).toBeChecked();
    await expect(page.getByLabel('Graphics')).toHaveValue('low');
    expect(await read<number>(page, 'game.settings.fov')).toBe(90);
    expect(await read<string>(page, 'game.stage.quality.name')).toBe('low');
  });

  test('the sky follows the run, and ?debug can preview a time of day over it', async ({
    page,
  }) => {
    await open(page);
    // Playing together loads once the game is up, and the run's clock takes the sky from then on.
    await page.waitForFunction(() => !!window.__ashbound?.mp, null, { timeout: STATE_TIMEOUT });
    expect(await read<string | null>(page, 'game.stage.moment')).toBeNull();
    await expect(page.getByLabel('Time of day')).toHaveValue('clock');
    await page.getByLabel('Time of day').selectOption('night');
    expect(await read<string | null>(page, 'game.stage.moment')).toBe('night');
    await page.getByLabel('Time of day').selectOption('clock');
    expect(await read<string | null>(page, 'game.stage.moment')).toBeNull();
  });

  test('without ?debug the pause panel has no time of day to pick', async ({ page }) => {
    await open(page, '?quality=low');
    await expect(page.getByLabel('Graphics')).toBeVisible();
    await expect(page.getByLabel('Time of day')).toHaveCount(0);
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
  // One preset keeps these quick under software rendering; the sweep over all three is unit tested.
  test('?bench=1 flies the valley by itself and ends with a report to copy', async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { problems } = await open(page, '?bench=1&benchSeconds=2&benchPresets=low&debug');
    const hud = page.locator('#hud');
    await expect(hud).toHaveAttribute('data-bench', 'running', { timeout: STATE_TIMEOUT });
    await expect(page.locator('.bench-banner')).toBeVisible();
    await expect(page.locator('.bench-banner')).toContainText('Low (1 of 1)');
    await expect(page.locator('.pause')).toBeHidden();
    await expect(page.locator('.status-panel')).toBeHidden();
    await expect(hud).toHaveAttribute('data-bench', 'done', { timeout: 150_000 });

    const card = page.locator('.results-card');
    await expect(card).toBeVisible();
    await expect(card.locator('.report-text')).toContainText('Ashbound Outpost benchmark');
    await expect(card.locator('.report-text')).toContainText('Graphics adapter:');
    await expect(card.locator('.gpu-line')).toContainText('GPU:');
    await expect(card.locator('.bench-table tr[data-preset="low"]')).toBeVisible();
    const shot = testInfo.outputPath('benchmark-results.png');
    await page.screenshot({ path: shot });
    await testInfo.attach('benchmark-results', { path: shot, contentType: 'image/png' });

    await card.getByRole('button', { name: 'Copy results' }).click();
    await expect(card.locator('.copy-status')).not.toBeEmpty();

    await card.getByRole('button', { name: 'Back to game' }).click();
    await expect(card).toBeHidden();
    await expect(page.locator('.pause')).toBeVisible();
    // The sweep gives the preset and the sky back. The page started on the saved preset (Balanced:
    // this URL has no ?quality=), and the one-preset run flew Low, so Balanced is what comes back.
    expect(await read<string>(page, 'game.stage.quality.name')).toBe('balanced');
    expect(await read<string | null>(page, 'game.stage.moment')).toBe('golden');
    expect(problems).toEqual([]);
  });

  test('Escape stops a run and says so', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, '?bench=1&benchSeconds=120&benchPresets=low');
    const hud = page.locator('#hud');
    await expect(hud).toHaveAttribute('data-bench', 'running', { timeout: STATE_TIMEOUT });
    await page.keyboard.press('Escape');
    await expect(hud).toHaveAttribute('data-bench', 'cancelled');
    await expect(page.getByRole('heading', { name: 'Run stopped' })).toBeVisible();
  });

  test('the mouse cannot steer during a run, even with the pointer taken', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, '?bench=1&benchSeconds=120&benchPresets=low&debug');
    await expect(page.locator('#hud')).toHaveAttribute('data-bench', 'running', {
      timeout: STATE_TIMEOUT,
    });
    await page.mouse.click(480, 270);
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
    const before = await read<number>(page, 'game.look.yaw');
    const position = await read<number[]>(page, '[game.player.x, game.player.z]');
    await moveMouse(page, 300, 0);
    await page.waitForTimeout(500);
    // The route flies the camera; the player's own view and place stay where they were.
    expect(await read<number>(page, 'game.look.yaw')).toBe(before);
    expect(await read<number[]>(page, '[game.player.x, game.player.z]')).toEqual(position);
  });

  test('the benchmark has no building hands: B, the number keys and the buttons do nothing', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await open(page, '?bench=1&benchSeconds=120&benchPresets=low&debug');
    await expect(page.locator('#hud')).toHaveAttribute('data-bench', 'running', {
      timeout: STATE_TIMEOUT,
    });
    await page.mouse.click(480, 270);
    await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
    await page.keyboard.press('KeyB');
    await page.keyboard.press('Digit3');
    await page.evaluate(() => {
      window.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));
    });
    await page.waitForTimeout(500);
    const hands = await page.evaluate(() => window.__ashbound?.build?.hands());
    expect(hands).toMatchObject({ buildMode: false, selected: 0, refusal: null });
    // Nothing was baked or compiled for blocks the benchmark never draws.
    expect(await read<boolean>(page, 'game.stage.structureReady')).toBe(false);
  });
});
