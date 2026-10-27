import { expect, test, type Page } from '@playwright/test';
import { PLAYER } from '../../src/shared/movement';
import { RESEARCH } from '../../src/systems/economy/balance';
import { needsResearch } from '../../src/systems/economy/build-rules';
import { TERMINAL_NEEDED } from '../../src/ui/research-hud';
import { recordToasts, toasts } from './support/toasts';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

const STATE_TIMEOUT = 60_000;
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the patience of `wait`: the HUD and the aim only change when a frame is drawn. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** The first morning with no waves and a pool that holds more than the Terminal costs. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&waves=0&stock=200';

/** A spot in the crash clearing, where the ground is open and gentle. */
const SPOT = { x: 8.5, z: -4.5 };
/** The module slot of the hotbar, counting from 0 (the key is the next number up). */
const MODULE_SLOT = 5;
/** The points each row of the ladder asks for: Composite, Alloy, Energy-Infused. */
const [COMPOSITE_AT, ALLOY_AT, ENERGY_AT] = RESEARCH.steps.map((step) => step.points) as [
  number,
  number,
  number,
];

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
const setResearch = (page: Page, points: number, claim: boolean): Promise<void> =>
  page.evaluate(([n, c]) => window.__ashbound!.mp!.setResearch(n as number, c as boolean), [
    points,
    claim,
  ] as const);
/** The hotbar slot, counting from 0. */
const slotAt = (page: Page, slot: number) => page.locator('.ph-slot').nth(slot);
/** The messages about research: the points, what they opened, and that a Terminal is missing. */
const researchToasts = async (page: Page): Promise<string[]> =>
  (await toasts(page)).filter(
    (text) => /^Research \+|unlocked$/.test(text) || text === TERMINAL_NEEDED,
  );

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

