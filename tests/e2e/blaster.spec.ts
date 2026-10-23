import { expect, test, type Page } from '@playwright/test';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';
import { SHOT_FLAG } from '../../src/shared/shot';
import { BLASTER, VITALS } from '../../src/systems/survival/balance';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

const STATE_TIMEOUT = 60_000;
const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the patience of `wait`: the HUD and the light only change when a frame is drawn. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** Night 1, from its first second, so that the light is the one the machines come in. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&night=1';

/** A spot in the crash clearing, where the ground is open and gentle. */
const SPOT = { x: 8.5, z: -4.5 };

/** An Energy between two whole points, well off the full battery: the reading is rounded up, so this reads 51. */
const BATTERY = 50.5;

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

/** Reads a value off the running game, e.g. `read<number>(page, 'mp.vitals().energy')`. Needs `?debug`. */
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

/** A mouse button going down and up, the way the browser reports it. Chromium's own synthetic mouse adds stray movement under pointer lock, so the events are made in the page. */
const click = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const init = { button: 0, bubbles: true };
    window.dispatchEvent(new MouseEvent('mousedown', init));
    window.dispatchEvent(new MouseEvent('mouseup', init));
  });

interface Cell {
  x: number;
  y: number;
  z: number;
}

interface Shot {
  by: number;
  flags: number;
  x: number;
  y: number;
  z: number;
  predicted: boolean;
}

interface Hands {
  selected: number;
  crosshair: string;
  blaster: boolean;
  hits: number;
  kill: boolean;
}

interface Machine {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  health: number;
}

const shotsOf = (page: Page): Promise<Shot[]> => read<Shot[]>(page, 'mp.shots().shots');
const handsOf = (page: Page): Promise<Hands> => read<Hands>(page, 'build.hands()');
const machines = (page: Page): Promise<Machine[]> => read<Machine[]>(page, 'mp.enemies()');
const energy = (page: Page): Promise<number> => read<number>(page, 'mp.vitals().energy');

