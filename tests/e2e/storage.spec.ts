import { expect, test, type Page } from '@playwright/test';
import {
  MATERIAL,
  MODULE,
  MODULES,
  moduleFacing,
  moduleShape,
  packState,
  stateShape,
} from '../../src/shared/blocks';
import { poolSlot } from '../../src/shared/economy';
import { PLAYER } from '../../src/shared/movement';
import { POOL, RESEARCH } from '../../src/systems/economy/balance';
import { needsResearch, notEnough } from '../../src/systems/economy/build-rules';
import { recordToasts, toasts } from './support/toasts';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

const STATE_TIMEOUT = 60_000;
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the patience of `wait`: the HUD and the aim only change when a frame is drawn. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** The first morning with no waves: the pool, the points and the Storages are what is being looked at. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&waves=0';

/** A spot in the crash clearing, where the ground is open and gentle. */
const SPOT = { x: 8.5, z: -4.5 };
const SCRAP_SLOT = poolSlot(MATERIAL.scrap);
/** The module slot of the hotbar, counting from 0 (the key is the next number up). */
const MODULE_SLOT = 5;
const STORAGE_DEF = MODULES.find((module) => module.id === MODULE.storage)!;
const PRICE = STORAGE_DEF.cost.amount;
/** The points that open the Camp row of the ladder, which opens the Storage. */
const CAMP_AT = RESEARCH.groups.find((group) => group.id === 'camp')!.points;
/** A Storage at its first level, facing +x. */
const STORAGE = packState(moduleShape(MODULE.storage, 0), 1);
/** The most the pool holds of any one material with this many Storages standing. */
const ceilingWith = (storages: number): number => POOL.cap + storages * POOL.perStorage;
const built = (storages: number): string =>
  `Storage built · the pool holds ${ceilingWith(storages)} of each`;
const gone = (storages: number): string =>
  `A Storage is gone · the pool holds ${ceilingWith(storages)} of each`;

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
  target: Cell;
  hasPlace: boolean;
  place: Cell;
  state: number;
  placeRefusal: string | null;
}

const pool = (page: Page) => read<{ stock: number[]; cap: number }>(page, 'mp.pool()');
const scrap = async (page: Page): Promise<number> => (await pool(page)).stock[SCRAP_SLOT] ?? -1;
const ceiling = async (page: Page): Promise<number> => (await pool(page)).cap;
const drawn = (page: Page): Promise<number> => read<number>(page, 'game.world.view.modules.count');
const rejections = async (page: Page): Promise<string[]> =>
  (await read<{ reason: string }[]>(page, 'mp.rejections()')).map((r) => r.reason);
const setScrap = (page: Page, amount: number): Promise<void> =>
  page.evaluate(([material, count]) => window.__ashbound!.mp!.setPool(material!, count!), [
    MATERIAL.scrap,
    amount,
  ] as const);
const setResearch = (page: Page, points: number): Promise<void> =>
  page.evaluate((n) => window.__ashbound!.mp!.setResearch(n, true), points);
const blockAt = (page: Page, cell: Cell): Promise<number> =>
  read<number>(page, `mp.block(${cell.x}, ${cell.y}, ${cell.z})`);
const ringOf = (page: Page): Promise<unknown> => read<unknown>(page, 'build.reach()');
/** What the screen works out a module in a cell has of power: 'none' for one that takes no part, as a Storage does not. */
const powerOf = (page: Page, cell: Cell): Promise<string> =>
  read<string>(page, `game.world.power.stateAt(${cell.x}, ${cell.y}, ${cell.z})`);
/** Whether the lights of the module drawn in a cell are up, or null where none is drawn. */
const lit = (page: Page, cell: Cell): Promise<boolean | null> =>
  read<boolean | null>(page, `game.world.view.modules.isPowered(${cell.x}, ${cell.y}, ${cell.z})`);
const breakAt = (page: Page, cell: Cell): Promise<void> =>
  page.evaluate(({ x, y, z }) => window.__ashbound!.mp!.breakBlock(x, y, z), cell);
const placeNear = (page: Page, dx: number, dz: number, state: number): Promise<Cell> =>
  page.evaluate(([a, b, s]) => window.__ashbound!.mp!.placeNear(a!, b!, s!), [
    dx,
    dz,
    state,
  ] as const);
/** The Storage messages the HUD has shown, in order. */
const storageToasts = async (page: Page): Promise<string[]> =>
  (await toasts(page)).filter((text) => /^Storage built|^A Storage is gone/.test(text));

