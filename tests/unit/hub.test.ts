import { describe, expect, it } from 'vitest';
import { SessionHub } from '../../src/net/hub';
import { at, makeRoom, token } from './helpers/net';
import { HostSession } from '../../src/net/host-session';
import { fixedWorld } from '../../src/net/session';
import { TestWorld } from './helpers/net';
import { ManualScheduler } from '../../src/net/scheduler';
import type { WorldEvent } from '../../src/shared/protocol';

function solo(name = 'Solo') {
  const scheduler = new ManualScheduler();
  const world = new TestWorld(1);
  const session = new HostSession({ scheduler, world: fixedWorld(world), name, token: token(50) });
  return { scheduler, world, session };
}

describe('session hub', () => {
  it('passes everything through to the session behind it', () => {
    const { session, world } = solo();
    const hub = new SessionHub(session);
    const seen: WorldEvent[] = [];
    hub.onEvent((e) => seen.push(e));
    expect(hub.role).toBe('solo');
    expect(hub.localId).toBe(1);
    expect(hub.players.map((p) => p.name)).toEqual(['Solo']);
    hub.publishState(at(1.5, 0, 1.5));
    hub.sendCommand({ type: 'place', x: 2, y: 0, z: 1, state: 4 });
    expect(world.getBlock(2, 0, 1)).toBe(4);
    expect(seen).toHaveLength(1);
    expect(hub.sampleRemotes()).toEqual([]);
    expect(hub.stats.rejections).toBe(0);
    expect(hub.roomCode).toBeNull();
    expect(hub.closed).toBeNull();
  });

  it('keeps listeners working across a swap and stops hearing the old session', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const first = solo('Alone');
    const hub = new SessionHub(first.session);

    const events: WorldEvent[] = [];
    const phases: string[] = [];
    let playerChanges = 0;
    const swaps: string[] = [];
    hub.onEvent((e) => events.push(e));
    hub.onPhase((p) => phases.push(p));
    hub.onPlayers(() => playerChanges++);
    hub.onSwap((s) => swaps.push(s.role));

    const guest = room.addGuest('Guest');
    hub.swap(guest.session);
    guest.session.join(code);
    await room.settle(400);
    expect(hub.role).toBe('guest');
    expect(hub.phase).toBe('open');
    expect(swaps).toEqual(['guest']);
    expect(phases).toEqual(expect.arrayContaining(['connecting', 'loading', 'open']));
    expect(playerChanges).toBeGreaterThan(0);

    // A block placed in the room reaches the hub's listener.
    room.host.publishState(at(0.5, 0, 0.5));
    room.host.sendCommand({ type: 'place', x: 2, y: 0, z: 0, state: 4 });
    await room.settle(100);
    expect(events).toHaveLength(1);

    // The old session is no longer heard.
    first.session.publishState(at(1.5, 0, 1.5));
    first.session.sendCommand({ type: 'place', x: 3, y: 0, z: 1, state: 4 });
    expect(events).toHaveLength(1);

    // And the hub's commands now go to the new one.
    hub.sendCommand({ type: 'place', x: 2, y: 0, z: 1, state: 4 });
    expect(first.world.getBlock(2, 0, 1)).toBe(0);
  });

  it('ignores a swap to the session it already has, and stops listeners that unsubscribed', () => {
    const { session } = solo();
    const hub = new SessionHub(session);
    let swaps = 0;
    const stop = hub.onSwap(() => swaps++);
    hub.swap(session);
    expect(swaps).toBe(0);
    stop();
    const other = solo('Other');
    hub.swap(other.session);
    expect(swaps).toBe(0);
    expect(hub.current).toBe(other.session);
  });
});
