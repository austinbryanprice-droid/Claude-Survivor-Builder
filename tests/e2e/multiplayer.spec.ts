import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  MATERIAL,
  MATERIALS,
  MODULE,
  MODULES,
  SHAPE,
  moduleShape,
  packState,
} from '../../src/shared/blocks';
import { CYCLE_SECONDS, DAY_SECONDS } from '../../src/shared/daycycle';
import { poolSlot } from '../../src/shared/economy';
import { ENEMY_KIND } from '../../src/shared/enemy-state';
import { DEBRIS, POOL, RESEARCH } from '../../src/systems/economy/balance';
import { needsResearch, notEnough, pieceCost } from '../../src/systems/economy/build-rules';
import { NO_PLAYER } from '../../src/shared/protocol';
import { SHOT_FLAG } from '../../src/shared/shot';
import { BLASTER, ENEMIES, RESPAWN, TURRET, VITALS } from '../../src/systems/survival/balance';
import { CORE_FOOTPRINT } from '../../src/world/outpost';
import { hopFromTheCore, standAt } from './support/power';
import { recordToasts, toasts } from './support/toasts';
import { barrelOf, sendCrawlerNear } from './support/turrets';

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
const COMPOSITE = packState(SHAPE.cube, MATERIAL.composite);
const TERMINAL = packState(moduleShape(MODULE.terminal, 0), 1);
const TERMINAL_PRICE = MODULES.find((module) => module.id === MODULE.terminal)!.cost.amount;
const TURRET_STATE = packState(moduleShape(MODULE.turret, 0), 1);
const TURRET_PRICE = MODULES.find((module) => module.id === MODULE.turret)!.cost.amount;
const GENERATOR_NAME = MODULES.find((module) => module.id === MODULE.generator)!.name;
const GENERATOR_STATE = packState(moduleShape(MODULE.generator, 0), 1);
const NODE_STATE = packState(moduleShape(MODULE.node, 0), 1);
const STORAGE_STATE = packState(moduleShape(MODULE.storage, 0), 1);
const BED_STATE = packState(moduleShape(MODULE.bed, 0), 1);
const LIGHT_STATE = packState(moduleShape(MODULE.light, 0), 1);
/** The points that open the Power row of the ladder, which opens the Generator and the Power Node. */
const POWER_AT = RESEARCH.groups[0].points;
/** The points that open the Camp row, which opens the Storage, the Bed and the Light. */
const CAMP_AT = RESEARCH.groups.find((group) => group.id === 'camp')!.points;
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
    /** Opens the crew's pool with this much of every material (the host's page decides), where the test builds in the dearer ones. */
    stock?: number;
    /** Opens the run with this many research points (the host's page decides), where the test builds in a material that has to be researched. */
    research?: number;
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
  const stock = options.stock === undefined ? '' : `&stock=${options.stock}`;
  const research = options.research === undefined ? '' : `&research=${options.research}`;
  await page.goto(
    `./?debug&quality=low&${options.network ?? NETWORK}&name=${name}${stock}${research}`,
  );
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

