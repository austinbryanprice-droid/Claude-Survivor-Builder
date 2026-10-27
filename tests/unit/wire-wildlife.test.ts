import { describe, expect, it } from 'vitest';
import { EnemyMirror } from '../../src/net/enemy-mirror';
import { ENEMY_KIND, createEnemyState } from '../../src/shared/enemy-state';
import { NET } from '../../src/shared/net-config';
import { SHOT_FLAG, SHOT_FLAGS_MASK } from '../../src/shared/shot';
import {
  ENEMIES_PACKET_MAX,
  KIND_ENEMIES,
  KIND_GUEST_STATE,
  KIND_WILDLIFE,
  WILDLIFE_PACKET_MAX,
  decodeEnemies,
  decodeHostFrame,
  decodeWildlife,
  encodeEnemies,
  encodeFrame,
  encodeWildlife,
  packetKind,
} from '../../src/shared/wire';
import {
  WILD_FLAG,
  WILD_FLAGS_MASK,
  WILD_SPECIES,
  WILD_SPECIES_COUNT,
  createWildState,
  type WildState,
} from '../../src/shared/wildlife-state';
import { WILDLIFE } from '../../src/systems/wildlife/balance';

function creature(extra: Partial<WildState> = {}): WildState {
  return { ...createWildState(), id: 1, kind: WILD_SPECIES.stag, x: 10, y: 11, z: -5, ...extra };
}

describe('the wildlife packet', () => {
  it('is a packet kind of its own, apart from the machines and the players', () => {
    const bytes = encodeWildlife(1, 1000, [creature()], 1);
    expect(packetKind(bytes)).toBe(KIND_WILDLIFE);
    expect(new Set([KIND_WILDLIFE, KIND_ENEMIES, KIND_GUEST_STATE]).size).toBe(3);
    // Neither list reads the other's packet.
    expect(decodeEnemies(bytes)).toBeNull();
    expect(
      decodeWildlife(encodeEnemies(1, 1000, [{ ...createEnemyState(), id: 1 }], 1)),
    ).toBeNull();
  });

  it('carries the species, flags, position, heading and health of every creature', () => {
    const sent = [
      creature({ id: 1, kind: WILD_SPECIES.stag, yaw: 1.25, health: 213, flags: WILD_FLAG.angry }),
      creature({
        id: 2,
        kind: WILD_SPECIES.shoal,
        x: 80.5,
        y: 5.25,
        z: 3.75,
        yaw: -2.5,
        health: 255,
        flags: WILD_FLAG.alarmed | WILD_FLAG.hurt,
      }),
      creature({ id: 3, kind: WILD_SPECIES.kite, y: 30.0625, flags: WILD_FLAG.strike, health: 1 }),
    ];
    const packet = decodeWildlife(encodeWildlife(65534, 5_000_000, sent, sent.length))!;
    expect(packet.seq).toBe(65534);
    expect(packet.hostTime).toBe(5_000_000);
    expect(packet.entries).toHaveLength(3);
    for (const [i, entry] of packet.entries.entries()) {
      const was = sent[i]!;
      expect(entry).toMatchObject({
        id: was.id,
        kind: was.kind,
        flags: was.flags,
        health: was.health,
      });
      // Sixteenths of a block, and a heading to 256ths of a turn.
      expect(entry.x).toBeCloseTo(was.x, 1);
      expect(entry.y).toBeCloseTo(was.y, 1);
      expect(entry.z).toBeCloseTo(was.z, 1);
      expect(Math.abs(entry.yaw - was.yaw)).toBeLessThan(0.03);
    }
  });

  it('is as small as the machines’ packet and holds the most the simulation does', () => {
    expect(encodeWildlife(0, 0, [], 0)).toHaveLength(8);
    expect(NET.maxWildlife).toBe(WILDLIFE.maxAlive);
    expect(WILDLIFE_PACKET_MAX).toBe(8 + NET.maxWildlife * 12);
    expect(WILDLIFE_PACKET_MAX).toBeLessThanOrEqual(ENEMIES_PACKET_MAX);
    const states = Array.from({ length: 300 }, (_, i) => creature({ id: i + 1 }));
    expect(decodeWildlife(encodeWildlife(0, 0, states, 300))!.entries).toHaveLength(
      NET.maxWildlife,
    );
    expect(encodeWildlife(0, 0, states, 300)).toHaveLength(WILDLIFE_PACKET_MAX);
  });

  it('keeps only the flags that mean something to a creature', () => {
    expect(WILD_FLAGS_MASK).toBe(15);
    const [flagged] = decodeWildlife(encodeWildlife(0, 0, [creature({ flags: 0xff })], 1))!.entries;
    expect(flagged!.flags).toBe(WILD_FLAGS_MASK);
  });

  it('refuses a packet that is not one the host sent', () => {
    const good = encodeWildlife(1, 1, [creature({ id: 1 }), creature({ id: 2 })], 2);
    expect(decodeWildlife(good)).not.toBeNull();
    expect(decodeWildlife(good.subarray(0, good.length - 1))).toBeNull();
    expect(decodeWildlife(good.subarray(0, 5))).toBeNull();
    expect(decodeWildlife(new Uint8Array(0))).toBeNull();
    const padded = new Uint8Array(good.length + 1);
    padded.set(good);
    expect(decodeWildlife(padded)).toBeNull();
    // A species this build does not know, a creature with no id and one with no health.
    expect(
      decodeWildlife(encodeWildlife(1, 1, [creature({ kind: WILD_SPECIES_COUNT })], 1)),
    ).toBeNull();
    expect(decodeWildlife(encodeWildlife(1, 1, [creature({ id: 0 })], 1))).toBeNull();
    const dead = encodeWildlife(1, 1, [creature()], 1);
    dead[8 + 11] = 0;
    expect(decodeWildlife(dead)).toBeNull();
    // A count past the cap.
    const crowded = encodeWildlife(1, 1, [creature()], 1);
    crowded[1] = NET.maxWildlife + 1;
    expect(decodeWildlife(crowded)).toBeNull();
  });

  it('knows every species the table has, and the machines’ list does not accept a species as a kind', () => {
    for (let species = 0; species < WILD_SPECIES_COUNT; species++) {
      expect(decodeWildlife(encodeWildlife(0, 0, [creature({ kind: species })], 1))).not.toBeNull();
    }
    // A machine's kind is below four; a species up to seven is a creature's and not a machine's.
    expect(
      decodeEnemies(encodeEnemies(0, 0, [{ ...createEnemyState(), id: 1 }], 1))!.entries[0]!.kind,
    ).toBe(ENEMY_KIND.crawler);
    const wrongKind = encodeEnemies(
      0,
      0,
      [{ ...createEnemyState(), id: 1, kind: WILD_SPECIES.kite }],
      1,
    );
    expect(decodeEnemies(wrongKind)).toBeNull();
  });
});

