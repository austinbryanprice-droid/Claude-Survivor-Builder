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
import { RESEARCH } from '../../src/systems/economy/balance';
import { needsResearch } from '../../src/systems/economy/build-rules';
import { RESPAWN } from '../../src/systems/survival/balance';
import { recordToasts, toasts } from './support/toasts';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

const STATE_TIMEOUT = 60_000;
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the patience of `wait`: the HUD and the aim only change when a frame is drawn. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** The first morning with no waves: the Beds and the falls are what is being looked at. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&waves=0';

/** A spot in the crash clearing, where the ground is open and gentle. */
const SPOT = { x: 8.5, z: -4.5 };
const SCRAP_SLOT = poolSlot(MATERIAL.scrap);
/** The module slot of the hotbar, counting from 0 (the key is the next number up). */
const MODULE_SLOT = 5;
const BED_DEF = MODULES.find((module) => module.id === MODULE.bed)!;
const PRICE = BED_DEF.cost.amount;
/** The points that open the Camp row of the ladder, which opens the Bed. */
const CAMP_AT = RESEARCH.groups.find((group) => group.id === 'camp')!.points;
/** How high the Bed rises in its cell, which is where a player on top of it stands. */
const BED_TOP = BED_DEF.body[4];
/** A Bed at its first level facing `facing`: 0 looks toward +x, 1 toward +z, 2 toward -x and 3 toward -z. */
const bedFacing = (facing: number): number => packState(moduleShape(MODULE.bed, facing), 1);
/** The way each facing looks, as a step in x and z. */
const AHEAD = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

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

interface Spot {
  x: number;
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
/** What the screen works out a module in a cell has of power: 'none' for one that takes no part, as a Bed does not. */
const powerOf = (page: Page, cell: Cell): Promise<string> =>
  read<string>(page, `game.world.power.stateAt(${cell.x}, ${cell.y}, ${cell.z})`);
/** Whether the lights of the module drawn in a cell are up, or null where none is drawn. */
const lit = (page: Page, cell: Cell): Promise<boolean | null> =>
  read<boolean | null>(page, `game.world.view.modules.isPowered(${cell.x}, ${cell.y}, ${cell.z})`);
const breakAt = (page: Page, cell: Cell): Promise<void> =>
  page.evaluate(({ x, y, z }) => window.__ashbound!.mp!.breakBlock(x, y, z), cell);
const placeAt = (page: Page, cell: Cell, state: number): Promise<void> =>
  page.evaluate(([x, y, z, s]) => window.__ashbound!.mp!.place(x!, y!, z!, s!), [
    cell.x,
    cell.y,
    cell.z,
    state,
  ] as const);
const positionOf = (page: Page) => read<Cell>(page, 'mp.position()');
const apart = (a: Spot, b: Spot): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Puts the player on the ground at (x, z), a frame's worth of looking at nothing in particular. */
async function standAt(page: Page, x: number, z: number): Promise<void> {
  await page.evaluate(
    ([tx, tz]) => {
      const game = window.__ashbound?.game;
      if (game) game.teleport(tx!, game.world.groundAt(tx!, tz!) + 0.05, tz!, 0);
    },
    [x, z] as const,
  );
  await frames(page, 2);
}

/**
 * A cell for a Bed that faces `facing`, `radius` blocks or more from the world's spawn point toward
 * `bearing` (radians): the floor of the cell lies close under the ground at its middle, so the Bed shows,
 * and the ground in front of it lies at most half a block above that floor and a block below it, so
 * a player brought back there stands on the ground in front and not on a wall or in a pit.
 */
const bedCell = (page: Page, bearing: number, radius: number, facing: number): Promise<Cell> =>
  page.evaluate(
    ([angle, start, face]) => {
      const { game } = window.__ashbound!;
      const { x: sx, z: sz } = game.world.spawn;
      const ahead = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ][face!]!;
      for (let d = start!; d < start! + 60; d++) {
        const x = Math.floor(sx + Math.cos(angle!) * d);
        const z = Math.floor(sz + Math.sin(angle!) * d);
        const middle = game.world.groundAt(x + 0.5, z + 0.5);
        const front = game.world.groundAt(x + 0.5 + ahead[0]!, z + 0.5 + ahead[1]!);
        const floor = Math.floor(middle);
        if (middle - floor < 0.3 && front - floor <= 0.5 && front - floor >= -1) {
          return { x, y: floor, z };
        }
      }
      throw new Error('no ground for a Bed out that way');
    },
    [bearing, radius, facing] as const,
  );

/**
 * Looks at the middle of a cell's body, a little above the floor, and returns what the cursor is on
 * a frame later.
 */
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

/** Goes into Build Mode and waits for the first block's tiles and shader, which the first look at a ghost costs seconds of. */
async function enterBuildMode(page: Page): Promise<void> {
  await page.keyboard.press('KeyB');
  await wait(page.locator('.status-mode')).toBeVisible();
  await read<void>(
    page,
    'Promise.all([game.world.view.structures.warmUp(), game.world.view.ghost.precompile()])',
  );
}

