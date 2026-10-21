import { expect, test, type Page } from '@playwright/test';

// Software WebGL draws a few frames a second, so these tests use the Low preset and a small
// window, and wait on game state rather than on time.
test.use({ viewport: { width: 800, height: 450 } });
test.describe.configure({ timeout: 120_000 });

async function open(page: Page, query: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(`./${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  return problems;
}

/** Reads a value off the running game. Needs `?debug`. */
const read = <T>(page: Page, expression: string): Promise<T> =>
  page.evaluate<T>(`(() => {
    const game = window.__ashbound && window.__ashbound.game;
    if (!game) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
    const structures = game.world.view.structures;
    return ${expression};
  })()`);

/** The picture around the middle of the screen as coarse color buckets, one per sample of a grid. */
async function middleOfTheScreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const app = window.__ashbound;
    if (!app) throw new Error('window.__ashbound is missing; is the ?debug switch on?');
    app.game.renderNow();
    const gl = app.stage.renderer.getContext();
    const { width, height } = gl.canvas;
    const samples: string[] = [];
    const out = new Uint8Array(4);
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 8; j++) {
        const x = Math.floor(width * (0.3 + (0.4 * i) / 11));
        const y = Math.floor(height * (0.3 + (0.4 * j) / 7));
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
        samples.push(`${out[0]! >> 4}/${out[1]! >> 4}/${out[2]! >> 4}`);
      }
    }
    return samples;
  });
}

test.describe('the blocks', () => {
  test('a demo outpost is meshed, drawn and clean of shader errors', async ({ page }, testInfo) => {
    const bare = await open(page, '?debug&quality=low&freeze=1&hud=0&shot=outpost');
    expect(await read<number>(page, 'structures.stats.chunks')).toBe(0);
    // A world with no blocks bakes no block tiles: they cost video memory and start-up time.
    expect(await read<boolean>(page, 'game.stage.structureReady')).toBe(false);
    const before = await middleOfTheScreen(page);

    const problems = await open(
      page,
      '?debug&quality=low&freeze=1&hud=0&shot=outpost&demo=outpost',
    );
    const stats = await read<{ chunks: number; triangles: number; pending: number }>(
      page,
      'structures.stats',
    );
    expect(stats.chunks).toBeGreaterThan(0);
    expect(stats.triangles).toBeGreaterThan(5_000);
    expect(stats.pending).toBe(0);
    expect(await read<boolean>(page, 'structures.ready && game.stage.structureReady')).toBe(true);
    const after = await middleOfTheScreen(page);
    // The structure stands in the middle of the picture: most of what was meadow is now blocks.
    const changed = after.filter((sample, i) => sample !== before[i]).length;
    expect(changed / after.length).toBeGreaterThan(0.4);

    const path = testInfo.outputPath('outpost.png');
    await page.screenshot({ path });
    await testInfo.attach('outpost', { path, contentType: 'image/png' });
    expect([...bare, ...problems]).toEqual([]);
  });

  test('a hall of slabs and wedges is meshed, drawn and clean of shader errors', async ({
    page,
  }, testInfo) => {
    const problems = await open(page, '?debug&quality=low&freeze=1&hud=0&shot=hall&demo=hall');
    // Shape ids: 1 is the cube, 8 and 9 the slabs, 16 and up the wedges.
    const counts = await read<{ cubes: number; slabs: number; wedges: number }>(
      page,
      `(() => {
        const counts = { cubes: 0, slabs: 0, wedges: 0 };
        game.world.voxels.forEachEdit((x, y, z, state) => {
          const shape = state & 0xff;
          if (shape === 1) counts.cubes++;
          else if (shape < 16) counts.slabs++;
          else counts.wedges++;
        });
        return counts;
      })()`,
    );
    expect(counts.cubes).toBeGreaterThan(50);
    expect(counts.slabs).toBeGreaterThan(5);
    expect(counts.wedges).toBeGreaterThan(50);

    const stats = await read<{ chunks: number; triangles: number; pending: number }>(
      page,
      'structures.stats',
    );
    expect(stats.chunks).toBeGreaterThan(0);
    expect(stats.triangles).toBeGreaterThan(5_000);
    expect(stats.pending).toBe(0);
    expect(await read<boolean>(page, 'structures.ready && game.stage.structureReady')).toBe(true);

    const path = testInfo.outputPath('hall.png');
    await page.screenshot({ path });
    await testInfo.attach('hall', { path, contentType: 'image/png' });
    expect(problems).toEqual([]);
  });

  test('a name that is not a demo builds nothing', async ({ page }) => {
    const problems = await open(page, '?debug&quality=low&freeze=1&hud=0&demo=castle');
    expect(await read<number>(page, 'game.world.voxels.blockCount')).toBe(0);
    expect(await read<number>(page, 'structures.stats.chunks')).toBe(0);
    expect(problems).toEqual([]);
  });

  test('a bare demo switch raises the outpost', async ({ page }) => {
    const problems = await open(page, '?debug&quality=low&freeze=1&hud=0&demo');
    expect(await read<number>(page, 'game.world.voxels.blockCount')).toBeGreaterThan(100);
    expect(problems).toEqual([]);
  });

  test('a placed block is meshed within a frame or two, and a broken one is dropped', async ({
    page,
  }) => {
    const problems = await open(page, '?debug&quality=low&freeze=1&hud=0&shot=crash');
    expect(await read<number>(page, 'structures.stats.chunks')).toBe(0);
    expect(await read<boolean>(page, 'structures.ready')).toBe(false);

    // Place one composite cube on the crash-site ground the way a host would: check, then set.
    const placed = await read<{ refusal: string | null; changed: boolean }>(
      page,
      `(() => {
        const voxels = game.world.voxels;
        const x = 8;
        const z = -4;
        const y = Math.floor(game.world.groundAt(x + 0.5, z + 0.5));
        const state = 0x0201;
        const refusal = voxels.checkPlace(x, y, z, state);
        return { refusal, changed: refusal === null && voxels.setBlock(x, y, z, state) };
      })()`,
    );
    expect(placed).toEqual({ refusal: null, changed: true });
    expect(await read<number>(page, 'structures.stats.pending')).toBe(0);
    await page.evaluate(() => window.__ashbound?.game.renderNow());
    const meshed = await read<{ chunks: number; triangles: number }>(page, 'structures.stats');
    expect(meshed.chunks).toBe(1);
    expect(meshed.triangles).toBeGreaterThan(40);
    // The first block bakes the tiles and builds the material.
    expect(await read<boolean>(page, 'structures.ready && game.stage.structureReady')).toBe(true);

    await read<boolean>(
      page,
      `(() => {
        const x = 8;
        const z = -4;
        const y = Math.floor(game.world.groundAt(x + 0.5, z + 0.5));
        game.world.voxels.setBlock(x, y, z, 0);
        game.renderNow();
        return true;
      })()`,
    );
    expect(await read<number>(page, 'structures.stats.chunks')).toBe(0);
    expect(await read<number>(page, 'structures.stats.triangles')).toBe(0);
    expect(problems).toEqual([]);
  });

  test('swapping the world rebuilds the demo without leaking meshes', async ({ page }) => {
    const problems = await open(page, '?debug&quality=low&freeze=1&hud=0&demo=outpost&seed=7');
    const scene = (): Promise<number> =>
      read<number>(page, 'game.stage.world.children.length - structures.stats.chunks');
    const base = await scene();
    expect(await read<number>(page, 'structures.stats.chunks')).toBeGreaterThan(0);

    await page.evaluate(() => window.__ashbound?.game.loadWorld(9));
    expect(await read<number>(page, 'game.world.seed')).toBe(9);
    expect(await read<number>(page, 'structures.stats.chunks')).toBeGreaterThan(0);
    expect(await scene()).toBe(base);
    expect(problems).toEqual([]);
  });
});
