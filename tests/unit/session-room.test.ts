import { describe, expect, it } from 'vitest';
import { NET } from '../../src/shared/net-config';
import { HOST_PLAYER_ID, type WorldEvent } from '../../src/shared/protocol';
import { at, helloText, makeRoom, rawGuest, token } from './helpers/net';

const CODE = /^[A-HJ-NP-Z2-9]{5}$/;

describe('solo play', () => {
  it('runs the same command path with nobody else in the room', async () => {
    const room = makeRoom();
    const { host, hostWorld } = room;
    const events: WorldEvent[] = [];
    host.onEvent((e) => events.push(e));

    expect(host.role).toBe('solo');
    expect(host.roomCode).toBeNull();
    expect(host.localId).toBe(HOST_PLAYER_ID);
    expect(host.players.map((p) => p.name)).toEqual(['Host']);

    host.sendCommand({ type: 'place', x: 3, y: 0, z: 3, state: 257 });
    expect(hostWorld.getBlock(3, 0, 3)).toBe(257);
    expect(events).toEqual([{ type: 'set', x: 3, y: 0, z: 3, state: 257, by: HOST_PLAYER_ID }]);

    host.sendCommand({ type: 'break', x: 3, y: 0, z: 3 });
    expect(hostWorld.getBlock(3, 0, 3)).toBe(0);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ state: 0 });
  });

  it('reports the reason when the world says no', () => {
    const room = makeRoom();
    const refused: string[] = [];
    room.host.onRejected((r) => refused.push(r.reason));
    room.host.sendCommand({ type: 'break', x: 1, y: 0, z: 1 });
    room.host.sendCommand({ type: 'place', x: 1, y: 40, z: 1, state: 257 });
    room.host.sendCommand({ type: 'place', x: 1, y: 0, z: 1, state: 5000 });
    expect(refused).toEqual(['empty', 'unsupported', 'unknown-block']);
    expect(room.host.stats.rejections).toBe(3);
  });

  it('refuses a block inside the host player', () => {
    const room = makeRoom();
    const refused: string[] = [];
    room.host.onRejected((r) => refused.push(r.reason));
    room.host.publishState(at(5.5, 0, 5.5));
    room.host.sendCommand({ type: 'place', x: 5, y: 0, z: 5, state: 257 });
    room.host.sendCommand({ type: 'place', x: 5, y: 1, z: 5, state: 257 });
    expect(refused).toEqual(['a player is in the way', 'unsupported']);
    // Next to the player is fine.
    room.host.sendCommand({ type: 'place', x: 6, y: 0, z: 5, state: 257 });
    expect(room.hostWorld.getBlock(6, 0, 5)).toBe(257);
  });

  it('refuses a block beyond reach', () => {
    const room = makeRoom();
    const refused: string[] = [];
    room.host.onRejected((r) => refused.push(r.reason));
    room.host.publishState(at(0.5, 0, 0.5));
    room.host.sendCommand({ type: 'place', x: 40, y: 0, z: 0, state: 257 });
    expect(refused).toEqual(['out of reach']);
  });

  it('ignores commands after it is closed', () => {
    const room = makeRoom();
    room.host.close();
    room.host.sendCommand({ type: 'place', x: 1, y: 0, z: 1, state: 257 });
    expect(room.hostWorld.getBlock(1, 0, 1)).toBe(0);
    expect(room.host.phase).toBe('closed');
    expect(room.host.closed?.reason).toBe('left');
    room.host.close();
  });
});

