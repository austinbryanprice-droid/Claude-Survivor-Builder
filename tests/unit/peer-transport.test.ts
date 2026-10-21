import { describe, expect, it } from 'vitest';
import { GuestSession } from '../../src/net/guest-session';
import { HostSession } from '../../src/net/host-session';
import { PeerTransport, type PeerTransportOptions } from '../../src/net/peer-transport';
import { ManualScheduler } from '../../src/net/scheduler';
import { fixedWorld, type WorldBinding } from '../../src/net/session';
import type { HostEndpoint, Link, NetError } from '../../src/net/transport';
import { createRng } from '../../src/shared/hash';
import { NET } from '../../src/shared/net-config';
import { ROOM_PREFIX } from '../../src/shared/room-code';
import { FakeBroker, type FakeConnection, type FakePeer } from './helpers/fake-peer';
import { TestWorld, at, token } from './helpers/net';

const CODE = /^[A-HJ-NP-Z2-9]{5}$/;

function makeNet(extra: Partial<PeerTransportOptions> = {}) {
  const scheduler = new ManualScheduler();
  const broker = new FakeBroker(scheduler);
  const transport = new PeerTransport({
    scheduler,
    random: createRng(5),
    loadPeer: () => Promise.resolve(broker.library()),
    ...extra,
  });
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  const settle = async (ms = 200): Promise<void> => {
    await flush();
    for (let t = 0; t < ms; t += 5) {
      scheduler.advance(5);
      await flush();
    }
  };
  return { scheduler, broker, transport, flush, settle };
}

type Net = ReturnType<typeof makeNet>;

/** Runs a promise that needs virtual time to finish, returning how it ended. */
async function outcome<T>(
  net: Net,
  promise: Promise<T>,
  ms = 200,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown } | null> {
  let result: { ok: true; value: T } | { ok: false; error: unknown } | null = null;
  promise.then(
    (value) => (result = { ok: true, value }),
    (error: unknown) => (result = { ok: false, error }),
  );
  await net.settle(ms);
  return result;
}

async function host(net: Net): Promise<{ endpoint: HostEndpoint; links: Link[] }> {
  const pending = net.transport.openHost();
  await net.settle(50);
  const endpoint = await pending;
  const links: Link[] = [];
  endpoint.onLink((link) => links.push(link));
  return { endpoint, links };
}

describe('hosting a room', () => {
  it('registers a prefixed short code with the broker', async () => {
    const net = makeNet();
    const { endpoint } = await host(net);
    expect(endpoint.code).toMatch(CODE);
    expect(net.broker.registry.has(ROOM_PREFIX + endpoint.code)).toBe(true);
  });

  it('passes the broker and ICE settings on to PeerJS', async () => {
    const net = makeNet({
      broker: { host: 'localhost', port: 9000, path: '/', secure: false, key: 'k' },
      iceServers: [],
    });
    await host(net);
    expect(net.broker.peers[0]?.options).toEqual({
      debug: 0,
      host: 'localhost',
      port: 9000,
      path: '/',
      secure: false,
      key: 'k',
      config: { iceServers: [] },
    });
  });

  it('leaves the broker and ICE settings alone when none are given', async () => {
    const net = makeNet();
    await host(net);
    expect(net.broker.peers[0]?.options).toEqual({ debug: 0 });
  });

  it('draws another code when the broker says the first is taken', async () => {
    const net = makeNet({ random: createRng(5) });
    // Take the code the generator would pick first.
    const probe = makeNet({ random: createRng(5) });
    const first = await host(probe);
    const taken = ROOM_PREFIX + first.endpoint.code;
    net.broker.registry.set(taken, {} as FakePeer);

    const { endpoint } = await host(net);
    expect(ROOM_PREFIX + endpoint.code).not.toBe(taken);
    expect(endpoint.code).toMatch(CODE);
    expect(net.broker.peers).toHaveLength(2);
  });

  it('gives up after too many collisions', async () => {
    const net = makeNet({ random: () => 0 });
    net.broker.registry.set(`${ROOM_PREFIX}AAAAA`, {} as FakePeer);
    const result = await outcome(net, net.transport.openHost(), 1000);
    expect(result?.ok).toBe(false);
    expect((result as { error: NetError }).error.kind).toBe('error');
    expect(net.broker.peers).toHaveLength(NET.codeRetries);
  });

  it('reports an unreachable broker', async () => {
    const net = makeNet();
    net.broker.down = true;
    const result = await outcome(net, net.transport.openHost(), 200);
    expect((result as { error: NetError }).error.kind).toBe('broker-unreachable');
  });

  it('gives up on a broker that says nothing', async () => {
    const net = makeNet();
    net.broker.down = true;
    net.broker.silent = true;
    const pending = net.transport.openHost();
    const result = await outcome(net, pending, NET.brokerTimeoutMs + 100);
    expect((result as { error: NetError }).error.kind).toBe('broker-unreachable');
    expect(net.broker.peers[0]?.destroyed).toBe(true);
  });

  it('turns a missing library into an error rather than a hang', async () => {
    const net = makeNet({ loadPeer: () => Promise.reject(new Error('offline')) });
    const result = await outcome(net, net.transport.openHost());
    expect((result as { error: NetError }).error.kind).toBe('error');
    expect(((result as { error: Error }).error as Error).message).toMatch(/offline/);
  });
});

