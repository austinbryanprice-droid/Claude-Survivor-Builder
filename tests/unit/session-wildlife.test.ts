import { describe, expect, it } from 'vitest';
import type { GameSession } from '../../src/net/session';
import type { Vec3 } from '../../src/shared/look';
import { PLAYER } from '../../src/shared/movement';
import { NET } from '../../src/shared/net-config';
import { HOST_PLAYER_ID } from '../../src/shared/protocol';
import { SHOT_FLAG, type ShotEvent } from '../../src/shared/shot';
import {
  WILD_FLAG,
  WILD_SPECIES,
  createWildState,
  type WildPose,
} from '../../src/shared/wildlife-state';
import { KIND_WILDLIFE, decodeWildlife, packetKind } from '../../src/shared/wire';
import { BLASTER, VITALS } from '../../src/systems/survival/balance';
import type { SurvivalOptions } from '../../src/systems/survival/sim';
import { SPECIES, WILDLIFE, wildHitboxOf, type Species } from '../../src/systems/wildlife/balance';
import { FLOOR, arena, play, sim, type Room } from './helpers/arena';
import { SCRAP } from './helpers/nav-world';
import { at, helloText, rawGuest, type RoomOptions, type TestWorld } from './helpers/net';

/** Where each seat stands: in a row north-east of the Core, on the flat ground at 10. */
function seatFor(slot: number): { x: number; y: number; z: number } {
  return { x: 8.5 + slot * 2, y: FLOOR, z: 10.5 };
}

function eye(slot: number): Vec3 {
  const spot = seatFor(slot);
  return { x: spot.x, y: spot.y + PLAYER.eyeHeight, z: spot.z };
}

/**
 * A room with `crew` guests who have said where they stand, the host included, and a valley with no
 * creatures in it yet: each test brings the ones it wants.
 */
async function meadow(
  crew = 2,
  options: RoomOptions = {},
  build?: (world: TestWorld) => void,
  run: SurvivalOptions = {},
) {
  const { room } = arena({ spawnFor: seatFor, ...options }, { wildlife: true, ...run }, build);
  const code = await room.openRoom();
  const guests = [];
  for (let i = 0; i < crew; i++) guests.push(await room.join(code, `Guest ${i + 1}`));
  await room.settle(options.latency ? 3000 : 100);
  room.host.publishState(at(seatFor(0).x, FLOOR, seatFor(0).z));
  for (const [i, guest] of guests.entries()) {
    const spot = seatFor(i + 1);
    guest.session.publishState(at(spot.x, spot.y, spot.z));
  }
  await room.settle(100);
  const wild = sim(room).wildlife!;
  wild.clear();
  return { room, code, guests, wild };
}

/** The unit vector from `from` to the middle of a creature's body, `height` tall. */
function toward(from: Vec3, pose: Pick<WildPose, 'x' | 'y' | 'z'>, height: number): Vec3 {
  const dx = pose.x - from.x;
  const dy = pose.y + height / 2 - from.y;
  const dz = pose.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  return { x: dx / length, y: dy / length, z: dz / length };
}

/** A copy of the first creature a session draws, which is where its player sees it. */
function seen(session: GameSession): WildPose {
  const pose = session.sampleWildlife()[0];
  expect(pose).toBeDefined();
  return { ...(pose as WildPose) };
}

function listen(session: GameSession): ShotEvent[] {
  const heard: ShotEvent[] = [];
  session.onShot((shot) => heard.push(shot));
  return heard;
}

/** The creature as the host reports it, or undefined once it is gone. */
function stateOf(room: Room, id: number) {
  const states = Array.from({ length: WILDLIFE.maxAlive }, createWildState);
  const count = sim(room).wildlife!.write(states);
  return states.slice(0, count).find((state) => state.id === id);
}

function healthOf(room: Room, id: number): number {
  return sim(room).playerVitals(id)!.health;
}

const ids = (poses: readonly { id: number }[]): number[] =>
  poses.map((pose) => pose.id).sort((a, b) => a - b);

const STAG = SPECIES[WILD_SPECIES.stag] as Species;

