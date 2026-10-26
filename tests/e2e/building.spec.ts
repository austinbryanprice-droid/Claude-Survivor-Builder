import { expect, test, type Page } from '@playwright/test';
import {
  MATERIAL,
  SHAPE,
  isUpsideDown,
  packState,
  shapeKind,
  slabShape,
  stateMaterial,
  stateShape,
  wedgeFacing,
  wedgeShape,
} from '../../src/shared/blocks';

// Software WebGL draws a few frames a second, so this test uses the Low preset and a small
// window, and waits on game state rather than on time.
test.use({ viewport: { width: 800, height: 450 } });
test.describe.configure({ timeout: 180_000 });

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const ALLOY = packState(SHAPE.cube, MATERIAL.alloy);
const STATE_TIMEOUT = 60_000;
/** The HUD follows the game once per frame, and a frame can take many seconds while the first block's tiles bake. */
const wait = expect.configure({ timeout: STATE_TIMEOUT });

/** A spot in the crash clearing, where the ground is open and gentle. */
const SPOT = { x: 8.5, z: -4.5 };

interface Cell {
  x: number;
  y: number;
  z: number;
}

async function open(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  // Blocks cost the crew's pool something now, and a run opens with a little Scrap and none of the
  // dearer materials, which have to be researched too, so this page opens with plenty of each and
  // every material researched: what a block costs is tested in costs.spec.ts, and the research in research.spec.ts.
  await page.goto('./?debug&quality=low&freeze=1&stats=0&stock=50&research=100');
  await wait(page.locator('html')).toHaveAttribute('data-ready', 'true');
  // The session arrives with the network code, a moment after the game is up.
  await page.waitForFunction(() => !!window.__ashbound?.mp, null, { timeout: STATE_TIMEOUT });
  return problems;
}

