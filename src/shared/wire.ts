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
const MAX_SEED = Number.MAX_SAFE_INTEGER;

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
  if (raw.type === 'place' && isInt(raw.state, 1, MAX_U16)) {
    return { type: 'place', x, y, z, state: raw.state };
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

/** Which kind of fast-channel packet this is, or 0 for an empty or unknown one. */
export function packetKind(bytes: Uint8Array): number {
  return bytes.length > 0 ? (bytes[0] as number) : 0;
}