/** The count on the Scrap slot of the hotbar: amber (`data-full`) where the pool holds all it can. */
const scrapCount = (page: Page) => page.locator('.ph-slot').nth(SCRAP_SLOT).locator('.ph-count');

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

/** Looks at the middle of a cell's body, a little above the floor, and returns what the cursor is on a frame later. */
async function aimAtCell(page: Page, cell: Cell): Promise<Aim> {
  await page.evaluate(
    ({ cell, eyeHeight }) => {
      const game = window.__ashbound!.game;
      const dx = cell.x + 0.5 - game.player.x;
      const dz = cell.z + 0.5 - game.player.z;
      game.look.yaw = Math.atan2(-dx, -dz);
      game.look.pitch = Math.atan2(cell.y + 0.45 - (game.player.y + eyeHeight), Math.hypot(dx, dz));
    },
    { cell, eyeHeight: PLAYER.eyeHeight },
  );
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

test.describe('the Storage', () => {
  test('is built from the module slot once the Camp points are in, and every Storage that stands lets the pool hold more of each material', async ({
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
    await recordToasts(page);
    await setScrap(page, 100);
    await poll(() => scrap(page)).toBe(100);
    // A run opens with the table's ceiling and no Storage standing.
    expect(await ceiling(page)).toBe(POOL.cap);
    await enterBuildMode(page);

    await test.step('four presses of Q reach the Storage from the Terminal, and until the Camp points are in the slot is behind a padlock, with words for it', async () => {
      await page.keyboard.press(`Digit${MODULE_SLOT + 1}`);
      await wait(page.locator('.ph-slot').nth(MODULE_SLOT)).toHaveAttribute('data-selected', '');
      await wait(page.locator('.ph-prompt')).toContainText('Research Terminal');
      for (const name of ['Basic Turret', 'Generator', 'Power Node']) {
        await page.keyboard.press('KeyQ');
        await wait(page.locator('.ph-prompt')).toContainText(name);
      }
      await page.keyboard.press('KeyQ');
      await wait(
        page.locator('.ph-slot').nth(MODULE_SLOT).locator('.ph-slot-icon use'),
      ).toHaveAttribute('href', '#ph-i-storage');
      await wait(page.locator('.ph-prompt')).toContainText(STORAGE_DEF.name);
      await wait(page.locator('.ph-slot').nth(MODULE_SLOT)).toHaveAttribute('data-locked', '');
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBe(
        needsResearch(STORAGE_DEF.name),
      );
      await wait(page.locator('.ph-prompt')).toContainText(`Needs research · 0 of ${CAMP_AT}`);
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'blocked');
    });

    await test.step('one point short of the row the padlock stays, and the words count the points', async () => {
      await setResearch(page, CAMP_AT - 1);
      await wait(page.locator('.ph-prompt')).toContainText(
        `Needs research · ${CAMP_AT - 1} of ${CAMP_AT}`,
      );
      await wait(page.locator('.ph-slot').nth(MODULE_SLOT)).toHaveAttribute('data-locked', '');
      expect(await storageToasts(page)).toEqual([]);
    });

    await test.step('with the points in the padlock opens and the HUD names the row, and a pool one short of the price turns the ghost red', async () => {
      await setResearch(page, CAMP_AT);
      await setScrap(page, PRICE - 1);
      await wait(page.locator('.ph-slot').nth(MODULE_SLOT)).not.toHaveAttribute('data-locked', '');
      await poll(async () =>
        (await toasts(page)).filter((text) => text === 'Camp unlocked'),
      ).toEqual(['Camp unlocked']);
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBe(notEnough('Scrap'));
      await wait(page.locator('.ph-prompt')).toContainText('Not enough Scrap');
    });

    const first =
      await test.step('with the price in the pool the caption gives it, and no ring is drawn: a Storage reaches nowhere', async () => {
        await setScrap(page, 100);
        await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBeNull();
        await wait(page.locator('.ph-prompt')).toContainText(`Cost ${PRICE} Scrap`);
        await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'place');
        const aimed = await aimAt(page, -0.5);
        // Looking along -z, the player is on the +z side of the cell, so the front looks that way.
        expect(moduleFacing(stateShape(aimed.state))).toBe(1);
        expect(aimed.state).toBe(packState(moduleShape(MODULE.storage, 1), 1));
        expect(await ringOf(page)).toBeNull();
        await page.screenshot({ path: testInfo.outputPath('storage-ghost.png') });
        return aimed;
      });

    await test.step('a click puts it in the world and takes the price, and the pool can hold a Storage’s share more of each material: the HUD says so once', async () => {
      await click(page, 'right');
      await poll(() => blockAt(page, first.place)).toBe(first.state);
      await poll(() => scrap(page)).toBe(100 - PRICE);
      await poll(() => drawn(page)).toBe(1);
      const group = await read<{ module: number; level: number }>(
        page,
        `game.world.view.modules.at(${first.place.x}, ${first.place.y}, ${first.place.z}).userData`,
      );
      expect(group).toMatchObject({ module: MODULE.storage, level: 1 });
      // It takes no part in power, so its lights never go down.
      expect(await powerOf(page, first.place)).toBe('none');
      expect(await lit(page, first.place)).toBe(true);
      await poll(() => ceiling(page)).toBe(ceilingWith(1));
      await poll(() => storageToasts(page)).toEqual([built(1)]);
      expect(await rejections(page)).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('storage-placed.png') });
    });

    await test.step('the count on the hotbar turns amber where the pool holds all it can, and only there', async () => {
      await setScrap(page, ceilingWith(1) - 1);
      await poll(() => scrap(page)).toBe(ceilingWith(1) - 1);
      await wait(scrapCount(page)).not.toHaveAttribute('data-full', '');
      // The pool takes a whole Storage’s share more than the table’s cap alone would let it.
      await setScrap(page, ceilingWith(1));
      await poll(() => scrap(page)).toBe(ceilingWith(1));
      expect(ceilingWith(1)).toBeGreaterThan(POOL.cap);
      await wait(scrapCount(page)).toHaveAttribute('data-full', '');
      await page.screenshot({ path: testInfo.outputPath('storage-full.png') });
    });

    const second =
      await test.step('a second Storage raises the ceiling again, by the same share', async () => {
        await setScrap(page, 100);
        await poll(() => scrap(page)).toBe(100);
        const cell = await placeNear(page, -2, 0, STORAGE);
        await poll(() => blockAt(page, cell)).toBe(STORAGE);
        await poll(() => scrap(page)).toBe(100 - PRICE);
        await poll(() => ceiling(page)).toBe(ceilingWith(2));
        await poll(() => storageToasts(page)).toEqual([built(1), built(2)]);
        await wait(scrapCount(page)).not.toHaveAttribute('data-full', '');
        return cell;
      });

    await test.step('breaking one takes its room back, and what the pool holds above the lower ceiling stays: the count stays amber and nothing more goes in', async () => {
      await setScrap(page, ceilingWith(2));
      await poll(() => scrap(page)).toBe(ceilingWith(2));
      await wait(scrapCount(page)).toHaveAttribute('data-full', '');
      await breakAt(page, second);
      await poll(() => blockAt(page, second)).toBe(0);
      await poll(() => ceiling(page)).toBe(ceilingWith(1));
      await poll(() => storageToasts(page)).toEqual([built(1), built(2), gone(1)]);
      // The pool was over the new ceiling, so the price it gave back found no room, and what was there stays.
      expect(await scrap(page)).toBe(ceilingWith(2));
      await wait(scrapCount(page)).toHaveAttribute('data-full', '');
      // Spent down under the ceiling, the count goes back to white.
      await setScrap(page, 100);
      await poll(() => scrap(page)).toBe(100);
      await wait(scrapCount(page)).not.toHaveAttribute('data-full', '');
    });

    await test.step('a left click breaks the last Storage, gives the price back, and the ceiling is the table’s again', async () => {
      await page.keyboard.press('Digit1');
      await wait(page.locator('.ph-slot').nth(0)).toHaveAttribute('data-selected', '');
      await poll(async () => (await aimAtCell(page, first.place)).on).toBe('block');
      await click(page, 'left');
      await poll(() => blockAt(page, first.place)).toBe(0);
      await poll(() => scrap(page)).toBe(100 + PRICE);
      await poll(() => drawn(page)).toBe(0);
      await poll(() => ceiling(page)).toBe(POOL.cap);
      await poll(() => storageToasts(page)).toEqual([built(1), built(2), gone(1), gone(0)]);
      expect(await rejections(page)).toEqual([]);
    });
    expect(problems).toEqual([]);
  });
});
