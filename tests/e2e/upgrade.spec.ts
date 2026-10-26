import { expect, test, type Page } from '@playwright/test';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';
import { PLAYER } from '../../src/shared/movement';
import { RESEARCH } from '../../src/systems/economy/balance';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

const STATE_TIMEOUT = 60_000;
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the patience of `wait`: the HUD and the aim only change when a frame is drawn. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** The first morning with no waves and a pool of 200 of every material: price is no object until a test makes it one. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&waves=0&stock=200';

/** A spot in the crash clearing, where the ground is open and gentle. */
const SPOT = { x: 8.5, z: -4.5 };
/** The points each row of the ladder asks for: Composite, Alloy, Energy-Infused. */
const [COMPOSITE_AT, ALLOY_AT, ENERGY_AT] = RESEARCH.steps.map((step) => step.points) as [
  number,
  number,
  number,
];

const cube = (material: number): number => packState(SHAPE.cube, material);
const SCRAP = cube(MATERIAL.scrap);
const COMPOSITE = cube(MATERIAL.composite);
const ALLOY = cube(MATERIAL.alloy);
const ENERGY = cube(MATERIAL.energy);

/** The pool's slot of a material, counting from 0 in the order of the materials. */
const slot = (material: number): number => material - 1;

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
  // The screen tells of points that arrive after its first look at the pool.
  await frames(page, 2);
  return problems;
}

/** Reads a value off the running game, e.g. `read<number>(page, 'mp.pool().research')`. Needs `?debug`. */
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
  targetState: number;
  hasPlace: boolean;
  place: Cell;
  state: number;
  placeRefusal: string | null;
}

interface Pool {
  stock: number[];
  cap: number;
  research: number;
  claimed: number;
  tier: number;
}

const pool = (page: Page): Promise<Pool> => read<Pool>(page, 'mp.pool()');
const rejections = async (page: Page): Promise<string[]> =>
  (await read<{ reason: string }[]>(page, 'mp.rejections()')).map((r) => r.reason);
const upgraded = (page: Page): Promise<number> => read<number>(page, 'mp.clock().upgraded');
const blockAt = (page: Page, cell: Cell): Promise<number> =>
  read<number>(page, `mp.block(${cell.x}, ${cell.y}, ${cell.z})`);
const setResearch = (page: Page, points: number): Promise<void> =>
  page.evaluate((n) => window.__ashbound!.mp!.setResearch(n, true), points);
const setPool = (page: Page, material: number, amount: number): Promise<void> =>
  page.evaluate(([m, n]) => window.__ashbound!.mp!.setPool(m!, n!), [material, amount] as const);

