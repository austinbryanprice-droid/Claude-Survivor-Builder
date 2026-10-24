import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';
import { CYCLE_SECONDS, DAY_SECONDS } from '../../src/shared/daycycle';
import { RESPAWN, VITALS } from '../../src/systems/survival/balance';
import { recordToasts, toasts } from './support/toasts';

/**
 * Four browsers play together through a local PeerServer (started by `playwright.config.ts`):
 * one hosts a room, three join it by its code, and they see each other, build and break blocks
 * in sync, and learn what happened when the host goes away. The tests drive the room panel like
 * a player would and read the state back through `window.__ashbound.mp` (the `?debug` switch).
 *
 * Software WebGL draws about two frames a second, and five pages drawing at once starve each
 * other (and the network) on a four-core machine, so each page here draws one frame every
 * `FRAME_GAP_MS` instead. The game loop, the network and the timers run as they always do; only
 * the drawing is slower. Everything waits on state, never on time.
 *
 * The network is the real one: PeerJS, WebRTC data channels, and a real signalling server.
 * Local connections only (`ice=none`): STUN, TURN and strict firewalls are not exercised here.
 *
 * These tests are a Playwright project of their own that runs after the other browser tests
 * (`playwright.config.ts`), because a page starved by a test next to it looks like a host or a
 * guest that has gone. To run just these: `npx playwright test --project=multiplayer --no-deps`.
 */

const BROKER = '127.0.0.1:9000';
// No waves: these tests cross into the night to watch the clock and the Core, not to be attacked.
const NETWORK = `broker=${BROKER}&ice=none&waves=0`;
const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const ALLOY = packState(SHAPE.cube, MATERIAL.alloy);
const SMALL = { width: 480, height: 270 };
const FRAME_GAP_MS = 1500;

/**
 * Runs inside each page before the game does: delays every animation frame request by `gap`
 * milliseconds. `window.__holdFrames(true)` stops the page drawing at all until
 * `window.__holdFrames(false)`, for a moment when another page needs the graphics process to itself.
 */
function slowFrames(gap: number): void {
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  interface Waiting {
    callback: FrameRequestCallback;
    timer: number;
    frame: number | null;
  }
  const waiting = new Map<number, Waiting>();
  let held = false;
  let next = 1;
  const schedule = (id: number, entry: Waiting): void => {
    entry.timer = window.setTimeout(() => {
      entry.frame = request((time) => {
        waiting.delete(id);
        entry.callback(time);
      });
    }, gap);
  };
  window.requestAnimationFrame = (callback) => {
    const id = next++;
    const entry: Waiting = { callback, timer: 0, frame: null };
    waiting.set(id, entry);
    if (!held) schedule(id, entry);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    const entry = waiting.get(id);
    if (!entry) return;
    window.clearTimeout(entry.timer);
    if (entry.frame !== null) cancel(entry.frame);
    waiting.delete(id);
  };
  (window as unknown as { __holdFrames: (hold: boolean) => void }).__holdFrames = (hold) => {
    if (hold === held) return;
    held = hold;
    for (const [id, entry] of waiting) {
      if (hold) {
        window.clearTimeout(entry.timer);
        if (entry.frame !== null) cancel(entry.frame);
        entry.frame = null;
      } else {
        schedule(id, entry);
      }
    }
  };
}

interface Player {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly problems: string[];
}

/**
 * Draws one block and takes it away again. A page's first block bakes the block textures and
 * compiles their shader, seconds of work under software rendering, and while it runs every other
 * page waits for the same graphics process (and a page that waits ten seconds is dropped from the
 * room). So each page does it alone, before it joins anyone.
 */
async function warmUpBlocks(page: Page): Promise<void> {
  const blocks = () => page.evaluate(() => window.__ashbound!.mp!.blocks().count);
  const draw = () =>
    page.evaluate(() => {
      const { game, stage } = window.__ashbound!;
      game.renderNow();
      stage.renderer.getContext().finish();
    });
  const cell = await page.evaluate(([state]) => window.__ashbound!.mp!.placeNear(4, 0, state!), [
    SCRAP,
  ] as const);
  await expect.poll(blocks).toBe(1);
  await draw();
  await page.evaluate(([x, y, z]) => window.__ashbound!.mp!.breakBlock(x!, y!, z!), [
    cell.x,
    cell.y,
    cell.z,
  ] as const);
  await expect.poll(blocks).toBe(0);
  await draw();
}

/** Opens the game as one player in a browser of their own (so own storage, own player token). */
async function openPlayer(
  browser: Browser,
  baseURL: string | undefined,
  name: string,
  options: {
    size?: { width: number; height: number };
    network?: string;
    /** False for a page that has already drawn blocks (a `?demo=` page) or must not touch its world. */
    warm?: boolean;
  } = {},
): Promise<Player> {
  const context = await browser.newContext({ baseURL, viewport: options.size ?? SMALL });
  await context.addInitScript(slowFrames, FRAME_GAP_MS);
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(`./?debug&quality=low&${options.network ?? NETWORK}&name=${name}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
  await page.waitForFunction(() => Boolean(window.__ashbound?.mp));
  if (options.warm !== false) await warmUpBlocks(page);
  return { name, context, page, problems };
}

const lobby = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.lobby());
const session = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.session());
const remotes = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.remotes());
const digest = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.blocks());
const clockOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.clock());
const seedOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.game.world.seed);

/**
 * Stops these pages drawing, or lets them draw again (see `slowFrames`). Their frame loop waits;
 * their network and timers carry on, so a held host still answers a guest that joins.
 */
const holdFrames = (players: readonly Player[], hold: boolean) =>
  Promise.all(
    players.map((p) =>
      p.page.evaluate(
        (value) =>
          (window as unknown as { __holdFrames: (hold: boolean) => void }).__holdFrames(value),
        hold,
      ),
    ),
  );

/** Waits for the page's room status; when it never comes, the failure says what the page was told instead. */
async function expectStatus(p: Player, status: string, timeout = 60_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const now = await lobby(p);
        if (now.status === status) return status;
        const why = now.ended ?? now.notice;
        return why ? `${now.status}: ${why.reason}, "${why.title}"` : now.status;
      },
      { timeout, message: `${p.name}'s room status` },
    )
    .toBe(status);
}

async function hostRoom(p: Player): Promise<string> {
  await p.page.getByRole('button', { name: 'Host a room' }).click();
  await expectStatus(p, 'hosting');
  const { code } = await lobby(p);
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
  return code as string;
}

