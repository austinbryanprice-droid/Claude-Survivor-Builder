import { expect, test, type Page } from '@playwright/test';
import { MATERIAL, MATERIALS, SHAPE, packState } from '../../src/shared/blocks';
import { ENEMY_KIND } from '../../src/shared/enemy-state';
import { poolSlot } from '../../src/shared/economy';
import { SHOT_FLAG } from '../../src/shared/shot';
import { BLASTER, ENEMIES } from '../../src/systems/survival/balance';
import { CORE_FOOTPRINT } from '../../src/world/outpost';
import { recordToasts, toasts } from './support/toasts';

// Software WebGL is slow, so these tests wait on game state rather than on time, and use a small
// window and the Low preset to go faster. With the pointer free the run is held, so the machines
// stand where they were put until the test plays the host's time (`warp`). The host breaks blocks
// only while the run is going, so the test takes the pointer for a few frames to let it.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 300_000 });

const STATE_TIMEOUT = 60_000;
const wait = expect.configure({ timeout: STATE_TIMEOUT });
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** Night 1, from its first second, with Scrap enough to put up a ring of walls. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&night=1&waves=0&stock=100';

const BREACHER = ENEMIES.breacher;
const BLAST = BREACHER.blast as NonNullable<typeof BREACHER.blast>;
/** Shots that fell a breacher: its health over the share of a hit it takes, over a hit. */
const SHOTS = Math.ceil(BREACHER.health / BREACHER.takes / BLASTER.damage);
const CELLS = BREACHER.drop?.amount ?? 0;
const ENERGY_NAME = MATERIALS.find((material) => material.id === MATERIAL.energy)?.name;
const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
/**
 * The ring of the crew's blocks round the Core stands this many cells off its walls, and is this
 * high. At three cells off, a blast at its wall is out of the Core's reach (the point it goes off at
 * is a little over two and three quarter blocks from the Core's walls, and the reach is two).
 */
const RING = 3;
const HEIGHT = 2;

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

