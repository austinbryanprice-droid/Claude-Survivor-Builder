import { expect, test, type Page } from '@playwright/test';
import { MATERIAL, SHAPE, packState, slabShape, wedgeShape } from '../../src/shared/blocks';
import { poolSlot } from '../../src/shared/economy';
import { DEBRIS, POOL } from '../../src/systems/economy/balance';
import { DEBRIS_IN_THE_WAY, notEnough } from '../../src/systems/economy/build-rules';
import { CYCLE_SECONDS } from '../../src/shared/daycycle';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

const STATE_TIMEOUT = 60_000;
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the patience of `wait`: the HUD and the aim only change when a frame is drawn. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** The first morning with no waves: the pool and the heaps are what is being looked at. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&waves=0';

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const ALLOY = packState(SHAPE.cube, MATERIAL.alloy);
const SCRAP_SLOT = poolSlot(MATERIAL.scrap);
/** A spot in the crash clearing, where the ground is open and gentle. */
const SPOT = { x: 8.5, z: -4.5 };

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
  await page.waitForFunction(() => window.__ashbound?.game.player.onGround === true, null, {
    timeout: STATE_TIMEOUT,
  });
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

/** A mouse button going down and up, the way the browser reports it (see building.spec.ts). */
const click = (page: Page, button: 'left' | 'right'): Promise<void> =>
  page.evaluate((which) => {
    const init = { button: which === 'left' ? 0 : 2, bubbles: true };
    window.dispatchEvent(new MouseEvent('mousedown', init));
    window.dispatchEvent(new MouseEvent('mouseup', init));
  }, button);

interface Cell {
  x: number;
  y: number;
  z: number;
}

interface Aim {
  on: 'nothing' | 'block' | 'terrain';
  hasPlace: boolean;
  place: Cell;
  placeRefusal: string | null;
}

interface Heap {
  index: number;
  x: number;
  y: number;
  z: number;
  harvests: number;
  left: number;
  from: number;
}

interface Pool {
  stock: number[];
  cap: number;
}

const pool = (page: Page): Promise<Pool> => read<Pool>(page, 'mp.pool()');
const scrap = async (page: Page): Promise<number> => (await pool(page)).stock[SCRAP_SLOT] ?? -1;
const heaps = (page: Page): Promise<Heap[]> => read<Heap[]>(page, 'mp.heaps()');
const blocks = (page: Page): Promise<number> => read<number>(page, 'mp.blocks().count');
const eventCount = (page: Page): Promise<number> => read<number>(page, 'mp.eventCount()');
const rejections = async (page: Page): Promise<string[]> =>
  (await read<{ reason: string }[]>(page, 'mp.rejections()')).map((r) => r.reason);
const setPool = (page: Page, material: number, amount: number): Promise<void> =>
  page.evaluate(([m, a]) => window.__ashbound!.mp!.setPool(m!, a!), [material, amount] as const);
/** What the hotbar slot (counting from 0) says the pool holds of its material. */
const countOf = (page: Page, slot: number) =>
  page.locator('.ph-slot').nth(slot).locator('.ph-count');

/** Looks along the given pitch (radians, negative is down) and returns what the cursor is on a frame later. */
async function aimAt(page: Page, pitch: number): Promise<Aim> {
  await page.evaluate((nextPitch) => {
    const game = window.__ashbound?.game;
    if (!game) return;
    game.look.yaw = 0;
    game.look.pitch = nextPitch;
  }, pitch);
  await frames(page);
  return read<Aim>(page, 'build.aim()');
}

/** Puts the player `distance` blocks from a heap, on the side toward the middle of the valley, and lets the host see them there. */
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
  await frames(page, 3);
}