describe('opening a room and joining it', () => {
  it('gives the host a short code', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    expect(code).toMatch(CODE);
    expect(room.host.role).toBe('host');
    expect(room.host.roomCode).toBe(code);
    // Opening twice returns the same room.
    expect(await room.host.openRoom(room.network)).toBe(code);
  });

  it('brings a guest in through connecting and loading to open', async () => {
    const room = makeRoom({ latency: 20, loadMs: 100 });
    const code = await room.openRoom();
    const guest = room.addGuest('Ada');
    const phases: string[] = [guest.session.phase];
    guest.session.onPhase((p) => phases.push(p));
    guest.session.join(code);
    await room.settle(600);
    expect(phases).toEqual(['connecting', 'loading', 'open']);
    expect(guest.session.role).toBe('guest');
    expect(guest.session.roomCode).toBe(code);
    expect(guest.session.localId).toBe(2);
    expect(guest.world().seed).toBe(4242);
    expect(room.host.players.map((p) => [p.id, p.name, p.slot])).toEqual([
      [1, 'Host', 0],
      [2, 'Ada', 1],
    ]);
    expect(guest.session.players.map((p) => [p.id, p.name, p.isHost])).toEqual([
      [1, 'Host', true],
      [2, 'Ada', false],
    ]);
  });

  it('tells the host and the other guests when someone joins or leaves', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const first = await room.join(code, 'Ada');
    let changes = 0;
    first.session.onPlayers(() => changes++);
    const second = await room.join(code, 'Mira');
    expect(first.session.players.map((p) => p.name)).toEqual(['Host', 'Ada', 'Mira']);
    expect(second.session.players.map((p) => p.name)).toEqual(['Host', 'Ada', 'Mira']);
    expect(changes).toBeGreaterThan(0);

    second.session.close();
    await room.settle(100);
    expect(first.session.players.map((p) => p.name)).toEqual(['Host', 'Ada']);
    expect(room.host.players.map((p) => p.name)).toEqual(['Host', 'Ada']);
    expect(second.session.phase).toBe('closed');
    expect(second.session.closed?.reason).toBe('left');
  });

  it('fills the seats in slot order and reuses a freed one', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const a = await room.join(code, 'A');
    await room.join(code, 'B');
    expect(room.host.players.map((p) => p.slot)).toEqual([0, 1, 2]);
    a.session.close();
    await room.settle(100);
    await room.join(code, 'C');
    expect(room.host.players.map((p) => [p.name, p.slot])).toEqual([
      ['Host', 0],
      ['C', 1],
      ['B', 2],
    ]);
  });

  it('holds two to four players and says so to a fifth', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    await room.join(code, 'A');
    await room.join(code, 'B');
    await room.join(code, 'C');
    expect(room.host.players).toHaveLength(NET.maxPlayers);
    const fifth = await room.join(code, 'D');
    expect(fifth.session.phase).toBe('closed');
    expect(fifth.session.closed?.reason).toBe('room-full');
    expect(room.host.players).toHaveLength(NET.maxPlayers);
  });

  it('says so when there is no such room', async () => {
    const room = makeRoom();
    await room.openRoom();
    const guest = await room.join('AAAAA');
    expect(guest.session.phase).toBe('closed');
    expect(guest.session.closed?.reason).toBe('room-not-found');
  });

  it('says so when the versions differ', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText({ v: NET.protocolVersion + 1 }));
    await room.settle(100);
    expect(raw.frames).toEqual([{ t: 'deny', reason: 'version' }]);
    await room.settle(1000);
    expect(raw.closed()).toBe(true); // refused, then the host closes its end
  });

  it('turns away a guest once the room is closed', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    room.host.closeRoom();
    expect(room.host.role).toBe('solo');
    expect(room.host.roomCode).toBeNull();
    const guest = await room.join(code);
    expect(guest.session.closed?.reason).toBe('room-not-found');
  });

  it('ends a guest that never says hello', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    await room.settle(NET.helloTimeoutMs + 200);
    expect(raw.closed()).toBe(true);
  });

  it('survives garbage from a guest', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    for (const text of ['', 'nonsense', '{"t":"cmd"}', '[1,2,3]', '{"t":"ev"}', '\u0000']) {
      raw.link.sendControl(text);
    }
    raw.link.sendState(new Uint8Array([1, 2, 3]));
    raw.link.sendControl(helloText({ token: 'x' }));
    await room.settle(100);
    expect(room.host.stats.badFrames).toBeGreaterThanOrEqual(6);
    expect(room.host.players).toHaveLength(1);
    raw.link.sendControl(helloText());
    await room.settle(100);
    expect(raw.frames[0]).toMatchObject({ t: 'welcome', id: 2 });
  });

  it('cleans a hostile name', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText({ name: '‮evil\u0000  name' }));
    await room.settle(100);
    expect(room.host.players[1]?.name).toBe('evil name');
  });
});

