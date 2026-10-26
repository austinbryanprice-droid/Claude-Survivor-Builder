import { expect, test, type Page } from '@playwright/test';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';
import { RESPAWN, VITALS } from '../../src/systems/survival/balance';
import { recordToasts, toasts } from './support/toasts';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 180_000 });

const STATE_TIMEOUT = 60_000;
const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the same patience as `wait`: the HUD only changes when a frame is drawn. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
// No waves: nothing here should be hurt by anything but the test.
const QUERY = '?debug&quality=low&freeze=1&stats=0&waves=0';

async function open(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(`./${QUERY}`);
  await wait(page.locator('html')).toHaveAttribute('data-ready', 'true');
  // Playing together loads after the game is up, and the run lives in it.
  await page.waitForFunction(() => !!window.__ashbound?.mp, null, { timeout: STATE_TIMEOUT });
  return problems;
}

/** Reads a value off the running game, e.g. `read<number>(page, 'mp.vitals().health')`. Needs `?debug`. */
const read = <T>(page: Page, expression: string): Promise<T> =>
  page.evaluate<T>(`(() => {
    const app = window.__ashbound;
    if (!app) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
    const { game, stage, mp, build } = app;
    return ${expression};
  })()`);

async function takeThePointer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play' }).click();
  await wait(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
}

/** Resolves after the game has drawn `count` more frames. */
const frames = (page: Page, count = 1): Promise<void> =>
  page.evaluate(
    (wanted) =>
      new Promise<void>((resolve) => {
        let seen = 0;
        const stop = window.__ashbound?.game.onFrame(() => {
          if (++seen >= wanted) {
            stop?.();
            resolve();
          }
        });
      }),
    count,
  );

interface Run {
  elapsed: number;
  running: boolean;
  coreHealth: number;
  coreMax: number;
  over: boolean;
  overWhy: 'core' | 'crew' | null;
  respawns: number;
  respawnMax: number;
}

interface Meters {
  health: number;
  healthMax: number;
  energy: number;
  returnIn: number;
  shaken: number;
}

const run = (page: Page): Promise<Run> => read<Run>(page, 'mp.clock()');
const meters = (page: Page): Promise<Meters> => read<Meters>(page, 'mp.vitals()');

/**
 * Fells the player and holds the run there, and returns the Health the fall took. The Core brings a
 * player back after six seconds of the run's clock, which keeps time while a frame (and every check
 * below waits for one) can take longer than that here. Letting go of the pointer pauses a run played
 * alone, and a tenth of a second on its clock is the step in which the Core sees the player down, or
 * the crew with no one left. All of it happens in one task, so nothing is missed in between.
 */
const fell = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const mp = window.__ashbound?.mp;
    if (!mp) return 0;
    const hurt = mp.hurtPlayer(1000);
    document.exitPointerLock();
    mp.warp(0.1);
    return hurt;
  });

