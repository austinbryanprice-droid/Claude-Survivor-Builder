import { describe, expect, it } from 'vitest';
import { HostSession } from '../../src/net/host-session';
import { SessionHub } from '../../src/net/hub';
import { ManualScheduler } from '../../src/net/scheduler';
import { fixedWorld, type GameSession } from '../../src/net/session';
import { DAY_SECONDS } from '../../src/shared/daycycle';
import { createEnemyState, type EnemyPose } from '../../src/shared/enemy-state';
import type { Vec3 } from '../../src/shared/look';
import { PLAYER } from '../../src/shared/movement';
import { NET } from '../../src/shared/net-config';
import { MODULE, moduleShape, packState } from '../../src/shared/blocks';
import { HOST_PLAYER_ID, NO_PLAYER, type HostFrame } from '../../src/shared/protocol';
import { SHOT_FLAG, type ShotEvent } from '../../src/shared/shot';
import { BLASTER, ENEMIES, VITALS } from '../../src/systems/survival/balance';
import { turretLevel } from '../../src/systems/survival/turrets';
import { SurvivalSim } from '../../src/systems/survival/sim';
import { FLOOR, arena, play, sim, type Room } from './helpers/arena';
import { SCRAP } from './helpers/nav-world';
import {
  TestWorld,
  at,
  helloText,
  makeRoom,
  rawGuest,
  token,
  type RoomOptions,
} from './helpers/net';

/**
 * Where each seat stands: in a row to the north-east of the Core, on the flat ground at 10. A
 * player who publishes this spot is believed, because the host put them there.
 */
function seatFor(slot: number): { x: number; y: number; z: number } {
  return { x: 8.5 + slot * 2, y: FLOOR, z: 10.5 };
}

/** The crawler starts east of the Core and walks west along the Core's row, across every shooter's line of fire. */
const CRAWLER = { x: 14.5, z: -3.5 };

/** A room with `crew` guests who have said where they stand, the host included, and a crawler on the road. */
async function range(crew = 2, options: RoomOptions = {}, build?: (world: TestWorld) => void) {
  const { room, machines } = arena({ spawnFor: seatFor, ...options }, {}, build);
  const code = await room.openRoom();
  const guests = [];
  for (let i = 0; i < crew; i++) guests.push(await room.join(code, `Guest ${i + 1}`));
  // Joining can take a while on a slow link.
  await room.settle(options.latency ? 3000 : 100);
  room.host.publishState(at(seatFor(0).x, FLOOR, seatFor(0).z));
  for (const [i, guest] of guests.entries()) {
    const spot = seatFor(i + 1);
    guest.session.publishState(at(spot.x, spot.y, spot.z));
  }
  await room.settle(100);
  const id = machines().spawnAt(CRAWLER.x, CRAWLER.z)!;
  expect(id).not.toBeNull();
  return { room, machines, code, guests, id };
}

function eye(slot: number): Vec3 {
  const spot = seatFor(slot);
  return { x: spot.x, y: spot.y + PLAYER.eyeHeight, z: spot.z };
}

/** The unit vector from `from` to the middle of a machine's body. */
function toward(from: Vec3, pose: Pick<EnemyPose, 'x' | 'y' | 'z'>): Vec3 {
  const dx = pose.x - from.x;
  const dy = pose.y + 0.5 - from.y;
  const dz = pose.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  return { x: dx / length, y: dy / length, z: dz / length };
}

/** A copy of the first machine a session draws, which is where its player sees it. */
function seen(session: GameSession): Pick<EnemyPose, 'id' | 'x' | 'y' | 'z'> {
  const pose = session.sampleEnemies()[0];
  expect(pose).toBeDefined();
  const { id, x, y, z } = pose as EnemyPose;
  return { id, x, y, z };
}

function listen(session: GameSession): ShotEvent[] {
  const heard: ShotEvent[] = [];
  session.onShot((shot) => heard.push(shot));
  return heard;
}

/** How much of its health the machine has, 0 to 255, as the host reports it. */
function healthOf(room: Room): number {
  const states = Array.from({ length: 4 }, createEnemyState);
  const count = sim(room).enemies!.write(states);
  return count === 0 ? 0 : (states[0] as { health: number }).health;
}

function energyOf(room: Room, id: number): number {
  return sim(room).playerVitals(id)!.energy;
}

