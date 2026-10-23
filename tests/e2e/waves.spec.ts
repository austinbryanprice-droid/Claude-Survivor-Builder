import { expect, test, type Page } from '@playwright/test';
import { CYCLE_SECONDS } from '../../src/shared/daycycle';
import { ENEMIES, WAVES } from '../../src/systems/survival/balance';
import { planNight } from '../../src/systems/survival/waves';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster. Alone with the mouse free the run is held, so the nights
// are walked by warping the clock and the machines stand exactly where the waves put them.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 180_000 });

const STATE_TIMEOUT = 60_000;
const wait = expect.configure({ timeout: STATE_TIMEOUT });
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** The second night, from its first second: two waves of four, at 14 s and at 84 s. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&night=2';

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

/** Reads a value off the running game, e.g. `read<number>(page, 'mp.enemies().length')`. Needs `?debug`. */
const read = <T>(page: Page, expression: string): Promise<T> =>
  page.evaluate<T>(`(() => {
    const app = window.__ashbound;
    if (!app) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
    const { game, stage, mp } = app;
    return ${expression};
  })()`);

const warp = (page: Page, seconds: number): Promise<void> =>
  page.evaluate((s) => window.__ashbound?.mp?.warp(s), seconds);

interface Machine {
  id: number;
  x: number;
  z: number;
}

const machines = (page: Page): Promise<Machine[]> => read<Machine[]>(page, 'mp.enemies()');

test.describe('the waves of a night', () => {
  test('are announced ten seconds ahead, come out of the ground from one side, and fall back at dawn', async ({
    page,
  }) => {
    const problems = await open(page);
    const night = planNight(2);
    expect(night.waves.map((wave) => wave.kinds.length)).toEqual([4, 4]);
    const core = await read<{ x: number; z: number }>(
      page,
      '(() => { const { x, z } = game.world.voxels.outpost; return { x, z }; })()',
    );
    await wait(page.locator('.ph-clock')).toContainText('Night 2');

    await test.step('nothing comes before the crew is told', async () => {
      await warp(page, 3.9);
      expect(await machines(page)).toEqual([]);
      await warp(page, 0.1);
      await wait(page.locator('.toast')).toContainText('Wave 1 of 2: 4 machines in ten seconds');
    });

    await test.step('the first comes at fourteen seconds, and the rest a little after one another', async () => {
      await warp(page, 9.8);
      expect(await machines(page)).toEqual([]);
      await warp(page, 0.2);
      await poll(async () => (await machines(page)).length).toBe(1);
      await warp(page, 1.2);
      await poll(async () => (await machines(page)).length).toBe(4);
    });

    await test.step('all four come on the ring round the Core, from one side of it', async () => {
      const here = await machines(page);
      expect(new Set(here.map((m) => m.id)).size).toBe(4);
      const around = (m: Machine) => Math.atan2(m.z - core.z, m.x - core.x);
      for (const m of here) {
        const radius = Math.hypot(m.x - core.x, m.z - core.z);
        expect(radius).toBeGreaterThan(ENEMIES.spawnRadius - ENEMIES.spawnJitter - 4);
        expect(radius).toBeLessThan(ENEMIES.spawnRadius + ENEMIES.spawnJitter + 4);
        let apart = Math.abs(around(m) - around(here[0]!));
        if (apart > Math.PI) apart = 2 * Math.PI - apart;
        expect(apart).toBeLessThan(2 * WAVES.arc);
      }
    });

    await test.step('the second wave is announced seventy seconds after the first', async () => {
      // The machines are taken off the field on the way, so that they do not reach the Core.
      await page.evaluate(() => {
        const mp = window.__ashbound!.mp!;
        mp.clearEnemies();
        mp.warp(60);
        mp.clearEnemies();
      });
      await warp(page, 0.1);
      await wait(page.locator('.toast')).toContainText('Wave 2 of 2: 4 machines in ten seconds');
    });

    await test.step('what is still standing at dawn falls back', async () => {
      const dawn = 2 * CYCLE_SECONDS;
      await page.evaluate((to) => {
        const mp = window.__ashbound!.mp!;
        mp.clearEnemies();
        while (mp.clock().elapsed < to - 6) {
          mp.warp(Math.min(15, to - 6 - mp.clock().elapsed));
          mp.clearEnemies();
        }
        mp.spawnCrawlers(3);
      }, dawn);
      await poll(async () => (await machines(page)).length).toBe(3);
      await warp(page, 7);
      await wait(page.locator('.toast')).toContainText('Dawn breaks on day 3');
      await poll(async () => (await machines(page)).length).toBe(0);
      expect(await read<boolean>(page, 'mp.clock().over')).toBe(false);
    });

    expect(problems).toEqual([]);
  });
});