/** Reads a value off the running game, e.g. `read<number>(page, 'mp.enemies().length')`. Needs `?debug`. */
const read = <T>(page: Page, expression: string): Promise<T> =>
  page.evaluate<T>(`(() => {
    const app = window.__ashbound;
    if (!app) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
    const { game, stage, mp, build } = app;
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

/**
 * The host's simulation watches the players, and breaks the blocks the machines have blown away,
 * only while the run is playing, and a run played alone is held while the pointer is free. So the
 * test takes the pointer for a few frames, which lets the simulation see the player where they
 * stand and do what was waiting, and lets it go again, so that the machines stand where they are
 * put and the test plays the host's time.
 */
async function beSeen(page: Page): Promise<void> {
  const running = async (): Promise<boolean> =>
    (await read<{ running: boolean }>(page, 'mp.clock()')).running;
  await page.getByRole('button', { name: 'Play' }).click();
  await wait(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked');
  await poll(running).toBe(true);
  await frames(page, 3);
  await page.evaluate(() => document.exitPointerLock());
  await wait(page.locator('#hud')).toHaveAttribute('data-pointer', 'free');
  await poll(running).toBe(false);
}

interface Machine {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  health: number;
}

interface Shot {
  by: number;
  flags: number;
  predicted: boolean;
}

interface Drawn {
  count: number;
  visible: boolean;
  shadows: boolean;
}

type Cell = [number, number, number];

const machines = (page: Page): Promise<Machine[]> => read<Machine[]>(page, 'mp.enemies()');
const shotsOf = (page: Page): Promise<Shot[]> => read<Shot[]>(page, 'mp.shots().shots');
const energyInPool = async (page: Page): Promise<number> =>
  (await read<{ stock: number[] }>(page, 'mp.pool()')).stock[poolSlot(MATERIAL.energy)] as number;
const reading = (page: Page): Promise<{ coreHealth: number; coreMax: number; felled: number }> =>
  read(page, 'mp.clock()');
/** What the instanced mesh of a kind of machine is drawing now, or null where the stage has no such mesh. */
const drawn = (page: Page, name: string): Promise<Drawn | null> =>
  read<Drawn | null>(
    page,
    `(() => {
      const mesh = stage.world.getObjectByName(${JSON.stringify(name)});
      return mesh
        ? { count: mesh.geometry.instanceCount, visible: mesh.visible, shadows: mesh.castShadow }
        : null;
    })()`,
  );
/** How far the first breacher drawn has built its charge, from 0 to 1 (the picture builds it up while the host says it is charging), or null where none is drawn. */
const charge = (page: Page): Promise<number | null> =>
  read<number | null>(
    page,
    `(() => {
      const mesh = stage.world.getObjectByName('breachers');
      return mesh && mesh.geometry.instanceCount > 0
        ? mesh.geometry.getAttribute('iState').array[2]
        : null;
    })()`,
  );

test.describe('the breacher', () => {
  test('is a machine of its own: it walks to the Core or the first wall on its way, stands still and charges, and goes off: a hole in the wall or the Core wounded, a player near it wounded, and nothing left; felled before that, it leaves its cells and does none of it', async ({
    page,
  }, testInfo) => {
    const problems = await open(page);
    await recordToasts(page);
    const core = await read<{ x: number; z: number; cellX: number; cellZ: number }>(
      page,
      `(() => {
        const { x, z, cellX, cellZ } = game.world.voxels.outpost;
        return { x, z, cellX, cellZ };
      })()`,
    );
    const cz = Math.floor(core.z);
    const groundAt = (x: number, z: number): Promise<number> =>
      read<number>(page, `game.world.groundAt(${x}, ${z})`);
    const teleport = async (x: number, z: number): Promise<void> => {
      await page.evaluate(
        ({ x, z }) => {
          const game = window.__ashbound!.game;
          game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
        },
        { x, z },
      );
      await frames(page, 2);
    };
    const put = (x: number, z: number, kind?: number): Promise<number | null> =>
      page.evaluate(({ x, z, kind }) => window.__ashbound!.mp!.spawnCrawlerAt(x, z, kind), {
        x,
        z,
        kind,
      });
    const clear = async (): Promise<void> => {
      await page.evaluate(() => window.__ashbound!.mp!.clearEnemies());
      await poll(async () => (await machines(page)).length).toBe(0);
    };
    const warp = (seconds: number): Promise<void> =>
      page.evaluate((seconds) => window.__ashbound!.mp!.warp(seconds), seconds);
    const health = (): Promise<number> => read<number>(page, 'mp.vitals().health');
    const fireAtIt = (): Promise<number | null> =>
      page.evaluate(() => window.__ashbound!.mp!.fireAtMachine());
    const blocksLeft = (): Promise<number> => read<number>(page, 'mp.blocks().count');
    /**
     * Plays the host's time and waits until the picture has caught up with it: the machine is where
     * it was in two looks a few frames apart. Resolves with where it is, or undefined once it is gone.
     */
    const play = async (seconds: number): Promise<Machine | undefined> => {
      await warp(seconds);
      let before = (await machines(page))[0];
      for (let look = 0; look < 60; look++) {
        await frames(page, 3);
        const now = (await machines(page))[0];
        if (
          !now ||
          !before ||
          (Math.abs(now.x - before.x) < 1e-4 && Math.abs(now.z - before.z) < 1e-4)
        ) {
          return now;
        }
        before = now;
      }
      throw new Error('the machine never settled where the host had put it');
    };

    // The pool opens with a stock of every material (the page was asked for one), Energy-Infused among them.
    const energyAtStart = await energyInPool(page);

    // A spot well away from the machines, and where a player stands near the Core.
    const away = { x: core.x - 14, z: core.z + 22 };
    const spot = { x: core.x - 14, z: core.z - 4 };
    const plain = { x: core.x - 19, z: core.z - 4 };
    await teleport(away.x, away.z);

    await test.step('a breacher and a crawler stand on the same open ground, each drawn by the mesh of its own kind, and the breacher is not charging', async () => {
      const ids = [await put(spot.x, spot.z, ENEMY_KIND.breacher), await put(plain.x, plain.z)];
      expect(ids.every((id) => id !== null)).toBe(true);
      await poll(async () => (await machines(page)).length).toBe(2);
      const here = await machines(page);
      expect(here.map((m) => m.kind).sort()).toEqual([ENEMY_KIND.crawler, ENEMY_KIND.breacher]);
      expect(here.every((m) => m.health === 1)).toBe(true);
      for (const m of here) expect(Math.abs(m.y - (await groundAt(m.x, m.z)))).toBeLessThan(0.2);
      await poll(() => drawn(page, 'breachers')).toEqual({
        count: 1,
        visible: true,
        shadows: true,
      });
      expect(await drawn(page, 'crawlers')).toEqual({ count: 1, visible: true, shadows: true });
      await frames(page, 2);
      expect(await charge(page)).toBe(0);
      expect(problems).toEqual([]);
    });

    await test.step('with the crawler gone the breacher stands alone, and the crawler’s mesh is put away', async () => {
      await clear();
      expect((await drawn(page, 'breachers'))?.visible).toBe(false);
      await put(spot.x, spot.z, ENEMY_KIND.breacher);
      await poll(async () => (await machines(page)).length).toBe(1);
      expect((await machines(page))[0]).toMatchObject({ kind: ENEMY_KIND.breacher, health: 1 });
      await poll(() => drawn(page, 'breachers')).toEqual({
        count: 1,
        visible: true,
        shadows: true,
      });
      expect((await drawn(page, 'crawlers'))?.visible).toBe(false);
      await page.screenshot({ path: testInfo.outputPath('breacher-standing.png') });
    });

    await test.step(`at the Core, with no wall in its way, it stands still and charges for ${BLAST.windup} seconds, then takes ${BLAST.core} points off the Core, wounds the player beside it by ${BLAST.player}, and is gone`, async () => {
      await clear();
      // The player stands a little behind the place it will stop at, which is where the Core is within
      // its reach: 1.4 blocks off the Core's walls, to the west of them.
      const stop = core.cellX - BREACHER.reach.core;
      const stand = { x: stop - 0.7, z: core.z + 1.2 };
      await teleport(stand.x, stand.z);
      await beSeen(page);
      const before = { core: (await reading(page)).coreHealth, me: await health() };
      expect(before.me).toBeGreaterThan(BLAST.player);
      expect(before.core).toBeGreaterThan(BLAST.core);
      expect(await put(core.cellX - 2.4, core.z, ENEMY_KIND.breacher)).not.toBeNull();
      await poll(async () => (await machines(page)).length).toBe(1);

      // It walks up to the Core and stops, still, with its charge building, and nothing has happened to anyone.
      let at = await play(0.25);
      for (let hop = 0; hop < 20 && at && (await charge(page)) === 0; hop++) at = await play(0.25);
      expect(at).toBeDefined();
      await poll(async () => (await charge(page)) ?? 0).toBeGreaterThan(0);
      expect(Math.abs((at as Machine).x - stop)).toBeLessThan(0.4);
      expect((await reading(page)).coreHealth).toBe(before.core);
      expect(await health()).toBe(before.me);
      await page.screenshot({ path: testInfo.outputPath('breacher-charging-at-the-core.png') });

      // Halfway through the charge it is where it was, still charging, and still no one is hurt.
      const stood = at as Machine;
      at = await play(BLAST.windup / 2);
      expect(at).toBeDefined();
      expect(Math.hypot((at as Machine).x - stood.x, (at as Machine).z - stood.z)).toBeLessThan(
        0.05,
      );
      expect(await charge(page)).toBeGreaterThan(0);
      expect((await reading(page)).coreHealth).toBe(before.core);
      expect(await health()).toBe(before.me);

      // The charge runs out, and it goes off.
      for (let hop = 0; hop < 20 && at; hop++) at = await play(0.25);
      expect(at).toBeUndefined();
      expect((await reading(page)).coreHealth).toBe(before.core - BLAST.core);
      expect(await health()).toBe(before.me - BLAST.player);
      // It was not felled, so it left nothing and the crew was told nothing.
      expect((await reading(page)).felled).toBe(0);
      expect(await energyInPool(page)).toBe(energyAtStart);
      expect((await toasts(page)).filter((t) => t.startsWith('A machine left'))).toEqual([]);
      expect((await drawn(page, 'breachers'))?.visible).toBe(false);
      await frames(page, 2);
      await page.screenshot({ path: testInfo.outputPath('breacher-went-off.png') });
    });

    await test.step('a ring of the crew’s blocks round the Core: it walks to the wall on its way, stands still facing it and charges, then blows a hole of the size of its blast in the wall, and nothing else is touched', async () => {
      await clear();
      // Raise the ring from inside it, a side at a time, standing a block and a half in from the middle
      // of each (a block is placed within six blocks of the eyes, measured to its middle).
      const lo = core.cellX - RING;
      const hi = core.cellX + CORE_FOOTPRINT - 1 + RING;
      const loZ = core.cellZ - RING;
      const hiZ = core.cellZ + CORE_FOOTPRINT - 1 + RING;
      const cells = await page.evaluate(
        ({ lo, hi, loZ, hiZ, height }) => {
          const { game } = window.__ashbound!;
          const ring: Cell[] = [];
          for (let x = lo; x <= hi; x++) {
            for (let z = loZ; z <= hiZ; z++) {
              if (x !== lo && x !== hi && z !== loZ && z !== hiZ) continue;
              const ground = Math.floor(game.world.groundAt(x + 0.5, z + 0.5));
              for (let y = ground; y < ground + height; y++) ring.push([x, y, z]);
            }
          }
          return ring;
        },
        { lo, hi, loZ, hiZ, height: HEIGHT },
      );
      const sides: { at: { x: number; z: number }; has: (cell: Cell) => boolean }[] = [
        { at: { x: lo + 1.5, z: core.z }, has: (c) => c[0] === lo },
        { at: { x: hi - 0.5, z: core.z }, has: (c) => c[0] === hi },
        { at: { x: core.x, z: loZ + 1.5 }, has: (c) => c[2] === loZ },
        { at: { x: core.x, z: hiZ - 0.5 }, has: (c) => c[2] === hiZ },
      ];
      const placed = new Set<string>();
      for (const side of sides) {
        await teleport(side.at.x, side.at.z);
        const mine = cells.filter((c) => side.has(c) && !placed.has(c.join()));
        for (const c of mine) placed.add(c.join());
        await page.evaluate(
          ({ mine, state }) => {
            const { mp } = window.__ashbound!;
            for (const [x, y, z] of mine) mp!.place(x, y, z, state);
          },
          { mine, state: SCRAP },
        );
        await poll(blocksLeft).toBe(placed.size);
      }
      expect(placed.size).toBe(cells.length);
      expect(await read<unknown[]>(page, 'mp.rejections()')).toEqual([]);
      const total = await blocksLeft();
      const stand = (await reading(page)).coreHealth;

      // Away from it, so that no player is near the blast, and a breacher 5.5 blocks off the wall on its west side.
      await teleport(away.x, away.z);
      await beSeen(page);
      const hurt = await health();
      const wall = lo;
      const from = { x: wall - 5.5, z: cz + 0.2 };
      expect(await put(from.x, from.z, ENEMY_KIND.breacher)).not.toBeNull();
      await poll(async () => (await machines(page)).length).toBe(1);

      // It comes up to the wall and stops there, still, charging: nothing is broken yet.
      let at = await play(1.5);
      for (let hop = 0; hop < 20 && at && (await charge(page)) === 0; hop++) at = await play(0.25);
      expect(at).toBeDefined();
      const standing = at as Machine;
      await poll(async () => (await charge(page)) ?? 0).toBeGreaterThan(0);
      // It stands within the reach of its chewing of the wall, facing it, and has not touched it.
      expect(wall - standing.x).toBeGreaterThan(0.3);
      expect(wall - standing.x).toBeLessThanOrEqual(ENEMIES.gnawReach + 0.1);
      expect(await blocksLeft()).toBe(total);
      await page.screenshot({ path: testInfo.outputPath('breacher-charging-at-the-wall.png') });

      // Halfway through the charge it has not moved and the wall is whole.
      at = await play(BLAST.windup / 2);
      expect(at).toBeDefined();
      expect(
        Math.hypot((at as Machine).x - standing.x, (at as Machine).z - standing.z),
      ).toBeLessThan(0.05);
      expect(await charge(page)).toBeGreaterThan(0);
      expect(await blocksLeft()).toBe(total);

      // The charge runs out and it goes off: it is gone, and the host breaks the blocks it blew away.
      for (let hop = 0; hop < 20 && at; hop++) at = await play(0.25);
      expect(at).toBeUndefined();
      await beSeen(page);
      await poll(blocksLeft).toBeLessThan(total);
      const states = await read<number[]>(
        page,
        `${JSON.stringify(cells)}.map(([x, y, z]) => mp.block(x, y, z))`,
      );
      const gone = cells.filter((_, i) => states[i] === 0);
      // Exactly the cells whose middles are within the blast's radius of the point it went off at (a
      // little leeway for the turn of its head), all in the face of the wall it stood at.
      const centre = {
        x: standing.x + BLAST.ahead,
        y: standing.y + BREACHER.height / 2,
        z: standing.z,
      };
      const near = (c: Cell, slack: number): boolean =>
        Math.hypot(c[0] + 0.5 - centre.x, c[1] + 0.5 - centre.y, c[2] + 0.5 - centre.z) <=
        BLAST.radius + slack;
      expect(gone.length).toBeGreaterThanOrEqual(3);
      expect(gone.every((c) => c[0] === wall && near(c, 0.4))).toBe(true);
      expect(cells.filter((c) => near(c, -0.4)).every((c) => gone.includes(c))).toBe(true);
      expect(await blocksLeft()).toBe(total - gone.length);
      // The Core was out of reach of it, and no one was near (the player may have mended a little since the last wound, never lost any).
      expect((await reading(page)).coreHealth).toBe(stand);
      expect(await health()).toBeGreaterThanOrEqual(hurt);
      expect((await reading(page)).felled).toBe(0);
      expect(await energyInPool(page)).toBe(energyAtStart);
      await frames(page, 2);
      await page.screenshot({ path: testInfo.outputPath('breacher-hole-in-the-wall.png') });
    });

    await test.step(`${SHOTS} shots fell it on its way to the wall, the cells it leaves are in the pool with a message, and the wall is as it was`, async () => {
      await clear();
      const total = await blocksLeft();
      // The player stands off to one side, within reach of the blaster of where the machine is put.
      const stand = { x: core.x - 22, z: core.z + 4 };
      await teleport(stand.x, stand.z);
      const held = energyAtStart;
      const told = (await toasts(page)).length;
      const id = await put(core.x - 28, core.z - 2, ENEMY_KIND.breacher);
      expect(id).not.toBeNull();
      await poll(async () => (await machines(page)).length).toBe(1);
      /** Plays the time it takes the blaster to be ready again, then fires. */
      const fireWhenReady = async (): Promise<number | null> => {
        await warp(BLASTER.interval + 0.05);
        return fireAtIt();
      };
      const share = (BLASTER.damage * BREACHER.takes) / BREACHER.health;
      expect(await fireAtIt()).toBe(id);
      await poll(async () => (await machines(page))[0]?.health ?? 0).toBeCloseTo(1 - share, 2);
      for (let shot = 2; shot < SHOTS; shot++) expect(await fireWhenReady()).toBe(id);
      expect(await fireWhenReady()).toBe(id);
      await poll(async () => (await machines(page)).length).toBe(0);
      const felled = (await shotsOf(page)).filter((s) => (s.flags & SHOT_FLAG.kill) !== 0);
      expect(felled).toHaveLength(1);
      expect(felled[0]?.predicted).toBe(false);
      expect(CELLS).toBeGreaterThan(0);
      await poll(() => energyInPool(page)).toBe(held + CELLS);
      await poll(() => toasts(page)).toContain(
        `A machine left ${CELLS} ${ENERGY_NAME} in the pool`,
      );
      expect((await toasts(page)).length).toBeGreaterThan(told);
      expect((await reading(page)).felled).toBe(1);
      // It went nowhere near a wall, and a felled machine does none of what it came to do: the ring is as it was.
      await beSeen(page);
      expect(await blocksLeft()).toBe(total);
      expect((await drawn(page, 'breachers'))?.visible).toBe(false);
      await frames(page, 2);
    });
    expect(problems).toEqual([]);
  });
});