test.describe('the pulse blaster', () => {
  test('key 5 puts it in hand: the sight changes, a click fires instead of breaking, and a shot costs Energy', async ({
    page,
  }, testInfo) => {
    const problems = await open(page);
    await page.evaluate(({ x, z }) => {
      const game = window.__ashbound?.game;
      if (game) game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
    }, SPOT);
    await takeThePointer(page);
    await page.waitForFunction(() => window.__ashbound?.game.player.onGround === true, null, {
      timeout: STATE_TIMEOUT,
    });

    // A block three steps ahead (the view looks along -z), and the cursor on it.
    const cell = await page.evaluate(([state]) => window.__ashbound!.mp!.placeNear(0, -3, state!), [
      SCRAP,
    ] as const);
    await poll(() => read<number>(page, 'mp.blocks().count')).toBe(1);
    const aimAtBlock = async (): Promise<string> => {
      await page.evaluate((cell: Cell) => {
        const game = window.__ashbound!.game;
        const eye = game.player.y + 1.62;
        const along = Math.hypot(cell.x + 0.5 - game.player.x, cell.z + 0.5 - game.player.z);
        game.look.yaw = Math.atan2(
          -(cell.x + 0.5 - game.player.x),
          -(cell.z + 0.5 - game.player.z),
        );
        game.look.pitch = Math.atan2(cell.y + 0.5 - eye, along);
      }, cell);
      await frames(page);
      return read<string>(page, 'build.aim().on');
    };
    await poll(aimAtBlock).toBe('block');

    await test.step('with a block in hand the sight is the plain one, and the blaster is not armed', async () => {
      expect(await handsOf(page)).toMatchObject({ selected: 0, blaster: false });
      await wait(page.locator('.ph-crosshair')).not.toHaveAttribute('data-state', 'blaster');
    });

    await test.step('key 5 arms it: the slot, the sight and the caption say so', async () => {
      await page.keyboard.press('Digit5');
      await poll(() => handsOf(page)).toMatchObject({
        selected: 4,
        blaster: true,
        crosshair: 'blaster',
      });
      await wait(page.locator('.ph-slot').nth(4)).toHaveAttribute('data-selected', '');
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'blaster');
      await wait(page.locator('.ph-prompt-title')).toHaveText('Pulse Blaster');
      await wait(page.locator('.ph-prompt-detail')).toHaveText(
        `Uses ${VITALS.energy.perShot} Energy a shot`,
      );
    });

    // Energy reads in whole points, rounded up, so a shot of 0.6 shows only against a battery set
    // between two whole numbers: from 50.5 (reads 51) the shot leaves 49.9 (reads 50), and the idle
    // drain alone takes six seconds to do the same.
    await page.evaluate((points) => window.__ashbound!.mp!.setVitals({ energy: points }), BATTERY);
    const before = await energy(page);
    expect(before).toBe(Math.ceil(BATTERY));
    await test.step('a click fires it: a bolt is drawn at once, and the block is not broken', async () => {
      await poll(aimAtBlock).toBe('block');
      await click(page);
      // The bolt was drawn by the click, and the host (this very page, playing alone) answered
      // before the click returned: the shot is in the log twice, the drawing first.
      const shots = await shotsOf(page);
      expect(shots).toHaveLength(2);
      // It struck the block (a thing of the world, not a machine), as this screen drew it and as
      // the host says.
      expect(shots[0]).toMatchObject({ flags: SHOT_FLAG.world, predicted: true });
      expect(shots[1]).toMatchObject({ flags: SHOT_FLAG.world, predicted: false });
      expect(shots[0]?.y).toBeGreaterThan(cell.y - 0.01);
      expect(shots[0]?.y).toBeLessThan(cell.y + 1.01);
      // One bolt in the air, not two, and the block is still there.
      expect(await read<{ bolts: number }>(page, 'mp.shots().live')).toMatchObject({ bolts: 1 });
      expect(await read<number>(page, `mp.block(${cell.x}, ${cell.y}, ${cell.z})`)).not.toBe(0);
      expect(await read<number>(page, 'mp.blocks().count')).toBe(1);
    });

    await test.step('the host takes the shot out of Energy, and nothing much besides', async () => {
      // The reading is a whole point lower. A second point would be the idle drain of ten seconds.
      await poll(async () => before - (await energy(page))).toBe(
        Math.ceil(BATTERY) - Math.ceil(BATTERY - VITALS.energy.perShot),
      );
      await frames(page, 2);
      expect(problems).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('blaster-fired.png') });
    });

    await test.step('a block in hand breaks the block again', async () => {
      await page.keyboard.press('Digit1');
      await poll(() => handsOf(page)).toMatchObject({ selected: 0, blaster: false });
      await wait(page.locator('.ph-crosshair')).not.toHaveAttribute('data-state', 'blaster');
      await poll(aimAtBlock).toBe('block');
      await click(page);
      await poll(() => read<number>(page, 'mp.blocks().count')).toBe(0);
      // Breaking a block is not a shot.
      expect(await shotsOf(page)).toHaveLength(2);
    });
    expect(problems).toEqual([]);
  });

  test('three shots fell a crawler: it is hurt and gone, the burst is drawn, and the marker says it fell', async ({
    page,
  }, testInfo) => {
    const problems = await open(page);
    const core = await read<{ x: number; z: number }>(
      page,
      `(() => {
        const { x, z } = game.world.voxels.outpost;
        return { x, z };
      })()`,
    );
    // Ten blocks from a machine on open ground, as the pictures of the crawler have it. With the
    // pointer free the run is held, so the machine stands where it was put.
    const target = { x: core.x - 14, z: core.z - 4 };
    const stand = { x: core.x - 14, z: core.z + 8 };
    await page.evaluate(
      ({ stand, target }) => {
        const { game, mp } = window.__ashbound!;
        mp!.spawnCrawlerAt(target.x, target.z);
        game.teleport(stand.x, game.world.groundAt(stand.x, stand.z) + 0.05, stand.z, 0);
      },
      { stand, target },
    );
    await poll(async () => (await machines(page)).length).toBe(1);
    const fireAtIt = (): Promise<number | null> =>
      page.evaluate(() => window.__ashbound!.mp!.fireAtMachine());
    const standing = (await machines(page))[0] as Machine;
    const crawler = standing.id;
    await page.evaluate((points) => window.__ashbound!.mp!.setVitals({ energy: points }), BATTERY);
    const full = await energy(page);
    expect(full).toBe(Math.ceil(BATTERY));

    await test.step('the first shot hits it, as this screen drew it and as the host says', async () => {
      expect(await fireAtIt()).toBe(crawler);
      const [mine] = await shotsOf(page);
      expect(mine).toMatchObject({ flags: SHOT_FLAG.enemy, predicted: true });
      // The mark is on the machine: the front of its box, a little above the ground.
      expect(Math.hypot((mine?.x ?? 0) - standing.x, (mine?.z ?? 0) - standing.z)).toBeLessThan(1);
      expect(mine?.y).toBeGreaterThan(standing.y);
      expect(mine?.y).toBeLessThan(standing.y + 1);
      await poll(async () => (await shotsOf(page)).filter((s) => !s.predicted).length).toBe(1);
      expect((await shotsOf(page))[1]).toMatchObject({ flags: SHOT_FLAG.enemy });
      // Ten of its thirty points: a third gone.
      await poll(async () => (await machines(page))[0]?.health ?? 0).toBeCloseTo(
        1 - BLASTER.damage / 30,
        2,
      );
    });

    await test.step('the second, with the bank of two, takes another third', async () => {
      expect(await fireAtIt()).toBe(crawler);
      await poll(async () => (await machines(page))[0]?.health ?? 0).toBeCloseTo(
        1 - (2 * BLASTER.damage) / 30,
        2,
      );
      expect((await handsOf(page)).hits).toBe(2);
      expect((await handsOf(page)).kill).toBe(false);
    });

    await test.step('the third has to wait for the bank to fill, and then fells it', async () => {
      // The run is held, so the time it takes is played: half a second is more than the interval.
      await page.evaluate(() => window.__ashbound!.mp!.warp(0.5));
      expect(await fireAtIt()).toBe(crawler);
      await poll(async () => (await machines(page)).length).toBe(0);
      const felled = (await shotsOf(page)).filter((s) => (s.flags & SHOT_FLAG.kill) !== 0);
      expect(felled).toHaveLength(1);
      expect(felled[0]?.predicted).toBe(false);
      // The burst is drawn where it fell, and the marker is the hot one.
      await poll(() => read<number>(page, 'mp.shots().live.sparks')).toBeGreaterThan(0);
      await poll(() => handsOf(page)).toMatchObject({ hits: 3, kill: true });
      await wait(page.locator('.ph-hitmark')).toHaveAttribute('data-kill', '');
      await page.screenshot({ path: testInfo.outputPath('crawler-felled.png') });
    });

    await test.step('three shots cost three shots of Energy, and nothing else was hurt', async () => {
      // 50.5 less 1.8 is 48.7, which reads 49: two whole points. (The run is held, bar the half
      // second played above, so there is no idle drain to speak of; two shots would read 50 and
      // a shot charged twice would read 47.)
      const spent = full - (await energy(page));
      expect(spent).toBe(Math.ceil(BATTERY) - Math.ceil(BATTERY - 3 * VITALS.energy.perShot));
      expect(await read<number>(page, 'mp.vitals().health')).toBe(100);
      expect(
        (await read<{ coreHealth: number; coreMax: number }>(page, 'mp.clock()')).coreHealth,
      ).toBe((await read<{ coreMax: number }>(page, 'mp.clock()')).coreMax);
    });
    expect(problems).toEqual([]);
  });
});
