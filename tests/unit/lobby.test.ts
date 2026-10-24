import { describe, expect, it } from 'vitest';
import {
  Lobby,
  NAME_KEY,
  TOKEN_KEY,
  type KeyValueStore,
  type LobbyOptions,
} from '../../src/net/lobby';
import { LoopbackNetwork, type LoopbackOptions } from '../../src/net/loopback';
import { ManualScheduler } from '../../src/net/scheduler';
import { NetError, type Transport } from '../../src/net/transport';
import { createRng } from '../../src/shared/hash';
import { NET } from '../../src/shared/net-config';
import { HOST_PLAYER_ID, type WorldEvent } from '../../src/shared/protocol';
import { createReading } from '../../src/shared/survival-state';
import { SurvivalSim } from '../../src/systems/survival/sim';
import { at, token } from './helpers/net';
import { TestWorld } from './helpers/net';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    get: (key) => data[key] ?? null,
    set: (key, value) => {
      data[key] = value;
    },
  };
}

function makeEnv(network: Partial<LoopbackOptions> = {}, wrap?: (t: Transport) => Transport) {
  const scheduler = new ManualScheduler();
  const loopback = new LoopbackNetwork({ scheduler, random: createRng(99), ...network });
  const transport = wrap ? wrap(loopback) : loopback;
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const settle = async (ms = 300): Promise<void> => {
    await flush();
    for (let t = 0; t < ms; t += 5) {
      scheduler.advance(5);
      await flush();
    }
  };
  let count = 0;
  function player(seed = 1000, extra: Partial<LobbyOptions> = {}) {
    const n = ++count;
    let world = new TestWorld(seed);
    const loads: number[] = [];
    const tabStore = memoryStore();
    const nameStore = memoryStore();
    const lobby = new Lobby({
      scheduler,
      transport,
      buildId: 'test',
      random: createRng(500 + n),
      tabStore,
      nameStore,
      game: {
        world: () => world,
        loadWorld: (s) => {
          world = new TestWorld(s);
          loads.push(s);
          return Promise.resolve(world);
        },
        spawnPoint: (slot) => ({ x: 0.5 + slot * 2, y: 0, z: 0.5 }),
      },
      ...extra,
    });
    return { lobby, world: () => world, loads, tabStore, nameStore };
  }
  return { scheduler, loopback, transport, flush, settle, player };
}

type Player = ReturnType<ReturnType<typeof makeEnv>['player']>;

/** Opens a room and returns its code. */
async function host(env: ReturnType<typeof makeEnv>, p: Player): Promise<string> {
  p.lobby.host();
  await env.settle(40);
  expect(p.lobby.state.status).toBe('hosting');
  return p.lobby.state.code as string;
}

describe('being alone', () => {
  it('starts in single player with a name, a token and a working session', () => {
    const env = makeEnv();
    const p = env.player(77);
    const { state, hub } = p.lobby;
    expect(state.status).toBe('alone');
    expect(state.code).toBeNull();
    expect(state.roster).toEqual([]);
    expect(state.notice).toBeNull();
    expect(state.name).toMatch(/^Crew-[A-Z0-9]{1,3}$/);
    expect(p.lobby.token).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(hub.role).toBe('solo');
    expect(hub.localId).toBe(HOST_PLAYER_ID);

    hub.publishState(at(3.5, 0, 3.5));
    hub.sendCommand({ type: 'place', x: 4, y: 0, z: 3, state: 257 });
    expect(p.world().getBlock(4, 0, 3)).toBe(257);
  });

  it('keeps the token for the tab and the name for the browser', () => {
    const env = makeEnv();
    const first = env.player(1);
    first.lobby.setName('  Ada   Lovelace ');
    expect(first.lobby.state.name).toBe('Ada Lovelace');
    expect(first.nameStore.data[NAME_KEY]).toBe('Ada Lovelace');
    expect(first.tabStore.data[TOKEN_KEY]).toBe(first.lobby.token);
    expect(first.lobby.hub.players[0]?.name).toBe('Ada Lovelace');

    // A reload of the same tab: same token, same name.
    const again = env.player(1, { tabStore: first.tabStore, nameStore: first.nameStore });
    expect(again.lobby.token).toBe(first.lobby.token);
    expect(again.lobby.state.name).toBe('Ada Lovelace');

    // A second tab of the same browser: its own token, the shared name.
    const other = env.player(1, { nameStore: first.nameStore });
    expect(other.lobby.token).not.toBe(first.lobby.token);
    expect(other.lobby.state.name).toBe('Ada Lovelace');
  });

  it('replaces a token that is not one, and lets the address override the name for this page only', () => {
    const env = makeEnv();
    const bad = memoryStore({ [TOKEN_KEY]: 'short' });
    const p = env.player(1, { tabStore: bad, nameOverride: 'Grace' });
    expect(p.lobby.token).not.toBe('short');
    expect(bad.data[TOKEN_KEY]).toBe(p.lobby.token);
    expect(p.lobby.state.name).toBe('Grace');
    expect(p.nameStore.data[NAME_KEY]).toBeUndefined();
  });

  it('works when storage is missing', () => {
    const env = makeEnv();
    const p = env.player(1, { tabStore: undefined, nameStore: undefined });
    p.lobby.setName('Lin');
    expect(p.lobby.state.name).toBe('Lin');
    expect(p.lobby.token).toHaveLength(24);
  });

  it('tells listeners about every change with a new snapshot', () => {
    const env = makeEnv();
    const p = env.player(1);
    const seen: unknown[] = [];
    const stop = p.lobby.onChange(() => seen.push(p.lobby.state));
    const before = p.lobby.state;
    p.lobby.setName('Kim');
    const heard = seen.length;
    expect(heard).toBeGreaterThan(0);
    expect(seen.at(-1)).not.toBe(before);
    expect(p.lobby.state.name).toBe('Kim');
    p.lobby.setName('Kim');
    expect(seen).toHaveLength(heard);
    stop();
    p.lobby.setName('Kay');
    expect(seen).toHaveLength(heard);
  });
});

