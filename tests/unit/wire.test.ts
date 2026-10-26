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
  roundTo,
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
    { t: 'cmd', id: 9, c: { type: 'harvest', x: 21, y: 11, z: -7 } },
    { t: 'cmd', id: 10, c: { type: 'upgrade', x: 4, y: 11, z: -2, state: 513 } },
    { t: 'fire', o: [1.5, 11.62, -3.25], d: [0, 0, -1], at: 123456 },
    { t: 'fire', o: [-300.25, 2, 40.5], d: [0.7071, -0.7071, 0], at: 0 },
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
      { type: 'harvest', x: 1.5, y: 0, z: 0 },
      { type: 'harvest', x: 0, y: 'a', z: 0 },
      { type: 'harvest', x: 0, y: 0 },
      { type: 'upgrade', x: 1.5, y: 0, z: 0, state: 513 },
      { type: 'upgrade', x: 0, y: 0, z: 0 },
      { type: 'upgrade', x: 0, y: 0, z: 0, state: 0 },
      { type: 'upgrade', x: 0, y: 0, z: 0, state: 65536 },
      { type: 'upgrade', x: 0, y: 0, z: 0, state: 'a' },
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

  it('rejects a shot whose camera, direction or moment is missing, malformed or absurd', () => {
    const base = { t: 'fire', o: [1, 2, 3], d: [0, 0, 1], at: 5000 };
    expect(decodeGuestFrame(JSON.stringify(base))).toEqual(base);
    for (const bad of [
      { o: undefined },
      { o: [1, 2] },
      { o: [1, 2, 3, 4] },
      { o: [1, 2, '3'] },
      { o: [1, null, 3] },
      { o: [1, 2, NET.move.limit + 1] },
      { o: 7 },
      { d: undefined },
      { d: [0, 1] },
      { d: [0, 'up', 0] },
      { d: [0, 0, 2.5] },
      { d: [3, 0, 0] },
      { d: null },
      { at: undefined },
      { at: '5000' },
      { at: null },
      { at: 1e13 },
    ]) {
      const text = JSON.stringify({ ...base, ...bad });
      expect(decodeGuestFrame(text), text).toBeNull();
    }
    expect(decodeGuestFrame('{"t":"fire","o":[1,2,3],"d":[0,0,1e999],"at":5}')).toBeNull();
    expect(decodeGuestFrame('{"t":"fire","o":[1,2,3],"d":[0,0,1]}')).toBeNull();
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
      run: 1,
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
    {
      t: 'sv',
      tick: 14400,
      run: true,
      core: [1000, 1000],
      over: false,
      rc: [6, 6],
      st: [0, 0, 0, 0, 0],
    },
    {
      t: 'sv',
      tick: 0,
      run: false,
      core: [1, 1000],
      over: false,
      rc: [0, 0],
      st: [12, 340, 2, 95, 7],
    },
    {
      t: 'sv',
      tick: 9600,
      run: false,
      core: [0, 1000],
      over: true,
      why: 'core',
      rc: [2, 6],
      st: [31, 212, 4, 130, 18],
    },
    {
      t: 'sv',
      tick: 9700,
      run: false,
      core: [640, 1000],
      over: true,
      why: 'crew',
      rc: [0, 9],
      st: [2_000_000, 900_000, 99, 1_500_000, 80_000],
    },
    { t: 'run', n: 2, seed: 20261020, seq: 17, spawn: { x: 2.5, y: 0, z: 0.5 }, epoch: 1 },
    { t: 'run', n: 12, seed: -7, seq: 0, spawn: { x: -40, y: 12.25, z: 33 }, epoch: 255 },
    { t: 'ec', pl: [30, 0, 0, 0], cap: 400, rp: 0, cl: 0 },
    { t: 'ec', pl: [400, 12, 3, 0], cap: 400, rp: 9999, cl: 9999 },
    { t: 'ec', pl: [400, 12, 3, 0], cap: 400, rp: 24, cl: 0 },
    { t: 'nl', n: [] },
    {
      t: 'nl',
      n: [
        [-18.25, 10.3, -19.5, 3.125, 1.05, 2, 1, 0, 2],
        [29.5, 12.9, -21, 0.5, 0.85, 4, 1, 3, 0],
      ],
    },
    { t: 'hd', p: 2, i: 0, m: 1, g: 11, l: 1, f: false },
    { t: 'hd', p: 1, i: 69, m: 1, g: 3, l: 0, f: true },
    { t: 'se', e: { k: 'nightfall', n: 1 } },
    { t: 'se', e: { k: 'wave', n: 1, i: 1, of: 1, c: 6 } },
    { t: 'se', e: { k: 'wave', n: 14, i: 6, of: 6, c: 7 } },
    { t: 'se', e: { k: 'dawn', n: 12 } },
    { t: 'se', e: { k: 'overrun', n: 3, why: 'core' } },
    { t: 'se', e: { k: 'overrun', n: 5, why: 'crew' } },
    { t: 'se', e: { k: 'down', n: 2, p: 3 } },
    { t: 'se', e: { k: 'back', n: 2, p: 3, c: 0 } },
    { t: 'se', e: { k: 'back', n: 9, p: 1, c: 11 } },
    { t: 'vt', hp: [100, 100], en: [100, 100], chg: false, rt: 0, sk: 0 },
    { t: 'vt', hp: [37, 100], en: [0, 100], chg: true, rt: 0, sk: 31 },
    { t: 'vt', hp: [0, 100], en: [25, 100], chg: false, rt: 5, sk: 0 },
    { t: 'sh', p: 2, e: [3.5, 10, -12.25], f: 1, h: 17 },
    { t: 'sh', p: 1, e: [-40.25, 12.5, 7], f: 3, h: 9 },
    { t: 'sh', p: 3, e: [0, 10, 40], f: 4, h: 0 },
    { t: 'sh', p: 3, e: [0, 14.75, 40], f: 0, h: 0 },
    { t: 'sh', p: 0, c: [11, 10, -6], e: [3.5, 10.5, -12.25], f: 1, h: 17 },
    { t: 'sh', p: 0, c: [-3, 9, 40], e: [0, 10, 40], f: 3, h: 9 },
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

  /** A survival frame with the respawn and totals words a current host always sends, so a case tests only its own defect. */
  const withCharges = (text: string): string => {
    if (!text.startsWith('{"t":"sv"')) return text;
    const rc = text.includes('"rc"') ? '' : ',"rc":[2,3]';
    const st = text.includes('"st"') ? '' : ',"st":[0,0,0,0,0]';
    return text.replace(/\}$/, `${rc}${st}}`);
  };
  /** A word about a player's meters with the two countdowns a current host always sends. */
  const withCountdowns = (text: string): string =>
    text.startsWith('{"t":"vt"') && !text.includes('"rt"')
      ? text.replace(/\}$/, ',"rt":0,"sk":0}')
      : text;

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
      expect(decodeHostFrame(withCharges(text)), text).toBeNull();
    }
  });

  it('refuses a wave that does not say which of the night it is or how many machines it holds', () => {
    const base = { k: 'wave', n: 3, i: 2, of: 3, c: 5 };
    expect(decodeHostFrame(JSON.stringify({ t: 'se', e: base }))).toEqual({ t: 'se', e: base });
    for (const bad of [
      { n: undefined },
      { n: 0 },
      { i: undefined },
      { i: 0 },
      { i: 4 },
      { i: 1.5 },
      { i: '2' },
      { of: undefined },
      { of: 0 },
      { of: 256 },
      { of: 2.5 },
      { c: undefined },
      { c: -1 },
      { c: 1.5 },
      { c: 70000 },
      { c: null },
    ]) {
      const text = JSON.stringify({ t: 'se', e: { ...base, ...bad } });
      expect(decodeHostFrame(text), text).toBeNull();
    }
    // An empty wave is odd but harmless; it says nothing the crew can be hurt by.
    expect(decodeHostFrame(JSON.stringify({ t: 'se', e: { ...base, c: 0 } }))).not.toBeNull();
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
      expect(decodeHostFrame(withCharges(text)), text).toBeNull();
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
      expect(decodeHostFrame(withCountdowns(text)), text).toBeNull();
    }
  });

  it('refuses a survival frame whose respawn charges are missing, malformed or more than the crew can hold', () => {
    const base = '{"t":"sv","tick":9,"run":true,"core":[5,10],"over":false,"st":[0,0,0,0,0]';
    expect(decodeHostFrame(`${base},"rc":[2,3]}`)).not.toBeNull();
    for (const rc of [
      '',
      ',"rc":null',
      ',"rc":2',
      ',"rc":[2]',
      ',"rc":[2,3,1]',
      ',"rc":["2",3]',
      ',"rc":[2.5,3]',
      ',"rc":[-1,3]',
      ',"rc":[4,3]',
      ',"rc":[0,-1]',
      ',"rc":[0,70000]',
    ]) {
      expect(decodeHostFrame(`${base}${rc}}`), rc).toBeNull();
    }
  });

  it('refuses a survival frame whose totals are missing, malformed or negative', () => {
    const base = '{"t":"sv","tick":9,"run":false,"core":[0,10],"over":true,"why":"core","rc":[1,3]';
    expect(decodeHostFrame(`${base},"st":[31,212,4,130,18]}`)).toMatchObject({
      st: [31, 212, 4, 130, 18],
    });
    for (const st of [
      '',
      ',"st":null',
      ',"st":5',
      ',"st":[1,2]',
      ',"st":[1,2,3]',
      ',"st":[1,2,3,4]',
      ',"st":[1,2,3,4,5,6]',
      ',"st":["1",2,3,4,5]',
      ',"st":[1.5,2,3,4,5]',
      ',"st":[1,2.5,3,4,5]',
      ',"st":[1,2,3.5,4,5]',
      ',"st":[1,2,3,4.5,5]',
      ',"st":[1,2,3,4,5.5]',
      ',"st":[-1,2,3,4,5]',
      ',"st":[1,-2,3,4,5]',
      ',"st":[1,2,-3,4,5]',
      ',"st":[1,2,3,-4,5]',
      ',"st":[1,2,3,4,-5]',
      ',"st":[3000000000,2,3,4,5]',
      ',"st":[1,2,3,3000000000,5]',
      ',"st":[1,2,3,4,3000000000]',
      ',"st":[1,null,3,4,5]',
    ]) {
      expect(decodeHostFrame(`${base}${st}}`), st).toBeNull();
    }
  });

  it('refuses a pool word with the wrong number of materials, a count that is not a whole number, a ceiling that is missing or research points that make no sense', () => {
    const base = { t: 'ec', pl: [30, 0, 0, 0], cap: 400, rp: 20, cl: 12 };
    expect(decodeHostFrame(JSON.stringify(base))).toEqual(base);
    for (const bad of [
      { pl: undefined },
      { pl: null },
      { pl: [30, 0, 0] },
      { pl: [30, 0, 0, 0, 0] },
      { pl: [30, 0, 0, '0'] },
      { pl: [30, 0.5, 0, 0] },
      { pl: [-1, 0, 0, 0] },
      { pl: [3000000000, 0, 0, 0] },
      { cap: undefined },
      { cap: -1 },
      { cap: 1.5 },
      { cap: '400' },
      { rp: undefined },
      { rp: -1 },
      { rp: 1.5 },
      { rp: '20' },
      { rp: 3000000000 },
      { cl: undefined },
      { cl: -1 },
      { cl: 1.5 },
      { cl: '12' },
      // A Terminal can not have read more than the crew has earned.
      { cl: 21 },
      { rp: 11 },
    ]) {
      const text = JSON.stringify({ ...base, ...bad });
      expect(decodeHostFrame(text), text).toBeNull();
    }
  });

  it('refuses a list of heaps that is too long, has a heap of the wrong shape or one with numbers that make no sense', () => {
    const heap = [-18.25, 10.3, -19.5, 3.125, 1.05, 3, 1, 0, 2];
    expect(decodeHostFrame(JSON.stringify({ t: 'nl', n: [heap] }))).toEqual({ t: 'nl', n: [heap] });
    const long = new Array(NET.maxDebris + 1).fill(heap);
    expect(decodeHostFrame(JSON.stringify({ t: 'nl', n: long }))).toBeNull();
    expect(
      decodeHostFrame(JSON.stringify({ t: 'nl', n: new Array(NET.maxDebris).fill(heap) })),
    ).not.toBeNull();
    const edits = (index: number, value: unknown): unknown[] => {
      const copy: unknown[] = [...heap];
      copy[index] = value;
      return copy;
    };
    for (const bad of [
      null,
      7,
      [],
      heap.slice(0, 8),
      [...heap, 1],
      edits(0, 'x'),
      edits(1, null),
      edits(2, NET.move.limit + 1),
      edits(3, 1e9),
      edits(4, 0),
      edits(4, -1),
      edits(5, 0),
      edits(5, 2.5),
      edits(5, 300),
      edits(6, 0),
      edits(6, 5),
      edits(7, -1),
      edits(7, 70000),
      edits(8, 4),
      edits(8, -1),
      edits(8, 1.5),
    ]) {
      const text = JSON.stringify({ t: 'nl', n: [bad] });
      expect(decodeHostFrame(text), text).toBeNull();
    }
    expect(decodeHostFrame('{"t":"nl"}')).toBeNull();
    expect(decodeHostFrame('{"t":"nl","n":"x"}')).toBeNull();
  });

  it('refuses a word that a heap was stripped without saying who, which heap, what went in or what is left', () => {
    const base = { t: 'hd', p: 2, i: 7, m: 1, g: 11, l: 1, f: false };
    expect(decodeHostFrame(JSON.stringify(base))).toEqual(base);
    for (const bad of [
      { p: undefined },
      { p: 0 },
      { p: 1.5 },
      { i: undefined },
      { i: -1 },
      { i: NET.maxDebris },
      { i: 1.5 },
      { m: 0 },
      { m: 5 },
      { m: '1' },
      { g: -1 },
      { g: 1.5 },
      { g: undefined },
      { l: -1 },
      { l: 256 },
      { l: 0.5 },
      { f: undefined },
      { f: 1 },
      { f: 'no' },
    ]) {
      const text = JSON.stringify({ ...base, ...bad });
      expect(decodeHostFrame(text), text).toBeNull();
    }
  });

  it('refuses a welcome that does not say which run the room is in', () => {
    const base = frames[0] as Extract<HostFrame, { t: 'welcome' }>;
    for (const run of [undefined, 0, -1, 1.5, '1', null, 70000]) {
      const text = JSON.stringify({ ...base, run });
      expect(decodeHostFrame(text), text).toBeNull();
    }
    expect(decodeHostFrame(JSON.stringify({ ...base, run: 12 }))).toMatchObject({ run: 12 });
  });

  it('refuses a restart that has no valley, no place to stand or no run to count', () => {
    const base = frames.find((frame) => frame.t === 'run') as Extract<HostFrame, { t: 'run' }>;
    expect(decodeHostFrame(JSON.stringify(base))).toEqual(base);
    for (const bad of [
      { n: undefined },
      { n: 1 },
      { n: 0 },
      { n: 2.5 },
      { n: '2' },
      { n: 70000 },
      { seed: undefined },
      { seed: 1.5 },
      { seed: '7' },
      { seed: 2 ** 60 },
      { seq: undefined },
      { seq: -1 },
      { seq: 1.5 },
      { epoch: undefined },
      { epoch: -1 },
      { epoch: 256 },
      { epoch: 1.5 },
      { spawn: undefined },
      { spawn: null },
      { spawn: { x: 1, y: 2 } },
      { spawn: { x: 1, y: 2, z: 'x' } },
      { spawn: { x: NET.move.limit + 1, y: 0, z: 0 } },
    ]) {
      const text = JSON.stringify({ ...base, ...bad });
      expect(decodeHostFrame(text), text).toBeNull();
    }
  });

  it('wants a cause exactly when the run is over, and only the two it knows', () => {
    const open = '{"t":"sv","tick":9,"run":false,"core":[5,10],"rc":[1,3],"st":[0,0,0,0,0]';
    expect(decodeHostFrame(`${open},"over":true,"why":"crew"}`)).toMatchObject({ why: 'crew' });
    expect(decodeHostFrame(`${open},"over":true,"why":"core"}`)).toMatchObject({ why: 'core' });
    for (const text of [
      `${open},"over":true}`,
      `${open},"over":true,"why":"hunger"}`,
      `${open},"over":true,"why":null}`,
      `${open},"over":false,"why":"core"}`,
    ]) {
      expect(decodeHostFrame(text), text).toBeNull();
    }
    expect(decodeHostFrame(`${open},"over":false}`)).not.toHaveProperty('why');
    for (const text of [
      '{"t":"se","e":{"k":"overrun","n":3}}',
      '{"t":"se","e":{"k":"overrun","n":3,"why":"hunger"}}',
      '{"t":"se","e":{"k":"overrun","n":3,"why":2}}',
    ]) {
      expect(decodeHostFrame(text), text).toBeNull();
    }
  });

  it('refuses a word that a player went down or came back without saying who, or how many charges are left', () => {
    const down = { k: 'down', n: 2, p: 3 };
    const back = { k: 'back', n: 2, p: 3, c: 1 };
    expect(decodeHostFrame(JSON.stringify({ t: 'se', e: down }))).toEqual({ t: 'se', e: down });
    expect(decodeHostFrame(JSON.stringify({ t: 'se', e: back }))).toEqual({ t: 'se', e: back });
    for (const bad of [
      { e: { ...down, p: undefined } },
      { e: { ...down, p: 0 } },
      { e: { ...down, p: -1 } },
      { e: { ...down, p: 1.5 } },
      { e: { ...down, p: '3' } },
      { e: { ...down, p: 70000 } },
      { e: { ...down, n: 0 } },
      { e: { ...back, p: undefined } },
      { e: { ...back, p: 0 } },
      { e: { ...back, c: undefined } },
      { e: { ...back, c: -1 } },
      { e: { ...back, c: 1.5 } },
      { e: { ...back, c: 70000 } },
      { e: { ...back, c: null } },
    ]) {
      const text = JSON.stringify({ t: 'se', ...bad });
      expect(decodeHostFrame(text), text).toBeNull();
    }
  });

  it("refuses a word about a player's countdowns that is missing, fractional or longer than a byte", () => {
    const base = '{"t":"vt","hp":[0,100],"en":[50,100],"chg":false';
    expect(decodeHostFrame(`${base},"rt":6,"sk":45}`)).toMatchObject({ rt: 6, sk: 45 });
    for (const tail of [
      '',
      ',"rt":6',
      ',"sk":45',
      ',"rt":-1,"sk":0',
      ',"rt":0,"sk":-1',
      ',"rt":1.5,"sk":0',
      ',"rt":0,"sk":2.5',
      ',"rt":256,"sk":0',
      ',"rt":0,"sk":256',
      ',"rt":"6","sk":0',
      ',"rt":null,"sk":0',
    ]) {
      expect(decodeHostFrame(`${base}${tail}}`), tail).toBeNull();
    }
  });

  it('refuses a word about a shot with a missing or malformed shooter, end point, flags or target', () => {
    const base = { t: 'sh', p: 2, e: [3.5, 10, -12.25], f: 1, h: 17 };
    expect(decodeHostFrame(JSON.stringify(base))).toEqual(base);
    for (const bad of [
      { p: undefined },
      { p: 0 },
      { p: -1 },
      { p: 1.5 },
      { p: 70000 },
      { p: '2' },
      { e: undefined },
      { e: [1, 2] },
      { e: [1, 2, 3, 4] },
      { e: [1, 2, 'x'] },
      { e: [1, null, 3] },
      { e: [NET.move.limit + 1, 0, 0] },
      { f: undefined },
      { f: -1 },
      { f: 8 },
      { f: 1.5 },
      { f: '1' },
      { h: undefined },
      { h: -1 },
      { h: 70000 },
      { h: 1.5 },
      { h: null },
    ]) {
      const text = JSON.stringify({ ...base, ...bad });
      expect(decodeHostFrame(text), text).toBeNull();
    }
  });

  it('refuses a word about a turret’s shot that names a player, or whose cell is not a cell', () => {
    const base = { t: 'sh', p: 0, c: [11, 10, -6], e: [3.5, 10.5, -12.25], f: 1, h: 17 };
    expect(decodeHostFrame(JSON.stringify(base))).toEqual(base);
    for (const bad of [
      { p: 2 },
      { p: undefined },
      { p: -1 },
      { c: null },
      { c: [1, 2] },
      { c: [1, 2, 3, 4] },
      { c: [1.5, 2, 3] },
      { c: [1, 2, '3'] },
      { c: [1, null, 3] },
      { c: [40000, 0, 0] },
      { c: [0, 0, -40000] },
      { c: 'x' },
      { c: {} },
    ]) {
      const text = JSON.stringify({ ...base, ...bad });
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

describe('rounding for the wire', () => {
  it('rounds to a grid and leaves a number on it alone', () => {
    expect(roundTo(1.23456, 100)).toBe(1.23);
    expect(roundTo(-1.2349, 100)).toBe(-1.23);
    expect(roundTo(-1.2351, 100)).toBe(-1.24);
    expect(roundTo(0.70710678, 10_000)).toBe(0.7071);
    expect(roundTo(12.5, 100)).toBe(12.5);
    expect(roundTo(0, 100)).toBe(0);
    expect(roundTo(-0.0004, 100)).toBeCloseTo(0, 12);
  });
});
