import { expect, test, type Page } from '@playwright/test';
import {
  MATERIAL,
  MODULE,
  MODULES,
  MODULE_FOOT,
  MODULE_SINK,
  SHAPE,
  moduleFacing,
  moduleShape,
  packState,
  stateShape,
} from '../../src/shared/blocks';
import { poolSlot } from '../../src/shared/economy';
import { PLAYER } from '../../src/shared/movement';
import { notEnough } from '../../src/systems/economy/build-rules';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

const STATE_TIMEOUT = 60_000;
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the patience of `wait`: the HUD and the aim only change when a frame is drawn. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** The first morning with no waves: the pool and the Terminal are what is being looked at. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&waves=0';

/** A spot in the crash clearing, where the ground is open and gentle. */
const SPOT = { x: 8.5, z: -4.5 };
const SCRAP_SLOT = poolSlot(MATERIAL.scrap);
/** The module slot of the hotbar, counting from 0 (the key is the next number up). */
const MODULE_SLOT = 5;
const TERMINAL = MODULES.find((module) => module.id === MODULE.terminal)!;
const PRICE = TERMINAL.cost.amount;

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

interface Ghost {
  ghost: boolean;
  target: boolean;
  ghostShape: number;
  targetShape: number;
}

const scrap = async (page: Page): Promise<number> =>
  (await read<{ stock: number[] }>(page, 'mp.pool()')).stock[SCRAP_SLOT] ?? -1;
const blocks = (page: Page): Promise<number> => read<number>(page, 'mp.blocks().count');
const drawn = (page: Page): Promise<number> => read<number>(page, 'game.world.view.modules.count');
const rejections = async (page: Page): Promise<string[]> =>
  (await read<{ reason: string }[]>(page, 'mp.rejections()')).map((r) => r.reason);
const setScrap = (page: Page, amount: number): Promise<void> =>
  page.evaluate(([material, count]) => window.__ashbound!.mp!.setPool(material!, count!), [
    MATERIAL.scrap,
    amount,
  ] as const);

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

