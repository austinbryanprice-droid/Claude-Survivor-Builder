import { describe, expect, it } from 'vitest';
import { HostSession } from '../../src/net/host-session';
import { SessionHub } from '../../src/net/hub';
import { ManualScheduler } from '../../src/net/scheduler';
import { fixedWorld } from '../../src/net/session';
import { MATERIAL } from '../../src/shared/blocks';
import { DAY_SECONDS } from '../../src/shared/daycycle';
import { ENEMY_KIND } from '../../src/shared/enemy-state';
import { createEconomyReading, poolSlot } from '../../src/shared/economy';
import { createRng } from '../../src/shared/hash';
import { NET } from '../../src/shared/net-config';
import { NO_PLAYER, type WorldEvent } from '../../src/shared/protocol';
import { createReading, type SurvivalEvent } from '../../src/shared/survival-state';
import { createVitalsReading } from '../../src/shared/vitals-state';
import { KIND_ENEMIES, decodeEnemies, packetKind } from '../../src/shared/wire';
import { ENEMIES } from '../../src/systems/survival/balance';
import type { NavWorld } from '../../src/systems/survival/nav';
import { SurvivalSim } from '../../src/systems/survival/sim';
import { outpostFor } from '../../src/world/outpost';
import { FLOOR, arena, play, sim } from './helpers/arena';
import { SCRAP } from './helpers/nav-world';
import { TestWorld, at, helloText, makeRoom, rawGuest, token } from './helpers/net';

/** A wall across the way east, too long to go round: sixty-one blocks. */
const WALL_BLOCKS = 61;
function wall(world: TestWorld): void {
  for (let z = -30; z <= 30; z++) world.setBlock(8, FLOOR, z, SCRAP);
}

function ids(poses: readonly { id: number }[]): number[] {
  return poses.map((pose) => pose.id).sort((a, b) => a - b);
}

/** The enemy packets a raw guest has been sent. */
function reports(raw: Awaited<ReturnType<typeof rawGuest>>) {
  return raw.packets
    .filter((packet) => packetKind(packet.bytes) === KIND_ENEMIES)
    .map((packet) => ({ at: packet.at, packet: decodeEnemies(packet.bytes)! }));
}

describe('the machines on the host', () => {
  it('are not there where the world gave the run no ground to walk', () => {
    const room = makeRoom({ survival: true });
    expect(room.host.survivalSim?.enemies).toBeNull();
    room.host.setLocalActive(true);
    room.scheduler.advance(2000);
    expect(room.host.sampleEnemies()).toEqual([]);
    // Nor where there is no run at all.
    expect(makeRoom().host.sampleEnemies()).toEqual([]);
  });

  it('are drawn from the simulation, on the ring round the Core they came in on', () => {
    const { room, core, machines } = arena();
    room.host.setLocalActive(true);
    expect(machines().spawn(8)).toBe(8);
    room.scheduler.advance(1000);
    const seen = room.host.sampleEnemies();
    expect(seen).toHaveLength(8);
    expect(new Set(ids(seen)).size).toBe(8);
    for (const pose of seen) {
      expect(pose.kind).toBe(0);
      expect(pose.health).toBe(1);
      const radius = Math.hypot(pose.x - core.x, pose.z - core.z);
      expect(radius).toBeGreaterThan(ENEMIES.spawnRadius - ENEMIES.spawnJitter - 4);
      expect(radius).toBeLessThan(ENEMIES.spawnRadius + ENEMIES.spawnJitter + 1);
    }
  });

  it('wait with the clock: nothing moves while the run is held', () => {
    const { room, machines } = arena();
    machines().spawn(4);
    room.scheduler.advance(1000);
    const before = room.host.sampleEnemies().map((pose) => [pose.id, pose.x, pose.z]);
    expect(before).toHaveLength(4);
    room.scheduler.advance(4000);
    expect(room.host.sampleEnemies().map((pose) => [pose.id, pose.x, pose.z])).toEqual(before);
    room.host.setLocalActive(true);
    room.scheduler.advance(4000);
    expect(room.host.sampleEnemies().map((pose) => [pose.id, pose.x, pose.z])).not.toEqual(before);
  });

  it('march on the Core and wound it', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    machines().spawn(6);
    const max = sim(room).coreMax;
    await play(room, 12);
    expect(sim(room).coreHealth).toBe(max);
    await play(room, 40);
    expect(sim(room).coreHealth).toBeLessThan(max);
    // The ones at the Core are drawn there, biting.
    const seen = room.host.sampleEnemies();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((pose) => Math.hypot(pose.x + 1.5, pose.z + 3.5) < 4)).toBe(true);
  });

  it('go for the host’s player when one stands near, and wound them', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    room.host.publishState(at(20.5, FLOOR, -3.5));
    machines().spawnAt(26.5, -3.5);
    await play(room, 4);
    const mine = room.host.vitals.read(createVitalsReading());
    expect(mine.health).toBeLessThan(mine.healthMax);
    expect(mine.health).toBeGreaterThan(0);
  });

  it('leave a player who is far from them alone', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    room.host.publishState(at(-1.5, FLOOR, 30.5));
    machines().spawnAt(26.5, -3.5);
    await play(room, 3);
    const mine = room.host.vitals.read(createVitalsReading());
    expect(mine.health).toBe(mine.healthMax);
  });

  it('stop where they are once the Core has fallen', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    machines().spawnAt(-1.5, 0.5);
    await play(room, 1);
    sim(room).hurtCore(10_000);
    expect(sim(room).over).toBe(true);
    const frozen = room.host.sampleEnemies().map((pose) => [pose.x, pose.z]);
    await play(room, 3);
    expect(room.host.sampleEnemies().map((pose) => [pose.x, pose.z])).toEqual(frozen);
  });
});

