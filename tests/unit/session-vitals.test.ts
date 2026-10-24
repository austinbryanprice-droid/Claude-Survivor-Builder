import { describe, expect, it } from 'vitest';
import { HostSession } from '../../src/net/host-session';
import { SessionHub } from '../../src/net/hub';
import { ManualScheduler } from '../../src/net/scheduler';
import { fixedWorld } from '../../src/net/session';
import { VitalsMirror } from '../../src/net/vitals-mirror';
import { MOVEMENT } from '../../src/shared/movement';
import { NET } from '../../src/shared/net-config';
import { HOST_PLAYER_ID } from '../../src/shared/protocol';
import { createVitalsReading, type VitalsView } from '../../src/shared/vitals-state';
import { VITALS } from '../../src/systems/survival/balance';
import { SurvivalSim } from '../../src/systems/survival/sim';
import { speedScaleFor, handScaleFor } from '../../src/systems/survival/vitals';
import type { Outpost } from '../../src/world/outpost';
import { TestWorld, at, helloText, makeRoom, rawGuest, token } from './helpers/net';

function read(view: VitalsView) {
  return { ...view.read(createVitalsReading()) };
}

/** The `vt` frames a raw guest has been sent so far. */
function words(raw: Awaited<ReturnType<typeof rawGuest>>) {
  return raw.frames.filter((frame) => frame.t === 'vt');
}

describe("the host's own meters", () => {
  it('start full, read from the simulation', () => {
    const room = makeRoom({ survival: true });
    expect(read(room.host.vitals)).toMatchObject({
      health: VITALS.maxHealth,
      healthMax: VITALS.maxHealth,
      energy: VITALS.maxEnergy,
      energyMax: VITALS.maxEnergy,
      speedScale: 1,
      handScale: 1,
      charging: false,
    });
  });

  it('show nothing, so the bars are drawn full, where there is no simulation', () => {
    const room = makeRoom();
    expect(read(room.host.vitals)).toMatchObject({ healthMax: 0, energyMax: 0, speedScale: 1 });
  });

  it('move with the run: Energy drains while the player plays, and faster while sprinting', () => {
    const walking = makeRoom({ survival: true });
    const sprinting = makeRoom({ survival: true });
    for (const [room, speed] of [
      [walking, MOVEMENT.walkSpeed],
      [sprinting, MOVEMENT.sprintSpeed],
    ] as const) {
      room.host.setLocalActive(true);
      room.host.publishState(at(0, 0, 0, { vx: speed, onGround: true }));
      room.scheduler.advance(10_000);
    }
    expect(read(walking.host.vitals).energy).toBeGreaterThanOrEqual(99);
    expect(read(sprinting.host.vitals).energy).toBeLessThanOrEqual(96);
  });

  it('wait with the clock: nothing drains while the player is away', () => {
    const room = makeRoom({ survival: true });
    room.host.publishState(at(0, 0, 0, { vx: MOVEMENT.sprintSpeed, onGround: true }));
    room.host.survivalSim?.hurtPlayer(HOST_PLAYER_ID, 30);
    room.scheduler.advance(20_000);
    expect(read(room.host.vitals)).toMatchObject({ health: 70, energy: VITALS.maxEnergy });
  });

  it('cost a little Energy for every block placed or broken, and nothing for a refusal', () => {
    const room = makeRoom({ survival: true });
    for (let x = 1; x <= 40; x++)
      room.host.sendCommand({ type: 'place', x, y: 0, z: 3, state: 257 });
    expect(read(room.host.vitals).energy).toBe(VITALS.maxEnergy - 40 * VITALS.energy.perEdit);
    // Already built on, and nothing there to break: both are refused.
    room.host.sendCommand({ type: 'place', x: 1, y: 0, z: 3, state: 257 });
    room.host.sendCommand({ type: 'break', x: 1, y: 0, z: 9 });
    expect(read(room.host.vitals).energy).toBe(VITALS.maxEnergy - 40 * VITALS.energy.perEdit);
    for (let x = 1; x <= 4; x++) room.host.sendCommand({ type: 'break', x, y: 0, z: 3 });
    expect(read(room.host.vitals).energy).toBe(VITALS.maxEnergy - 44 * VITALS.energy.perEdit);
  });

  it('show a wound at once', () => {
    const room = makeRoom({ survival: true });
    expect(room.host.survivalSim?.hurtPlayer(HOST_PLAYER_ID, 35)).toBe(35);
    expect(read(room.host.vitals).health).toBe(65);
  });
});