/** Reads a value off the running game, e.g. `read<number>(page, 'game.player.z')`. Needs `?debug`. */
const read = <T>(page: Page, expression: string): Promise<T> =>
  page.evaluate<T>(`(async () => {
    const app = window.__ashbound;
    if (!app) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
    const { game, stage, build, mp } = app;
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

interface Aim {
  on: 'nothing' | 'block' | 'terrain';
  target: Cell;
  targetState: number;
  breakRefusal: string | null;
  hasPlace: boolean;
  place: Cell;
  state: number;
  placeRefusal: string | null;
}

/** Looks along the given pitch (radians, negative is down) and returns what the cursor is on a frame later. */
async function aimAt(page: Page, pitch: number, yaw = 0): Promise<Aim> {
  await page.evaluate(
    ([nextYaw, nextPitch]) => {
      const game = window.__ashbound?.game;
      if (!game) return;
      game.look.yaw = nextYaw ?? 0;
      game.look.pitch = nextPitch ?? 0;
    },
    [yaw, pitch],
  );
  await frames(page);
  return read<Aim>(page, 'build.aim()');
}

/** A mouse button going down and up, the way the browser reports it. Chromium's own synthetic mouse adds stray movement under pointer lock, so the events are made in the page. */
const click = (page: Page, button: 'left' | 'right'): Promise<void> =>
  page.evaluate((which) => {
    const init = { button: which === 'left' ? 0 : 2, bubbles: true };
    window.dispatchEvent(new MouseEvent('mousedown', init));
    window.dispatchEvent(new MouseEvent('mouseup', init));
  }, button);

const blockAt = (page: Page, cell: Cell): Promise<number> =>
  read<number>(page, `mp.block(${cell.x}, ${cell.y}, ${cell.z})`);

const programs = (page: Page): Promise<number> =>
  read<number>(page, 'stage.renderer.info.programs?.length ?? 0');

test.describe('building by hand', () => {
  test('the hotbar, Build Mode, the ghost, placing, breaking and the notices', async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(({ x, z }) => {
      const game = window.__ashbound?.game;
      if (game) game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
    }, SPOT);
    await page.getByRole('button', { name: 'Play' }).click();
    await wait(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
    await page.waitForFunction(() => window.__ashbound?.game.player.onGround === true, null, {
      timeout: STATE_TIMEOUT,
    });

    await test.step('the hotbar holds a block of each tier and a module, the first one selected', async () => {
      // The four block slots and the module slot are what a click places, drawn on the cyan grid.
      await wait(page.locator('.ph-slot[data-blueprint]')).toHaveCount(5);
      await wait(page.locator('.ph-slot').nth(5)).toHaveAttribute('data-blueprint', '');
      await wait(page.locator('.ph-slot[data-selected]')).toHaveCount(1);
      await wait(page.locator('.ph-slot').first()).toHaveAttribute('data-selected', '');
    });

    await test.step('the crosshair marks a surface a block can go on', async () => {
      await expect
        .poll(async () => (await aimAt(page, -0.5)).hasPlace, { timeout: STATE_TIMEOUT })
        .toBe(true);
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'place');
      // Outside Build Mode there is no ghost and no caption.
      expect(await read<{ ghost: boolean }>(page, 'build.ghost()')).toMatchObject({ ghost: false });
    });

    await test.step('B enters Build Mode: ghost, caption with the cost, key list, blocks made ready', async () => {
      await page.keyboard.press('KeyB');
      await wait(page.locator('.status-mode')).toBeVisible();
      await wait(page.locator('.ph-build-hint')).toHaveAttribute('data-active', '');
      await wait(page.locator('.ph-prompt')).toContainText('Scrap Block');
      await wait(page.locator('.ph-prompt')).toContainText('Cost 1 Scrap');
      await expect
        .poll(async () => (await read<{ ghost: boolean }>(page, 'build.ghost()')).ghost)
        .toBe(true);
      // Entering Build Mode (or a few seconds of looking around) bakes the tiles and compiles the
      // programs for the first block and the ghost; wait until that is done.
      await read<void>(
        page,
        'Promise.all([game.world.view.structures.warmUp(), game.world.view.ghost.precompile()])',
      );
      expect(await read<boolean>(page, 'game.stage.structureReady')).toBe(true);
    });

    let placed: Cell = { x: 0, y: 0, z: 0 };
    await test.step('a right click places the selected block, through the session, without compiling anything new', async () => {
      await expect
        .poll(async () => (await aimAt(page, -0.5)).placeRefusal, { timeout: STATE_TIMEOUT })
        .toBeNull();
      const before = await programs(page);
      const aim = await aimAt(page, -0.5);
      expect(aim.on).toBe('terrain');
      placed = { ...aim.place };
      expect(await blockAt(page, placed)).toBe(0);
      const events = await read<number>(page, 'mp.eventCount()');
      await click(page, 'right');
      await expect.poll(() => blockAt(page, placed), { timeout: STATE_TIMEOUT }).toBe(SCRAP);
      expect(await read<number>(page, 'mp.eventCount()')).toBe(events + 1);
      expect(await read<unknown[]>(page, 'mp.rejections()')).toEqual([]);
      // The block is drawn by the next frames, and the first one needed no new shader.
      await expect
        .poll(() => read<number>(page, 'game.world.view.structures.stats.chunks'))
        .toBeGreaterThan(0);
      await frames(page, 2);
      expect(await programs(page)).toBe(before);
    });

    await test.step('the ghost moves onto the placed block, and a left click breaks it', async () => {
      // Looking at the block from above: it is the target, and the new block would go on top.
      let aim = await aimAt(page, -0.5);
      await expect
        .poll(async () => (aim = await aimAt(page, -0.5)).on, { timeout: STATE_TIMEOUT })
        .toBe('block');
      expect(aim.target).toEqual(placed);
      expect(aim.place.y).toBeGreaterThanOrEqual(placed.y);
      expect(await read<{ target: boolean }>(page, 'build.ghost()')).toMatchObject({
        target: true,
      });
      await click(page, 'left');
      await expect.poll(() => blockAt(page, placed), { timeout: STATE_TIMEOUT }).toBe(0);
      expect(await read<unknown[]>(page, 'mp.rejections()')).toEqual([]);
    });

    await test.step('the number keys and the wheel choose the block', async () => {
      await page.keyboard.press('Digit3');
      await wait(page.locator('.ph-slot').nth(2)).toHaveAttribute('data-selected', '');
      await wait(page.locator('.ph-prompt')).toContainText('Advanced Alloy Block');
      await page.evaluate(() => {
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
      });
      await wait(page.locator('.ph-slot').nth(3)).toHaveAttribute('data-selected', '');
      await page.evaluate(() => {
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
      });
      await wait(page.locator('.ph-slot').nth(1)).toHaveAttribute('data-selected', '');
      await page.keyboard.press('Digit3');
      await expect
        .poll(async () => (await aimAt(page, -0.5)).placeRefusal, { timeout: STATE_TIMEOUT })
        .toBeNull();
      const aim = await aimAt(page, -0.5);
      await click(page, 'right');
      await expect.poll(() => blockAt(page, aim.place), { timeout: STATE_TIMEOUT }).toBe(ALLOY);
    });

    await test.step('a spot out of reach is refused on the screen and nothing is sent', async () => {
      // About seven blocks away across level ground: the cursor sees it, a click would not reach.
      const pitches = [-0.23, -0.22, -0.24, -0.21, -0.25];
      await expect
        .poll(
          async () => {
            for (const pitch of pitches) {
              const aim = await aimAt(page, pitch);
              if (aim.placeRefusal === 'out-of-reach') return aim.placeRefusal;
            }
            return null;
          },
          { timeout: STATE_TIMEOUT },
        )
        .toBe('out-of-reach');
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'blocked');
      await wait(page.locator('.ph-prompt')).toContainText('Out of reach');
      const events = await read<number>(page, 'mp.eventCount()');
      await click(page, 'right');
      await frames(page, 2);
      expect(await read<number>(page, 'mp.eventCount()')).toBe(events);
    });

    await test.step('B leaves Build Mode, and a right click still places a block', async () => {
      await page.keyboard.press('KeyB');
      await wait(page.locator('.ph-build-hint')).not.toHaveAttribute('data-active', '');
      await wait(page.locator('.status-mode')).toBeHidden();
      await expect
        .poll(async () => (await aimAt(page, -0.7)).placeRefusal, { timeout: STATE_TIMEOUT })
        .toBeNull();
      expect(await read<{ ghost: boolean }>(page, 'build.ghost()')).toMatchObject({ ghost: false });
      const aim = await aimAt(page, -0.7);
      await click(page, 'right');
      await expect.poll(() => blockAt(page, aim.place), { timeout: STATE_TIMEOUT }).toBe(ALLOY);
    });

    expect(problems).toEqual([]);
  });

  test('Q chooses a slab or a wedge, R turns it, and the ghost and the hotbar show the shape', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const problems = await open(page);
    await page.evaluate(({ x, z }) => {
      const game = window.__ashbound?.game;
      if (game) game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
    }, SPOT);
    await page.getByRole('button', { name: 'Play' }).click();
    await wait(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
    await page.waitForFunction(() => window.__ashbound?.game.player.onGround === true, null, {
      timeout: STATE_TIMEOUT,
    });
    await page.keyboard.press('KeyB');
    await wait(page.locator('.ph-prompt')).toContainText('Scrap Block');
    await read<void>(
      page,
      'Promise.all([game.world.view.structures.warmUp(), game.world.view.ghost.precompile()])',
    );
    const firstIcon = page.locator('.ph-slot').first().locator('.ph-slot-icon use');
    await wait(firstIcon).toHaveAttribute('href', '#ph-i-block-scrap');

    const settled = async (pitch: number, yaw = 0): Promise<Aim> => {
      let aim = await aimAt(page, pitch, yaw);
      await expect
        .poll(async () => (aim = await aimAt(page, pitch, yaw)).placeRefusal, {
          timeout: STATE_TIMEOUT,
        })
        .toBeNull();
      return aim;
    };

    await test.step('Q picks the slab: the hotbar, the caption and the ghost change to a slab', async () => {
      await page.keyboard.press('KeyQ');
      await wait(firstIcon).toHaveAttribute('href', '#ph-i-slab-scrap');
      await wait(page.locator('.ph-slot').nth(3).locator('.ph-slot-icon use')).toHaveAttribute(
        'href',
        '#ph-i-slab-energy',
      );
      await wait(page.locator('.ph-prompt')).toContainText('Scrap Slab');
      expect(await read<unknown>(page, 'build.hands()')).toMatchObject({ kind: 'slab', turn: 0 });
      // On the ground a slab goes in the half of its cell the ground leaves open, so either half will do here.
      const aim = await settled(-0.5);
      expect(shapeKind(stateShape(aim.state))).toBe('slab');
      expect(stateMaterial(aim.state)).toBe(MATERIAL.scrap);
      expect(await read<unknown>(page, 'build.ghost()')).toMatchObject({
        ghost: true,
        ghostShape: stateShape(aim.state),
      });
    });

    let slab = { cell: { x: 0, y: 0, z: 0 }, state: 0 };
    await test.step('a right click places the slab on the ground', async () => {
      const aim = await settled(-0.5);
      slab = { cell: { ...aim.place }, state: aim.state };
      await click(page, 'right');
      await expect
        .poll(() => blockAt(page, slab.cell), { timeout: STATE_TIMEOUT })
        .toBe(slab.state);
      expect(await read<unknown[]>(page, 'mp.rejections()')).toEqual([]);
    });

    await test.step('the cursor sees the slab where it is, and the outline is a slab', async () => {
      let aim = await aimAt(page, -0.5);
      await expect
        .poll(async () => (aim = await aimAt(page, -0.5)).on, { timeout: STATE_TIMEOUT })
        .toBe('block');
      expect(aim.target).toEqual(slab.cell);
      expect(aim.targetState).toBe(slab.state);
      expect(await read<unknown>(page, 'build.ghost()')).toMatchObject({
        target: true,
        targetShape: stateShape(slab.state),
      });
    });

    await test.step('R turns the slab over', async () => {
      const before = await settled(-0.5);
      await page.keyboard.press('KeyR');
      expect(await read<unknown>(page, 'build.hands()')).toMatchObject({ kind: 'slab', turn: 1 });
      const after = await settled(-0.5);
      const other =
        stateShape(before.state) === slabShape(false) ? slabShape(true) : slabShape(false);
      expect(stateShape(after.state)).toBe(other);
      await click(page, 'right');
      await expect
        .poll(() => blockAt(page, after.place), { timeout: STATE_TIMEOUT })
        .toBe(after.state);
    });

    await test.step('Q again picks the wedge, which rises away from where the player looks', async () => {
      await page.keyboard.press('KeyQ');
      await wait(firstIcon).toHaveAttribute('href', '#ph-i-wedge-scrap');
      await wait(page.locator('.ph-prompt')).toContainText('Scrap Wedge');
      // The turn starts over with a new shape.
      expect(await read<unknown>(page, 'build.hands()')).toMatchObject({ kind: 'wedge', turn: 0 });
      // Yaw 0 looks along -z, yaw -pi/2 along +x, yaw pi/2 along -x and yaw pi along +z. Each look
      // is at ground nothing has been built on yet.
      const south = await settled(-0.5, Math.PI);
      expect(wedgeFacing(stateShape(south.state))).toBe(1);
      expect(isUpsideDown(stateShape(south.state))).toBe(false);
      const east = await settled(-0.5, -Math.PI / 2);
      expect(wedgeFacing(stateShape(east.state))).toBe(0);
      expect(await read<unknown>(page, 'build.ghost()')).toMatchObject({
        ghost: true,
        ghostShape: wedgeShape(0),
      });
      await click(page, 'right');
      await expect
        .poll(() => blockAt(page, east.place), { timeout: STATE_TIMEOUT })
        .toBe(packState(wedgeShape(0), MATERIAL.scrap));
      // R turns it a quarter from the way the view would have it: looking west, that is -x, then -z.
      await page.keyboard.press('KeyR');
      const turned = await settled(-0.5, Math.PI / 2);
      expect(wedgeFacing(stateShape(turned.state))).toBe(3);
    });

    await test.step('Q cycles back to the block, which has only one way to lie', async () => {
      await page.keyboard.press('KeyQ');
      await wait(firstIcon).toHaveAttribute('href', '#ph-i-block-scrap');
      await wait(page.locator('.ph-prompt')).toContainText('Scrap Block');
      expect(await read<unknown>(page, 'build.hands()')).toMatchObject({ kind: 'cube', turn: 0 });
      await page.keyboard.press('KeyR');
      expect(await read<unknown>(page, 'build.hands()')).toMatchObject({ kind: 'cube', turn: 0 });
    });

    expect(problems).toEqual([]);
  });
});