describe('a shot at a creature, on the wire', () => {
  it('is told with the wild flag and the creature’s id in the same frame a machine’s is', () => {
    expect(SHOT_FLAG.wild).toBe(8);
    expect(SHOT_FLAGS_MASK & SHOT_FLAG.wild).toBe(SHOT_FLAG.wild);
    const text = encodeFrame({
      t: 'sh',
      p: 2,
      e: [10, 11, 12],
      f: SHOT_FLAG.wild | SHOT_FLAG.kill,
      h: 7,
    });
    const frame = decodeHostFrame(text);
    expect(frame).toEqual({
      t: 'sh',
      p: 2,
      e: [10, 11, 12],
      f: SHOT_FLAG.wild | SHOT_FLAG.kill,
      h: 7,
    });
    // A flag nobody defined is refused.
    const bad = encodeFrame({ t: 'sh', p: 2, e: [10, 11, 12], f: 16, h: 7 });
    expect(decodeHostFrame(bad)).toBeNull();
  });
});

describe('the wildlife mirror', () => {
  it('is the machines’ mirror with room for the wildlife’s own cap', () => {
    const mirror = new EnemyMirror(NET.maxWildlife);
    const states = Array.from({ length: NET.maxWildlife + 20 }, (_, i) => creature({ id: i + 1 }));
    expect(mirror.push(1000, states, states.length)).toBe(true);
    expect(mirror.count).toBe(NET.maxWildlife);
    // The machines' mirror, with its own cap, would have held more.
    const wide = new EnemyMirror();
    wide.push(1000, states, states.length);
    expect(wide.count).toBe(states.length);
  });

  it('glides a creature between two reports, as it does a machine, and keeps the species', () => {
    const mirror = new EnemyMirror(NET.maxWildlife);
    mirror.push(1000, [creature({ id: 5, kind: WILD_SPECIES.hare, x: 0, z: 0 })], 1);
    mirror.push(1100, [creature({ id: 5, kind: WILD_SPECIES.hare, x: 1, z: 0 })], 1);
    const [pose] = mirror.sample(1050);
    expect(pose).toMatchObject({ id: 5, kind: WILD_SPECIES.hare });
    expect(pose!.x).toBeCloseTo(0.5, 9);
    expect(pose!.speed).toBeCloseTo(10, 6);
  });
});