describe('the wildlife on the host and the guests', () => {
  it('shows every screen the same creatures: what they are and about where', async () => {
    const { room, guests, wild } = await meadow(2);
    const made = [
      wild.spawnAt(WILD_SPECIES.stag, 30.5, 30.5),
      wild.spawnAt(WILD_SPECIES.hare, -24.5, 34.5),
      wild.spawnAt(WILD_SPECIES.kite, 10.5, 60.5),
      wild.spawnAt(WILD_SPECIES.finch, -40.5, 20.5),
    ];
    expect(made.every((id) => id > 0)).toBe(true);
    await play(room, 2);

    const hosts = room.host.sampleWildlife().map((pose) => ({ ...pose }));
    expect(ids(hosts)).toEqual([...made].sort((a, b) => a - b));
    for (const guest of guests) {
      const theirs = guest.session.sampleWildlife();
      expect(ids(theirs)).toEqual(ids(hosts));
      for (const pose of theirs) {
        const same = hosts.find((other) => other.id === pose.id)!;
        expect(pose.kind).toBe(same.kind);
        // The guest's picture is a little older than the host's, and a flock moves a few blocks a second.
        expect(Math.hypot(pose.x - same.x, pose.z - same.z)).toBeLessThan(2.5);
      }
    }
    expect(new Set(hosts.map((pose) => pose.kind))).toEqual(
      new Set([WILD_SPECIES.stag, WILD_SPECIES.hare, WILD_SPECIES.kite, WILD_SPECIES.finch]),
    );
  });

  it('sends one packet ten times a second, and an empty valley about once a second', async () => {
    const { room, code, wild } = await meadow(0);
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    wild.spawnAt(WILD_SPECIES.hare, 20.5, 30.5);
    wild.spawnAt(WILD_SPECIES.stag, 30.5, 30.5);
    const since = room.scheduler.now();
    await play(room, 3);
    const reports = raw.packets
      .filter((packet) => packetKind(packet.bytes) === KIND_WILDLIFE && packet.at >= since)
      .map((packet) => decodeWildlife(packet.bytes)!);
    expect(reports.length).toBeGreaterThanOrEqual(25);
    expect(reports.length).toBeLessThanOrEqual(31);
    expect(reports.every((report) => report.entries.length === 2)).toBe(true);
    // Every packet is newer than the last.
    for (let i = 1; i < reports.length; i++) {
      expect(reports[i]!.hostTime).toBeGreaterThan(reports[i - 1]!.hostTime);
    }

    // Emptied, the guests are told at once, and then only now and then to put right a lost packet.
    wild.clear();
    const emptied = raw.packets.length;
    await play(room, 4);
    const later = raw.packets
      .slice(emptied)
      .filter((packet) => packetKind(packet.bytes) === KIND_WILDLIFE)
      .map((packet) => decodeWildlife(packet.bytes)!);
    expect(later.length).toBeGreaterThanOrEqual(1);
    expect(later.length).toBeLessThanOrEqual(1 + Math.ceil(4000 / NET.wildlifeKeepAliveMs));
    expect(later[0]!.entries).toHaveLength(0);
  });

  it('is not there unless the run asks for it, and nothing is sent', async () => {
    const { room } = arena({ spawnFor: seatFor });
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const ada = await room.join(code, 'Ada');
    await play(room, 3);
    expect(sim(room).wildlife).toBeNull();
    expect(room.host.sampleWildlife()).toEqual([]);
    expect(ada.session.sampleWildlife()).toEqual([]);
    expect(raw.packets.filter((packet) => packetKind(packet.bytes) === KIND_WILDLIFE)).toEqual([]);
  });
});

