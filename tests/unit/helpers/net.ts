import type { BlockWorld, CellState } from '../../../src/shared/block-world';
import { createRng } from '../../../src/shared/hash';
import { NET } from '../../../src/shared/net-config';
import {
  createPlayerSample,
  type EditRecord,
  type PlayerSample,
} from '../../../src/shared/protocol';
import { decodeHostFrame, encodeFrame } from '../../../src/shared/wire';
import { GuestSession } from '../../../src/net/guest-session';
import { HostSession, type HostSessionOptions } from '../../../src/net/host-session';
import { LoopbackNetwork, type LoopbackOptions } from '../../../src/net/loopback';
import { ManualScheduler } from '../../../src/net/scheduler';
import { fixedWorld, type WorldBinding } from '../../../src/net/session';
import type { Link } from '../../../src/net/transport';
import type { HostFrame } from '../../../src/shared/protocol';
import { SurvivalSim, type SurvivalOptions } from '../../../src/systems/survival/sim';

/** A small in-memory world with the same kinds of rules as the real one (bounds, support, known ids). */
export class TestWorld implements BlockWorld {
  readonly cells = new Map<string, number>();
  setCalls = 0;

  constructor(readonly seed: number) {}

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  private inBounds(x: number, y: number, z: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      Number.isInteger(z) &&
      Math.abs(x) <= 90 &&
      Math.abs(z) <= 90 &&
      y >= 0 &&
      y <= 90
    );
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.cells.has(this.key(x, y, z));
  }

  getBlock(x: number, y: number, z: number): CellState {
    return this.cells.get(this.key(x, y, z)) ?? 0;
  }

  setBlock(x: number, y: number, z: number, state: CellState): boolean {
    this.setCalls++;
    if (!this.inBounds(x, y, z) || !Number.isInteger(state) || state < 0 || state > 65535)
      return false;
    const key = this.key(x, y, z);
    const before = this.cells.get(key) ?? 0;
    if (before === state) return false;
    if (state === 0) this.cells.delete(key);
    else this.cells.set(key, state);
    return true;
  }

  checkPlace(x: number, y: number, z: number, state: CellState): string | null {
    if (!this.inBounds(x, y, z)) return 'out-of-bounds';
    if (state < 1 || state > 1000) return 'unknown-block';
    if (this.cells.has(this.key(x, y, z))) return 'occupied';
    if (y > 0) {
      const touching = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ].some(([dx, dy, dz]) => this.cells.has(this.key(x + dx!, y + dy!, z + dz!)));
      if (!touching) return 'unsupported';
    }
    return null;
  }

  checkBreak(x: number, y: number, z: number): string | null {
    if (!this.inBounds(x, y, z)) return 'out-of-bounds';
    return this.cells.has(this.key(x, y, z)) ? null : 'empty';
  }

  forEachEdit(visit: (x: number, y: number, z: number, state: CellState) => void): void {
    const all: EditRecord[] = [];
    for (const [key, state] of this.cells) {
      const [x, y, z] = key.split(',').map(Number) as [number, number, number];
      all.push({ x, y, z, state });
    }
    all.sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);
    for (const e of all) visit(e.x, e.y, e.z, e.state);
  }

  /** The edits as a sorted list, for comparing two worlds. */
  edits(): EditRecord[] {
    const out: EditRecord[] = [];
    this.forEachEdit((x, y, z, state) => out.push({ x, y, z, state }));
    return out;
  }
}

export function token(n: number): string {
  return `token-${String(n).padStart(2, '0')}-abcdefghijklmnop`;
}

export interface Guest {
  session: GuestSession;
  /** The world this guest plays in; replaced when the snapshot loads. */
  world: () => TestWorld;
  loads: { seed: number; count: number }[];
}

export interface RoomOptions extends Partial<Omit<LoopbackOptions, 'scheduler'>> {
  /** How long a guest's world takes to build, in milliseconds. */
  loadMs?: number;
  /** Gives the host a survival simulation (true for a new run, or the options to start one with). */
  survival?: boolean | SurvivalOptions;
  /** The world the host plays in, for a test whose simulation has to see the same blocks. */
  hostWorld?: TestWorld;
  /** Where a player in each slot starts, for a test whose players have to stand on the ground it uses. */
  spawnFor?: HostSessionOptions['spawnFor'];
}