/**
 * Fells the player and holds the run there, and brings them back after the Core's wait. The Core
 * counts that wait on the run's clock, which keeps time while a frame (and every check below waits
 * for one) can take longer than that here. Letting go of the pointer pauses a run played alone, and a
 * tenth of a second on its clock is the step in which the Core sees the player down. All of it
 * happens in the page, so nothing is missed in between. The crew is given a charge each time.
 */
async function fallAndReturn(page: Page): Promise<void> {
  await page.evaluate(
    ([charges]) => {
      const mp = window.__ashbound?.mp;
      if (!mp) return;
      mp.setRespawns(charges!);
      mp.hurtPlayer(1000);
      document.exitPointerLock();
      mp.warp(0.1);
    },
    [RESPAWN.capPerPlayer] as const,
  );
  await poll(() => read<number>(page, 'mp.vitals().health')).toBe(0);
  await page.evaluate((seconds) => window.__ashbound?.mp?.warp(seconds), RESPAWN.delaySeconds + 1);
  await poll(() => read<boolean>(page, 'game.frozen')).toBe(false);
  await poll(() => read<number>(page, 'mp.vitals().health')).toBeGreaterThan(0);
}

/** Where a Bed in a cell that faces `facing` puts a player: the middle of the cell it looks at. */
const inFront = (cell: Cell, facing: number): Spot => ({
  x: cell.x + 0.5 + AHEAD[facing]![0],
  z: cell.z + 0.5 + AHEAD[facing]![1],
});