describe('a guest’s shot', () => {
  it('is decided by the host and told to everyone: the shooter, the others and the host', async () => {
    const { room, guests, id } = await range(2);
    const [ada, bo] = guests as [(typeof guests)[0], (typeof guests)[0]];
    await play(room, 1.5);
    const heardByAda = listen(ada.session);
    const heardByBo = listen(bo.session);
    const heardByHost = listen(room.host);

    const target = seen(ada.session);
    ada.session.fire(eye(1), toward(eye(1), target));
    await room.settle(100);

    for (const heard of [heardByAda, heardByBo, heardByHost]) {
      expect(heard).toHaveLength(1);
      const shot = heard[0] as ShotEvent;
      expect(shot.by).toBe(ada.session.localId);
      expect(shot.flags).toBe(SHOT_FLAG.enemy);
      expect(shot.enemy).toBe(id);
      // It ended on the near face of the crawler's box, a block or so from where it was drawn.
      expect(Math.hypot(shot.x - target.x, shot.z - target.z)).toBeLessThan(1.2);
      expect(shot.y).toBeGreaterThan(FLOOR);
      expect(shot.y).toBeLessThan(FLOOR + 1);
    }
    expect(heardByBo).toEqual(heardByAda);
    expect(heardByHost).toEqual(heardByAda);
    // The blow is the host's: the crawler is hurt where it stands, by the blaster's damage.
    const full = 255;
    expect(healthOf(room)).toBe(
      Math.round(((ENEMIES.crawler.health - BLASTER.damage) / ENEMIES.crawler.health) * full),
    );
  });

  it('fells a crawler in three, and the kill is told with the last of them', async () => {
    const { room, machines, guests, id } = await range(2);
    const [ada, bo] = guests as [(typeof guests)[0], (typeof guests)[0]];
    await play(room, 1.5);
    const heard = listen(bo.session);
    for (let i = 0; i < 3; i++) {
      const target = seen(ada.session);
      expect(target.id).toBe(id);
      ada.session.fire(eye(1), toward(eye(1), target));
      await play(room, BLASTER.interval + 0.05);
    }
    expect(heard.map((shot) => shot.flags)).toEqual([
      SHOT_FLAG.enemy,
      SHOT_FLAG.enemy,
      SHOT_FLAG.enemy | SHOT_FLAG.kill,
    ]);
    expect(heard.every((shot) => shot.enemy === id)).toBe(true);
    expect(machines().count).toBe(0);
    await play(room, 0.5);
    expect(ada.session.sampleEnemies()).toEqual([]);
    expect(bo.session.sampleEnemies()).toEqual([]);
  });

  it('costs the shooter Energy, and nobody else a thing', async () => {
    const { room, guests } = await range(2);
    const [ada, bo] = guests as [(typeof guests)[0], (typeof guests)[0]];
    await play(room, 1.5);
    // Four bolts into the sky, a little more than an interval apart.
    for (let i = 0; i < 4; i++) {
      ada.session.fire(eye(1), { x: 0, y: 1, z: 0 });
      await play(room, BLASTER.interval + 0.05);
    }
    // Everyone loses the same trickle to simply being alive; Ada also paid for four shots, 2.4 points,
    // which the meter shows in whole ones.
    const spent = energyOf(room, bo.session.localId) - energyOf(room, ada.session.localId);
    expect(spent).toBeGreaterThanOrEqual(Math.floor(4 * VITALS.energy.perShot));
    expect(spent).toBeLessThanOrEqual(Math.ceil(4 * VITALS.energy.perShot));
    expect(energyOf(room, HOST_PLAYER_ID)).toBe(energyOf(room, bo.session.localId));
  });

  it('is limited to the blaster’s pace: a burst of two, then one for each interval', async () => {
    const { room, guests } = await range(1);
    const ada = guests[0]!;
    await play(room, 1.5);
    const heard = listen(ada.session);
    const aim = toward(eye(1), seen(ada.session));
    // Eight clicks in the same instant: the host takes two.
    for (let i = 0; i < 8; i++) ada.session.fire(eye(1), aim);
    await room.settle(100);
    expect(heard).toHaveLength(BLASTER.burst);
    // A little under an interval later, there is not a whole shot yet; after it, there is one.
    await play(room, BLASTER.interval * 0.5);
    ada.session.fire(eye(1), aim);
    await room.settle(50);
    expect(heard).toHaveLength(BLASTER.burst);
    await play(room, BLASTER.interval * 0.6);
    ada.session.fire(eye(1), aim);
    ada.session.fire(eye(1), aim);
    await room.settle(100);
    expect(heard).toHaveLength(BLASTER.burst + 1);
    // A long rest banks no more than the burst.
    await play(room, 20);
    for (let i = 0; i < 8; i++) ada.session.fire(eye(1), aim);
    await room.settle(100);
    expect(heard).toHaveLength(BLASTER.burst + 1 + BLASTER.burst);
  });

  it('is ignored from a guest the host has not heard a position from, and costs nothing', async () => {
    const { room, code } = await range(1);
    const cy = await room.join(code, 'Cy');
    await play(room, 1);
    const heard = listen(cy.session);
    const before = energyOf(room, cy.session.localId);
    const aim = toward(eye(2), seen(cy.session));
    cy.session.fire(eye(2), aim);
    await room.settle(100);
    expect(heard).toEqual([]);
    expect(energyOf(room, cy.session.localId)).toBe(before);
    // Once the host knows where Cy stands the same shot goes off, and the blaster was still ready.
    const spot = seatFor(2);
    cy.session.publishState(at(spot.x, spot.y, spot.z));
    await room.settle(100);
    cy.session.fire(eye(2), aim);
    cy.session.fire(eye(2), aim);
    await room.settle(100);
    expect(heard).toHaveLength(2);
  });

  it('starts from the shooter’s eyes when it claims to start from far away', async () => {
    const { room, guests, machines } = await range(1);
    const ada = guests[0]!;
    await play(room, 1.5);
    const heard = listen(ada.session);
    const target = seen(ada.session);
    // From a spot beside the crawler, 14 blocks from Ada, a shot at it could not miss.
    const claimed = { x: target.x, y: target.y + 0.5, z: target.z + 3 };
    ada.session.fire(claimed, { x: 0, y: 0, z: -1 });
    await room.settle(100);
    expect(heard).toHaveLength(1);
    expect(heard[0]!.flags).toBe(0);
    expect(healthOf(room)).toBe(255);
    expect(machines().count).toBe(1);

    // A claim from a few blocks away, like a camera held behind the shoulder, is believed.
    await play(room, BLASTER.interval + 0.05);
    const behind = { ...eye(1), z: eye(1).z + 3 };
    const fresh = seen(ada.session);
    ada.session.fire(behind, toward(behind, fresh));
    await room.settle(100);
    expect(heard).toHaveLength(2);
    expect(heard[1]!.flags).toBe(SHOT_FLAG.enemy);
    expect(healthOf(room)).toBeLessThan(255);
  });

  it('is stopped by the blocks in its way, and the machine behind them is not hurt', async () => {
    const wall = (world: TestWorld) => {
      for (let x = 4; x <= 20; x++) {
        world.setBlock(x, FLOOR, 5, SCRAP);
        world.setBlock(x, FLOOR + 1, 5, SCRAP);
      }
    };
    const { room, guests } = await range(1, {}, wall);
    const ada = guests[0]!;
    await play(room, 1.5);
    const heard = listen(ada.session);
    ada.session.fire(eye(1), toward(eye(1), seen(ada.session)));
    await room.settle(100);
    expect(heard).toHaveLength(1);
    const shot = heard[0]!;
    expect(shot.flags).toBe(SHOT_FLAG.world);
    expect(shot.enemy).toBe(0);
    // It ended on the face of the wall that looks at the shooter.
    expect(shot.z).toBeCloseTo(6, 1);
    expect(healthOf(room)).toBe(255);
  });

  it('is judged against the machines as the shooter saw them, though they have moved on since', async () => {
    const { room, guests, id } = await range(1, { latency: 100 });
    const ada = guests[0]!;
    await play(room, 1.5);
    const heard = listen(ada.session);
    // Where the crawler stands on the host when the host decides.
    let there: { x: number; z: number } | null = null;
    room.host.onShot(() => {
      const states = Array.from({ length: 2 }, createEnemyState);
      sim(room).enemies!.write(states);
      there = { x: states[0]!.x, z: states[0]!.z };
    });

    const target = seen(ada.session);
    ada.session.fire(eye(1), toward(eye(1), target));
    await room.settle(400);

    expect(there).not.toBeNull();
    const moved = Math.hypot(there!.x - target.x, there!.z - target.z);
    // Further than half the width of its box, so a shot judged against the present would pass it by...
    expect(moved).toBeGreaterThan(ENEMIES.crawler.hitbox.halfWidth);
    // ...and it is hit all the same.
    expect(heard).toHaveLength(1);
    expect(heard[0]!.flags).toBe(SHOT_FLAG.enemy);
    expect(heard[0]!.enemy).toBe(id);
  });

  it('is judged no further back than the host will rewind, so a very slow link aims a little behind', async () => {
    const { room, guests } = await range(1, { latency: 450 });
    const ada = guests[0]!;
    await play(room, 1.5);
    const heard = listen(ada.session);
    const target = seen(ada.session);
    ada.session.fire(eye(1), toward(eye(1), target));
    await room.settle(1500);
    expect(heard).toHaveLength(1);
    // It flew on past, into the ground.
    expect(heard[0]!.flags).toBe(SHOT_FLAG.world);
    expect(healthOf(room)).toBe(255);
  });

  it('is ignored when it has no direction, and when it comes from a link that is not a guest', async () => {
    const { room, code, guests } = await range(1);
    const ada = guests[0]!;
    const heard = listen(ada.session);
    ada.session.fire(eye(1), { x: 0, y: 0, z: 0 });
    ada.session.fire(eye(1), { x: 0.01, y: 0, z: 0.02 });
    await room.settle(100);
    expect(heard).toEqual([]);
    expect(room.host.stats.badFrames).toBe(0);

    // A shot is not a hello: from a link that has not joined it is noise.
    const stranger = await rawGuest(room, code);
    stranger.link.sendControl('{"t":"fire","o":[1,2,3],"d":[0,0,1],"at":1}');
    await room.settle(50);
    expect(room.host.stats.badFrames).toBe(1);
    expect(heard).toEqual([]);
  });

  it('is not sent before the guest is in the room, or after it has left', async () => {
    const { room, code, guests } = await range(1);
    const early = room.addGuest('Early');
    const aim = { x: 0, y: 0, z: -1 };
    early.session.fire(eye(2), aim);
    early.session.join(code);
    early.session.fire(eye(2), aim);
    await room.settle(5);
    const heard = listen(room.host);
    expect(heard).toEqual([]);
    const ada = guests[0]!;
    ada.session.close();
    ada.session.fire(eye(1), aim);
    await room.settle(100);
    expect(heard).toEqual([]);
  });
});

