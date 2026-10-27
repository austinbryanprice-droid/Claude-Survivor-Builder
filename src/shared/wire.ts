import {
  ENEMY_FLAGS_MASK,
  ENEMY_HEALTH_FULL,
  ENEMY_KIND_COUNT,
  createEnemyState,
  type EnemyState,
} from './enemy-state';
import { POOL_SLOTS } from './economy';
import { PITCH_LIMIT, wrapAngle } from './look';
import { cleanName, isToken } from './names';
import { NET } from './net-config';
import type {
  BlockCommand,
  DenyReason,
  EditRecord,
  GuestFrame,
  HostFrame,
  PlayerId,
  PlayerSample,
  PlayerWire,
  WorldEvent,
} from './protocol';
import { createPlayerSample } from './protocol';
import { SHOT_FLAGS_MASK } from './shot';
import { SURVIVAL_EVENT_KINDS, type OverrunCause, type SurvivalEvent } from './survival-state';

/**
 * Turns the protocol into bytes and back. Control frames are JSON text on the ordered channel;
 * player state is a small quantized binary packet on the fast one. Everything that arrives from
 * the other side is untrusted, so every decoder checks the shape and the ranges and answers `null`
 * for anything it does not like, and never throws.
 */

// ----------------------------------------------------------------------------------------------
// Small checks.
// ----------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isNum(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