async function joinByCode(p: Player, code: string): Promise<void> {
  await p.page.getByRole('textbox', { name: 'Room code', exact: true }).fill(code);
  await p.page.getByRole('button', { name: 'Join', exact: true }).click();
}

async function joinRoom(p: Player, code: string): Promise<void> {
  await joinByCode(p, code);
  await expectStatus(p, 'joined');
}

/** Waits until every player's world holds exactly `count` player-made blocks, all the same. */
async function expectSameWorld(players: readonly Player[], count: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const all = await Promise.all(players.map(digest));
        const same = all.every((d) => d.count === count && d.hash === all[0]?.hash);
        return same
          ? 'same'
          : all.map((d, i) => `${players[i]?.name} ${d.count}:${d.hash}`).join(', ');
      },
      { timeout: 60_000, message: `every world holds the same ${count} blocks` },
    )
    .toBe('same');
}

/** Waits until each of these players shows everyone else's avatar, and the room lists everyone. */
async function expectSeeEachOther(players: readonly Player[]): Promise<void> {
  const names = players.map((p) => p.name);
  for (const p of players) {
    await expect
      .poll(async () => (await lobby(p)).roster.map((r) => r.name), {
        timeout: 60_000,
        message: `${p.name}'s room list`,
      })
      .toEqual(names);
    await expect
      .poll(async () => (await remotes(p)).map((r) => r.name).sort(), {
        timeout: 60_000,
        message: `avatars on ${p.name}'s screen`,
      })
      .toEqual(names.filter((n) => n !== p.name).sort());
  }
}

async function closeAll(players: readonly Player[]): Promise<void> {
  await Promise.all(players.map((p) => p.context.close().catch(() => undefined)));
}

function expectNoProblems(players: readonly Player[]): void {
  for (const p of players) expect(p.problems, `${p.name}'s console`).toEqual([]);
}

