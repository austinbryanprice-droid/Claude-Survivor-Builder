import { expect, test, type Page } from '@playwright/test';
import {
  MATERIAL,
  MODULE,
  MODULES,
  SHAPE,
  moduleFacing,
  moduleShape,
  packState,
  stateShape,
} from '../../src/shared/blocks';
import { poolSlot } from '../../src/shared/economy';
import { PLAYER } from '../../src/shared/movement';
import { NO_PLAYER } from '../../src/shared/protocol';
import { SHOT_FLAG } from '../../src/shared/shot';
import { notEnough } from '../../src/systems/economy/build-rules';
import { ENEMIES, TURRET } from '../../src/systems/survival/balance';
import { barrelOf, sendCrawlerNear, type Cell } from './support/turrets';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

const STATE_TIMEOUT = 60_000;
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the patience of `wait`: the HUD and the aim only change when a frame is drawn. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** Night 1 from its first second, with no waves: the only machine is the one the test sends. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&night=1&waves=0';

/** A spot in the crash clearing, where the ground is open and gentle. */
const SPOT = { x: 8.5, z: -4.5 };
const SCRAP_SLOT = poolSlot(MATERIAL.scrap);
/** The module slot of the hotbar, counting from 0 (the key is the next number up). */
const MODULE_SLOT = 5;
const TURRET_DEF = MODULES.find((module) => module.id === MODULE.turret)!;
const PRICE = TURRET_DEF.cost.amount;

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

interface Shot {
  by: number;
  flags: number;
  x: number;
  y: number;
  z: number;
  predicted: boolean;
  turret?: [number, number, number];
}

interface Machine {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  health: number;
}

const scrap = async (page: Page): Promise<number> =>
  (await read<{ stock: number[] }>(page, 'mp.pool()')).stock[SCRAP_SLOT] ?? -1;
const drawn = (page: Page): Promise<number> => read<number>(page, 'game.world.view.modules.count');
const rejections = async (page: Page): Promise<string[]> =>
  (await read<{ reason: string }[]>(page, 'mp.rejections()')).map((r) => r.reason);
const shotsOf = (page: Page): Promise<Shot[]> => read<Shot[]>(page, 'mp.shots().shots');
const machines = (page: Page): Promise<Machine[]> => read<Machine[]>(page, 'mp.enemies()');
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

/** Goes into Build Mode and waits for the first block's tiles and shader, which the first look at a ghost costs seconds of. */
async function enterBuildMode(page: Page): Promise<void> {
  await page.keyboard.press('KeyB');
  await wait(page.locator('.status-mode')).toBeVisible();
  await read<void>(
    page,
    'Promise.all([game.world.view.structures.warmUp(), game.world.view.ghost.precompile()])',
  );
}