describe('the machines and the blocks', () => {
  it('chew through a wall, and the break is the world’s own: every screen sees the block go', async () => {
    const { room, hostWorld, machines } = arena({}, {}, wall);
    const code = await room.openRoom();
    const guest = await room.join(code, 'Ada');
    expect(guest.world().cells.size).toBe(WALL_BLOCKS);
    const hostSaw: WorldEvent[] = [];
    const guestSaw: WorldEvent[] = [];
    room.host.onEvent((event) => hostSaw.push(event));
    guest.session.onEvent((event) => guestSaw.push(event));
    const energy = room.host.vitals.read(createVitalsReading()).energy;

    machines().spawnAt(11.5, -3.5);
    await play(room, 6);

    const broken = hostSaw.filter((event) => event.type === 'set' && event.state === 0);
    expect(broken.length).toBeGreaterThanOrEqual(1);
    for (const event of broken) {
      expect(event).toMatchObject({ type: 'set', x: 8, y: FLOOR, state: 0, by: NO_PLAYER });
    }
    expect(hostWorld.cells.size).toBe(WALL_BLOCKS - broken.length);
    expect(guestSaw).toEqual(hostSaw);
    expect(guest.world().edits()).toEqual(hostWorld.edits());
    // Chewing is not a player building, so it costs no one anything.
    expect(room.host.vitals.read(createVitalsReading()).energy).toBe(energy);
  });

  it('walk on through the gap they made, and wound the Core', async () => {
    const { room, hostWorld, machines } = arena({}, {}, wall);
    room.host.setLocalActive(true);
    machines().spawnAt(11.5, -3.5);
    const max = sim(room).coreMax;
    await play(room, 20);
    expect(sim(room).coreHealth).toBeLessThan(max);
    expect(hostWorld.cells.size).toBeLessThan(WALL_BLOCKS);
  });

  it('meet a wall the host builds in their way, and chew through it rather than walk through', async () => {
    // A wall of sixty-one blocks is more than the pool opens with, so the run opens with plenty. A
    // heap keeps its ground clear of blocks, and the valley of seed 3 lays none across this wall.
    const { room, hostWorld, machines } = arena({}, { stock: 500, seed: 3 });
    room.host.setLocalActive(true);
    // The way east is open: a crawler walks straight in.
    machines().spawnAt(14.5, -3.5);
    await play(room, 1);
    expect(room.host.sampleEnemies()[0]!.x).toBeLessThan(13);
    // The host walls the way off; the run's map hears of it from the world's own change.
    for (let z = -30; z <= 30; z++) {
      room.host.sendCommand({ type: 'place', x: 8, y: FLOOR, z, state: SCRAP });
    }
    expect(hostWorld.cells.size).toBe(WALL_BLOCKS);
    await play(room, 2);
    // Two seconds on it is at the wall, chewing: without the wall it would be well past it.
    const chewing = room.host.sampleEnemies()[0]!;
    expect(chewing.x).toBeGreaterThan(8.9);
    expect(chewing.x).toBeLessThan(10.5);
    expect(hostWorld.cells.size).toBe(WALL_BLOCKS);
    await play(room, 4);
    expect(hostWorld.cells.size).toBeLessThan(WALL_BLOCKS);
    expect(room.host.sampleEnemies()[0]!.x).toBeLessThan(8);
  });
});