/** Waits until this screen shows another player's avatar within two blocks of a spot. */
const expectSeen = (viewer: Player, name: string, at: { x: number; z: number }) =>
  expect
    .poll(
      async () => {
        const seen = (await remotes(viewer)).find((r) => r.name === name);
        return !!seen && Math.hypot(seen.x - at.x, seen.z - at.z) < 2;
      },
      { timeout: 60_000, message: `${viewer.name} sees ${name} in place` },
    )
    .toBe(true);

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
    // Two of them build in Alloy, which a run opens with none of and has to be researched: the crew's
    // pool starts with some, and the run with the research that opens it.
    const host = await openPlayer(browser, baseURL, 'Host', { stock: 20, research: 55 });
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

  test("a guest fells the host's armored crawler: it takes thirteen shots, not three, and the Tier 4 cells it leaves are in everyone's pool and everyone's messages", async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host');
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone = [host, ada];
    // A page draws a frame every 1.5 seconds here, and a machine is only listed when one is drawn.
    const slow = { timeout: 60_000 };
    const shots = Math.ceil(ENEMIES.armored.health / ENEMIES.armored.takes / BLASTER.damage);
    const cells = ENEMIES.armored.drop!.amount;
    const cellsName = MATERIALS.find((material) => material.id === MATERIAL.energy)!.name;
    const machinesOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.enemies());
    const shotsOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.shots().shots);
    const fireAtIt = () => ada.page.evaluate(() => window.__ashbound!.mp!.fireAtMachine());
    const energyCellsOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.pool())).stock[
        poolSlot(MATERIAL.energy)
      ] as number;
    const drawnOf = (p: Player) =>
      p.page.evaluate(() => {
        const mesh = window.__ashbound!.stage.world.getObjectByName('armored') as unknown as
          { geometry: { instanceCount: number }; visible: boolean } | undefined;
        return mesh ? { count: mesh.geometry.instanceCount, visible: mesh.visible } : null;
      });
    const told = async (p: Player) =>
      (await toasts(p.page)).filter((t) => t.startsWith('A machine left'));
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) {
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
        await recordToasts(p.page);
      }
      const adaId = (await session(ada)).localId;
      for (const p of everyone) expect(await energyCellsOf(p)).toBe(0);

      // One armored crawler comes out of the ground well away from Ada, on the side away from the host.
      const adaAt = await ada.page.evaluate(() => window.__ashbound!.mp!.position());
      const hostAt = await host.page.evaluate(() => window.__ashbound!.mp!.position());
      const away = Math.hypot(adaAt.x - hostAt.x, adaAt.z - hostAt.z) || 1;
      const ux = (adaAt.x - hostAt.x) / away;
      const uz = (adaAt.z - hostAt.z) / away;
      const armored = await host.page.evaluate(
        ([x, z, ux, uz, kind]) => {
          const mp = window.__ashbound!.mp!;
          // The first spot on open ground (the lake is not): along the line away from the host, then to the sides.
          for (const [along, across] of [
            [12, 0],
            [13, 2],
            [13, -2],
            [11, 3],
            [11, -3],
            [14, 0],
          ]) {
            const id = mp.spawnCrawlerAt(
              x! + ux! * along! - uz! * across!,
              z! + uz! * along! + ux! * across!,
              kind,
            );
            if (id !== null) return id;
          }
          return null;
        },
        [adaAt.x, adaAt.z, ux, uz, ENEMY_KIND.armored] as const,
      );
      expect(armored).not.toBeNull();

      // Every screen draws it as an armored machine, whole, with the mesh of its own kind.
      for (const p of everyone) {
        await expect
          .poll(async () => (await machinesOf(p)).map((m) => [m.id, m.kind, m.health]), {
            ...slow,
            message: `${p.name} sees the armored crawler`,
          })
          .toEqual([[armored, ENEMY_KIND.armored, 1]]);
        await expect
          .poll(() => drawnOf(p), { ...slow, message: `${p.name} draws it with its own mesh` })
          .toEqual({ count: 1, visible: true });
      }

      // Ada's first shots go the moment her screen has it in her sights. The host's word comes back
      // for each, and a crawler of the plain kind would be down at the third.
      await expect
        .poll(fireAtIt, { ...slow, message: 'Ada has the armored crawler in her sights' })
        .toBe(armored);
      expect(await fireAtIt()).toBe(armored);
      for (let shot = 3; shot < shots; shot++) {
        await ada.page.waitForTimeout(Math.ceil(BLASTER.interval * 1000) + 60);
        expect(await fireAtIt()).toBe(armored);
      }
      // One short of what fells it: the host has taken that many shots off its plating, and it stands.
      await expect
        .poll(async () => (await shotsOf(host)).filter((s) => s.by === adaId).length, {
          ...slow,
          message: `the host hears Ada's ${shots - 1} shots`,
        })
        .toBe(shots - 1);
      const share = (BLASTER.damage * ENEMIES.armored.takes) / ENEMIES.armored.health;
      for (const p of everyone) {
        await expect
          .poll(async () => (await machinesOf(p))[0]?.health ?? 0, {
            ...slow,
            message: `${p.name} sees the plating nearly gone`,
          })
          .toBeCloseTo(1 - (shots - 1) * share, 2);
        expect(await machinesOf(p)).toHaveLength(1);
        expect(await energyCellsOf(p)).toBe(0);
        expect(await told(p)).toEqual([]);
      }

      // The last shot fells it, and the kill reaches everyone.
      await ada.page.waitForTimeout(Math.ceil(BLASTER.interval * 1000) + 60);
      expect(await fireAtIt()).toBe(armored);
      for (const p of everyone) {
        await expect
          .poll(async () => (await machinesOf(p)).length, {
            ...slow,
            message: `${p.name} sees it gone`,
          })
          .toBe(0);
        await expect
          .poll(
            async () =>
              (await shotsOf(p)).filter((s) => (s.flags & SHOT_FLAG.kill) !== 0 && !s.predicted)
                .length,
            { ...slow, message: `${p.name} sees it fall once` },
          )
          .toBe(1);
      }

      // The cells are in the one pool the crew shares, on both screens, and both are told how many.
      const message = `A machine left ${cells} ${cellsName} in the pool`;
      for (const p of everyone) {
        await expect
          .poll(() => energyCellsOf(p), { ...slow, message: `${p.name} has the cells` })
          .toBe(cells);
        await expect
          .poll(() => told(p), { ...slow, message: `${p.name} is told of them` })
          .toEqual([message]);
        // They count with what the crew has gathered, for the results of a lost run.
        await expect
          .poll(async () => (await clockOf(p)).gathered, {
            ...slow,
            message: `${p.name} counts them gathered`,
          })
          .toBe(cells);
      }
      expect(await ada.page.evaluate(() => window.__ashbound!.mp!.rejections())).toEqual([]);
      expect(await host.page.evaluate(() => window.__ashbound!.mp!.rejections())).toEqual([]);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("a guest fells the host's skimmer in the air: every screen draws it hanging over her with a mesh of its own, and the Energy-Infused cells it leaves are in everyone's pool and everyone's messages", async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host');
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone = [host, ada];
    // A page draws a frame every 1.5 seconds here, and a machine is only listed when one is drawn.
    const slow = { timeout: 60_000 };
    const skimmer = ENEMIES.flyer;
    const shots = Math.ceil(skimmer.health / skimmer.takes / BLASTER.damage);
    const cells = skimmer.drop.amount;
    const cellsName = MATERIALS.find((material) => material.id === MATERIAL.energy)!.name;
    const machinesOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.enemies());
    const shotsOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.shots().shots);
    const fireAtIt = () => ada.page.evaluate(() => window.__ashbound!.mp!.fireAtMachine());
    const energyCellsOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.pool())).stock[
        poolSlot(MATERIAL.energy)
      ] as number;
    const drawnOf = (p: Player) =>
      p.page.evaluate(() => {
        const mesh = window.__ashbound!.stage.world.getObjectByName('skimmers') as unknown as
          { geometry: { instanceCount: number }; visible: boolean } | undefined;
        return mesh ? { count: mesh.geometry.instanceCount, visible: mesh.visible } : null;
      });
    /** How far its hull hangs over the ground below it on this screen, or null while the screen lists no machine. */
    const hangsOf = (p: Player) =>
      p.page.evaluate(() => {
        const { game, mp } = window.__ashbound!;
        const machine = mp!.enemies()[0];
        return machine ? machine.y - game.world.groundAt(machine.x, machine.z) : null;
      });
    const told = async (p: Player) =>
      (await toasts(p.page)).filter((t) => t.startsWith('A machine left'));
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) {
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
        await recordToasts(p.page);
      }
      const adaId = (await session(ada)).localId;
      for (const p of everyone) expect(await energyCellsOf(p)).toBe(0);

      // One skimmer comes out of the air beside Ada, on the side away from the host: it comes for her
      // and hangs over her, so that it is still while she aims at it.
      const adaAt = await ada.page.evaluate(() => window.__ashbound!.mp!.position());
      const hostAt = await host.page.evaluate(() => window.__ashbound!.mp!.position());
      const away = Math.hypot(adaAt.x - hostAt.x, adaAt.z - hostAt.z) || 1;
      const id = await host.page.evaluate(
        ([x, z, ux, uz, kind]) =>
          window.__ashbound!.mp!.spawnCrawlerAt(x! + ux! * 1.2, z! + uz! * 1.2, kind),
        [
          adaAt.x,
          adaAt.z,
          (adaAt.x - hostAt.x) / away,
          (adaAt.z - hostAt.z) / away,
          ENEMY_KIND.flyer,
        ] as const,
      );
      expect(id).not.toBeNull();

      // Every screen draws it as a skimmer, whole, with the mesh of its own kind, in the air over the ground.
      for (const p of everyone) {
        await expect
          .poll(async () => (await machinesOf(p)).map((m) => [m.id, m.kind, m.health]), {
            ...slow,
            message: `${p.name} sees the skimmer`,
          })
          .toEqual([[id, ENEMY_KIND.flyer, 1]]);
        await expect
          .poll(() => drawnOf(p), { ...slow, message: `${p.name} draws it with its own mesh` })
          .toEqual({ count: 1, visible: true });
        expect(await hangsOf(p), `${p.name} sees it hanging in the air`).toBeGreaterThan(1.5);
      }

      // Ada's shots go the moment her screen has it in her sights, and the host's word comes back for each.
      await expect
        .poll(fireAtIt, { ...slow, message: 'Ada has the skimmer in her sights' })
        .toBe(id);
      for (let shot = 2; shot <= shots; shot++) {
        await ada.page.waitForTimeout(Math.ceil(BLASTER.interval * 1000) + 60);
        expect(await fireAtIt()).toBe(id);
      }

      // It falls, and the kill reaches everyone.
      for (const p of everyone) {
        await expect
          .poll(async () => (await machinesOf(p)).length, {
            ...slow,
            message: `${p.name} sees it gone`,
          })
          .toBe(0);
        await expect
          .poll(
            async () =>
              (await shotsOf(p)).filter((s) => (s.flags & SHOT_FLAG.kill) !== 0 && !s.predicted)
                .length,
            { ...slow, message: `${p.name} sees it fall once` },
          )
          .toBe(1);
      }
      expect((await shotsOf(host)).filter((s) => s.by === adaId).length).toBeGreaterThanOrEqual(
        shots,
      );

      // The cells are in the one pool the crew shares, on both screens, and both are told how many.
      const message = `A machine left ${cells} ${cellsName} in the pool`;
      for (const p of everyone) {
        await expect
          .poll(() => energyCellsOf(p), { ...slow, message: `${p.name} has the cells` })
          .toBe(cells);
        await expect
          .poll(() => told(p), { ...slow, message: `${p.name} is told of them` })
          .toEqual([message]);
        await expect
          .poll(async () => (await clockOf(p)).gathered, {
            ...slow,
            message: `${p.name} counts them gathered`,
          })
          .toBe(cells);
      }
      expect(await ada.page.evaluate(() => window.__ashbound!.mp!.rejections())).toEqual([]);
      expect(await host.page.evaluate(() => window.__ashbound!.mp!.rejections())).toEqual([]);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("a host's breacher blows a hole in the ring of walls round the Core: every screen draws it with a mesh of its own, sees the machine go and the hole it leaves in the same cells, the blast reaches every screen, and nobody is wounded and the Core is not touched", async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host', { stock: 200 });
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone = [host, ada];
    // A page draws a frame every 1.5 seconds here, and a machine is only listed when one is drawn.
    const slow = { timeout: 60_000 };
    /** The ring stands this many cells off the Core's walls, a block high: out of the Core's reach of a blast at it. */
    const ring = 3;
    /** Two frames on this page: the host judges a placement from where it last saw the player, so a move needs them first. */
    const settle = (p: Player) =>
      p.page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    const machinesOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.enemies());
    const blockOf = (p: Player, cell: readonly [number, number, number]) =>
      p.page.evaluate(([x, y, z]) => window.__ashbound!.mp!.block(x!, y!, z!), cell);
    const blastsOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.blastCount());
    const healthOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.vitals())).health;
    const drawnOf = (p: Player) =>
      p.page.evaluate(() => {
        const mesh = window.__ashbound!.stage.world.getObjectByName('breachers') as unknown as
          { geometry: { instanceCount: number }; visible: boolean } | undefined;
        return mesh ? { count: mesh.geometry.instanceCount, visible: mesh.visible } : null;
      });
    const told = async (p: Player) =>
      (await toasts(p.page)).filter((t) => t.startsWith('A machine left'));
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) {
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
        await recordToasts(p.page);
      }

      // The host raises a ring of Scrap round the Core from inside it, a side at a time, standing a
      // block and a half in from the middle of each: every block is within reach of where they stand.
      const core = await host.page.evaluate(() => {
        const world = window.__ashbound!.game.world as unknown as {
          voxels: { outpost: { x: number; z: number; cellX: number; cellZ: number } };
        };
        const { x, z, cellX, cellZ } = world.voxels.outpost;
        return { x, z, cellX, cellZ };
      });
      const lo = core.cellX - ring;
      const hi = core.cellX + CORE_FOOTPRINT - 1 + ring;
      const loZ = core.cellZ - ring;
      const hiZ = core.cellZ + CORE_FOOTPRINT - 1 + ring;
      const cells = await host.page.evaluate(
        ([lo, hi, loZ, hiZ]) => {
          const { game } = window.__ashbound!;
          const cells: [number, number, number][] = [];
          for (let x = lo!; x <= hi!; x++) {
            for (let z = loZ!; z <= hiZ!; z++) {
              if (x !== lo && x !== hi && z !== loZ && z !== hiZ) continue;
              cells.push([x, Math.floor(game.world.groundAt(x + 0.5, z + 0.5)), z]);
            }
          }
          return cells;
        },
        [lo, hi, loZ, hiZ] as const,
      );
      const sides = [
        { at: { x: lo + 1.5, z: core.z }, has: (c: number[]) => c[0] === lo },
        { at: { x: hi - 0.5, z: core.z }, has: (c: number[]) => c[0] === hi },
        { at: { x: core.x, z: loZ + 1.5 }, has: (c: number[]) => c[2] === loZ },
        { at: { x: core.x, z: hiZ - 0.5 }, has: (c: number[]) => c[2] === hiZ },
      ];
      const placed = new Set<string>();
      for (const side of sides) {
        await standAt(host.page, side.at.x, side.at.z);
        await settle(host);
        const mine = cells.filter((c) => side.has(c) && !placed.has(c.join()));
        for (const c of mine) placed.add(c.join());
        await host.page.evaluate(
          ([mine, state]) => {
            const { mp } = window.__ashbound!;
            for (const [x, y, z] of mine as [number, number, number][])
              mp!.place(x, y, z, state as number);
          },
          [mine, SCRAP] as const,
        );
        await expect
          .poll(async () => (await digest(host)).count, { ...slow, message: 'the ring goes up' })
          .toBe(placed.size);
      }
      expect(placed.size).toBe(cells.length);
      await expectSameWorld(everyone, cells.length);

      // Nobody is near the west wall (a blast wounds whoever is within three blocks of it): the
      // host and Ada stand well off to the east, and the host sees her there.
      const hostAway = { x: core.x + 14, z: core.z + 10 };
      const adaAway = { x: core.x + 16, z: core.z + 12 };
      await standAt(host.page, hostAway.x, hostAway.z);
      await standAt(ada.page, adaAway.x, adaAway.z);
      await settle(host);
      await expectSeen(host, 'Ada', adaAway);
      const before = { core: (await clockOf(host)).coreHealth };
      for (const p of everyone) expect(await blastsOf(p), `${p.name} has heard no blast`).toBe(0);

      // One breacher comes up from the west, in line with the middle of the wall on that side.
      const cz = Math.floor(core.z);
      const wall = cells.filter((c) => c[0] === lo && c[2] === cz)[0] as [number, number, number];
      const id = await host.page.evaluate(
        ([x, z, kind]) => window.__ashbound!.mp!.spawnCrawlerAt(x!, z!, kind),
        [lo - 5.5, cz + 0.2, ENEMY_KIND.breacher] as const,
      );
      expect(id).not.toBeNull();

      // Every screen draws it as a breacher, whole, with the mesh of its own kind.
      for (const p of everyone) {
        await expect
          .poll(async () => (await machinesOf(p)).map((m) => [m.id, m.kind, m.health]), {
            ...slow,
            message: `${p.name} sees the breacher`,
          })
          .toEqual([[id, ENEMY_KIND.breacher, 1]]);
        await expect
          .poll(() => drawnOf(p), { ...slow, message: `${p.name} draws it with its own mesh` })
          .toEqual({ count: 1, visible: true });
      }

      // It walks to the wall, charges and goes off: it is gone from every screen, and the cells in
      // front of it are gone from every world, the wall on the far side of the Core as it was.
      for (const p of everyone) {
        await expect
          .poll(async () => (await machinesOf(p)).length, {
            ...slow,
            message: `${p.name} sees it go off`,
          })
          .toBe(0);
        await expect
          .poll(() => blockOf(p, wall), { ...slow, message: `${p.name} sees the hole` })
          .toBe(0);
        await expect
          .poll(async () => (await digest(p)).count, { ...slow, message: `${p.name}'s walls` })
          .toBeLessThan(cells.length);
        expect(
          await blockOf(
            p,
            cells.find((c) => c[0] === hi && c[2] === cz) as [number, number, number],
          ),
        ).not.toBe(0);
      }
      await expectSameWorld(everyone, (await digest(host)).count);
      // The blast itself, once, reached every screen as an event of its own, and the machine was never felled.
      for (const p of everyone) {
        await expect
          .poll(() => blastsOf(p), { ...slow, message: `the blast reaches ${p.name}` })
          .toBe(1);
      }
      for (const p of everyone) {
        expect((await clockOf(p)).felled, `${p.name} counts nothing felled`).toBe(0);
        expect((await clockOf(p)).coreHealth, `${p.name} sees the Core whole`).toBe(before.core);
        expect(await healthOf(p), `${p.name} is unhurt`).toBe(VITALS.maxHealth);
        expect(await told(p)).toEqual([]);
      }
      expect(await host.page.evaluate(() => window.__ashbound!.mp!.rejections())).toEqual([]);
      expect(await ada.page.evaluate(() => window.__ashbound!.mp!.rejections())).toEqual([]);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("a guest strips a heap of debris: the host's pool and both pictures follow, only the guest is told, and a latecomer is told how things stand", async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host');
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone: Player[] = [host, ada];
    // A page draws a frame every 1.5 seconds here, and the picture and the hands only change when one is drawn.
    const slow = { timeout: 60_000 };
    const heapsOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.heaps());
    const shownOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.heapsShown());
    const scrapOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.pool())).stock[0] as number;
    const positionOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.position());
    const rejectionsOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.rejections());
    const salvageOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.build!.salvage());
    const gatheredOf = async (p: Player) => (await clockOf(p)).gathered;
    const apart = (a: { x: number; z: number }, b: { x: number; z: number }) =>
      Math.hypot(a.x - b.x, a.z - b.z);
    const avatarOf = async (viewer: Player, name: string) =>
      (await remotes(viewer)).find((r) => r.name === name);
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) {
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
        await recordToasts(p.page);
      }

      // The valley's heaps and the crew's pool are the host's, the same on every screen.
      await expect
        .poll(async () => (await heapsOf(ada)).length, {
          ...slow,
          message: 'Ada has the list of heaps',
        })
        .toBeGreaterThan(0);
      const list = await heapsOf(host);
      expect(await heapsOf(ada)).toEqual(list);
      const startPool = await scrapOf(host);
      expect(await scrapOf(ada)).toBe(startPool);

      // The heap nearest to Ada's seat with three strips, and the one farthest from it.
      const seat = await positionOf(ada);
      const lying = list.filter((h) => h.from === 0);
      const byDistance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
        apart(a, seat) - apart(b, seat);
      const heap = lying.filter((h) => h.harvests >= 3).sort(byDistance)[0]!;
      const far = [...lying].sort(byDistance).at(-1)!;
      expect(apart(far, seat)).toBeGreaterThan(DEBRIS.reach);

      // Ada walks up to it, in hops the host's movement check allows, and looks at its middle.
      const spot = {
        x: heap.x + ((seat.x - heap.x) / apart(seat, heap)) * 2.6,
        z: heap.z + ((seat.z - heap.z) / apart(seat, heap)) * 2.6,
      };
      for (
        let here = await positionOf(ada);
        apart(here, spot) > 0.5;
        here = await positionOf(ada)
      ) {
        const go = Math.min(1, 8 / apart(here, spot));
        const next = { x: here.x + (spot.x - here.x) * go, z: here.z + (spot.z - here.z) * go };
        await ada.page.evaluate(
          ([x, z]) => {
            const game = window.__ashbound!.game;
            game.teleport(x!, game.world.groundAt(x!, z!) + 0.05, z!, 0);
          },
          [next.x, next.z] as const,
        );
        await expect
          .poll(async () => apart((await avatarOf(host, 'Ada')) ?? seat, next), {
            ...slow,
            message: 'the host sees Ada arrive',
          })
          .toBeLessThan(1.5);
      }
      await ada.page.locator('.play-button').click();
      await expect(ada.page.locator('#hud')).toHaveAttribute('data-pointer', 'locked', slow);
      const lookAtHeap = () =>
        ada.page.evaluate(
          ({ heap, lift }) => {
            const game = window.__ashbound!.game;
            const eye = game.player.y + 1.62;
            const dx = heap.x - game.player.x;
            const dz = heap.z - game.player.z;
            game.look.yaw = Math.atan2(-dx, -dz);
            game.look.pitch = Math.atan2(heap.y + lift - eye, Math.hypot(dx, dz));
          },
          { heap, lift: DEBRIS.lift },
        );
      await expect
        .poll(
          async () => {
            await lookAtHeap();
            return (await salvageOf(ada)).index;
          },
          { ...slow, message: "the heap is under Ada's cursor" },
        )
        .toBe(heap.index);
      await expect(ada.page.locator('.ph-interact-label')).toHaveText('Strip debris', slow);

      // E strips it: the host's pool takes what came off, and the heap has lost a strip on both screens.
      await ada.page.keyboard.press('KeyE');
      await expect
        .poll(async () => (await heapsOf(host))[heap.index]?.left, {
          ...slow,
          message: 'the host sees the strip',
        })
        .toBe(heap.harvests - 1);
      await expect
        .poll(async () => (await heapsOf(ada))[heap.index]?.left, {
          ...slow,
          message: 'Ada sees the strip',
        })
        .toBe(heap.harvests - 1);
      const gained = (await scrapOf(host)) - startPool;
      expect(gained).toBeGreaterThanOrEqual(DEBRIS.yield.min);
      expect(gained).toBeLessThanOrEqual(DEBRIS.yield.max);
      for (const p of everyone) {
        await expect
          .poll(() => scrapOf(p), { ...slow, message: `${p.name} sees the pool` })
          .toBe(startPool + gained);
        await expect
          .poll(() => gatheredOf(p), { ...slow, message: `${p.name} sees what was gathered` })
          .toBe(gained);
        await expect
          .poll(async () => (await shownOf(p)).find((s) => s.index === heap.index)?.share, {
            ...slow,
            message: `${p.name} sees the heap lose a layer`,
          })
          .toBe((heap.harvests - 1) / heap.harvests);
      }
      // The hotbar of every screen tells the one pool, and only the one who stripped is told.
      for (const p of everyone) {
        await expect(p.page.locator('.ph-slot').nth(0).locator('.ph-count')).toHaveText(
          String(startPool + gained),
          slow,
        );
      }
      await expect.poll(async () => (await toasts(ada.page)).at(-1), slow).toBe(`+${gained} Scrap`);
      expect((await toasts(host.page)).filter((t) => t.includes('Scrap'))).toEqual([]);

      // A heap out of Ada's reach is refused by the host, and nothing comes of it.
      expect(await ada.page.evaluate((i) => window.__ashbound!.mp!.harvest(i), far.index)).toBe(
        true,
      );
      await expect
        .poll(async () => (await rejectionsOf(ada)).map((r) => r.reason), {
          ...slow,
          message: 'the host refuses Ada',
        })
        .toEqual(['out of reach']);
      expect(await rejectionsOf(host)).toEqual([]);
      expect((await heapsOf(host))[far.index]?.left).toBe(far.harvests);

      // A player who joins now is told how things stand: the heap short of a strip, and the pool.
      const bo = await openPlayer(browser, baseURL, 'Bo');
      everyone.push(bo);
      await joinRoom(bo, code);
      await expect
        .poll(async () => (await heapsOf(bo))[heap.index]?.left, {
          ...slow,
          message: 'Bo is told the heap was stripped',
        })
        .toBe(heap.harvests - 1);
      expect(await heapsOf(bo)).toEqual(await heapsOf(host));
      await expect
        .poll(() => scrapOf(bo), { ...slow, message: 'Bo is told the pool' })
        .toBe(startPool + gained);
      await expect
        .poll(async () => (await shownOf(bo)).length, { ...slow, message: 'Bo sees the heaps' })
        .toBe((await shownOf(host)).length);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("the crew's pool pays for everyone's building: a guest's block and the host's come out of one count, a break gives the price back, and the host's words reach a guest whose ghost went red from the same count", async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host');
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone: Player[] = [host, ada];
    // A page draws a frame every 1.5 seconds here, and the picture and the hands only change when one is drawn.
    const slow = { timeout: 60_000 };
    const start = POOL.start[MATERIAL.scrap] ?? 0;
    const scrapOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.pool())).stock[0] as number;
    const rejectionsOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.rejections())).map((r) => r.reason);
    const expectPool = async (count: number) => {
      for (const p of everyone) {
        await expect
          .poll(() => scrapOf(p), { ...slow, message: `${p.name} sees the pool` })
          .toBe(count);
        await expect(p.page.locator('.ph-slot').nth(0).locator('.ph-count')).toHaveText(
          String(count),
          slow,
        );
      }
    };
    // Her seat is on a rise, so the view has to look steeply down to meet ground within reach; what a click
    // there would be refused for is what the ghost's colour comes from.
    const aimOf = (p: Player) =>
      p.page.evaluate(() => {
        const { game, build } = window.__ashbound!;
        game.look.pitch = -0.9;
        const aim = build!.aim();
        return aim.hasPlace ? aim.placeRefusal : 'no ground to place on';
      });
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) {
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
      }
      // The pool is the host's, the same on both screens and in both hotbars.
      await expectPool(start);

      // Ada's block and the host's come out of the one count, and neither is the other's to pay.
      await ada.page.evaluate(([state]) => window.__ashbound!.mp!.placeNear(4, 0, state!), [
        SCRAP,
      ] as const);
      await expectSameWorld(everyone, 1);
      await expectPool(start - 1);
      const hostBlock = await host.page.evaluate(
        ([state]) => window.__ashbound!.mp!.placeNear(-4, 0, state!),
        [SCRAP] as const,
      );
      await expectSameWorld(everyone, 2);
      await expectPool(start - 2);

      // A break gives the price back to the one pool, whoever placed the block.
      await ada.page.evaluate(([x, y, z]) => window.__ashbound!.mp!.breakBlock(x!, y!, z!), [
        hostBlock.x,
        hostBlock.y,
        hostBlock.z,
      ] as const);
      await expectSameWorld(everyone, 1);
      await expectPool(start - 1);
      expect(await rejectionsOf(ada)).toEqual([]);
      expect(await rejectionsOf(host)).toEqual([]);

      // The pool runs dry: the host says why in words, to the guest alone, and builds nothing.
      await host.page.evaluate(([material]) => window.__ashbound!.mp!.setPool(material!, 0), [
        MATERIAL.scrap,
      ] as const);
      await expectPool(0);
      await ada.page.evaluate(([state]) => window.__ashbound!.mp!.placeNear(0, 4, state!), [
        SCRAP,
      ] as const);
      await expect
        .poll(() => rejectionsOf(ada), { ...slow, message: 'the host turns Ada down' })
        .toEqual(['not enough Scrap']);
      expect(await rejectionsOf(host)).toEqual([]);
      await expectSameWorld(everyone, 1);

      // Ada's own screen knows before she clicks: what her aim would be refused for is read from her
      // copy of the pool (Build Mode only changes how it is drawn, and its first look at the ghost
      // is seconds of shader work that a page in a room should not spend).
      await ada.page.locator('.play-button').click();
      await expect(ada.page.locator('#hud')).toHaveAttribute('data-pointer', 'locked', slow);
      await expect
        .poll(() => aimOf(ada), { ...slow, message: "Ada's aim is refused for the pool" })
        .toBe('not enough Scrap');

      // The host puts some back, and her aim clears without her doing a thing.
      await host.page.evaluate(([material]) => window.__ashbound!.mp!.setPool(material!, 2), [
        MATERIAL.scrap,
      ] as const);
      await expect.poll(() => aimOf(ada), { ...slow, message: "Ada's aim clears" }).toBeNull();
      await expectPool(2);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("a Research Terminal stands on every screen: a guest's build and the host's break reach everyone, the price follows the one pool, and a player who joins later is shown it", async ({
    browser,
    baseURL,
  }) => {
    // The crew's pool is the host's, and opens with more than the Terminal's price.
    const host = await openPlayer(browser, baseURL, 'Host', { stock: 200 });
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone: Player[] = [host, ada];
    const slow = { timeout: 60_000 };
    const scrapOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.pool())).stock[0] as number;
    const rejectionsOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.rejections())).map((r) => r.reason);
    // What this page draws of the modules: the valley view's renderer, which the typed hook does not name.
    const drawnOf = (p: Player) =>
      p.page.evaluate(
        () =>
          (
            window.__ashbound!.game.world as unknown as {
              view: { modules: { count: number } };
            }
          ).view.modules.count,
      );
    const cellOf = (p: Player, at: { x: number; y: number; z: number }) =>
      p.page.evaluate(([x, y, z]) => window.__ashbound!.mp!.block(x!, y!, z!), [
        at.x,
        at.y,
        at.z,
      ] as const);
    const expectEverywhere = async (
      drawn: number,
      scrap: number,
      state: number,
      at: typeof cell,
    ) => {
      for (const p of everyone) {
        await expect
          .poll(() => drawnOf(p), { ...slow, message: `${p.name} draws ${drawn} modules` })
          .toBe(drawn);
        await expect
          .poll(() => scrapOf(p), { ...slow, message: `${p.name} sees the pool` })
          .toBe(scrap);
        await expect
          .poll(() => cellOf(p, at), { ...slow, message: `${p.name} sees the cell` })
          .toBe(state);
      }
    };
    let cell = { x: 0, y: 0, z: 0 };
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) {
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
        await expect
          .poll(() => scrapOf(p), { ...slow, message: `${p.name} sees the pool` })
          .toBe(200);
      }

      // Ada builds a Terminal: one more cell in everyone's world, drawn on both screens, paid from the one pool.
      cell = await ada.page.evaluate(([state]) => window.__ashbound!.mp!.placeNear(4, 0, state!), [
        TERMINAL,
      ] as const);
      await expectSameWorld(everyone, 1);
      await expectEverywhere(1, 200 - TERMINAL_PRICE, TERMINAL, cell);

      // A player who joins now is shown it with the rest of the world, and told the pool.
      const bo = await openPlayer(browser, baseURL, 'Bo');
      everyone.push(bo);
      await joinRoom(bo, code);
      await expectSameWorld(everyone, 1);
      await expectEverywhere(1, 200 - TERMINAL_PRICE, TERMINAL, cell);

      // The host breaks it: gone from every screen, and the price is back in the pool.
      await host.page.evaluate(([x, y, z]) => window.__ashbound!.mp!.breakBlock(x!, y!, z!), [
        cell.x,
        cell.y,
        cell.z,
      ] as const);
      await expectSameWorld(everyone, 0);
      await expectEverywhere(0, 200, 0, cell);
      for (const p of everyone) expect(await rejectionsOf(p), p.name).toEqual([]);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("a Basic Turret fires for the whole crew: a guest's build shoots the host's crawler, every screen draws the bolt from its barrel and turns its head, the kill is the crew's, and breaking it stops the fire", async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host', { stock: 200 });
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone: Player[] = [host, ada];
    const slow = { timeout: 60_000 };
    const shotsOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.shots().shots)).filter(
        (shot) => shot.turret,
      );
    const machinesOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.enemies());
    const scrapOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.pool())).stock[0] as number;
    const rejectionsOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.rejections())).map((r) => r.reason);
    const drawnOf = (p: Player) =>
      p.page.evaluate(
        () =>
          (
            window.__ashbound!.game.world as unknown as {
              view: { modules: { count: number } };
            }
          ).view.modules.count,
      );
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) {
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
        await expect
          .poll(() => scrapOf(p), { ...slow, message: `${p.name} sees the pool` })
          .toBe(200);
      }

      // Ada builds a turret: one more cell in everyone's world, drawn on both screens, paid from the one pool.
      const cell = await ada.page.evaluate(
        ([state]) => window.__ashbound!.mp!.placeNear(4, 0, state!),
        [TURRET_STATE] as const,
      );
      await expectSameWorld(everyone, 1);
      for (const p of everyone) {
        await expect
          .poll(() => drawnOf(p), { ...slow, message: `${p.name} draws the turret` })
          .toBe(1);
        await expect
          .poll(() => scrapOf(p), { ...slow, message: `${p.name} sees the pool` })
          .toBe(200 - TURRET_PRICE);
        expect(await shotsOf(p), `${p.name}: nothing to shoot at yet`).toEqual([]);
      }

      // The host sends a crawler within its range, and the host's simulation fires the turret at it.
      expect(await sendCrawlerNear(host.page, cell)).not.toBeNull();
      for (const p of everyone) {
        await expect
          .poll(async () => (await shotsOf(p)).length, {
            ...slow,
            message: `${p.name} sees the turret fire`,
          })
          .toBeGreaterThan(0);
        const first = (await shotsOf(p))[0]!;
        // The shot names the turret's cell and no player, and struck the machine.
        expect(first.turret, p.name).toEqual([cell.x, cell.y, cell.z]);
        expect(first.by, p.name).toBe(NO_PLAYER);
        expect(first.predicted, p.name).toBe(false);
        expect(first.flags & SHOT_FLAG.enemy, p.name).toBe(SHOT_FLAG.enemy);
        // The head on this screen points along the line from the pivot to where the bolt ended.
        const seen = await barrelOf(p.page, cell);
        expect(seen, `${p.name} draws the head`).not.toBeNull();
        for (let i = 0; i < 3; i++) {
          expect(seen!.tip[i]!, `${p.name}, axis ${i}`).toBeCloseTo(seen!.want[i]!, 4);
        }
        expect(seen!.turned[0]! !== 0 || seen!.turned[1]! !== 0, `${p.name}: turned`).toBe(true);
      }

      // The crawler falls to it on every screen, to one killing shot, and the kill is the crew's.
      const wanted = Math.ceil(ENEMIES.crawler.health / TURRET.levels[0]!.damage);
      for (const p of everyone) {
        await expect
          .poll(async () => (await machinesOf(p)).length, {
            ...slow,
            message: `${p.name} sees it gone`,
          })
          .toBe(0);
        await expect
          .poll(async () => (await shotsOf(p)).filter((s) => s.flags & SHOT_FLAG.kill).length, {
            ...slow,
            message: `${p.name} sees it fall once`,
          })
          .toBe(1);
        expect((await shotsOf(p)).length, p.name).toBeGreaterThanOrEqual(wanted);
        await expect
          .poll(async () => (await clockOf(p)).felled, {
            ...slow,
            message: `${p.name} counts the kill`,
          })
          .toBe(1);
      }

      // The host breaks the turret: gone from every screen, the price back, and a new crawler is left alone.
      await host.page.evaluate(([x, y, z]) => window.__ashbound!.mp!.breakBlock(x!, y!, z!), [
        cell.x,
        cell.y,
        cell.z,
      ] as const);
      await expectSameWorld(everyone, 0);
      for (const p of everyone) {
        await expect.poll(() => drawnOf(p), { ...slow, message: `${p.name}: gone` }).toBe(0);
        await expect.poll(() => scrapOf(p), { ...slow, message: `${p.name}: refund` }).toBe(200);
      }
      const fired = (await shotsOf(host)).length;
      expect(await sendCrawlerNear(host.page, cell)).not.toBeNull();
      await expect
        .poll(async () => (await machinesOf(host)).length, { ...slow, message: 'the host sees it' })
        .toBe(1);
      await host.page.waitForTimeout(3000);
      expect(await shotsOf(host)).toHaveLength(fired);
      for (const p of everyone) expect(await rejectionsOf(p), p.name).toEqual([]);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("the crew's research is the host's: a guest's padlocks and toasts follow the host's points, and the host turns away a material the points have not opened", async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host');
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone: Player[] = [host, ada];
    // A page draws a frame every 1.5 seconds here, and the picture and the hands only change when one is drawn.
    const slow = { timeout: 60_000 };
    const [compositeAt, alloyAt] = RESEARCH.steps.map((step) => step.points) as [number, number];
    const poolOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.pool());
    const rejectionsOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.rejections())).map((r) => r.reason);
    const slotOf = (p: Player, n: number) => p.page.locator('.ph-slot').nth(n);
    const setResearch = (points: number) =>
      host.page.evaluate((n) => window.__ashbound!.mp!.setResearch(n), points);
    // Her seat is on a rise, so the view has to look steeply down to meet ground within reach; what a click
    // there would be refused for is what the ghost's colour comes from.
    const aimOf = (p: Player) =>
      p.page.evaluate(() => {
        const { game, build } = window.__ashbound!;
        game.look.pitch = -0.9;
        const aim = build!.aim();
        return aim.hasPlace ? aim.placeRefusal : 'no ground to place on';
      });
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) {
        await recordToasts(p.page);
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
      }

      // A run opens with no points: both screens have the three padlocks.
      for (const p of everyone) {
        await expect
          .poll(() => poolOf(p), { ...slow, message: `${p.name} sees the points` })
          .toMatchObject({ research: 0, tier: 1 });
        for (const n of [1, 2, 3])
          await expect(slotOf(p, n)).toHaveAttribute('data-locked', '', slow);
      }

      // The host's points reach the guest, who works out the tier as the host does: Composite opens on
      // both screens and Alloy does not, and both are told, the points first and then what they opened
      // (the Power row on the way, since it asks for fewer points than the first material).
      await setResearch(compositeAt);
      for (const p of everyone) {
        await expect
          .poll(() => poolOf(p), { ...slow, message: `${p.name} sees the points` })
          .toMatchObject({ research: compositeAt, tier: 2 });
        await expect(slotOf(p, 1)).not.toHaveAttribute('data-locked', '', slow);
        await expect(slotOf(p, 2)).toHaveAttribute('data-locked', '', slow);
        await expect
          .poll(
            async () => (await toasts(p.page)).filter((t) => /^Research \+|unlocked$/.test(t)),
            {
              ...slow,
              message: `${p.name} is told`,
            },
          )
          .toEqual([`Research +${compositeAt}`, 'Power unlocked', 'Reinforced Composite unlocked']);
      }

      // Both materials are in the pool, so only the points decide. Ada asks past her screen: the host
      // turns the Alloy away in words, to her alone, and takes the Composite.
      await host.page.evaluate(
        ([composite, alloy]) => {
          const mp = window.__ashbound!.mp!;
          mp.setPool(composite!, 5);
          mp.setPool(alloy!, 5);
        },
        [MATERIAL.composite, MATERIAL.alloy] as const,
      );
      await ada.page.evaluate(([state]) => window.__ashbound!.mp!.placeNear(4, 0, state!), [
        ALLOY,
      ] as const);
      await expect
        .poll(() => rejectionsOf(ada), { ...slow, message: 'the host turns Ada down' })
        .toEqual([needsResearch('Advanced Alloy')]);
      expect(await rejectionsOf(host)).toEqual([]);
      await expectSameWorld(everyone, 0);
      await ada.page.evaluate(([state]) => window.__ashbound!.mp!.placeNear(4, 0, state!), [
        COMPOSITE,
      ] as const);
      await expectSameWorld(everyone, 1);
      for (const p of everyone) {
        await expect
          .poll(async () => (await poolOf(p)).stock[1], { ...slow, message: p.name })
          .toBe(4);
      }

      // Ada's own screen knows before she clicks: her aim with the Alloy in hand is read from her copy
      // of the points.
      await ada.page.locator('.play-button').click();
      await expect(ada.page.locator('#hud')).toHaveAttribute('data-pointer', 'locked', slow);
      await ada.page.keyboard.press('Digit3');
      await expect
        .poll(() => aimOf(ada), { ...slow, message: "Ada's aim is refused for the points" })
        .toBe(needsResearch('Advanced Alloy'));

      // The host reaches the next row, and her aim clears without her doing a thing.
      await setResearch(alloyAt);
      await expect.poll(() => aimOf(ada), { ...slow, message: "Ada's aim clears" }).toBeNull();
      for (const p of everyone)
        await expect(slotOf(p, 2)).not.toHaveAttribute('data-locked', '', slow);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("the crew's points wait for a Terminal on every screen: the padlock stays and the pill says so, a guest's Terminal reads them for everyone, and breaking it takes nothing away", async ({
    browser,
    baseURL,
  }) => {
    // The crew's pool is the host's, and opens with more than the Terminal's price.
    const host = await openPlayer(browser, baseURL, 'Host', { stock: 200 });
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone: Player[] = [host, ada];
    // A page draws a frame every 1.5 seconds here, and the picture only changes when one is drawn.
    const slow = { timeout: 60_000 };
    const compositeAt = RESEARCH.steps[0]?.points as number;
    const poolOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.pool());
    const slotOf = (p: Player, n: number) => p.page.locator('.ph-slot').nth(n);
    const researchToasts = async (p: Player) =>
      (await toasts(p.page)).filter(
        (t) => /^Research \+|unlocked$/.test(t) || t === 'Needs a Research Terminal',
      );
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) {
        await recordToasts(p.page);
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
      }

      // The host's points reach both screens and wait: no tier opens, the padlock stays, the pill and
      // the toasts say that only a Terminal is missing.
      await host.page.evaluate((n) => window.__ashbound!.mp!.setResearch(n, false), compositeAt);
      for (const p of everyone) {
        await expect
          .poll(() => poolOf(p), { ...slow, message: `${p.name} sees the points` })
          .toMatchObject({ research: compositeAt, claimed: 0, tier: 1 });
        await expect(slotOf(p, 1)).toHaveAttribute('data-locked', '', slow);
        await expect(p.page.locator('.ph-research')).toHaveAttribute('data-tone', 'waiting', slow);
        await expect(p.page.locator('.ph-research-label')).toHaveText('Needs Terminal', slow);
        await expect
          .poll(() => researchToasts(p), { ...slow, message: `${p.name} is told` })
          .toEqual([`Research +${compositeAt}`, 'Needs a Research Terminal']);
      }

      // Ada builds a Terminal: the host reads the points the moment it stands, and the Power row and
      // Composite open on both screens, each told what it opened.
      const cell = await ada.page.evaluate(
        ([state]) => window.__ashbound!.mp!.placeNear(4, 0, state!),
        [TERMINAL] as const,
      );
      await expectSameWorld(everyone, 1);
      for (const p of everyone) {
        await expect
          .poll(() => poolOf(p), { ...slow, message: `${p.name} sees the reading` })
          .toMatchObject({ research: compositeAt, claimed: compositeAt, tier: 2 });
        await expect(slotOf(p, 1)).not.toHaveAttribute('data-locked', '', slow);
        await expect(p.page.locator('.ph-research')).toHaveAttribute('data-tone', 'rising', slow);
        await expect
          .poll(() => researchToasts(p), { ...slow, message: `${p.name} is told` })
          .toEqual([
            `Research +${compositeAt}`,
            'Needs a Research Terminal',
            'Power unlocked',
            'Reinforced Composite unlocked',
          ]);
      }

      // The host breaks it: what was read stays open on both screens.
      await host.page.evaluate(([x, y, z]) => window.__ashbound!.mp!.breakBlock(x!, y!, z!), [
        cell.x,
        cell.y,
        cell.z,
      ] as const);
      await expectSameWorld(everyone, 0);
      for (const p of everyone) {
        await expect
          .poll(() => poolOf(p), { ...slow, message: `${p.name} still has the tier` })
          .toMatchObject({ claimed: compositeAt, tier: 2 });
        await expect(slotOf(p, 1)).not.toHaveAttribute('data-locked', '', slow);
      }
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("an upgrade is the host's to allow: a guest's swaps the block in every world and the one pool pays for the better piece, a player who joins later is shown it, and the host turns away a material the points have not opened, a pool that cannot pay and a block that is not the one she saw", async ({
    browser,
    baseURL,
  }) => {
    // The crew's pool is the host's, and opens with plenty of every material.
    const host = await openPlayer(browser, baseURL, 'Host', { stock: 200 });
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone: Player[] = [host, ada];
    // A page draws a frame every 1.5 seconds here, and the picture and the hands only change when one is drawn.
    const slow = { timeout: 60_000 };
    const [compositeAt, alloyAt] = RESEARCH.steps.map((step) => step.points) as [number, number];
    const stockOf = async (p: Player, material: number) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.pool())).stock[material - 1] as number;
    const rejectionsOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.rejections())).map((r) => r.reason);
    const upgradesOf = async (p: Player) => (await clockOf(p)).upgraded;
    const cellOf = (p: Player, at: { x: number; y: number; z: number }) =>
      p.page.evaluate(([x, y, z]) => window.__ashbound!.mp!.block(x!, y!, z!), [
        at.x,
        at.y,
        at.z,
      ] as const);
    const upgrade = (p: Player, at: { x: number; y: number; z: number }, shown?: number) =>
      p.page.evaluate(([x, y, z, s]) => window.__ashbound!.mp!.upgrade(x!, y!, z!, s), [
        at.x,
        at.y,
        at.z,
        shown,
      ] as const);
    /** Every screen shows this block in the cell, this much of a material in the pool, and this many upgrades on the card. */
    const expectEverywhere = async (
      at: { x: number; y: number; z: number },
      state: number,
      stock: readonly [number, number],
      upgrades: number,
    ) => {
      for (const p of everyone) {
        await expect
          .poll(() => cellOf(p, at), { ...slow, message: `${p.name} sees the cell` })
          .toBe(state);
        await expect
          .poll(() => stockOf(p, stock[0]), { ...slow, message: `${p.name} sees the pool` })
          .toBe(stock[1]);
        await expect
          .poll(() => upgradesOf(p), { ...slow, message: `${p.name} counts the upgrades` })
          .toBe(upgrades);
      }
    };
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) {
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
        await expect
          .poll(() => stockOf(p, MATERIAL.scrap), { ...slow, message: `${p.name} sees the pool` })
          .toBe(200);
      }

      // Ada's Scrap block is in everyone's world, paid from the one pool; the crew reads Composite.
      const cell = await ada.page.evaluate(
        ([state]) => window.__ashbound!.mp!.placeNear(4, 0, state!),
        [SCRAP] as const,
      );
      await expectSameWorld(everyone, 1);
      await expectEverywhere(cell, SCRAP, [MATERIAL.scrap, 199], 0);
      await host.page.evaluate((n) => window.__ashbound!.mp!.setResearch(n), compositeAt);
      for (const p of everyone) {
        await expect
          .poll(async () => (await p.page.evaluate(() => window.__ashbound!.mp!.pool())).tier, {
            ...slow,
            message: `${p.name} reads the tier`,
          })
          .toBe(2);
      }

      // Ada upgrades it: the same cell holds Composite in every world, the better piece comes out of
      // the pool and nothing goes back for the old one, and every card counts the upgrade.
      await upgrade(ada, cell);
      await expectEverywhere(cell, COMPOSITE, [MATERIAL.composite, 199], 1);
      for (const p of everyone) expect(await stockOf(p, MATERIAL.scrap), p.name).toBe(199);
      await expectSameWorld(everyone, 1);
      expect(await rejectionsOf(ada)).toEqual([]);
      expect(await rejectionsOf(host)).toEqual([]);

      // Alloy is past the points: the host turns it away in words, to Ada alone, and nothing changes.
      await upgrade(ada, cell);
      await expect
        .poll(() => rejectionsOf(ada), { ...slow, message: 'the host turns Ada down' })
        .toEqual([needsResearch('Advanced Alloy')]);
      expect(await rejectionsOf(host)).toEqual([]);
      await expectEverywhere(cell, COMPOSITE, [MATERIAL.composite, 199], 1);

      // The points are there and the Alloy is not: the pool is what Ada is turned away for.
      await host.page.evaluate((n) => window.__ashbound!.mp!.setResearch(n), alloyAt);
      await host.page.evaluate(([material]) => window.__ashbound!.mp!.setPool(material!, 0), [
        MATERIAL.alloy,
      ] as const);
      await upgrade(ada, cell);
      await expect
        .poll(() => rejectionsOf(ada), { ...slow, message: 'the host turns Ada down again' })
        .toEqual([needsResearch('Advanced Alloy'), notEnough('Advanced Alloy')]);
      await expectEverywhere(cell, COMPOSITE, [MATERIAL.composite, 199], 1);

      // Her screen believed the block was Scrap and asks for Composite: it is Composite now, and the
      // host will not swap a block for the one she did not see.
      await upgrade(ada, cell, COMPOSITE);
      await expect
        .poll(() => rejectionsOf(ada), { ...slow, message: 'the host turns Ada down a third time' })
        .toEqual([
          needsResearch('Advanced Alloy'),
          notEnough('Advanced Alloy'),
          'that block has changed',
        ]);
      await expectEverywhere(cell, COMPOSITE, [MATERIAL.composite, 199], 1);

      // The host puts Alloy back, and the same press goes through.
      await host.page.evaluate(([material]) => window.__ashbound!.mp!.setPool(material!, 5), [
        MATERIAL.alloy,
      ] as const);
      await upgrade(ada, cell);
      await expectEverywhere(cell, ALLOY, [MATERIAL.alloy, 4], 2);

      // A player who joins now is shown the better block with the rest of the world, and the count.
      const bo = await openPlayer(browser, baseURL, 'Bo');
      everyone.push(bo);
      await joinRoom(bo, code);
      await expectSameWorld(everyone, 1);
      await expectEverywhere(cell, ALLOY, [MATERIAL.alloy, 4], 2);
      expect(await rejectionsOf(host)).toEqual([]);
      expect(await rejectionsOf(bo)).toEqual([]);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("a turret is raised by the host's rules: a guest's raise changes the turret in every world and the one pool pays for the better level, the host turns away what the points have not opened, a pool that cannot pay and a turret that is not the one she saw, every screen draws the bolt of the level it sees, and a player who joins later is shown the raised turret", async ({
    browser,
    baseURL,
  }) => {
    // The crew's pool is the host's, and opens with plenty of every material.
    const host = await openPlayer(browser, baseURL, 'Host', { stock: 200 });
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone: Player[] = [host, ada];
    // A page draws a frame every 1.5 seconds here, and the picture and the hands only change when one is drawn.
    const slow = { timeout: 60_000 };
    const [compositeAt, alloyAt] = RESEARCH.steps.map((step) => step.points) as [number, number];
    const turretAt = (level: number) => packState(moduleShape(MODULE.turret, 0), level);
    const autoCost = pieceCost(turretAt(2))!;
    const heavyCost = pieceCost(turretAt(3))!;
    type Spot = { x: number; y: number; z: number };
    const stockOf = async (p: Player, material: number) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.pool())).stock[material - 1] as number;
    const rejectionsOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.rejections())).map((r) => r.reason);
    const upgradesOf = async (p: Player) => (await clockOf(p)).upgraded;
    const cellOf = (p: Player, at: Spot) =>
      p.page.evaluate(([x, y, z]) => window.__ashbound!.mp!.block(x!, y!, z!), [
        at.x,
        at.y,
        at.z,
      ] as const);
    /** The level the module this screen draws in a cell says it is; null where it draws none. */
    const levelOf = (p: Player, at: Spot) =>
      p.page.evaluate(
        ([x, y, z]) =>
          (
            window.__ashbound!.game.world as unknown as {
              view: {
                modules: {
                  at(x: number, y: number, z: number): { userData: { level: number } } | undefined;
                };
              };
            }
          ).view.modules.at(x!, y!, z!)?.userData.level ?? null,
        [at.x, at.y, at.z] as const,
      );
    /** How heavy this screen drew each bolt the turrets fired. */
    const heftsOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.shots().shots))
        .filter((shot) => shot.turret)
        .map((shot) => shot.heft);
    const machinesOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.enemies());
    const upgrade = (p: Player, at: Spot, shown?: number) =>
      p.page.evaluate(([x, y, z, s]) => window.__ashbound!.mp!.upgrade(x!, y!, z!, s), [
        at.x,
        at.y,
        at.z,
        shown,
      ] as const);
    /** Every screen shows this turret in the cell, drawn at this level, this much of a material in the pool, and this many upgrades on the card. */
    const expectEverywhere = async (
      at: Spot,
      level: number,
      stock: readonly [number, number],
      upgrades: number,
    ) => {
      for (const p of everyone) {
        await expect
          .poll(() => cellOf(p, at), { ...slow, message: `${p.name} sees the cell` })
          .toBe(turretAt(level));
        await expect
          .poll(() => levelOf(p, at), { ...slow, message: `${p.name} draws the level` })
          .toBe(level);
        await expect
          .poll(() => stockOf(p, stock[0]), { ...slow, message: `${p.name} sees the pool` })
          .toBe(stock[1]);
        await expect
          .poll(() => upgradesOf(p), { ...slow, message: `${p.name} counts the upgrades` })
          .toBe(upgrades);
      }
    };
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) {
        await expect.poll(async () => (await clockOf(p)).running, { message: p.name }).toBe(true);
        await expect
          .poll(() => stockOf(p, MATERIAL.scrap), { ...slow, message: `${p.name} sees the pool` })
          .toBe(200);
      }

      // Ada's Basic Turret is in everyone's world, paid from the one pool, drawn at its first level.
      const cell = await ada.page.evaluate(
        ([state]) => window.__ashbound!.mp!.placeNear(4, 0, state!),
        [turretAt(1)] as const,
      );
      await expectSameWorld(everyone, 1);
      await expectEverywhere(cell, 1, [MATERIAL.scrap, 200 - TURRET_PRICE], 0);

      // The Auto Turret is paid in Reinforced Composite, which the points have not opened: the host
      // turns Ada away in words, to Ada alone, and nothing changes.
      await upgrade(ada, cell);
      await expect
        .poll(() => rejectionsOf(ada), { ...slow, message: 'the host turns Ada down' })
        .toEqual([needsResearch(autoCost.name)]);
      expect(await rejectionsOf(host)).toEqual([]);
      await expectEverywhere(cell, 1, [MATERIAL.scrap, 200 - TURRET_PRICE], 0);

      // The crew reads Composite, and the same press goes through: the same cell holds the Auto Turret
      // in every world and on every screen, the better level comes out of the pool, nothing goes back
      // for the Basic Turret, and every card counts the upgrade.
      await host.page.evaluate((n) => window.__ashbound!.mp!.setResearch(n), compositeAt);
      for (const p of everyone) {
        await expect
          .poll(async () => (await p.page.evaluate(() => window.__ashbound!.mp!.pool())).tier, {
            ...slow,
            message: `${p.name} reads the tier`,
          })
          .toBe(2);
      }
      await upgrade(ada, cell);
      await expectEverywhere(cell, 2, [autoCost.material, 200 - autoCost.amount], 1);
      for (const p of everyone)
        expect(await stockOf(p, MATERIAL.scrap), p.name).toBe(200 - TURRET_PRICE);
      await expectSameWorld(everyone, 1);
      expect(await rejectionsOf(ada)).toEqual([needsResearch(autoCost.name)]);
      expect(await rejectionsOf(host)).toEqual([]);

      // Alloy is past the points: the Heavy Turret is turned away in words, to Ada alone.
      await upgrade(ada, cell);
      await expect
        .poll(() => rejectionsOf(ada), { ...slow, message: 'the host turns Ada down again' })
        .toEqual([needsResearch(autoCost.name), needsResearch(heavyCost.name)]);
      await expectEverywhere(cell, 2, [autoCost.material, 200 - autoCost.amount], 1);

      // The points are there and the Alloy is not: the pool is what Ada is turned away for.
      await host.page.evaluate((n) => window.__ashbound!.mp!.setResearch(n), alloyAt);
      await host.page.evaluate(
        ([material, amount]) => window.__ashbound!.mp!.setPool(material!, amount!),
        [heavyCost.material, heavyCost.amount - 1] as const,
      );
      await upgrade(ada, cell);
      await expect
        .poll(() => rejectionsOf(ada), { ...slow, message: 'the host turns Ada down a third time' })
        .toEqual([
          needsResearch(autoCost.name),
          needsResearch(heavyCost.name),
          notEnough(heavyCost.name),
        ]);
      await expectEverywhere(cell, 2, [autoCost.material, 200 - autoCost.amount], 1);

      // Her screen believed the turret was still the Basic one and asks for the Auto Turret: it is the
      // Auto Turret now, and the host will not raise a turret she did not see.
      await upgrade(ada, cell, turretAt(2));
      await expect
        .poll(() => rejectionsOf(ada), {
          ...slow,
          message: 'the host turns Ada down a fourth time',
        })
        .toEqual([
          needsResearch(autoCost.name),
          needsResearch(heavyCost.name),
          notEnough(heavyCost.name),
          'that block has changed',
        ]);
      await expectEverywhere(cell, 2, [autoCost.material, 200 - autoCost.amount], 1);

      // The host puts the Alloy back, and the same press raises the Heavy Turret on every screen,
      // Composite as the first raise left it.
      await host.page.evaluate(
        ([material, amount]) => window.__ashbound!.mp!.setPool(material!, amount!),
        [heavyCost.material, heavyCost.amount + 5] as const,
      );
      await upgrade(ada, cell);
      await expectEverywhere(cell, 3, [heavyCost.material, 5], 2);
      for (const p of everyone) {
        expect(await stockOf(p, autoCost.material), p.name).toBe(200 - autoCost.amount);
      }

      // The host sends a crawler within its range. Every screen draws the Heavy Turret's bolts, the
      // weight of the level it sees the turret at, and the machine falls to the heavier shot.
      expect(await sendCrawlerNear(host.page, cell)).not.toBeNull();
      const heavy = TURRET.levels[2]!;
      for (const p of everyone) {
        await expect
          .poll(async () => (await heftsOf(p)).length, {
            ...slow,
            message: `${p.name} sees the turret fire`,
          })
          .toBeGreaterThan(0);
        await expect
          .poll(async () => (await machinesOf(p)).length, {
            ...slow,
            message: `${p.name} sees it gone`,
          })
          .toBe(0);
        const hefts = await heftsOf(p);
        expect(hefts, p.name).toEqual(hefts.map(() => heavy.heft));
        expect(hefts.length, p.name).toBeLessThan(
          Math.ceil(ENEMIES.crawler.health / TURRET.levels[0]!.damage),
        );
      }

      // A player who joins now is shown the Heavy Turret with the rest of the world, drawn at its level.
      const bo = await openPlayer(browser, baseURL, 'Bo');
      everyone.push(bo);
      await joinRoom(bo, code);
      await expectSameWorld(everyone, 1);
      await expectEverywhere(cell, 3, [heavyCost.material, 5], 2);
      expect(await rejectionsOf(host)).toEqual([]);
      expect(await rejectionsOf(bo)).toEqual([]);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("a Generator charges the guest beside it on the guest's own screen: the crew's points open it, every screen draws it, the host far away is not charged, and breaking it ends the charge", async ({
    browser,
    baseURL,
  }) => {
    // The crew's pool is the host's, and opens with plenty of every material.
    const host = await openPlayer(browser, baseURL, 'Host', { stock: 200 });
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone: Player[] = [host, ada];
    // A page draws a frame every 1.5 seconds here, and the picture and the corner only change when one is drawn.
    const slow = { timeout: 60_000 };
    const vitalsOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.vitals());
    const chargingOf = async (p: Player) => (await vitalsOf(p)).charging;
    const rejectionsOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.rejections())).map((r) => r.reason);
    const drawnOf = (p: Player) =>
      p.page.evaluate(
        () =>
          (
            window.__ashbound!.game.world as unknown as {
              view: { modules: { count: number } };
            }
          ).view.modules.count,
      );
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      const adaId = (await session(ada)).localId;

      // The Core's own field reaches eight blocks from it, so each of them goes out of it to a ring
      // thirteen blocks from the Core, to different sides of it: Ada to one, the host to the other,
      // far enough apart that nothing Ada builds reaches the host. The host works out who is charged
      // from where it was last told that they stand, so it is first made sure of where Ada is.
      const adaAt = await hopFromTheCore(ada.page, 13, 0.9);
      await hopFromTheCore(host.page, 13, -0.9);
      await expect
        .poll(
          async () => {
            const seen = (await remotes(host)).find((r) => r.name === 'Ada');
            return !!seen && Math.hypot(seen.x - adaAt.x, seen.z - adaAt.z) < 2;
          },
          { ...slow, message: 'the host sees Ada in place' },
        )
        .toBe(true);
      for (const p of everyone) {
        await expect
          .poll(() => chargingOf(p), { ...slow, message: `${p.name} is out of the Core's field` })
          .toBe(false);
      }
      const buildNear = (dx: number) =>
        ada.page.evaluate(([x, state]) => window.__ashbound!.mp!.placeNear(x!, 0, state!), [
          dx,
          GENERATOR_STATE,
        ] as const);

      // The Power points are not in: the host turns Ada's Generator away, in words, to Ada alone.
      await buildNear(3);
      await expect
        .poll(() => rejectionsOf(ada), { ...slow, message: 'the host turns Ada down' })
        .toEqual([needsResearch(GENERATOR_NAME)]);
      expect(await rejectionsOf(host)).toEqual([]);
      await expectSameWorld(everyone, 0);

      // The crew's points reach the row, and the same placement stands: in both worlds, and drawn on both screens.
      await host.page.evaluate((n) => window.__ashbound!.mp!.setResearch(n), POWER_AT);
      const cell = await buildNear(3);
      await expectSameWorld(everyone, 1);
      for (const p of everyone) {
        await expect.poll(() => drawnOf(p), { ...slow, message: `${p.name} draws it` }).toBe(1);
      }

      // Ada's battery is low and Ada stands three blocks from the Generator: the host tells Ada's screen
      // that Ada is charged, and the Energy climbs. The host, far on the other side of the Core, is not.
      await host.page.evaluate((id) => window.__ashbound!.mp!.setVitals({ energy: 30 }, id), adaId);
      await standAt(ada.page, cell.x + 0.5 - 3, cell.z + 0.5);
      await expect.poll(() => chargingOf(ada), { ...slow, message: 'Ada is charged' }).toBe(true);
      await expect(ada.page.locator('.ph-status-label')).toHaveText('Charging', slow);
      expect(await chargingOf(host)).toBe(false);
      await host.page.evaluate(() => window.__ashbound!.mp!.warp(10));
      await expect
        .poll(async () => (await vitalsOf(ada)).energy, { ...slow, message: "Ada's Energy climbs" })
        .toBeGreaterThan(36);
      expect(await chargingOf(host)).toBe(false);

      // Out of its reach Ada is not charged, and back within it Ada is again (a hop of ten blocks, which the host believes).
      await standAt(ada.page, cell.x + 0.5 - 3 - 10, cell.z + 0.5);
      await expect
        .poll(() => chargingOf(ada), { ...slow, message: 'Ada walks out of the reach' })
        .toBe(false);
      await standAt(ada.page, cell.x + 0.5 - 3, cell.z + 0.5);
      await expect
        .poll(() => chargingOf(ada), { ...slow, message: 'Ada walks back in' })
        .toBe(true);

      // Ada breaks it: gone from both worlds and both screens, and the charge stops on Ada's screen.
      await ada.page.evaluate(([x, y, z]) => window.__ashbound!.mp!.breakBlock(x!, y!, z!), [
        cell.x,
        cell.y,
        cell.z,
      ] as const);
      await expectSameWorld(everyone, 0);
      for (const p of everyone) {
        await expect.poll(() => drawnOf(p), { ...slow, message: `${p.name} draws none` }).toBe(0);
      }
      await expect.poll(() => chargingOf(ada), { ...slow, message: 'the charge ends' }).toBe(false);
      expect(await rejectionsOf(host)).toEqual([]);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("power is worked out on every screen from the world's own edits: a Generator and a Power Node light a turret and a Light on the guest's screen as they do on the host's, the Light's lamp burns on both while it has power, and breaking the Generator puts them out", async ({
    browser,
    baseURL,
  }) => {
    // The crew's pool is the host's, and opens with plenty of every material.
    const host = await openPlayer(browser, baseURL, 'Host', { stock: 200 });
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone: Player[] = [host, ada];
    // A page draws a frame every 1.5 seconds here, and the screen only changes when one is drawn.
    const slow = { timeout: 60_000 };
    interface Cell {
      x: number;
      y: number;
      z: number;
    }
    /** What this screen works out the module in a cell has of power: 'on', 'off', or 'none'. */
    const powerOf = (p: Player, cell: Cell) =>
      p.page.evaluate(
        ([x, y, z]) =>
          (
            window.__ashbound!.game.world as unknown as {
              power: { stateAt(x: number, y: number, z: number): string };
            }
          ).power.stateAt(x!, y!, z!),
        [cell.x, cell.y, cell.z] as const,
      );
    /** Whether the lights of the module this screen draws in a cell are up. */
    const litOf = (p: Player, cell: Cell) =>
      p.page.evaluate(
        ([x, y, z]) =>
          (
            window.__ashbound!.game.world as unknown as {
              view: {
                modules: { isPowered(x: number, y: number, z: number): boolean | null };
              };
            }
          ).view.modules.isPowered(x!, y!, z!),
        [cell.x, cell.y, cell.z] as const,
      );
    /** How many lamps burn on this screen: the Lights that have power, which the stage throws light from. */
    const lampsOf = (p: Player) =>
      p.page.evaluate(() => window.__ashbound!.stage.atmosphere.lamps.burning);
    const rejectionsOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.rejections())).map((r) => r.reason);
    /** Waits until the module in a cell has this power, and its lights this state, on every screen. */
    const expectEverywhere = async (cell: Cell, power: string, lit: boolean, what: string) => {
      for (const p of everyone) {
        await expect
          .poll(() => powerOf(p, cell), { ...slow, message: `${p.name} sees ${what} ${power}` })
          .toBe(power);
        await expect
          .poll(() => litOf(p, cell), { ...slow, message: `${p.name} draws ${what} lit: ${lit}` })
          .toBe(lit);
      }
    };
    /** Waits until this many lamps burn on every screen. */
    const expectLamps = async (count: number, what: string) => {
      for (const p of everyone) {
        await expect
          .poll(() => lampsOf(p), { ...slow, message: `${p.name} has ${what}` })
          .toBe(count);
      }
    };
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      // The Camp row opens the Light, and the Power row below it opens the Generator and the Node.
      await host.page.evaluate((n) => window.__ashbound!.mp!.setResearch(n), CAMP_AT);

      // Ada goes out to a ring thirteen blocks from the Core, where the ground round her is open, and
      // the host is told where she stands before she builds.
      const adaAt = await hopFromTheCore(ada.page, 13, 0.9);
      await expectSeen(host, 'Ada', adaAt);
      const buildNear = (state: number, dx: number, dz: number): Promise<Cell> =>
        ada.page.evaluate(([a, b, s]) => window.__ashbound!.mp!.placeNear(a!, b!, s!), [
          dx,
          dz,
          state,
        ] as const);

      // A turret and a Light on their own have no power on either screen, and their lights are down on both.
      const turret = await buildNear(TURRET_STATE, 3, 0);
      await expectSameWorld(everyone, 1);
      await expectEverywhere(turret, 'off', false, 'the turret');
      const light = await buildNear(LIGHT_STATE, 0, -6);
      await expectSameWorld(everyone, 2);
      await expectEverywhere(light, 'off', false, 'the Light');
      await expectLamps(0, 'no lamp burning without power');

      // A Generator seven blocks from the turret and from the Light is beyond its reach of both: the Generator burns, and they have none.
      const generator = await buildNear(GENERATOR_STATE, -4, 0);
      await expectSameWorld(everyone, 3);
      await expectEverywhere(generator, 'on', true, 'the Generator');
      await expectEverywhere(turret, 'off', false, 'the turret');
      await expectEverywhere(light, 'off', false, 'the Light');
      await expectLamps(0, 'no lamp burning beyond the Generator');

      // A Power Node between them takes the power from the Generator and passes it on to the turret and the Light.
      const node = await buildNear(NODE_STATE, 0, -3);
      await expectSameWorld(everyone, 4);
      await expectEverywhere(node, 'on', true, 'the Node');
      await expectEverywhere(turret, 'on', true, 'the turret');
      await expectEverywhere(light, 'on', true, 'the Light');
      await expectLamps(1, 'the Light’s lamp burning');

      // The host walks up to the Generator and breaks it: the guest's screen follows the host's, and the
      // Node, the turret and the Light go dark on both.
      const hostAt = { x: generator.x + 0.5 + 2, z: generator.z + 0.5 };
      await standAt(host.page, hostAt.x, hostAt.z);
      await expectSeen(ada, 'Host', hostAt);
      await host.page.evaluate(([x, y, z]) => window.__ashbound!.mp!.breakBlock(x!, y!, z!), [
        generator.x,
        generator.y,
        generator.z,
      ] as const);
      await expectSameWorld(everyone, 3);
      await expectEverywhere(node, 'off', false, 'the Node');
      await expectEverywhere(turret, 'off', false, 'the turret');
      await expectEverywhere(light, 'off', false, 'the Light');
      await expectLamps(0, 'the lamp put out');
      expect(await rejectionsOf(host)).toEqual([]);
      expect(await rejectionsOf(ada)).toEqual([]);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("a Storage lets the whole crew's pool hold more: a guest's build raises the ceiling on every screen, each says so and turns its count amber at the new ceiling, and the host breaking it takes the room back and leaves the stock", async ({
    browser,
    baseURL,
  }) => {
    // The crew's pool is the host's, and opens with plenty of every material.
    const host = await openPlayer(browser, baseURL, 'Host', { stock: 200 });
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone: Player[] = [host, ada];
    // A page draws a frame every 1.5 seconds here, and the screen only changes when one is drawn.
    const slow = { timeout: 60_000 };
    const ceilingWith = (storages: number) => POOL.cap + storages * POOL.perStorage;
    const built = (storages: number) =>
      `Storage built · the pool holds ${ceilingWith(storages)} of each`;
    const gone = (storages: number) =>
      `A Storage is gone · the pool holds ${ceilingWith(storages)} of each`;
    const poolOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.pool());
    const rejectionsOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.rejections())).map((r) => r.reason);
    const storageToasts = async (p: Player) =>
      (await toasts(p.page)).filter((t) => /^Storage built|^A Storage is gone/.test(t));
    /** The count on this screen's Scrap slot: amber (`data-full`) where the pool holds all it can. */
    const scrapCount = (p: Player) =>
      p.page.locator('.ph-slot').nth(poolSlot(MATERIAL.scrap)).locator('.ph-count');
    /** Waits until every screen's pool holds this much of any material at most. */
    const expectCeiling = async (storages: number) => {
      for (const p of everyone) {
        await expect
          .poll(async () => (await poolOf(p)).cap, {
            ...slow,
            message: `${p.name} sees a ceiling of ${ceilingWith(storages)}`,
          })
          .toBe(ceilingWith(storages));
      }
    };
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) await recordToasts(p.page);
      await expectCeiling(0);
      await host.page.evaluate((n) => window.__ashbound!.mp!.setResearch(n), CAMP_AT);

      // Ada goes out to a ring thirteen blocks from the Core, where the ground round her is open, and
      // the host is told where she stands before she builds.
      const adaAt = await hopFromTheCore(ada.page, 13, 0.9);
      await expectSeen(host, 'Ada', adaAt);

      // Her Storage stands in every world, and the pool of every screen can hold a Storage's share more.
      const storage = await ada.page.evaluate(
        ([state]) => window.__ashbound!.mp!.placeNear(3, 0, state!),
        [STORAGE_STATE] as const,
      );
      await expectSameWorld(everyone, 1);
      await expectCeiling(1);
      for (const p of everyone) {
        await expect
          .poll(() => storageToasts(p), { ...slow, message: `${p.name} is told` })
          .toEqual([built(1)]);
      }

      // The host fills the pool to the new ceiling, which no pool of 400 could hold: the count turns
      // amber on both screens.
      await host.page.evaluate(
        ([material, amount]) => window.__ashbound!.mp!.setPool(material!, amount!),
        [MATERIAL.scrap, ceilingWith(1)] as const,
      );
      for (const p of everyone) {
        await expect
          .poll(async () => (await poolOf(p)).stock[poolSlot(MATERIAL.scrap)], {
            ...slow,
            message: `${p.name} sees the pool full`,
          })
          .toBe(ceilingWith(1));
        await expect(scrapCount(p), `${p.name}'s count is amber`).toHaveAttribute(
          'data-full',
          '',
          slow,
        );
      }

      // The host walks up to the Storage and breaks it: both ceilings fall, both screens say so, and what
      // the pool holds above the lower ceiling stays, so the count stays amber.
      const hostAt = { x: storage.x + 0.5 + 2, z: storage.z + 0.5 };
      await standAt(host.page, hostAt.x, hostAt.z);
      await expectSeen(ada, 'Host', hostAt);
      await host.page.evaluate(([x, y, z]) => window.__ashbound!.mp!.breakBlock(x!, y!, z!), [
        storage.x,
        storage.y,
        storage.z,
      ] as const);
      await expectSameWorld(everyone, 0);
      await expectCeiling(0);
      for (const p of everyone) {
        await expect
          .poll(() => storageToasts(p), { ...slow, message: `${p.name} is told it is gone` })
          .toEqual([built(1), gone(0)]);
        expect((await poolOf(p)).stock[poolSlot(MATERIAL.scrap)]).toBe(ceilingWith(1));
        await expect(scrapCount(p), `${p.name}'s count stays amber`).toHaveAttribute(
          'data-full',
          '',
          slow,
        );
      }
      expect(await rejectionsOf(host)).toEqual([]);
      expect(await rejectionsOf(ada)).toEqual([]);
      expectNoProblems(everyone);
    } finally {
      await closeAll(everyone);
    }
  });

  test("a Bed is where the Core brings a fallen guest back: her Bed stands on every screen without raising the pool's ceiling, the host puts her in front of it on her screen and its own wherever she fell, and with it broken she is back at her seat", async ({
    browser,
    baseURL,
  }) => {
    const host = await openPlayer(browser, baseURL, 'Host', { stock: 200 });
    const ada = await openPlayer(browser, baseURL, 'Ada');
    const everyone: Player[] = [host, ada];
    // A page draws a frame every 1.5 seconds here, and the screen only changes when one is drawn.
    const slow = { timeout: 60_000 };
    const positionOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.position());
    const vitalsOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.vitals());
    const poolOf = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.pool());
    const rejectionsOf = async (p: Player) =>
      (await p.page.evaluate(() => window.__ashbound!.mp!.rejections())).map((r) => r.reason);
    // What this page draws of the modules: the valley view's renderer, which the typed hook does not name.
    const drawnOf = (p: Player) =>
      p.page.evaluate(
        () =>
          (
            window.__ashbound!.game.world as unknown as {
              view: { modules: { count: number } };
            }
          ).view.modules.count,
      );
    const apart = (a: { x: number; z: number }, b: { x: number; z: number }) =>
      Math.hypot(a.x - b.x, a.z - b.z);
    const respawnsLeft = (n: number) => `${n} ${n === 1 ? 'respawn' : 'respawns'} left`;
    /**
     * Fells Ada where she stands and waits for the Core to bring her back. The Core counts its wait on the
     * run's clock, which a frame every second and a half would take the best part of ten seconds to run
     * through, so the host spends it at once.
     */
    const fellAndBroughtBack = async (id: number) => {
      await host.page.evaluate(([who]) => window.__ashbound!.mp!.hurtPlayer(1000, who!), [
        id,
      ] as const);
      await expect
        .poll(async () => (await vitalsOf(ada)).health, { ...slow, message: 'Ada is down' })
        .toBe(0);
      await host.page.evaluate(
        (seconds) => window.__ashbound!.mp!.warp(seconds),
        RESPAWN.delaySeconds + 1,
      );
      await expect
        .poll(async () => (await vitalsOf(ada)).health, {
          ...slow,
          message: 'the Core brings Ada back',
        })
        .toBe(VITALS.maxHealth);
    };
    try {
      const code = await hostRoom(host);
      await joinRoom(ada, code);
      await expectSeeEachOther(everyone);
      for (const p of everyone) await recordToasts(p.page);
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
      await host.page.evaluate((n) => window.__ashbound!.mp!.setResearch(n), CAMP_AT);
      const ceiling = (await poolOf(host)).cap;

      // Ada goes out to a ring thirteen blocks from the Core and builds a Bed three blocks from where she
      // stands: it stands in every world and on every screen, and the pool holds no more for it.
      const adaAt = await hopFromTheCore(ada.page, 13, 0.9);
      await expectSeen(host, 'Ada', adaAt);
      const bed = await ada.page.evaluate(
        ([state]) => window.__ashbound!.mp!.placeNear(3, 0, state!),
        [BED_STATE] as const,
      );
      await expectSameWorld(everyone, 1);
      const bedMiddle = { x: bed.x + 0.5, z: bed.z + 0.5 };
      expect(apart(bedMiddle, seat), 'the Bed is well away from her seat').toBeGreaterThan(5);
      for (const p of everyone) {
        await expect
          .poll(() => drawnOf(p), { ...slow, message: `${p.name}'s screen draws the Bed` })
          .toBe(1);
        expect((await poolOf(p)).cap).toBe(ceiling);
      }

      // Ada walks off to a spot seven blocks from the Bed, and the host sees her there. She falls there,
      // and the Core brings her back where the Bed is, on her screen and on the host's.
      const fellAt = { x: bedMiddle.x, z: bedMiddle.z + 7 };
      await standAt(ada.page, fellAt.x, fellAt.z);
      await expectSeen(host, 'Ada', fellAt);
      await fellAndBroughtBack(adaId);
      await expect
        .poll(async () => apart(await positionOf(ada), bedMiddle), {
          ...slow,
          message: 'Ada is back at the Bed on her own screen',
        })
        .toBeLessThan(1.6);
      await expectSeen(host, 'Ada', bedMiddle);
      const first = 2 * RESPAWN.startPerPlayer - 1;
      await expect
        .poll(() => toasts(ada.page), slow)
        .toContain(`The Core brought you back, shaken · ${respawnsLeft(first)}`);
      await expect
        .poll(() => toasts(host.page), slow)
        .toContain(`Ada is back, shaken · ${respawnsLeft(first)}`);

      // She breaks the Bed from beside it, and the next fall brings her back at her seat as it always did.
      await ada.page.evaluate(([x, y, z]) => window.__ashbound!.mp!.breakBlock(x!, y!, z!), [
        bed.x,
        bed.y,
        bed.z,
      ] as const);
      await expectSameWorld(everyone, 0);
      for (const p of everyone) {
        await expect
          .poll(() => drawnOf(p), { ...slow, message: `${p.name}'s screen lets the Bed go` })
          .toBe(0);
      }
      const fellAgainAt = { x: bedMiddle.x - 6, z: bedMiddle.z };
      await standAt(ada.page, fellAgainAt.x, fellAgainAt.z);
      await expectSeen(host, 'Ada', fellAgainAt);
      await fellAndBroughtBack(adaId);
      await expect
        .poll(async () => apart(await positionOf(ada), seat), {
          ...slow,
          message: 'Ada is back at her seat with no Bed standing',
        })
        .toBeLessThan(0.6);
      await expectSeen(host, 'Ada', seat);
      await expect
        .poll(() => toasts(ada.page), slow)
        .toContain(`The Core brought you back, shaken · ${respawnsLeft(first - 1)}`);
      expect(await rejectionsOf(host)).toEqual([]);
      expect(await rejectionsOf(ada)).toEqual([]);
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