test.describe('the Research Terminal and the points it reads', () => {
  test('points the crew has earned wait for a Terminal: nothing opens until one stands, then the padlock goes for good, and E on the Terminal shows the ladder', async ({
    page,
  }, testInfo) => {
    // The first look at a ghost bakes the block tiles and compiles the shader, then each step waits for frames.
    test.setTimeout(300_000);
    const problems = await open(page);
    await recordToasts(page);
    await page.evaluate(({ x, z }) => {
      const game = window.__ashbound?.game;
      if (game) game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
    }, SPOT);
    await takeThePointer(page);
    await enterBuildMode(page);

    await test.step('points no Terminal has read open nothing: the pill turns amber and says so, the padlock stays, and the caption names the Terminal', async () => {
      await setResearch(page, COMPOSITE_AT, false);
      await poll(() => pool(page)).toMatchObject({
        research: COMPOSITE_AT,
        claimed: 0,
        tier: 1,
      });
      await poll(() => researchToasts(page)).toEqual([
        `Research +${COMPOSITE_AT}`,
        TERMINAL_NEEDED,
      ]);
      await wait(page.locator('.ph-research')).toHaveAttribute('data-tone', 'waiting');
      await expect(page.locator('.ph-research-label')).toHaveText('Needs Terminal');
      await expect(page.locator('.ph-research-value')).toHaveText(`${COMPOSITE_AT}/${ALLOY_AT}`);
      await wait(slotAt(page, 1)).toHaveAttribute('data-locked', '');
      await page.keyboard.press('Digit2');
      await wait(slotAt(page, 1)).toHaveAttribute('data-selected', '');
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBe(
        needsResearch('Reinforced Composite'),
      );
      await wait(page.locator('.ph-prompt')).toContainText(TERMINAL_NEEDED);
      await page.screenshot({ path: testInfo.outputPath('terminal-needed.png') });
    });

    let cell: Cell = { x: 0, y: 0, z: 0 };
    await test.step('a Terminal built in the valley reads them: the toast says what opened, the padlock goes and the pill turns back', async () => {
      await page.keyboard.press(`Digit${MODULE_SLOT + 1}`);
      await wait(slotAt(page, MODULE_SLOT)).toHaveAttribute('data-selected', '');
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBeNull();
      cell = (await aimAt(page, -0.5)).place;
      await click(page, 'right');
      await poll(() => read<number>(page, `mp.block(${cell.x}, ${cell.y}, ${cell.z})`)).not.toBe(0);
      await poll(() => pool(page)).toMatchObject({
        research: COMPOSITE_AT,
        claimed: COMPOSITE_AT,
        tier: 2,
      });
      await poll(() => researchToasts(page)).toEqual([
        `Research +${COMPOSITE_AT}`,
        TERMINAL_NEEDED,
        'Power unlocked',
        'Reinforced Composite unlocked',
      ]);
      await wait(slotAt(page, 1)).not.toHaveAttribute('data-locked', '');
      await wait(page.locator('.ph-research')).toHaveAttribute('data-tone', 'rising');
      await expect(page.locator('.ph-research-label')).toHaveText('Research');
      expect(await rejections(page)).toEqual([]);
    });

    await test.step('the cursor on the Terminal offers its ladder, E opens it beside the crosshair, and E shuts it again', async () => {
      await poll(async () => (await aimAtCell(page, cell)).on).toBe('block');
      await wait(page.locator('.ph-interact')).toBeVisible();
      await expect(page.locator('.ph-interact-label')).toHaveText('Research ladder');
      await expect(page.locator('.ph-interact-detail')).toHaveText(`${COMPOSITE_AT} points`);
      await expect(page.locator('.ph-ladder')).toBeHidden();

      await page.keyboard.press('KeyE');
      await wait(page.locator('.ph-ladder')).toBeVisible();
      await expect(page.locator('.ph-interact')).toBeHidden();
      await expect(page.locator('.ph-ladder-points')).toHaveText(String(COMPOSITE_AT));
      // Scrap, Power, Reinforced Composite, Advanced Alloy and Energy-Infused, in the order the points reach them.
      const rows = page.locator('.ph-ladder-row');
      await expect(rows).toHaveCount(5);
      await expect(rows.nth(0)).toHaveAttribute('data-state', 'open');
      await expect(rows.nth(1)).toHaveAttribute('data-state', 'open');
      await expect(rows.nth(2)).toHaveAttribute('data-state', 'open');
      await expect(rows.nth(3)).toHaveAttribute('data-state', 'shut');
      await expect(rows.nth(4)).toHaveAttribute('data-state', 'shut');
      await expect(rows.nth(3).locator('.ph-ladder-note')).toHaveText(
        `${ALLOY_AT - COMPOSITE_AT} to go`,
      );
      await expect(rows.nth(4).locator('.ph-ladder-note')).toHaveText(
        `${ENERGY_AT - COMPOSITE_AT} to go`,
      );
      await page.screenshot({ path: testInfo.outputPath('terminal-ladder.png') });

      await page.keyboard.press('KeyE');
      await wait(page.locator('.ph-ladder')).toBeHidden();
      await wait(page.locator('.ph-interact')).toBeVisible();
      // It asked the host for nothing.
      expect(await rejections(page)).toEqual([]);
    });

    await test.step('the ladder follows the points: more points move its bar and open its next row once the Terminal reads them', async () => {
      await page.keyboard.press('KeyE');
      await wait(page.locator('.ph-ladder')).toBeVisible();
      await setResearch(page, ALLOY_AT, false);
      await expect(page.locator('.ph-ladder-points')).toHaveText(String(ALLOY_AT));
      await expect(page.locator('.ph-ladder-row').nth(3)).toHaveAttribute('data-state', 'waiting');
      await expect(page.locator('.ph-ladder-row').nth(3).locator('.ph-ladder-note')).toHaveText(
        'Not read yet',
      );
      await setResearch(page, ALLOY_AT, true);
      await expect(page.locator('.ph-ladder-row').nth(3)).toHaveAttribute('data-state', 'open');
      await page.keyboard.press('KeyE');
      await wait(page.locator('.ph-ladder')).toBeHidden();
    });

    await test.step('breaking the Terminal takes nothing away: what it read stays open, and the ladder is shut', async () => {
      await page.keyboard.press('KeyE');
      await wait(page.locator('.ph-ladder')).toBeVisible();
      await click(page, 'left');
      await poll(() => read<number>(page, `mp.block(${cell.x}, ${cell.y}, ${cell.z})`)).toBe(0);
      await wait(page.locator('.ph-ladder')).toBeHidden();
      expect(await pool(page)).toMatchObject({ claimed: ALLOY_AT, tier: 3 });
      await expect(slotAt(page, 2)).not.toHaveAttribute('data-locked', '');
      expect(await rejections(page)).toEqual([]);
    });
    expect(problems).toEqual([]);
  });
});