function isStr(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

/** Cell coordinates fit a signed 16-bit field, which is also what a snapshot record stores. */
const CELL_MIN = -32768;
const CELL_MAX = 32767;
const MAX_U16 = 0xffff;
const MAX_U31 = 0x7fffffff;
/** A night holds a handful of waves; the frame accepts anything a byte can count. */
const MAX_WAVES = 255;
const MAX_SEED = Number.MAX_SAFE_INTEGER;
const OVERRUN_CAUSES: readonly OverrunCause[] = ['core', 'crew'];
/** Seconds a frame may count down to a respawn or a shaken spell: a byte's worth, far more than either lasts. */
const MAX_SECONDS = 255;

/** Compares 16-bit counters that wrap: is `a` newer than `b`? */
export function seqNewer(a: number, b: number): boolean {
  return a !== b && ((a - b) & MAX_U16) < 0x8000;
}

// ----------------------------------------------------------------------------------------------
// Commands and events.
// ----------------------------------------------------------------------------------------------

function readCommand(raw: unknown): BlockCommand | null {
  if (!isRecord(raw)) return null;
  const { x, y, z } = raw;
  if (
    !isInt(x, CELL_MIN, CELL_MAX) ||
    !isInt(y, CELL_MIN, CELL_MAX) ||
    !isInt(z, CELL_MIN, CELL_MAX)
  ) {
    return null;
  }
  if (raw.type === 'break') return { type: 'break', x, y, z };
  if (raw.type === 'harvest') return { type: 'harvest', x, y, z };
  if (raw.type === 'place' && isInt(raw.state, 1, MAX_U16)) {
    return { type: 'place', x, y, z, state: raw.state };
  }
  if (raw.type === 'upgrade' && isInt(raw.state, 1, MAX_U16)) {
    return { type: 'upgrade', x, y, z, state: raw.state };
  }
  return null;
}

function readEvent(raw: unknown): WorldEvent | null {
  if (!isRecord(raw) || raw.type !== 'set') return null;
  const { x, y, z, state, by } = raw;
  if (
    !isInt(x, CELL_MIN, CELL_MAX) ||
    !isInt(y, CELL_MIN, CELL_MAX) ||
    !isInt(z, CELL_MIN, CELL_MAX)
  ) {
    return null;
  }
  if (!isInt(state, 0, MAX_U16) || !isInt(by, 0, MAX_U16)) return null;
  return { type: 'set', x, y, z, state, by };
}

/** The three whole numbers of a cell, each in the range a cell coordinate has. */
function readCell(raw: unknown): [number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const [x, y, z] = raw as unknown[];
  if (
    !isInt(x, CELL_MIN, CELL_MAX) ||
    !isInt(y, CELL_MIN, CELL_MAX) ||
    !isInt(z, CELL_MIN, CELL_MAX)
  ) {
    return null;
  }
  return [x, y, z];
}

/** Three finite numbers, each no larger than `limit` in size. */
function readVec3(raw: unknown, limit: number): [number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const [x, y, z] = raw as unknown[];
  if (!isNum(x, limit) || !isNum(y, limit) || !isNum(z, limit)) return null;
  return [x, y, z];
}

function readOverrunCause(value: unknown): OverrunCause | null {
  return OVERRUN_CAUSES.find((candidate) => candidate === value) ?? null;
}

function readSurvivalEvent(raw: unknown): SurvivalEvent | null {
  if (!isRecord(raw)) return null;
  const kind = SURVIVAL_EVENT_KINDS.find((candidate) => candidate === raw.k);
  if (!kind || !isInt(raw.n, 1, MAX_U16)) return null;
  switch (kind) {
    case 'nightfall':
    case 'dawn':
      return { k: kind, n: raw.n };
    case 'wave':
      // A wave says which of the night's it is and how many machines it holds.
      if (!isInt(raw.of, 1, MAX_WAVES) || !isInt(raw.i, 1, raw.of) || !isInt(raw.c, 0, MAX_U16)) {
        return null;
      }
      return { k: 'wave', n: raw.n, i: raw.i, of: raw.of, c: raw.c };
    case 'overrun': {
      const why = readOverrunCause(raw.why);
      return why ? { k: 'overrun', n: raw.n, why } : null;
    }
    case 'down':
      return isInt(raw.p, 1, MAX_U16) ? { k: 'down', n: raw.n, p: raw.p } : null;
    case 'back':
      if (!isInt(raw.p, 1, MAX_U16) || !isInt(raw.c, 0, MAX_U16)) return null;
      return { k: 'back', n: raw.n, p: raw.p, c: raw.c };
    case 'drop':
      // A drop says which material went into the pool and how many cells of it.
      if (!isInt(raw.m, 1, POOL_SLOTS) || !isInt(raw.c, 1, MAX_U16)) return null;
      return { k: 'drop', n: raw.n, m: raw.m, c: raw.c };
  }
}

/** The most strips one heap can carry on the wire: a byte's worth, far more than the table asks for. */
const DEBRIS_MAX_LEFT = 255;

/** One heap of the list: `[x, y, z, yaw, scale, harvests, grade, from, left]`, every number checked. */
function readDebris(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== 9) return null;
  const [x, y, z, yaw, scale, harvests, grade, from, left] = raw as unknown[];
  const limit = NET.move.limit;
  if (!isNum(x, limit) || !isNum(y, limit) || !isNum(z, limit)) return null;
  if (!isNum(yaw, 100) || !isNum(scale, 100) || scale <= 0) return null;
  if (!isInt(harvests, 1, DEBRIS_MAX_LEFT) || !isInt(grade, 1, POOL_SLOTS)) return null;
  if (!isInt(from, 0, MAX_U16) || !isInt(left, 0, harvests)) return null;
  return [x, y, z, yaw, scale, harvests, grade, from, left];
}

function readPlayerWire(raw: unknown): PlayerWire | null {
  if (!isRecord(raw)) return null;
  if (!isInt(raw.id, 1, MAX_U16) || !isInt(raw.slot, 0, NET.maxPlayers - 1)) return null;
  if (!isStr(raw.name, 200)) return null;
  return { id: raw.id, slot: raw.slot, name: cleanName(raw.name, 'Crew') };
}

// ----------------------------------------------------------------------------------------------
// Control frames.
// ----------------------------------------------------------------------------------------------

