import { expect, test, type Page } from '@playwright/test';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';
import { poolSlot } from '../../src/shared/economy';
import { CYCLE_SECONDS, DAY_SECONDS } from '../../src/shared/daycycle';
import { DEBRIS, RESEARCH } from '../../src/systems/economy/balance';
import { needsResearch } from '../../src/systems/economy/build-rules';
import { recordToasts, toasts } from './support/toasts';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

const STATE_TIMEOUT = 60_000;
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the patience of `wait`: the HUD and the aim only change when a frame is drawn. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** The first morning with no waves: the points, the heaps and the pool are what is being looked at. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&waves=0';

const COMPOSITE = packState(SHAPE.cube, MATERIAL.composite);
const COMPOSITE_SLOT = poolSlot(MATERIAL.composite);
/** A spot in the crash clearing, where the ground is open and gentle. */
const SPOT = { x: 8.5, z: -4.5 };
/** The points each row of the ladder asks for: Composite, Alloy, Energy-Infused. */
const [COMPOSITE_AT, ALLOY_AT, ENERGY_AT] = RESEARCH.steps.map((step) => step.points) as [
  number,
  number,
  number,
];
/** What a night survived gives, with and without the bonus for a Core nothing touched. */
const NIGHT = RESEARCH.perNight;
const CLEAN_NIGHT = RESEARCH.perNight + RESEARCH.cleanNight;

/** `extra` adds switches to the page's address, such as `&night=6` for a run that starts at a later night. */
async function open(page: Page, extra = ''): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(`./${QUERY}${extra}`);
  await wait(page.locator('html')).toHaveAttribute('data-ready', 'true');
  // Playing together loads after the game is up, and the run lives in it.
  await page.waitForFunction(() => !!window.__ashbound?.mp, null, { timeout: STATE_TIMEOUT });
  // The run's heaps arrive with the run.
  await page.waitForFunction(() => (window.__ashbound?.mp?.heaps().length ?? 0) > 0, null, {
    timeout: STATE_TIMEOUT,
  });
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

interface Aim {
  hasPlace: boolean;
  place: { x: number; y: number; z: number };
  placeRefusal: string | null;
}

interface Heap {
  index: number;
  harvests: number;
  left: number;
  from: number;
  grade: number;
}

interface Pool {
  stock: number[];
  cap: number;
  research: number;
  tier: number;
}

const pool = (page: Page): Promise<Pool> => read<Pool>(page, 'mp.pool()');
const heaps = (page: Page): Promise<Heap[]> => read<Heap[]>(page, 'mp.heaps()');
const rejections = async (page: Page): Promise<string[]> =>
  (await read<{ reason: string }[]>(page, 'mp.rejections()')).map((r) => r.reason);
const eventCount = (page: Page): Promise<number> => read<number>(page, 'mp.eventCount()');
const setPool = (page: Page, material: number, amount: number): Promise<void> =>
  page.evaluate(([m, a]) => window.__ashbound!.mp!.setPool(m!, a!), [material, amount] as const);
const setResearch = (page: Page, points: number): Promise<void> =>
  page.evaluate((n) => window.__ashbound!.mp!.setResearch(n), points);
/** The hotbar slot, counting from 0. */
const slotAt = (page: Page, slot: number) => page.locator('.ph-slot').nth(slot);

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

/** Warps the run to half a minute into the given day: every night between now and then is lived through. */
const toDay = (page: Page, day: number): Promise<void> =>
  page.evaluate(
    (to) => {
      const mp = window.__ashbound!.mp!;
      mp.warp(to - mp.clock().elapsed);
    },
    CYCLE_SECONDS * (day - 1) + 30,
  );

