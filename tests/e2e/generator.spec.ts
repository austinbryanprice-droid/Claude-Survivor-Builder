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
import { needsResearch, notEnough } from '../../src/systems/economy/build-rules';
import { POWER, VITALS } from '../../src/systems/survival/balance';
import { PLAYER } from '../../src/shared/movement';
import { lowGroundNear, openGroundFarFromTheCore, standAt } from './support/power';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

const STATE_TIMEOUT = 60_000;
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the patience of `wait`: the HUD and the aim only change when a frame is drawn. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** The first morning with no waves: the pool, the points and the Generator are what is being looked at. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&waves=0';

/** A spot in the crash clearing, where the ground is open and gentle. */
const SPOT = { x: 8.5, z: -4.5 };
const SCRAP_SLOT = poolSlot(MATERIAL.scrap);
/** The module slot of the hotbar, counting from 0 (the key is the next number up). */
const MODULE_SLOT = 5;
const GENERATOR_DEF = MODULES.find((module) => module.id === MODULE.generator)!;
const PRICE = GENERATOR_DEF.cost.amount;
/** The points that open the Power row of the ladder, which opens the Generator. */
const POWER_AT = RESEARCH.groups[0].points;
/** A Generator at its first level, facing +x. */
const GENERATOR = packState(moduleShape(MODULE.generator, 0), 1);
/** How many pieces the ribbon of the ring on the ground is made of (see `reach-ring.ts`). */
const RING_SEGMENTS = 96;

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

/** The ring that shows how far the power of a module reaches: the cell it is drawn round, and its radius. */
interface Ring extends Cell {
  radius: number;
}

interface Reading {
  energy: number;
  charging: boolean;
}

const scrap = async (page: Page): Promise<number> =>
  (await read<{ stock: number[] }>(page, 'mp.pool()')).stock[SCRAP_SLOT] ?? -1;
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
const ringOf = (page: Page): Promise<Ring | null> => read<Ring | null>(page, 'build.reach()');
const vitals = (page: Page): Promise<Reading> => read<Reading>(page, 'mp.vitals()');
const warp = (page: Page, seconds: number): Promise<void> =>
  page.evaluate((s) => window.__ashbound?.mp?.warp(s), seconds);

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