describe('how far back the host can look', () => {
  it('keeps a history of the machines at least as long as it will rewind', () => {
    // The host takes a step, and so a picture of the machines, every relay interval.
    expect((NET.enemyHistory - 1) * NET.relayIntervalMs).toBeGreaterThanOrEqual(NET.maxRewindMs);
    // A shooter's screen draws a fixed delay behind the host, plus the trip: the rewind covers a fair link.
    expect(NET.maxRewindMs).toBeGreaterThan(NET.enemyDelayMs + 2 * 100);
  });
});

describe('the host’s own shot', () => {
  it('hits the machine the host sees, and the host hears of it', async () => {
    const { room, machines } = arena({ spawnFor: seatFor });
    room.host.setLocalActive(true);
    room.host.publishState(at(seatFor(0).x, FLOOR, seatFor(0).z));
    const id = machines().spawnAt(CRAWLER.x, CRAWLER.z)!;
    const heard = listen(room.host);
    await play(room, 1.5);
    const target = seen(room.host);
    expect(target.id).toBe(id);
    room.host.fire(eye(0), toward(eye(0), target));
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ by: HOST_PLAYER_ID, flags: SHOT_FLAG.enemy, enemy: id });
    expect(healthOf(room)).toBeLessThan(255);
    // Two more and it is down.
    for (let i = 0; i < 2; i++) {
      await play(room, BLASTER.interval + 0.05);
      room.host.fire(eye(0), toward(eye(0), seen(room.host)));
    }
    expect(heard.map((shot) => shot.flags)).toEqual([
      SHOT_FLAG.enemy,
      SHOT_FLAG.enemy,
      SHOT_FLAG.enemy | SHOT_FLAG.kill,
    ]);
    expect(machines().count).toBe(0);
  });

  it('is told to the guests in the room as a single word, with its end point on a fine grid', async () => {
    const { room, machines } = arena({ spawnFor: seatFor });
    room.host.setLocalActive(true);
    room.host.publishState(at(seatFor(0).x, FLOOR, seatFor(0).z));
    const id = machines().spawnAt(CRAWLER.x, CRAWLER.z)!;
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    await play(room, 1.5);
    room.host.fire(eye(0), toward(eye(0), seen(room.host)));
    // A shot into the sky as well, which hits nothing at all.
    await play(room, BLASTER.interval + 0.05);
    room.host.fire(eye(0), { x: 0, y: 1, z: 0 });
    await room.settle(100);
    const words = raw.frames.filter(
      (frame): frame is Extract<HostFrame, { t: 'sh' }> => frame.t === 'sh',
    );
    expect(words).toHaveLength(2);
    expect(words[0]).toMatchObject({ t: 'sh', p: HOST_PLAYER_ID, f: SHOT_FLAG.enemy, h: id });
    expect(words[1]).toMatchObject({ t: 'sh', p: HOST_PLAYER_ID, f: 0, h: 0 });
    for (const word of words) {
      for (const value of word.e)
        expect(Math.abs(value * 100 - Math.round(value * 100))).toBeLessThan(1e-6);
    }
    // Straight up from the eyes it flew its whole range.
    expect(words[1]!.e[1]).toBeCloseTo(eye(0).y + BLASTER.range, 2);
    expect(raw.garbage).toEqual([]);
  });

  it('tells no one when nobody is listening, and does nothing in a session that has no run', () => {
    const { room, machines } = arena();
    machines().spawnAt(CRAWLER.x, CRAWLER.z);
    room.host.fire({ x: 0, y: FLOOR + 1, z: 0 }, { x: 1, y: 0, z: 0 });
    // A host with no simulation at all has no blaster to fire.
    const bare = makeRoom();
    const heard = listen(bare.host);
    bare.host.fire({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(heard).toEqual([]);
  });

  it('ignores a direction that points nowhere, and one that is not a number', () => {
    const { room } = arena();
    const heard = listen(room.host);
    room.host.fire({ x: 0, y: FLOOR + 1, z: 0 }, { x: 0, y: 0, z: 0 });
    room.host.fire({ x: 0, y: FLOOR + 1, z: 0 }, { x: Number.NaN, y: 0, z: 1 });
    room.host.fire({ x: 0, y: FLOOR + 1, z: 0 }, { x: Infinity, y: 0, z: 0 });
    expect(heard).toEqual([]);
    room.host.fire({ x: 0, y: FLOOR + 1, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(heard).toHaveLength(1);
  });
});

/** A turret standing south-east of the Core, on the flat ground, with the crawler's road in reach of it. */
const TURRET_CELL = { x: 11, y: FLOOR, z: -6 };
const TURRET_STATE = packState(moduleShape(MODULE.turret, 0), 1);

describe('a turret’s shot', () => {
  function withTurret(crew = 2) {
    return range(crew, {}, (world) => {
      world.setBlock(TURRET_CELL.x, TURRET_CELL.y, TURRET_CELL.z, TURRET_STATE);
    });
  }

  it('is decided by the host and told to everyone, with the cell of the turret and no player', async () => {
    const { room, guests, id } = await withTurret(2);
    const [ada, bo] = guests as [(typeof guests)[0], (typeof guests)[0]];
    const heardByAda = listen(ada.session);
    const heardByBo = listen(bo.session);
    const heardByHost = listen(room.host);
    await play(room, 1);

    expect(heardByHost.length).toBeGreaterThanOrEqual(1);
    for (const shot of heardByHost) {
      expect(shot.by).toBe(NO_PLAYER);
      expect(shot.turret).toEqual([TURRET_CELL.x, TURRET_CELL.y, TURRET_CELL.z]);
      expect(shot.flags & SHOT_FLAG.enemy).toBe(SHOT_FLAG.enemy);
      expect(shot.enemy).toBe(id);
      // The bolt ends near the machine, a little above its feet.
      expect(shot.y).toBeGreaterThan(FLOOR);
      expect(shot.y).toBeLessThan(FLOOR + 1.5);
      for (const value of [shot.x, shot.y, shot.z]) {
        expect(Math.abs(value * 100 - Math.round(value * 100))).toBeLessThan(1e-6);
      }
    }
    expect(heardByAda).toEqual(heardByHost);
    expect(heardByBo).toEqual(heardByHost);
    // The shots are the host's: the crawler is hurt by them, once each.
    const full = 255;
    const damage = turretLevel(1).damage * heardByHost.length;
    expect(healthOf(room)).toBe(
      Math.round(((ENEMIES.crawler.health - damage) / ENEMIES.crawler.health) * full),
    );
  });

  it('comes at the turret’s pace, and the last shot of a kill tells it', async () => {
    const { room, machines, guests, id } = await withTurret(1);
    const heard = listen(guests[0]!.session);
    await play(room, turretLevel(1).interval * 14);
    expect(machines().count).toBe(0);
    const needed = Math.ceil(ENEMIES.crawler.health / turretLevel(1).damage);
    expect(heard).toHaveLength(needed);
    expect(heard.slice(0, -1).every((shot) => (shot.flags & SHOT_FLAG.kill) === 0)).toBe(true);
    expect(heard[needed - 1]?.flags).toBe(SHOT_FLAG.enemy | SHOT_FLAG.kill);
    expect(heard.every((shot) => shot.enemy === id)).toBe(true);
    // It counts with the machines the crew felled.
    expect(sim(room).felled).toBe(1);
  });

  it('is told on the wire with the turret’s cell and player zero, and the frame of a player’s shot has no cell', async () => {
    const { room, code } = await withTurret(0);
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    room.host.publishState(at(seatFor(0).x, FLOOR, seatFor(0).z));
    await play(room, 0.5);
    const words = raw.frames.filter(
      (frame): frame is Extract<HostFrame, { t: 'sh' }> => frame.t === 'sh',
    );
    expect(words.length).toBeGreaterThanOrEqual(1);
    for (const word of words) {
      expect(word.p).toBe(NO_PLAYER);
      expect(word.c).toEqual([TURRET_CELL.x, TURRET_CELL.y, TURRET_CELL.z]);
    }
    expect(raw.garbage).toEqual([]);
  });

  it('stops when the turret is taken away from the world', async () => {
    const { room, guests } = await withTurret(1);
    const heard = listen(guests[0]!.session);
    room.hostWorld.setBlock(TURRET_CELL.x, TURRET_CELL.y, TURRET_CELL.z, 0);
    await play(room, 1);
    expect(heard).toEqual([]);
  });
});

describe('what the host refuses to hear', () => {
  it('counts a shot with a missing or malformed part as noise, and does not spend the blaster on it', async () => {
    const { room, code } = await range(1);
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const before = room.host.stats.badFrames;
    for (const text of [
      '{"t":"fire"}',
      '{"t":"fire","o":[1,2,3],"d":[0,0,1]}',
      '{"t":"fire","o":[1,2],"d":[0,0,1],"at":5}',
      '{"t":"fire","o":[1,2,3],"d":[0,0,"x"],"at":5}',
      '{"t":"fire","o":[1,2,3],"d":[0,0,9],"at":5}',
      '{"t":"fire","o":[1e9,2,3],"d":[0,0,1],"at":5}',
    ]) {
      raw.link.sendControl(text);
    }
    await room.settle(50);
    expect(room.host.stats.badFrames - before).toBe(6);
    expect(raw.frames.filter((frame) => frame.t === 'sh')).toEqual([]);
  });
});

describe('the hub and the shots', () => {
  function solo(seed: number) {
    const scheduler = new ManualScheduler();
    const session = new HostSession({
      scheduler,
      world: fixedWorld(new TestWorld(seed)),
      name: 'Solo',
      token: token(80 + seed),
      survival: new SurvivalSim({ seed, startAt: DAY_SECONDS + 1 }),
    });
    return { session, scheduler };
  }

  it('passes a shot on to the session behind it, and hears the shots of whichever session that is', () => {
    const first = solo(1);
    const second = solo(2);
    const hub = new SessionHub(first.session);
    const heard = listen(hub);
    hub.fire({ x: 0, y: 5, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ by: HOST_PLAYER_ID, flags: 0 });

    hub.swap(second.session);
    // The old session's shots are no longer the hub's...
    first.session.fire({ x: 0, y: 5, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(heard).toHaveLength(1);
    // ...and the new one's are.
    hub.fire({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(heard).toHaveLength(2);
    expect(heard[1]!.z).toBeCloseTo(BLASTER.range, 2);
  });
});
