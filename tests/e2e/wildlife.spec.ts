import { expect, test, type Page } from '@playwright/test';
import { SHOT_FLAG } from '../../src/shared/shot';
import { WILD_FLAG, WILD_SPECIES } from '../../src/shared/wildlife-state';
import { SPECIES } from '../../src/systems/wildlife/balance';

// Software WebGL is slow, so this test waits on game state rather than on time, and uses a small
// window and the Low preset to go faster. The run is held (the mouse is never captured), so the
// creatures stand where they were put until the test plays some seconds of the run at a time.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 300_000 });

const STATE_TIMEOUT = 60_000;
const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** `expect.poll` with the patience of `wait`: the game only changes when a frame is drawn. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });
/** Daytime with no waves, and the wildlife switched on: a scripted browser keeps it off unless asked. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&waves=0&wildlife=on';

const LAND = [WILD_SPECIES.stag, WILD_SPECIES.hare, WILD_SPECIES.mossback];
const WATER = [WILD_SPECIES.shoal, WILD_SPECIES.ray, WILD_SPECIES.jelly];
const AIR = [WILD_SPECIES.finch, WILD_SPECIES.kite];

interface Creature {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  health: number;
  flags: number;
  yaw: number;
  speed: number;
}

interface Shot {
  flags: number;
  predicted: boolean;
}

async function open(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(`./${QUERY}`);
  await wait(page.locator('html')).toHaveAttribute('data-ready', 'true');
  // Playing together loads after the game is up, and the run (and its creatures) live in it.
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

const creatures = (page: Page): Promise<Creature[]> => read<Creature[]>(page, 'mp.wildlife()');
const creature = async (page: Page, id: number): Promise<Creature | undefined> =>
  (await creatures(page)).find((c) => c.id === id);
const health = (page: Page): Promise<number> => read<number>(page, 'mp.vitals().health');
const shotsOf = (page: Page): Promise<Shot[]> => read<Shot[]>(page, 'mp.shots().shots');

/** Plays this many seconds of the run at once, after telling it where the player stands (a held run does not look). */
const play = (page: Page, seconds: number): Promise<void> =>
  page.evaluate((s) => {
    const mp = window.__ashbound!.mp!;
    mp.observeSelf();
    mp.warp(s);
  }, seconds);

/** Puts one creature at a spot and waits until this screen draws it. */
async function put(page: Page, species: number, x: number, z: number): Promise<number> {
  const id = await page.evaluate(
    ([kind, px, pz]) => window.__ashbound!.mp!.spawnCreature(kind!, px!, pz!),
    [species, x, z] as const,
  );
  expect(id, `room for species ${species} at ${x}, ${z}`).not.toBeNull();
  await poll(async () => (await creature(page, id as number)) !== undefined).toBe(true);
  return id as number;
}

const distance = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