test.describe('the Generator', () => {
  test('is built from the module slot once the Power points are in, and rings on the ground how far its power reaches', async ({
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
    await setScrap(page, 100);
    await poll(() => scrap(page)).toBe(100);
    await enterBuildMode(page);

    await test.step('two presses of Q reach the Generator from the Terminal, and the Power points that open it are not in yet: a padlock, and words for it', async () => {
      await page.keyboard.press(`Digit${MODULE_SLOT + 1}`);
      await wait(page.locator('.ph-slot').nth(MODULE_SLOT)).toHaveAttribute('data-selected', '');
      await wait(page.locator('.ph-prompt')).toContainText('Research Terminal');
      await page.keyboard.press('KeyQ');
      await wait(page.locator('.ph-prompt')).toContainText('Basic Turret');
      await page.keyboard.press('KeyQ');
      await wait(
        page.locator('.ph-slot').nth(MODULE_SLOT).locator('.ph-slot-icon use'),
      ).toHaveAttribute('href', '#ph-i-generator');
      await wait(page.locator('.ph-prompt')).toContainText(GENERATOR_DEF.name);
      await wait(page.locator('.ph-slot').nth(MODULE_SLOT)).toHaveAttribute('data-locked', '');
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBe(
        needsResearch(GENERATOR_DEF.name),
      );
      await wait(page.locator('.ph-prompt')).toContainText(`Needs research · 0 of ${POWER_AT}`);
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'blocked');
    });

    await test.step('with the points in the padlock opens, and a pool one short of the price turns the ghost red', async () => {
      await setResearch(page, POWER_AT);
      await setScrap(page, PRICE - 1);
      await wait(page.locator('.ph-slot').nth(MODULE_SLOT)).not.toHaveAttribute('data-locked', '');
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBe(notEnough('Scrap'));
      await wait(page.locator('.ph-prompt')).toContainText('Not enough Scrap');
    });

    const aim =
      await test.step('with the price in the pool the caption gives it, and the ring is drawn on the ground round the cell where the Generator would stand', async () => {
        await setScrap(page, 100);
        await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBeNull();
        await wait(page.locator('.ph-prompt')).toContainText(`Cost ${PRICE} Scrap`);
        await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'place');
        const aimed = await aimAt(page, -0.5);
        // Looking along -z, the player is on the +z side of the cell, so the front looks that way.
        expect(moduleFacing(stateShape(aimed.state))).toBe(1);
        expect(aimed.state).toBe(packState(moduleShape(MODULE.generator, 1), 1));
        await poll(() => ringOf(page)).toEqual({ ...aimed.place, radius: POWER.generator.radius });
        await page.screenshot({ path: testInfo.outputPath('generator-ghost.png') });
        return aimed;
      });

    await test.step('a click puts it in the world, takes the price from the pool, and draws the Generator', async () => {
      await click(page, 'right');
      await poll(() => blockAt(page, aim.place)).toBe(aim.state);
      await poll(() => scrap(page)).toBe(100 - PRICE);
      await poll(() => drawn(page)).toBe(1);
      const group = await read<{ module: number; level: number }>(
        page,
        `game.world.view.modules.at(${aim.place.x}, ${aim.place.y}, ${aim.place.z}).userData`,
      );
      expect(group).toMatchObject({ module: MODULE.generator, level: 1 });
      expect(await rejections(page)).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('generator-placed.png') });
    });

    await test.step('with a block in hand the ring is drawn round a Generator the cursor is on, and not otherwise', async () => {
      await page.keyboard.press('Digit1');
      await wait(page.locator('.ph-slot').nth(0)).toHaveAttribute('data-selected', '');
      await poll(async () => (await aimAtCell(page, aim.place)).on).toBe('block');
      await poll(() => ringOf(page)).toEqual({ ...aim.place, radius: POWER.generator.radius });
      await page.screenshot({ path: testInfo.outputPath('generator-ringed.png') });
      // The sky has no Generator in it.
      await aimAt(page, 1.2);
      await poll(() => ringOf(page)).toBeNull();
      // Nor does the ground beside it, with a block in hand.
      await aimAt(page, -0.5);
      await poll(() => ringOf(page)).toBeNull();
    });

    await test.step('leaving Build Mode takes the ring away, and coming back brings it again', async () => {
      await poll(async () => (await aimAtCell(page, aim.place)).on).toBe('block');
      await poll(() => ringOf(page)).not.toBeNull();
      await page.keyboard.press('KeyB');
      await wait(page.locator('.status-mode')).toBeHidden();
      await poll(() => ringOf(page)).toBeNull();
      await page.keyboard.press('KeyB');
      await wait(page.locator('.status-mode')).toBeVisible();
      await poll(() => ringOf(page)).toEqual({ ...aim.place, radius: POWER.generator.radius });
    });

    await test.step('a left click breaks it, gives the price back, and the ring goes with it', async () => {
      await click(page, 'left');
      await poll(() => blockAt(page, aim.place)).toBe(0);
      await poll(() => scrap(page)).toBe(100);
      await poll(() => drawn(page)).toBe(0);
      await poll(() => ringOf(page)).toBeNull();
      expect(await rejections(page)).toEqual([]);
    });
    expect(problems).toEqual([]);
  });

  test('the host holds a command to the same rules as the screen: before the Power points are in a Generator is turned away in words, after them it stands', async ({
    page,
  }) => {
    const problems = await open(page);
    await page.evaluate(({ x, z }) => {
      const game = window.__ashbound?.game;
      if (game) game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
    }, SPOT);
    // The host learns where the player stands when a frame runs. A command that gets there first is
    // turned away as out of reach, which is what a slow runner showed.
    await frames(page, 2);
    const place = (dx: number, dz: number): Promise<Cell> =>
      page.evaluate(([a, b, s]) => window.__ashbound!.mp!.placeNear(a!, b!, s!), [
        dx,
        dz,
        GENERATOR,
      ] as const);

    await setScrap(page, 100);
    await poll(() => scrap(page)).toBe(100);
    await place(3, 0);
    await poll(() => rejections(page)).toEqual([needsResearch(GENERATOR_DEF.name)]);
    expect(await read<number>(page, 'mp.blocks().count')).toBe(0);
    expect(await scrap(page)).toBe(100);

    // One point short of the row is still short of it.
    await setResearch(page, POWER_AT - 1);
    await place(3, 0);
    await poll(() => rejections(page)).toEqual([
      needsResearch(GENERATOR_DEF.name),
      needsResearch(GENERATOR_DEF.name),
    ]);

    await setResearch(page, POWER_AT);
    const cell = await place(3, 0);
    await poll(() => blockAt(page, cell)).toBe(GENERATOR);
    await poll(() => scrap(page)).toBe(100 - PRICE);
    expect(await rejections(page)).toHaveLength(2);
    expect(problems).toEqual([]);
  });

  test('a standing Generator refills Energy within its reach and says Charging, the ring on the ground is where that stops, and breaking it ends it', async ({
    page,
  }) => {
    // The first look at a ghost bakes the block tiles and compiles the shader, then each step waits for frames.
    test.setTimeout(300_000);
    const problems = await open(page);
    const home = await openGroundFarFromTheCore(page, -1);
    expect(home, 'open ground thirty blocks from the Core').not.toBeNull();
    // The host only sees where a player stands, and so who is charged, while the run is going.
    await takeThePointer(page);
    await setResearch(page, POWER_AT);
    await setScrap(page, 100);
    await standAt(page, home!.x, home!.z);
    await frames(page, 3);

    await test.step('far from the Core, with no Generator standing, nothing charges', async () => {
      await page.evaluate(() => window.__ashbound?.mp?.setVitals({ energy: 30 }));
      await poll(async () => (await vitals(page)).charging).toBe(false);
      await expect(page.locator('.ph-status-row')).toHaveCount(0);
    });

    // A few blocks from where the player stands, on ground low in its cell so that the cursor can find its body; the player is beside it.
    const offset = await lowGroundNear(page);
    expect(offset, 'a cell near the player whose ground is low in it').not.toBeNull();
    const cell = await page.evaluate(
      ([dx, dz, state]) => window.__ashbound!.mp!.placeNear(dx!, dz!, state!),
      [offset!.dx, offset!.dz, GENERATOR] as const,
    );
    const middle = { x: cell.x + 0.5, z: cell.z + 0.5 };
    const beside = { x: home!.x, z: home!.z };

    await test.step('the moment a Generator stands beside them the field charges, and the corner says so', async () => {
      await poll(() => blockAt(page, cell)).toBe(GENERATOR);
      await poll(async () => (await vitals(page)).charging).toBe(true);
      await wait(page.locator('.ph-status-label')).toHaveText('Charging');
      await wait(page.locator('.ph-status').first()).toHaveAttribute('data-tone', 'good');
    });

    await test.step('ten seconds beside it bring the Energy up at the Generator’s rate less the idle drain', async () => {
      const before = (await vitals(page)).energy;
      await warp(page, 10);
      const gained = (await vitals(page)).energy - before;
      const rate = POWER.generator.perSecond - VITALS.energy.idlePerSecond;
      // The readout is in whole points, rounded up, and the run plays on in real time while the jump is taken.
      expect(gained).toBeGreaterThanOrEqual(Math.floor(10 * rate) - 1);
      expect(gained).toBeLessThanOrEqual(Math.ceil(10 * rate) + 4);
    });

    await test.step('far from it, and from the Core, nothing charges and the Energy only drains', async () => {
      await standAt(page, middle.x - POWER.generator.radius - 6, middle.z);
      await frames(page, 3);
      await poll(async () => (await vitals(page)).charging).toBe(false);
      const before = (await vitals(page)).energy;
      await warp(page, 30);
      expect((await vitals(page)).energy).toBeLessThan(before);
    });

    // The ribbon of the ring lies on the ground at the edge of the reach, and these are the pieces of it.
    const ring =
      await test.step('the ring is drawn round the Generator the cursor is on', async () => {
        await standAt(page, beside.x, beside.z);
        await frames(page, 3);
        await enterBuildMode(page);
        await page.keyboard.press('Digit1');
        await poll(async () => (await aimAtCell(page, cell)).on).toBe('block');
        await poll(() => ringOf(page)).toEqual({ ...cell, radius: POWER.generator.radius });
        // Two points for each of the pieces: the inner and the outer side of the ribbon, as x, y, z.
        const points = await read<number[]>(
          page,
          `Array.from(game.world.view.reach.geometry.getAttribute('position').array)`,
        );
        expect(points).toHaveLength((RING_SEGMENTS + 1) * 2 * 3);
        return points;
      });

    await test.step('Energy comes back just inside the ring all the way round, and not just outside it', async () => {
      // Where the ribbon is laid at a bearing, and how far from the middle of the cell its middle is.
      const edgeAt = (piece: number): number => {
        const inner = piece * 6;
        const outer = inner + 3;
        const x = ((ring[inner] as number) + (ring[outer] as number)) / 2;
        const z = ((ring[inner + 2] as number) + (ring[outer + 2] as number)) / 2;
        return Math.hypot(x - middle.x, z - middle.z);
      };
      for (const bearing of [0, 0.25, 0.5, 0.75]) {
        const piece = Math.round(bearing * RING_SEGMENTS);
        const angle = (piece / RING_SEGMENTS) * Math.PI * 2;
        const edge = edgeAt(piece);
        // The ground is level or rises and falls, and the edge is somewhere short of the radius or at it.
        expect(edge).toBeGreaterThan(0);
        expect(edge).toBeLessThanOrEqual(POWER.generator.radius + 1e-6);
        for (const [out, inside] of [
          [edge - 0.4, true],
          [edge + 0.4, false],
        ] as const) {
          await standAt(page, middle.x + Math.cos(angle) * out, middle.z + Math.sin(angle) * out);
          await frames(page, 3);
          await poll(async () => (await vitals(page)).charging).toBe(inside);
        }
      }
    });

    await test.step('breaking the Generator ends the charge for a player who stands where it reached', async () => {
      await standAt(page, beside.x, beside.z);
      await frames(page, 3);
      await poll(async () => (await vitals(page)).charging).toBe(true);
      await poll(async () => (await aimAtCell(page, cell)).on).toBe('block');
      await click(page, 'left');
      await poll(() => blockAt(page, cell)).toBe(0);
      await poll(async () => (await vitals(page)).charging).toBe(false);
      await poll(() => ringOf(page)).toBeNull();
    });
    expect(problems).toEqual([]);
  });
});
