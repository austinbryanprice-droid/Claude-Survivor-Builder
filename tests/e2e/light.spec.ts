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
import { RESEARCH } from '../../src/systems/economy/balance';
import { needsResearch, notEnough } from '../../src/systems/economy/build-rules';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

const STATE_TIMEOUT = 60_000;
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the patience of `wait`: the HUD and the aim only change when a frame is drawn. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** The first morning with no waves: the Light and the power it burns on are what is being looked at. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&waves=0';

/** A spot in the crash clearing, where the ground is open and gentle. */
const SPOT = { x: 8.5, z: -4.5 };
const SCRAP_SLOT = poolSlot(MATERIAL.scrap);
/** The module slot of the hotbar, counting from 0 (the key is the next number up). */
const MODULE_SLOT = 5;
const LIGHT_DEF = MODULES.find((module) => module.id === MODULE.light)!;
const PRICE = LIGHT_DEF.cost.amount;
/** The points that open the Camp row of the ladder, which opens the Storage, the Bed and the Light. */
const CAMP_AT = RESEARCH.groups.find((group) => group.id === 'camp')!.points;
/** A Generator at its first level, facing +x: it lights what stands within six blocks of it, and the Camp row's points open the Power row's too. */
const GENERATOR = packState(moduleShape(MODULE.generator, 0), 1);

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
const ringOf = (page: Page): Promise<unknown> => read<unknown>(page, 'build.reach()');
/** What the screen works out a module in a cell has of power: 'on', 'off', or 'none' for one that takes no part. */
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

/** The lamps the shaders read: how many Lights burn, and how many of them the last frame was lit by (the stage takes the nearest few). */
const lamps = (page: Page): Promise<{ burning: number; active: number }> =>
  read<{ burning: number; active: number }>(
    page,
    '({ burning: stage.atmosphere.lamps.burning, active: stage.atmosphere.lamps.active })',
  );
/** The red of the lamps' color, which is the lens's warm white times how bright it burns for how dark the sky is. */
const lampRed = (page: Page): Promise<number> =>
  read<number>(page, 'stage.atmosphere.uniforms.uLampColor.value.r');

/** The small tag under the crosshair that says whether the Light the cursor is on has power. */
const tag = (page: Page) => page.locator('.ph-power-tag');
async function expectTag(
  page: Page,
  state: 'on' | 'off',
  label: string,
  detail: string,
): Promise<void> {
  await wait(tag(page)).toBeVisible();
  await wait(tag(page)).toHaveAttribute('data-state', state);
  await wait(tag(page).locator('.ph-power-tag-label')).toHaveText(label);
  await wait(tag(page).locator('.ph-power-tag-detail')).toHaveText(detail);
}

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