describe('the machines on a guest', () => {
  it('show before the first packet as nothing at all', async () => {
    const { room } = arena();
    const code = await room.openRoom();
    const guest = room.addGuest();
    expect(guest.session.sampleEnemies()).toEqual([]);
    guest.session.join(code);
    await room.settle(300);
    expect(guest.session.sampleEnemies()).toEqual([]);
  });

  it('are the machines the host has, in about the same places', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const guest = await room.join(code, 'Ada');
    expect(machines().spawn(12)).toBe(12);
    await play(room, 3);
    const host = room.host.sampleEnemies();
    const there = guest.session.sampleEnemies();
    expect(ids(there)).toEqual(ids(host));
    expect(there).toHaveLength(12);
    for (const pose of host) {
      const other = there.find((p) => p.id === pose.id)!;
      // The host draws 70 ms behind its own clock and a guest 150 ms behind the host's: a few tenths of a block apart.
      expect(Math.hypot(other.x - pose.x, other.z - pose.z)).toBeLessThan(1);
      expect(other.health).toBe(1);
    }
  });

  it('see the machines that were already out when they came in', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    machines().spawn(5);
    await play(room, 2);
    const guest = await room.join(code, 'Late');
    await play(room, 1);
    expect(guest.session.sampleEnemies()).toHaveLength(5);
  });

  it('stop seeing them when the last one falls, and when they leave', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const guest = await room.join(code, 'Ada');
    machines().spawn(3);
    await play(room, 2);
    expect(guest.session.sampleEnemies()).toHaveLength(3);
    machines().clear();
    await play(room, 1);
    expect(guest.session.sampleEnemies()).toEqual([]);
    expect(room.host.sampleEnemies()).toEqual([]);
    machines().spawn(3);
    await play(room, 2);
    expect(guest.session.sampleEnemies()).toHaveLength(3);
    guest.session.close();
    expect(guest.session.sampleEnemies()).toEqual([]);
  });

  it('are told to each guest alike, and the damage they do is the host’s alone to settle', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const a = await room.join(code, 'Ada');
    const b = await room.join(code, 'Bo');
    // Neither guest has sent a position, so the host takes the spots it is given here.
    sim(room).observe(a.session.localId, 20.5, FLOOR, -3.5, 0, true);
    sim(room).observe(b.session.localId, -1.5, FLOOR, 40.5, 0, true);
    machines().spawnAt(26.5, -3.5);
    await play(room, 4);
    expect(ids(a.session.sampleEnemies())).toEqual(ids(b.session.sampleEnemies()));
    expect(a.session.sampleEnemies()).toHaveLength(1);
    const hurt = a.session.vitals.read(createVitalsReading());
    const fine = b.session.vitals.read(createVitalsReading());
    expect(hurt.health).toBeLessThan(hurt.healthMax);
    expect(fine.health).toBe(fine.healthMax);
  });

  it('survive a bad network: lost, late and reordered packets never double, lose or invent a machine', async () => {
    let behind = 0;
    for (const seed of [31, 32, 33]) {
      const jitter = createRng(seed + 1000);
      const { room, machines } = arena({
        latency: () => 20 + jitter() * 250,
        stateLoss: 0.2,
        stateReorder: true,
        random: createRng(seed),
      });
      room.host.setLocalActive(true);
      const code = await room.openRoom();
      const guest = await room.join(code, 'Ada');
      await play(room, 2);
      machines().spawn(10);
      let longest = 0;
      for (let t = 0; t < 15_000; t += 50) {
        room.scheduler.advance(50);
        await room.flush();
        const seen = guest.session.sampleEnemies();
        longest = Math.max(longest, seen.length);
        const named = ids(seen);
        expect(new Set(named).size).toBe(named.length);
        expect(seen.length).toBeLessThanOrEqual(10);
      }
      expect(longest).toBe(10);
      behind += guest.session.stats.staleDropped;
    }
    // Some of the reordering was real, and the guest threw the late packets away.
    expect(behind).toBeGreaterThan(0);
  });

  it('are cleared by the next word even when the word that emptied the field was lost', async () => {
    for (const seed of [41, 42, 43, 44]) {
      const { room, machines } = arena({ stateLoss: 0.7, random: createRng(seed) });
      room.host.setLocalActive(true);
      const code = await room.openRoom();
      const guest = await room.join(code, 'Ada');
      machines().spawn(4);
      await play(room, 4);
      machines().clear();
      // Whatever was lost, within a few of the host's once-a-second words the guest has heard that the field is empty.
      await play(room, 20);
      expect(guest.session.sampleEnemies()).toEqual([]);
    }
  });
});

