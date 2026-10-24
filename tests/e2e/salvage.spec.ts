import { expect, test, type Page } from '@playwright/test';
import { MATERIAL } from '../../src/shared/blocks';
import { poolSlot } from '../../src/shared/economy';
import { DEBRIS, POOL } from '../../src/systems/economy/balance';
import { recordToasts, toasts } from './support/toasts';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

const STATE_TIMEOUT = 60_000;
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the patience of `wait`: the HUD and the picture only change when a frame is drawn. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** The first morning with no waves: the heaps are what is being looked at. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&waves=0';

const SCRAP = poolSlot(MATERIAL.scrap);
/** The length of the day and of the whole cycle, in seconds (src/shared/daycycle.ts). */
const CYCLE_SECONDS = 720;

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
  // The run's heaps arrive with the run.
  await page.waitForFunction(() => (window.__ashbound?.mp?.heaps().length ?? 0) > 0, null, {
    timeout: STATE_TIMEOUT,
  });
  return problems;
}

/** Reads a value off the running game, e.g. `read<number>(page, 'mp.pool().cap')`. Needs `?debug`. */
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

/**
 * The interact key going down and up, the way the browser reports it, and a reading taken in the
 * same task. (A reading that waits for a round trip of its own can come after the frames that
 * age a strip's sparks: they live well under a second.)
 */
const interactAndRead = <T>(page: Page, expression: string): Promise<T> =>
  page.evaluate<T>(`(() => {
    const init = { code: 'KeyE', key: 'e', bubbles: true };
    window.dispatchEvent(new KeyboardEvent('keydown', init));
    window.dispatchEvent(new KeyboardEvent('keyup', init));
    const { mp, build } = window.__ashbound;
    return ${expression};
  })()`);

interface Heap {
  index: number;
  x: number;
  y: number;
  z: number;
  harvests: number;
  left: number;
  from: number;
}

interface Shown {
  index: number;
  left: number;
  share: number;
  presence: number;
  flash: number;
  aimed: number;
}

interface Pool {
  stock: number[];
  cap: number;
}

const heaps = (page: Page): Promise<Heap[]> => read<Heap[]>(page, 'mp.heaps()');
const shown = (page: Page): Promise<Shown[]> => read<Shown[]>(page, 'mp.heapsShown()');
const pool = (page: Page): Promise<Pool> => read<Pool>(page, 'mp.pool()');
const scrap = async (page: Page): Promise<number> => (await pool(page)).stock[SCRAP] ?? -1;
const rejections = (page: Page): Promise<{ reason: string }[]> =>
  read<{ reason: string }[]>(page, 'mp.rejections()');
const gathered = (page: Page): Promise<number> => read<number>(page, 'mp.clock().gathered');

/** Puts the player `distance` blocks from a heap, on the side toward the middle of the valley. */
async function standBeside(page: Page, heap: Heap, distance = 2.6): Promise<void> {
  await page.evaluate(
    ({ heap, distance }) => {
      const game = window.__ashbound!.game;
      const toward = Math.atan2(-heap.z, -heap.x);
      const x = heap.x + Math.cos(toward) * distance;
      const z = heap.z + Math.sin(toward) * distance;
      game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
    },
    { heap, distance },
  );
}

/** Looks at the middle of a heap and says what the cursor is on once the frame has been drawn. */
async function aimAt(
  page: Page,
  heap: Heap,
): Promise<{ index: number; left: number; distance: number }> {
  await page.evaluate(
    ({ heap, lift }) => {
      const game = window.__ashbound!.game;
      const eye = game.player.y + 1.62;
      const dx = heap.x - game.player.x;
      const dz = heap.z - game.player.z;
      game.look.yaw = Math.atan2(-dx, -dz);
      game.look.pitch = Math.atan2(heap.y + lift - eye, Math.hypot(dx, dz));
    },
    { heap, lift: DEBRIS.lift },
  );
  await frames(page);
  return read<{ index: number; left: number; distance: number }>(page, 'build.salvage()');
}

const distanceBetween = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