describe('a guest’s shot at a creature', () => {
  it('is decided by the host and told to everyone, as a creature’s and not a machine’s', async () => {
    const { room, guests, wild } = await meadow(2);
    const [ada, bo] = guests as [(typeof guests)[0], (typeof guests)[0]];
    const id = wild.spawnAt(WILD_SPECIES.stag, 10.5, 30.5);
    await play(room, 1.5);
    const heardByAda = listen(ada.session);
    const heardByBo = listen(bo.session);
    const heardByHost = listen(room.host);

    const target = seen(ada.session);
    expect(target.id).toBe(id);
    ada.session.fire(eye(1), toward(eye(1), target, wildHitboxOf(WILD_SPECIES.stag)!.height));
    await room.settle(100);

    for (const heard of [heardByAda, heardByBo, heardByHost]) {
      expect(heard).toHaveLength(1);
      const shot = heard[0] as ShotEvent;
      expect(shot.by).toBe(ada.session.localId);
      expect(shot.flags).toBe(SHOT_FLAG.wild);
      expect(shot.enemy).toBe(id);
      // It ended on the near face of the stag's box, a block or so from where it was drawn.
      expect(Math.hypot(shot.x - target.x, shot.z - target.z)).toBeLessThan(1.4);
    }
    expect(heardByBo).toEqual(heardByAda);
    expect(heardByHost).toEqual(heardByAda);
    // The blow is the host's: the stag lost the blaster's damage and it is out for Ada.
    const state = stateOf(room, id)!;
    expect(state.health).toBe(Math.round(((STAG.health - BLASTER.damage) / STAG.health) * 255));
    expect(state.flags & WILD_FLAG.angry).toBe(WILD_FLAG.angry);
    // ...and the tally of machines felled, and the machines themselves, are none of its business.
    expect(sim(room).felled).toBe(0);
    expect(sim(room).enemies!.count).toBe(0);
  });

  it('costs the shooter the same Energy as any shot', async () => {
    const { room, guests, wild } = await meadow(2);
    const [ada, bo] = guests as [(typeof guests)[0], (typeof guests)[0]];
    wild.spawnAt(WILD_SPECIES.stag, 10.5, 30.5);
    await play(room, 1.5);
    const aim = toward(eye(1), seen(ada.session), 1.5);
    const energy = (id: number) => sim(room).playerVitals(id)!.energy;
    ada.session.fire(eye(1), aim);
    await room.settle(100);
    const spent = energy(bo.session.localId) - energy(ada.session.localId);
    expect(spent).toBeGreaterThanOrEqual(Math.floor(VITALS.energy.perShot));
    expect(spent).toBeLessThanOrEqual(Math.ceil(VITALS.energy.perShot));
  });

  it('fells a hare in two, tells the kill with the last of them, and every screen lets go of it', async () => {
    const { room, guests, wild } = await meadow(2);
    const [ada, bo] = guests as [(typeof guests)[0], (typeof guests)[0]];
    const id = wild.spawnAt(WILD_SPECIES.hare, 10.5, 24.5);
    await play(room, 1.5);
    const heard = listen(bo.session);
    const height = wildHitboxOf(WILD_SPECIES.hare)!.height;
    for (let i = 0; i < 2; i++) {
      const target = seen(ada.session);
      expect(target.id).toBe(id);
      ada.session.fire(eye(1), toward(eye(1), target, height));
      await play(room, BLASTER.interval + 0.05);
    }
    expect(heard.map((shot) => shot.flags)).toEqual([
      SHOT_FLAG.wild,
      SHOT_FLAG.wild | SHOT_FLAG.kill,
    ]);
    expect(heard.every((shot) => shot.enemy === id)).toBe(true);
    expect(wild.has(id)).toBe(false);
    await play(room, 0.5);
    expect(room.host.sampleWildlife()).toEqual([]);
    expect(ada.session.sampleWildlife()).toEqual([]);
    expect(bo.session.sampleWildlife()).toEqual([]);
    // Nobody was hurt by a hare, and no machine was counted.
    expect(sim(room).felled).toBe(0);
    for (const who of [HOST_PLAYER_ID, ada.session.localId, bo.session.localId]) {
      expect(healthOf(room, who)).toBe(VITALS.maxHealth);
    }
  });

  it('is stopped by the blocks in its way, and the creature behind them is not hurt', async () => {
    // A wall across the way, between the seats and the stag.
    const wall = (world: TestWorld) => {
      for (let x = -10; x <= 40; x++) {
        for (let y = FLOOR; y < FLOOR + 5; y++) world.setBlock(x, y, 20, SCRAP);
      }
    };
    const { room, guests, wild } = await meadow(1, {}, wall);
    const ada = guests[0]!;
    const id = wild.spawnAt(WILD_SPECIES.stag, 10.5, 30.5);
    await play(room, 1.5);
    const heard = listen(ada.session);
    ada.session.fire(eye(1), toward(eye(1), seen(ada.session), 1.5));
    await room.settle(100);
    expect(heard).toHaveLength(1);
    expect(heard[0]!.flags).toBe(SHOT_FLAG.world);
    expect(heard[0]!.enemy).toBe(0);
    expect(stateOf(room, id)!.health).toBe(255);
  });

  it('turns the stag on the guest who hurt it, and on nobody else', async () => {
    const { room, guests, wild } = await meadow(2);
    const [ada, bo] = guests as [(typeof guests)[0], (typeof guests)[0]];
    const id = wild.spawnAt(WILD_SPECIES.stag, 10.5, 30.5);
    await play(room, 1.5);
    const hostBefore = healthOf(room, HOST_PLAYER_ID);
    ada.session.fire(eye(1), toward(eye(1), seen(ada.session), 1.5));
    await room.settle(100);
    const felt = healthOf(room, ada.session.localId);
    expect(felt).toBe(VITALS.maxHealth);
    await play(room, 9);

    const taken = VITALS.maxHealth - healthOf(room, ada.session.localId);
    const blow = STAG.retaliation!.player;
    expect(taken).toBeGreaterThanOrEqual(blow);
    expect(taken % blow).toBe(0);
    expect(taken).toBeLessThanOrEqual(blow * STAG.retaliation!.strikes);
    expect(healthOf(room, bo.session.localId)).toBe(VITALS.maxHealth);
    expect(healthOf(room, HOST_PLAYER_ID)).toBe(hostBefore);
    expect(wild.has(id)).toBe(true);

    // Every screen saw it come: the guests' pictures carry the flag while it was angry.
    // And once it has had enough it lets go of the grudge.
    await play(room, 20);
    expect(stateOf(room, id)!.flags & WILD_FLAG.angry).toBe(0);
    const after = healthOf(room, ada.session.localId);
    await play(room, 20);
    expect(healthOf(room, ada.session.localId)).toBeGreaterThanOrEqual(after);
  });

  it('is judged against the creature as the shooter saw it, though it has moved on since', async () => {
    const { room, guests, wild } = await meadow(1, { latency: 150 });
    const ada = guests[0]!;
    wild.spawnAt(WILD_SPECIES.kite, 10.5, 26.5);
    // Wait for a moment when the kite is crossing the shooter's view fast, so that a shot judged
    // against the present would pass behind it.
    const eyes = eye(1);
    const across = (): number => {
      const pose = ada.session.sampleWildlife()[0];
      if (!pose) return 0;
      const sx = pose.x - eyes.x;
      const sz = pose.z - eyes.z;
      const reach = Math.hypot(sx, sz);
      const vx = Math.sin(pose.yaw) * pose.speed;
      const vz = Math.cos(pose.yaw) * pose.speed;
      return reach > 1 && reach < 30 ? Math.abs(vx * sz - vz * sx) / reach : 0;
    };
    let waited = 0;
    while (across() < 3.4 && waited < 30) {
      await play(room, 0.1);
      waited += 0.1;
    }
    expect(across()).toBeGreaterThanOrEqual(3.4);

    const heard = listen(ada.session);
    // Where the kite is on the host when the host decides.
    let there: { x: number; y: number; z: number } | null = null;
    room.host.onShot(() => {
      const states = [createWildState()];
      sim(room).wildlife!.write(states);
      there = { x: states[0]!.x, y: states[0]!.y, z: states[0]!.z };
    });
    const target = seen(ada.session);
    const height = wildHitboxOf(WILD_SPECIES.kite)!.height;
    ada.session.fire(eyes, toward(eyes, target, height));
    await room.settle(500);

    expect(there).not.toBeNull();
    const moved = Math.hypot(there!.x - target.x, there!.y - target.y, there!.z - target.z);
    // Further than half the width of its box, so a shot judged against the present would pass it by...
    expect(moved).toBeGreaterThan(wildHitboxOf(WILD_SPECIES.kite)!.halfWidth);
    // ...and it is hit all the same.
    expect(heard).toHaveLength(1);
    expect(heard[0]!.flags & SHOT_FLAG.wild).toBe(SHOT_FLAG.wild);
  });
});

describe('the host’s own shot at a creature', () => {
  it('hurts the creature the host sees, and the host hears of it', async () => {
    const { room, wild } = await meadow(0);
    room.host.setLocalActive(true);
    const id = wild.spawnAt(WILD_SPECIES.stag, 8.5, 30.5);
    const heard = listen(room.host);
    await play(room, 1.5);
    const target = seen(room.host);
    expect(target.id).toBe(id);
    room.host.fire(eye(0), toward(eye(0), target, 1.5));
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ by: HOST_PLAYER_ID, flags: SHOT_FLAG.wild, enemy: id });
    expect(stateOf(room, id)!.health).toBeLessThan(255);
    // The stag comes for the host, and for the host alone.
    await play(room, 9);
    expect(healthOf(room, HOST_PLAYER_ID)).toBeLessThan(VITALS.maxHealth);
  });
});