describe('late join', () => {
  it('gives a late joiner the seed and every edit so far', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    room.host.sendCommand({ type: 'place', x: 0, y: 0, z: 0, state: 257 });
    room.host.sendCommand({ type: 'place', x: 1, y: 0, z: 0, state: 258 });
    room.host.sendCommand({ type: 'place', x: 1, y: 1, z: 0, state: 257 });
    room.host.sendCommand({ type: 'break', x: 0, y: 0, z: 0 });
    const guest = await room.join(code);
    expect(guest.loads).toEqual([{ seed: 4242, count: 2 }]);
    expect(guest.world().edits()).toEqual(room.hostWorld.edits());
  });

  it('splits a big snapshot into frames and delivers it whole', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    let count = 0;
    for (let x = -80; x <= 80 && count < 2600; x++) {
      for (let z = -80; z <= 80 && count < 2600; z++) {
        room.hostWorld.setBlock(x, 0, z, 1 + ((x + z) & 7));
        count++;
      }
    }
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const welcome = raw.frames[0];
    expect(welcome).toMatchObject({ t: 'welcome', edits: 2600, parts: 3 });
    expect(raw.frames.filter((f) => f.t === 'snap')).toHaveLength(3);

    const guest = await room.join(code);
    expect(guest.world().edits()).toEqual(room.hostWorld.edits());
  });

  it('applies events that arrive while the world is still building, once each', async () => {
    const room = makeRoom({ loadMs: 400 });
    const code = await room.openRoom();
    room.host.sendCommand({ type: 'place', x: 0, y: 0, z: 0, state: 257 });
    const guest = room.addGuest();
    const seen: WorldEvent[] = [];
    guest.session.onEvent((e) => seen.push(e));
    guest.session.join(code);
    await room.settle(150); // welcome and snapshot are in; the world is still building
    expect(guest.session.phase).toBe('loading');
    room.host.sendCommand({ type: 'place', x: 1, y: 0, z: 0, state: 257 });
    room.host.sendCommand({ type: 'place', x: 2, y: 0, z: 0, state: 257 });
    await room.settle(500);
    expect(guest.session.phase).toBe('open');
    expect(guest.world().edits()).toEqual(room.hostWorld.edits());
    expect(seen.map((e) => e.x)).toEqual([1, 2]);
  });

  it('puts the guest at its spawn point when the world is ready', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const guest = room.addGuest();
    const moves: { x: number; y: number; z: number }[] = [];
    guest.session.onCorrection((c) => moves.push(c));
    guest.session.join(code);
    await room.settle(200);
    expect(moves).toEqual([{ x: 2.5, y: 0, z: 0.5 }]);
  });
});

