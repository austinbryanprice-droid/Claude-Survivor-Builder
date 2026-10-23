import { expect, test, type Page } from '@playwright/test';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';
import { MOVEMENT } from '../../src/shared/movement';
import { VITALS } from '../../src/systems/survival/balance';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 180_000 });

const STATE_TIMEOUT = 60_000;
const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the same patience as `wait`: the HUD only changes when a frame is drawn. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
const QUERY = '?debug&quality=low&freeze=1&stats=0';

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

/** Reads a value off the running game, e.g. `read<number>(page, 'mp.vitals().health')`. Needs `?debug`. */
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

/** Stops the page listening to the mouse and sets the view once, so a walk keeps its heading. */
async function holdTheView(page: Page, yaw: number): Promise<void> {
  await page.evaluate(
    (yaw) =>
      new Promise<void>((resolve) => {
        window.addEventListener('mousemove', (event) => event.stopImmediatePropagation(), true);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const look = window.__ashbound?.game.look;
            if (look) {
              look.yaw = yaw;
              look.pitch = 0;
            }
            resolve();
          }),
        );
      }),
    yaw,
  );
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

interface Reading {
  health: number;
  healthMax: number;
  energy: number;
  energyMax: number;
  charging: boolean;
  speedScale: number;
  handScale: number;
}

interface Core {
  cellX: number;
  cellZ: number;
  baseY: number;
  x: number;
  z: number;
}

const vitals = (page: Page): Promise<Reading> => read<Reading>(page, 'mp.vitals()');
const energyOf = (page: Page): Promise<number> => read<number>(page, 'mp.vitals().energy');
const healthOf = (page: Page): Promise<number> => read<number>(page, 'mp.vitals().health');
const hurt = (page: Page, amount: number): Promise<number> =>
  page.evaluate((n) => window.__ashbound?.mp?.hurtPlayer(n) ?? 0, amount);
const setVitals = (page: Page, values: { health?: number; energy?: number }): Promise<void> =>
  page.evaluate((v) => window.__ashbound?.mp?.setVitals(v), values);

/** How full each Health segment is drawn, in percent, left to right. */
const healthFills = (page: Page): Promise<number[]> =>
  page
    .locator('.ph-health .ph-fill')
    .evaluateAll((fills) => fills.map((fill) => parseFloat((fill as HTMLElement).style.width)));

/** How full the Energy bar is drawn, in percent. */
const energyFill = (page: Page): Promise<number> =>
  page.locator('.ph-energy-fill').evaluate((fill) => parseFloat((fill as HTMLElement).style.width));

const gameScale = (page: Page): Promise<number> => read<number>(page, 'game.speedScale');
const handScale = (page: Page): Promise<number> => read<number>(page, 'build.handScale()');

/** How fast the player is crossing the ground, in blocks a second. */
const pace = (page: Page): Promise<number> =>
  read<number>(page, 'Math.hypot(game.player.vx, game.player.vz)');