test.describe('the wildlife', () => {
  test('roams the land, the water and the air, ignores the ones who leave it be, and fights back (a little) only against the one who struck it', async ({
    page,
  }, testInfo) => {
    const problems = await open(page);

    await test.step('the valley starts with creatures of every realm, drawn without a shader error', async () => {
      await poll(async () => {
        const kinds = new Set((await creatures(page)).map((c) => c.kind));
        return [LAND, WATER, AIR].map((realm) => realm.some((species) => kinds.has(species)));
      }).toEqual([true, true, true]);
      // The drawing can run its shaders only once something is on screen: a frame with creatures in it has been drawn.
      await frames(page, 2);
      expect(problems).toEqual([]);
    });

    const outpost = await read<{ x: number; z: number }>(
      page,
      `(() => {
        const { x, z } = game.world.voxels.outpost;
        return { x, z };
      })()`,
    );
    // Open ground west of the Core, as the pictures of the machines have it.
    const stand = { x: outpost.x - 14, z: outpost.z + 2 };
    await page.evaluate(({ x, z }) => {
      const { game, mp } = window.__ashbound!;
      mp!.clearWildlife();
      game.teleport(x, game.world.groundAt(x, z) + 0.05, z, Math.PI);
    }, stand);
    await page.waitForFunction(() => window.__ashbound?.game.player.onGround === true, null, {
      timeout: STATE_TIMEOUT,
    });
    expect(await health(page)).toBe(100);

    await test.step('creatures that nobody has struck stay calm beside the player, and none of them hurts anyone', async () => {
      // A mossback five blocks off, a kite over it, and a hare inside its shyness.
      const mossback = await put(page, WILD_SPECIES.mossback, stand.x, stand.z - 5);
      const kite = await put(page, WILD_SPECIES.kite, stand.x + 6, stand.z - 6);
      const hare = await put(page, WILD_SPECIES.hare, stand.x + 4, stand.z + 4);
      await play(page, 6);
      // The hare, which is shy, has put some distance between them: the screen has caught up with the six seconds.
      await poll(async () =>
        distance((await creature(page, hare)) as Creature, stand),
      ).toBeGreaterThan(Math.hypot(4, 4) + 2);
      const fighting = WILD_FLAG.angry | WILD_FLAG.strike;
      for (const id of [mossback, kite, hare]) {
        expect(((await creature(page, id))?.flags ?? 0) & fighting, `creature ${id}`).toBe(0);
      }
      expect(await health(page)).toBe(100);
      expect(await read<number>(page, 'build.hands().hits')).toBe(0);
    });

    await test.step('a hare that is shot runs, and never fights back', async () => {
      await page.evaluate(() => window.__ashbound!.mp!.clearWildlife());
      const hare = await put(page, WILD_SPECIES.hare, stand.x, stand.z - 4);
      expect(await page.evaluate(() => window.__ashbound!.mp!.fireAtCreature())).toBe(hare);
      // The host answers the shot, and says it struck a creature and not a machine.
      await poll(async () => (await shotsOf(page)).filter((s) => !s.predicted).length).toBe(1);
      expect((await shotsOf(page)).find((s) => !s.predicted)?.flags).toBe(SHOT_FLAG.wild);
      await poll(async () => (await creature(page, hare))?.health ?? 1).toBeLessThan(1);
      await poll(() => read<number>(page, 'build.hands().hits')).toBe(1);
      await play(page, 4);
      // It keeps well away from the one who struck it, and is not angry at anyone.
      await poll(async () =>
        distance((await creature(page, hare)) as Creature, stand),
      ).toBeGreaterThan(12);
      expect(((await creature(page, hare))?.flags ?? 0) & WILD_FLAG.angry).toBe(0);
      expect(await health(page)).toBe(100);
    });

    await test.step('a mossback that is shot is hurt into anger, lands a few mild blows and gives up', async () => {
      await page.evaluate(() => window.__ashbound!.mp!.clearWildlife());
      const fight = SPECIES[WILD_SPECIES.mossback]?.retaliation;
      expect(fight).toBeDefined();
      const blow = fight?.player ?? 0;
      const mossback = await put(page, WILD_SPECIES.mossback, stand.x, stand.z - 4);
      expect(await page.evaluate(() => window.__ashbound!.mp!.fireAtCreature())).toBe(mossback);
      await poll(async () => (await creature(page, mossback))?.health ?? 1).toBeLessThan(1);
      await poll(async () => (await creature(page, mossback))?.flags ?? 0).toBeGreaterThanOrEqual(
        WILD_FLAG.angry,
      );
      // It comes at the player and lands its first blow: Health goes down by what a blow takes.
      await poll(async () => {
        await play(page, 0.25);
        return health(page);
      }).toBeLessThanOrEqual(100 - blow);
      await page.screenshot({ path: testInfo.outputPath('mossback-fighting-back.png') });
      // It has had enough after its blows, and not before: calm again, the player hurt only mildly.
      let lowest = 100;
      await poll(async () => {
        await play(page, 1);
        lowest = Math.min(lowest, await health(page));
        const now = await creature(page, mossback);
        return ((now?.flags ?? 0) & (WILD_FLAG.angry | WILD_FLAG.strike)) === 0;
      }).toBe(true);
      expect(lowest).toBeLessThan(100);
      expect(lowest).toBeGreaterThanOrEqual(100 - (fight?.strikes ?? 0) * blow);
      // And it stays calm: a long wait beside it costs nothing more (Health only mends).
      const mended = await health(page);
      await play(page, 10);
      await poll(() => health(page)).toBeGreaterThanOrEqual(mended);
      expect(((await creature(page, mossback))?.flags ?? 0) & WILD_FLAG.angry).toBe(0);
    });

    expect(problems).toEqual([]);
  });
});
