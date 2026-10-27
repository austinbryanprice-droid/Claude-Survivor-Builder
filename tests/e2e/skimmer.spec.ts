import { expect, test, type Page } from '@playwright/test';
import { MATERIAL, MATERIALS, SHAPE, packState } from '../../src/shared/blocks';
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
/** Night 1, from its first second, with Scrap enough to put up a wall. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&night=1&waves=0&stock=100';

const SKIMMER = ENEMIES.flyer;
const HOVER = SKIMMER.flies.hover;
/** Shots that fell a skimmer: its health over the share of a hit it takes, over a hit. */
const SHOTS = Math.ceil(SKIMMER.health / SKIMMER.takes / BLASTER.damage);
const CELLS = SKIMMER.drop.amount;
const ENERGY_NAME = MATERIALS.find((material) => material.id === MATERIAL.energy)?.name;
const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);

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

/**
 * The host's simulation watches the players only while the run is playing, and a run played alone is
 * held while the pointer is free. So the test takes the pointer for a few frames, which lets the
 * simulation see the player where they stand, and lets it go again, so that the machines stand where
 * they are put and the test plays the host's time.
 */
async function beSeen(page: Page): Promise<void> {
  const running = async (): Promise<boolean> =>
    (await read<{ running: boolean }>(page, 'mp.clock()')).running;
  await page.getByRole('button', { name: 'Play' }).click();
  await wait(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
  await poll(running).toBe(true);
  await frames(page, 3);
  await page.evaluate(() => document.exitPointerLock());
  await wait(page.locator('#hud')).toHaveAttribute('data-pointer', 'free');
  await poll(running).toBe(false);
}

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

test.describe('the skimmer', () => {
  test('is a machine of its own: it hangs in the air, flies over a wall that would hold a crawler, zaps a player from above, and a felled one leaves Energy-Infused cells', async ({
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
    const cx = Math.floor(core.x);
    const cz = Math.floor(core.z);
    const groundAt = (x: number, z: number): Promise<number> =>
      read<number>(page, `game.world.groundAt(${x}, ${z})`);
    const teleport = async (x: number, z: number): Promise<void> => {
      await page.evaluate(
        ({ x, z }) => {
          const game = window.__ashbound!.game;
          game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
        },
        { x, z },
      );
      await frames(page, 2);
    };
    const put = (x: number, z: number, kind?: number): Promise<number | null> =>
      page.evaluate(({ x, z, kind }) => window.__ashbound!.mp!.spawnCrawlerAt(x, z, kind), {
        x,
        z,
        kind,
      });
    const clear = async (): Promise<void> => {
      await page.evaluate(() => window.__ashbound!.mp!.clearEnemies());
      await poll(async () => (await machines(page)).length).toBe(0);
    };
    const warp = (seconds: number): Promise<void> =>
      page.evaluate((seconds) => window.__ashbound!.mp!.warp(seconds), seconds);
    const health = (): Promise<number> => read<number>(page, 'mp.vitals().health');
    const fireAtIt = (): Promise<number | null> =>
      page.evaluate(() => window.__ashbound!.mp!.fireAtMachine());

    // A spot well away from the machines (a skimmer comes for a player within its aggro), one on
    // open ground with room round it, and the one the pictures of the crawler stand at.
    const away = { x: core.x - 14, z: core.z + 22 };
    const spot = { x: core.x - 14, z: core.z - 4 };
    const plain = { x: core.x - 19, z: core.z - 4 };
    const stand = { x: core.x - 14, z: core.z + 8 };
    expect(SKIMMER.aggro).toBeLessThan(Math.hypot(spot.x - stand.x, spot.z - stand.z));
    await teleport(away.x, away.z);

    await test.step('a skimmer and a crawler stand on the same open ground: the crawler on it, the skimmer in the air, each drawn by the mesh of its own kind', async () => {
      const ids = [await put(spot.x, spot.z, ENEMY_KIND.flyer), await put(plain.x, plain.z)];
      expect(ids.every((id) => id !== null)).toBe(true);
      await poll(async () => (await machines(page)).length).toBe(2);
      const here = await machines(page);
      expect(here.map((m) => m.kind).sort()).toEqual([ENEMY_KIND.crawler, ENEMY_KIND.flyer]);
      expect(here.every((m) => m.health === 1)).toBe(true);
      const skimmer = here.find((m) => m.kind === ENEMY_KIND.flyer) as Machine;
      const crawler = here.find((m) => m.kind === ENEMY_KIND.crawler) as Machine;
      expect(Math.abs(crawler.y - (await groundAt(crawler.x, crawler.z)))).toBeLessThan(0.2);
      // The hull hangs its hover over the ground, or a little more where the ground rises ahead of it.
      const hung = skimmer.y - (await groundAt(skimmer.x, skimmer.z));
      expect(hung).toBeGreaterThan(HOVER - 0.3);
      expect(hung).toBeLessThan(HOVER + 1.5);
      await poll(() => drawn(page, 'skimmers')).toEqual({ count: 1, visible: true, shadows: true });
      expect(await drawn(page, 'crawlers')).toEqual({ count: 1, visible: true, shadows: true });
      await frames(page, 2);
      expect(problems).toEqual([]);
    });

    await test.step('with the crawler gone the skimmer hangs alone, and the crawler’s mesh is put away', async () => {
      await clear();
      expect((await drawn(page, 'skimmers'))?.visible).toBe(false);
      await put(spot.x, spot.z, ENEMY_KIND.flyer);
      await poll(async () => (await machines(page)).length).toBe(1);
      expect((await machines(page))[0]).toMatchObject({ kind: ENEMY_KIND.flyer, health: 1 });
      await poll(() => drawn(page, 'skimmers')).toEqual({ count: 1, visible: true, shadows: true });
      expect((await drawn(page, 'crawlers'))?.visible).toBe(false);
      await page.screenshot({ path: testInfo.outputPath('skimmer-hanging.png') });
    });

    await test.step('a wall of six blocks across its way does not stop it: it climbs, passes over it, and the wall is as it was', async () => {
      await clear();
      // The wall: five columns six high, put up from just east of it, within reach of every block
      // (a block is placed within six blocks of the eyes, measured to its middle).
      const wallX = cx - 12;
      const columns = [-2, -1, 0, 1, 2];
      await teleport(wallX + 2.5, cz + 0.5);
      await page.evaluate(
        ({ wallX, cz, state, columns }) => {
          const { game, mp } = window.__ashbound!;
          for (const dz of columns) {
            const ground = Math.floor(game.world.groundAt(wallX + 0.5, cz + dz + 0.5));
            for (let y = ground; y < ground + 6; y++) mp!.place(wallX, y, cz + dz, state);
          }
        },
        { wallX, cz, state: SCRAP, columns },
      );
      await poll(() => read<number>(page, 'mp.blocks().count')).toBe(columns.length * 6);
      expect(await read<unknown[]>(page, 'mp.rejections()')).toEqual([]);
      const top = await read<number>(
        page,
        `Math.max(...${JSON.stringify(columns)}.map((dz) => Math.floor(game.world.groundAt(${wallX} + 0.5, ${cz} + dz + 0.5)) + 6))`,
      );

      // Away from it, so that it has only the Core to come for, along a line that crosses the wall.
      await teleport(away.x, away.z);
      const id = await put(wallX - 7.5, cz + 0.5, ENEMY_KIND.flyer);
      expect(id).not.toBeNull();
      const at = async (): Promise<Machine | undefined> =>
        (await machines(page)).find((m) => m.id === id);
      await poll(async () => (await at())?.x ?? -Infinity).toBeLessThan(wallX);
      const samples: { x: number; y: number }[] = [];
      for (let hop = 0; hop < 30; hop++) {
        const before = (await at())?.x ?? -Infinity;
        await warp(0.25);
        // The picture follows the host's clock a frame or two later.
        await poll(async () => (await at())?.x ?? -Infinity).toBeGreaterThan(before + 0.3);
        const now = (await at()) as Machine;
        samples.push({ x: now.x, y: now.y });
        if (now.x > wallX + 3) break;
      }
      expect((samples.at(-1) as { x: number }).x).toBeGreaterThan(wallX + 3);
      const over = samples.filter((s) => s.x > wallX - 0.5 && s.x < wallX + 1.5);
      expect(over.length).toBeGreaterThan(0);
      for (const s of over) expect(s.y).toBeGreaterThanOrEqual(top);
      // It never chewed: every block of the wall is still there.
      expect(await read<number>(page, 'mp.blocks().count')).toBe(columns.length * 6);
      await page.screenshot({ path: testInfo.outputPath('skimmer-past-the-wall.png') });
    });

    await test.step('it comes down on a player and zaps them from above, for the points in its table', async () => {
      await clear();
      await teleport(stand.x, stand.z);
      await beSeen(page);
      const before = await health();
      expect(before).toBeGreaterThan(SKIMMER.bite.player);
      const id = await put(stand.x + 3.5, stand.z - 2.5, ENEMY_KIND.flyer);
      expect(id).not.toBeNull();
      await poll(async () => (await machines(page)).length).toBe(1);
      let zapped = false;
      for (let hop = 0; hop < 40 && !zapped; hop++) {
        await warp(0.1);
        zapped = (await health()) < before;
      }
      expect(zapped).toBe(true);
      expect(await health()).toBe(before - SKIMMER.bite.player);
      // It hangs over the player, within the reach across and the height below its hull.
      const me = await read<{ x: number; y: number; z: number }>(page, 'mp.position()');
      await poll(async () => {
        const m = (await machines(page))[0] as Machine;
        return Math.hypot(m.x - me.x, m.z - me.z);
      }).toBeLessThanOrEqual(SKIMMER.reach.player + 0.3);
      const over = (await machines(page))[0] as Machine;
      expect(over.y - me.y).toBeGreaterThan(1.5);
      expect(over.y - me.y).toBeLessThanOrEqual(SKIMMER.reach.height);
      await frames(page, 2);
      await page.screenshot({ path: testInfo.outputPath('skimmer-zapped.png') });
    });

    await test.step(`${SHOTS} shots fell it, with the share a hit takes off it, and the cells are in the pool with a message`, async () => {
      await clear();
      await teleport(stand.x, stand.z);
      // The pool opens with a stock of every material (the page was asked for one), Energy-Infused among them.
      const held = await energyInPool(page);
      const told = (await toasts(page)).length;
      const id = await put(spot.x, spot.z, ENEMY_KIND.flyer);
      expect(id).not.toBeNull();
      await poll(async () => (await machines(page)).length).toBe(1);
      /** Plays the time it takes the blaster to be ready again, then fires. */
      const fireWhenReady = async (): Promise<number | null> => {
        await warp(BLASTER.interval + 0.05);
        return fireAtIt();
      };
      const share = (BLASTER.damage * SKIMMER.takes) / SKIMMER.health;
      expect(await fireAtIt()).toBe(id);
      if (SHOTS > 1) {
        await poll(async () => (await machines(page))[0]?.health ?? 0).toBeCloseTo(1 - share, 2);
        for (let shot = 2; shot < SHOTS; shot++) expect(await fireWhenReady()).toBe(id);
        expect(await fireWhenReady()).toBe(id);
      }
      await poll(async () => (await machines(page)).length).toBe(0);
      const felled = (await shotsOf(page)).filter((s) => (s.flags & SHOT_FLAG.kill) !== 0);
      expect(felled).toHaveLength(1);
      expect(felled[0]?.predicted).toBe(false);
      expect(CELLS).toBeGreaterThan(0);
      await poll(() => energyInPool(page)).toBe(held + CELLS);
      await poll(() => toasts(page)).toContain(
        `A machine left ${CELLS} ${ENERGY_NAME} in the pool`,
      );
      expect((await toasts(page)).length).toBeGreaterThan(told);
      expect((await read<{ gathered: number }>(page, 'mp.clock()')).gathered).toBe(CELLS);
      expect((await drawn(page, 'skimmers'))?.visible).toBe(false);
      await frames(page, 2);
      await page.screenshot({ path: testInfo.outputPath('skimmer-felled.png') });
    });
    expect(problems).toEqual([]);
  });
});