describe('hosting', () => {
  it('opens a room through opening to hosting and lists the host', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    const states: string[] = [];
    h.lobby.onChange(() => states.push(h.lobby.state.status));
    h.lobby.host();
    expect(h.lobby.state.status).toBe('opening');
    await env.settle(40);
    expect(states).toContain('opening');
    expect(h.lobby.state.status).toBe('hosting');
    expect(h.lobby.state.code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(h.lobby.state.roster.map((r) => [r.name, r.isHost])).toEqual([
      [h.lobby.state.name, true],
    ]);
    expect(h.lobby.state.roomOnline).toBe(true);
    expect(h.lobby.hub.role).toBe('host');
  });

  it('explains a broker that cannot be reached and stays alone', async () => {
    const env = makeEnv({}, (t) => ({
      dial: (code, signal) => t.dial(code, signal),
      openHost: () => Promise.reject(new NetError('broker-unreachable', 'down')),
    }));
    const h = env.player(1);
    h.lobby.host();
    await env.settle(20);
    expect(h.lobby.state.status).toBe('alone');
    expect(h.lobby.state.notice?.reason).toBe('broker-unreachable');
    expect(h.lobby.hub.role).toBe('solo');

    // The notice goes away with the next attempt, and with "dismiss".
    h.lobby.host();
    expect(h.lobby.state.notice).toBeNull();
    await env.settle(20);
    expect(h.lobby.state.notice?.reason).toBe('broker-unreachable');
    h.lobby.playAlone();
    expect(h.lobby.state.notice).toBeNull();
  });

  it('words other failures for a host, not for a joiner', async () => {
    const env = makeEnv({}, (t) => ({
      dial: (code, signal) => t.dial(code, signal),
      openHost: () => Promise.reject(new NetError('error', 'boom')),
    }));
    const h = env.player(1);
    h.lobby.host();
    await env.settle(20);
    expect(h.lobby.state.notice?.title).toBe('Could not open a room');
  });

  it('shows the room as unreachable while the matchmaking server has lost it', async () => {
    let report: ((online: boolean) => void) | null = null;
    const env = makeEnv({}, (t) => ({
      dial: (code, signal) => t.dial(code, signal),
      openHost: async () => {
        const endpoint = await t.openHost();
        return {
          code: endpoint.code,
          onLink: (l) => endpoint.onLink(l),
          onBroker: (l) => {
            report = l;
            l(true);
          },
          close: () => endpoint.close(),
        };
      },
    }));
    const h = env.player(1);
    await host(env, h);
    report!(false);
    expect(h.lobby.state.roomOnline).toBe(false);
    report!(true);
    expect(h.lobby.state.roomOnline).toBe(true);
  });

  it('closes the room on leave and is alone again, ready to host a new one', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    const code = await host(env, h);
    h.lobby.leave();
    expect(h.lobby.state.status).toBe('alone');
    expect(h.lobby.state.code).toBeNull();
    expect(h.lobby.hub.role).toBe('solo');
    await env.settle(100);

    const g = env.player(1);
    g.lobby.join(code);
    await env.settle(300);
    expect(g.lobby.state.status).toBe('alone');
    expect(g.lobby.state.notice?.reason).toBe('room-not-found');

    const second = await host(env, h);
    expect(second).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
  });

  it('does not let a name change reach a room that is already open', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    h.lobby.setName('Before');
    await host(env, h);
    h.lobby.setName('After');
    expect(h.lobby.state.name).toBe('After');
    expect(h.lobby.state.roster[0]?.name).toBe('Before');
    h.lobby.leave();
    expect(h.lobby.hub.players[0]?.name).toBe('After');
  });

  it('ignores host while a room is already being opened or joined', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    h.lobby.host();
    h.lobby.host();
    await env.settle(40);
    expect(h.lobby.state.status).toBe('hosting');
    const code = h.lobby.state.code;
    h.lobby.host();
    h.lobby.join('ABCDE');
    expect(h.lobby.state.status).toBe('hosting');
    expect(h.lobby.state.code).toBe(code);
  });
});