test.describe('multiplayer', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test('a host and three clients join by code, see each other and build together', async ({
    browser,
    baseURL,
  }, testInfo) => {
    const host = await openPlayer(browser, baseURL, 'Host');
    const everyone: Player[] = [host];
    try {
      // The start screen offers a room, and the room panel explains what hosting means.
      await expect(host.page.locator('.mp-title')).toHaveText('Play together');
      await expect(host.page.locator('.mp-alone .mp-fine')).toContainText('no host migration');

      const code = await hostRoom(host);
      await expect(host.page.locator('.mp-code')).toHaveText(code);

      const [ada, bo, cy] = [
        await openPlayer(browser, baseURL, 'Ada'),
        await openPlayer(browser, baseURL, 'Bo'),
        await openPlayer(browser, baseURL, 'Cy'),
      ];
      everyone.push(ada, bo, cy);
      for (const guest of [ada, bo, cy]) await joinRoom(guest, code);

      // Everyone is in, in seat order, with a colour each, and can see the others.
      await expectSeeEachOther(everyone);
      expect((await lobby(host)).roster.map((r) => r.slot)).toEqual([0, 1, 2, 3]);
      expect((await session(host)).role).toBe('host');
      expect((await session(ada)).role).toBe('guest');
      await expect(ada.page.locator('.mp-room .mp-fine')).toContainText(
        'If the host leaves, the session ends',
      );
      // A guest's world is the host's: same seed, no blocks yet.
      expect(await digest(ada)).toEqual({ count: 0, hash: (await digest(host)).hash });

      // The run's clock is the host's, and with guests in it runs even while the host's mouse is
      // free. A jump past the end of the day reaches every screen: the host announces the night
      // and each guest's mirror says the same.
      for (const p of everyone) {
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
      }
      await host.page.evaluate((to) => {
        const mp = window.__ashbound!.mp!;
        mp.warp(to - mp.clock().elapsed);
      }, DAY_SECONDS + 1);
      for (const p of everyone) {
        await expect
          .poll(async () => (await clockOf(p)).phase, { message: `${p.name} sees the night` })
          .toBe('night');
        await expect(p.page.locator('.toast')).toContainText('Night 1 has fallen', {
          timeout: 30_000,
        });
      }

      // A click inside the room card does not start the game (a click on the backdrop would);
      // Play does, and while playing a small list of who is in stays on the screen.
      const hud = host.page.locator('#hud');
      await expect(hud).toHaveAttribute('data-pointer', 'free');
      await expect(host.page.locator('.mp-mini')).toBeHidden();
      await host.page.locator('.mp-code').click();
      await host.page.waitForTimeout(500); // a click that wrongly took the pointer shows by now
      await expect(hud).toHaveAttribute('data-pointer', 'free');
      await host.page.locator('.play-button').click();
      await expect(hud).toHaveAttribute('data-pointer', 'locked');
      await expect(host.page.locator('.mp-card')).toBeHidden();
      await expect(host.page.locator('.mp-mini .mp-name')).toHaveText(['Host', 'Ada', 'Bo', 'Cy']);
      await host.page.evaluate(() => document.exitPointerLock());
      await expect(hud).toHaveAttribute('data-pointer', 'free');
      await expect(host.page.locator('.mp-card')).toBeVisible();

      // Everyone builds next to where they stand, four cells off to the side of the row the seats
      // stand in (so nobody is in the way of anybody else's block); every world ends up identical.
      const cells: { x: number; y: number; z: number }[] = [];
      for (const [index, p] of everyone.entries()) {
        const cell = await p.page.evaluate(
          ([state, dx]) => window.__ashbound!.mp!.placeNear(dx!, 0, state!),
          [index % 2 === 0 ? SCRAP : ALLOY, 4] as const,
        );
        cells.push(cell);
      }
      await expectSameWorld(everyone, 4);

      // A tower on a guest's block, built by the host: rests on a block, so the rules allow it.
      const ground = cells[1]!;
      for (let i = 1; i <= 2; i++) {
        await host.page.evaluate(
          ([x, y, z, state]) => window.__ashbound!.mp!.place(x!, y!, z!, state!),
          [ground.x, ground.y + i, ground.z, SCRAP] as const,
        );
      }
      await expectSameWorld(everyone, 6);

      // A guest breaks a block the host placed.
      const hostBlock = cells[0]!;
      await ada.page.evaluate(([x, y, z]) => window.__ashbound!.mp!.breakBlock(x!, y!, z!), [
        hostBlock.x,
        hostBlock.y,
        hostBlock.z,
      ] as const);
      await expectSameWorld(everyone, 5);

      // The host refuses what the rules refuse, and says why.
      await bo.page.evaluate(
        ([x, y, z, state]) => window.__ashbound!.mp!.place(x!, y!, z!, state!),
        [ground.x, ground.y + 9, ground.z, SCRAP] as const,
      );
      await expect
        .poll(async () =>
          (await bo.page.evaluate(() => window.__ashbound!.mp!.rejections())).map((r) => r.reason),
        )
        .toEqual(['unsupported']);

      // A fifth player is turned away, and told so.
      const eve = await openPlayer(browser, baseURL, 'Eve');
      everyone.push(eve);
      await joinByCode(eve, code);
      await expect(eve.page.locator('.mp-notice')).toContainText('That room is full', {
        timeout: 60_000,
      });
      expect((await lobby(eve)).status).toBe('alone');
      expect((await lobby(host)).roster).toHaveLength(4);
      await eve.context.close();
      everyone.pop();

      // A guest reloads the page and gets the same seat back, with the same world. The new page
      // draws its first block (bakes the tiles, compiles the shader) while it is already in the
      // room, which takes seconds under software rendering and longer when four other pages draw
      // too, and a guest that is silent for ten seconds is dropped. So the others stop drawing
      // until it has, as every page did before it first joined.
      const seat = (await lobby(cy)).roster.find((r) => r.name === 'Cy');
      const others = everyone.filter((p) => p !== cy);
      await holdFrames(others, true);
      await cy.page.reload();
      await expect(cy.page.locator('html')).toHaveAttribute('data-ready', 'true', {
        timeout: 90_000,
      });
      await expectStatus(cy, 'joined');
      await expect
        .poll(
          () =>
            cy.page.evaluate<number>('window.__ashbound.game.world.view.structures.stats.chunks'),
          {
            timeout: 90_000,
            message: "Cy has drawn the room's blocks",
          },
        )
        .toBeGreaterThan(0);
      await holdFrames(others, false);
      const seatAgain = (await lobby(cy)).roster.find((r) => r.name === 'Cy');
      expect(seatAgain?.slot).toBe(seat?.slot);
      expect(seatAgain?.id).toBe(seat?.id);
      await expectSameWorld(everyone, 5);
      await expectSeeEachOther(everyone);

      // A guest leaves, and a latecomer takes the seat and gets the whole world at once.
      await bo.page.getByRole('button', { name: 'Leave room' }).click();
      await expectStatus(bo, 'alone');
      await expect.poll(async () => (await lobby(host)).roster.length).toBe(3);
      const dee = await openPlayer(browser, baseURL, 'Dee');
      everyone.splice(everyone.indexOf(bo), 1, dee);
      await joinRoom(dee, code);
      await expectSameWorld([host, ada, cy, dee], 5);
      // The latecomer also gets the run as it stands (night is well under way), not a fresh morning.
      await expect
        .poll(async () => (await clockOf(dee)).elapsed, { message: 'Dee has the run clock' })
        .toBeGreaterThan(DAY_SECONDS);
      // Dee has the seat Bo left, so the room list runs Host, Ada, Dee, Cy.
      await expectSeeEachOther([host, ada, dee, cy]);
      await bo.context.close();

      await host.page.screenshot({ path: testInfo.outputPath('host-room.png') });
      await testInfo.attach('host-room', {
        path: testInfo.outputPath('host-room.png'),
        contentType: 'image/png',
      });
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("the Outpost Core's health and its fall reach every screen, and the run ends for everyone", async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host');
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone = [host, ada];
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) {
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
      }

      // At night the gauge is up on every screen, with the Core whole.
      await host.page.evaluate((to) => {
        const mp = window.__ashbound!.mp!;
        mp.warp(to - mp.clock().elapsed);
      }, DAY_SECONDS + 1);
      for (const p of everyone) {
        await expect
          .poll(async () => (await clockOf(p)).phase, { message: `${p.name} sees the night` })
          .toBe('night');
        await expect(p.page.locator('.ph-core-value')).toHaveText('1000', { timeout: 30_000 });
      }

      // A wound is the host's, and it shows on both screens: the number, and amber below half.
      await host.page.evaluate(() => window.__ashbound!.mp!.hurtCore(600));
      for (const p of everyone) {
        await expect
          .poll(async () => (await clockOf(p)).coreHealth, { message: `${p.name} sees the wound` })
          .toBe(400);
        await expect(p.page.locator('.ph-core-value')).toHaveText('400');
        await expect(p.page.locator('.ph-core')).toHaveAttribute('data-tone', 'worn');
      }

      // It falls: the run is over everywhere, the clock stops for everyone, and everyone is told.
      await host.page.evaluate(() => window.__ashbound!.mp!.hurtCore(1000));
      for (const p of everyone) {
        await expect
          .poll(async () => (await clockOf(p)).over, { message: `${p.name} sees the Core fall` })
          .toBe(true);
        await expect(p.page.locator('.toast')).toContainText('The Outpost Core has fallen', {
          timeout: 30_000,
        });
        await expect(p.page.locator('.ph-core')).toHaveAttribute('data-tone', 'fallen');
        expect(await clockOf(p)).toMatchObject({ coreHealth: 0, running: false, over: true });
      }
      const stopped = (await clockOf(ada)).elapsed;
      await ada.page.waitForTimeout(2500);
      expect((await clockOf(ada)).elapsed).toBe(stopped);

      // Someone who joins afterwards is told where things stand: the Core has fallen.
      const bo = await openPlayer(browser, baseURL, 'Bo');
      everyone.push(bo);
      await joinRoom(bo, code);
      await expect
        .poll(async () => (await clockOf(bo)).over, { message: 'a newcomer sees the fall' })
        .toBe(true);
      await expect(bo.page.locator('.ph-core')).toHaveAttribute('data-tone', 'fallen');
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test('a lost run waits for the host: the guest sees who it waits for, and follows when the host plays Retry or New Run', async ({
    browser,
    baseURL,
  }) => {
    // The room card is always open in a room, 330 pixels wide at the right, and the host clicks
    // the card's buttons for real: in the usual 480-pixel window it would cover the second one.
    const host = await openPlayer(browser, baseURL, 'Host', { size: { width: 720, height: 270 } });
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone = [host, ada];
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      const first = await seedOf(host);
      expect(await seedOf(ada)).toBe(first);

      // The crew has built something, and the Core falls. The run counts every block placed in it,
      // the one each page drew and took away to warm up before the room among them.
      const placedBefore = (await clockOf(host)).placed;
      await host.page.evaluate(([state]) => window.__ashbound!.mp!.placeNear(4, 0, state!), [
        SCRAP,
      ] as const);
      await expectSameWorld(everyone, 1);
      await host.page.evaluate(() => window.__ashbound!.mp!.hurtCore(5000));
      for (const p of everyone) {
        await expect
          .poll(async () => (await clockOf(p)).over, { message: `${p.name} sees the fall` })
          .toBe(true);
        await expect(p.page.locator('.run-results')).toBeVisible({ timeout: 60_000 });
        await expect(p.page.locator('.pause')).toBeHidden();
        await expect(p.page.locator('.run-results .lede')).toContainText('The Outpost Core fell');
        // Blocks placed: what the host's run counted, one more than before the crew built.
        expect((await clockOf(p)).placed, `${p.name}'s count`).toBe(placedBefore + 1);
        await expect(
          p.page.locator('.run-results .stats .stat').nth(2).locator('strong'),
        ).toHaveText(String(placedBefore + 1));
      }

      // The host chooses; the guest is told who it waits for, and has nothing to press.
      await expect(host.page.getByRole('button', { name: 'Retry' })).toBeEnabled();
      await expect(host.page.getByRole('button', { name: 'New Run' })).toBeEnabled();
      await expect(ada.page.locator('.run-results .hint')).toHaveText(
        'Waiting for Host to start the next run.',
      );
      await expect(ada.page.locator('.run-results button')).toHaveCount(0);

      // Retry: the same valley again, for everyone, empty, at the start of a new run.
      await host.page.getByRole('button', { name: 'Retry' }).click();
      for (const p of everyone) {
        await expect
          .poll(async () => (await session(p)).run, {
            message: `${p.name} is in run 2`,
            timeout: 90_000,
          })
          .toBe(2);
        await expect
          .poll(async () => (await clockOf(p)).over, { message: `${p.name}'s run is not over` })
          .toBe(false);
      }
      await expectSameWorld(everyone, 0);
      for (const p of everyone) {
        expect(await seedOf(p), `${p.name}'s valley`).toBe(first);
        expect(await clockOf(p), `${p.name}'s run`).toMatchObject({
          over: false,
          coreHealth: 1000,
          placed: 0,
          respawns: 2 * RESPAWN.startPerPlayer,
        });
        await expect(p.page.locator('.run-results')).toBeHidden({ timeout: 60_000 });
      }
      await expectSeeEachOther(everyone);

      // Lost again, and this time the host asks for another valley.
      await host.page.evaluate(() => window.__ashbound!.mp!.hurtCore(5000));
      for (const p of everyone) {
        await expect
          .poll(async () => (await clockOf(p)).over, { message: `${p.name} sees the second fall` })
          .toBe(true);
        await expect(p.page.locator('.run-results')).toBeVisible({ timeout: 60_000 });
      }
      await host.page.getByRole('button', { name: 'New Run' }).click();
      for (const p of everyone) {
        await expect
          .poll(async () => (await session(p)).run, {
            message: `${p.name} is in run 3`,
            timeout: 90_000,
          })
          .toBe(3);
      }
      const second = await seedOf(host);
      expect(second).not.toBe(first);
      expect(await seedOf(ada)).toBe(second);
      await expectSameWorld(everyone, 0);
      await expectSeeEachOther(everyone);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("Health and Energy are each player's own: a wound and a flat battery reach that player's screen and legs, and nobody else's", async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host');
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone = [host, ada];
    // A page draws a frame every 1.5 seconds here, and the corner only changes when one is drawn.
    const slow = { timeout: 60_000 };
    const vitalsOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.vitals());
    const scaleOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.game.speedScale);
    const handsOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.build!.handScale());
    const fillsOf = (p: Player) =>
      p.page
        .locator('.ph-health .ph-fill')
        .evaluateAll((fills) => fills.map((fill) => parseFloat((fill as HTMLElement).style.width)));
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      const adaId = (await session(ada)).localId;

      // The host tells a guest how it stands as soon as it has the world: whole and full.
      await expect
        .poll(async () => (await vitalsOf(ada)).healthMax, {
          ...slow,
          message: 'Ada hears her meters',
        })
        .toBe(100);
      expect(await vitalsOf(ada)).toMatchObject({ health: 100, energyMax: 100, charging: false });

      // A wound and a flat battery for Ada, from the host. (Health mends after eight quiet seconds
      // while there is any Energy, and the run is on with a guest in, so the battery goes first and
      // the wound stays where it fell.)
      const taken = await host.page.evaluate(
        ([amount, id]) => {
          const mp = window.__ashbound!.mp!;
          mp.setVitals({ energy: 0 }, id!);
          return mp.hurtPlayer(amount!, id!);
        },
        [35, adaId] as const,
      );
      expect(taken).toBe(35);

      // The wound is Ada's: her bar and her screen edges flash, and the host's do not.
      await expect
        .poll(async () => (await vitalsOf(ada)).health, { ...slow, message: 'Ada sees the wound' })
        .toBe(65);
      await expect.poll(() => fillsOf(ada), slow).toEqual([100, 95, 0]);
      await expect(ada.page.locator('.ph-health')).toHaveAttribute('data-hit', '1', slow);
      await expect(ada.page.locator('.ph-hurt')).toHaveAttribute('data-hit', '1', slow);
      expect((await vitalsOf(host)).health).toBe(100);
      expect(await fillsOf(host)).toEqual([100, 100, 100]);
      await expect(host.page.locator('.ph-health')).not.toHaveAttribute('data-hit', /.*/);

      // The flat battery is Ada's too: her bar turns amber and says so, and her legs and hands slow.
      await expect
        .poll(async () => (await vitalsOf(ada)).energy, { ...slow, message: 'Ada runs out' })
        .toBe(0);
      await expect(ada.page.locator('.ph-energy')).toHaveAttribute('data-tone', 'empty', slow);
      await expect(ada.page.locator('.ph-status-label')).toHaveText('Out of energy', slow);
      await expect.poll(() => scaleOf(ada), { ...slow, message: 'Ada slows' }).toBeCloseTo(0.65, 5);
      await expect
        .poll(() => handsOf(ada), { ...slow, message: 'Ada fumbles' })
        .toBeCloseTo(0.5, 5);
      expect(await scaleOf(host)).toBe(1);
      expect(await handsOf(host)).toBe(1);
      await expect(host.page.locator('.ph-energy')).toHaveAttribute('data-tone', 'ok');
      await expect(host.page.locator('.ph-status-row')).toHaveCount(0);

      // Rested, she is back to full speed. (A jump of ten seconds first, so that the six seconds
      // after a wound that cost Energy extra are over and the count below is only her building.)
      await host.page.evaluate((id) => {
        const mp = window.__ashbound!.mp!;
        mp.warp(10);
        mp.setVitals({ energy: 60 }, id);
      }, adaId);
      await expect.poll(() => scaleOf(ada), { ...slow, message: 'Ada recovers' }).toBe(1);
      await expect(ada.page.locator('.ph-energy')).toHaveAttribute('data-tone', 'ok', slow);
      await expect(ada.page.locator('.ph-status-row')).toHaveCount(0, slow);

      // What she builds is paid for from her bar, not the host's. Both bars drift down together
      // with the idle drain while the run is on, so it is the difference that counts: twelve
      // blocks cost three points.
      const hostBefore = (await vitalsOf(host)).energy;
      const adaBefore = (await vitalsOf(ada)).energy;
      for (const dx of [3, 4, 5, 6]) {
        for (const dz of [0, 1, 2]) {
          await ada.page.evaluate(
            ([x, z, state]) => window.__ashbound!.mp!.placeNear(x!, z!, state!),
            [dx, dz, SCRAP] as const,
          );
        }
      }
      await expectSameWorld(everyone, 12);
      const paidMoreThanHost = async () =>
        adaBefore - (await vitalsOf(ada)).energy - (hostBefore - (await vitalsOf(host)).energy);
      await expect
        .poll(paidMoreThanHost, { ...slow, message: 'Ada pays for her blocks' })
        .toBeGreaterThanOrEqual(2);
      expect(await paidMoreThanHost()).toBeLessThanOrEqual(4);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("the host's crawlers walk on every screen, and wound the player they bite, and nobody else", async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host');
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone = [host, ada];
    // A page draws a frame every 1.5 seconds here, and a machine is only listed when one is drawn.
    const slow = { timeout: 60_000 };
    const march = { timeout: 120_000 };
    const machinesOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.enemies());
    const idsOf = async (p: Player) => (await machinesOf(p)).map((m) => m.id).sort((a, b) => a - b);
    const healthOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.vitals().health);
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) {
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
      }
      // At night, so nothing mends the Core while it is bitten.
      await host.page.evaluate((to) => {
        const mp = window.__ashbound!.mp!;
        mp.warp(to - mp.clock().elapsed);
      }, DAY_SECONDS + 1);
      for (const p of everyone) {
        await expect
          .poll(async () => (await clockOf(p)).phase, { message: `${p.name} sees the night` })
          .toBe('night');
      }

      // Five come in on the host's ring, and every screen draws the same five.
      expect(await host.page.evaluate(() => window.__ashbound!.mp!.spawnCrawlers(5))).toBe(5);
      for (const p of everyone) {
        await expect
          .poll(async () => (await machinesOf(p)).length, {
            ...slow,
            message: `${p.name} sees five`,
          })
          .toBe(5);
      }
      const named = await idsOf(host);
      expect(named).toHaveLength(5);
      await expect.poll(() => idsOf(ada), { ...slow, message: 'the same five' }).toEqual(named);

      // They walk, and the guest watches them come: closer on both screens a while on.
      const core = await host.page.evaluate(() => {
        const world = window.__ashbound!.game.world as unknown as {
          voxels: { outpost: { x: number; z: number } };
        };
        const { x, z } = world.voxels.outpost;
        return { x, z };
      });
      const nearestOf = async (p: Player) =>
        Math.min(...(await machinesOf(p)).map((m) => Math.hypot(m.x - core.x, m.z - core.z)));
      const before = await nearestOf(ada);
      expect(before).toBeGreaterThan(25);
      for (const p of everyone) {
        await expect
          .poll(() => nearestOf(p), { ...march, message: `${p.name} watches them come` })
          .toBeLessThan(before - 8);
      }

      // Two more come out of the ground beside Ada, on the side away from the host: they are hers to
      // deal with, and the bites are on her bar and on nobody else's.
      const adaAt = await ada.page.evaluate(() => window.__ashbound!.mp!.position());
      const hostAt = await host.page.evaluate(() => window.__ashbound!.mp!.position());
      const away = Math.hypot(adaAt.x - hostAt.x, adaAt.z - hostAt.z) || 1;
      const ux = (adaAt.x - hostAt.x) / away;
      const uz = (adaAt.z - hostAt.z) / away;
      const beside = await host.page.evaluate(
        ([x, z, ux, uz]) => {
          const mp = window.__ashbound!.mp!;
          // The first spot on open ground (the lake is not): along the line away from the host, then to the sides.
          for (const [along, across] of [
            [5, 0],
            [6, 2],
            [6, -2],
            [4, 3],
            [4, -3],
            [7, 0],
          ]) {
            const id = mp.spawnCrawlerAt(
              x! + ux! * along! - uz! * across!,
              z! + uz! * along! + ux! * across!,
            );
            if (id !== null) return id;
          }
          return null;
        },
        [adaAt.x, adaAt.z, ux, uz] as const,
      );
      expect(beside).not.toBeNull();
      await expect
        .poll(() => healthOf(ada), { ...march, message: 'Ada is bitten' })
        .toBeLessThan(100);
      expect(await healthOf(host)).toBe(100);
      await expect(ada.page.locator('.ph-hurt')).toHaveAttribute('data-hit', '1', slow);
      await expect(host.page.locator('.ph-hurt')).not.toHaveAttribute('data-hit', /.*/);

      // And the Core, which every screen reads from the host.
      const fullCore = (await clockOf(host)).coreMax;
      for (const p of everyone) {
        await expect
          .poll(async () => (await clockOf(p)).coreHealth, {
            ...march,
            message: `${p.name} sees the Core bitten`,
          })
          .toBeLessThan(fullCore);
      }

      // A field the host clears is clear on every screen.
      await host.page.evaluate(() => window.__ashbound!.mp!.clearEnemies());
      for (const p of everyone) {
        await expect
          .poll(async () => (await machinesOf(p)).length, {
            ...slow,
            message: `${p.name} sees none`,
          })
          .toBe(0);
      }
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("a guest's shots hurt the host's crawler: both screens draw them, the Energy is the guest's, and the kill reaches everyone", async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host');
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone = [host, ada];
    // A page draws a frame every 1.5 seconds here, and a machine is only listed when one is drawn.
    const slow = { timeout: 60_000 };
    const machinesOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.enemies());
    const shotsOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.shots().shots);
    const energyOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.vitals().energy);
    const handsOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.build!.hands());
    const fireAtIt = () => ada.page.evaluate(() => window.__ashbound!.mp!.fireAtMachine());
    const felled = async (p: Player) =>
      (await shotsOf(p)).filter((shot) => (shot.flags & 2) !== 0).length;
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) {
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
      }
      const adaId = (await session(ada)).localId;

      // One crawler comes out of the ground beside Ada, on the side away from the host.
      const adaAt = await ada.page.evaluate(() => window.__ashbound!.mp!.position());
      const hostAt = await host.page.evaluate(() => window.__ashbound!.mp!.position());
      const away = Math.hypot(adaAt.x - hostAt.x, adaAt.z - hostAt.z) || 1;
      const ux = (adaAt.x - hostAt.x) / away;
      const uz = (adaAt.z - hostAt.z) / away;
      const crawler = await host.page.evaluate(
        ([x, z, ux, uz]) => {
          const mp = window.__ashbound!.mp!;
          // The first spot on open ground (the lake is not): along the line away from the host, then to the sides.
          for (const [along, across] of [
            [6, 0],
            [7, 2],
            [7, -2],
            [5, 3],
            [5, -3],
            [8, 0],
          ]) {
            const id = mp.spawnCrawlerAt(
              x! + ux! * along! - uz! * across!,
              z! + uz! * along! + ux! * across!,
            );
            if (id !== null) return id;
          }
          return null;
        },
        [adaAt.x, adaAt.z, ux, uz] as const,
      );
      expect(crawler).not.toBeNull();

      // Both batteries are set to the same point between two whole numbers (Energy reads in whole
      // points, rounded up, and a shot is under one). They then drift down together with the idle
      // drain, so what counts is the difference.
      const hostId = (await session(host)).localId;
      await host.page.evaluate(
        ([ids]) => {
          const mp = window.__ashbound!.mp!;
          for (const id of ids!) mp.setVitals({ energy: 50.5 }, id);
        },
        [[hostId, adaId]] as const,
      );
      await expect
        .poll(() => energyOf(ada), { ...slow, message: 'Ada hears her battery' })
        .toBeLessThanOrEqual(51);
      const hostBefore = await energyOf(host);
      const adaBefore = await energyOf(ada);

      // The first shot goes the moment her screen has the machine to aim at.
      await expect
        .poll(fireAtIt, { ...slow, message: 'Ada has the crawler in her sights' })
        .toBe(crawler);
      // The second, with the bank of two; the third once the host's bucket has filled a little.
      expect(await fireAtIt()).toBe(crawler);
      await ada.page.waitForTimeout(600);
      expect(await fireAtIt()).toBe(crawler);

      // Her click drew each bolt at once; the host's word on it comes back as an echo. The host's
      // screen draws all three from Ada's gun, as they landed.
      await expect
        .poll(async () => (await shotsOf(host)).filter((s) => s.by === adaId).length, {
          ...slow,
          message: "the host sees Ada's three shots",
        })
        .toBe(3);
      await expect
        .poll(async () => (await shotsOf(ada)).length, { ...slow, message: 'Ada logs six' })
        .toBe(6);
      expect((await shotsOf(ada)).filter((s) => s.predicted)).toHaveLength(3);
      for (const p of everyone) {
        // Every one of them struck the machine (flag 1), and one of them felled it (flag 2).
        for (const shot of await shotsOf(p)) expect(shot.flags & 1, `${p.name}: a hit`).toBe(1);
        await expect
          .poll(() => felled(p), { ...slow, message: `${p.name} sees it fall once` })
          .toBe(1);
        await expect
          .poll(async () => (await machinesOf(p)).length, {
            ...slow,
            message: `${p.name} sees it gone`,
          })
          .toBe(0);
      }

      // The marker is Ada's alone, and the hot one: it was her shot that felled it.
      await expect
        .poll(() => handsOf(ada), { ...slow, message: 'Ada sees her hits' })
        .toMatchObject({ hits: 3, kill: true });
      expect(await handsOf(host)).toMatchObject({ hits: 0, kill: false });
      await expect(ada.page.locator('.ph-hitmark')).toHaveAttribute('data-kill', '', slow);
      await expect(host.page.locator('.ph-hitmark')).not.toHaveAttribute('data-hit', /.*/);

      // Three shots cost three shots of Ada's Energy and none of the host's: 1.8 points, which the
      // whole-point readings show as one or two more than the host's.
      const paidMoreThanHost = async () =>
        adaBefore - (await energyOf(ada)) - (hostBefore - (await energyOf(host)));
      await expect
        .poll(paidMoreThanHost, { ...slow, message: 'Ada pays for her shots' })
        .toBeGreaterThanOrEqual(1);
      expect(await paidMoreThanHost()).toBeLessThanOrEqual(3);
      expect(await ada.page.evaluate(() => window.__ashbound!.mp!.rejections())).toEqual([]);
      expect(await host.page.evaluate(() => window.__ashbound!.mp!.rejections())).toEqual([]);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test('a guest who is down lies still and is refused, the dawn pays for the Core to bring them back at their seat shaken, and a crew with no charge left loses the run on every screen', async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host');
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone = [host, ada];
    // A page draws a frame every 1.5 seconds here, and the screen only changes when one is drawn.
    const slow = { timeout: 60_000 };
    const vitalsOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.vitals());
    const positionOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.position());
    const frozenOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.game.frozen);
    const rejectionsOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.rejections());
    const apart = (a: { x: number; z: number }, b: { x: number; z: number }) =>
      Math.hypot(a.x - b.x, a.z - b.z);
    const avatarOf = async (viewer: Player, name: string) =>
      (await remotes(viewer)).find((r) => r.name === name);
    const fell = (id: number) =>
      host.page.evaluate(([who]) => window.__ashbound!.mp!.hurtPlayer(1000, who!), [id] as const);
    const poolOf = async (p: Player) => {
      const { respawns, respawnMax } = await clockOf(p);
      return [respawns, respawnMax];
    };
    const everyoneSees = async (
      what: string,
      read: (p: Player) => Promise<unknown>,
      want: unknown,
    ) => {
      for (const p of everyone) {
        await expect
          .poll(() => read(p), { ...slow, message: `${p.name} sees ${what}` })
          .toEqual(want);
      }
    };
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) {
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
        await recordToasts(p.page);
      }
      const hostId = (await session(host)).localId;
      const adaId = (await session(ada)).localId;
      // Her seat is a little way along from the world's spawn point, once she has been put there.
      const spawn = await ada.page.evaluate(() => {
        const { x, z } = window.__ashbound!.game.world.spawn;
        return { x, z };
      });
      await expect
        .poll(async () => apart(await positionOf(ada), spawn), {
          ...slow,
          message: 'Ada takes her seat',
        })
        .toBeGreaterThan(1);
      const seat = await positionOf(ada);

      // One pool for the crew, the same on every screen: so many charges for each player in.
      await everyoneSees('the pool', poolOf, [
        2 * RESPAWN.startPerPlayer,
        2 * RESPAWN.capPerPlayer,
      ]);
      for (const p of everyone) {
        await expect(p.page.locator('.ph-charges-value')).toHaveText(
          String(2 * RESPAWN.startPerPlayer),
          slow,
        );
      }

      // Ada walks off from her seat, so that being brought back shows.
      await ada.page.evaluate(
        ([x, z]) => {
          const game = window.__ashbound!.game;
          game.teleport(x!, game.world.groundAt(x!, z!) + 0.05, z!, 0);
        },
        [seat.x + 10, seat.z] as const,
      );
      await expect
        .poll(async () => apart((await avatarOf(host, 'Ada')) ?? seat, seat), {
          ...slow,
          message: 'the host sees Ada walk off',
        })
        .toBeGreaterThan(8);

      // The pool is empty, so a fall means a wait for the dawn. Ada goes down where she stands.
      await host.page.evaluate(() => window.__ashbound!.mp!.setRespawns(0));
      await everyoneSees('the empty pool', async (p) => (await poolOf(p))[0], 0);
      for (const p of everyone) {
        await expect(p.page.locator('.ph-charges')).toHaveAttribute('data-tone', 'empty', slow);
      }
      expect(await fell(adaId)).toBe(VITALS.maxHealth);

      // Ada's screen says so and her legs and hands stop; the host is told who, and carries on.
      await expect
        .poll(async () => (await vitalsOf(ada)).health, {
          ...slow,
          message: 'Ada hears she is down',
        })
        .toBe(0);
      expect((await vitalsOf(ada)).returnIn).toBe(0);
      await expect(ada.page.locator('.ph-down')).toBeVisible(slow);
      await expect(ada.page.locator('.ph-down-title')).toHaveText('You are down', slow);
      await expect(ada.page.locator('.ph-down-detail')).toContainText('The dawn brings more', slow);
      await expect(ada.page.locator('.ph-down-seconds')).toBeHidden();
      await expect.poll(() => frozenOf(ada), { ...slow, message: 'Ada is held still' }).toBe(true);
      expect(await ada.page.evaluate(() => window.__ashbound!.build!.isDown())).toBe(true);
      await expect.poll(() => toasts(ada.page), slow).toContain('You are down');
      await expect.poll(() => toasts(host.page), slow).toContain('Ada is down');
      await expect(host.page.locator('.ph-down')).toBeHidden();
      expect(await frozenOf(host)).toBe(false);
      expect((await vitalsOf(host)).health).toBe(VITALS.maxHealth);

      // Her hands are stilled for good measure: the host refuses what she tries, and no block lands.
      await ada.page.evaluate(([state]) => window.__ashbound!.mp!.placeNear(3, 0, state!), [
        SCRAP,
      ] as const);
      await expect
        .poll(() => rejectionsOf(ada), { ...slow, message: 'the host refuses Ada' })
        .toEqual([expect.objectContaining({ reason: 'you are down' })]);
      await expectSameWorld(everyone, 0);

      // The dawn gives the crew a charge for each player, and the Core spends one on Ada at once.
      await host.page.evaluate((to) => {
        const mp = window.__ashbound!.mp!;
        mp.warp(to - mp.clock().elapsed);
      }, CYCLE_SECONDS + 1);
      await expect
        .poll(async () => (await vitalsOf(ada)).health, { ...slow, message: 'Ada is on her feet' })
        .toBe(VITALS.maxHealth);
      const back = await vitalsOf(ada);
      expect(back.returnIn).toBe(0);
      // The room's run is live and a frame takes seconds here, so some of it may be gone already.
      expect(back.shaken).toBeGreaterThan(0);
      expect(back.shaken).toBeLessThanOrEqual(RESPAWN.shaken.seconds);
      await everyoneSees('one charge spent', async (p) => (await poolOf(p))[0], 1);
      await expect(ada.page.locator('.ph-down')).toBeHidden(slow);
      await expect.poll(() => frozenOf(ada), { ...slow, message: 'Ada walks again' }).toBe(false);
      expect(await ada.page.evaluate(() => window.__ashbound!.build!.isDown())).toBe(false);
      await expect(ada.page.locator('.ph-status-label', { hasText: 'Shaken' })).toBeVisible(slow);
      await expect(host.page.locator('.ph-status-label', { hasText: 'Shaken' })).toHaveCount(0);
      await expect
        .poll(() => toasts(ada.page), slow)
        .toContain('The Core brought you back, shaken · 1 respawn left');
      await expect
        .poll(() => toasts(host.page), slow)
        .toContain('Ada is back, shaken · 1 respawn left');

      // At her seat, on her own screen and on the host's, not where she fell.
      await expect
        .poll(async () => apart(await positionOf(ada), seat), {
          ...slow,
          message: 'Ada is back at her seat',
        })
        .toBeLessThan(0.6);
      await expect
        .poll(async () => apart((await avatarOf(host, 'Ada')) ?? { x: Infinity, z: 0 }, seat), {
          ...slow,
          message: 'the host sees Ada at her seat',
        })
        .toBeLessThan(1);

      // And her hands work again.
      await ada.page.evaluate(([state]) => window.__ashbound!.mp!.placeNear(3, 0, state!), [
        SCRAP,
      ] as const);
      await expectSameWorld(everyone, 1);
      expect(await rejectionsOf(ada)).toHaveLength(1);

      // One player standing keeps the run going; when the last of them goes down with nothing in
      // the pool to bring anyone back, the run is lost on every screen with the Core still whole.
      await host.page.evaluate(() => window.__ashbound!.mp!.setRespawns(0));
      expect(await fell(adaId)).toBe(VITALS.maxHealth);
      await expect
        .poll(async () => (await vitalsOf(ada)).health, { ...slow, message: 'Ada goes down again' })
        .toBe(0);
      expect((await clockOf(host)).over).toBe(false);
      expect(await fell(hostId)).toBe(VITALS.maxHealth);
      for (const p of everyone) {
        await expect
          .poll(async () => (await clockOf(p)).over, {
            ...slow,
            message: `${p.name} sees the crew fall`,
          })
          .toBe(true);
        const run = await clockOf(p);
        expect(run).toMatchObject({ overWhy: 'crew', running: false, respawns: 0 });
        expect(run.coreHealth).toBe(run.coreMax);
        await expect(p.page.locator('.ph-down-title')).toHaveText('Outpost overrun', slow);
        await expect(p.page.locator('.ph-down-detail')).toContainText('Every player is down', slow);
        await expect(p.page.locator('.ph-banner-title')).toHaveText('The whole crew is down', slow);
        await expect.poll(() => toasts(p.page), slow).toContain('The whole crew is down');
      }

      // Someone who joins afterwards is told how it ended.
      const bo = await openPlayer(browser, baseURL, 'Bo');
      everyone.push(bo);
      await joinRoom(bo, code);
      await expect
        .poll(async () => (await clockOf(bo)).overWhy, {
          ...slow,
          message: 'a newcomer learns why',
        })
        .toBe('crew');
      await expect(bo.page.locator('.ph-banner-title')).toHaveText('The whole crew is down', slow);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test('closing the host shows everyone the message, and they can carry on alone', async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host');
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const bo = await openPlayer(browser, baseURL, 'Bo');
    const cy = await openPlayer(browser, baseURL, 'Cy');
    const guests = [ada, bo, cy];
    try {
      const code = await hostRoom(host);
      for (const guest of guests) await joinRoom(guest, code);
      await expectSeeEachOther([host, ...guests]);

      // Something worth keeping: built together before the host goes.
      await host.page.evaluate(() => window.__ashbound!.mp!.placeNear(4, 0, 257));
      await expectSameWorld([host, ...guests], 1);

      // The host's tab is closed. The browser tells the page (`pagehide`) as it goes, and the page
      // says goodbye then, but a tab that is torn down at once may not get the goodbye out (in one
      // run of about ten it did not), and the guests then find out from ten seconds of silence, with
      // another message. So the test sends that event itself, lets the guests hear it, and then
      // closes the tab.
      await host.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      for (const guest of guests) {
        await expectStatus(guest, 'ended');
        const dialog = guest.page.getByRole('alertdialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('The host left the game');
        await expect(dialog).toContainText('no host migration');
      }
      await host.page.close();

      // Playing alone keeps the world as it was, and building works again.
      await ada.page.getByRole('button', { name: 'Play alone' }).click();
      await expectStatus(ada, 'alone');
      expect((await session(ada)).role).toBe('solo');
      expect(await digest(ada)).toMatchObject({ count: 1 });
      await ada.page.evaluate(() => window.__ashbound!.mp!.placeNear(6, 0, 257));
      await expect.poll(async () => (await digest(ada)).count).toBe(2);

      // The others are still on the message until they choose.
      await expect(bo.page.getByRole('alertdialog')).toBeVisible();
      expectNoProblems([ada, bo, cy]);
    } finally {
      await closeAll([host, ...guests]);
    }
  });

  test('a host that stops answering is reported as lost, not as having left', async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host');
    const ada = await openPlayer(browser, baseURL, 'Ada');
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther([host, ada]);
      // A tab that hangs: its page code stops, so no frames and no goodbye leave it.
      void host.page
        .evaluate(() => {
          const end = Date.now() + 25_000;
          while (Date.now() < end) {
            // Busy: this is the point.
          }
        })
        .catch(() => undefined);
      await expectStatus(ada, 'ended', 60_000);
      expect((await lobby(ada)).ended?.reason).toBe('host-lost');
      await expect(ada.page.getByRole('alertdialog')).toContainText(
        'Lost the connection to the host',
      );
    } finally {
      await closeAll([host, ada]);
    }
  });

  test('a room code that does not exist, and a matchmaking server that is down, are explained', async ({
    browser,
    baseURL,
  }) => {
    const player = await openPlayer(browser, baseURL, 'Lost');
    try {
      await joinByCode(player, 'ZZZZ2');
      await expect(player.page.locator('.mp-notice')).toContainText('No room with that code', {
        timeout: 60_000,
      });
      expect((await lobby(player)).status).toBe('alone');

      // Something that is not a code at all is caught without a network round trip.
      await joinByCode(player, 'hello');
      await expect(player.page.locator('.mp-notice')).toContainText('That is not a room code');
    } finally {
      await closeAll([player]);
    }

    // Port 9 refuses connections at once: nothing is listening there.
    const offline = await openPlayer(browser, baseURL, 'Offline', {
      network: 'broker=127.0.0.1:9&ice=none',
    });
    try {
      await offline.page.getByRole('button', { name: 'Host a room' }).click();
      await expect(offline.page.locator('.mp-notice')).toContainText(
        'Could not reach the matchmaking server',
        { timeout: 60_000 },
      );
      expect((await lobby(offline)).status).toBe('alone');
      // Playing alone is unaffected.
      expect((await session(offline)).role).toBe('solo');
    } finally {
      await closeAll([offline]);
    }
  });

  test('the benchmark page loads no multiplayer code, so it measures the game alone', async ({
    context,
    page,
  }) => {
    const watch = (target: Page): string[] => {
      const urls: string[] = [];
      target.on('request', (request) => urls.push(request.url()));
      return urls;
    };
    const glue = (urls: readonly string[]) => urls.filter((url) => /attach-multiplayer/.test(url));

    const benchUrls = watch(page);
    await page.goto('./?bench=1&benchSeconds=2&benchPresets=low&debug');
    await expect(page.locator('#hud')).toHaveAttribute('data-bench', 'running', {
      timeout: 90_000,
    });
    await page.waitForLoadState('networkidle');
    expect(glue(benchUrls)).toEqual([]);
    expect(await page.evaluate(() => Boolean(window.__ashbound?.mp))).toBe(false);
    await expect(page.locator('#mp')).toHaveCount(0);
    await page.close();

    // The same check does see the code on an ordinary page, so it is not looking for the wrong name.
    const ordinary = await context.newPage();
    const ordinaryUrls = watch(ordinary);
    await ordinary.goto('./?debug&quality=low');
    await ordinary.waitForFunction(() => Boolean(window.__ashbound?.mp), null, {
      timeout: 90_000,
    });
    expect(glue(ordinaryUrls)).not.toEqual([]);
  });

  test("a page opened with a demo structure joins with the host's world, not its own", async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host');
    const guest = await openPlayer(browser, baseURL, 'Ada', {
      network: `${NETWORK}&demo=swatch`,
      warm: false,
    });
    try {
      // The demo is raised on the guest's own valley, so it starts with blocks the host lacks.
      expect((await digest(guest)).count).toBeGreaterThan(0);
      expect((await digest(host)).count).toBe(0);

      await joinRoom(guest, await hostRoom(host));
      await expectSameWorld([host, guest], 0);

      // From then on the guest holds what the host builds, and nothing else.
      await host.page.evaluate(([state]) => window.__ashbound!.mp!.placeNear(4, 0, state!), [
        SCRAP,
      ] as const);
      await expectSameWorld([host, guest], 1);
      expectNoProblems([host, guest]);
    } finally {
      await closeAll([host, guest]);
    }
  });
});