describe('block sync', () => {
  it("shows a guest's block to everyone, the sender included, in the same order", async () => {
    const room = makeRoom({ latency: 15 });
    const code = await room.openRoom();
    const a = await room.join(code, 'A');
    const b = await room.join(code, 'B');
    const seen = { host: [] as WorldEvent[], a: [] as WorldEvent[], b: [] as WorldEvent[] };
    room.host.onEvent((e) => seen.host.push(e));
    a.session.onEvent((e) => seen.a.push(e));
    b.session.onEvent((e) => seen.b.push(e));
    // Players stand clear of the cells and know where they are.
    a.session.publishState(at(8.5, 0, 4.5));
    b.session.publishState(at(-5.5, 0, 6.5));
    room.host.publishState(at(0.5, 0, 0.5));
    await room.settle(200);

    a.session.sendCommand({ type: 'place', x: 10, y: 0, z: 5, state: 257 });
    b.session.sendCommand({ type: 'place', x: -7, y: 0, z: 8, state: 258 });
    room.host.sendCommand({ type: 'place', x: 2, y: 0, z: 0, state: 259 });
    await room.settle(400);

    for (const world of [room.hostWorld, a.world(), b.world()]) {
      expect(world.getBlock(10, 0, 5)).toBe(257);
      expect(world.getBlock(-7, 0, 8)).toBe(258);
      expect(world.getBlock(2, 0, 0)).toBe(259);
    }
    expect(seen.host).toHaveLength(3);
    expect(seen.a).toEqual(seen.host);
    expect(seen.b).toEqual(seen.host);
    expect(seen.host.map((e) => e.by).sort()).toEqual([1, 2, 3]);
  });

  it('breaks blocks for everyone too', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const a = await room.join(code, 'A');
    a.session.publishState(at(8.5, 0, 4.5));
    room.host.publishState(at(0.5, 0, 0.5));
    await room.settle(100);
    room.host.sendCommand({ type: 'place', x: 3, y: 0, z: 0, state: 257 });
    await room.settle(100);
    expect(a.world().getBlock(3, 0, 0)).toBe(257);
    a.session.sendCommand({ type: 'break', x: 3, y: 0, z: 0 });
    await room.settle(100);
    expect(a.world().getBlock(3, 0, 0)).toBe(0);
    expect(room.hostWorld.getBlock(3, 0, 0)).toBe(0);
  });

  it('lets the first of two racing placements win and refuses the other with the reason', async () => {
    const room = makeRoom({ latency: 30 });
    const code = await room.openRoom();
    const a = await room.join(code, 'A');
    const b = await room.join(code, 'B');
    a.session.publishState(at(8.5, 0, 4.5));
    b.session.publishState(at(8.5, 0, 6.5));
    await room.settle(200);
    const refusals: string[] = [];
    b.session.onRejected((r) => refusals.push(r.reason));
    a.session.onRejected((r) => refusals.push(r.reason));

    a.session.sendCommand({ type: 'place', x: 10, y: 0, z: 5, state: 257 });
    b.session.sendCommand({ type: 'place', x: 10, y: 0, z: 5, state: 258 });
    await room.settle(400);
    expect(refusals).toEqual(['occupied']);
    const winner = room.hostWorld.getBlock(10, 0, 5);
    expect([257, 258]).toContain(winner);
    expect(a.world().getBlock(10, 0, 5)).toBe(winner);
    expect(b.world().getBlock(10, 0, 5)).toBe(winner);
  });

  it('refuses a guest who is not near, or has not reported a position yet', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const a = await room.join(code, 'A');
    const refusals: string[] = [];
    a.session.onRejected((r) => refusals.push(r.reason));
    a.session.sendCommand({ type: 'place', x: 1, y: 0, z: 1, state: 257 });
    await room.settle(50);
    expect(refusals).toEqual(['not ready yet']);

    a.session.publishState(at(12.5, 0, 0.5)); // a legal walk from the spawn, but far from the cell
    await room.settle(100);
    a.session.sendCommand({ type: 'place', x: 1, y: 0, z: 1, state: 257 });
    await room.settle(50);
    expect(refusals).toEqual(['not ready yet', 'out of reach']);
    expect(room.hostWorld.getBlock(1, 0, 1)).toBe(0);
  });

  it('refuses a block placed on top of another player', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const a = await room.join(code, 'A');
    a.session.publishState(at(6.5, 0, 2.5));
    room.host.publishState(at(8.5, 0, 2.5));
    await room.settle(100);
    const refusals: string[] = [];
    a.session.onRejected((r) => refusals.push(r.reason));
    a.session.sendCommand({ type: 'place', x: 8, y: 0, z: 2, state: 257 });
    await room.settle(50);
    expect(refusals).toEqual(['a player is in the way']);
  });

  it('rate-limits a guest that floods commands', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const a = await room.join(code, 'A');
    a.session.publishState(at(8.5, 0, 4.5));
    await room.settle(100);
    const refusals: string[] = [];
    a.session.onRejected((r) => refusals.push(r.reason));
    for (let i = 0; i < 80; i++) {
      a.session.sendCommand(
        i % 2
          ? { type: 'break', x: 10, y: 0, z: 5 }
          : { type: 'place', x: 10, y: 0, z: 5, state: 257 },
      );
    }
    await room.settle(100);
    expect(refusals).toContain('too fast');
    // It recovers with time.
    await room.settle(2500);
    refusals.length = 0;
    a.session.sendCommand({ type: 'place', x: 11, y: 0, z: 5, state: 257 });
    await room.settle(50);
    expect(refusals).toEqual([]);
  });

  it('ignores a command sent before the guest is in', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const guest = room.addGuest();
    guest.session.sendCommand({ type: 'place', x: 1, y: 0, z: 1, state: 257 });
    guest.session.join(code);
    await room.settle(200);
    expect(room.hostWorld.getBlock(1, 0, 1)).toBe(0);
  });

  it('keeps the host as the authority: a guest cannot forge an event', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    raw.link.sendControl('{"t":"ev","s":99,"e":{"type":"set","x":5,"y":0,"z":5,"state":9,"by":1}}');
    await room.settle(100);
    expect(room.hostWorld.getBlock(5, 0, 5)).toBe(0);
  });
});