describe('joining', () => {
  it('goes through connecting and loading to joined, with the host world and the edits', async () => {
    const env = makeEnv({ latency: 20 });
    const h = env.player(4242);
    const code = await host(env, h);
    h.lobby.hub.publishState(at(0.5, 0, 0.5));
    h.lobby.hub.sendCommand({ type: 'place', x: 2, y: 0, z: 2, state: 257 });
    h.lobby.hub.sendCommand({ type: 'place', x: 3, y: 0, z: 2, state: 258 });

    const g = env.player(1);
    g.lobby.setName('Guest');
    const steps: string[] = [];
    g.lobby.onChange(() => {
      const s = g.lobby.state;
      steps.push(`${s.status}${s.step ? `:${s.step}` : ''}`);
    });
    g.lobby.join(`  ${code.toLowerCase().slice(0, 2)} ${code.slice(2)} `);
    expect(g.lobby.state.status).toBe('joining');
    expect(g.lobby.state.code).toBe(code);
    expect(g.lobby.state.step).toBe('connecting');
    await env.settle(400);

    expect(g.lobby.state.status).toBe('joined');
    expect(steps[0]).toBe('joining:connecting');
    expect(steps).toContain('joining:loading');
    expect(steps.at(-1)).toBe('joined');
    expect(g.loads).toEqual([4242]);
    expect(g.world().seed).toBe(4242);
    expect(g.world().edits()).toEqual(h.world().edits());
    expect(g.lobby.hub.role).toBe('guest');
    expect(g.lobby.state.localId).toBe(g.lobby.hub.localId);
    expect(g.lobby.state.localId).not.toBe(HOST_PLAYER_ID);
    expect(g.lobby.state.roster.map((r) => r.name)).toEqual([h.lobby.state.name, 'Guest']);
    expect(h.lobby.state.roster.map((r) => r.name)).toEqual([h.lobby.state.name, 'Guest']);
  });

  it('accepts a pasted invite link', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    const code = await host(env, h);
    const g = env.player(1);
    g.lobby.join(`https://example.com/game/?join=${code}&broker=localhost:9000`);
    await env.settle(300);
    expect(g.lobby.state.status).toBe('joined');
  });

  it('turns the guest to the spawn point when it is in', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    const code = await host(env, h);
    const g = env.player(1);
    const corrections: { x: number; y: number; z: number }[] = [];
    g.lobby.hub.onCorrection((c) => corrections.push(c));
    g.lobby.join(code);
    await env.settle(300);
    expect(corrections).toEqual([{ x: 2.5, y: 0, z: 0.5 }]);
  });

  it('forwards the host events to the guest hub', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    const code = await host(env, h);
    const g = env.player(1);
    g.lobby.join(code);
    await env.settle(300);
    const seen: WorldEvent[] = [];
    g.lobby.hub.onEvent((e) => seen.push(e));
    h.lobby.hub.publishState(at(0.5, 0, 0.5));
    h.lobby.hub.sendCommand({ type: 'place', x: 2, y: 0, z: 2, state: 257 });
    await env.settle(100);
    expect(seen).toHaveLength(1);
    expect(g.world().getBlock(2, 0, 2)).toBe(257);
  });

  it('refuses something that is not a code without dialling', () => {
    const env = makeEnv();
    const g = env.player(1);
    g.lobby.join('hello');
    expect(g.lobby.state.status).toBe('alone');
    expect(g.lobby.state.notice?.title).toBe('That is not a room code');
    expect(env.loopback.links).toHaveLength(0);
    g.lobby.join('');
    expect(g.lobby.state.notice).not.toBeNull();
  });

  it('keeps the world as it was when the room is not there', async () => {
    const env = makeEnv();
    const g = env.player(1);
    g.lobby.hub.publishState(at(3.5, 0, 3.5));
    g.lobby.hub.sendCommand({ type: 'place', x: 4, y: 0, z: 3, state: 257 });
    g.lobby.join('ZZZZZ');
    expect(g.lobby.state.status).toBe('joining');
    await env.settle(300);
    expect(g.lobby.state.status).toBe('alone');
    expect(g.lobby.state.notice?.reason).toBe('room-not-found');
    expect(g.lobby.hub.role).toBe('solo');
    expect(g.loads).toEqual([]);
    expect(g.world().getBlock(4, 0, 3)).toBe(257);
    // Still playable.
    g.lobby.hub.sendCommand({ type: 'place', x: 5, y: 0, z: 3, state: 257 });
    expect(g.world().getBlock(5, 0, 3)).toBe(257);
  });

  it('says so when the room is full', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    const code = await host(env, h);
    const guests = [env.player(1), env.player(1), env.player(1)];
    for (const g of guests) {
      g.lobby.join(code);
      await env.settle(300);
      expect(g.lobby.state.status).toBe('joined');
    }
    const fifth = env.player(1);
    fifth.lobby.join(code);
    await env.settle(300);
    expect(fifth.lobby.state.status).toBe('alone');
    expect(fifth.lobby.state.notice?.reason).toBe('room-full');
    expect(h.lobby.state.roster).toHaveLength(NET.maxPlayers);
  });

  it('can be cancelled while connecting, leaving no timers behind', async () => {
    const env = makeEnv({ latency: 400 });
    const h = env.player(4242);
    const code = await host(env, h);
    const g = env.player(1);
    g.lobby.join(code);
    await env.settle(100);
    expect(g.lobby.state.status).toBe('joining');
    g.lobby.cancel();
    expect(g.lobby.state.status).toBe('alone');
    expect(g.lobby.state.notice).toBeNull();
    expect(g.lobby.hub.role).toBe('solo');
    await env.settle(2000);
    expect(g.lobby.state.status).toBe('alone');
    expect(h.lobby.state.roster).toHaveLength(1);
    expect(g.loads).toEqual([]);
  });

  it('gives a returning page the same seat back', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    const code = await host(env, h);
    const g = env.player(1);
    g.lobby.join(code);
    await env.settle(300);
    const seat = g.lobby.state.roster.find((r) => r.id === g.lobby.state.localId);
    g.lobby.dispose();
    await env.settle(100);
    expect(h.lobby.state.roster).toHaveLength(1);

    // The tab reloads: same token from the tab store.
    const back = env.player(1, { tabStore: g.tabStore, nameStore: g.nameStore });
    back.lobby.join(code);
    await env.settle(300);
    expect(back.lobby.state.status).toBe('joined');
    const seatNow = back.lobby.state.roster.find((r) => r.id === back.lobby.state.localId);
    expect(seatNow?.id).toBe(seat?.id);
    expect(seatNow?.slot).toBe(seat?.slot);
  });
});

