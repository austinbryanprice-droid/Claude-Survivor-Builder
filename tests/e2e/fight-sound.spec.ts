import { expect, test, type Page } from '@playwright/test';
import { MATERIAL, MODULE, moduleShape, packState } from '../../src/shared/blocks';
import { ENEMY_KIND } from '../../src/shared/enemy-state';
import { SHOT_FLAG } from '../../src/shared/shot';
import { ENEMIES, RESPAWN, VITALS } from '../../src/systems/survival/balance';
import {
  STATE_TIMEOUT,
  face,
  hearEffect,
  heard,
  names,
  pause,
  play,
  poll,
  since,
  type Heard,
} from './support/sound';
import { sendCrawlerNear, type Cell } from './support/turrets';

// The fight has a sound, heard from where it happens. This is where it is checked in a page: the
// blaster let go in the player's head and its bolt landing where it lands, a turret heard from the
// turret, a machine coming out of the ground, winding up and biting, the Core ringing where it stands,
// a blow felt in the head, a breacher charging and going off (heard from twice as far as a knock),
// going down and coming back, and the run lost. Nothing here needs speakers: the sound reports what
// it started and where it placed it. A run played alone is held while the pointer is free, so the
// machines stand where they are put until a test plays the host's time (`warp`).
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 300_000 });

const wait = expect.configure({ timeout: STATE_TIMEOUT });
/** Night 1 from its first second, with no waves, and Scrap enough for a turret: the only machine is the one a test sends. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&night=1&waves=0&stock=100';
/** A spot in the crash clearing, where the ground is open and gentle. */
const SPOT = { x: 8.5, z: -4.5 };
const BREACHER = ENEMIES.breacher;
const TURRET = packState(moduleShape(MODULE.turret, 0), MATERIAL.scrap);