describe('the armored machines', () => {
  const FELLING = ENEMIES.armored.health / ENEMIES.armored.takes;
  const CELLS = ENEMIES.armored.drop?.amount ?? 0;
  const energy = (view: {
    read(into: ReturnType<typeof createEconomyReading>): unknown;
  }): number => {
    const reading = createEconomyReading();
    view.read(reading);
    return reading.stock[poolSlot(MATERIAL.energy)] as number;
  };

  it('are drawn as armored on every screen, whole until they are hit', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const guest = await room.join(code, 'Ada');
    const plain = machines().spawnAt(26.5, -3.5);
    const plated = machines().spawnAt(26.5, 3.5, 1, ENEMY_KIND.armored);
    await play(room, 1);
    for (const seen of [room.host.sampleEnemies(), guest.session.sampleEnemies()]) {
      expect(seen).toHaveLength(2);
      expect(seen.find((pose) => pose.id === plain)?.kind).toBe(ENEMY_KIND.crawler);
      expect(seen.find((pose) => pose.id === plated)?.kind).toBe(ENEMY_KIND.armored);
      expect(seen.every((pose) => pose.health === 1)).toBe(true);
    }
  });

  it('leave their cells in the pool when they fall, and every screen hears of it', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    const bob = await room.join(code, 'Bob');
    const views = [room.host, ada.session, bob.session];
    const heard = views.map((view) => {
      const seen: SurvivalEvent[] = [];
      view.survival.onEvent((event) => seen.push(event));
      return seen;
    });
    const armored = machines().spawnAt(26.5, -3.5, 1, ENEMY_KIND.armored);
    await play(room, 1);
    for (const view of views) expect(energy(view.economy)).toBe(0);

    machines().hurt(armored!, FELLING - 1);
    await play(room, 1);
    for (const view of views) expect(energy(view.economy)).toBe(0);
    for (const seen of heard) expect(seen.filter((event) => event.k === 'drop')).toEqual([]);

    machines().hurt(armored!, 2);
    await play(room, 1);
    const drop = { k: 'drop', n: 1, m: MATERIAL.energy, c: CELLS };
    for (const view of views) expect(energy(view.economy)).toBe(CELLS);
    for (const seen of heard) expect(seen.filter((event) => event.k === 'drop')).toEqual([drop]);
    // The cells count with what the crew has gathered, on every screen.
    for (const view of views) expect(view.survival.read(createReading()).gathered).toBe(CELLS);
  });

  it('leave nothing for a plain crawler, and the crew is told nothing', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const guest = await room.join(code, 'Ada');
    const seen: SurvivalEvent[] = [];
    guest.session.survival.onEvent((event) => seen.push(event));
    const plain = machines().spawnAt(26.5, -3.5);
    await play(room, 1);
    expect(machines().hurt(plain!, ENEMIES.crawler.health)).toBe(true);
    await play(room, 1);
    expect(energy(guest.session.economy)).toBe(0);
    expect(seen.filter((event) => event.k === 'drop')).toEqual([]);
  });
});