test.describe('the Light', () => {
  test('is built from the module slot once the Camp points are in, burns low until a Generator within reach lights it, and the aim says which', async ({
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

    await test.step('six presses of Q reach the Light from the Terminal, and until the Camp points are in the slot is behind a padlock, with words for it', async () => {
      await page.keyboard.press(`Digit${MODULE_SLOT + 1}`);
      await wait(page.locator('.ph-slot').nth(MODULE_SLOT)).toHaveAttribute('data-selected', '');
      await wait(page.locator('.ph-prompt')).toContainText('Research Terminal');
      for (const name of ['Basic Turret', 'Generator', 'Power Node', 'Storage', 'Bed']) {
        await page.keyboard.press('KeyQ');
        await wait(page.locator('.ph-prompt')).toContainText(name);
      }
      await page.keyboard.press('KeyQ');
      await wait(
        page.locator('.ph-slot').nth(MODULE_SLOT).locator('.ph-slot-icon use'),
      ).toHaveAttribute('href', '#ph-i-light');
      await wait(page.locator('.ph-prompt')).toContainText(LIGHT_DEF.name);
      await wait(page.locator('.ph-slot').nth(MODULE_SLOT)).toHaveAttribute('data-locked', '');
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBe(
        needsResearch(LIGHT_DEF.name),
      );
      await wait(page.locator('.ph-prompt')).toContainText(`Needs research · 0 of ${CAMP_AT}`);
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'blocked');
    });

    await test.step('the same row opens it as opens the Storage and the Bed, and a pool one short of the price turns the ghost red', async () => {
      await setResearch(page, CAMP_AT - 1);
      await wait(page.locator('.ph-prompt')).toContainText(
        `Needs research · ${CAMP_AT - 1} of ${CAMP_AT}`,
      );
      await setResearch(page, CAMP_AT);
      await setScrap(page, PRICE - 1);
      await wait(page.locator('.ph-slot').nth(MODULE_SLOT)).not.toHaveAttribute('data-locked', '');
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBe(notEnough('Scrap'));
      await wait(page.locator('.ph-prompt')).toContainText('Not enough Scrap');
    });

    const aim =
      await test.step('with the price in the pool the caption gives it, and no ring is drawn: a Light reaches nowhere', async () => {
        await setScrap(page, 100);
        await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBeNull();
        await wait(page.locator('.ph-prompt')).toContainText(`Cost ${PRICE} Scrap`);
        await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'place');
        const aimed = await aimAt(page, -0.5);
        // Looking along -z, the player is on the +z side of the cell, so the front looks that way.
        expect(moduleFacing(stateShape(aimed.state))).toBe(1);
        expect(aimed.state).toBe(packState(moduleShape(MODULE.light, 1), 1));
        expect(await ringOf(page)).toBeNull();
        await page.screenshot({ path: testInfo.outputPath('light-ghost.png') });
        return aimed;
      });

    await test.step('a click puts it in the world, takes the price, and draws the Light with its lamp low: no Generator stands near', async () => {
      await click(page, 'right');
      await poll(() => blockAt(page, aim.place)).toBe(aim.state);
      await poll(() => scrap(page)).toBe(100 - PRICE);
      await poll(() => drawn(page)).toBe(1);
      const group = await read<{ module: number; level: number }>(
        page,
        `game.world.view.modules.at(${aim.place.x}, ${aim.place.y}, ${aim.place.z}).userData`,
      );
      expect(group).toMatchObject({ module: MODULE.light, level: 1 });
      await poll(() => powerOf(page, aim.place)).toBe('off');
      await poll(() => lit(page, aim.place)).toBe(false);
      expect(await lamps(page)).toEqual({ burning: 0, active: 0 });
      expect(await rejections(page)).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('light-placed.png') });
    });

    await test.step('with a block in hand the tag under the crosshair says it has no power, and what that does to it, only while the cursor is on it', async () => {
      await page.keyboard.press('Digit1');
      await wait(page.locator('.ph-slot').nth(0)).toHaveAttribute('data-selected', '');
      await poll(async () => (await aimAtCell(page, aim.place)).on).toBe('block');
      await expectTag(
        page,
        'off',
        'No power',
        'Burns low · a Generator or Node in reach lights it',
      );
      // A Light relays nothing, so the cursor on it draws no ring either.
      expect(await ringOf(page)).toBeNull();
      await page.screenshot({ path: testInfo.outputPath('light-unpowered.png') });
      await aimAt(page, 1.2);
      await wait(tag(page)).toBeHidden();
    });

    await test.step('a Generator placed within its reach gives the Light power: the lamp comes up and throws light, the tag says it burns bright, and breaking the Generator puts it low and out again', async () => {
      await setScrap(page, 100);
      const generator = await placeNear(page, -2, 0, GENERATOR);
      await poll(() => blockAt(page, generator)).toBe(GENERATOR);
      await poll(() => powerOf(page, aim.place)).toBe('on');
      await poll(() => lit(page, aim.place)).toBe(true);
      await poll(() => lit(page, generator)).toBe(true);
      await poll(() => lamps(page)).toEqual({ burning: 1, active: 1 });
      await poll(async () => (await aimAtCell(page, aim.place)).on).toBe('block');
      await expectTag(page, 'on', 'Powered', 'Burns bright');
      await page.screenshot({ path: testInfo.outputPath('light-powered.png') });

      // The light is a tenth of itself by day, and all of itself once the sky is dark.
      const byDay = await lampRed(page);
      expect(byDay).toBeGreaterThan(0);
      const held = await read<string | null>(page, 'stage.moment');
      await page.evaluate(() => window.__ashbound!.stage.setMoment('night'));
      await poll(() => lampRed(page)).toBeGreaterThan(byDay * 5);
      await page.evaluate((name) => window.__ashbound!.stage.setMoment(name), held);
      await poll(() => lampRed(page)).toBeCloseTo(byDay, 6);

      await breakAt(page, generator);
      await poll(() => blockAt(page, generator)).toBe(0);
      await poll(() => powerOf(page, aim.place)).toBe('off');
      await poll(() => lit(page, aim.place)).toBe(false);
      await poll(() => lamps(page)).toEqual({ burning: 0, active: 0 });
      await expectTag(
        page,
        'off',
        'No power',
        'Burns low · a Generator or Node in reach lights it',
      );
      await poll(() => scrap(page)).toBe(100);
    });

    await test.step('a left click breaks the Light and gives the price back, and the tag goes with it', async () => {
      await poll(async () => (await aimAtCell(page, aim.place)).on).toBe('block');
      await click(page, 'left');
      await poll(() => blockAt(page, aim.place)).toBe(0);
      await poll(() => scrap(page)).toBe(100 + PRICE);
      await poll(() => drawn(page)).toBe(0);
      await wait(tag(page)).toBeHidden();
      expect(await rejections(page)).toEqual([]);
    });
    expect(problems).toEqual([]);
  });
});