test.describe('the Research Terminal', () => {
  test('is built from the module slot: the caption names it and its price, a click stands it on the ground facing the player, and breaking it gives the price back', async ({
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
    // Just short of the price, so the ghost has something to say first.
    await setScrap(page, PRICE - 1);
    await poll(() => scrap(page)).toBe(PRICE - 1);
    await enterBuildMode(page);

    await test.step('the module slot holds the Terminal: the caption names it, and a pool one short of its price turns the ghost red', async () => {
      await page.keyboard.press(`Digit${MODULE_SLOT + 1}`);
      await wait(page.locator('.ph-slot').nth(MODULE_SLOT)).toHaveAttribute('data-selected', '');
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBe(notEnough('Scrap'));
      await wait(page.locator('.ph-prompt')).toContainText(TERMINAL.name);
      await wait(page.locator('.ph-prompt')).toContainText('Not enough Scrap');
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'blocked');
      // The ghost is the model, not a block: a module's shape.
      const aim = await aimAt(page, -0.5);
      expect(stateShape(aim.state)).toBeGreaterThanOrEqual(SHAPE.module);
      await poll(async () => (await read<Ghost>(page, 'build.ghost()')).ghost).toBe(true);
      expect((await read<Ghost>(page, 'build.ghost()')).ghostShape).toBe(stateShape(aim.state));
    });

    await test.step('with the price in the pool the caption gives it, and the Terminal faces the player', async () => {
      await setScrap(page, 100);
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBeNull();
      await wait(page.locator('.ph-prompt')).toContainText(`Cost ${PRICE} Scrap`);
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'place');
      // Looking along -z, the player is on the +z side of the cell, so the front looks that way.
      const aim = await aimAt(page, -0.5);
      expect(moduleFacing(stateShape(aim.state))).toBe(1);
      expect(stateShape(aim.state)).toBe(moduleShape(MODULE.terminal, 1));
      await page.screenshot({ path: testInfo.outputPath('terminal-ghost.png') });
    });

    await test.step('R turns it a quarter turn', async () => {
      await page.keyboard.press('KeyR');
      await poll(async () => moduleFacing(stateShape((await aimAt(page, -0.5)).state))).toBe(2);
    });

    const aim = await aimAt(page, -0.5);
    const state = packState(moduleShape(MODULE.terminal, 2), 1);
    await test.step('a click puts it in the world, takes the price from the pool, and draws it turned the way it faces', async () => {
      expect(aim.state).toBe(state);
      await click(page, 'right');
      await poll(() =>
        read<number>(page, `mp.block(${aim.place.x}, ${aim.place.y}, ${aim.place.z})`),
      ).toBe(state);
      await poll(() => scrap(page)).toBe(100 - PRICE);
      await poll(() => drawn(page)).toBe(1);
      await poll(() => blocks(page)).toBe(1);
      // The model's front looks toward +x, and a quarter turn takes it round to -x: half a turn from where it began.
      const turned = await read<number | null>(
        page,
        `game.world.view.modules.at(${aim.place.x}, ${aim.place.y}, ${aim.place.z})?.rotation.y ?? null`,
      );
      expect(turned).toBeCloseTo(-Math.PI, 6);
      expect(await rejections(page)).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('terminal-placed.png') });
    });

    await test.step('it stands on the ground, not in it and not far over it', async () => {
      const ground = await read<number>(
        page,
        `game.world.groundAt(${aim.place.x + 0.5}, ${aim.place.z + 0.5})`,
      );
      // The floor of its cell is at most MODULE_FOOT over the ground, and the ground reaches no more than a little way up it.
      expect(aim.place.y - ground).toBeLessThanOrEqual(MODULE_FOOT);
      expect(aim.place.y - ground).toBeGreaterThan(-(MODULE_SINK + 0.35));
    });

    await test.step('the cursor aims at its body, and a left click breaks it and gives the price back', async () => {
      await poll(async () => (await aimAtCell(page, aim.place)).on).toBe('block');
      const aimed = await aimAtCell(page, aim.place);
      expect(aimed.target).toEqual(aim.place);
      await click(page, 'left');
      await poll(() =>
        read<number>(page, `mp.block(${aim.place.x}, ${aim.place.y}, ${aim.place.z})`),
      ).toBe(0);
      await poll(() => scrap(page)).toBe(100);
      await poll(() => drawn(page)).toBe(0);
      await poll(() => blocks(page)).toBe(0);
      expect(await rejections(page)).toEqual([]);
    });
    expect(problems).toEqual([]);
  });

  test('the host holds a command to the same rules as the screen: a pool one short, a cell high in the air and a level the table does not have are turned away', async ({
    page,
  }) => {
    const problems = await open(page);
    await page.evaluate(({ x, z }) => {
      const game = window.__ashbound?.game;
      if (game) game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
    }, SPOT);
    // The host learns where the player stands when a frame runs. A command that gets there first is turned away as
    // out of reach, which is what a slow runner showed.
    await frames(page, 2);
    const place = (dx: number, dz: number, state: number, up = 0): Promise<Cell> =>
      page.evaluate(([a, b, s, u]) => window.__ashbound!.mp!.placeNear(a!, b!, s!, u), [
        dx,
        dz,
        state,
        up,
      ] as const);
    const terminal = packState(moduleShape(MODULE.terminal, 0), 1);

    await setScrap(page, PRICE - 1);
    await poll(() => scrap(page)).toBe(PRICE - 1);
    await place(3, 0, terminal);
    await poll(() => rejections(page)).toEqual([notEnough('Scrap')]);

    await setScrap(page, 100);
    await poll(() => scrap(page)).toBe(100);
    // Three cells over the ground there is nothing for it to stand on.
    await place(3, 0, terminal, 3);
    await poll(() => rejections(page)).toEqual([notEnough('Scrap'), 'unsupported']);
    // A level the table has no Terminal for is not a piece.
    await place(-3, 0, packState(moduleShape(MODULE.terminal, 0), 2));
    await poll(() => rejections(page)).toEqual([
      notEnough('Scrap'),
      'unsupported',
      'unknown-block',
    ]);
    expect(await blocks(page)).toBe(0);
    expect(await scrap(page)).toBe(100);
    expect(problems).toEqual([]);
  });
});