test.describe('salvage', () => {
  test('E strips the heap the cursor is on: the pool and the count rise, a layer goes, and the last strip takes the heap', async ({
    page,
  }, testInfo) => {
    const problems = await open(page);
    await recordToasts(page);

    // The run begins with its first heaps lying out and the rest not uncovered yet.
    const all = await heaps(page);
    expect(all.filter((h) => h.from === 0 && h.left > 0)).toHaveLength(DEBRIS.initial);
    expect(all.filter((h) => h.from > 0).every((h) => h.left === 0)).toBe(true);
    for (const heap of all) {
      expect(heap.harvests).toBeGreaterThanOrEqual(DEBRIS.harvests.min);
      expect(heap.harvests).toBeLessThanOrEqual(DEBRIS.harvests.max);
    }
    expect((await pool(page)).stock[SCRAP]).toBe(POOL.start[MATERIAL.scrap]);
    expect((await pool(page)).cap).toBe(POOL.cap);

    // Only the heaps that are out are drawn.
    await poll(async () => (await shown(page)).length).toBe(DEBRIS.initial);

    const start = await read<{ x: number; z: number }>(page, 'mp.position()');
    const lying = all.filter((h) => h.from === 0);
    // The nearest heap with three strips or more (so that two can be taken and one is left), and the farthest of all.
    const nearest = (list: Heap[]): Heap =>
      list.reduce((a, b) => (distanceBetween(a, start) < distanceBetween(b, start) ? a : b));
    const heap = nearest(lying.filter((h) => h.harvests >= 3));
    const far = lying.reduce((a, b) =>
      distanceBetween(a, start) > distanceBetween(b, start) ? a : b,
    );

    await standBeside(page, heap);
    await takeThePointer(page);
    await page.waitForFunction(() => window.__ashbound?.game.player.onGround === true, null, {
      timeout: STATE_TIMEOUT,
    });

    await test.step('with the cursor on a heap in reach, the prompt says what E does and how much is left', async () => {
      await poll(() => aimAt(page, heap)).toMatchObject({ index: heap.index, left: heap.harvests });
      await wait(page.locator('.ph-interact')).toBeVisible();
      await wait(page.locator('.ph-interact .ph-key')).toHaveText('E');
      await wait(page.locator('.ph-interact-label')).toHaveText('Strip debris');
      await wait(page.locator('.ph-interact-detail')).toHaveText(`${heap.harvests} strips left`);
      // The heap glows under the cursor, and the hotbar tells the pool's Scrap.
      await poll(async () => (await shown(page)).find((s) => s.index === heap.index)?.aimed).toBe(
        1,
      );
      await wait(page.locator('.ph-slot').nth(0).locator('.ph-count')).toHaveText(
        String(POOL.start[MATERIAL.scrap]),
      );
      await page.screenshot({ path: testInfo.outputPath('salvage-aimed.png') });
    });

    await test.step('looking away takes the prompt away', async () => {
      await page.evaluate(() => {
        window.__ashbound!.game.look.yaw += Math.PI;
      });
      await frames(page);
      expect((await read<{ index: number }>(page, 'build.salvage()')).index).toBe(-1);
      await wait(page.locator('.ph-interact')).toBeHidden();
      await poll(() => aimAt(page, heap)).toMatchObject({ index: heap.index });
    });

    let taken = 0;
    const strip = async (): Promise<number> => {
      const before = await scrap(page);
      const was = (await heaps(page))[heap.index]?.left ?? -1;
      // A strip waits for the hands' pace, so press again until the heap has lost one.
      await poll(async () => {
        await interactAndRead(page, 'true');
        return (await heaps(page))[heap.index]?.left;
      }).toBe(was - 1);
      const gained = (await scrap(page)) - before;
      taken += gained;
      return gained;
    };

    await test.step('the first strip gives Scrap to the pool, throws sparks and shows in the count and the toast', async () => {
      const before = await scrap(page);
      const live = await interactAndRead<{ sparks: number }>(page, 'mp.shots().live');
      // The host (this very page, playing alone) answered before the key press returned.
      expect(live.sparks).toBeGreaterThan(0);
      expect((await heaps(page))[heap.index]?.left).toBe(heap.harvests - 1);
      const gained = (await scrap(page)) - before;
      taken += gained;
      expect(gained).toBeGreaterThanOrEqual(DEBRIS.yield.min);
      expect(gained).toBeLessThanOrEqual(DEBRIS.yield.max);
      await wait(page.locator('.ph-slot').nth(0).locator('.ph-count')).toHaveText(
        String(before + gained),
      );
      await poll(async () => (await toasts(page)).at(-1)).toBe(`+${gained} Scrap`);
      // The picture follows: the share it shows moves to what is left, and the heap flashed.
      await poll(async () => (await shown(page)).find((s) => s.index === heap.index)?.share).toBe(
        (heap.harvests - 1) / heap.harvests,
      );
      expect(await gathered(page)).toBe(taken);
      await wait(page.locator('.ph-interact-detail')).toHaveText(
        heap.harvests - 1 === 1 ? 'last strip' : `${heap.harvests - 1} strips left`,
      );
    });

    await test.step('a pool nearly full takes what fits, and a full one refuses the strip', async () => {
      const room = 3;
      await page.evaluate(
        ([material, amount]) => window.__ashbound!.mp!.setPool(material!, amount!),
        [MATERIAL.scrap, POOL.cap - room] as const,
      );
      await poll(() => scrap(page)).toBe(POOL.cap - room);
      const gained = await strip();
      expect(gained).toBe(room);
      await poll(async () => (await toasts(page)).at(-1)).toBe(`+${room} Scrap · the pool is full`);
      expect(await scrap(page)).toBe(POOL.cap);
      // Nothing is taken from a heap for a pool with no room, and the player is told why.
      const left = (await heaps(page))[heap.index]?.left;
      await poll(async () => {
        await interactAndRead(page, 'true');
        return (await rejections(page)).map((r) => r.reason);
      }).toContain('the pool is full');
      expect((await heaps(page))[heap.index]?.left).toBe(left);
      await wait(page.locator('.ph-prompt-detail')).toHaveText('The pool is full');
      // The pool is spent again and the strips go on.
      await page.evaluate(
        ([material, amount]) => window.__ashbound!.mp!.setPool(material!, amount!),
        [MATERIAL.scrap, POOL.start[MATERIAL.scrap] ?? 0] as const,
      );
      await poll(() => scrap(page)).toBe(POOL.start[MATERIAL.scrap]);
    });

    await test.step('stripped to the last strip, the heap sinks out of the picture and the toast says so', async () => {
      while (((await heaps(page))[heap.index]?.left ?? 0) > 0) await strip();
      await poll(async () => (await toasts(page)).at(-1)).toMatch(
        /^\+\d+ Scrap · that heap is stripped bare$/,
      );
      expect((await heaps(page))[heap.index]?.left).toBe(0);
      // It sinks into the ground for a moment and is gone from the picture.
      await poll(async () => (await shown(page)).some((s) => s.index === heap.index)).toBe(false);
      expect((await shown(page)).length).toBe(DEBRIS.initial - 1);
      // The cursor has nothing to strip there now.
      await poll(() => aimAt(page, heap)).toMatchObject({ index: -1, left: 0 });
      await wait(page.locator('.ph-interact')).toBeHidden();
      await page.screenshot({ path: testInfo.outputPath('salvage-bare.png') });
    });

    await test.step('the host refuses a strip of a heap that is bare or out of reach', async () => {
      const before = (await rejections(page)).length;
      expect(await page.evaluate((i) => window.__ashbound!.mp!.harvest(i), heap.index)).toBe(true);
      await poll(async () => (await rejections(page)).slice(before).map((r) => r.reason)).toEqual([
        'nothing left there',
      ]);
      expect(
        distanceBetween(far, await read<{ x: number; z: number }>(page, 'mp.position()')),
      ).toBeGreaterThan(DEBRIS.reach);
      expect(await page.evaluate((i) => window.__ashbound!.mp!.harvest(i), far.index)).toBe(true);
      await poll(async () =>
        (await rejections(page)).slice(before + 1).map((r) => r.reason),
      ).toEqual(['out of reach']);
      // A place with no heap asks nothing.
      expect(await page.evaluate(() => window.__ashbound!.mp!.harvest(9999))).toBe(false);
      // Neither took anything.
      expect(await gathered(page)).toBe(taken);
    });
    expect(problems).toEqual([]);
  });

  test('the dawn uncovers the next heaps, which rise out of the ground', async ({ page }) => {
    const problems = await open(page);
    const all = await heaps(page);
    const coming = all.filter((h) => h.from === 1);
    expect(coming).toHaveLength(DEBRIS.perDawn);
    expect(coming.every((h) => h.left === 0)).toBe(true);
    const names = new Set(coming.map((h) => h.index));
    expect((await shown(page)).filter((s) => names.has(s.index))).toEqual([]);

    // The clock waits while the mouse is free, so the night is played in one jump: past dusk, the
    // dark and the dawn after it.
    await page.evaluate((to) => {
      const mp = window.__ashbound!.mp!;
      mp.warp(to - mp.clock().elapsed);
    }, CYCLE_SECONDS + 30);
    await wait(page.locator('.ph-clock')).toContainText('Day 2');

    // Each uncovered heap has its strips, and the first ones are untouched.
    await poll(async () =>
      (await heaps(page)).filter((h) => h.from === 1).map((h) => h.left === h.harvests),
    ).toEqual(coming.map(() => true));
    // They come up out of the ground: drawn from the first frame after the dawn, still on their
    // way up for a few frames, and standing in the end.
    await poll(async () =>
      (await shown(page)).filter((s) => names.has(s.index)).map((s) => s.presence > 0),
    ).toEqual(coming.map(() => true));
    await poll(async () =>
      (await shown(page)).filter((s) => names.has(s.index)).map((s) => s.presence),
    ).toEqual(coming.map(() => 1));
    expect((await shown(page)).length).toBe(DEBRIS.initial + DEBRIS.perDawn);
    // The heaps further out wait for later dawns.
    expect((await heaps(page)).filter((h) => h.from > 1).every((h) => h.left === 0)).toBe(true);
    expect(problems).toEqual([]);
  });
});