test.describe('the Basic Turret', () => {
  test('is built from the module slot with Q: the caption names it and its price, a click stands it on the ground, and breaking it gives the price back', async ({
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
    await setScrap(page, PRICE - 1);
    await poll(() => scrap(page)).toBe(PRICE - 1);
    await enterBuildMode(page);

    await test.step('the module slot holds the Terminal first, and Q picks the turret: its icon, its name and its price', async () => {
      await page.keyboard.press(`Digit${MODULE_SLOT + 1}`);
      await wait(page.locator('.ph-slot').nth(MODULE_SLOT)).toHaveAttribute('data-selected', '');
      await wait(page.locator('.ph-prompt')).toContainText('Research Terminal');
      await page.keyboard.press('KeyQ');
      await wait(
        page.locator('.ph-slot').nth(MODULE_SLOT).locator('.ph-slot-icon use'),
      ).toHaveAttribute('href', '#ph-i-turret');
      await wait(page.locator('.ph-prompt')).toContainText(TURRET_DEF.name);
      // A pool one short of the price turns the ghost red.
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBe(notEnough('Scrap'));
      await wait(page.locator('.ph-prompt')).toContainText('Not enough Scrap');
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'blocked');
      const aim = await aimAt(page, -0.5);
      expect(stateShape(aim.state)).toBeGreaterThanOrEqual(SHAPE.module);
      await poll(async () => (await read<Ghost>(page, 'build.ghost()')).ghost).toBe(true);
      expect((await read<Ghost>(page, 'build.ghost()')).ghostShape).toBe(stateShape(aim.state));
    });

    await test.step('with the price in the pool the caption gives it, and the barrel points the way the player looks', async () => {
      await setScrap(page, 100);
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBeNull();
      await wait(page.locator('.ph-prompt')).toContainText(`Cost ${PRICE} Scrap`);
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'place');
      const aim = await aimAt(page, -0.5);
      // The player looks toward -z (yaw 0), and the gun points the same way: facing 3.
      expect(moduleFacing(stateShape(aim.state))).toBe(3);
      expect(aim.state).toBe(packState(moduleShape(MODULE.turret, 3), 1));
      await page.screenshot({ path: testInfo.outputPath('turret-ghost.png') });
    });

    const aim = await aimAt(page, -0.5);
    await test.step('a click puts it in the world, takes the price from the pool, and draws it with its head', async () => {
      await click(page, 'right');
      await poll(() =>
        read<number>(page, `mp.block(${aim.place.x}, ${aim.place.y}, ${aim.place.z})`),
      ).toBe(aim.state);
      await poll(() => scrap(page)).toBe(100 - PRICE);
      await poll(() => drawn(page)).toBe(1);
      const parts = await read<{ module: number; level: number; head: boolean; heads: number }>(
        page,
        `(() => {
          const group = game.world.view.modules.at(${aim.place.x}, ${aim.place.y}, ${aim.place.z});
          return {
            ...group.userData,
            head: !!group.getObjectByName('head'),
            heads: group.children.filter((child) => child.name === 'head').length,
          };
        })()`,
      );
      expect(parts).toEqual({ module: MODULE.turret, level: 1, head: true, heads: 1 });
      expect(await rejections(page)).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('turret-placed.png') });
    });

    await test.step('a left click on its body breaks it and gives the price back', async () => {
      await page.evaluate(
        ({ cell, eyeHeight }) => {
          const game = window.__ashbound!.game;
          const dx = cell.x + 0.5 - game.player.x;
          const dz = cell.z + 0.5 - game.player.z;
          game.look.yaw = Math.atan2(-dx, -dz);
          game.look.pitch = Math.atan2(
            cell.y + 0.45 - (game.player.y + eyeHeight),
            Math.hypot(dx, dz),
          );
        },
        { cell: aim.place, eyeHeight: PLAYER.eyeHeight },
      );
      await frames(page, 2);
      await poll(async () => (await read<Aim>(page, 'build.aim()')).on).toBe('block');
      await click(page, 'left');
      await poll(() =>
        read<number>(page, `mp.block(${aim.place.x}, ${aim.place.y}, ${aim.place.z})`),
      ).toBe(0);
      await poll(() => scrap(page)).toBe(100);
      await poll(() => drawn(page)).toBe(0);
      expect(await rejections(page)).toEqual([]);
    });
    expect(problems).toEqual([]);
  });

  test('shoots the machine it has a clear line to with an amber bolt from its barrel, turns its head to it, and fells it, with nobody at the trigger', async ({
    page,
  }, testInfo) => {
    const problems = await open(page);
    await page.evaluate(({ x, z }) => {
      const game = window.__ashbound?.game;
      if (game) game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
    }, SPOT);
    await takeThePointer(page);
    await setScrap(page, 100);
    await poll(() => scrap(page)).toBe(100);

    // The turret is built by the host's rules, three cells from the player, facing +x.
    const state = packState(moduleShape(MODULE.turret, 0), 1);
    const cell = await page.evaluate(([s]) => window.__ashbound!.mp!.placeNear(3, 0, s!), [
      state,
    ] as const);
    await poll(() => scrap(page)).toBe(100 - PRICE);
    await poll(() => drawn(page)).toBe(1);
    await poll(() => read<number>(page, `mp.block(${cell.x}, ${cell.y}, ${cell.z})`)).toBe(state);

    await test.step('with no machine in range it holds its fire, and its head is at rest facing the way the turret does', async () => {
      await frames(page, 3);
      expect((await shotsOf(page)).filter((shot) => shot.turret)).toEqual([]);
      const rest = await read<number[]>(
        page,
        `(() => {
          const head = game.world.view.modules.at(${cell.x}, ${cell.y}, ${cell.z}).getObjectByName('head');
          return head.rotation.toArray().slice(0, 3);
        })()`,
      );
      expect(rest).toEqual([0, 0, 0]);
    });

    const crawler = await sendCrawlerNear(page, cell);
    expect(crawler).not.toBeNull();

    await test.step('it fires at the machine: a shot named for its cell and no player, struck home', async () => {
      await poll(
        async () => (await shotsOf(page)).filter((shot) => shot.turret).length,
      ).toBeGreaterThan(0);
      const first = (await shotsOf(page)).find((shot) => shot.turret) as Shot;
      expect(first.turret).toEqual([cell.x, cell.y, cell.z]);
      expect(first.by).toBe(NO_PLAYER);
      expect(first.predicted).toBe(false);
      expect(first.flags & SHOT_FLAG.enemy).toBe(SHOT_FLAG.enemy);
    });

    await test.step('the barrel points where the bolt leaves it, whatever way the head had to turn', async () => {
      const seen = await barrelOf(page, cell);
      expect(seen).not.toBeNull();
      const { tip, want, turned } = seen!;
      for (let i = 0; i < 3; i++) expect(tip[i]!, `axis ${i}`).toBeCloseTo(want[i]!, 4);
      expect(turned[0]! !== 0 || turned[1]! !== 0).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('turret-firing.png') });
    });

    await test.step('it keeps firing at its own pace until the machine falls, and the kill is reported', async () => {
      await poll(async () => (await machines(page)).length).toBe(0);
      const shots = (await shotsOf(page)).filter((shot) => shot.turret);
      expect(shots.length).toBeGreaterThanOrEqual(
        Math.ceil(ENEMIES.crawler.health / TURRET.levels[0]!.damage),
      );
      expect(shots.filter((shot) => shot.flags & SHOT_FLAG.kill)).toHaveLength(1);
      expect(shots[shots.length - 1]!.flags & SHOT_FLAG.kill).toBe(SHOT_FLAG.kill);
    });

    await test.step('and with the machine gone it falls quiet, the head where it last pointed', async () => {
      const count = (await shotsOf(page)).filter((shot) => shot.turret).length;
      await frames(page, 4);
      expect((await shotsOf(page)).filter((shot) => shot.turret)).toHaveLength(count);
      const seen = await barrelOf(page, cell);
      for (let i = 0; i < 3; i++) expect(seen!.tip[i]!).toBeCloseTo(seen!.want[i]!, 4);
    });

    expect(await rejections(page)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('breaking the turret stops its fire, and the host turns a turret down that the table has no level for', async ({
    page,
  }) => {
    const problems = await open(page);
    await page.evaluate(({ x, z }) => {
      const game = window.__ashbound?.game;
      if (game) game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
    }, SPOT);
    await takeThePointer(page);
    await setScrap(page, 100);
    await poll(() => scrap(page)).toBe(100);

    // A level the table has no turret for is not a piece.
    await page.evaluate(([s]) => window.__ashbound!.mp!.placeNear(-3, 0, s!), [
      packState(moduleShape(MODULE.turret, 0), 2),
    ] as const);
    await poll(() => rejections(page)).toEqual(['unknown-block']);
    expect(await scrap(page)).toBe(100);

    const state = packState(moduleShape(MODULE.turret, 0), 1);
    const cell = await page.evaluate(([s]) => window.__ashbound!.mp!.placeNear(3, 0, s!), [
      state,
    ] as const);
    await poll(() => drawn(page)).toBe(1);
    await sendCrawlerNear(page, cell);
    await poll(
      async () => (await shotsOf(page)).filter((shot) => shot.turret).length,
    ).toBeGreaterThan(0);

    // Take the turret away: the machine lives on, and nothing more is fired.
    await page.evaluate(([x, y, z]) => window.__ashbound!.mp!.breakBlock(x!, y!, z!), [
      cell.x,
      cell.y,
      cell.z,
    ] as const);
    await poll(() => drawn(page)).toBe(0);
    await poll(() => scrap(page)).toBe(100);
    await frames(page, 2);
    const fired = (await shotsOf(page)).filter((shot) => shot.turret).length;
    await frames(page, 6);
    expect((await shotsOf(page)).filter((shot) => shot.turret)).toHaveLength(fired);
    expect(problems).toEqual([]);
  });
});