describe('leaving and being left', () => {
  it('shows the guest an ended room when the host closes it, and lets them carry on alone', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    const code = await host(env, h);
    const g = env.player(1);
    g.lobby.join(code);
    await env.settle(300);
    h.lobby.hub.publishState(at(0.5, 0, 0.5));
    h.lobby.hub.sendCommand({ type: 'place', x: 2, y: 0, z: 2, state: 257 });
    await env.settle(100);

    h.lobby.leave();
    await env.settle(100);
    expect(g.lobby.state.status).toBe('ended');
    expect(g.lobby.state.ended?.reason).toBe('host-left');
    expect(g.lobby.state.ended?.detail).toMatch(/no host migration/i);
    expect(g.lobby.state.notice).toBeNull();
    expect(g.lobby.state.roster).toEqual([]);
    // Nothing the game does reaches the closed session.
    g.lobby.hub.sendCommand({ type: 'place', x: 9, y: 0, z: 9, state: 257 });
    expect(g.world().getBlock(9, 0, 9)).toBe(0);

    g.lobby.playAlone();
    expect(g.lobby.state.status).toBe('alone');
    expect(g.lobby.state.notice).toBeNull();
    expect(g.lobby.state.ended).toBeNull();
    expect(g.lobby.hub.role).toBe('solo');
    // The host's world stays, and is theirs to build in.
    expect(g.world().getBlock(2, 0, 2)).toBe(257);
    g.lobby.hub.publishState(at(3.5, 0, 3.5));
    g.lobby.hub.sendCommand({ type: 'place', x: 4, y: 0, z: 3, state: 257 });
    expect(g.world().getBlock(4, 0, 3)).toBe(257);
  });

  it('keeps the reason a room ended when a bad code is typed on that screen', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    const code = await host(env, h);
    const g = env.player(1);
    g.lobby.join(code);
    await env.settle(300);
    h.lobby.leave();
    await env.settle(100);
    g.lobby.join('nope');
    expect(g.lobby.state.status).toBe('ended');
    expect(g.lobby.state.ended?.reason).toBe('host-left');
    expect(g.lobby.state.notice?.title).toBe('That is not a room code');
  });

  it('lets a guest in an ended room join another one straight away', async () => {
    const env = makeEnv();
    const a = env.player(4242);
    const b = env.player(9999);
    const codeA = await host(env, a);
    const codeB = await host(env, b);
    const g = env.player(1);
    g.lobby.join(codeA);
    await env.settle(300);
    a.lobby.leave();
    await env.settle(100);
    expect(g.lobby.state.status).toBe('ended');

    g.lobby.join(codeB);
    expect(g.lobby.state.status).toBe('joining');
    expect(g.lobby.state.notice).toBeNull();
    expect(g.lobby.state.ended).toBeNull();
    await env.settle(300);
    expect(g.lobby.state.status).toBe('joined');
    expect(g.world().seed).toBe(9999);
  });

  it('ends when the host just vanishes', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    const code = await host(env, h);
    const g = env.player(1);
    g.lobby.join(code);
    await env.settle(300);
    for (const link of env.loopback.links) env.loopback.sever(link);
    await env.settle(NET.timeoutMs + 3000);
    expect(g.lobby.state.status).toBe('ended');
    expect(g.lobby.state.ended?.reason).toBe('host-lost');
  });

  it('puts a guest back alone when it leaves, and tells the host', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    const code = await host(env, h);
    const g = env.player(1);
    g.lobby.join(code);
    await env.settle(300);
    expect(h.lobby.state.roster).toHaveLength(2);

    g.lobby.leave();
    expect(g.lobby.state.status).toBe('alone');
    expect(g.lobby.state.code).toBeNull();
    expect(g.lobby.state.notice).toBeNull();
    expect(g.lobby.hub.role).toBe('solo');
    await env.settle(100);
    expect(h.lobby.state.roster).toHaveLength(1);
    expect(h.lobby.state.status).toBe('hosting');

    // And they can come back.
    g.lobby.join(code);
    await env.settle(300);
    expect(g.lobby.state.status).toBe('joined');
  });

  it('keeps hosting when a guest leaves, and a guest can still be seen leaving in the roster', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    const code = await host(env, h);
    const a = env.player(1);
    const b = env.player(1);
    a.lobby.join(code);
    await env.settle(300);
    b.lobby.join(code);
    await env.settle(300);
    expect(h.lobby.state.roster).toHaveLength(3);
    expect(b.lobby.state.roster).toHaveLength(3);
    a.lobby.leave();
    await env.settle(100);
    expect(h.lobby.state.roster).toHaveLength(2);
    expect(b.lobby.state.roster).toHaveLength(2);
  });
});