describe('the flying machines', () => {
  const HOVER = ENEMIES.flyer.flies.hover;
  const CELLS = ENEMIES.flyer.drop?.amount ?? 0;

  it('are drawn as skimmers on every screen, hovering over the ground', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const guest = await room.join(code, 'Ada');
    const skimmer = machines().spawnAt(26.5, -3.5, 1, ENEMY_KIND.flyer);
    expect(skimmer).not.toBeNull();
    await play(room, 1);
    for (const seen of [room.host.sampleEnemies(), guest.session.sampleEnemies()]) {
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ id: skimmer, kind: ENEMY_KIND.flyer });
      // Over the ground at its hover, to within the sixteenth of a block the wire keeps.
      expect(Math.abs(seen[0]!.y - (FLOOR + HOVER))).toBeLessThan(1 / 16);
    }
  });

  it('cross a wall that holds the walkers without chewing a block of it, and wound the Core from beside it', async () => {
    const { room, hostWorld, machines } = arena({}, {}, wall);
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const guest = await room.join(code, 'Ada');
    machines().spawnAt(26.5, -3.5, 1, ENEMY_KIND.flyer);
    const max = sim(room).coreMax;
    await play(room, 10);
    // It is on the Core's side of the wall, and nothing was chewed on the way.
    expect(sim(room).coreHealth).toBeLessThan(max);
    expect(hostWorld.cells.size).toBe(WALL_BLOCKS);
    for (const seen of [room.host.sampleEnemies(), guest.session.sampleEnemies()]) {
      expect(seen).toHaveLength(1);
      expect(seen[0]!.x).toBeLessThan(8);
    }
  });

  it('leave their cells in the pool when they fall, and every screen hears of it', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    const views = [room.host, ada.session];
    const heard = views.map((view) => {
      const seen: SurvivalEvent[] = [];
      view.survival.onEvent((event) => seen.push(event));
      return seen;
    });
    const energyOf = (view: (typeof views)[number]): number => {
      const reading = createEconomyReading();
      view.economy.read(reading);
      return reading.stock[poolSlot(MATERIAL.energy)] as number;
    };
    const skimmer = machines().spawnAt(26.5, -3.5, 1, ENEMY_KIND.flyer)!;
    await play(room, 1);
    machines().hurt(skimmer, ENEMIES.flyer.health - 1);
    await play(room, 1);
    for (const view of views) expect(energyOf(view)).toBe(0);
    machines().hurt(skimmer, 2);
    await play(room, 1);
    const drop = { k: 'drop', n: 1, m: MATERIAL.energy, c: CELLS };
    for (const view of views) expect(energyOf(view)).toBe(CELLS);
    for (const seen of heard) expect(seen.filter((event) => event.k === 'drop')).toEqual([drop]);
    expect(room.host.sampleEnemies()).toEqual([]);
  });
});

