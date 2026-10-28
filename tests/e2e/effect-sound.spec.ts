import { expect, test, type Page } from '@playwright/test';
import { MATERIAL, MODULE, SHAPE, moduleShape, packState } from '../../src/shared/blocks';
import { effectForEdit } from '../../src/shared/effect-sound';
import {
  STATE_TIMEOUT,
  face,
  hearEffect,
  heard,
  names,
  play,
  poll,
  since,
  type Heard,
} from './support/sound';

// What people do in the valley has a sound, heard from where it happens. This is where it is
// checked in a page: that a block set down, broken or raised, a module that comes on or goes dark, a
// click the host turns away and a heap that is stripped each start their sounds, on the side of the
// player they happen on. Nothing here needs speakers: the sound reports what it started and where it
// placed it.
test.use({ viewport: { width: 960, height: 540 } });
test.describe.configure({ timeout: 240_000 });

/** Plenty of every material, all researched: a Node and a Generator cost 25 and 40 Scrap, and what things cost is tested elsewhere. */
const QUERY = '?debug&quality=low&freeze=1&stats=0&waves=0&stock=200&research=100';
/** A spot in the crash clearing, where the ground is open and gentle. */
const SPOT = { x: 8.5, z: -4.5 };

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const ALLOY = packState(SHAPE.cube, MATERIAL.alloy);
const piece = (module: number): number => packState(moduleShape(module, 0), MATERIAL.scrap);

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
  await page.goto(`./${QUERY}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', {
    timeout: STATE_TIMEOUT,
  });
  // The run and the sound that follows it load after the game is up.
  await page.waitForFunction(
    () =>
      !!window.__ashbound?.mp &&
      !!window.__ashbound.sound &&
      window.__ashbound.mp.heaps().length > 0,
    null,
    { timeout: STATE_TIMEOUT },
  );
  return problems;
}

/** Stands the player at the spot, looking along -z, so that +x is to their right. */
const stand = (page: Page, x = SPOT.x, z = SPOT.z): Promise<void> =>
  page.evaluate(
    ({ x, z }) => {
      const game = window.__ashbound?.game;
      if (!game) return;
      game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
      game.look.yaw = 0;
      game.look.pitch = 0;
    },
    { x, z },
  );

const placeNear = (page: Page, dx: number, dz: number, state: number): Promise<Cell> =>
  page.evaluate(
    ({ dx, dz, state }) => {
      const mp = window.__ashbound?.mp;
      if (!mp) throw new Error('window.__ashbound.mp is missing; is ?debug on?');
      return mp.placeNear(dx, dz, state);
    },
    { dx, dz, state },
  );

const blockAt = (page: Page, cell: Cell): Promise<number> =>
  page.evaluate(({ x, y, z }) => window.__ashbound?.mp?.block(x, y, z) ?? -1, cell);

test.describe('the sound of building', () => {
  test('is heard from where it happens: a block set down on the right sounds on the right, one broken on the left on the left, a piece raised rings, and a refused click knocks in the head', async ({
    page,
  }) => {
    const problems = await open(page);
    await stand(page);
    await play(page);
    await page.waitForFunction(() => window.__ashbound?.game.player.onGround === true, null, {
      timeout: STATE_TIMEOUT,
    });
    // Nothing was built, so nothing of the effects has sounded yet.
    expect(await heard(page)).toEqual([]);

    let right: Cell = { x: 0, y: 0, z: 0 };
    await test.step('a block set down five blocks to the right is placed on the right, a little quieter than if it were in hand', async () => {
      const from = (await heard(page)).length;
      right = await placeNear(page, 5, 0, SCRAP);
      const sounds = await hearEffect(page, from, 'place');
      // A knock, a woody tick and a snap of scrap: three voices of the effect, all on the right.
      expect(names(sounds)).toEqual(['step', 'tick', 'crackle']);
      for (const sound of sounds) expect(sound.pan).toBeGreaterThan(0.3);
      // Five blocks off is two past arm's reach: it has lost a little, not much, of its written level.
      const knock = sounds[0] as Heard;
      expect(knock.level).toBeLessThan(-20);
      expect(knock.level).toBeGreaterThan(-26);
    });

    let left: Cell = { x: 0, y: 0, z: 0 };
    await test.step('and one to the left is on the left', async () => {
      const from = (await heard(page)).length;
      left = await placeNear(page, -5, 0, SCRAP);
      const sounds = await hearEffect(page, from, 'place');
      for (const sound of sounds) expect(sound.pan).toBeLessThan(-0.3);
    });

    await test.step('and one straight ahead is in the middle', async () => {
      const from = (await heard(page)).length;
      await placeNear(page, 0, -5, SCRAP);
      const sounds = await hearEffect(page, from, 'place');
      for (const sound of sounds) expect(Math.abs(sound.pan)).toBeLessThan(0.15);
    });

    await test.step('turning round puts the same sound on the other side', async () => {
      await face(page, Math.PI);
      const from = (await heard(page)).length;
      await placeNear(page, 4, 4, SCRAP);
      const sounds = await hearEffect(page, from, 'place');
      // Four to the east and four to the south, facing south: the east is on the left.
      for (const sound of sounds) expect(sound.pan).toBeLessThan(-0.3);
      await face(page, 0);
    });

    await test.step('breaking a block on the right is a snap and a collapse on the right', async () => {
      const from = (await heard(page)).length;
      await page.evaluate(({ x, y, z }) => window.__ashbound?.mp?.breakBlock(x, y, z), right);
      await poll(() => blockAt(page, right)).toBe(0);
      const sounds = await hearEffect(page, from, 'break');
      expect(names(sounds)).toEqual(['crackle', 'crackle', 'crackle', 'crackle', 'thud']);
      for (const sound of sounds) expect(sound.pan).toBeGreaterThan(0.3);
    });

    await test.step('raising a block to the next material is a motor and a chime', async () => {
      const from = (await heard(page)).length;
      await page.evaluate(({ x, y, z }) => window.__ashbound?.mp?.upgrade(x, y, z), left);
      await poll(() => blockAt(page, left)).not.toBe(SCRAP);
      const sounds = await hearEffect(page, from, 'raise');
      expect(names(sounds)).toContain('servo');
      expect(names(sounds)).toContain('pluck');
      for (const sound of sounds) expect(sound.pan).toBeLessThan(-0.3);
    });

    await test.step('a click the host turns away knocks twice, in the head', async () => {
      const from = (await heard(page)).length;
      // The cell has a block in it now: the host's word is that it is taken.
      await page.evaluate(
        ({ cell, state }) => window.__ashbound?.mp?.place(cell.x, cell.y, cell.z, state),
        { cell: left, state: SCRAP },
      );
      const sounds = await hearEffect(page, from, 'refuse');
      expect(names(sounds)).toEqual(['step', 'step', 'tick']);
      for (const sound of sounds) expect(sound.pan).toBe(0);
      expect(sounds[0]?.level).toBe(-20);
      expect(await page.evaluate(() => window.__ashbound?.mp?.rejections().length)).toBe(1);
    });

    expect(await page.evaluate(() => window.__ashbound?.sound?.live?.stats.failed)).toBe(0);
    expect(problems).toEqual([]);
  });

  test('a module set down has its own sound, and one that comes on or goes dark winds up or down', async ({
    page,
  }) => {
    const problems = await open(page);
    await stand(page);
    await play(page);
    await page.waitForFunction(() => window.__ashbound?.game.player.onGround === true, null, {
      timeout: STATE_TIMEOUT,
    });

    let node: Cell = { x: 0, y: 0, z: 0 };
    await test.step('a Power Node set down is a knock and two chirps', async () => {
      const from = (await heard(page)).length;
      node = await placeNear(page, 5, 0, piece(MODULE.node));
      const sounds = await hearEffect(page, from, 'module');
      expect(names(sounds)).toEqual(['step', 'blip', 'blip']);
      // Set down with no Generator near it, it has no power, and no one said it came on.
      expect((await since(page, from, 'power')).length).toBe(0);
    });

    let generator: Cell = { x: 0, y: 0, z: 0 };
    await test.step('a Generator set down by it is heard, and the Node it lights winds up', async () => {
      const from = (await heard(page)).length;
      generator = await placeNear(page, 3, 0, piece(MODULE.generator));
      const sounds = await hearEffect(page, from, 'module');
      expect(names(sounds)).toEqual(['step', 'whoom', 'servo']);
      const lit = await hearEffect(page, from, 'power');
      // A rising whirr and a ready chirp, from the Node.
      expect(names(lit)).toEqual(['servo', 'blip']);
      for (const sound of lit) expect(sound.pan).toBeGreaterThan(0.3);
    });

    await test.step('the Generator taken apart is a collapse, and the Node it was lighting winds down', async () => {
      const from = (await heard(page)).length;
      await page.evaluate(({ x, y, z }) => window.__ashbound?.mp?.breakBlock(x, y, z), generator);
      await poll(() => blockAt(page, generator)).toBe(0);
      const broken = await hearEffect(page, from, 'module');
      expect(names(broken)).toContain('thud');
      const dark = await hearEffect(page, from, 'power');
      expect(names(dark)).toEqual(['servo']);
      expect(await blockAt(page, node)).toBe(piece(MODULE.node));
    });

    expect(await page.evaluate(() => window.__ashbound?.sound?.live?.stats.failed)).toBe(0);
    expect(problems).toEqual([]);
  });

  test('a heap stripped is heard from the heap', async ({ page }) => {
    const problems = await open(page);
    await play(page);
    const heap = await page.evaluate(() => {
      const heaps = window.__ashbound?.mp?.heaps() ?? [];
      const lying = heaps.filter((h) => h.from === 0 && h.left > 0);
      const spot = window.__ashbound?.mp?.position() ?? { x: 0, z: 0 };
      lying.sort(
        (a, b) => Math.hypot(a.x - spot.x, a.z - spot.z) - Math.hypot(b.x - spot.x, b.z - spot.z),
      );
      return lying[0] ?? null;
    });
    if (!heap) throw new Error('the run has no heap lying out');
    // Two and a half blocks from it on the side toward the middle of the valley, looking at it.
    await page.evaluate((heap) => {
      const game = window.__ashbound?.game;
      if (!game) return;
      const toward = Math.atan2(-heap.z, -heap.x);
      const x = heap.x + Math.cos(toward) * 2.6;
      const z = heap.z + Math.sin(toward) * 2.6;
      game.teleport(x, game.world.groundAt(x, z) + 0.05, z, 0);
      game.look.yaw = Math.atan2(-(heap.x - x), -(heap.z - z));
    }, heap);
    await page.waitForFunction(() => window.__ashbound?.game.player.onGround === true, null, {
      timeout: STATE_TIMEOUT,
    });

    const from = (await heard(page)).length;
    await page.evaluate((index) => window.__ashbound?.mp?.harvest(index), heap.index);
    const sounds = await hearEffect(page, from, 'harvest');
    // Three snaps of scrap coming away, a knock, and the tap of the grade it gave.
    expect(names(sounds)).toEqual(['crackle', 'crackle', 'crackle', 'step', 'tick']);
    expect(await page.evaluate(() => window.__ashbound?.sound?.live?.stats.failed)).toBe(0);
    expect(problems).toEqual([]);
  });

  test('is drawn to samples with no one listening: a block set down near stands well over the wind on the side it is on, one farther off is quieter and duller, and one beyond earshot is not made', async ({
    page,
  }) => {
    const problems = await open(page);
    const set = (x: number, z: number) =>
      effectForEdit({ type: 'set', x, y: 0, z, state: ALLOY, by: 1 }, 0);
    const near = set(4, -3);
    const far = set(36, 0);
    const gone = set(70, 0);
    if (!near || !far || !gone) throw new Error('a block set down made no effect');

    const analysis = await page.evaluate(
      async ({ near, far, gone }) => {
        const audio = window.__ashbound?.audio;
        if (!audio) throw new Error('window.__ashbound.audio is missing; is ?debug on?');
        const ears = { at: 0, listener: { x: 0, y: 1.62, z: 0, yaw: 0 } };
        const options = { seconds: 12, seed: 4242 };
        // The valley alone, and the same valley with three blocks set down in it: what the blocks
        // add is the difference, which the valley's seeded sounds make exact.
        const quiet = await audio.renderEffects({ ...options, script: [ears] });
        const played = await audio.renderEffects({
          ...options,
          script: [ears, { at: 4, effect: near }, { at: 7, effect: far }, { at: 10, effect: gone }],
        });
        const rate = played.sampleRate;
        const diff = (a: Float32Array, b: Float32Array): Float32Array =>
          a.map((v, i) => v - (b[i] as number));
        const left = diff(played.left, quiet.left);
        const right = diff(played.right, quiet.right);

        /** The largest sample of either ear's difference from `from` seconds on. */
        const largest = (x: Float32Array, from: number): number => {
          let most = 0;
          for (let i = Math.floor(from * rate); i < x.length; i++) {
            most = Math.max(most, Math.abs(x[i] as number), Math.abs(right[i] as number));
          }
          return most;
        };

        let bad = 0;
        let peak = 0;
        for (let i = 0; i < played.left.length; i++) {
          const l = played.left[i] as number;
          const r = played.right[i] as number;
          if (!Number.isFinite(l) || !Number.isFinite(r)) bad++;
          peak = Math.max(peak, Math.abs(l), Math.abs(r));
        }

        const db = (power: number): number => 10 * Math.log10(power + 1e-20);
        /** The power in a band (Hz) of the 4096 samples from `at` seconds on, by a plain Fourier sum over a Hann window. */
        const band = (x: Float32Array, at: number, lo: number, hi: number): number => {
          const n = 4096;
          const start = Math.floor(at * rate);
          let power = 0;
          for (let k = Math.ceil((lo * n) / rate); k <= Math.floor((hi * n) / rate); k++) {
            let re = 0;
            let im = 0;
            for (let i = 0; i < n; i++) {
              const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
              const v = (x[start + i] as number) * w;
              const turn = (2 * Math.PI * k * i) / n;
              re += v * Math.cos(turn);
              im -= v * Math.sin(turn);
            }
            power += re * re + im * im;
          }
          // Mean-square, with the window's own loss put back.
          return (power / (n * n * 0.375)) * 2;
        };
        /** The most a band holds in any window from `from` to `to` seconds. */
        const loudest = (
          x: Float32Array,
          from: number,
          to: number,
          lo: number,
          hi: number,
        ): number => {
          let best = 0;
          for (let at = from; at <= to; at += 0.025) best = Math.max(best, band(x, at, lo, hi));
          return db(best);
        };
        // What the wind and the hum hold in the same bands, once the mix is up.
        const wind = (lo: number, hi: number): number =>
          db(
            (band(quiet.left, 3, lo, hi) +
              band(quiet.right, 3, lo, hi) +
              band(quiet.left, 3.4, lo, hi) +
              band(quiet.right, 3.4, lo, hi)) /
              4,
          );

        // Octave bands: the knock's, then three where even a small speaker has power, then the highs.
        const BANDS: [number, number][] = [
          [180, 355],
          [355, 710],
          [710, 1400],
          [1400, 2800],
          [2800, 5600],
        ];
        const ear = (lr: Float32Array, rl: Float32Array, at: number) => ({
          bands: BANDS.map(([lo, hi]) => loudest(lr, at, at + 0.5, lo, hi)),
          other: loudest(rl, at, at + 0.5, 180, 355),
        });
        return {
          rate,
          length: played.left.length,
          bad,
          peak,
          wind: BANDS.map(([lo, hi]) => wind(lo, hi)),
          near: ear(right, left, 4),
          far: ear(right, left, 7),
          goneLargest: largest(left, 10),
        };
      },
      { near, far, gone },
    );

    await test.step('is as long as asked, whole, and well clear of the top of the range', () => {
      expect(analysis.rate).toBe(44100);
      expect(analysis.length).toBe(12 * 44100);
      expect(analysis.bad).toBe(0);
      expect(analysis.peak).toBeGreaterThan(0.01);
      expect(analysis.peak).toBeLessThan(0.5);
    });

    const band = (heard: readonly number[], index: number): number => heard[index] as number;
    const over = (heard: readonly number[]): number[] =>
      heard.map((level, index) => level - band(analysis.wind, index));

    await test.step('a block set down four blocks off is 12 decibels or more over the wind where the ear hears best, and on the right', () => {
      const margins = over(analysis.near.bands);
      expect(band(margins, 0)).toBeGreaterThan(12);
      // And there is something over the wind where even a small speaker has power.
      expect(Math.max(...margins.slice(1, 4))).toBeGreaterThan(6);
      // The ear on the other side has the knock as well, but a good deal less of it.
      expect(band(analysis.near.bands, 0) - analysis.near.other).toBeGreaterThan(6);
    });

    await test.step('and one thirty-six blocks off is a good deal quieter, and has lost its highs', () => {
      expect(band(analysis.near.bands, 0) - band(analysis.far.bands, 0)).toBeGreaterThan(12);
      // The share of the highs in what is left is smaller than it was near.
      const share = (heard: readonly number[]): number => band(heard, 4) - band(heard, 0);
      expect(share(analysis.far.bands)).toBeLessThan(share(analysis.near.bands) - 2);
    });

    await test.step('and one beyond earshot is not there at all', () => {
      expect(analysis.goneLargest).toBeLessThan(1e-4);
    });

    expect(problems).toEqual([]);
  });
});