async function open(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(`./${QUERY}`);
  await wait(page.locator('html')).toHaveAttribute('data-ready', 'true');
  // The run and the sound that follows it load after the game is up.
  await page.waitForFunction(() => !!window.__ashbound?.mp && !!window.__ashbound.sound, null, {
    timeout: STATE_TIMEOUT,
  });
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

/** Puts the player on the ground at (x, z), looking along -z so that +x is to their right. */
async function stand(page: Page, x: number, z: number): Promise<void> {
  await page.evaluate(
    ({ x, z }) => {
      const game = window.__ashbound!.game;
      game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
      game.look.yaw = 0;
      game.look.pitch = 0;
    },
    { x, z },
  );
  await page.waitForFunction(() => window.__ashbound?.game.player.onGround === true, null, {
    timeout: STATE_TIMEOUT,
  });
}

/**
 * Lets go of the mouse, which holds a run played alone: from here the host's time is the test's to
 * play. The sound has looked at the field a few frames by now, so what it finds later is new.
 */
async function hold(page: Page): Promise<void> {
  await frames(page, 3);
  await page.evaluate(() => document.exitPointerLock());
  await wait(page.locator('#hud')).toHaveAttribute('data-pointer', 'free');
  await poll(async () => (await run(page)).running).toBe(false);
}

interface Run {
  running: boolean;
  coreHealth: number;
  coreMax: number;
  over: boolean;
  overWhy: 'core' | 'crew' | null;
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
  flags: number;
  predicted: boolean;
  turret?: [number, number, number];
}

const run = (page: Page): Promise<Run> => read<Run>(page, 'mp.clock()');
const health = (page: Page): Promise<number> => read<number>(page, 'mp.vitals().health');
const machines = (page: Page): Promise<Machine[]> => read<Machine[]>(page, 'mp.enemies()');
const shotsOf = (page: Page): Promise<Shot[]> => read<Shot[]>(page, 'mp.shots().shots');
const warp = (page: Page, seconds: number): Promise<void> =>
  page.evaluate((seconds) => window.__ashbound!.mp!.warp(seconds), seconds);
/** Plays `seconds` of the host's time and waits two frames, so that the sound has looked at what came of it. */
const tick = async (page: Page, seconds: number): Promise<void> => {
  await warp(page, seconds);
  await frames(page, 2);
};
const fireAtIt = (page: Page): Promise<number | null> =>
  page.evaluate(() => window.__ashbound!.mp!.fireAtMachine());
const put = (page: Page, x: number, z: number, kind?: number): Promise<number | null> =>
  page.evaluate(({ x, z, kind }) => window.__ashbound!.mp!.spawnCrawlerAt(x, z, kind), {
    x,
    z,
    kind,
  });
const clearMachines = async (page: Page): Promise<void> => {
  await page.evaluate(() => window.__ashbound!.mp!.clearEnemies());
  await poll(async () => (await machines(page)).length).toBe(0);
};
const soundFailures = (page: Page): Promise<number | undefined> =>
  page.evaluate(() => window.__ashbound?.sound?.live?.stats.failed);

/** The Core's place in the valley. */
const coreOf = (page: Page) =>
  read<{ x: number; z: number; cellX: number; cellZ: number }>(
    page,
    `(() => {
      const { x, z, cellX, cellZ } = game.world.voxels.outpost;
      return { x, z, cellX, cellZ };
    })()`,
  );

/** The first sound of a list. */
const first = (sounds: readonly Heard[]): Heard => sounds[0] as Heard;

/** How many sounds have been heard so far: the mark to ask what came after. */
const mark = async (page: Page): Promise<number> => (await heard(page)).length;

test.describe('the sound of the fight', () => {
  test('the blaster is heard in the head and its bolt where it lands: a machine on the right is struck on the right, one on the left on the left, and its fall is heard once', async ({
    page,
  }) => {
    const problems = await open(page);
    const core = await coreOf(page);
    // Twelve blocks from a machine on open ground, as the pictures of the crawler have it.
    const here = { x: core.x - 14, z: core.z + 8 };
    const spot = { x: core.x - 14, z: core.z - 4 };
    await stand(page, here.x, here.z);
    await play(page);
    await hold(page);
    expect(await heard(page)).toEqual([]);

    let crawler = 0;
    await test.step('a machine coming out of the ground is a low rumble from where it comes up, quieter for the distance', async () => {
      const from = await mark(page);
      crawler = (await put(page, spot.x, spot.z)) ?? 0;
      expect(crawler).toBeGreaterThan(0);
      await poll(async () => (await machines(page)).length).toBe(1);
      const rose = await hearEffect(page, from, 'rise');
      expect(names(rose)).toEqual(['rumble']);
      // Twelve blocks straight ahead: in the middle, and well under the level it was written at.
      expect(Math.abs(first(rose).pan)).toBeLessThan(0.15);
      expect(first(rose).level).toBeLessThan(-25);
    });

    await test.step('the first shot is the gun in the head and the bolt landing on the machine, on the side it is on', async () => {
      // Facing west, the machine, which is to the north, is on the right.
      await face(page, Math.PI / 2);
      const from = await mark(page);
      expect(await fireAtIt(page)).toBe(crawler);
      const gun = await hearEffect(page, from, 'fire');
      expect(names(gun)).toEqual(['zap', 'step']);
      for (const sound of gun) expect(sound.pan).toBe(0);
      expect(first(gun).level).toBe(-14);
      const strike = await hearEffect(page, from, 'strike');
      expect(names(strike)).toEqual(['tick', 'crackle', 'step']);
      for (const sound of strike) expect(sound.pan).toBeGreaterThan(0.3);
      // The sounds of someone else's gun were not made for it.
      expect(await since(page, from, 'shot')).toEqual([]);
      expect(await since(page, from, 'hit')).toEqual([]);
      // And the host's word on the shot, a moment later, does not let the gun off a second time.
      await poll(async () => (await shotsOf(page)).filter((s) => !s.predicted).length).toBe(1);
      await frames(page, 2);
      expect(await since(page, from, 'fire')).toHaveLength(2);
      expect(await since(page, from, 'strike')).toHaveLength(3);
    });

    await test.step('turned the other way, the next lands on the left', async () => {
      await face(page, -Math.PI / 2);
      const from = await mark(page);
      expect(await fireAtIt(page)).toBe(crawler);
      const strike = await hearEffect(page, from, 'strike');
      for (const sound of strike) expect(sound.pan).toBeLessThan(-0.3);
    });

    await test.step('the third fells it: the clatter of its falling apart where it fell, once', async () => {
      await face(page, Math.PI / 2);
      // The blaster has fired twice from a bank of two; the host plays the time it takes to fill.
      await warp(page, 0.5);
      const from = await mark(page);
      expect(await fireAtIt(page)).toBe(crawler);
      const fell = await hearEffect(page, from, 'fell');
      expect(names(fell)).toEqual([
        'crackle',
        'crackle',
        'crackle',
        'crackle',
        'thud',
        'clang',
        'zap',
      ]);
      for (const sound of fell) expect(sound.pan).toBeGreaterThan(0.3);
      await poll(async () => (await machines(page)).length).toBe(0);
      await poll(
        async () => (await shotsOf(page)).filter((s) => s.flags & SHOT_FLAG.kill).length,
      ).toBe(1);
      await frames(page, 3);
      expect(await since(page, from, 'fell')).toHaveLength(7);
    });

    expect(await soundFailures(page)).toBe(0);
    expect(problems).toEqual([]);
  });

  test('a turret is heard from the turret and its bolt where it lands, with no one at the trigger, and the machine it fells is heard falling', async ({
    page,
  }) => {
    const problems = await open(page);
    await stand(page, SPOT.x, SPOT.z);
    await play(page);

    // Built by the host's rules, three cells from the player, who looks along -z: the turret is on their right.
    const cell: Cell = await page.evaluate(
      (state) => window.__ashbound!.mp!.placeNear(3, 0, state),
      TURRET,
    );
    await poll(() => read<number>(page, `mp.block(${cell.x}, ${cell.y}, ${cell.z})`)).toBe(TURRET);

    // The run goes on in real time with the mouse taken: the host reports a turret's shots only while it does.
    const from = await mark(page);
    const id = await sendCrawlerNear(page, cell);
    expect(id).not.toBeNull();
    await poll(async () =>
      (await shotsOf(page)).some((shot) => shot.turret && shot.flags & SHOT_FLAG.kill),
    ).toBe(true);
    await poll(async () => (await machines(page)).length).toBe(0);
    await frames(page, 3);

    await test.step('its shot is the muzzle at the turret, on the right, and the bolt landing on the machine', async () => {
      const shots = await since(page, from, 'shot');
      // Each shot is two sounds: the tone and the kick under it.
      expect(shots.length).toBeGreaterThanOrEqual(6);
      expect(names(shots.slice(0, 2))).toEqual(['zap', 'step']);
      for (const sound of shots) expect(sound.pan).toBeGreaterThan(0.3);
      // Three and a half blocks off: a hair under the level it was written at.
      expect(first(shots).level).toBeGreaterThan(-17);
      expect(first(shots).level).toBeLessThan(-13);
      const hits = await since(page, from, 'hit');
      expect(names(hits.slice(0, 3))).toEqual(['tick', 'crackle', 'step']);
    });

    await test.step('the machine falling apart is heard where it fell, and none of it is the sound of the player’s own gun', async () => {
      const fell = await since(page, from, 'fell');
      expect(names(fell)).toContain('thud');
      expect(await since(page, from, 'fire')).toEqual([]);
      expect(await since(page, from, 'strike')).toEqual([]);
    });

    expect(await read<unknown[]>(page, 'mp.rejections()')).toEqual([]);
    expect(await soundFailures(page)).toBe(0);
    expect(problems).toEqual([]);
  });

  test('a crawler winds up and bites, the blow is felt in the head, the Core rings where it stands, a player going down and coming back and the run lost are heard', async ({
    page,
  }) => {
    const problems = await open(page);
    const core = await coreOf(page);
    // A player four and a half blocks from a machine on open ground is one it comes for.
    const here = { x: core.x - 14, z: core.z + 0.5 };
    const spot = { x: core.x - 14, z: core.z - 4 };
    await stand(page, here.x, here.z);
    await play(page);
    await hold(page);

    await test.step('a crawler winds up with a whirr and a footfall, and lands the bite with a snap; the player feels it in the head', async () => {
      const from = await mark(page);
      expect(await put(page, spot.x, spot.z)).not.toBeNull();
      await poll(async () => (await machines(page)).length).toBe(1);
      await frames(page, 2);
      const before = await health(page);
      for (let hop = 0; hop < 80 && (await health(page)) >= before; hop++) await tick(page, 0.1);
      expect(await health(page)).toBeLessThan(before);
      const wound = await hearEffect(page, from, 'hurt');
      // A small blow: the dull thud and the snap, written at the level they sound at, in the middle.
      expect(names(wound)).toEqual(['thud', 'crackle']);
      for (const sound of wound) expect(sound.pan).toBe(0);
      expect(first(wound).level).toBe(-7);
      expect(names(await since(page, from, 'windup'))).toEqual(['servo', 'step']);
      expect(names(await since(page, from, 'bite'))).toEqual([
        'step',
        'crackle',
        'crackle',
        'tick',
      ]);
      await clearMachines(page);
    });

    await test.step('a great blow is felt the harder, with the ground shaking', async () => {
      await pause(page, 0.4);
      const from = await mark(page);
      await page.evaluate(() => window.__ashbound!.mp!.hurtPlayer(25));
      const wound = await hearEffect(page, from, 'hurt');
      expect(names(wound)).toEqual(['thud', 'crackle', 'rumble']);
      for (const sound of wound) expect(sound.pan).toBe(0);
      expect(first(wound).level).toBe(-3);
    });

    await test.step('the Core taking a blow rings where it stands, on the right, and a great one shakes the earth as well', async () => {
      await face(page, 0);
      let from = await mark(page);
      await page.evaluate(() => window.__ashbound!.mp!.hurtCore(10));
      const small = await hearEffect(page, from, 'core');
      expect(names(small)).toEqual(['thud', 'clang', 'crackle', 'crackle']);
      for (const sound of small) expect(sound.pan).toBeGreaterThan(0.3);

      await pause(page, 0.4);
      from = await mark(page);
      await page.evaluate(() => window.__ashbound!.mp!.hurtCore(40));
      const great = await hearEffect(page, from, 'core');
      expect(names(great)).toEqual(['thud', 'clang', 'crackle', 'crackle', 'boom']);

      // Turned to face south, the Core, which is to the east, is on the left.
      await face(page, Math.PI);
      await pause(page, 0.4);
      from = await mark(page);
      await page.evaluate(() => window.__ashbound!.mp!.hurtCore(10));
      const behind = await hearEffect(page, from, 'core');
      for (const sound of behind) expect(sound.pan).toBeLessThan(-0.3);
    });

    await test.step('going down is a low fall in the head', async () => {
      await face(page, 0);
      await pause(page, 0.4);
      const from = await mark(page);
      const left = await health(page);
      expect(await page.evaluate(() => window.__ashbound!.mp!.hurtPlayer(1000))).toBe(left);
      await warp(page, 0.1);
      await poll(async () => (await health(page)) === 0).toBe(true);
      const down = await hearEffect(page, from, 'down');
      expect(names(down)).toEqual(['whoom', 'zap', 'thud']);
      for (const sound of down) expect(sound.pan).toBe(0);
    });

    await test.step('the Core bringing them back is a rising chord', async () => {
      const from = await mark(page);
      await warp(page, RESPAWN.delaySeconds + 1);
      await poll(() => health(page)).toBe(VITALS.maxHealth);
      const back = await hearEffect(page, from, 'back');
      expect(names(back)).toEqual(['pluck', 'pluck', 'pluck', 'whoom']);
      for (const sound of back) expect(sound.pan).toBe(0);
    });

    await test.step('the run lost is a long groan in the head, with the Core’s last blow before it', async () => {
      await pause(page, 0.4);
      const from = await mark(page);
      await page.evaluate(() => {
        const mp = window.__ashbound!.mp!;
        mp.hurtCore(5000);
        mp.warp(0.1);
      });
      await poll(async () => (await run(page)).over).toBe(true);
      const lost = await hearEffect(page, from, 'overrun');
      expect(names(lost)).toEqual(['groan', 'boom', 'whoom']);
      for (const sound of lost) expect(sound.pan).toBe(0);
      // The Core's last blow rings as well: the word of the run lost and the sight of the Core's meter falling come in different frames.
      expect(names(await hearEffect(page, from, 'core'))).toContain('boom');
    });

    expect(await soundFailures(page)).toBe(0);
    expect(problems).toEqual([]);
  });

  test('a breacher is heard charging and going off, and the blast is heard from twice as far as a knock', async ({
    page,
  }) => {
    const problems = await open(page);
    const core = await coreOf(page);
    // The player stands a little behind the place it stops at, which is where the Core is within its reach.
    const stop = core.cellX - BREACHER.reach.core;
    const here = { x: stop - 0.7, z: core.z + 1.2 };
    const goOff = async (): Promise<void> => {
      expect(await put(page, core.cellX - 2.4, core.z, ENEMY_KIND.breacher)).not.toBeNull();
      await poll(async () => (await machines(page)).length).toBe(1);
      await frames(page, 2);
      for (let hop = 0; hop < 60 && (await machines(page)).length > 0; hop++)
        await tick(page, 0.25);
      await poll(async () => (await machines(page)).length).toBe(0);
    };
    await stand(page, here.x, here.z);
    await play(page);
    await hold(page);

    await test.step('it comes up, winds up a charge that builds and rises, and goes off with a blast that takes the Core and the player with it', async () => {
      const from = await mark(page);
      const before = (await run(page)).coreHealth;
      await goOff();
      expect(names(await since(page, from, 'rise'))).toEqual(['rumble']);
      expect(names(await hearEffect(page, from, 'charge'))).toEqual(['servo', 'riser']);
      // A great boom, the ground and the plate, and the snaps of what it broke.
      const blast = await hearEffect(page, from, 'blast');
      expect(names(blast)).toEqual([
        'boom',
        'thud',
        'rumble',
        'clang',
        'crackle',
        'crackle',
        'crackle',
        'crackle',
        'crackle',
        'crackle',
      ]);
      // The Core took its share and rang for it, and the player beside it felt theirs.
      expect((await run(page)).coreHealth).toBeLessThan(before);
      expect(names(await hearEffect(page, from, 'core'))).toContain('boom');
      expect(names(await hearEffect(page, from, 'hurt'))).toEqual(['thud', 'crackle', 'rumble']);
    });

    await test.step('from the far side of the valley the blast is still heard, and nothing else of it is', async () => {
      await pause(page, 0.4);
      // Sixty-four blocks off, east of nothing: past a knock's reach of 48, inside a blast's of 96.
      await stand(page, core.x - 64, core.z);
      await frames(page, 2);
      const from = await mark(page);
      await goOff();
      const blast = await hearEffect(page, from, 'blast');
      expect(blast.length).toBe(10);
      // It comes from the east, where the Core is, and has lost a good deal by the way.
      for (const sound of blast) expect(sound.pan).toBeGreaterThan(0.3);
      expect(first(blast).level).toBeLessThan(-22);
      expect(await since(page, from, 'rise')).toEqual([]);
      expect(await since(page, from, 'charge')).toEqual([]);
      expect(await since(page, from, 'core')).toEqual([]);
    });

    expect(await soundFailures(page)).toBe(0);
    expect(problems).toEqual([]);
  });
});