describe('what the host puts on the wire', () => {
  it('is one packet ten times a second, naming every machine', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    machines().spawn(10);
    await play(room, 0.1);
    const start = reports(raw).length;
    await play(room, 2);
    const sent = reports(raw).slice(start);
    expect(sent.length).toBeGreaterThanOrEqual(19);
    expect(sent.length).toBeLessThanOrEqual(21);
    for (const { packet } of sent) expect(packet.entries).toHaveLength(10);
    // Counting up one at a time, and stamped with the host's clock as it ran.
    for (let i = 1; i < sent.length; i++) {
      expect((sent[i]!.packet.seq - sent[i - 1]!.packet.seq + 65536) % 65536).toBe(1);
      expect(sent[i]!.packet.hostTime).toBeGreaterThan(sent[i - 1]!.packet.hostTime);
    }
    for (const { at: arrived, packet } of sent) {
      expect(packet.hostTime).toBeLessThanOrEqual(arrived);
      expect(arrived - packet.hostTime).toBeLessThan(NET.enemyIntervalMs);
    }
  });

  it('is nearly silent on a quiet day: an empty word about once a second', async () => {
    const { room } = arena();
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const start = reports(raw).length;
    await play(room, 5);
    const sent = reports(raw).slice(start);
    expect(sent.length).toBeGreaterThanOrEqual(4);
    expect(sent.length).toBeLessThanOrEqual(6);
    for (const { packet } of sent) expect(packet.entries).toEqual([]);
  });

  it('says at once that the field is empty, and then goes back to the slow word', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    machines().spawn(3);
    await play(room, 1);
    machines().clear();
    const clearedAt = room.scheduler.now();
    await play(room, 3);
    const after = reports(raw).filter((report) => report.at > clearedAt);
    expect(after[0]!.packet.entries).toEqual([]);
    expect(after[0]!.at - clearedAt).toBeLessThanOrEqual(NET.enemyIntervalMs + NET.relayIntervalMs);
    expect(after.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < after.length; i++) {
      expect(after[i]!.at - after[i - 1]!.at).toBeGreaterThanOrEqual(NET.enemyKeepAliveMs - 60);
    }
  });

  it('sends nothing to a link that has not said hello', async () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    machines().spawn(5);
    const raw = await rawGuest(room, code);
    // Not a guest until it says hello: a dial alone is not a seat.
    await play(room, 2);
    expect(reports(raw)).toHaveLength(0);
    expect(room.host.sampleEnemies()).toHaveLength(5);
  });

  it('can field as many as the cap allows, all of them in one packet', () => {
    const { room, machines } = arena();
    room.host.setLocalActive(true);
    machines().spawn(ENEMIES.maxAlive);
    room.scheduler.advance(500);
    expect(room.host.sampleEnemies().length).toBe(ENEMIES.maxAlive);
    expect(ENEMIES.maxAlive).toBeLessThanOrEqual(NET.maxEnemies);
  });
});

describe('the hub and the machines', () => {
  function solo(seed: number) {
    const scheduler = new ManualScheduler();
    const hostWorld = new TestWorld(1);
    const core = outpostFor(() => FLOOR);
    const nav: NavWorld = {
      solids: { isSolid: (x, y, z) => hostWorld.isSolid(x, y, z) || core.contains(x, y, z) },
      blockAt: (x, y, z) => hostWorld.getBlock(x, y, z),
      surfaceAt: () => FLOOR,
      waterLevel: 0,
      half: 96,
    };
    const session = new HostSession({
      scheduler,
      world: fixedWorld(hostWorld),
      name: 'Solo',
      token: token(60 + seed),
      survival: new SurvivalSim({ core, nav, seed, startAt: DAY_SECONDS + 1, waves: false }),
    });
    session.setLocalActive(true);
    return { session, scheduler };
  }

  it('draws the machines of whichever session is behind it', () => {
    const first = solo(1);
    const second = solo(2);
    const hub = new SessionHub(first.session);
    first.session.survivalSim?.enemies?.spawn(3);
    first.scheduler.advance(500);
    expect(hub.sampleEnemies()).toHaveLength(3);
    hub.swap(second.session);
    second.scheduler.advance(500);
    expect(hub.sampleEnemies()).toEqual([]);
    second.session.survivalSim?.enemies?.spawn(6);
    second.scheduler.advance(500);
    expect(hub.sampleEnemies()).toHaveLength(6);
  });

  it('wound the Core of a lone host, who is playing', () => {
    const { session, scheduler } = solo(3);
    session.survivalSim?.enemies?.spawnAt(-1.5, 0);
    scheduler.advance(8000);
    const reading = session.survival.read(createReading());
    expect(reading.coreHealth).toBeLessThan(reading.coreMax);
  });
});