test.describe('Health and Energy', () => {
  test('the corner draws the Health and Energy the host keeps, and a wound flashes the bar and the screen edges', async ({
    page,
  }) => {
    const problems = await open(page);
    const health = page.locator('.ph-health');
    const edges = page.locator('.ph-hurt');

    await test.step('a new run starts with both bars full and no icons', async () => {
      expect(await vitals(page)).toMatchObject({
        health: VITALS.maxHealth,
        healthMax: VITALS.maxHealth,
        energy: VITALS.maxEnergy,
        energyMax: VITALS.maxEnergy,
        charging: false,
      });
      await wait(health).toHaveAttribute('data-tone', 'ok');
      await wait(page.locator('.ph-energy')).toHaveAttribute('data-tone', 'ok');
      await poll(() => healthFills(page)).toEqual([100, 100, 100]);
      await poll(() => energyFill(page)).toBe(100);
      await expect(page.locator('.ph-status-row')).toHaveCount(0);
      // Nothing has hurt anyone yet.
      await expect(health).not.toHaveAttribute('data-hit', /.*/);
    });

    await test.step('a wound takes its points off the segments, which empty from the right', async () => {
      expect(await hurt(page, 40)).toBe(40);
      expect(await healthOf(page)).toBe(60);
      await poll(() => healthFills(page)).toEqual([100, 80, 0]);
      await wait(health).toHaveAttribute('data-tone', 'ok');
    });

    await test.step('the bar and the screen edges flash, and a second wound flashes them again', async () => {
      await wait(health).toHaveAttribute('data-hit', '1');
      await wait(edges).toHaveAttribute('data-hit', '1');
      expect(await hurt(page, 15)).toBe(15);
      // The two flash animations take turns, because one that is already running cannot restart.
      await wait(health).toHaveAttribute('data-hit', '0');
      await wait(edges).toHaveAttribute('data-hit', '0');
    });

    await test.step('below a quarter the bar turns red', async () => {
      // A quarter itself is not yet low.
      expect(await hurt(page, 20)).toBe(20);
      expect(await healthOf(page)).toBe(25);
      await wait(health).toHaveAttribute('data-tone', 'ok');
      expect(await hurt(page, 10)).toBe(10);
      expect(await healthOf(page)).toBe(15);
      await wait(health).toHaveAttribute('data-tone', 'low');
      await poll(() => healthFills(page)).toEqual([45, 0, 0]);
    });

    await test.step('a blow cannot take more than is left, and the bar empties', async () => {
      expect(await hurt(page, 1000)).toBe(15);
      expect(await healthOf(page)).toBe(0);
      await poll(() => healthFills(page)).toEqual([0, 0, 0]);
    });

    expect(problems).toEqual([]);
  });

  test('Health mends by itself after a quiet spell, but only while there is Energy to mend with', async ({
    page,
  }) => {
    const problems = await open(page);
    const warp = (seconds: number) => page.evaluate((s) => window.__ashbound?.mp?.warp(s), seconds);

    expect(await hurt(page, 60)).toBe(60);
    expect(await healthOf(page)).toBe(40);

    await test.step('nothing mends before the delay is up', async () => {
      await warp(VITALS.regenDelay - 2);
      expect(await healthOf(page)).toBe(40);
    });

    await test.step('with no Energy left it does not mend at all', async () => {
      await setVitals(page, { energy: 0 });
      await warp(30);
      expect(await healthOf(page)).toBe(40);
    });

    await test.step('with some Energy it mends at its rate, and the bar follows', async () => {
      await setVitals(page, { energy: 80 });
      await warp(10);
      const mended = await healthOf(page);
      // Ten seconds at 1.5 a second, give or take the rounding of the readout.
      expect(mended).toBeGreaterThanOrEqual(40 + 10 * VITALS.regenPerSecond - 1);
      expect(mended).toBeLessThanOrEqual(40 + 10 * VITALS.regenPerSecond + 1);
      await poll(
        async () => (await healthFills(page)).reduce((sum, fill) => sum + fill, 0) / 3,
      ).toBeCloseTo(mended, 0);
    });

    expect(problems).toEqual([]);
  });

  test('Energy runs low in steps: the bar turns amber and an icon says so, then it is empty', async ({
    page,
  }) => {
    const problems = await open(page);
    const bar = page.locator('.ph-energy');
    const statuses = page.locator('.ph-status-label');
    const lowAt = Math.round(VITALS.maxEnergy * VITALS.energy.lowAt);

    await test.step('at the line itself nothing is slowed', async () => {
      await setVitals(page, { energy: lowAt });
      await wait(bar).toHaveAttribute('data-tone', 'ok');
      await poll(() => energyFill(page)).toBe(lowAt);
      await expect(page.locator('.ph-status-row')).toHaveCount(0);
      expect(await gameScale(page)).toBe(1);
      expect(await handScale(page)).toBe(1);
    });

    await test.step('a point below it the bar is amber, the legs and hands have started to slow', async () => {
      await setVitals(page, { energy: lowAt - 1 });
      await wait(bar).toHaveAttribute('data-tone', 'low');
      await wait(statuses).toHaveText('Low energy');
      await poll(() => gameScale(page)).toBeLessThan(1);
      expect(await gameScale(page)).toBeGreaterThan(0.95);
      expect(await handScale(page)).toBeLessThan(1);
    });

    await test.step('with none left it is as slow as it gets, and the bar says out', async () => {
      await setVitals(page, { energy: 0 });
      await wait(bar).toHaveAttribute('data-tone', 'empty');
      await wait(statuses).toHaveText('Out of energy');
      await poll(() => gameScale(page)).toBeCloseTo(VITALS.energy.emptySpeed, 5);
      await poll(() => handScale(page)).toBeCloseTo(VITALS.energy.emptyHands, 5);
      await poll(() => energyFill(page)).toBe(0);
    });

    await test.step('rested again, everything is back to normal', async () => {
      await setVitals(page, { energy: VITALS.maxEnergy });
      await wait(bar).toHaveAttribute('data-tone', 'ok');
      await expect(page.locator('.ph-status-row')).toHaveCount(0);
      await poll(() => gameScale(page)).toBe(1);
      await poll(() => handScale(page)).toBe(1);
      await poll(() => energyFill(page)).toBe(100);
    });

    expect(problems).toEqual([]);
  });

  test('worn out, the player walks slower than they do rested', async ({ page }) => {
    const problems = await open(page);
    // A floor of cubes on the gentle ground west of the crater, so the walk does not depend on the
    // shape of the ground, and 30 blocks from the Core, so its field does not refill the Energy.
    const floor = await read<{ x: number; y: number; z: number }>(
      page,
      `(() => {
        const voxels = game.world.voxels;
        let ground = 0;
        for (let x = -37; x < -26; x++) {
          for (let z = -2; z < 3; z++) ground = Math.max(ground, game.world.groundAt(x + 0.5, z + 0.5));
        }
        const y = Math.ceil(ground);
        for (let x = -37; x < -26; x++) {
          for (let z = -2; z < 3; z++) voxels.setBlock(x, y, z, ${SCRAP});
        }
        return { x: -36.5, y: y + 1.05, z: 0.5 };
      })()`,
    );
    await takeThePointer(page);
    await holdTheView(page, -Math.PI / 2);

    /** Starts at the floor's west end, walks east until two blocks along, and returns how fast it was going. */
    const walk = async (): Promise<number> => {
      await page.evaluate(
        ({ x, y, z }) => window.__ashbound?.game.teleport(x, y, z, -Math.PI / 2),
        floor,
      );
      await page.keyboard.down('KeyW');
      try {
        await page.waitForFunction(
          (startX) => {
            const player = window.__ashbound?.game.player;
            return !!player && player.onGround && player.x > startX + 2;
          },
          floor.x,
          { timeout: STATE_TIMEOUT },
        );
        return await pace(page);
      } finally {
        await page.keyboard.up('KeyW');
      }
    };

    const rested = await test.step('rested, the walk is at the normal pace', async () => {
      const speed = await walk();
      expect(speed).toBeCloseTo(MOVEMENT.walkSpeed, 1);
      return speed;
    });

    await test.step('with no Energy left it is at the slowest pace', async () => {
      await setVitals(page, { energy: 0 });
      await poll(() => gameScale(page)).toBeLessThan(1);
      const speed = await walk();
      expect((await vitals(page)).charging).toBe(false);
      expect(speed).toBeCloseTo(MOVEMENT.walkSpeed * VITALS.energy.emptySpeed, 1);
      expect(speed).toBeLessThan(rested * 0.7);
    });

    await test.step('and rested again it is back to the normal pace', async () => {
      await setVitals(page, { energy: VITALS.maxEnergy });
      await poll(() => gameScale(page)).toBe(1);
      expect(await walk()).toBeCloseTo(MOVEMENT.walkSpeed, 1);
    });

    expect(problems).toEqual([]);
  });

  test("the Core's charge field refills Energy and says so, and stops when the player walks out of it", async ({
    page,
  }) => {
    const problems = await open(page);
    const core = await read<Core>(
      page,
      `(() => {
        const { cellX, cellZ, baseY, x, z } = game.world.voxels.outpost;
        return { cellX, cellZ, baseY, x, z };
      })()`,
    );
    const teleport = (x: number, z: number): Promise<void> =>
      page.evaluate(
        ([tx, tz]) => {
          const game = window.__ashbound?.game;
          if (game) game.teleport(tx!, game.world.groundAt(tx!, tz!) + 0.05, tz!, 0);
        },
        [x, z] as const,
      );

    await test.step('far from the Core, Energy only drains', async () => {
      await takeThePointer(page);
      await setVitals(page, { energy: 30 });
      await teleport(core.x - 60, core.z);
      await frames(page, 3);
      expect((await vitals(page)).charging).toBe(false);
      await expect(page.locator('.ph-status-row')).toHaveCount(0);
    });

    await test.step('beside it the field charges, and the corner says Charging', async () => {
      await teleport(core.x - 5.5, core.z);
      await frames(page, 3);
      await poll(async () => (await vitals(page)).charging).toBe(true);
      await wait(page.locator('.ph-status-label')).toHaveText('Charging');
      await wait(page.locator('.ph-status').first()).toHaveAttribute('data-tone', 'good');
    });

    await test.step('Energy climbs, and with it the slow-down lifts', async () => {
      await poll(() => energyOf(page)).toBeGreaterThan(45);
      await wait(page.locator('.ph-energy')).toHaveAttribute('data-tone', 'ok');
      expect(await gameScale(page)).toBe(1);
    });

    await test.step('walking out of the field ends it', async () => {
      await teleport(core.x - 60, core.z);
      await frames(page, 3);
      await poll(async () => (await vitals(page)).charging).toBe(false);
      await expect(page.locator('.ph-status-row')).toHaveCount(0, { timeout: STATE_TIMEOUT });
    });

    expect(problems).toEqual([]);
  });

  test('building costs Energy for every block placed or broken, and a block the host refuses costs nothing', async ({
    page,
  }) => {
    const problems = await open(page);
    const core = await read<Core>(
      page,
      `(() => {
        const { cellX, cellZ, baseY, x, z } = game.world.voxels.outpost;
        return { cellX, cellZ, baseY, x, z };
      })()`,
    );
    // With the mouse free the run is held, so nothing but the building changes the bar.
    expect(await energyOf(page)).toBe(VITALS.maxEnergy);

    const cells: { x: number; y: number; z: number }[] = [];
    await test.step('eight blocks placed cost two points', async () => {
      for (const dz of [0, 1]) {
        for (const dx of [3, 4, 5, 6]) {
          cells.push(
            await page.evaluate(
              ([x, z, state]) => window.__ashbound!.mp!.placeNear(x!, z!, state!),
              [dx, dz, SCRAP] as const,
            ),
          );
        }
      }
      await poll(() => read<number>(page, 'mp.blocks().count')).toBe(8);
      expect(await energyOf(page)).toBe(VITALS.maxEnergy - 8 * VITALS.energy.perEdit);
      await poll(() => energyFill(page)).toBe(VITALS.maxEnergy - 2);
    });

    await test.step('breaking them costs the same again', async () => {
      for (const cell of cells) {
        await page.evaluate(([x, y, z]) => window.__ashbound!.mp!.breakBlock(x!, y!, z!), [
          cell.x,
          cell.y,
          cell.z,
        ] as const);
      }
      await poll(() => read<number>(page, 'mp.blocks().count')).toBe(0);
      expect(await energyOf(page)).toBe(VITALS.maxEnergy - 16 * VITALS.energy.perEdit);
      await poll(() => energyFill(page)).toBe(VITALS.maxEnergy - 4);
    });

    await test.step('a block the host turns down costs nothing', async () => {
      // The host measures reach from where the player last was, so stand beside the Core first.
      await page.evaluate(
        ({ x, z }) => {
          const game = window.__ashbound?.game;
          if (game) game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
        },
        { x: core.x - 5.5, z: core.z },
      );
      await frames(page, 3);
      await page.evaluate(([x, y, z, state]) => window.__ashbound!.mp!.place(x!, y!, z!, state!), [
        core.cellX + 1,
        core.baseY + 2,
        core.cellZ + 1,
        SCRAP,
      ] as const);
      await poll(() => read<{ reason: string }[]>(page, 'mp.rejections()')).toEqual([
        expect.objectContaining({ reason: 'reserved' }),
      ]);
      expect(await energyOf(page)).toBe(VITALS.maxEnergy - 16 * VITALS.energy.perEdit);
    });

    expect(problems).toEqual([]);
  });
});
