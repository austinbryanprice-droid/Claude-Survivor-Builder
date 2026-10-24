import { expect, test, type Page } from '@playwright/test';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';
import { RESPAWN, VITALS } from '../../src/systems/survival/balance';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

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

/** Reads a value off the running game, e.g. `read<number>(page, 'game.world.seed')`. Needs `?debug`. */
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

interface Run {
  elapsed: number;
  running: boolean;
  coreHealth: number;
  coreMax: number;
  over: boolean;
  overWhy: 'core' | 'crew' | null;
  respawns: number;
  felled: number;
  placed: number;
  revived: number;
}

const run = (page: Page): Promise<Run> => read<Run>(page, 'mp.clock()');
const seed = (page: Page): Promise<number> => read<number>(page, 'game.world.seed');
const runNumber = (page: Page): Promise<number> => read<number>(page, 'mp.session().run');
const blocks = (page: Page): Promise<number> => read<number>(page, 'mp.blocks().count');
const loseTheCore = (page: Page): Promise<void> =>
  page.evaluate(() => window.__ashbound?.mp?.hurtCore(5000));

/** The tiles of the results card, by label. */
const tiles = (page: Page): Promise<Record<string, string>> =>
  page
    .locator('.run-results .stats .stat')
    .evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.map((node) => [
          node.querySelector('span')?.textContent ?? '',
          node.querySelector('strong')?.textContent ?? '',
        ]),
      ),
    );

test.describe('a lost run', () => {
  test('ends in the Outpost Overrun card, and Retry plays the same valley again and New Run another, each from the start', async ({
    page,
  }) => {
    const problems = await open(page);
    const results = page.locator('.run-results');
    const first = await seed(page);
    const spawn = await read<{ x: number; z: number }>(
      page,
      '({ x: game.world.spawn.x, z: game.world.spawn.z })',
    );

    await test.step('the crew builds a little, and the Core falls while the player is playing', async () => {
      await takeThePointer(page);
      await page.evaluate(
        ([state]) => {
          const mp = window.__ashbound!.mp!;
          mp.placeNear(3, 0, state!);
          mp.placeNear(4, 0, state!);
        },
        [SCRAP] as const,
      );
      await poll(() => blocks(page)).toBe(2);
      await wait(results).toBeHidden();
      await loseTheCore(page);
      await poll(async () => (await run(page)).over).toBe(true);
      expect(await run(page)).toMatchObject({ overWhy: 'core', placed: 2, felled: 0, revived: 0 });
    });

    await test.step('a moment later the mouse is freed and the results card takes the place of the pause card', async () => {
      await wait(page.locator('#hud')).toHaveAttribute('data-pointer', 'free');
      await wait(results).toBeVisible();
      await expect(page.locator('.pause')).toBeHidden();
      await expect(results.locator('h1')).toHaveText('Outpost Overrun');
      await expect(results.locator('.lede')).toHaveText('The Outpost Core fell on Day 1.');
      await expect(results.locator('.stat.hero strong')).toHaveText('0');
      await expect(results.locator('.stat.hero span')).toHaveText('nights survived');
      const stats = await tiles(page);
      expect(stats['Time held']).toMatch(/^\d+:\d\d$/);
      expect(stats).toMatchObject({
        'Machines destroyed': '0',
        'Blocks placed': '2',
        'Respawns used': '0',
      });
      await expect(results.getByRole('button', { name: 'Retry' })).toBeEnabled();
      await expect(results.getByRole('button', { name: 'New Run' })).toBeEnabled();
    });

    await test.step('Retry: the same valley, nothing built, the clock at the start, the player back in the game at the base', async () => {
      await results.getByRole('button', { name: 'Retry' }).click();
      await wait(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
      await wait(results).toBeHidden();
      await poll(async () => (await run(page)).over).toBe(false);
      await poll(() => runNumber(page)).toBe(2);
      expect(await seed(page)).toBe(first);
      expect(await blocks(page)).toBe(0);
      const again = await run(page);
      expect(again).toMatchObject({
        overWhy: null,
        coreHealth: again.coreMax,
        respawns: RESPAWN.startPerPlayer,
        felled: 0,
        placed: 0,
        revived: 0,
      });
      expect(again.elapsed).toBeLessThan(30);
      expect((await read<{ health: number }>(page, 'mp.vitals()')).health).toBe(VITALS.maxHealth);
      await poll(async () => {
        const at = await read<{ x: number; z: number }>(page, 'mp.position()');
        return Math.hypot(at.x - spawn.x, at.z - spawn.z);
      }).toBeLessThan(1);
    });

    await test.step('the new run can be built in and lost again, and the card is fresh', async () => {
      await page.evaluate(([state]) => window.__ashbound!.mp!.placeNear(3, 0, state!), [
        SCRAP,
      ] as const);
      await poll(() => blocks(page)).toBe(1);
      await loseTheCore(page);
      await wait(page.locator('#hud')).toHaveAttribute('data-pointer', 'free');
      await wait(results).toBeVisible();
      await expect(results.getByRole('button', { name: 'Retry' })).toBeEnabled();
      expect(await tiles(page)).toMatchObject({ 'Blocks placed': '1' });
    });

    await test.step('New Run: another valley, nothing built, the third run', async () => {
      await results.getByRole('button', { name: 'New Run' }).click();
      await wait(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
      await wait(results).toBeHidden();
      await poll(() => runNumber(page)).toBe(3);
      expect(await seed(page)).not.toBe(first);
      expect(await blocks(page)).toBe(0);
      expect(await run(page)).toMatchObject({ over: false, placed: 0 });
    });

    expect(problems).toEqual([]);
  });

  test('shows the card at once to a player who is not in the game when the Core falls, and is not in the way of a run that goes on', async ({
    page,
  }) => {
    const problems = await open(page);
    const results = page.locator('.run-results');
    await expect(results).toBeHidden();
    await expect(page.locator('.pause')).toBeVisible();

    await loseTheCore(page);
    await wait(results).toBeVisible();
    await expect(page.locator('.pause')).toBeHidden();
    await expect(results.getByRole('button', { name: 'Retry' })).toBeVisible();

    // The choice is made on the card, and the card is gone with the new run.
    await results.getByRole('button', { name: 'New Run' }).click();
    await poll(() => runNumber(page)).toBe(2);
    await wait(results).toBeHidden();
    expect(await run(page)).toMatchObject({ over: false });
    expect(problems).toEqual([]);
  });
});