describe('returning guests', () => {
  it('gives a returning guest the same seat back, where it left off', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const first = await room.join(code, 'Ada', token(5));
    first.session.publishState(at(8.5, 0, -3.5));
    await room.settle(200);
    first.session.close();
    await room.settle(100);
    expect(room.host.players).toHaveLength(1);

    const back = room.addGuest('Ada again', token(5));
    const moves: { x: number; y: number; z: number }[] = [];
    back.session.onCorrection((c) => moves.push(c));
    back.session.join(code);
    await room.settle(200);
    expect(back.session.localId).toBe(first.session.localId);
    expect(room.host.players[1]).toMatchObject({ id: 2, slot: 1, name: 'Ada again' });
    expect(moves[0]?.x).toBeCloseTo(8.5, 2);
    expect(moves[0]?.z).toBeCloseTo(-3.5, 2);
  });

  it('treats a second page with the same token as a new player while the first is alive', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const one = await room.join(code, 'Tab one', token(6));
    one.session.publishState(at(1.5, 0, 1.5));
    await room.settle(100);
    const two = await room.join(code, 'Tab two', token(6));
    expect(one.session.phase).toBe('open');
    expect(two.session.phase).toBe('open');
    expect(two.session.localId).not.toBe(one.session.localId);
    expect(room.host.players).toHaveLength(3);
  });

  it('lets a reloaded page take its old seat back from a link that went silent', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const old = await room.join(code, 'Ada', token(7));
    old.session.publishState(at(4.5, 0, 4.5));
    await room.settle(100);
    // The old page vanishes without a word (a reload in the middle of a call).
    const link = room.network.links.find((l) => l.remoteId.startsWith('host-'));
    expect(link).toBeDefined();
    room.network.sever(link!);
    await room.settle(4000);

    const again = await room.join(code, 'Ada', token(7));
    expect(again.session.phase).toBe('open');
    expect(again.session.localId).toBe(old.session.localId);
    expect(room.host.players.map((p) => p.name)).toEqual(['Host', 'Ada']);
  });
});

describe('the host leaves', () => {
  it('tells every guest the session is over when the room closes', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const a = await room.join(code, 'A');
    const b = await room.join(code, 'B');
    room.host.closeRoom();
    await room.settle(100);
    for (const guest of [a, b]) {
      expect(guest.session.phase).toBe('closed');
      expect(guest.session.closed?.reason).toBe('host-left');
      expect(guest.session.closed?.title).toMatch(/host left/i);
    }
    expect(room.host.phase).toBe('open'); // the host can play on alone
    expect(room.host.role).toBe('solo');
  });

  it('does the same when the host session itself ends', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const a = await room.join(code, 'A');
    room.host.close();
    await room.settle(100);
    expect(a.session.closed?.reason).toBe('host-left');
  });

  it('notices a host that vanished without a word', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const a = await room.join(code, 'A');
    room.network.sever(room.network.links.find((l) => l.remoteId.startsWith('host-'))!);
    await room.settle(NET.timeoutMs - 1500);
    expect(a.session.phase).toBe('open');
    await room.settle(3000);
    expect(a.session.phase).toBe('closed');
    expect(a.session.closed?.reason).toBe('host-lost');
  });

  it('notices a guest that vanished and lets the others know', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const a = await room.join(code, 'A');
    const b = await room.join(code, 'B');
    const dead = room.network.links.filter((l) => l.remoteId.startsWith('host-'))[0]!;
    room.network.sever(dead);
    await room.settle(NET.timeoutMs + 3000);
    expect(room.host.players.map((p) => p.name)).toEqual(['Host', 'B']);
    expect(b.session.players.map((p) => p.name)).toEqual(['Host', 'B']);
    expect(a.session.players.length).toBeGreaterThan(0);
  });

  it('stops timers when everything is closed', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const a = await room.join(code, 'A');
    a.session.close();
    room.host.close();
    await room.settle(1000);
    expect(room.scheduler.pending).toBe(0);
  });
});

describe('pings', () => {
  it('measures the round trip and shares it', async () => {
    const room = makeRoom({ latency: 40 });
    const code = await room.openRoom();
    const a = await room.join(code, 'A');
    await room.settle(NET.pingIntervalMs * 3);
    expect(a.session.stats.rttMs).toBeGreaterThan(70);
    expect(a.session.stats.rttMs).toBeLessThan(110);
    expect(room.host.players[1]?.pingMs).toBeGreaterThan(70);
    const seenByGuest = a.session.players.find((p) => p.id === a.session.localId);
    expect(seenByGuest?.pingMs).toBeGreaterThan(70);
  });
});
