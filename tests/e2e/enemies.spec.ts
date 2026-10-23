import { expect, test, type Page } from '@playwright/test';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';
import { ENEMIES } from '../../src/systems/survival/balance';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster. The crawlers walk in real time (the host's simulation
// runs on timers, not on frames), so a march that takes twenty seconds takes twenty seconds here.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

const STATE_TIMEOUT = 60_000;
const MARCH_TIMEOUT = 150_000;
const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the patience of a march: the machines only move as fast as the clock. */
const poll = <T>(read: () => Promise<T>, timeout = STATE_TIMEOUT) => expect.poll(read, { timeout });
/** Night 1, from its first second: nothing mends the Core, and the light is the one the machines come in. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&night=1&waves=0';

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

interface Core {
  cellX: number;
  cellZ: number;
  baseY: number;
  x: number;
  z: number;
}

interface Machine {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  health: number;
}

interface Reading {
  coreHealth: number;
  coreMax: number;
  over: boolean;
  running: boolean;
}

const coreOf = (page: Page): Promise<Core> =>
  read<Core>(
    page,
    `(() => {
      const { cellX, cellZ, baseY, x, z } = game.world.voxels.outpost;
      return { cellX, cellZ, baseY, x, z };
    })()`,
  );
const machines = (page: Page): Promise<Machine[]> => read<Machine[]>(page, 'mp.enemies()');
const clock = (page: Page): Promise<Reading> => read<Reading>(page, 'mp.clock()');
const awayFrom = (core: Core, machine: Machine): number =>
  Math.hypot(machine.x - core.x, machine.z - core.z);
const nearest = async (page: Page, core: Core): Promise<number> => {
  const all = await machines(page);
  return all.length === 0 ? Infinity : Math.min(...all.map((m) => awayFrom(core, m)));
};

test.describe('the crawlers', () => {
  test('come in from the ring, walk the ground to the Core and wound it', async ({
    page,
  }, testInfo) => {
    const problems = await open(page);
    const core = await coreOf(page);

    await test.step('six come in, all of them on the ring round the Core, on the ground', async () => {
      // Alone with the mouse free the run is held, so they are shown exactly where they were put:
      // a software-rendered frame is seconds apart, and in that time a running crawler walks far.
      expect(await page.evaluate(() => window.__ashbound?.mp?.spawnCrawlers(6))).toBe(6);
      await poll(async () => (await machines(page)).length).toBe(6);
      const here = await machines(page);
      expect(new Set(here.map((m) => m.id)).size).toBe(6);
      for (const m of here) {
        expect(m.kind).toBe(0);
        expect(m.health).toBe(1);
        expect(awayFrom(core, m)).toBeGreaterThan(ENEMIES.spawnRadius - ENEMIES.spawnJitter - 1);
        expect(awayFrom(core, m)).toBeLessThan(ENEMIES.spawnRadius + ENEMIES.spawnJitter + 1);
        const ground = await read<number>(page, `game.world.groundAt(${m.x}, ${m.z})`);
        expect(m.y).toBeGreaterThan(ground - 0.5);
        expect(m.y).toBeLessThan(ground + 3);
      }
    });

    await test.step('they are one instanced mesh, drawn without a shader error', async () => {
      const drawn = await read<{ count: number; shadows: boolean } | null>(
        page,
        `(() => {
          const mesh = stage.world.getObjectByName('crawlers');
          return mesh ? { count: mesh.geometry.instanceCount, shadows: mesh.castShadow } : null;
        })()`,
      );
      expect(drawn).toEqual({ count: 6, shadows: true });
      await frames(page, 2);
      expect(problems).toEqual([]);
    });

    // Now the player takes the mouse, the run goes on, and so do they.
    await takeThePointer(page);
    await poll(async () => (await clock(page)).running).toBe(true);
    const coreStart = (await clock(page)).coreHealth;
    expect(coreStart).toBe((await clock(page)).coreMax);

    await test.step('they march: the nearest of them keeps coming until it is at the Core', async () => {
      const before = await nearest(page, core);
      await poll(() => nearest(page, core), MARCH_TIMEOUT).toBeLessThan(Math.min(before - 6, 25));
      await poll(() => nearest(page, core), MARCH_TIMEOUT).toBeLessThan(5);
      await page.screenshot({ path: testInfo.outputPath('crawlers-at-the-core.png') });
    });

    await test.step('and they bite: the Core loses health, and the number is the host’s', async () => {
      await poll(async () => (await clock(page)).coreHealth, MARCH_TIMEOUT).toBeLessThan(coreStart);
      const gauge = page.locator('.ph-core-value');
      await wait(gauge).not.toHaveText(String(coreStart));
      expect((await clock(page)).over).toBe(false);
    });

    await test.step('clearing the field takes them off the screen', async () => {
      await page.evaluate(() => window.__ashbound?.mp?.clearEnemies());
      await poll(async () => (await machines(page)).length).toBe(0);
      const hidden = await read<boolean>(
        page,
        `(() => !stage.world.getObjectByName('crawlers').visible)()`,
      );
      expect(hidden).toBe(true);
    });
    expect(problems).toEqual([]);
  });

  test('chew through a wall of blocks, which the world loses like any block, and then reach the Core', async ({
    page,
  }) => {
    const problems = await open(page);
    const core = await coreOf(page);
    await takeThePointer(page);

    // Stand on the Core's east side, inside the ring about to be built and within reach of all of
    // it, and let a few frames carry the new position to the session.
    const stand = { x: core.x + 2.7, z: core.z };
    await page.evaluate(({ x, z }) => {
      const game = window.__ashbound?.game;
      if (game) game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
    }, stand);
    await frames(page, 3);

    const cx = Math.floor(core.x);
    const cz = Math.floor(core.z);
    const half = 4;
    await test.step('a ring of scrap blocks goes up round the Core', async () => {
      const cells = await page.evaluate(
        ({ cx, cz, half, state }) => {
          const { game, mp } = window.__ashbound!;
          const placed: { x: number; y: number; z: number }[] = [];
          for (let x = cx - half; x <= cx + half; x++) {
            for (let z = cz - half; z <= cz + half; z++) {
              if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== half) continue;
              const y = Math.floor(game.world.groundAt(x + 0.5, z + 0.5));
              mp!.place(x, y, z, state);
              placed.push({ x, y, z });
            }
          }
          return placed;
        },
        { cx, cz, half, state: SCRAP },
      );
      expect(cells).toHaveLength(8 * half);
      await poll(() => read<number>(page, 'mp.blocks().count')).toBe(8 * half);
      expect(await read<unknown[]>(page, 'mp.rejections()')).toEqual([]);
    });

    // Now away from it, so the machines have only the Core to come for.
    await page.evaluate(
      ({ x, z }) => {
        const game = window.__ashbound?.game;
        if (game) game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
      },
      { x: core.x, z: core.z + 30 },
    );
    await frames(page, 3);

    await test.step('four crawlers come from outside it, and chew their way in', async () => {
      const outside = 9;
      const ids = await page.evaluate(
        ({ x, z, d }) => {
          const mp = window.__ashbound!.mp!;
          return [
            mp.spawnCrawlerAt(x + d, z),
            mp.spawnCrawlerAt(x - d, z),
            mp.spawnCrawlerAt(x, z + d),
            mp.spawnCrawlerAt(x, z - d),
          ];
        },
        { x: cx + 0.5, z: cz + 0.5, d: outside },
      );
      expect(ids.filter((id) => id !== null)).toHaveLength(4);
      await poll(async () => (await machines(page)).length).toBe(4);
      // The wall holds for a moment: none of them is in yet.
      const farthest = Math.max(...(await machines(page)).map((m) => awayFrom(core, m)));
      expect(farthest).toBeGreaterThan(half - 0.5);

      const events = await read<number>(page, 'mp.eventCount()');
      // Chewed blocks are the world's own change, announced like any: the count falls, events arrive.
      await poll(() => read<number>(page, 'mp.blocks().count'), MARCH_TIMEOUT).toBeLessThan(
        8 * half,
      );
      expect(await read<number>(page, 'mp.eventCount()')).toBeGreaterThan(events);
    });

    await test.step('through the gap they reach the Core and wound it', async () => {
      const start = (await clock(page)).coreMax;
      await poll(async () => (await clock(page)).coreHealth, MARCH_TIMEOUT).toBeLessThan(start);
      expect(await nearest(page, core)).toBeLessThan(5);
    });
    expect(problems).toEqual([]);
  });

  test('stand still when the clock does: with the pointer free the field is held, and it goes on when the player does', async ({
    page,
  }) => {
    const problems = await open(page);
    const core = await coreOf(page);
    await page.evaluate(() => window.__ashbound?.mp?.spawnCrawlers(3));
    await poll(async () => (await machines(page)).length).toBe(3);
    const held = await machines(page);
    await frames(page, 3);
    // Alone in the world with the mouse free, the run waits, and so do they.
    const later = await machines(page);
    expect(later.map((m) => [m.id, m.x, m.z])).toEqual(held.map((m) => [m.id, m.x, m.z]));
    await takeThePointer(page);
    await poll(
      async () => (await nearest(page, core)) < Math.min(...held.map((m) => awayFrom(core, m))) - 2,
    ).toBe(true);
    expect(problems).toEqual([]);
  });
});