describe('closing the page', () => {
  it('tells the guests when the host page goes away', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    const code = await host(env, h);
    const g = env.player(1);
    g.lobby.join(code);
    await env.settle(300);
    h.lobby.dispose();
    await env.settle(100);
    expect(g.lobby.state.status).toBe('ended');
    expect(g.lobby.state.ended?.reason).toBe('host-left');
  });

  it('stops every timer', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    const code = await host(env, h);
    const g = env.player(1);
    g.lobby.join(code);
    await env.settle(300);
    g.lobby.dispose();
    h.lobby.dispose();
    await env.settle(2000);
    expect(env.scheduler.pending).toBe(0);
  });

  it('ignores calls after it is gone', async () => {
    const env = makeEnv();
    const h = env.player(4242);
    h.lobby.dispose();
    h.lobby.host();
    h.lobby.join('ABCDE');
    h.lobby.leave();
    h.lobby.setName('Late');
    expect(h.lobby.state.status).toBe('alone');
    await env.settle(100);
    expect(env.scheduler.pending).toBe(0);
  });

  it('closes a room that finished opening after the page went away', async () => {
    const env = makeEnv({ latency: 0 });
    const h = env.player(4242);
    h.lobby.host();
    h.lobby.dispose();
    await env.settle(100);
    expect(env.scheduler.pending).toBe(0);
    const g = env.player(1);
    g.lobby.join('AAAAA');
    await env.settle(300);
    expect(g.lobby.state.notice?.reason).toBe('room-not-found');
  });
});

