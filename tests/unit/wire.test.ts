import { describe, expect, it } from 'vitest';
import { createEnemyState, type EnemyState } from '../../src/shared/enemy-state';
import { createRng } from '../../src/shared/hash';
import { NET } from '../../src/shared/net-config';
import {
  createPlayerSample,
  type EditRecord,
  type GuestFrame,
  type HostFrame,
  type PlayerSample,
} from '../../src/shared/protocol';
import {
  ENEMIES_PACKET_MAX,
  GUEST_STATE_BYTES,
  KIND_ENEMIES,
  KIND_GUEST_STATE,
  decodeEdits,
  decodeEnemies,
  decodeGuestFrame,
  decodeGuestState,
  decodeHostFrame,
  decodeRelay,
  encodeEdits,
  encodeEnemies,
  encodeFrame,
  encodeGuestState,
  encodeRelay,
  packetKind,
  seqNewer,
} from '../../src/shared/wire';

const TOKEN = 'abcdefghijklmnopqrstuv';

function sample(overrides: Partial<PlayerSample> = {}): PlayerSample {
  return { ...createPlayerSample(), ...overrides };
}

describe('sequence numbers', () => {
  it('orders counters that wrap', () => {
    expect(seqNewer(2, 1)).toBe(true);
    expect(seqNewer(1, 2)).toBe(false);
    expect(seqNewer(5, 5)).toBe(false);
    expect(seqNewer(0, 65535)).toBe(true);
    expect(seqNewer(65535, 0)).toBe(false);
    expect(seqNewer(100, 65500)).toBe(true);
    expect(seqNewer(40000, 10)).toBe(false); // far ahead counts as behind: it is half a lap away
  });
});