/** Looks at the ground the heap stands on, which is the spot a block would go if the cursor were there. */
async function aimAtGroundOf(page: Page, heap: Heap): Promise<Aim> {
  await page.evaluate((heap) => {
    const game = window.__ashbound!.game;
    const eye = game.player.y + 1.62;
    const dx = heap.x - game.player.x;
    const dz = heap.z - game.player.z;
    game.look.yaw = Math.atan2(-dx, -dz);
    game.look.pitch = Math.atan2(heap.y - eye, Math.hypot(dx, dz));
  }, heap);
  await frames(page);
  return read<Aim>(page, 'build.aim()');
}

/** Goes into Build Mode and waits for the first block's tiles and shader, which the first look at a ghost costs seconds of. */
async function enterBuildMode(page: Page): Promise<void> {
  await page.keyboard.press('KeyB');
  await wait(page.locator('.status-mode')).toBeVisible();
  await read<void>(
    page,
    'Promise.all([game.world.view.structures.warmUp(), game.world.view.ghost.precompile()])',
  );
}

test.describe('what building costs', () => {
  test('a block takes its price from the pool and breaking it gives the price back, whatever its shape, and the hotbar counts along', async ({
    page,
  }) => {
    const problems = await open(page);
    const start = POOL.start[MATERIAL.scrap] ?? 0;

    await test.step('a run opens with some Scrap and none of the dearer materials, and the hotbar says so', async () => {
      expect((await pool(page)).stock).toEqual([start, 0, 0, 0]);
      await wait(countOf(page, 0)).toHaveText(String(start));
      for (const slot of [1, 2, 3]) {
        await wait(countOf(page, slot)).toHaveText('0');
        await expect(countOf(page, slot)).toHaveAttribute('data-none', '');
      }
      await expect(countOf(page, 0)).not.toHaveAttribute('data-none', '');
    });

    const cells: Cell[] = [];
    await test.step('every piece placed takes one Scrap, a block, a slab or a wedge alike', async () => {
      const pieces = [
        SCRAP,
        packState(slabShape(false), MATERIAL.scrap),
        packState(wedgeShape(0), MATERIAL.scrap),
      ];
      for (const [i, piece] of pieces.entries()) {
        cells.push(
          await page.evaluate(([dx, state]) => window.__ashbound!.mp!.placeNear(dx!, 0, state!), [
            3 + i,
            piece,
          ] as const),
        );
        await poll(() => blocks(page)).toBe(i + 1);
        await poll(() => scrap(page)).toBe(start - (i + 1));
      }
      await wait(countOf(page, 0)).toHaveText(String(start - 3));
      expect(await rejections(page)).toEqual([]);
    });

    await test.step('breaking them gives every one back to the pool', async () => {
      for (const [i, cell] of cells.entries()) {
        await page.evaluate(([x, y, z]) => window.__ashbound!.mp!.breakBlock(x!, y!, z!), [
          cell.x,
          cell.y,
          cell.z,
        ] as const);
        await poll(() => scrap(page)).toBe(start - 3 + (i + 1));
      }
      await poll(() => blocks(page)).toBe(0);
      await wait(countOf(page, 0)).toHaveText(String(start));
      expect(await rejections(page)).toEqual([]);
    });
    expect(problems).toEqual([]);
  });

  test('a pool too short for the block shows on the ghost and sends nothing, the host says the same if asked anyway, and a filled pool lets the block through', async ({
    page,
  }, testInfo) => {
    // The first look at a ghost bakes the block tiles and compiles the shader, then each step waits for frames.
    test.setTimeout(300_000);
    const problems = await open(page);
    await page.evaluate(({ x, z }) => {
      const game = window.__ashbound?.game;
      if (game) game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
    }, SPOT);
    await takeThePointer(page);
    await setPool(page, MATERIAL.scrap, 0);
    await poll(() => scrap(page)).toBe(0);
    await enterBuildMode(page);

    await test.step('with no Scrap the ghost is red and the caption names what is short', async () => {
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBe(notEnough('Scrap'));
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'blocked');
      await wait(page.locator('.ph-prompt')).toContainText('Not enough Scrap');
      await wait(countOf(page, 0)).toHaveText('0');
      await page.screenshot({ path: testInfo.outputPath('costs-short.png') });
    });

    await test.step('a click sends nothing', async () => {
      const events = await eventCount(page);
      await click(page, 'right');
      await frames(page, 2);
      expect(await eventCount(page)).toBe(events);
      expect(await blocks(page)).toBe(0);
      // Nothing went to the host, so the host refused nothing.
      expect(await rejections(page)).toEqual([]);
    });

    await test.step('a command sent past the screen is refused by the host in the same words', async () => {
      await page.evaluate(([state]) => window.__ashbound!.mp!.placeNear(0, -3, state!), [
        SCRAP,
      ] as const);
      await poll(() => rejections(page)).toEqual([notEnough('Scrap')]);
      expect(await blocks(page)).toBe(0);
      expect(await scrap(page)).toBe(0);
    });

    await test.step('one Scrap in the pool clears the ghost, and a click places the block and spends it', async () => {
      await setPool(page, MATERIAL.scrap, 1);
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBeNull();
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'place');
      await wait(page.locator('.ph-prompt')).toContainText('Cost 1 Scrap');
      const aim = await aimAt(page, -0.5);
      await click(page, 'right');
      await poll(() =>
        read<number>(page, `mp.block(${aim.place.x}, ${aim.place.y}, ${aim.place.z})`),
      ).toBe(SCRAP);
      await poll(() => scrap(page)).toBe(0);
      await wait(countOf(page, 0)).toHaveText('0');
      // The pool is empty again, so the next block is refused on the screen.
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBe(notEnough('Scrap'));
    });

    await test.step('each material is asked about on its own: Scrap in the pool does not pay for Alloy', async () => {
      await setPool(page, MATERIAL.scrap, 20);
      await page.keyboard.press('Digit3');
      await wait(page.locator('.ph-slot').nth(2)).toHaveAttribute('data-selected', '');
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBe(
        notEnough('Advanced Alloy'),
      );
      await wait(page.locator('.ph-prompt')).toContainText('Not enough Advanced Alloy');
      await setPool(page, MATERIAL.alloy, 1);
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBeNull();
      const aim = await aimAt(page, -0.5);
      await click(page, 'right');
      await poll(() =>
        read<number>(page, `mp.block(${aim.place.x}, ${aim.place.y}, ${aim.place.z})`),
      ).toBe(ALLOY);
      expect((await pool(page)).stock).toEqual([20, 0, 0, 0]);
    });
    expect(problems).toEqual([]);
  });

  test('a heap keeps the ground it lies on clear of blocks until it is stripped bare', async ({
    page,
  }, testInfo) => {
    // As above, and a heap is stripped bare a strip at a time.
    test.setTimeout(300_000);
    const problems = await open(page);
    const lying = (await heaps(page)).filter((h) => h.from === 0);
    const start = await read<{ x: number; z: number }>(page, 'mp.position()');
    const heap = lying.reduce((a, b) =>
      Math.hypot(a.x - start.x, a.z - start.z) < Math.hypot(b.x - start.x, b.z - start.z) ? a : b,
    );
    const cell: Cell = { x: Math.floor(heap.x), y: Math.floor(heap.y), z: Math.floor(heap.z) };

    await standBeside(page, heap);
    await takeThePointer(page);
    await enterBuildMode(page);
    // The pool is no hindrance here: only the heap is.
    await setPool(page, MATERIAL.scrap, 100);

    await test.step('the cursor on the heap’s ground shows a refused ghost with its own words', async () => {
      await poll(async () => (await aimAtGroundOf(page, heap)).placeRefusal).toBe(
        DEBRIS_IN_THE_WAY,
      );
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'blocked');
      await wait(page.locator('.ph-prompt')).toContainText('Debris is in the way');
      await page.screenshot({ path: testInfo.outputPath('costs-heap.png') });
    });

    await test.step('a click sends nothing, and the host refuses the cell the same if asked', async () => {
      const events = await eventCount(page);
      await click(page, 'right');
      await frames(page, 2);
      expect(await eventCount(page)).toBe(events);
      expect(await rejections(page)).toEqual([]);
      await page.evaluate(([x, y, z, state]) => window.__ashbound!.mp!.place(x!, y!, z!, state!), [
        cell.x,
        cell.y,
        cell.z,
        SCRAP,
      ] as const);
      await poll(() => rejections(page)).toEqual([DEBRIS_IN_THE_WAY]);
      expect(await blocks(page)).toBe(0);
      expect(await scrap(page)).toBe(100);
    });

    await test.step('stripped bare, the heap is gone and the ground is free', async () => {
      // A strip waits for the host's pace, so ask again until the heap has lost one.
      while (((await heaps(page))[heap.index]?.left ?? 0) > 0) {
        const was = (await heaps(page))[heap.index]?.left ?? 0;
        await poll(async () => {
          await page.evaluate((i) => window.__ashbound!.mp!.harvest(i), heap.index);
          return (await heaps(page))[heap.index]?.left;
        }).toBe(was - 1);
      }
      await poll(async () => (await aimAtGroundOf(page, heap)).placeRefusal).toBeNull();
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'place');
      const before = await scrap(page);
      const aim = await aimAtGroundOf(page, heap);
      await click(page, 'right');
      await poll(() =>
        read<number>(page, `mp.block(${aim.place.x}, ${aim.place.y}, ${aim.place.z})`),
      ).toBe(SCRAP);
      await poll(() => scrap(page)).toBe(before - 1);
    });
    expect(problems).toEqual([]);
  });

  test('a heap that is due at the dawn waits while a block stands on its ground, and comes up once the block is gone', async ({
    page,
  }) => {
    const problems = await open(page);
    const coming = (await heaps(page)).filter((h) => h.from === 1);
    expect(coming).toHaveLength(DEBRIS.perDawn);
    const heap = coming[0]!;
    const cell: Cell = { x: Math.floor(heap.x), y: Math.floor(heap.y), z: Math.floor(heap.z) };

    // A heap that has not come up yet keeps nothing clear, so the crew can build on its ground.
    await standBeside(page, heap);
    await page.evaluate(([x, y, z, state]) => window.__ashbound!.mp!.place(x!, y!, z!, state!), [
      cell.x,
      cell.y,
      cell.z,
      SCRAP,
    ] as const);
    await poll(() => blocks(page)).toBe(1);
    expect(await rejections(page)).toEqual([]);

    const toDay = (day: number) =>
      page.evaluate(
        (to) => {
          const mp = window.__ashbound!.mp!;
          mp.warp(to - mp.clock().elapsed);
        },
        CYCLE_SECONDS * (day - 1) + 30,
      );

    await test.step('at the first dawn the other heaps come up and this one stays down', async () => {
      await toDay(2);
      await wait(page.locator('.ph-clock')).toContainText('Day 2');
      await poll(async () =>
        (await heaps(page)).filter((h) => h.from === 1).map((h) => h.left === h.harvests),
      ).toEqual(coming.map((c) => c.index !== heap.index));
      expect((await heaps(page))[heap.index]?.left).toBe(0);
    });

    await test.step('with the block taken away it comes up at the next dawn', async () => {
      await page.evaluate(([x, y, z]) => window.__ashbound!.mp!.breakBlock(x!, y!, z!), [
        cell.x,
        cell.y,
        cell.z,
      ] as const);
      await poll(() => blocks(page)).toBe(0);
      await toDay(3);
      await wait(page.locator('.ph-clock')).toContainText('Day 3');
      await poll(async () => (await heaps(page))[heap.index]?.left).toBe(heap.harvests);
    });
    expect(problems).toEqual([]);
  });
});