test.describe('research', () => {
  test('the better materials wait behind a padlock and say how far away they are, and the points open them', async ({
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

    await test.step('a run opens with no points: three slots are padlocked, and there is no pill yet', async () => {
      expect(await pool(page)).toMatchObject({ research: 0, tier: 1 });
      for (const slot of [1, 2, 3]) {
        await wait(slotAt(page, slot)).toHaveAttribute('data-locked', '');
        await expect(slotAt(page, slot).locator('.ph-count')).toHaveText('');
        await expect(slotAt(page, slot).locator('.ph-slot-lock')).toBeVisible();
      }
      await expect(slotAt(page, 0)).not.toHaveAttribute('data-locked', '');
      await expect(page.locator('.ph-research')).toBeHidden();
    });

    await takeThePointer(page);
    await enterBuildMode(page);

    await test.step('in Build Mode the pill says how far the points are from the next row, and the caption how far the held material is', async () => {
      await wait(page.locator('.ph-research')).toBeVisible();
      await expect(page.locator('.ph-research-value')).toHaveText(`0/${COMPOSITE_AT}`);
      await page.keyboard.press('Digit2');
      await wait(slotAt(page, 1)).toHaveAttribute('data-selected', '');
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBe(
        needsResearch('Reinforced Composite'),
      );
      await wait(page.locator('.ph-crosshair')).toHaveAttribute('data-state', 'blocked');
      await wait(page.locator('.ph-prompt')).toContainText(`Needs research · 0 of ${COMPOSITE_AT}`);
      await page.screenshot({ path: testInfo.outputPath('research-locked.png') });
    });

    await test.step('a click sends nothing, and the host says the same if asked anyway, with the material in the pool', async () => {
      await setPool(page, MATERIAL.composite, 5);
      await poll(async () => (await pool(page)).stock[COMPOSITE_SLOT]).toBe(5);
      // A padlocked slot shows no count, however much the pool holds of it.
      await expect(slotAt(page, 1).locator('.ph-count')).toHaveText('');
      const events = await eventCount(page);
      await click(page, 'right');
      await frames(page, 2);
      expect(await eventCount(page)).toBe(events);
      expect(await rejections(page)).toEqual([]);
      await page.evaluate(([state]) => window.__ashbound!.mp!.placeNear(0, -3, state!), [
        COMPOSITE,
      ] as const);
      await poll(() => rejections(page)).toEqual([needsResearch('Reinforced Composite')]);
      expect((await pool(page)).stock[COMPOSITE_SLOT]).toBe(5);
    });

    await test.step('the points open Composite: the padlock goes, the pill and the toasts tell, and the block can be placed', async () => {
      await setResearch(page, COMPOSITE_AT);
      await poll(() => pool(page)).toMatchObject({ research: COMPOSITE_AT, tier: 2 });
      // The points first, then what they opened, each for its turn.
      await poll(async () =>
        (await toasts(page)).filter((text) => /^Research \+|unlocked$/.test(text)),
      ).toEqual([`Research +${COMPOSITE_AT}`, 'Reinforced Composite unlocked']);
      await wait(slotAt(page, 1)).not.toHaveAttribute('data-locked', '');
      await wait(slotAt(page, 1).locator('.ph-count')).toHaveText('5');
      await expect(page.locator('.ph-research-value')).toHaveText(`${COMPOSITE_AT}/${ALLOY_AT}`);
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBeNull();
      await wait(page.locator('.ph-prompt')).toContainText('Cost 1 Reinforced Composite');
      const aim = await aimAt(page, -0.5);
      await click(page, 'right');
      await poll(() =>
        read<number>(page, `mp.block(${aim.place.x}, ${aim.place.y}, ${aim.place.z})`),
      ).toBe(COMPOSITE);
      await poll(async () => (await pool(page)).stock[COMPOSITE_SLOT]).toBe(4);
      await page.screenshot({ path: testInfo.outputPath('research-opened.png') });
    });

    await test.step('Alloy still waits, and says how far away it is from where the points stand', async () => {
      await page.keyboard.press('Digit3');
      await wait(slotAt(page, 2)).toHaveAttribute('data-selected', '');
      await poll(async () => (await aimAt(page, -0.5)).placeRefusal).toBe(
        needsResearch('Advanced Alloy'),
      );
      await wait(page.locator('.ph-prompt')).toContainText(
        `Needs research · ${COMPOSITE_AT} of ${ALLOY_AT}`,
      );
      await wait(slotAt(page, 2)).toHaveAttribute('data-locked', '');
      await wait(slotAt(page, 3)).toHaveAttribute('data-locked', '');
    });

    await test.step('the top of the ladder fills the pill, and the last padlock goes', async () => {
      await setResearch(page, ENERGY_AT);
      await poll(() => pool(page)).toMatchObject({ research: ENERGY_AT, tier: 4 });
      await wait(slotAt(page, 2)).not.toHaveAttribute('data-locked', '');
      await wait(slotAt(page, 3)).not.toHaveAttribute('data-locked', '');
      await wait(page.locator('.ph-research')).toHaveAttribute('data-tone', 'full');
      await expect(page.locator('.ph-research-value')).toHaveText(String(ENERGY_AT));
    });
    expect(problems).toEqual([]);
  });

  test('a night survived earns points, two more for a Core nothing touched, and the dawn that reaches a row opens it', async ({
    page,
  }) => {
    const problems = await open(page);
    // The messages of a night (its fall, its dawn) come with the research's, each shown in turn.
    await recordToasts(page);

    await test.step('the first night, with the Core untouched, gives the whole award at its dawn and no sooner', async () => {
      expect((await pool(page)).research).toBe(0);
      await toDay(page, 2);
      await wait(page.locator('.ph-clock')).toContainText('Day 2');
      await poll(() => pool(page)).toMatchObject({ research: CLEAN_NIGHT, tier: 1 });
      await poll(() => toasts(page)).toContain(`Research +${CLEAN_NIGHT}`);
    });

    await test.step('a night the Core is hurt in gives the plain award, and the dawn that reaches 20 opens Composite', async () => {
      // Ten seconds into the second night, and a scratch on the Core.
      await page.evaluate(
        (to) => {
          const mp = window.__ashbound!.mp!;
          mp.warp(to - mp.clock().elapsed);
        },
        CYCLE_SECONDS + DAY_SECONDS + 10,
      );
      await wait(page.locator('.ph-clock')).toContainText('Night 2');
      await page.evaluate(() => window.__ashbound!.mp!.hurtCore(25));
      await toDay(page, 3);
      await wait(page.locator('.ph-clock')).toContainText('Day 3');
      await poll(() => pool(page)).toMatchObject({ research: CLEAN_NIGHT + NIGHT, tier: 2 });
      await poll(() => toasts(page)).toContain(`Research +${NIGHT}`);
      await poll(() => toasts(page)).toContain('Reinforced Composite unlocked');
    });

    await test.step('the card at the end of the run counts every point earned', async () => {
      await page.evaluate(() => window.__ashbound!.mp!.hurtCore(5000));
      await wait(page.locator('.run-results')).toBeVisible();
      const tile = page.locator('.run-results .stat', { hasText: 'Research earned' });
      await wait(tile.locator('strong')).toHaveText(String(CLEAN_NIGHT + NIGHT));
    });
    expect(problems).toEqual([]);
  });

  test('a run that starts at a later night has had the dawns before it, and a heap whose material is not researched waits for the dawn that has the points', async ({
    page,
  }) => {
    // Five nights behind it, with no bonus, is 50 points: Composite is open and Alloy is not.
    const problems = await open(page, '&night=6');
    const behind = 5 * NIGHT;
    expect(behind).toBeGreaterThanOrEqual(COMPOSITE_AT);
    expect(behind).toBeLessThan(ALLOY_AT);
    expect(await pool(page)).toMatchObject({ research: behind, tier: 2 });

    const composite = (list: Heap[]) => list.filter((h) => h.grade === MATERIAL.composite);
    const alloy = (list: Heap[]) => list.filter((h) => h.grade === MATERIAL.alloy);
    const grade = DEBRIS.grades.find((g) => g.material === MATERIAL.alloy)!;

    await test.step('the Composite heaps of the four dawns before it lie there, and the Alloy heap of the fifth does not', async () => {
      const list = await heaps(page);
      expect(
        composite(list)
          .filter((h) => h.left > 0)
          .map((h) => h.from),
      ).toEqual([2, 3, 4, 5]);
      // It is in the list (the field is drawn whole) but is not uncovered, so it has no strips to strip.
      expect(alloy(list).find((h) => h.from === grade.from)?.left).toBe(0);
      // And the picture draws what is there: Composite, no Alloy.
      await poll(async () =>
        (await read<{ grade: number }[]>(page, 'mp.heapsShown()')).some(
          (h) => h.grade === MATERIAL.composite,
        ),
      ).toBe(true);
      expect(
        (await read<{ grade: number }[]>(page, 'mp.heapsShown()')).some(
          (h) => h.grade === MATERIAL.alloy,
        ),
      ).toBe(false);
    });

    await test.step('the dawn of the night it starts in brings the points, and the Alloy heap that waited rises with that dawn’s own', async () => {
      await toDay(page, 7);
      await wait(page.locator('.ph-clock')).toContainText('Day 7');
      await poll(() => pool(page)).toMatchObject({ research: behind + CLEAN_NIGHT, tier: 3 });
      await poll(async () => {
        const list = await heaps(page);
        const waited = alloy(list).find((h) => h.from === grade.from);
        return waited ? waited.left === waited.harvests : false;
      }).toBe(true);
    });
    expect(problems).toEqual([]);
  });

  test('?research= opens the run with points, and the padlocks and the heaps follow', async ({
    page,
  }) => {
    const problems = await open(page, `&research=${ALLOY_AT}&night=6`);
    expect(await pool(page)).toMatchObject({ research: ALLOY_AT, tier: 3 });
    await wait(slotAt(page, 1)).not.toHaveAttribute('data-locked', '');
    await wait(slotAt(page, 2)).not.toHaveAttribute('data-locked', '');
    // Energy-Infused is another row up.
    await wait(slotAt(page, 3)).toHaveAttribute('data-locked', '');
    const list = await heaps(page);
    // Every Alloy heap of the dawns behind it is up, with Composite's.
    expect(list.filter((h) => h.grade === MATERIAL.alloy && h.left > 0).map((h) => h.from)).toEqual(
      [5],
    );
    expect(
      list.filter((h) => h.grade === MATERIAL.composite && h.left > 0).map((h) => h.from),
    ).toEqual([2, 3, 4, 5]);
    expect(problems).toEqual([]);
  });
});