describe('guest control frames', () => {
  const frames: GuestFrame[] = [
    { t: 'hello', v: NET.protocolVersion, build: 'abc1234', token: TOKEN, name: 'Ada' },
    { t: 'cmd', id: 7, c: { type: 'place', x: -3, y: 12, z: 40, state: 257 } },
    { t: 'cmd', id: 8, c: { type: 'break', x: 0, y: 0, z: 0 } },
    { t: 'ping', n: 12, rtt: 34.5 },
    { t: 'bye' },
  ];

  it('round trips every frame', () => {
    for (const frame of frames) expect(decodeGuestFrame(encodeFrame(frame))).toEqual(frame);
  });

  it('rejects malformed text and unknown frames', () => {
    for (const text of [
      '',
      'nope',
      '[]',
      'null',
      '{}',
      '{"t":"nope"}',
      '{"t":42}',
      '{"t":"hello"}',
    ]) {
      expect(decodeGuestFrame(text)).toBeNull();
    }
  });

  it('rejects commands with bad numbers', () => {
    const bad = [
      { type: 'place', x: 1.5, y: 0, z: 0, state: 1 },
      { type: 'place', x: 0, y: 0, z: 0, state: 0 },
      { type: 'place', x: 0, y: 0, z: 0, state: 65536 },
      { type: 'place', x: 0, y: 0, z: 0, state: -1 },
      { type: 'place', x: 40000, y: 0, z: 0, state: 1 },
      { type: 'place', x: 0, y: 0, z: 0 },
      { type: 'break', x: 'a', y: 0, z: 0 },
      { type: 'break', x: null, y: 0, z: 0 },
      { type: 'dig', x: 0, y: 0, z: 0 },
    ];
    for (const c of bad) {
      expect(decodeGuestFrame(JSON.stringify({ t: 'cmd', id: 1, c }))).toBeNull();
    }
    expect(
      decodeGuestFrame(
        JSON.stringify({ t: 'cmd', id: -1, c: { type: 'break', x: 0, y: 0, z: 0 } }),
      ),
    ).toBeNull();
    expect(
      decodeGuestFrame('{"t":"cmd","id":1,"c":{"type":"break","x":1e999,"y":0,"z":0}}'),
    ).toBeNull();
  });

  it('rejects a hello with a weak token or a huge name', () => {
    const base = { t: 'hello', v: 1, build: 'x', token: TOKEN, name: 'Ada' };
    expect(decodeGuestFrame(JSON.stringify({ ...base, token: 'short' }))).toBeNull();
    expect(decodeGuestFrame(JSON.stringify({ ...base, name: 'x'.repeat(500) }))).toBeNull();
    expect(decodeGuestFrame(JSON.stringify({ ...base, build: 'x'.repeat(100) }))).toBeNull();
  });

  it('rejects frames over the size limit', () => {
    const huge = JSON.stringify({
      t: 'hello',
      v: 1,
      build: 'x',
      token: TOKEN,
      name: 'a'.repeat(NET.maxFrameLength),
    });
    expect(decodeGuestFrame(huge)).toBeNull();
  });

  it('ignores prototype tricks', () => {
    const text =
      '{"t":"cmd","id":1,"c":{"type":"break","x":1,"y":2,"z":3,"__proto__":{"polluted":true}}}';
    const frame = decodeGuestFrame(text);
    expect(frame).toEqual({ t: 'cmd', id: 1, c: { type: 'break', x: 1, y: 2, z: 3 } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('host control frames', () => {
  const frames: HostFrame[] = [
    {
      t: 'welcome',
      v: NET.protocolVersion,
      id: 2,
      slot: 1,
      hostId: 1,
      seed: 2024,
      seq: 17,
      hostTime: 123456.5,
      spawn: { x: 2.5, y: 0, z: 0.5 },
      epoch: 0,
      players: [
        { id: 1, slot: 0, name: 'Host' },
        { id: 2, slot: 1, name: 'Ada' },
      ],
      parts: 2,
      edits: 1500,
    },
    { t: 'deny', reason: 'full' },
    { t: 'snap', i: 0, b: 'AAAA' },
    { t: 'join', p: { id: 3, slot: 2, name: 'Mira' } },
    { t: 'leave', id: 3, why: 'timeout' },
    { t: 'ev', s: 5, e: { type: 'set', x: 1, y: 2, z: 3, state: 257, by: 2 } },
    { t: 'rej', id: 4, r: 'occupied' },
    { t: 'fix', epoch: 3, x: 1, y: 0, z: -2 },
    { t: 'pong', n: 9 },
    { t: 'sv', tick: 14400, run: true, core: [1000, 1000], over: false },
    { t: 'sv', tick: 0, run: false, core: [1, 1000], over: false },
    { t: 'sv', tick: 9600, run: false, core: [0, 1000], over: true },
    { t: 'se', e: { k: 'nightfall', n: 1 } },
    { t: 'se', e: { k: 'dawn', n: 12 } },
    { t: 'se', e: { k: 'overrun', n: 3 } },
    { t: 'vt', hp: [100, 100], en: [100, 100], chg: false },
    { t: 'vt', hp: [37, 100], en: [0, 100], chg: true },
    { t: 'vt', hp: [0, 100], en: [25, 100], chg: false },
    {
      t: 'pings',
      p: [
        [2, 30],
        [3, 80],
      ],
    },
    { t: 'bye', why: 'closed' },
  ];

  it('round trips every frame', () => {
    for (const frame of frames) expect(decodeHostFrame(encodeFrame(frame))).toEqual(frame);
  });

  it('rejects malformed frames', () => {
    for (const text of [
      '',
      '{',
      '[]',
      '{"t":"welcome"}',
      '{"t":"deny","reason":"because"}',
      '{"t":"bye","why":"x"}',
    ]) {
      expect(decodeHostFrame(text)).toBeNull();
    }
  });

  it('cleans names inside a roster', () => {
    const frame = decodeHostFrame(
      JSON.stringify({ t: 'join', p: { id: 2, slot: 1, name: 'Ev‮il' } }),
    );
    expect(frame).toEqual({ t: 'join', p: { id: 2, slot: 1, name: 'Ev il' } });
  });

  it('refuses a welcome with absurd counts or a seat beyond the room', () => {
    const base = frames[0] as Extract<HostFrame, { t: 'welcome' }>;
    expect(
      decodeHostFrame(JSON.stringify({ ...base, edits: NET.maxSnapshotEdits + 1 })),
    ).toBeNull();
    expect(decodeHostFrame(JSON.stringify({ ...base, parts: 100000 }))).toBeNull();
    expect(decodeHostFrame(JSON.stringify({ ...base, slot: 4 }))).toBeNull();
    expect(decodeHostFrame(JSON.stringify({ ...base, spawn: { x: 1e9, y: 0, z: 0 } }))).toBeNull();
    expect(
      decodeHostFrame(JSON.stringify({ ...base, players: new Array(9).fill(base.players[0]) })),
    ).toBeNull();
  });

  it('refuses survival frames with a bad step count, a flag that is not a flag or an event it does not know', () => {
    for (const text of [
      '{"t":"sv","tick":-1,"run":true,"core":[5,10],"over":false}',
      '{"t":"sv","tick":1.5,"run":true,"core":[5,10],"over":false}',
      '{"t":"sv","tick":3000000000,"run":true,"core":[5,10],"over":false}',
      '{"t":"sv","tick":"9","run":true,"core":[5,10],"over":false}',
      '{"t":"sv","tick":9}',
      '{"t":"sv","tick":9,"run":1,"core":[5,10],"over":false}',
      '{"t":"se"}',
      '{"t":"se","e":null}',
      '{"t":"se","e":{"k":"nightfall"}}',
      '{"t":"se","e":{"k":"nightfall","n":0}}',
      '{"t":"se","e":{"k":"nightfall","n":1.5}}',
      '{"t":"se","e":{"k":"nightfall","n":70000}}',
      '{"t":"se","e":{"k":"eclipse","n":1}}',
    ]) {
      expect(decodeHostFrame(text), text).toBeNull();
    }
  });

  it('refuses a survival frame whose Core is missing, malformed or more than whole', () => {
    for (const text of [
      '{"t":"sv","tick":9,"run":true}',
      '{"t":"sv","tick":9,"run":true,"over":false}',
      '{"t":"sv","tick":9,"run":true,"core":[5,10]}',
      '{"t":"sv","tick":9,"run":true,"core":[5,10],"over":0}',
      '{"t":"sv","tick":9,"run":true,"core":5,"over":false}',
      '{"t":"sv","tick":9,"run":true,"core":[5],"over":false}',
      '{"t":"sv","tick":9,"run":true,"core":[5,10,1],"over":false}',
      '{"t":"sv","tick":9,"run":true,"core":["5",10],"over":false}',
      '{"t":"sv","tick":9,"run":true,"core":[5.5,10],"over":false}',
      '{"t":"sv","tick":9,"run":true,"core":[-1,10],"over":false}',
      '{"t":"sv","tick":9,"run":true,"core":[11,10],"over":false}',
      '{"t":"sv","tick":9,"run":true,"core":[0,0],"over":false}',
      '{"t":"sv","tick":9,"run":true,"core":[5,70000],"over":false}',
      '{"t":"sv","tick":9,"run":true,"core":null,"over":false}',
    ]) {
      expect(decodeHostFrame(text), text).toBeNull();
    }
  });

  it("refuses a word about a player's meters that is missing, malformed or more than whole", () => {
    for (const text of [
      '{"t":"vt"}',
      '{"t":"vt","hp":[50,100],"en":[50,100]}',
      '{"t":"vt","hp":[50,100],"en":[50,100],"chg":1}',
      '{"t":"vt","hp":[50,100],"chg":false}',
      '{"t":"vt","en":[50,100],"chg":false}',
      '{"t":"vt","hp":50,"en":[50,100],"chg":false}',
      '{"t":"vt","hp":[50],"en":[50,100],"chg":false}',
      '{"t":"vt","hp":[50,100,1],"en":[50,100],"chg":false}',
      '{"t":"vt","hp":["50",100],"en":[50,100],"chg":false}',
      '{"t":"vt","hp":[50.5,100],"en":[50,100],"chg":false}',
      '{"t":"vt","hp":[-1,100],"en":[50,100],"chg":false}',
      '{"t":"vt","hp":[101,100],"en":[50,100],"chg":false}',
      '{"t":"vt","hp":[0,0],"en":[50,100],"chg":false}',
      '{"t":"vt","hp":[50,70000],"en":[50,100],"chg":false}',
      '{"t":"vt","hp":[50,100],"en":[-1,100],"chg":false}',
      '{"t":"vt","hp":[50,100],"en":[101,100],"chg":false}',
      '{"t":"vt","hp":[50,100],"en":[0,0],"chg":false}',
      '{"t":"vt","hp":[50,100],"en":null,"chg":false}',
    ]) {
      expect(decodeHostFrame(text), text).toBeNull();
    }
  });

  it('refuses an event with an out of range cell', () => {
    expect(
      decodeHostFrame('{"t":"ev","s":1,"e":{"type":"set","x":99999,"y":0,"z":0,"state":1,"by":1}}'),
    ).toBeNull();
    expect(
      decodeHostFrame('{"t":"ev","s":1,"e":{"type":"set","x":0,"y":0,"z":0,"state":70000,"by":1}}'),
    ).toBeNull();
  });
});

describe('edit lists', () => {
  const records: EditRecord[] = [
    { x: 0, y: 0, z: 0, state: 1 },
    { x: -92, y: 95, z: 91, state: 257 },
    { x: 32767, y: -32768, z: 5, state: 65535 },
  ];

  it('round trips records', () => {
    expect(decodeEdits(encodeEdits(records))).toEqual(records);
  });

  it('encodes a slice', () => {
    expect(decodeEdits(encodeEdits(records, 1, 1))).toEqual([records[1]]);
    expect(decodeEdits(encodeEdits(records, 3, 5))).toEqual([]);
  });

  it('takes a thousand records in one frame well under the frame limit', () => {
    const many: EditRecord[] = Array.from({ length: NET.snapshotEditsPerFrame }, (_, i) => ({
      x: i % 97,
      y: i % 13,
      z: (i * 7) % 89,
      state: 1 + (i % 600),
    }));
    const text = encodeEdits(many);
    expect(text.length).toBeLessThan(NET.maxFrameLength - 200);
    expect(decodeEdits(text)).toEqual(many);
  });

  it('refuses garbage, partial records, empty states and oversize lists', () => {
    expect(decodeEdits('!!!not base64!!!')).toBeNull();
    expect(decodeEdits(btoa('abc'))).toBeNull();
    expect(decodeEdits(encodeEdits([{ x: 1, y: 1, z: 1, state: 0 }]))).toBeNull();
    expect(decodeEdits(encodeEdits(records), 2)).toBeNull();
  });
});

describe('guest state packets', () => {
  it('has a fixed size and kind', () => {
    const bytes = encodeGuestState({ epoch: 1, seq: 2, time: 3, sample: sample() });
    expect(bytes).toHaveLength(GUEST_STATE_BYTES);
    expect(packetKind(bytes)).toBe(KIND_GUEST_STATE);
  });

  it('round trips within the quantization', () => {
    const original = sample({
      x: 12.3456,
      y: 3.21,
      z: -48.765,
      vx: 4.4,
      vy: -12.5,
      vz: 0.01,
      yaw: 2.5,
      pitch: -0.7,
      onGround: false,
      reset: true,
    });
    const packet = decodeGuestState(
      encodeGuestState({ epoch: 7, seq: 65535, time: 9_000_123, sample: original }),
    );
    expect(packet).not.toBeNull();
    const out = packet!;
    expect(out.epoch).toBe(7);
    expect(out.seq).toBe(65535);
    expect(out.time).toBe(9_000_123);
    expect(out.sample.x).toBeCloseTo(original.x, 2);
    expect(out.sample.y).toBeCloseTo(original.y, 2);
    expect(out.sample.z).toBeCloseTo(original.z, 2);
    expect(out.sample.vx).toBeCloseTo(original.vx, 2);
    expect(out.sample.vy).toBeCloseTo(original.vy, 2);
    expect(out.sample.vz).toBeCloseTo(original.vz, 2);
    expect(out.sample.yaw).toBeCloseTo(original.yaw, 3);
    expect(out.sample.pitch).toBeCloseTo(original.pitch, 3);
    expect(out.sample.onGround).toBe(false);
    expect(out.sample.reset).toBe(true);
  });

  it('keeps yaw on the shortest circle', () => {
    for (const yaw of [-Math.PI, -3, -1, 0, 1, 3, Math.PI, 7, -7, 100]) {
      const out = decodeGuestState(
        encodeGuestState({ epoch: 0, seq: 0, time: 0, sample: sample({ yaw }) }),
      )!;
      const diff = Math.atan2(Math.sin(out.sample.yaw - yaw), Math.cos(out.sample.yaw - yaw));
      expect(Math.abs(diff)).toBeLessThan(2e-4);
    }
  });

  it('clamps pitch and velocity instead of wrapping', () => {
    const out = decodeGuestState(
      encodeGuestState({
        epoch: 0,
        seq: 0,
        time: 0,
        sample: sample({ pitch: 9, vx: 5000, vy: -5000 }),
      }),
    )!;
    expect(out.sample.pitch).toBeCloseTo(Math.PI / 2 - 0.01, 3);
    expect(out.sample.vx).toBeCloseTo(32767 / 256, 2);
    expect(out.sample.vy).toBeCloseTo(-32767 / 256, 2);
  });

  it('clamps positions to the world limit and refuses ones beyond it on the wire', () => {
    const out = decodeGuestState(
      encodeGuestState({ epoch: 0, seq: 0, time: 0, sample: sample({ x: 1e9 }) }),
    )!;
    expect(out.sample.x).toBe(NET.move.limit);
    const forged = encodeGuestState({ epoch: 0, seq: 0, time: 0, sample: sample() });
    new DataView(forged.buffer).setInt32(8, 0x7fffffff, true);
    expect(decodeGuestState(forged)).toBeNull();
  });

  it('refuses the wrong length or kind', () => {
    const bytes = encodeGuestState({ epoch: 0, seq: 0, time: 0, sample: sample() });
    expect(decodeGuestState(bytes.subarray(0, bytes.length - 1))).toBeNull();
    expect(decodeGuestState(new Uint8Array(0))).toBeNull();
    const other = bytes.slice();
    other[0] = 9;
    expect(decodeGuestState(other)).toBeNull();
    expect(packetKind(new Uint8Array(0))).toBe(0);
  });

  it('never throws on random bytes', () => {
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) {
      const bytes = new Uint8Array(Math.floor(rng() * 140));
      for (let j = 0; j < bytes.length; j++) bytes[j] = Math.floor(rng() * 256);
      expect(() => decodeGuestState(bytes)).not.toThrow();
      expect(() => decodeRelay(bytes)).not.toThrow();
    }
  });
});

describe('relay packets', () => {
  it('round trips several players', () => {
    const entries = [
      { id: 1, age: 0, sample: sample({ x: 1, y: 0, z: 2, yaw: 1 }) },
      { id: 3, age: 41, sample: sample({ x: -5.5, y: 4, z: 9.25, vy: 3, onGround: false }) },
      { id: 4, age: -37, sample: sample({ reset: true }) },
      { id: 2, age: 99_999, sample: sample() },
    ];
    const packet = decodeRelay(encodeRelay({ seq: 65534, hostTime: 5_000_000, entries }))!;
    expect(packet.seq).toBe(65534);
    expect(packet.hostTime).toBe(5_000_000);
    // A sample can be stamped slightly ahead of now (age < 0); absurd ages are clamped, not wrapped.
    expect(packet.entries.map((e) => [e.id, e.age])).toEqual([
      [1, 0],
      [3, 41],
      [4, -37],
      [2, 32767],
    ]);
    expect(packet.entries[1]?.sample.x).toBeCloseTo(-5.5, 2);
    expect(packet.entries[1]?.sample.onGround).toBe(false);
    expect(packet.entries[2]?.sample.reset).toBe(true);
  });

  it('refuses a truncated packet, an empty id and too many entries', () => {
    const good = encodeRelay({
      seq: 1,
      hostTime: 1,
      entries: [{ id: 2, age: 0, sample: sample() }],
    });
    expect(decodeRelay(good.subarray(0, good.length - 3))).toBeNull();
    const zero = good.slice();
    new DataView(zero.buffer).setUint16(8, 0, true);
    expect(decodeRelay(zero)).toBeNull();
    const crowded = good.slice();
    crowded[1] = 200;
    expect(decodeRelay(crowded)).toBeNull();
  });
});

describe('enemy packets', () => {
  function enemy(overrides: Partial<EnemyState> = {}): EnemyState {
    return { ...createEnemyState(), id: 1, ...overrides };
  }

  it('is told apart from the other fast-lane packets', () => {
    const bytes = encodeEnemies(1, 1000, [enemy()], 1);
    expect(packetKind(bytes)).toBe(KIND_ENEMIES);
    expect(KIND_ENEMIES).not.toBe(KIND_GUEST_STATE);
    expect(decodeGuestState(bytes)).toBeNull();
    expect(decodeRelay(bytes)).toBeNull();
  });

  it('round trips every machine within the quantization', () => {
    const states = [
      enemy({ id: 1, x: 12.5, y: 8.25, z: -30.0625, yaw: 1.2, health: 255 }),
      enemy({ id: 400, x: -45.4, y: 11.2, z: 60.9, yaw: -2.9, health: 100, flags: 1 }),
      enemy({ id: 65535, x: 0, y: 0, z: 0, yaw: Math.PI - 0.001, health: 1, flags: 3 }),
    ];
    const packet = decodeEnemies(encodeEnemies(65534, 5_000_000, states, states.length))!;
    expect(packet.seq).toBe(65534);
    expect(packet.hostTime).toBe(5_000_000);
    expect(packet.entries).toHaveLength(3);
    states.forEach((sent, i) => {
      const got = packet.entries[i] as EnemyState;
      expect(got.id).toBe(sent.id);
      expect(got.kind).toBe(sent.kind);
      expect(got.flags).toBe(sent.flags);
      expect(got.health).toBe(sent.health);
      // 1/16 of a block of position, 1/256 of a turn of heading.
      expect(Math.abs(got.x - sent.x)).toBeLessThanOrEqual(1 / 32 + 1e-9);
      expect(Math.abs(got.y - sent.y)).toBeLessThanOrEqual(1 / 32 + 1e-9);
      expect(Math.abs(got.z - sent.z)).toBeLessThanOrEqual(1 / 32 + 1e-9);
      const turn = Math.abs(Math.atan2(Math.sin(got.yaw - sent.yaw), Math.cos(got.yaw - sent.yaw)));
      expect(turn).toBeLessThanOrEqual(Math.PI / 256 + 1e-9);
    });
  });

  it('weighs twelve bytes a machine and a header of eight, whatever the count', () => {
    expect(encodeEnemies(0, 0, [], 0)).toHaveLength(8);
    const states = Array.from({ length: 40 }, (_, i) => enemy({ id: i + 1 }));
    expect(encodeEnemies(0, 0, states, 40)).toHaveLength(8 + 40 * 12);
    expect(ENEMIES_PACKET_MAX).toBe(8 + NET.maxEnemies * 12);
    // A whole crowd fits in one message of a size no browser's channel refuses.
    expect(ENEMIES_PACKET_MAX).toBeLessThan(2000);
  });

  it('says there are none, and the host still gets to say it', () => {
    const packet = decodeEnemies(encodeEnemies(7, 123, [], 0))!;
    expect(packet.entries).toEqual([]);
    expect(packet.seq).toBe(7);
    expect(packet.hostTime).toBe(123);
  });

  it('sends the first `count` of the states, and no more than a packet takes', () => {
    const states = Array.from({ length: 300 }, (_, i) => enemy({ id: i + 1 }));
    expect(decodeEnemies(encodeEnemies(0, 0, states, 3))!.entries.map((e) => e.id)).toEqual([
      1, 2, 3,
    ]);
    expect(decodeEnemies(encodeEnemies(0, 0, states, 300))!.entries).toHaveLength(NET.maxEnemies);
    expect(decodeEnemies(encodeEnemies(0, 0, states.slice(0, 2), 50))!.entries).toHaveLength(2);
  });

  it('keeps the last sliver of Health alive and never sends a machine as dead', () => {
    const [low, none, over] = decodeEnemies(
      encodeEnemies(
        0,
        0,
        [enemy({ id: 1, health: 1 }), enemy({ id: 2, health: 0 }), enemy({ id: 3, health: 9999 })],
        3,
      ),
    )!.entries as [EnemyState, EnemyState, EnemyState];
    expect(low.health).toBe(1);
    expect(none.health).toBe(1);
    expect(over.health).toBe(255);
  });

  it('wraps the counter and the clock instead of failing on them', () => {
    const packet = decodeEnemies(encodeEnemies(65536 + 5, 3_000_000_000.4, [], 0))!;
    expect(packet.seq).toBe(5);
    expect(packet.hostTime).toBe(3_000_000_000);
    expect(decodeEnemies(encodeEnemies(0, -50, [], 0))!.hostTime).toBe(0);
  });

  it('clamps a position beyond the field instead of wrapping it', () => {
    const [far] = decodeEnemies(encodeEnemies(0, 0, [enemy({ x: 9000, z: -9000, y: 5000 })], 1))!
      .entries as [EnemyState];
    expect(far.x).toBeCloseTo(32767 / 16, 5);
    expect(far.z).toBeCloseTo(-32768 / 16, 5);
    expect(far.y).toBeCloseTo(32767 / 16, 5);
  });

  it('drops the flag bits it does not know', () => {
    const [flagged] = decodeEnemies(encodeEnemies(0, 0, [enemy({ flags: 0xff })], 1))!.entries as [
      EnemyState,
    ];
    expect(flagged.flags).toBe(3);
  });

  it('refuses a truncated or padded packet, a wrong count and a wrong kind', () => {
    const good = encodeEnemies(1, 1, [enemy({ id: 1 }), enemy({ id: 2 })], 2);
    expect(decodeEnemies(good)).not.toBeNull();
    expect(decodeEnemies(good.subarray(0, good.length - 1))).toBeNull();
    expect(decodeEnemies(good.subarray(0, 5))).toBeNull();
    expect(decodeEnemies(new Uint8Array(0))).toBeNull();
    const padded = new Uint8Array(good.length + 1);
    padded.set(good);
    expect(decodeEnemies(padded)).toBeNull();
    const miscounted = good.slice();
    miscounted[1] = 3;
    expect(decodeEnemies(miscounted)).toBeNull();
    const crowded = good.slice();
    crowded[1] = 255;
    expect(decodeEnemies(crowded)).toBeNull();
    const wrongKind = good.slice();
    wrongKind[0] = KIND_GUEST_STATE;
    expect(decodeEnemies(wrongKind)).toBeNull();
  });

  it('refuses a machine with no id, a kind this build does not know, or no Health', () => {
    const base = encodeEnemies(1, 1, [enemy({ id: 9 })], 1);
    const noId = base.slice();
    new DataView(noId.buffer).setUint16(8, 0, true);
    expect(decodeEnemies(noId)).toBeNull();
    const strange = base.slice();
    strange[10] = 200;
    expect(decodeEnemies(strange)).toBeNull();
    const dead = base.slice();
    dead[19] = 0;
    expect(decodeEnemies(dead)).toBeNull();
  });

  it('never throws on random bytes', () => {
    const rng = createRng(11);
    for (let i = 0; i < 500; i++) {
      const bytes = new Uint8Array(Math.floor(rng() * 160));
      for (let j = 0; j < bytes.length; j++) bytes[j] = Math.floor(rng() * 256);
      if (bytes.length > 0 && i % 2 === 0) bytes[0] = KIND_ENEMIES;
      expect(() => decodeEnemies(bytes)).not.toThrow();
    }
  });
});
