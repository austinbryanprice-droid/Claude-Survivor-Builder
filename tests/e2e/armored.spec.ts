import { expect, test, type Page } from '@playwright/test';
import { MATERIAL, MATERIALS } from '../../src/shared/blocks';
import { ENEMY_KIND } from '../../src/shared/enemy-state';
import { poolSlot } from '../../src/shared/economy';
import { SHOT_FLAG } from '../../src/shared/shot';
import { BLASTER, ENEMIES } from '../../src/systems/survival/balance';
import { recordToasts, toasts } from './support/toasts';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster. With the pointer free the run is held, so the machines
// stand where they were put until the test plays the host's time (`warp`).
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

const STATE_TIMEOUT = 60_000;
const wait = expect.configure({ timeout: STATE_TIMEOUT });
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** Night 1, from its first second, so that the light is the one the machines come in. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&night=1&waves=0';

/** Shots that fell an armored crawler on the first night: its health over the share of a hit it takes, over a hit. */
const SHOTS = Math.ceil(ENEMIES.armored.health / ENEMIES.armored.takes / BLASTER.damage);
const CELLS = ENEMIES.armored.drop?.amount ?? 0;
const ENERGY_NAME = MATERIALS.find((material) => material.id === MATERIAL.energy)?.name;

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
    const { game, stage, mp, build } = app;
    return ${expression};
  })()`);

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

interface Machine {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  health: number;
}

interface Shot {
  by: number;
  flags: number;
  predicted: boolean;
}

interface Drawn {
  count: number;
  visible: boolean;
  shadows: boolean;
}

const machines = (page: Page): Promise<Machine[]> => read<Machine[]>(page, 'mp.enemies()');
const shotsOf = (page: Page): Promise<Shot[]> => read<Shot[]>(page, 'mp.shots().shots');
const energyInPool = async (page: Page): Promise<number> =>
  (await read<{ stock: number[] }>(page, 'mp.pool()')).stock[poolSlot(MATERIAL.energy)] as number;
/** What the instanced mesh of a kind of machine is drawing now, or null where the stage has no such mesh. */
const drawn = (page: Page, name: string): Promise<Drawn | null> =>
  read<Drawn | null>(
    page,
    `(() => {
      const mesh = stage.world.getObjectByName(${JSON.stringify(name)});
      return mesh
        ? { count: mesh.geometry.instanceCount, visible: mesh.visible, shadows: mesh.castShadow }
        : null;
    })()`,
  );

test.describe('the armored crawler', () => {
  test('is a machine of its own: drawn by its own mesh, plated against the blaster, and a felled one leaves Tier 4 cells in the pool', async ({
    page,
  }, testInfo) => {
    const problems = await open(page);
    await recordToasts(page);
    const core = await read<{ x: number; z: number }>(
      page,
      `(() => {
        const { x, z } = game.world.voxels.outpost;
        return { x, z };
      })()`,
    );
    // Twelve blocks from a machine on open ground, as the pictures of the crawler have it.
    const target = { x: core.x - 14, z: core.z - 4 };
    const plain = { x: core.x - 19, z: core.z - 4 };
    const stand = { x: core.x - 14, z: core.z + 8 };
    await page.evaluate(
      ({ stand }) => {
        const game = window.__ashbound!.game;
        game.teleport(stand.x, game.world.groundAt(stand.x, stand.z) + 0.05, stand.z, 0);
      },
      { stand },
    );
    await frames(page, 2);

    await test.step('an armored and a plain crawler stand side by side, each drawn by the mesh of its own kind', async () => {
      const ids = await page.evaluate(
        ({ target, plain }) => {
          const mp = window.__ashbound!.mp!;
          return [mp.spawnCrawlerAt(target.x, target.z, 1), mp.spawnCrawlerAt(plain.x, plain.z)];
        },
        { target, plain },
      );
      expect(ids.every((id) => id !== null)).toBe(true);
      await poll(async () => (await machines(page)).length).toBe(2);
      const here = await machines(page);
      expect(here.map((m) => m.kind).sort()).toEqual([ENEMY_KIND.crawler, ENEMY_KIND.armored]);
      expect(here.every((m) => m.health === 1)).toBe(true);
      await poll(() => drawn(page, 'armored')).toEqual({ count: 1, visible: true, shadows: true });
      expect(await drawn(page, 'crawlers')).toEqual({ count: 1, visible: true, shadows: true });
      await frames(page, 2);
      expect(problems).toEqual([]);
    });

    await test.step('with the plain one gone the plated one stands alone, whole, and the plain kind’s mesh is put away', async () => {
      await page.evaluate(() => window.__ashbound!.mp!.clearEnemies());
      await poll(async () => (await machines(page)).length).toBe(0);
      expect((await drawn(page, 'armored'))?.visible).toBe(false);
      await page.evaluate(
        ({ target }) => window.__ashbound!.mp!.spawnCrawlerAt(target.x, target.z, 1),
        { target },
      );
      await poll(async () => (await machines(page)).length).toBe(1);
      expect((await machines(page))[0]).toMatchObject({ kind: ENEMY_KIND.armored, health: 1 });
      await poll(() => drawn(page, 'armored')).toEqual({ count: 1, visible: true, shadows: true });
      expect((await drawn(page, 'crawlers'))?.visible).toBe(false);
      await page.screenshot({ path: testInfo.outputPath('armored-standing.png') });
    });

    const fireAtIt = (): Promise<number | null> =>
      page.evaluate(() => window.__ashbound!.mp!.fireAtMachine());
    const armored = ((await machines(page))[0] as Machine).id;
    expect(await energyInPool(page)).toBe(0);

    // One shot takes this share of the machine's points off, and a plain crawler would be down a third.
    const share = (BLASTER.damage * ENEMIES.armored.takes) / ENEMIES.armored.health;
    const healthAfter = (shots: number): number => 1 - shots * share;
    /** Plays the time it takes the blaster to be ready again, then fires. The host allows a shot an interval once its bank of two is spent. */
    const fireWhenReady = async (): Promise<number | null> => {
      await page.evaluate(
        (seconds) => window.__ashbound!.mp!.warp(seconds),
        BLASTER.interval + 0.05,
      );
      return fireAtIt();
    };

    await test.step('one shot takes only the share its plating lets through', async () => {
      expect(await fireAtIt()).toBe(armored);
      await poll(async () => (await machines(page))[0]?.health ?? 0).toBeCloseTo(healthAfter(1), 2);
      expect(share).toBeLessThan(BLASTER.damage / ENEMIES.crawler.health / 2);
    });

    await test.step(`${SHOTS - 1} shots leave it standing with a few points, and nothing in the pool`, async () => {
      for (let shot = 2; shot < SHOTS; shot++) expect(await fireWhenReady()).toBe(armored);
      await poll(async () => (await machines(page))[0]?.health ?? 0).toBeCloseTo(
        healthAfter(SHOTS - 1),
        2,
      );
      expect((await machines(page))[0]?.health).toBeGreaterThan(0);
      expect(await energyInPool(page)).toBe(0);
      expect((await toasts(page)).filter((t) => t.startsWith('A machine left'))).toEqual([]);
    });

    await test.step(`the ${SHOTS}th fells it, and is the one the host calls a kill`, async () => {
      expect(await fireWhenReady()).toBe(armored);
      await poll(async () => (await machines(page)).length).toBe(0);
      const felled = (await shotsOf(page)).filter((s) => (s.flags & SHOT_FLAG.kill) !== 0);
      expect(felled).toHaveLength(1);
      expect(felled[0]?.predicted).toBe(false);
    });

    await test.step('the cells are in the pool, the crew is told how many, and the results count them', async () => {
      expect(CELLS).toBeGreaterThan(0);
      await poll(() => energyInPool(page)).toBe(CELLS);
      await poll(() => toasts(page)).toContain(
        `A machine left ${CELLS} ${ENERGY_NAME} in the pool`,
      );
      expect((await read<{ gathered: number }>(page, 'mp.clock()')).gathered).toBe(CELLS);
      await frames(page, 2);
      await page.screenshot({ path: testInfo.outputPath('armored-dropped.png') });
    });

    await test.step('a plain crawler that falls leaves nothing, and says nothing', async () => {
      await page.evaluate(
        ({ target }) => window.__ashbound!.mp!.spawnCrawlerAt(target.x, target.z),
        { target },
      );
      await poll(async () => (await machines(page)).length).toBe(1);
      const crawler = ((await machines(page))[0] as Machine).id;
      const told = (await toasts(page)).length;
      for (let shot = 0; shot < 3; shot++) expect(await fireWhenReady()).toBe(crawler);
      await poll(async () => (await machines(page)).length).toBe(0);
      expect(await energyInPool(page)).toBe(CELLS);
      await frames(page, 2);
      expect(
        (await toasts(page)).slice(told).filter((t) => t.startsWith('A machine left')),
      ).toEqual([]);
    });
    expect(problems).toEqual([]);
  });
});
