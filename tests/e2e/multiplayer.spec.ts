import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';

/**
 * Four browsers play together through a local PeerServer (started by `playwright.config.ts`):
 * one hosts a room, three join it by its code, and they see each other, build and break blocks
 * in sync, and learn what happened when the host goes away. The tests drive the room panel like
 * a player would and read the state back through `window.__ashbound.mp` (the `?debug` switch).
 *
 * Software WebGL runs a few frames a second, so everything here waits on state, never on time.
 * The network is the real one: PeerJS, WebRTC data channels, and a real signalling server.
 * Local connections only (`ice=none`): STUN, TURN and strict firewalls are not exercised here.
 */

const BROKER = '127.0.0.1:9000';
const NETWORK = `broker=${BROKER}&ice=none`;
const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const ALLOY = packState(SHAPE.cube, MATERIAL.alloy);
const SMALL = { width: 480, height: 270 };

interface Player {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly problems: string[];
}

/** Opens the game as one player in a browser of their own (so own storage, own player token). */
async function openPlayer(
  browser: Browser,
  baseURL: string | undefined,
  name: string,
  options: { size?: { width: number; height: number }; network?: string } = {},
): Promise<Player> {
  const context = await browser.newContext({ baseURL, viewport: options.size ?? SMALL });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(`./?debug&${options.network ?? NETWORK}&name=${name}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
  await page.waitForFunction(() => Boolean(window.__ashbound?.mp));
  return { name, context, page, problems };
}

const lobby = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.lobby());
const session = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.session());
const remotes = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.remotes());
const digest = (p: Player) => p.page.evaluate(() => window.__ashbound!.mp!.blocks());

async function expectStatus(p: Player, status: string, timeout = 60_000): Promise<void> {
  await expect
    .poll(async () => (await lobby(p)).status, { timeout, message: `${p.name}'s room status` })
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
    const host = await openPlayer(browser, baseURL, 'Host', { size: { width: 1280, height: 720 } });
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

      // Everyone builds next to where they stand; every world ends up identical.
      const cells: { x: number; y: number; z: number }[] = [];
      for (const [index, p] of everyone.entries()) {
        const cell = await p.page.evaluate(
          ([state, dz]) => window.__ashbound!.mp!.placeNear(0, dz!, state!),
          [index % 2 === 0 ? SCRAP : ALLOY, 3] as const,
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

      // A guest reloads the page and gets the same seat back, with the same world.
      const seat = (await lobby(cy)).roster.find((r) => r.name === 'Cy');
      await cy.page.reload();
      await expect(cy.page.locator('html')).toHaveAttribute('data-ready', 'true', {
        timeout: 90_000,
      });
      await expectStatus(cy, 'joined');
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
      await host.page.evaluate(() => window.__ashbound!.mp!.placeNear(0, 3, 257));
      await expectSameWorld([host, ...guests], 1);

      // The host's tab goes away without ceremony.
      await host.page.close();
      for (const guest of guests) {
        await expectStatus(guest, 'ended');
        const dialog = guest.page.getByRole('alertdialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('The host left the game');
        await expect(dialog).toContainText('no host migration');
      }

      // Playing alone keeps the world as it was, and building works again.
      await ada.page.getByRole('button', { name: 'Play alone' }).click();
      await expectStatus(ada, 'alone');
      expect((await session(ada)).role).toBe('solo');
      expect(await digest(ada)).toMatchObject({ count: 1 });
      await ada.page.evaluate(() => window.__ashbound!.mp!.placeNear(2, 3, 257));
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
});
