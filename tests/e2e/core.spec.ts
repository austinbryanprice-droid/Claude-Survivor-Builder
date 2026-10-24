import { expect, test, type Page } from '@playwright/test';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 180_000 });

const STATE_TIMEOUT = 60_000;
/** The length of the day, in seconds (src/shared/daycycle.ts). */
const DAY_SECONDS = 480;
const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const wait = expect.configure({ timeout: STATE_TIMEOUT });

async function open(page: Page, query: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(`./${query}`);
  await wait(page.locator('html')).toHaveAttribute('data-ready', 'true');
  // Playing together loads after the game is up, and the run lives in it.
  await page.waitForFunction(() => !!window.__ashbound?.mp, null, { timeout: STATE_TIMEOUT });
  return problems;
}

/** Reads a value off the running game, e.g. `read<number>(page, 'mp.clock().coreHealth')`. Needs `?debug`. */
const read = <T>(page: Page, expression: string): Promise<T> =>
  page.evaluate<T>(`(() => {
    const app = window.__ashbound;
    if (!app) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
    const { game, stage, mp } = app;
    return ${expression};
  })()`);

interface Core {
  cellX: number;
  cellZ: number;
  baseY: number;
  x: number;
  z: number;
}

interface Reading {
  elapsed: number;
  running: boolean;
  coreHealth: number;
  coreMax: number;
  over: boolean;
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

const clock = (page: Page): Promise<Reading> => read<Reading>(page, 'mp.clock()');
const hurt = (page: Page, amount: number): Promise<void> =>
  page.evaluate((n) => window.__ashbound?.mp?.hurtCore(n), amount);

test.describe('the Outpost Core', () => {
  test('stands in the crater, solid to everything but blocks that go against it', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&quality=low&freeze=1&stats=0&waves=0');
    const core = await read<Core>(
      page,
      `(() => {
        const { cellX, cellZ, baseY, x, z } = game.world.voxels.outpost;
        return { cellX, cellZ, baseY, x, z };
      })()`,
    );
    // The host measures how far an edit is from where the player last was, and the player starts at
    // the lake shore. Stand on the Core's west side, within reach of every cell used below, and let
    // a few frames carry the new position to the session.
    await page.evaluate(
      ({ x, z }) => {
        const game = window.__ashbound?.game;
        if (game) game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
      },
      { x: core.x - 5.5, z: core.z },
    );
    await frames(page, 3);
    const solid = (dx: number, dy: number, dz: number) =>
      read<boolean>(
        page,
        `game.world.collision.isSolid(${core.cellX + dx}, ${core.baseY + dy}, ${core.cellZ + dz})`,
      );

    await test.step('it is a 3 by 3 footprint, 4 cells high, solid to movement', async () => {
      for (const dx of [0, 1, 2]) {
        for (const dz of [0, 1, 2]) {
          for (const dy of [0, 3]) expect(await solid(dx, dy, dz), `${dx} ${dy} ${dz}`).toBe(true);
        }
      }
      expect(await solid(-1, 1, 1)).toBe(false);
      expect(await solid(3, 1, 1)).toBe(false);
      expect(await solid(1, 1, -1)).toBe(false);
      expect(await solid(1, 1, 3)).toBe(false);
      expect(await solid(1, 4, 1)).toBe(false);
    });

    await test.step('it is drawn where the world holds it', async () => {
      const where = await read<{ x: number; y: number; z: number } | null>(
        page,
        `(() => { const o = stage.world.getObjectByName('outpost-core'); return o ? o.position : null; })()`,
      );
      expect(where).toEqual({ x: core.x, y: core.baseY, z: core.z });
    });

    await test.step('the cursor sees it as a surface, so the crosshair stops on its face', async () => {
      // A player's cursor works on the ground query, which knows the Core as well as the hills.
      const hit = await read<boolean>(
        page,
        `game.world.collision.ground.distance(${core.x}, ${core.baseY + 1}, ${core.z}) < 0`,
      );
      expect(hit).toBe(true);
    });

    await test.step('a block cannot be put where the Core is, and the refusal comes back', async () => {
      const cell = { x: core.cellX + 1, y: core.baseY + 2, z: core.cellZ + 1 };
      const events = await read<number>(page, 'mp.eventCount()');
      await page.evaluate(([x, y, z, state]) => window.__ashbound?.mp?.place(x!, y!, z!, state!), [
        cell.x,
        cell.y,
        cell.z,
        SCRAP,
      ] as const);
      await expect
        .poll(() => read<{ reason: string }[]>(page, 'mp.rejections()'), {
          timeout: STATE_TIMEOUT,
        })
        .toEqual([expect.objectContaining({ reason: 'reserved' })]);
      expect(await read<number>(page, `mp.block(${cell.x}, ${cell.y}, ${cell.z})`)).toBe(0);
      expect(await read<number>(page, 'mp.eventCount()')).toBe(events);
    });

    await test.step('a block can go against its face high above the ground, and nowhere near it cannot', async () => {
      // Three cells up there is no ground to hold a block, so only the Core can: this one touches
      // its west face, and the next one two cells further out touches nothing.
      const against = { x: core.cellX - 1, y: core.baseY + 3, z: core.cellZ + 1 };
      const apart = { x: core.cellX - 3, y: core.baseY + 3, z: core.cellZ + 1 };
      await page.evaluate(
        ([ax, ay, az, bx, by, bz, state]) => {
          const mp = window.__ashbound?.mp;
          mp?.place(ax!, ay!, az!, state!);
          mp?.place(bx!, by!, bz!, state!);
        },
        [against.x, against.y, against.z, apart.x, apart.y, apart.z, SCRAP] as const,
      );
      await expect
        .poll(() => read<number>(page, `mp.block(${against.x}, ${against.y}, ${against.z})`), {
          timeout: STATE_TIMEOUT,
        })
        .toBe(SCRAP);
      await expect
        .poll(
          () =>
            read<{ reason: string }[]>(page, 'mp.rejections().map((r) => ({ reason: r.reason }))'),
          {
            timeout: STATE_TIMEOUT,
          },
        )
        .toEqual([{ reason: 'reserved' }, { reason: 'unsupported' }]);
      expect(await read<number>(page, `mp.block(${apart.x}, ${apart.y}, ${apart.z})`)).toBe(0);
    });

    expect(problems).toEqual([]);
  });

  test('its gauge comes up when it is hurt, and the run ends and the clock stops when it falls', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&quality=low&freeze=1&stats=0&waves=0');
    const gauge = page.locator('.ph-core');

    await test.step('by day, whole, there is no gauge', async () => {
      expect(await clock(page)).toMatchObject({ coreHealth: 1000, coreMax: 1000, over: false });
      await wait(gauge).toBeHidden();
    });

    await test.step('a wound brings it up by day, and it reads what is left', async () => {
      await hurt(page, 100);
      await wait(gauge).toBeVisible();
      await wait(gauge).toHaveAttribute('data-tone', 'sound');
      await wait(page.locator('.ph-core-value')).toHaveText('900');
      expect((await clock(page)).coreHealth).toBe(900);
    });

    await test.step('it turns amber below half and red below a quarter', async () => {
      await hurt(page, 420);
      await wait(gauge).toHaveAttribute('data-tone', 'worn');
      await wait(page.locator('.ph-core-value')).toHaveText('480');
      await hurt(page, 300);
      await wait(gauge).toHaveAttribute('data-tone', 'critical');
      await wait(page.locator('.ph-core-value')).toHaveText('180');
    });

    await test.step('a day of mending makes it whole, and by night the gauge is up even then', async () => {
      await page.evaluate((to) => {
        const mp = window.__ashbound?.mp;
        if (mp) mp.warp(to - mp.clock().elapsed);
      }, DAY_SECONDS + 5);
      await wait(page.locator('.ph-clock')).toContainText('Night 1');
      expect((await clock(page)).coreHealth).toBe(1000);
      await wait(gauge).toBeVisible();
      await wait(gauge).toHaveAttribute('data-tone', 'sound');
      await wait(page.locator('.ph-core-value')).toHaveText('1000');
    });

    await test.step('at nothing it falls: the run is over and the clock waits for nobody', async () => {
      await page.getByRole('button', { name: 'Play' }).click();
      await wait(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
      await expect
        .poll(async () => (await clock(page)).running, { timeout: STATE_TIMEOUT })
        .toBe(true);
      await hurt(page, 5000);
      await wait(gauge).toHaveAttribute('data-tone', 'fallen');
      await wait(page.locator('.ph-core-value')).toHaveText('0');
      await wait(page.locator('.toast')).toContainText('The Outpost Core has fallen');
      await wait(page.locator('.ph-banner-title')).toHaveText('The Outpost Core has fallen');
      const after = await clock(page);
      expect(after).toMatchObject({ coreHealth: 0, over: true, running: false });
      // Playing on does not move the clock: the run has ended.
      await page.waitForTimeout(1500);
      expect((await clock(page)).elapsed).toBe(after.elapsed);
      // And nothing can bring it back by day: no mending after a fall.
      await page.evaluate(() => window.__ashbound?.mp?.warp(720));
      expect(await clock(page)).toMatchObject({ coreHealth: 0, over: true });
    });

    await test.step('the mouse is freed on its own, and the results card says how it ended', async () => {
      await wait(page.locator('#hud')).toHaveAttribute('data-pointer', 'free');
      await wait(page.locator('.run-results')).toBeVisible();
      await expect(page.locator('.pause')).toBeHidden();
      await expect(page.locator('.run-results .lede')).toHaveText(
        'The Outpost Core fell on Night 1.',
      );
      await expect(page.locator('.run-results .stat.hero strong')).toHaveText('0');
    });

    expect(problems).toEqual([]);
  });
});