describe('a guest’s meters in a room', () => {
  it('are told to a newcomer with the world, not at the next regular word', async () => {
    const room = makeRoom({ survival: true });
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const kinds = raw.frames.map((frame) => frame.t);
    const welcome = kinds.indexOf('welcome');
    const word = kinds.indexOf('vt');
    expect(welcome).toBeGreaterThanOrEqual(0);
    expect(word).toBeGreaterThan(welcome);
    expect(raw.frames[word]).toEqual({
      t: 'vt',
      hp: [VITALS.maxHealth, VITALS.maxHealth],
      en: [VITALS.maxEnergy, VITALS.maxEnergy],
      chg: false,
      rt: 0,
      sk: 0,
    });
  });

  it('say nothing at all where the host has no simulation', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(1500);
    expect(words(raw)).toHaveLength(0);
  });

  it("reach only the guest they are about: one guest's wound is not another's", async () => {
    const room = makeRoom({ survival: true });
    const code = await room.openRoom();
    const a = await room.join(code, 'A');
    const b = await room.join(code, 'B');
    room.host.survivalSim?.hurtPlayer(a.session.localId, 30);
    await room.settle(600);
    expect(read(a.session.vitals).health).toBe(70);
    expect(read(b.session.vitals).health).toBe(VITALS.maxHealth);
    expect(read(room.host.vitals).health).toBe(VITALS.maxHealth);
  });

  it('show a guest who has heard nothing yet full bars, and no slow-down', async () => {
    const room = makeRoom({ survival: true });
    const code = await room.openRoom();
    const guest = room.addGuest();
    expect(read(guest.session.vitals)).toMatchObject({ healthMax: 0, speedScale: 1, handScale: 1 });
    guest.session.join(code);
    await room.settle(300);
    expect(read(guest.session.vitals)).toMatchObject({ health: VITALS.maxHealth, healthMax: 100 });
  });

  it('slow a guest from the points the host sent, by the rule the host uses', async () => {
    const room = makeRoom({ survival: true });
    const code = await room.openRoom();
    const guest = await room.join(code);
    room.host.survivalSim?.playerVitals(guest.session.localId)?.set({ energy: 10 });
    await room.settle(600);
    const mine = read(guest.session.vitals);
    expect(mine.energy).toBeLessThanOrEqual(10);
    expect(mine.speedScale).toBeCloseTo(speedScaleFor(mine.energy / mine.energyMax), 10);
    expect(mine.handScale).toBeCloseTo(handScaleFor(mine.energy / mine.energyMax), 10);
    expect(mine.speedScale).toBeLessThan(1);
    const hosts = read(room.host.vitals);
    expect(hosts.speedScale).toBe(1);
  });

  it('say that the guest stands in the Core field, and charge them there', async () => {
    // A Core a few blocks from where the test world starts its players.
    const core: Outpost = { cellX: 3, cellZ: 3, baseY: 0, x: 4.5, z: 4.5, contains: () => false };
    const room = makeRoom({ survival: { core } });
    const code = await room.openRoom();
    const guest = await room.join(code);
    room.host.survivalSim?.playerVitals(guest.session.localId)?.set({ energy: 10 });
    guest.session.publishState(at(2.5, 0, 0.5));
    room.host.setLocalActive(true);
    await room.settle(1500);
    const mine = read(guest.session.vitals);
    expect(mine.charging).toBe(true);
    expect(mine.energy).toBeGreaterThan(10);
    // The host's own player stands at the same spot, so the host is charged too.
    room.host.publishState(at(2.5, 0, 0.5));
    await room.settle(500);
    expect(read(room.host.vitals).charging).toBe(true);
  });

  it('do not charge a guest who is far from the Core', async () => {
    const core: Outpost = {
      cellX: 60,
      cellZ: 60,
      baseY: 0,
      x: 61.5,
      z: 61.5,
      contains: () => false,
    };
    const room = makeRoom({ survival: { core } });
    const code = await room.openRoom();
    const guest = await room.join(code);
    room.host.survivalSim?.playerVitals(guest.session.localId)?.set({ energy: 10 });
    for (let i = 0; i < 6; i++) {
      guest.session.publishState(at(2.5, 0, 0.5));
      await room.settle(250);
    }
    // The host has seen the guest, so it is the distance that keeps the field from them.
    expect(room.host.sampleRemotes().map((pose) => pose.id)).toContain(guest.session.localId);
    expect(read(guest.session.vitals).charging).toBe(false);
    expect(read(guest.session.vitals).energy).toBeLessThanOrEqual(10);
  });

  it('cost a guest Energy for the blocks it places', async () => {
    const room = makeRoom({ survival: true });
    const code = await room.openRoom();
    const guest = await room.join(code);
    guest.session.publishState(at(8.5, 0, 4.5));
    room.host.publishState(at(0.5, 0, 0.5));
    await room.settle(100);
    for (let x = 3; x < 3 + 12; x++) {
      guest.session.sendCommand({ type: 'place', x, y: 0, z: 5, state: 257 });
    }
    await room.settle(800);
    expect(room.hostWorld.cells.size).toBe(12);
    const spent = 12 * VITALS.energy.perEdit;
    expect(read(guest.session.vitals).energy).toBeLessThanOrEqual(
      Math.ceil(VITALS.maxEnergy - spent) + 1,
    );
    expect(read(guest.session.vitals).energy).toBeGreaterThanOrEqual(
      Math.floor(VITALS.maxEnergy - spent) - 1,
    );
    expect(read(room.host.vitals).energy).toBe(VITALS.maxEnergy);
  });

  it('are sent a few times a second at most, however fast they change', async () => {
    const room = makeRoom({ survival: true });
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const guestId = (raw.frames.find((frame) => frame.t === 'welcome') as { id: number }).id;
    const before = words(raw).length;
    for (let i = 0; i < 20; i++) {
      room.host.survivalSim?.hurtPlayer(guestId, 2);
      room.scheduler.advance(NET.relayIntervalMs);
    }
    const sent = words(raw).length - before;
    // A second of blows, one every 50 ms: about one word per interval, never one per blow.
    expect(sent).toBeGreaterThanOrEqual(3);
    expect(sent).toBeLessThanOrEqual(Math.ceil(1000 / NET.vitalsIntervalMs) + 1);
    // And the last word says where it ended up.
    await room.settle(NET.vitalsIntervalMs * 2);
    expect(words(raw).at(-1)).toMatchObject({ hp: [60, VITALS.maxHealth] });
  });

  it('are quiet while nothing changes', async () => {
    const room = makeRoom({ survival: true });
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const before = words(raw).length;
    // A full bar loses its first point after twelve seconds of standing about; two seconds change nothing.
    await room.settle(2000);
    expect(words(raw).length).toBe(before);
  });

  it('are forgotten when the guest leaves, and begin full for the next one', async () => {
    const room = makeRoom({ survival: true });
    const code = await room.openRoom();
    const guest = await room.join(code);
    const id = guest.session.localId;
    room.host.survivalSim?.hurtPlayer(id, 50);
    guest.session.close();
    await room.settle(1000);
    expect(room.host.survivalSim?.playerVitals(id)).toBeUndefined();
    const next = await room.join(code, 'Next');
    expect(read(next.session.vitals).health).toBe(VITALS.maxHealth);
  });
});