test.describe('the Bed', () => {
  test('is built from the module slot once the Camp points are in, takes no part in power or in the pool’s ceiling, and is low enough to stand on', async ({
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
    const ceiling = (await pool(page)).cap;
    await enterBuildMode(page);

    await test.step('five presses of Q reach the Bed from the Terminal, and until the Camp points are in the slot is behind a padlock, with words for it', async () => {
      await page.keyboard.press(`Digit${MODULE_SLOT + 1}`);
      await wait(page.locator('.ph-slot').nth(MODULE_SLOT)).toHaveAttribute('data-selected', '');
      await wait(page.locator('.ph-prompt')).toContainText('Research Terminal');
      for (const name of ['Basic Turret', 'Generator', 'Power Node', 'Storage']) {
        await page.keyboard.press('KeyQ');
        await wait(page.locator('.ph-prompt')).toContainText(name);
      }
      await page.keyboard.press('KeyQ');
      await wait(
        page.locator('.ph-slot').nth(MODULE_SLOT).locator('.ph-slot-icon use'),
      ).toHaveAttribute('href', '#ph-i-bed');
      await wait(page.locator('.ph-prompt')).toContainText(BED_DEF.name);
      await wait(page.locator('.ph-slot').nth(MODULE_SLOT)).toHaveAttribute('data-locked', '');
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBe(
        needsResearch(BED_DEF.name),
      );
      await wait(page.locator('.ph-prompt')).toContainText(`Needs research · 0 of ${CAMP_AT}`);
    });

    await test.step('the same row opens it as opens the Storage, and the caption gives the price', async () => {
      await setResearch(page, CAMP_AT - 1);
      await wait(page.locator('.ph-prompt')).toContainText(
        `Needs research · ${CAMP_AT - 1} of ${CAMP_AT}`,
      );
      await setResearch(page, CAMP_AT);
      await wait(page.locator('.ph-slot').nth(MODULE_SLOT)).not.toHaveAttribute('data-locked', '');
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBeNull();
      await wait(page.locator('.ph-prompt')).toContainText(`Cost ${PRICE} Scrap`);
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'place');
      // A cot reaches nowhere, so no ring is drawn round the ghost.
      expect(await ringOf(page)).toBeNull();
    });

    const placed =
      await test.step('a click puts it in the world, facing the player, and takes the price', async () => {
        const aimed = await aimAt(page, -0.5);
        // Looking along -z, the player is on the +z side of the cell, so the front looks that way.
        expect(moduleFacing(stateShape(aimed.state))).toBe(1);
        expect(aimed.state).toBe(bedFacing(1));
        await page.screenshot({ path: testInfo.outputPath('bed-ghost.png') });
        await click(page, 'right');
        await poll(() => blockAt(page, aimed.place)).toBe(aimed.state);
        await poll(() => scrap(page)).toBe(100 - PRICE);
        await poll(() => drawn(page)).toBe(1);
        const group = await read<{ module: number; level: number }>(
          page,
          `game.world.view.modules.at(${aimed.place.x}, ${aimed.place.y}, ${aimed.place.z}).userData`,
        );
        expect(group).toMatchObject({ module: MODULE.bed, level: 1 });
        // It takes no part in power, so its lights never go down, and it does not touch the pool's ceiling.
        expect(await powerOf(page, aimed.place)).toBe('none');
        expect(await lit(page, aimed.place)).toBe(true);
        expect((await pool(page)).cap).toBe(ceiling);
        expect(await rejections(page)).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath('bed-placed.png') });
        return aimed.place;
      });

    await test.step('a player put on top of it stands there, a cot’s height over its cell’s floor, and does not fall through', async () => {
      await page.evaluate(
        ([x, y, z, top]) => {
          const game = window.__ashbound!.game;
          game.teleport(x! + 0.5, y! + top! + 0.4, z! + 0.5, 0);
        },
        [placed.x, placed.y, placed.z, BED_TOP] as const,
      );
      await poll(() => read<boolean>(page, 'game.player.onGround')).toBe(true);
      const feet = await positionOf(page);
      expect(feet.y).toBeGreaterThan(placed.y + BED_TOP - 0.05);
      expect(feet.y).toBeLessThan(placed.y + BED_TOP + 0.1);
      expect(Math.hypot(feet.x - (placed.x + 0.5), feet.z - (placed.z + 0.5))).toBeLessThan(0.1);
    });

    await test.step('breaking it gives the price back', async () => {
      await breakAt(page, placed);
      await poll(() => blockAt(page, placed)).toBe(0);
      await poll(() => scrap(page)).toBe(100);
      await poll(() => drawn(page)).toBe(0);
      expect(await rejections(page)).toEqual([]);
    });
    expect(problems).toEqual([]);
  });

  test('puts back the player the Core brings back: at the Bed nearest to where they fell, in front of it, then at the next when it is broken, and at the base’s seat when none stands', async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const problems = await open(page);
    await takeThePointer(page);
    await recordToasts(page);
    await setResearch(page, CAMP_AT);
    await setScrap(page, 100);
    await poll(() => scrap(page)).toBe(100);
    const seat = await read<Spot>(page, '({ x: game.world.spawn.x, z: game.world.spawn.z })');

    // Two Beds on open ground a good way apart, one facing +x and the other -z.
    const FACING = { west: 0, east: 3 } as const;
    const west = await bedCell(page, Math.PI, 14, FACING.west);
    const east = await bedCell(page, 0, 22, FACING.east);
    await test.step('two Beds stand far apart, each built from beside it', async () => {
      for (const [cell, facing] of [
        [west, FACING.west],
        [east, FACING.east],
      ] as const) {
        await standAt(page, cell.x + 0.5, cell.z + 0.5 + 3);
        await placeAt(page, cell, bedFacing(facing));
        await poll(() => blockAt(page, cell)).toBe(bedFacing(facing));
      }
      await poll(() => scrap(page)).toBe(100 - 2 * PRICE);
      expect(await rejections(page)).toEqual([]);
      expect(apart(west, east)).toBeGreaterThan(20);
    });

    const arrive = async (from: Spot, label: string): Promise<Spot> => {
      await standAt(page, from.x, from.z);
      await fallAndReturn(page);
      // The Core's word reaches the player's legs a frame after it reaches their health.
      await poll(async () => apart(await positionOf(page), from)).toBeGreaterThan(1);
      const at = await positionOf(page);
      await page.screenshot({ path: testInfo.outputPath(`${label}.png`) });
      return at;
    };

    await test.step('a player who falls beside one is brought back in front of it, and the message is the Core’s', async () => {
      const fell = { x: east.x + 0.5 + 5, z: east.z + 0.5 + 4 };
      await standAt(page, fell.x, fell.z);
      await fallAndReturn(page);
      const front = inFront(east, FACING.east);
      await poll(async () => apart(await positionOf(page), front)).toBeLessThan(0.5);
      const left = RESPAWN.capPerPlayer - 1;
      await poll(() => toasts(page)).toContain(
        `The Core brought you back, shaken · ${left} ${left === 1 ? 'respawn' : 'respawns'} left`,
      );
    });

    await test.step('and the Bed nearest to the other fall is the other Bed', async () => {
      const at = await arrive({ x: west.x + 0.5 - 5, z: west.z + 0.5 - 4 }, 'bed-west');
      expect(apart(at, inFront(west, FACING.west))).toBeLessThan(0.5);
      expect(apart(at, seat)).toBeGreaterThan(5);
    });

    await test.step('with that Bed broken, a fall beside it brings the player back at the other, however far it is', async () => {
      await standAt(page, west.x + 0.5 + 3, west.z + 0.5);
      await breakAt(page, west);
      await poll(() => blockAt(page, west)).toBe(0);
      const at = await arrive({ x: west.x + 0.5 + 3, z: west.z + 0.5 }, 'bed-next');
      expect(apart(at, inFront(east, FACING.east))).toBeLessThan(0.5);
    });

    await test.step('with no Bed standing, the Core brings the player back at the base’s seat, as it always did', async () => {
      await standAt(page, east.x + 0.5 + 3, east.z + 0.5);
      await breakAt(page, east);
      await poll(() => blockAt(page, east)).toBe(0);
      const at = await arrive({ x: east.x + 0.5 + 3, z: east.z + 0.5 }, 'bed-none');
      expect(apart(at, seat)).toBeLessThan(0.5);
      expect(await rejections(page)).toEqual([]);
    });
    expect(problems).toEqual([]);
  });
});