test.describe('going down and coming back', () => {
  test('a player at no Health lies where they fell, the Core brings them back at the base shaken for a charge, and with none left the run ends', async ({
    page,
  }) => {
    const problems = await open(page);
    const spawn = await read<{ x: number; z: number }>(
      page,
      '({ x: game.world.spawn.x, z: game.world.spawn.z })',
    );

    await test.step('the crew starts with the respawns the table gives, and the HUD counts them', async () => {
      expect(await run(page)).toMatchObject({
        respawns: RESPAWN.startPerPlayer,
        respawnMax: RESPAWN.capPerPlayer,
        over: false,
        overWhy: null,
      });
      // One charge short of the most a lone player can hold, so the pill is on screen by day.
      await wait(page.locator('.ph-charges')).toBeVisible();
      await wait(page.locator('.ph-charges-value')).toHaveText(String(RESPAWN.startPerPlayer));
      await expect(page.locator('.ph-charges-pips i')).toHaveCount(RESPAWN.capPerPlayer);
      await expect(page.locator('.ph-charges-pips i[data-full]')).toHaveCount(
        RESPAWN.startPerPlayer,
      );
      await expect(page.locator('.ph-down')).toBeHidden();
    });

    await test.step('a fall to no Health lays the player down: the screen counts down, the legs and hands stop', async () => {
      await takeThePointer(page);
      await recordToasts(page);
      // Walk off from the base first, so that being brought back shows.
      await page.evaluate(
        ([x, z]) => {
          const game = window.__ashbound?.game;
          if (game) game.teleport(x! + 25, game.world.groundAt(x! + 25, z!) + 0.05, z!, 0);
        },
        [spawn.x, spawn.z] as const,
      );
      await frames(page, 2);
      expect(await read<boolean>(page, 'game.frozen')).toBe(false);

      expect(await fell(page)).toBe(VITALS.maxHealth);
      await poll(async () => (await meters(page)).health).toBe(0);
      expect((await meters(page)).returnIn).toBeGreaterThan(0);
      await wait(page.locator('.ph-down')).toBeVisible();
      await wait(page.locator('.ph-down-title')).toHaveText('You are down');
      await wait(page.locator('.ph-down-seconds')).toHaveText(/^[1-6]$/);
      await wait(page.locator('.ph')).toHaveAttribute('data-down', '');
      await poll(() => read<boolean>(page, 'game.frozen')).toBe(true);
      expect(await read<boolean>(page, 'build.isDown()')).toBe(true);
      // The change of light and the like are announced; so is this.
      await poll(() => toasts(page)).toContain('You are down');
    });

    await test.step('the host refuses the hands of a player who is down', async () => {
      await page.evaluate(
        ([x, z, state]) => {
          const mp = window.__ashbound!.mp!;
          const at = mp.position();
          mp.place(Math.floor(at.x) + x!, Math.floor(at.y), Math.floor(at.z) + z!, state!);
        },
        [2, 0, SCRAP] as const,
      );
      await poll(() => read<{ reason: string }[]>(page, 'mp.rejections()')).toEqual([
        expect.objectContaining({ reason: 'you are down' }),
      ]);
      expect(await read<number>(page, 'mp.blocks().count')).toBe(0);
    });

    await test.step('the Core brings them back at the base, full of Health, half of Energy and shaken, for one charge', async () => {
      await page.evaluate(
        (seconds) => window.__ashbound?.mp?.warp(seconds),
        RESPAWN.delaySeconds + 1,
      );
      await poll(async () => (await meters(page)).health).toBe(VITALS.maxHealth);
      const back = await meters(page);
      expect(back.returnIn).toBe(0);
      expect(back.energy).toBeLessThanOrEqual(VITALS.maxEnergy * RESPAWN.energy);
      expect(back.energy).toBeGreaterThanOrEqual(VITALS.maxEnergy * RESPAWN.energy - 3);
      expect(back.shaken).toBeGreaterThan(0);
      expect(back.shaken).toBeLessThanOrEqual(RESPAWN.shaken.seconds);
      expect((await run(page)).respawns).toBe(RESPAWN.startPerPlayer - 1);

      // At the base: the spawn point, not the spot 25 blocks away where they fell.
      await poll(async () => {
        const at = await read<{ x: number; z: number }>(page, 'mp.position()');
        return Math.hypot(at.x - spawn.x, at.z - spawn.z);
      }).toBeLessThan(0.5);

      await wait(page.locator('.ph-down')).toBeHidden();
      await poll(() => read<boolean>(page, 'game.frozen')).toBe(false);
      expect(await read<boolean>(page, 'build.isDown()')).toBe(false);
      await wait(page.locator('.ph-status-label')).toContainText('Shaken');
      await wait(page.locator('.ph-charges-value')).toHaveText(String(RESPAWN.startPerPlayer - 1));
      await poll(() => toasts(page)).toContain(
        `The Core brought you back, shaken · ${RESPAWN.startPerPlayer - 1} respawn left`,
      );
    });

    await test.step('a player who is back builds again', async () => {
      await page.evaluate(
        ([x, z, state]) => {
          const mp = window.__ashbound!.mp!;
          mp.placeNear(x!, z!, state!);
        },
        [3, 0, SCRAP] as const,
      );
      await poll(() => read<number>(page, 'mp.blocks().count')).toBe(1);
    });

    await test.step('with no charge left, a fall that nobody can come back from ends the run, and says why', async () => {
      await page.evaluate(() => window.__ashbound?.mp?.setRespawns(0));
      await wait(page.locator('.ph-charges-value')).toHaveText('0');
      await wait(page.locator('.ph-charges')).toHaveAttribute('data-tone', 'empty');
      await fell(page);
      await poll(async () => (await run(page)).over).toBe(true);
      expect(await run(page)).toMatchObject({ overWhy: 'crew', running: false, respawns: 0 });
      // The Core still stands.
      const core = await run(page);
      expect(core.coreHealth).toBe(core.coreMax);

      await wait(page.locator('.ph-down-title')).toHaveText('Outpost overrun');
      await wait(page.locator('.ph-down-detail')).toContainText('Every player is down');
      await wait(page.locator('.ph-banner-title')).toHaveText('The whole crew is down');
      await poll(() => toasts(page)).toContain('The whole crew is down');
    });

    expect(problems).toEqual([]);
  });
});