describe('joining a room', () => {
  it('reaches the host and carries control frames both ways', async () => {
    const net = makeNet();
    const { endpoint, links } = await host(net);
    const joined = await outcome(net, net.transport.dial(endpoint.code), 300);
    expect(joined?.ok).toBe(true);
    const guest = (joined as { value: Link }).value;
    expect(links).toHaveLength(1);
    const hostLink = links[0] as Link;

    const atHost: string[] = [];
    const atGuest: string[] = [];
    hostLink.attach({ control: (f) => atHost.push(f), state: () => {}, closed: () => {} });
    guest.attach({ control: (f) => atGuest.push(f), state: () => {}, closed: () => {} });
    guest.sendControl('hello');
    hostLink.sendControl('welcome');
    hostLink.sendControl('and more');
    await net.settle(50);
    expect(atHost).toEqual(['hello']);
    expect(atGuest).toEqual(['welcome', 'and more']);
  });

  it('opens a second, unordered connection for state, and uses it once open', async () => {
    const net = makeNet();
    net.broker.laneOpenMs = { ctl: 30, fast: 500 };
    const { endpoint, links } = await host(net);
    const guest = ((await outcome(net, net.transport.dial(endpoint.code), 150)) as { value: Link })
      .value;
    const hostLink = links[0] as Link;
    const packets: number[][] = [];
    hostLink.attach({
      control: () => {},
      state: (bytes) => packets.push([...bytes]),
      closed: () => {},
    });
    guest.attach({ control: () => {}, state: () => {}, closed: () => {} });

    const options = net.broker.connectOptions;
    expect(options.map((o) => [o.label, o.reliable, o.serialization])).toEqual([
      ['ctl', true, 'raw'],
      ['fast', false, 'raw'],
    ]);

    // Before the fast lane is open, state still gets through, on the ordered one.
    expect(guest.fastOpen).toBe(false);
    guest.sendState(new Uint8Array([1, 2, 3]));
    await net.settle(20);
    const guestPeer = net.broker.peers.find((p) => p.id.startsWith('ashbound-g-')) as FakePeer;
    const [ctl, fast] = guestPeer.connections as [FakeConnection, FakeConnection];
    expect(ctl.sent).toHaveLength(1);
    expect(fast.sent).toHaveLength(0);

    await net.settle(700);
    expect(guest.fastOpen).toBe(true);
    guest.sendState(new Uint8Array([4, 5, 6]));
    await net.settle(20);
    expect(fast.sent).toHaveLength(1);
    expect(ctl.sent).toHaveLength(1);
    expect(packets).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('drops a state packet rather than queueing it behind a busy channel', async () => {
    const net = makeNet();
    const { endpoint } = await host(net);
    const guest = ((await outcome(net, net.transport.dial(endpoint.code), 400)) as { value: Link })
      .value;
    const guestPeer = net.broker.peers.find((p) => p.id.startsWith('ashbound-g-')) as FakePeer;
    const fast = guestPeer.connections[1] as FakeConnection;
    fast.bufferSize = NET.fastBacklogMax;
    guest.sendState(new Uint8Array([1]));
    expect(fast.sent).toHaveLength(0);
    fast.bufferSize = 0;
    guest.sendState(new Uint8Array([2]));
    expect(fast.sent).toHaveLength(1);
  });

  it('delivers frames that arrive before the session attaches', async () => {
    const net = makeNet();
    const { endpoint, links } = await host(net);
    const guest = ((await outcome(net, net.transport.dial(endpoint.code), 300)) as { value: Link })
      .value;
    const hostLink = links[0] as Link;
    hostLink.attach({ control: () => {}, state: () => {}, closed: () => {} });
    hostLink.sendControl('early');
    await net.settle(30);
    const seen: string[] = [];
    guest.attach({ control: (f) => seen.push(f), state: () => {}, closed: () => {} });
    expect(seen).toEqual(['early']);
  });

  it('says there is no such room', async () => {
    const net = makeNet();
    await host(net);
    const result = await outcome(net, net.transport.dial('ZZZZZ'), 200);
    expect((result as { error: NetError }).error.kind).toBe('room-not-found');
    // The attempt's own peer is cleaned up.
    expect(net.broker.peers.find((p) => p.id.startsWith('ashbound-g-'))?.destroyed).toBe(true);
  });

  it('reports an unreachable broker', async () => {
    const net = makeNet();
    net.broker.down = true;
    const result = await outcome(net, net.transport.dial('ABCDE'), 200);
    expect((result as { error: NetError }).error.kind).toBe('broker-unreachable');
  });

  it('gives up when the host never answers', async () => {
    const net = makeNet();
    const { endpoint } = await host(net);
    net.broker.refuse = true;
    const result = await outcome(
      net,
      net.transport.dial(endpoint.code),
      NET.connectTimeoutMs + 200,
    );
    expect((result as { error: NetError }).error.kind).toBe('timed-out');
    expect(net.broker.peers.find((p) => p.id.startsWith('ashbound-g-'))?.destroyed).toBe(true);
  });

  it('stops when the caller aborts, and frees its peer', async () => {
    const net = makeNet();
    const { endpoint } = await host(net);
    const controller = new AbortController();
    const pending = net.transport.dial(endpoint.code, controller.signal);
    await net.settle(25);
    controller.abort();
    const result = await outcome(net, pending, 50);
    expect((result as { error: NetError }).error.kind).toBe('closed');
    expect(net.broker.peers.find((p) => p.id.startsWith('ashbound-g-'))?.destroyed).toBe(true);
  });

  it('does not start at all if the signal is already aborted', async () => {
    const net = makeNet();
    const { endpoint } = await host(net);
    const controller = new AbortController();
    controller.abort();
    const result = await outcome(net, net.transport.dial(endpoint.code, controller.signal), 50);
    expect((result as { error: NetError }).error.kind).toBe('closed');
    expect(net.broker.peers).toHaveLength(1);
  });
});

describe('links', () => {
  async function pair(net: Net) {
    const { endpoint, links } = await host(net);
    const guest = ((await outcome(net, net.transport.dial(endpoint.code), 400)) as { value: Link })
      .value;
    const hostLink = links[0] as Link;
    const events = { host: [] as string[], guest: [] as string[] };
    hostLink.attach({
      control: () => {},
      state: () => {},
      closed: () => events.host.push('closed'),
    });
    guest.attach({
      control: () => {},
      state: () => {},
      closed: () => events.guest.push('closed'),
    });
    return { endpoint, guest, hostLink, events };
  }

  it('tells the host when a guest closes, and not the guest itself', async () => {
    const net = makeNet();
    const { guest, events } = await pair(net);
    guest.close();
    await net.settle(50);
    expect(events.host).toEqual(['closed']);
    expect(events.guest).toEqual([]);
    // Closing a guest link frees its own peer, so the broker forgets it.
    expect(net.broker.peers.find((p) => p.id.startsWith('ashbound-g-'))?.destroyed).toBe(true);
  });

  it('tells the guest when the host closes a link, once', async () => {
    const net = makeNet();
    const { hostLink, events } = await pair(net);
    hostLink.close();
    await net.settle(50);
    expect(events.guest).toEqual(['closed']);
    expect(events.host).toEqual([]);
    hostLink.close();
    await net.settle(50);
    expect(events.guest).toEqual(['closed']);
  });

  it('does not deliver or send after a link is closed', async () => {
    const net = makeNet();
    const { guest, hostLink } = await pair(net);
    const seen: string[] = [];
    hostLink.attach({ control: (f) => seen.push(f), state: () => {}, closed: () => {} });
    guest.close();
    guest.sendControl('late');
    guest.sendState(new Uint8Array([1]));
    await net.settle(50);
    expect(seen).toEqual([]);
  });

  it('keeps the link when only the fast lane dies', async () => {
    const net = makeNet();
    const { guest, events } = await pair(net);
    await net.settle(100);
    expect(guest.fastOpen).toBe(true);
    const guestPeer = net.broker.peers.find((p) => p.id.startsWith('ashbound-g-')) as FakePeer;
    (guestPeer.connections[1] as FakeConnection).close();
    expect(guest.fastOpen).toBe(false);
    await net.settle(50);
    expect(events.guest).toEqual([]);
    expect(events.host).toEqual([]);
    guest.sendState(new Uint8Array([9]));
    expect((guestPeer.connections[0] as FakeConnection).sent).toHaveLength(1);
  });

  it('reads binary frames however the browser hands them over', async () => {
    const net = makeNet();
    const { guest, hostLink } = await pair(net);
    const got: number[][] = [];
    guest.attach({ control: () => {}, state: (b) => got.push([...b]), closed: () => {} });
    const hostPeer = net.broker.peers.find((p) => p.id.startsWith(ROOM_PREFIX)) as FakePeer;
    const ctl = hostPeer.connections.find((c) => c.label === 'ctl') as FakeConnection;
    // Deliver straight into the connection's data event: a view, a buffer, junk and a stray string.
    const emit = (value: unknown) =>
      (ctl.other as unknown as { emit(e: string, v: unknown): void }).emit('data', value);
    const bytes = new Uint8Array([9, 8, 7, 6]);
    emit(bytes.subarray(1, 3));
    emit(bytes.buffer.slice(0));
    emit(42);
    emit(null);
    expect(got).toEqual([
      [8, 7],
      [9, 8, 7, 6],
    ]);
    void hostLink;
  });
});

describe('the host side of a room', () => {
  it('ignores connections that are not ours', async () => {
    const net = makeNet();
    const { endpoint, links } = await host(net);
    const stranger = net.broker.library().Peer;
    const peer = new stranger('stranger-1', {});
    await net.settle(30);
    const conn = peer.connect(ROOM_PREFIX + endpoint.code, {
      label: 'chat',
      reliable: true,
      serialization: 'raw',
    }) as FakeConnection;
    await net.settle(200);
    expect(links).toHaveLength(0);
    expect(conn.closed).toBe(true);
  });

  it('pairs the fast lane with the control lane whichever arrives first', async () => {
    const net = makeNet();
    net.broker.laneOpenMs = { ctl: 80, fast: 20 };
    const { endpoint, links } = await host(net);
    const guest = ((await outcome(net, net.transport.dial(endpoint.code), 400)) as { value: Link })
      .value;
    await net.settle(100);
    expect(links).toHaveLength(1);
    expect(guest.fastOpen).toBe(true);
    expect(links[0]?.fastOpen).toBe(true);
  });

  it('closes a second control lane from the same player', async () => {
    const net = makeNet();
    const { endpoint, links } = await host(net);
    await outcome(net, net.transport.dial(endpoint.code), 400);
    const guestPeer = net.broker.peers.find((p) => p.id.startsWith('ashbound-g-')) as FakePeer;
    const extra = guestPeer.connect(ROOM_PREFIX + endpoint.code, {
      label: 'ctl',
      reliable: true,
      serialization: 'raw',
    }) as FakeConnection;
    await net.settle(200);
    expect(links).toHaveLength(1);
    expect(extra.closed).toBe(true);
  });

  it('forgets a player that never finishes connecting', async () => {
    const net = makeNet();
    const { endpoint, links } = await host(net);
    net.broker.laneOpenMs = { ctl: NET.connectTimeoutMs * 10, fast: 60 };
    const stranger = new (net.broker.library().Peer)('slow-1', {});
    await net.settle(30);
    const conn = stranger.connect(ROOM_PREFIX + endpoint.code, {
      label: 'ctl',
      reliable: true,
      serialization: 'raw',
    }) as FakeConnection;
    await net.settle(NET.connectTimeoutMs + 100);
    expect(links).toHaveLength(0);
    expect(conn.closed || conn.other?.closed).toBe(true);
  });

  it('refuses to hold more half-open players than the limit', async () => {
    const net = makeNet();
    const { endpoint } = await host(net);
    net.broker.laneOpenMs = { ctl: NET.connectTimeoutMs * 10, fast: 60 };
    const Peer = net.broker.library().Peer;
    const conns: FakeConnection[] = [];
    for (let i = 0; i < NET.pendingLinksMax + 4; i++) {
      const peer = new Peer(`crowd-${i}`, {});
      await net.settle(25);
      conns.push(
        peer.connect(ROOM_PREFIX + endpoint.code, {
          label: 'ctl',
          reliable: true,
          serialization: 'raw',
        }) as FakeConnection,
      );
    }
    await net.settle(100);
    const refused = conns.filter((c) => c.closed || c.other?.closed).length;
    expect(refused).toBe(4);
  });

  it('comes off the broker at once when closed, and is destroyed a moment later', async () => {
    const net = makeNet();
    const { endpoint } = await host(net);
    const hostPeer = net.broker.peers[0] as FakePeer;
    endpoint.close();
    expect(hostPeer.disconnected).toBe(true);
    expect(net.broker.registry.has(ROOM_PREFIX + endpoint.code)).toBe(false);
    expect(hostPeer.destroyed).toBe(false);
    await net.settle(2000);
    expect(hostPeer.destroyed).toBe(true);
    const result = await outcome(net, net.transport.dial(endpoint.code), 200);
    expect((result as { error: NetError }).error.kind).toBe('room-not-found');
  });

  it('keeps the room joinable through a dropped broker connection', async () => {
    const net = makeNet();
    const { endpoint } = await host(net);
    const states: boolean[] = [];
    endpoint.onBroker?.((online) => states.push(online));
    const hostPeer = net.broker.peers[0] as FakePeer;

    hostPeer.dropBrokerSocket();
    expect(states).toEqual([true, false]);
    await net.settle(1200); // the first retry comes after a second
    expect(net.broker.reconnects).toBe(1);
    expect(states).toEqual([true, false, true]);
    expect(net.broker.registry.get(ROOM_PREFIX + endpoint.code)).toBe(hostPeer);
  });

  it('backs off while the broker stays down, and stops once the room is closed', async () => {
    const net = makeNet();
    const { endpoint } = await host(net);
    const hostPeer = net.broker.peers[0] as FakePeer;
    net.broker.down = true;
    hostPeer.dropBrokerSocket();
    await net.settle(1100); // attempt 1 after 1 s
    expect(net.broker.reconnects).toBe(1);
    await net.settle(2100); // attempt 2 after 2 more seconds
    expect(net.broker.reconnects).toBe(2);
    await net.settle(4100); // attempt 3 after 4 more
    expect(net.broker.reconnects).toBe(3);
    endpoint.close();
    await net.settle(20_000);
    expect(net.broker.reconnects).toBe(3);
  });
});

describe('a whole room over the PeerJS transport', () => {
  function sessions(net: Net) {
    const hostWorld = new TestWorld(77);
    const hostSession = new HostSession({
      scheduler: net.scheduler,
      world: fixedWorld(hostWorld),
      name: 'Host',
      token: token(0),
    });
    const addGuest = (name: string, n: number) => {
      let world = new TestWorld(0);
      const binding: WorldBinding = {
        current: () => world,
        load: (seed, edits) => {
          world = new TestWorld(seed);
          for (const e of edits) world.setBlock(e.x, e.y, e.z, e.state);
          return Promise.resolve();
        },
      };
      const session = new GuestSession({
        scheduler: net.scheduler,
        world: binding,
        transport: net.transport,
        name,
        token: token(n),
        buildId: 'test',
      });
      return { session, world: () => world };
    };
    return { hostSession, hostWorld, addGuest };
  }

  it('plays: join by code, see each other, edit together, and learn when the host leaves', async () => {
    const net = makeNet();
    const { hostSession, hostWorld, addGuest } = sessions(net);
    const opening = hostSession.openRoom(net.transport);
    await net.settle(100);
    const code = await opening;
    hostWorld.setBlock(0, 0, 0, 5);

    const a = addGuest('Ada', 1);
    const b = addGuest('Bo', 2);
    a.session.join(code);
    b.session.join(code);
    await net.settle(1500);
    expect(a.session.phase).toBe('open');
    expect(b.session.phase).toBe('open');
    expect(hostSession.players.map((p) => p.name)).toEqual(['Host', 'Ada', 'Bo']);
    expect(a.world().getBlock(0, 0, 0)).toBe(5);

    a.session.publishState(at(6.5, 0, 2.5, { yaw: 1 }));
    b.session.publishState(at(-1.5, 0, 6.5));
    hostSession.publishState(at(0.5, 0, 0.5));
    await net.settle(600);
    expect(
      b.session
        .sampleRemotes()
        .map((p) => p.name)
        .sort(),
    ).toEqual(['Ada', 'Host']);
    expect(
      hostSession
        .sampleRemotes()
        .map((p) => p.name)
        .sort(),
    ).toEqual(['Ada', 'Bo']);

    a.session.sendCommand({ type: 'place', x: 8, y: 0, z: 2, state: 9 });
    b.session.sendCommand({ type: 'place', x: -1, y: 0, z: 8, state: 7 });
    hostSession.sendCommand({ type: 'place', x: 2, y: 0, z: 0, state: 6 });
    await net.settle(300);
    for (const world of [hostWorld, a.world(), b.world()]) {
      expect(world.getBlock(8, 0, 2)).toBe(9);
      expect(world.getBlock(-1, 0, 8)).toBe(7);
      expect(world.getBlock(2, 0, 0)).toBe(6);
    }

    hostSession.closeRoom();
    await net.settle(300);
    expect(a.session.closed?.reason).toBe('host-left');
    expect(b.session.closed?.reason).toBe('host-left');
    await net.settle(3000);
    // Everything that was opened has been released.
    expect(net.broker.peers.every((p) => p.destroyed)).toBe(true);
  });

  it('turns away a fifth player with the room-full message', async () => {
    const net = makeNet();
    const { hostSession, addGuest } = sessions(net);
    const opening = hostSession.openRoom(net.transport);
    await net.settle(100);
    const code = await opening;
    const guests = [1, 2, 3, 4].map((n) => addGuest(`G${n}`, n));
    for (const g of guests) g.session.join(code);
    await net.settle(2500);
    expect(guests.filter((g) => g.session.phase === 'open')).toHaveLength(3);
    const refused = guests.find((g) => g.session.phase === 'closed');
    expect(refused?.session.closed?.reason).toBe('room-full');
  });

  it('tells a guest who cannot find the room', async () => {
    const net = makeNet();
    const { addGuest } = sessions(net);
    const guest = addGuest('Lost', 1);
    guest.session.join('ZZZZZ');
    await net.settle(500);
    expect(guest.session.closed?.reason).toBe('room-not-found');
  });
});