/** Looks along the given yaw and pitch (radians, negative is down) and returns what the cursor is on a frame later. */
async function aimAt(page: Page, pitch: number, yaw = 0): Promise<Aim> {
  await page.evaluate(
    ([nextPitch, nextYaw]) => {
      const game = window.__ashbound?.game;
      if (!game) return;
      game.look.yaw = nextYaw!;
      game.look.pitch = nextPitch!;
    },
    [pitch, yaw] as const,
  );
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

/** Places a block of the selected slot where the cursor meets the ground, and returns its cell once the host has built it. */
async function build(page: Page, pitch: number, yaw: number): Promise<Cell> {
  await poll(async () => (await aimAt(page, pitch, yaw)).placeRefusal).toBeNull();
  const { place } = await read<Aim>(page, 'build.aim()');
  await click(page, 'right');
  await poll(() => blockAt(page, place)).not.toBe(0);
  return place;
}

test.describe('upgrading a block in place', () => {
  test('E makes the block under the cursor one material better: the card says what and at what price, the host charges the one pool, and what is refused says why', async ({
    page,
  }, testInfo) => {
    // The first look at a ghost bakes the block tiles and compiles the shader, then each step waits for frames.
    test.setTimeout(420_000);
    const problems = await open(page);
    await page.evaluate(({ x, z }) => {
      const game = window.__ashbound?.game;
      if (game) game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
    }, SPOT);
    await takeThePointer(page);
    await enterBuildMode(page);

    // Scrap is in hand, and there is open ground ahead.
    await wait(page.locator('.ph-slot').nth(0)).toHaveAttribute('data-selected', '');
    const wall = await build(page, -0.5, 0);
    expect(await blockAt(page, wall)).toBe(SCRAP);
    const start = await pool(page);
    expect(start.tier).toBe(1);

    await test.step('a better material the crew has not researched shows in red with the points it asks for, and E turns it down without asking the host', async () => {
      await poll(async () => (await aimAtCell(page, wall)).on).toBe('block');
      await wait(page.locator('.ph-interact')).toBeVisible();
      await expect(page.locator('.ph-interact-label')).toHaveText(
        'Upgrade to Reinforced Composite',
      );
      await expect(page.locator('.ph-interact-detail')).toHaveText(
        `Needs research · 0 of ${COMPOSITE_AT}`,
      );
      await expect(page.locator('.ph-interact')).toHaveAttribute('data-tone', 'warn');
      await page.screenshot({ path: testInfo.outputPath('upgrade-locked.png') });

      await page.keyboard.press('KeyE');
      await wait(page.locator('.ph-prompt-detail')).toHaveText(
        'Reinforced Composite needs research',
      );
      // This screen knew: nothing went to the host, nothing changed, nothing was charged.
      await frames(page, 3);
      expect(await rejections(page)).toEqual([]);
      expect(await blockAt(page, wall)).toBe(SCRAP);
      expect((await pool(page)).stock).toEqual(start.stock);
      expect(await upgraded(page)).toBe(0);
    });

    await test.step('once the research is read the card shows the price, and E swaps the block for the next material, charging the better one and giving nothing back for the old', async () => {
      await setResearch(page, COMPOSITE_AT);
      await poll(async () => (await pool(page)).tier).toBe(2);
      await wait(page.locator('.ph-interact-detail')).toHaveText('Cost 1 Reinforced Composite');
      await expect(page.locator('.ph-interact')).toHaveAttribute('data-tone', 'info');
      await page.screenshot({ path: testInfo.outputPath('upgrade-card.png') });

      await page.keyboard.press('KeyE');
      await poll(() => blockAt(page, wall)).toBe(COMPOSITE);
      const after = await pool(page);
      expect(after.stock[slot(MATERIAL.composite)]).toBe(
        (start.stock[slot(MATERIAL.composite)] ?? 0) - 1,
      );
      // The block that was used up is not paid back, and the Scrap is as it was.
      expect(after.stock[slot(MATERIAL.scrap)]).toBe(start.stock[slot(MATERIAL.scrap)]);
      await poll(() => upgraded(page)).toBe(1);
      expect(await rejections(page)).toEqual([]);
      // Alloy is next, and shut.
      await wait(page.locator('.ph-interact-label')).toHaveText('Upgrade to Advanced Alloy');
      await expect(page.locator('.ph-interact-detail')).toHaveText(
        `Needs research · ${COMPOSITE_AT} of ${ALLOY_AT}`,
      );
    });

    await test.step('each press climbs one material, up to Energy-Infused, and then there is nothing better: no card, and E says so', async () => {
      await setResearch(page, ALLOY_AT);
      await wait(page.locator('.ph-interact-detail')).toHaveText('Cost 1 Advanced Alloy');
      await page.keyboard.press('KeyE');
      await poll(() => blockAt(page, wall)).toBe(ALLOY);
      await setResearch(page, ENERGY_AT);
      await wait(page.locator('.ph-interact-detail')).toHaveText('Cost 1 Energy-Infused');
      await page.keyboard.press('KeyE');
      await poll(() => blockAt(page, wall)).toBe(ENERGY);
      await poll(() => upgraded(page)).toBe(3);

      await wait(page.locator('.ph-interact')).toBeHidden();
      await page.keyboard.press('KeyE');
      await wait(page.locator('.ph-prompt-detail')).toHaveText('Already fully upgraded');
      await frames(page, 3);
      expect(await upgraded(page)).toBe(3);
      expect(await rejections(page)).toEqual([]);
    });

    let second: Cell = { x: 0, y: 0, z: 0 };
    await test.step('a pool that cannot pay shows the card in red with what is short, and E sends nothing', async () => {
      second = await build(page, -0.5, 0.6);
      expect(await blockAt(page, second)).toBe(SCRAP);
      await setPool(page, MATERIAL.composite, 0);
      await poll(async () => (await aimAtCell(page, second)).targetState).toBe(SCRAP);
      await wait(page.locator('.ph-interact-detail')).toHaveText('Not enough Reinforced Composite');
      await expect(page.locator('.ph-interact')).toHaveAttribute('data-tone', 'warn');
      await page.screenshot({ path: testInfo.outputPath('upgrade-short.png') });
      await page.keyboard.press('KeyE');
      await wait(page.locator('.ph-prompt-detail')).toHaveText('Not enough Reinforced Composite');
      await frames(page, 3);
      expect(await blockAt(page, second)).toBe(SCRAP);
      expect(await upgraded(page)).toBe(3);
      expect(await rejections(page)).toEqual([]);
    });

    await test.step('outside Build Mode E still works, and the card is only there while the upgrade would go', async () => {
      await page.keyboard.press('KeyB');
      await wait(page.locator('.status-mode')).toBeHidden();
      await poll(async () => (await aimAtCell(page, second)).on).toBe('block');
      // Nothing to spend: no card, no nagging.
      await frames(page, 3);
      await expect(page.locator('.ph-interact')).toBeHidden();
      await setPool(page, MATERIAL.composite, 5);
      await wait(page.locator('.ph-interact-label')).toHaveText('Upgrade to Reinforced Composite');
      await expect(page.locator('.ph-interact-detail')).toHaveText('Cost 1 Reinforced Composite');
      await page.keyboard.press('KeyE');
      await poll(() => blockAt(page, second)).toBe(COMPOSITE);
      await poll(() => upgraded(page)).toBe(4);
      expect((await pool(page)).stock[slot(MATERIAL.composite)]).toBe(4);
    });

    await test.step('the host turns away an upgrade of a block that is not the one the player saw', async () => {
      // This screen believed the cell held Scrap; it holds Composite now, so "the next one up" would be Alloy.
      await page.evaluate(({ x, y, z, shown }) => window.__ashbound!.mp!.upgrade(x, y, z, shown), {
        ...second,
        shown: COMPOSITE,
      });
      await poll(() => rejections(page)).toEqual(['that block has changed']);
      expect(await blockAt(page, second)).toBe(COMPOSITE);
      expect(await upgraded(page)).toBe(4);
    });

    await test.step('the results card counts the upgrades the crew made', async () => {
      await page.evaluate(() => window.__ashbound!.mp!.hurtCore(5000));
      await wait(page.locator('.run-results')).toBeVisible();
      const tile = page.locator('.run-results .stat', { hasText: 'Upgrades completed' });
      await expect(tile.locator('strong')).toHaveText('4');
      // The tile sits after "Blocks placed", and with the research tile there are seven.
      await expect(page.locator('.run-results .stats')).toHaveAttribute('data-tiles', '7');
      await page.screenshot({ path: testInfo.outputPath('upgrade-results.png') });
    });

    expect(problems).toEqual([]);
  });
});