function parse(text: string): Json | null {
  if (typeof text !== 'string' || text.length > NET.maxFrameLength) return null;
  try {
    const raw: unknown = JSON.parse(text);
    return isRecord(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function encodeFrame(frame: GuestFrame | HostFrame): string {
  return JSON.stringify(frame);
}

/** `value` rounded to a multiple of 1/`scale`, so a frame carries a short number and both ends read the same one. */
export function roundTo(value: number, scale: number): number {
  return Math.round(value * scale) / scale;
}

export function decodeGuestFrame(text: string): GuestFrame | null {
  const raw = parse(text);
  if (!raw) return null;
  switch (raw.t) {
    case 'hello':
      if (!isInt(raw.v, 0, 1000) || !isStr(raw.build, 40) || !isToken(raw.token)) return null;
      if (!isStr(raw.name, 200)) return null;
      return { t: 'hello', v: raw.v, build: raw.build, token: raw.token, name: raw.name };
    case 'cmd': {
      const command = readCommand(raw.c);
      if (!command || !isInt(raw.id, 0, MAX_U31)) return null;
      return { t: 'cmd', id: raw.id, c: command };
    }
    case 'fire': {
      const origin = readVec3(raw.o, NET.move.limit);
      const direction = readVec3(raw.d, 2);
      if (!origin || !direction || !isNum(raw.at, 1e12)) return null;
      return { t: 'fire', o: origin, d: direction, at: raw.at };
    }
    case 'ping':
      if (!isInt(raw.n, 0, MAX_U31) || !isNum(raw.rtt, 600_000)) return null;
      return { t: 'ping', n: raw.n, rtt: Math.max(0, raw.rtt) };
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}

const DENY_REASONS: readonly DenyReason[] = ['full', 'version', 'closed'];
const LEAVE_REASONS = ['left', 'timeout', 'closed'] as const;

export function decodeHostFrame(text: string): HostFrame | null {
  const raw = parse(text);
  if (!raw) return null;
  switch (raw.t) {
    case 'welcome': {
      const { spawn } = raw;
      if (!isRecord(spawn)) return null;
      const limit = NET.move.limit;
      if (!isNum(spawn.x, limit) || !isNum(spawn.y, limit) || !isNum(spawn.z, limit)) return null;
      if (!Array.isArray(raw.players) || raw.players.length > NET.maxPlayers) return null;
      const players: PlayerWire[] = [];
      for (const entry of raw.players) {
        const player = readPlayerWire(entry);
        if (!player) return null;
        players.push(player);
      }
      const maxParts = Math.ceil(NET.maxSnapshotEdits / NET.snapshotEditsPerFrame) + 1;
      if (
        !isInt(raw.v, 0, 1000) ||
        !isInt(raw.id, 1, MAX_U16) ||
        !isInt(raw.slot, 0, NET.maxPlayers - 1) ||
        !isInt(raw.hostId, 1, MAX_U16) ||
        !isInt(raw.seed, -MAX_SEED, MAX_SEED) ||
        !isInt(raw.seq, 0, MAX_U31) ||
        !isNum(raw.hostTime, 1e12) ||
        !isInt(raw.epoch, 0, 255) ||
        !isInt(raw.run, 1, MAX_U16) ||
        !isInt(raw.parts, 0, maxParts) ||
        !isInt(raw.edits, 0, NET.maxSnapshotEdits)
      ) {
        return null;
      }
      return {
        t: 'welcome',
        v: raw.v,
        id: raw.id,
        slot: raw.slot,
        hostId: raw.hostId,
        seed: raw.seed,
        seq: raw.seq,
        hostTime: raw.hostTime,
        spawn: { x: spawn.x, y: spawn.y, z: spawn.z },
        epoch: raw.epoch,
        run: raw.run,
        players,
        parts: raw.parts,
        edits: raw.edits,
      };
    }
    case 'deny': {
      const reason = DENY_REASONS.find((candidate) => candidate === raw.reason);
      return reason ? { t: 'deny', reason } : null;
    }
    case 'snap':
      if (!isInt(raw.i, 0, 10_000) || !isStr(raw.b, NET.maxFrameLength)) return null;
      return { t: 'snap', i: raw.i, b: raw.b };
    case 'join': {
      const player = readPlayerWire(raw.p);
      return player ? { t: 'join', p: player } : null;
    }
    case 'leave': {
      const why = LEAVE_REASONS.find((candidate) => candidate === raw.why);
      if (!isInt(raw.id, 1, MAX_U16) || !why) return null;
      return { t: 'leave', id: raw.id, why };
    }
    case 'ev': {
      const event = readEvent(raw.e);
      if (!event || !isInt(raw.s, 0, MAX_U31)) return null;
      return { t: 'ev', s: raw.s, e: event };
    }
    case 'rej':
      if (!isInt(raw.id, 0, MAX_U31) || !isStr(raw.r, 120)) return null;
      return { t: 'rej', id: raw.id, r: raw.r };
    case 'fix': {
      const limit = NET.move.limit;
      if (!isInt(raw.epoch, 0, 255)) return null;
      if (!isNum(raw.x, limit) || !isNum(raw.y, limit) || !isNum(raw.z, limit)) return null;
      return { t: 'fix', epoch: raw.epoch, x: raw.x, y: raw.y, z: raw.z };
    }
    case 'pong':
      return isInt(raw.n, 0, MAX_U31) ? { t: 'pong', n: raw.n } : null;
    case 'sv': {
      if (!isInt(raw.tick, 0, MAX_U31) || typeof raw.run !== 'boolean') return null;
      if (typeof raw.over !== 'boolean' || !Array.isArray(raw.core) || raw.core.length !== 2) {
        return null;
      }
      const [health, max] = raw.core as unknown[];
      if (!isInt(max, 1, MAX_U16) || !isInt(health, 0, max)) return null;
      if (!Array.isArray(raw.rc) || raw.rc.length !== 2) return null;
      const [charges, chargeMax] = raw.rc as unknown[];
      if (!isInt(chargeMax, 0, MAX_U16) || !isInt(charges, 0, chargeMax)) return null;
      if (!Array.isArray(raw.st) || raw.st.length !== 5) return null;
      const [felled, placed, revived, gathered, upgraded] = raw.st as unknown[];
      if (
        !isInt(felled, 0, MAX_U31) ||
        !isInt(placed, 0, MAX_U31) ||
        !isInt(revived, 0, MAX_U31) ||
        !isInt(gathered, 0, MAX_U31) ||
        !isInt(upgraded, 0, MAX_U31)
      ) {
        return null;
      }
      // A run that has ended says why; one that has not says nothing.
      const why = raw.over ? readOverrunCause(raw.why) : null;
      if (raw.over ? why === null : raw.why !== undefined) return null;
      const frame = {
        t: 'sv' as const,
        tick: raw.tick,
        run: raw.run,
        core: [health, max] as const,
        over: raw.over,
        rc: [charges, chargeMax] as const,
        st: [felled, placed, revived, gathered, upgraded] as const,
      };
      return why ? { ...frame, why } : frame;
    }
    case 'run': {
      const { spawn } = raw;
      if (!isRecord(spawn)) return null;
      const limit = NET.move.limit;
      if (!isNum(spawn.x, limit) || !isNum(spawn.y, limit) || !isNum(spawn.z, limit)) return null;
      if (
        !isInt(raw.n, 2, MAX_U16) ||
        !isInt(raw.seed, -MAX_SEED, MAX_SEED) ||
        !isInt(raw.seq, 0, MAX_U31) ||
        !isInt(raw.epoch, 0, 255)
      ) {
        return null;
      }
      return {
        t: 'run',
        n: raw.n,
        seed: raw.seed,
        seq: raw.seq,
        spawn: { x: spawn.x, y: spawn.y, z: spawn.z },
        epoch: raw.epoch,
      };
    }
    case 'se': {
      const event = readSurvivalEvent(raw.e);
      return event ? { t: 'se', e: event } : null;
    }
    case 'ec': {
      if (!Array.isArray(raw.pl) || raw.pl.length !== POOL_SLOTS || !isInt(raw.cap, 0, MAX_U31)) {
        return null;
      }
      if (!isInt(raw.rp, 0, MAX_U31) || !isInt(raw.cl, 0, raw.rp)) return null;
      const stock: number[] = [];
      for (const amount of raw.pl as unknown[]) {
        if (!isInt(amount, 0, MAX_U31)) return null;
        stock.push(amount);
      }
      return { t: 'ec', pl: stock, cap: raw.cap, rp: raw.rp, cl: raw.cl };
    }
    case 'nl': {
      if (!Array.isArray(raw.n) || raw.n.length > NET.maxDebris) return null;
      const heaps: number[][] = [];
      for (const entry of raw.n as unknown[]) {
        const heap = readDebris(entry);
        if (!heap) return null;
        heaps.push(heap);
      }
      return { t: 'nl', n: heaps };
    }
    case 'hd':
      if (
        !isInt(raw.p, 1, MAX_U16) ||
        !isInt(raw.i, 0, NET.maxDebris - 1) ||
        !isInt(raw.m, 1, POOL_SLOTS) ||
        !isInt(raw.g, 0, MAX_U31) ||
        !isInt(raw.l, 0, DEBRIS_MAX_LEFT) ||
        typeof raw.f !== 'boolean'
      ) {
        return null;
      }
      return { t: 'hd', p: raw.p, i: raw.i, m: raw.m, g: raw.g, l: raw.l, f: raw.f };
    case 'vt': {
      if (typeof raw.chg !== 'boolean') return null;
      if (!Array.isArray(raw.hp) || raw.hp.length !== 2) return null;
      if (!Array.isArray(raw.en) || raw.en.length !== 2) return null;
      const [health, healthMax] = raw.hp as unknown[];
      const [energy, energyMax] = raw.en as unknown[];
      if (!isInt(healthMax, 1, MAX_U16) || !isInt(health, 0, healthMax)) return null;
      if (!isInt(energyMax, 1, MAX_U16) || !isInt(energy, 0, energyMax)) return null;
      if (!isInt(raw.rt, 0, MAX_SECONDS) || !isInt(raw.sk, 0, MAX_SECONDS)) return null;
      return {
        t: 'vt',
        hp: [health, healthMax],
        en: [energy, energyMax],
        chg: raw.chg,
        rt: raw.rt,
        sk: raw.sk,
      };
    }
    case 'sh': {
      const end = readVec3(raw.e, NET.move.limit);
      if (!end || !isInt(raw.h, 0, MAX_U16)) return null;
      if (!isInt(raw.f, 0, SHOT_FLAGS_MASK)) return null;
      // A player's shot names the player and no cell; a turret's names its cell and no player.
      if (raw.c === undefined) {
        if (!isInt(raw.p, 1, MAX_U16)) return null;
        return { t: 'sh', p: raw.p, e: end, f: raw.f, h: raw.h };
      }
      const cell = readCell(raw.c);
      if (!cell || raw.p !== 0) return null;
      return { t: 'sh', p: 0, c: cell, e: end, f: raw.f, h: raw.h };
    }
    case 'pings': {
      if (!Array.isArray(raw.p) || raw.p.length > NET.maxPlayers) return null;
      const pings: [PlayerId, number][] = [];
      for (const entry of raw.p) {
        if (!Array.isArray(entry) || entry.length !== 2) return null;
        const [id, rtt] = entry as unknown[];
        if (!isInt(id, 1, MAX_U16) || !isNum(rtt, 600_000)) return null;
        pings.push([id, Math.max(0, rtt)]);
      }
      return { t: 'pings', p: pings };
    }
    case 'bye':
      return raw.why === 'closed' ? { t: 'bye', why: 'closed' } : null;
    default:
      return null;
  }
}

// ----------------------------------------------------------------------------------------------
// Edit lists (snapshots): packed records in base64, one slice per frame.
// ----------------------------------------------------------------------------------------------

const RECORD_BYTES = 8;

function bytesToBase64(bytes: Uint8Array): string {
  let text = '';
  const step = 0x2000;
  for (let i = 0; i < bytes.length; i += step) {
    text += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(text);
}

function base64ToBytes(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Packs `records[from, from + count)` as little-endian i16 x, y, z and u16 state, then base64. */
export function encodeEdits(
  records: readonly EditRecord[],
  from = 0,
  count = records.length,
): string {
  const end = Math.min(records.length, from + count);
  const bytes = new Uint8Array(Math.max(0, end - from) * RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (let i = from; i < end; i++) {
    const record = records[i] as EditRecord;
    view.setInt16(offset, record.x, true);
    view.setInt16(offset + 2, record.y, true);
    view.setInt16(offset + 4, record.z, true);
    view.setUint16(offset + 6, record.state, true);
    offset += RECORD_BYTES;
  }
  return bytesToBase64(bytes);
}

/** Reads one slice written by `encodeEdits`; null when it is not a whole number of records or too big. */
export function decodeEdits(
  text: string,
  maxRecords = NET.snapshotEditsPerFrame * 4,
): EditRecord[] | null {
  const bytes = base64ToBytes(text);
  if (!bytes || bytes.length % RECORD_BYTES !== 0 || bytes.length / RECORD_BYTES > maxRecords) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records: EditRecord[] = [];
  for (let offset = 0; offset < bytes.length; offset += RECORD_BYTES) {
    const state = view.getUint16(offset + 6, true);
    if (state === 0) return null;
    records.push({
      x: view.getInt16(offset, true),
      y: view.getInt16(offset + 2, true),
      z: view.getInt16(offset + 4, true),
      state,
    });
  }
  return records;
}

// ----------------------------------------------------------------------------------------------
// Player state: quantized binary on the fast channel.
// ----------------------------------------------------------------------------------------------

/** Positions and velocities are fixed point with 1/256 of a block (or block per second) of resolution. */
const POS_SCALE = 256;
const VEL_SCALE = 256;
const VEL_LIMIT = 32767 / VEL_SCALE;
const TWO_PI = Math.PI * 2;

const FLAG_ON_GROUND = 1;
const FLAG_RESET = 2;

export const KIND_GUEST_STATE = 1;
export const KIND_RELAY = 2;

/** What a guest sends the host about itself. */
export interface GuestStatePacket {
  /** Bumped by the host each time it moves the guest; reports with an old epoch are ignored. */
  epoch: number;
  /** Counts up with every packet and wraps at 65536, so stale ones can be dropped. */
  seq: number;
  /** The guest's own clock in milliseconds when the sample was taken. */
  time: number;
  sample: PlayerSample;
}

/** One player in the host's relay. */
export interface RelayEntry {
  id: PlayerId;
  /**
   * How long before the packet's `hostTime` the host's clock read when this sample was taken.
   * Negative when the host's estimate puts the sample slightly ahead of now (its clock estimate
   * for that guest has not settled yet): clamping it would bend the timeline the guests draw on.
   */
  age: number;
  sample: PlayerSample;
}

export interface RelayPacket {
  seq: number;
  hostTime: number;
  entries: RelayEntry[];
}

const SAMPLE_BYTES = 23;
const GUEST_STATE_HEADER = 8;
const RELAY_HEADER = 8;
const RELAY_ENTRY_HEADER = 4;
export const GUEST_STATE_BYTES = GUEST_STATE_HEADER + SAMPLE_BYTES;

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function writeSample(view: DataView, at: number, sample: PlayerSample): void {
  const lim = NET.move.limit * POS_SCALE;
  view.setInt32(at, clampInt(sample.x * POS_SCALE, -lim, lim), true);
  view.setInt32(at + 4, clampInt(sample.y * POS_SCALE, -lim, lim), true);
  view.setInt32(at + 8, clampInt(sample.z * POS_SCALE, -lim, lim), true);
  view.setInt16(at + 12, clampInt(sample.vx * VEL_SCALE, -32767, 32767), true);
  view.setInt16(at + 14, clampInt(sample.vy * VEL_SCALE, -32767, 32767), true);
  view.setInt16(at + 16, clampInt(sample.vz * VEL_SCALE, -32767, 32767), true);
  const yaw = (wrapAngle(sample.yaw) + Math.PI) / TWO_PI;
  view.setUint16(at + 18, Math.round(yaw * 65536) & MAX_U16, true);
  const pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, sample.pitch)) / PITCH_LIMIT;
  view.setInt16(at + 20, clampInt(pitch * 32767, -32767, 32767), true);
  view.setUint8(at + 22, (sample.onGround ? FLAG_ON_GROUND : 0) | (sample.reset ? FLAG_RESET : 0));
}

function readSample(view: DataView, at: number): PlayerSample | null {
  const lim = NET.move.limit * POS_SCALE;
  const qx = view.getInt32(at, true);
  const qy = view.getInt32(at + 4, true);
  const qz = view.getInt32(at + 8, true);
  if (Math.abs(qx) > lim || Math.abs(qy) > lim || Math.abs(qz) > lim) return null;
  const sample = createPlayerSample();
  sample.x = qx / POS_SCALE;
  sample.y = qy / POS_SCALE;
  sample.z = qz / POS_SCALE;
  sample.vx = view.getInt16(at + 12, true) / VEL_SCALE;
  sample.vy = view.getInt16(at + 14, true) / VEL_SCALE;
  sample.vz = view.getInt16(at + 16, true) / VEL_SCALE;
  sample.yaw = (view.getUint16(at + 18, true) / 65536) * TWO_PI - Math.PI;
  sample.pitch = (view.getInt16(at + 20, true) / 32767) * PITCH_LIMIT;
  const flags = view.getUint8(at + 22);
  sample.onGround = (flags & FLAG_ON_GROUND) !== 0;
  sample.reset = (flags & FLAG_RESET) !== 0;
  return sample;
}

/** The largest speed a packet can carry, in blocks per second. */
export const MAX_WIRE_SPEED = VEL_LIMIT;

export function encodeGuestState(packet: GuestStatePacket): Uint8Array {
  const bytes = new Uint8Array(GUEST_STATE_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, KIND_GUEST_STATE);
  view.setUint8(1, packet.epoch & 0xff);
  view.setUint16(2, packet.seq & MAX_U16, true);
  view.setUint32(4, Math.max(0, Math.round(packet.time)) >>> 0, true);
  writeSample(view, GUEST_STATE_HEADER, packet.sample);
  return bytes;
}

export function decodeGuestState(bytes: Uint8Array): GuestStatePacket | null {
  if (bytes.length !== GUEST_STATE_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== KIND_GUEST_STATE) return null;
  const sample = readSample(view, GUEST_STATE_HEADER);
  if (!sample) return null;
  return {
    epoch: view.getUint8(1),
    seq: view.getUint16(2, true),
    time: view.getUint32(4, true),
    sample,
  };
}

export function encodeRelay(packet: RelayPacket): Uint8Array {
  const count = Math.min(packet.entries.length, NET.maxPlayers);
  const entryBytes = RELAY_ENTRY_HEADER + SAMPLE_BYTES;
  const bytes = new Uint8Array(RELAY_HEADER + count * entryBytes);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, KIND_RELAY);
  view.setUint8(1, count);
  view.setUint16(2, packet.seq & MAX_U16, true);
  view.setUint32(4, Math.max(0, Math.round(packet.hostTime)) >>> 0, true);
  for (let i = 0; i < count; i++) {
    const entry = packet.entries[i] as RelayEntry;
    const at = RELAY_HEADER + i * entryBytes;
    view.setUint16(at, entry.id & MAX_U16, true);
    view.setInt16(at + 2, clampInt(entry.age, -32768, 32767), true);
    writeSample(view, at + RELAY_ENTRY_HEADER, entry.sample);
  }
  return bytes;
}

export function decodeRelay(bytes: Uint8Array): RelayPacket | null {
  if (bytes.length < RELAY_HEADER) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== KIND_RELAY) return null;
  const count = view.getUint8(1);
  const entryBytes = RELAY_ENTRY_HEADER + SAMPLE_BYTES;
  if (count > NET.maxPlayers || bytes.length !== RELAY_HEADER + count * entryBytes) return null;
  const entries: RelayEntry[] = [];
  for (let i = 0; i < count; i++) {
    const at = RELAY_HEADER + i * entryBytes;
    const sample = readSample(view, at + RELAY_ENTRY_HEADER);
    const id = view.getUint16(at, true);
    if (!sample || id === 0) return null;
    entries.push({ id, age: view.getInt16(at + 2, true), sample });
  }
  return { seq: view.getUint16(2, true), hostTime: view.getUint32(4, true), entries };
}

// ----------------------------------------------------------------------------------------------
// The machines: every one of them in a single packet, on the fast channel.
// ----------------------------------------------------------------------------------------------

export const KIND_ENEMIES = 3;

/** Enemy positions are fixed point with 1/16 of a block of resolution, in a signed 16-bit field. */
const ENEMY_POS_SCALE = 16;
const ENEMY_HEADER = 8;
const ENEMY_BYTES = 12;

/** What the host says about the machines: all of them, as of one moment. */
export interface EnemiesPacket {
  /** Counts up with every packet and wraps at 65536, so stale ones can be dropped. */
  seq: number;
  /** The host's clock in milliseconds when the states were true. */
  hostTime: number;
  entries: EnemyState[];
}

/** The most bytes an enemy packet has. */
export const ENEMIES_PACKET_MAX = ENEMY_HEADER + NET.maxEnemies * ENEMY_BYTES;

/** Packs the first `count` of `states`, which is all of the machines, into a packet. */
export function encodeEnemies(
  seq: number,
  hostTime: number,
  states: readonly EnemyState[],
  count: number,
): Uint8Array {
  const n = Math.min(count, states.length, NET.maxEnemies);
  const bytes = new Uint8Array(ENEMY_HEADER + n * ENEMY_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, KIND_ENEMIES);
  view.setUint8(1, n);
  view.setUint16(2, seq & MAX_U16, true);
  view.setUint32(4, Math.max(0, Math.round(hostTime)) >>> 0, true);
  for (let i = 0; i < n; i++) {
    const state = states[i] as EnemyState;
    const at = ENEMY_HEADER + i * ENEMY_BYTES;
    view.setUint16(at, state.id & MAX_U16, true);
    view.setUint8(at + 2, state.kind & 0xff);
    view.setUint8(at + 3, state.flags & ENEMY_FLAGS_MASK);
    view.setInt16(at + 4, clampInt(state.x * ENEMY_POS_SCALE, -32768, 32767), true);
    view.setInt16(at + 6, clampInt(state.y * ENEMY_POS_SCALE, -32768, 32767), true);
    view.setInt16(at + 8, clampInt(state.z * ENEMY_POS_SCALE, -32768, 32767), true);
    const yaw = (wrapAngle(state.yaw) + Math.PI) / TWO_PI;
    view.setUint8(at + 10, Math.round(yaw * 256) & 0xff);
    view.setUint8(at + 11, clampInt(state.health, 1, ENEMY_HEALTH_FULL));
  }
  return bytes;
}

export function decodeEnemies(bytes: Uint8Array): EnemiesPacket | null {
  if (bytes.length < ENEMY_HEADER) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== KIND_ENEMIES) return null;
  const count = view.getUint8(1);
  if (count > NET.maxEnemies || bytes.length !== ENEMY_HEADER + count * ENEMY_BYTES) return null;
  const entries: EnemyState[] = [];
  for (let i = 0; i < count; i++) {
    const at = ENEMY_HEADER + i * ENEMY_BYTES;
    const state = createEnemyState();
    state.id = view.getUint16(at, true);
    state.kind = view.getUint8(at + 2);
    state.flags = view.getUint8(at + 3) & ENEMY_FLAGS_MASK;
    state.x = view.getInt16(at + 4, true) / ENEMY_POS_SCALE;
    state.y = view.getInt16(at + 6, true) / ENEMY_POS_SCALE;
    state.z = view.getInt16(at + 8, true) / ENEMY_POS_SCALE;
    state.yaw = (view.getUint8(at + 10) / 256) * TWO_PI - Math.PI;
    state.health = view.getUint8(at + 11);
    // An enemy with no id, of a kind this build does not know, or with no health left is not one the host sent.
    if (state.id === 0 || state.kind >= ENEMY_KIND_COUNT || state.health === 0) return null;
    entries.push(state);
  }
  return { seq: view.getUint16(2, true), hostTime: view.getUint32(4, true), entries };
}

/** Which kind of fast-channel packet this is, or 0 for an empty or unknown one. */
export function packetKind(bytes: Uint8Array): number {
  return bytes.length > 0 ? (bytes[0] as number) : 0;
}