describe("the guest's mirror of its meters", () => {
  it('shows nothing until the host speaks, and then the host’s last word', () => {
    const mirror = new VitalsMirror();
    expect(read(mirror)).toMatchObject({ healthMax: 0, energyMax: 0, speedScale: 1 });
    mirror.apply(40, 100, 80, 100, true);
    expect(read(mirror)).toMatchObject({
      health: 40,
      healthMax: 100,
      energy: 80,
      energyMax: 100,
      charging: true,
      speedScale: 1,
      handScale: 1,
    });
    mirror.apply(40, 100, 0, 100, false);
    expect(read(mirror)).toMatchObject({
      energy: 0,
      charging: false,
      speedScale: VITALS.energy.emptySpeed,
      handScale: VITALS.energy.emptyHands,
    });
  });
});

describe("the guest's mirror of its meters when the host starts the run over", () => {
  it('forgets the last word, so the bars are full until the new run speaks', () => {
    const mirror = new VitalsMirror();
    mirror.apply(0, 100, 0, 100, false, 4, 30);
    expect(read(mirror)).toMatchObject({ health: 0, returnIn: 4, shaken: 30 });
    mirror.reset();
    expect(read(mirror)).toEqual(read(new VitalsMirror()));
    expect(read(mirror)).toMatchObject({ returnIn: 0, shaken: 0, speedScale: 1, handScale: 1 });
  });
});

describe('the hub and the meters', () => {
  function solo() {
    const scheduler = new ManualScheduler();
    const session = new HostSession({
      scheduler,
      world: fixedWorld(new TestWorld(1)),
      name: 'Solo',
      token: token(61),
      survival: new SurvivalSim(),
    });
    return session;
  }

  it('reads the meters of whichever session is behind it', () => {
    const first = solo();
    const second = solo();
    const hub = new SessionHub(first);
    first.survivalSim?.hurtPlayer(HOST_PLAYER_ID, 20);
    expect(read(hub.vitals).health).toBe(80);
    hub.swap(second);
    expect(read(hub.vitals).health).toBe(VITALS.maxHealth);
    second.survivalSim?.hurtPlayer(HOST_PLAYER_ID, 45);
    expect(read(hub.vitals).health).toBe(55);
  });
});