/** A host and a loopback network on virtual time. */
export function makeRoom(options: RoomOptions = {}) {
  const scheduler = new ManualScheduler();
  const network = new LoopbackNetwork({
    scheduler,
    random: createRng(99),
    ...options,
  });
  const hostWorld = options.hostWorld ?? new TestWorld(4242);
  const host = new HostSession({
    scheduler,
    world: fixedWorld(hostWorld),
    name: 'Host',
    token: token(0),
    spawnFor: options.spawnFor,
    survival: options.survival
      ? new SurvivalSim(options.survival === true ? {} : options.survival)
      : undefined,
  });

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };

  /** Moves virtual time forward in small steps, letting promises settle between them. */
  const settle = async (ms = 300): Promise<void> => {
    await flush();
    for (let t = 0; t < ms; t += 5) {
      scheduler.advance(5);
      await flush();
    }
  };

  async function openRoom(): Promise<string> {
    const pending = host.openRoom(network);
    await settle(20);
    return pending;
  }

  let guestCount = 0;
  const guests: Guest[] = [];

  function addGuest(name?: string, tokenValue?: string, extraLoadMs?: number): Guest {
    const n = ++guestCount;
    let world = new TestWorld(0);
    const loads: Guest['loads'] = [];
    const binding: WorldBinding = {
      current: () => world,
      load: (seed, edits) =>
        new Promise((resolve) => {
          const build = () => {
            world = new TestWorld(seed);
            for (const e of edits) world.setBlock(e.x, e.y, e.z, e.state);
            loads.push({ seed, count: edits.length });
            resolve();
          };
          const wait = extraLoadMs ?? options.loadMs ?? 0;
          if (wait > 0) scheduler.after(wait, build);
          else build();
        }),
    };
    const session = new GuestSession({
      scheduler,
      world: binding,
      transport: network,
      name: name ?? `Guest ${n}`,
      token: tokenValue ?? token(n),
      buildId: 'test',
    });
    const guest: Guest = { session, world: () => world, loads };
    guests.push(guest);
    return guest;
  }

  async function join(code: string, name?: string, tokenValue?: string): Promise<Guest> {
    const guest = addGuest(name, tokenValue);
    guest.session.join(code);
    await settle(300);
    return guest;
  }

  return { scheduler, network, host, hostWorld, openRoom, addGuest, join, settle, flush, guests };
}

/** A sample at a spot, standing still on the ground. */
export function at(
  x: number,
  y: number,
  z: number,
  extra: Partial<PlayerSample> = {},
): PlayerSample {
  return { ...createPlayerSample(), x, y, z, ...extra };
}

/**
 * A bare link into a room, for tests that need to say things a real guest never would: a bad
 * hello, garbage, silence. Frames the host sends are collected.
 */
export async function rawGuest(
  room: ReturnType<typeof makeRoom>,
  code: string,
): Promise<{
  link: Link;
  frames: HostFrame[];
  closed: () => boolean;
  garbage: string[];
  /** The fast-lane packets the host has sent, with the time (the scheduler's) each arrived. */
  packets: { at: number; bytes: Uint8Array }[];
}> {
  const dial = room.network.dial(code);
  await room.settle(20);
  const link = await dial;
  const frames: HostFrame[] = [];
  const garbage: string[] = [];
  const packets: { at: number; bytes: Uint8Array }[] = [];
  let closed = false;
  link.attach({
    control: (text) => {
      const frame = decodeHostFrame(text);
      if (frame) frames.push(frame);
      else garbage.push(text);
    },
    state: (bytes) => {
      packets.push({ at: room.scheduler.now(), bytes });
    },
    closed: () => {
      closed = true;
    },
  });
  return { link, frames, closed: () => closed, garbage, packets };
}

export function helloText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    t: 'hello',
    v: NET.protocolVersion,
    build: 'test',
    token: token(77),
    name: 'Raw',
    ...overrides,
  });
}

export { encodeFrame };