/** A player whose game builds a survival run of its own each time it is asked, over the world it has now. */
function survivingPlayer(env: ReturnType<typeof makeEnv>, seed: number) {
  let world = new TestWorld(seed);
  const loads: number[] = [];
  const runs: SurvivalSim[] = [];
  const p = env.player(seed, {
    game: {
      world: () => world,
      loadWorld: (next) => {
        world = new TestWorld(next);
        loads.push(next);
        return Promise.resolve(world);
      },
      spawnPoint: (slot) => ({ x: 0.5 + slot * 2, y: 0, z: 0.5 }),
      survival: () => {
        const sim = new SurvivalSim({ seed: world.seed });
        runs.push(sim);
        return sim;
      },
    },
  });
  return { ...p, world: () => world, loads, runs };
}

describe('starting a lost run over', () => {
  it('rebuilds the same valley on Retry and takes a new run from the game', async () => {
    const env = makeEnv();
    const p = survivingPlayer(env, 1234);
    expect(p.runs).toHaveLength(1);
    p.runs[0]!.hurtCore(1000);
    p.lobby.hub.restartRun('retry');
    await env.flush();
    expect(p.loads).toEqual([1234]);
    expect(p.runs).toHaveLength(2);
    expect(p.lobby.hub.run).toBe(2);
    expect(p.lobby.hub.survival.read(createReading())).toMatchObject({ over: false, elapsed: 0 });
  });

  it('draws a whole number from the lobby’s own randomness for a new valley, and not the one it was in', async () => {
    const env = makeEnv();
    const p = survivingPlayer(env, 1234);
    p.runs[0]!.hurtCore(1000);
    p.lobby.hub.restartRun('new');
    await env.flush();
    const [seed] = p.loads;
    expect(p.loads).toHaveLength(1);
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(1);
    expect(seed).toBeLessThanOrEqual(2_000_000_000);
    expect(seed).not.toBe(1234);
    expect(p.world().seed).toBe(seed);
  });

  it('waits for a run that is lost', async () => {
    const env = makeEnv();
    const p = survivingPlayer(env, 1234);
    p.lobby.hub.restartRun('retry');
    await env.flush();
    expect(p.loads).toEqual([]);
    expect(p.lobby.hub.run).toBe(1);
  });

  it('takes the guests of a room along', async () => {
    const env = makeEnv();
    const h = survivingPlayer(env, 4242);
    const code = await host(env, h);
    const g = env.player(1);
    g.lobby.join(code);
    await env.settle(300);
    expect(g.lobby.state.status).toBe('joined');

    h.runs[0]!.hurtCore(1000);
    await env.settle(300);
    expect(g.lobby.hub.survival.read(createReading()).over).toBe(true);
    h.lobby.hub.restartRun('new');
    await env.settle(300);

    expect(h.loads).toHaveLength(1);
    const seed = h.loads[0]!;
    expect(g.loads).toEqual([4242, seed]);
    expect(g.world().seed).toBe(seed);
    expect(g.lobby.hub.run).toBe(2);
    expect(g.lobby.state.status).toBe('joined');
    expect(g.lobby.hub.survival.read(createReading()).over).toBe(false);
  });

  it('is left to the host: a guest’s call changes nothing', async () => {
    const env = makeEnv();
    const h = survivingPlayer(env, 4242);
    const code = await host(env, h);
    const g = env.player(1);
    g.lobby.join(code);
    await env.settle(300);
    h.runs[0]!.hurtCore(1000);
    await env.settle(300);
    g.lobby.hub.restartRun('retry');
    await env.settle(300);
    expect(h.lobby.hub.run).toBe(1);
    expect(h.loads).toEqual([]);
  });
});

describe('tokens in tests', () => {
  it('uses a different token for each tab', () => {
    const env = makeEnv();
    const tokens = new Set([env.player().lobby.token, env.player().lobby.token, token(3)]);
    expect(tokens.size).toBe(3);
  });
});
