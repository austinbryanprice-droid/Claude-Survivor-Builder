import { describe, expect, it } from 'vitest';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';
import { CYCLE_SECONDS } from '../../src/shared/daycycle';
import { createEconomyReading, type DebrisNode, type EconomyView } from '../../src/shared/economy';
import type { HostFrame } from '../../src/shared/protocol';
import { createReading } from '../../src/shared/survival-state';
import { createVitalsReading } from '../../src/shared/vitals-state';
import { POOL } from '../../src/systems/economy/balance';
import { DEBRIS_IN_THE_WAY } from '../../src/systems/economy/build-rules';
import { VITALS } from '../../src/systems/survival/balance';
import { FLOOR, arena, sim, type Room } from './helpers/arena';
import { at, helloText, makeRoom, rawGuest } from './helpers/net';

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const COMPOSITE = packState(SHAPE.cube, MATERIAL.composite);
const START = POOL.start[MATERIAL.scrap] as number;

/** The cell at the Core's side where the tests build: clear of every heap, which lie 16 blocks and more out. */
const SPOT = { x: 8, y: FLOOR, z: -3 };

function place(offset: number, state = SCRAP) {
  return { type: 'place' as const, x: SPOT.x, y: SPOT.y, z: SPOT.z + offset, state };
}

function breakAt(offset: number) {
  return { type: 'break' as const, x: SPOT.x, y: SPOT.y, z: SPOT.z + offset };
}

function stock(view: EconomyView): number[] {
  return [...view.read(createEconomyReading()).stock];
}

function energy(room: Room): number {
  return room.host.vitals.read(createVitalsReading()).energy;
}

function reasons(session: {
  onRejected(listener: (rejection: { reason: string }) => void): unknown;
}): string[] {
  const seen: string[] = [];
  session.onRejected((rejection) => seen.push(rejection.reason));
  return seen;
}

function placed(room: Room): number {
  return sim(room).read(createReading()).placed;
}

function framesOf<K extends HostFrame['t']>(
  raw: Awaited<ReturnType<typeof rawGuest>>,
  kind: K,
): Extract<HostFrame, { t: K }>[] {
  return raw.frames.filter((frame): frame is Extract<HostFrame, { t: K }> => frame.t === kind);
}

/** A heap the run of this arena has lying there from the start. */
function openHeap(room: Room): DebrisNode {
  const heap = sim(room).economy!.nodes.find((node) => node.from === 0);
  if (!heap) throw new Error('the run has no heap');
  return heap;
}

/** The cell a heap's middle is in. */
function cellOf(heap: DebrisNode) {
  return { x: Math.floor(heap.x), y: Math.floor(heap.y), z: Math.floor(heap.z) };
}

describe('the host placing and breaking blocks', () => {
  it('pays for a block out of the pool', () => {
    const { room, hostWorld } = arena();
    room.host.sendCommand(place(0));
    expect(hostWorld.cells.size).toBe(1);
    expect(stock(room.host.economy)).toEqual([START - 1, 0, 0, 0]);
    room.host.sendCommand(place(1));
    room.host.sendCommand(place(2));
    expect(stock(room.host.economy)[0]).toBe(START - 3);
  });

  it('gives back what a block cost when it is broken', () => {
    const { room, hostWorld } = arena();
    room.host.sendCommand(place(0));
    room.host.sendCommand(place(1));
    expect(stock(room.host.economy)[0]).toBe(START - 2);
    room.host.sendCommand(breakAt(0));
    expect(hostWorld.cells.size).toBe(1);
    expect(stock(room.host.economy)[0]).toBe(START - 1);
    room.host.sendCommand(breakAt(1));
    expect(stock(room.host.economy)[0]).toBe(START);
  });

  it('charges and refunds the material of the piece, each its own', () => {
    const { room } = arena({}, { stock: 10 });
    room.host.sendCommand(place(0, COMPOSITE));
    room.host.sendCommand(place(1, packState(SHAPE.slab, MATERIAL.composite)));
    room.host.sendCommand(place(2, SCRAP));
    expect(stock(room.host.economy)).toEqual([9, 8, 10, 10]);
    room.host.sendCommand(breakAt(0));
    expect(stock(room.host.economy)).toEqual([9, 9, 10, 10]);
  });

  it('refuses a block the pool cannot pay for, in words that name what is short, and takes nothing', () => {
    const { room, hostWorld } = arena({}, { stock: 0 });
    const seen = reasons(room.host);
    const before = energy(room);
    room.host.sendCommand(place(0));
    room.host.sendCommand(place(1, COMPOSITE));
    expect(seen).toEqual(['not enough Scrap', 'not enough Reinforced Composite']);
    expect(hostWorld.cells.size).toBe(0);
    expect(stock(room.host.economy)).toEqual([0, 0, 0, 0]);
    // A refused block costs the player nothing, and the run does not count it.
    expect(energy(room)).toBe(before);
    expect(placed(room)).toBe(0);
  });

  it('runs the pool down to nothing and then refuses', () => {
    const { room, hostWorld } = arena({}, { stock: 3 });
    const seen = reasons(room.host);
    for (let i = 0; i < 5; i++) room.host.sendCommand(place(i));
    expect(hostWorld.cells.size).toBe(3);
    expect(seen).toEqual(['not enough Scrap', 'not enough Scrap']);
    expect(stock(room.host.economy)[0]).toBe(0);
    // Breaking one gives the crew the means for one more.
    room.host.sendCommand(breakAt(0));
    room.host.sendCommand(place(4));
    expect(hostWorld.cells.size).toBe(3);
    expect(seen).toHaveLength(2);
  });

  it('gives back no more than the pool holds, so breaking cannot pass its ceiling', () => {
    const { room } = arena({}, { stock: POOL.cap });
    room.host.sendCommand(place(0));
    expect(stock(room.host.economy)[0]).toBe(POOL.cap - 1);
    economyPool(room).set(MATERIAL.scrap, POOL.cap);
    room.host.sendCommand(breakAt(0));
    expect(stock(room.host.economy)[0]).toBe(POOL.cap);
  });

  it('asks the world first: a block the world refuses is not paid for', () => {
    const { room, hostWorld } = arena();
    const seen = reasons(room.host);
    room.host.sendCommand(place(0));
    room.host.sendCommand(place(0));
    expect(seen).toEqual(['occupied']);
    expect(hostWorld.cells.size).toBe(1);
    expect(stock(room.host.economy)[0]).toBe(START - 1);
  });

  it('charges nothing in a run with no ground under it, where there is no pool', () => {
    const room = makeRoom({ survival: true });
    room.host.sendCommand({ type: 'place', x: 3, y: 0, z: 3, state: SCRAP });
    room.host.sendCommand({ type: 'place', x: 3, y: 0, z: 4, state: COMPOSITE });
    expect(room.hostWorld.cells.size).toBe(2);
    expect(stock(room.host.economy)).toEqual([0, 0, 0, 0]);
  });
});

function economyPool(room: Room) {
  return sim(room).economy!.pool;
}

describe('guests placing and breaking blocks', () => {
  async function crew() {
    const built = arena({}, { stock: 4 });
    const code = await built.room.openRoom();
    const ada = await built.room.join(code, 'Ada');
    const bob = await built.room.join(code, 'Bob');
    ada.session.publishState(at(SPOT.x - 2, SPOT.y, SPOT.z));
    bob.session.publishState(at(SPOT.x - 2, SPOT.y, SPOT.z + 3));
    await built.room.settle(100);
    return { ...built, code, ada, bob };
  }

  it('are paying out of the one pool the whole crew shares, and every screen sees it go down', async () => {
    const { room, ada, bob, hostWorld } = await crew();
    ada.session.sendCommand(place(0));
    bob.session.sendCommand(place(1));
    room.host.sendCommand(place(2));
    await room.settle(600);
    expect(hostWorld.cells.size).toBe(3);
    for (const view of [room.host.economy, ada.session.economy, bob.session.economy]) {
      expect(stock(view)[0]).toBe(1);
    }
  });

  it('are told why a block was refused when the pool cannot pay for it', async () => {
    const { room, ada, bob, hostWorld } = await crew();
    const adaSeen = reasons(ada.session);
    const bobSeen = reasons(bob.session);
    for (let i = 0; i < 4; i++) room.host.sendCommand(place(i));
    await room.settle(600);
    expect(stock(ada.session.economy)[0]).toBe(0);

    ada.session.sendCommand(place(5));
    await room.settle(300);
    expect(adaSeen).toEqual(['not enough Scrap']);
    expect(bobSeen).toEqual([]);
    expect(hostWorld.cells.size).toBe(4);

    // A block Bob breaks pays for the next block of Ada's.
    bob.session.sendCommand(breakAt(0));
    await room.settle(600);
    expect(stock(ada.session.economy)[0]).toBe(1);
    ada.session.sendCommand(place(5));
    await room.settle(300);
    expect(adaSeen).toEqual(['not enough Scrap']);
    expect(hostWorld.cells.size).toBe(4);
    expect(stock(room.host.economy)[0]).toBe(0);
  });

  it('are told of a pool that changed once for the blocks of one moment', async () => {
    const { room, code, ada, bob } = await crew();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(600);
    const before = framesOf(raw, 'ec').length;

    ada.session.sendCommand(place(0));
    bob.session.sendCommand(place(1));
    await room.settle(600);

    const words = framesOf(raw, 'ec').slice(before);
    expect(words).toHaveLength(1);
    expect(words[0]?.pl).toEqual([2, 4, 4, 4]);
  });
});

describe('a heap keeps its ground clear', () => {
  it('refuses a block built on the heap, and one beside it that is still in its room, at no cost', () => {
    const { room, hostWorld } = arena();
    const heap = openHeap(room);
    const cell = cellOf(heap);
    const seen = reasons(room.host);
    room.host.sendCommand({ type: 'place', ...cell, state: SCRAP });
    room.host.sendCommand({ type: 'place', ...cell, x: cell.x + 1, y: cell.y + 1, state: SCRAP });
    expect(seen).toEqual([DEBRIS_IN_THE_WAY, DEBRIS_IN_THE_WAY]);
    expect(hostWorld.cells.size).toBe(0);
    expect(stock(room.host.economy)[0]).toBe(START);
    expect(placed(room)).toBe(0);
  });

  it('allows a block well clear of the heap', () => {
    const { room, hostWorld } = arena();
    const heap = openHeap(room);
    room.host.sendCommand({
      type: 'place',
      x: Math.floor(heap.x) + 6,
      y: Math.floor(heap.y),
      z: Math.floor(heap.z),
      state: SCRAP,
    });
    expect(hostWorld.cells.size).toBe(1);
  });

  it('frees the ground once the heap has been stripped bare', async () => {
    const { room, hostWorld } = arena();
    const heap = openHeap(room);
    const cell = cellOf(heap);
    const seen = reasons(room.host);
    for (let strip = 0; strip < heap.harvests; strip++) {
      room.host.sendCommand({ type: 'harvest', ...cell });
      await room.settle(600);
    }
    expect(room.host.economy.debris.leftOf(heap.index)).toBe(0);
    room.host.sendCommand({ type: 'place', ...cell, state: SCRAP });
    expect(seen).toEqual([]);
    expect(hostWorld.cells.size).toBe(1);
  });

  it("refuses a guest's block on a heap in the same words", async () => {
    // The guest comes in beside the heap, as a player who walked up to it would be.
    let seat = { x: 0, y: FLOOR, z: 0 };
    const { room } = arena({ spawnFor: () => seat });
    const heap = openHeap(room);
    seat = { x: heap.x - 3, y: heap.y, z: heap.z };
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    ada.session.publishState(at(seat.x, seat.y, seat.z));
    await room.settle(100);
    const seen = reasons(ada.session);
    ada.session.sendCommand({ type: 'place', ...cellOf(heap), state: SCRAP });
    await room.settle(300);
    expect(seen).toEqual([DEBRIS_IN_THE_WAY]);
    expect(room.hostWorld.cells.size).toBe(0);
  });
});

describe('a dawn over ground the crew has built on', () => {
  /** A run a few seconds short of the first dawn, with plenty to build with. */
  function nearDawn() {
    return arena({}, { startAt: CYCLE_SECONDS - 3, stock: 100 });
  }

  /** The first heap the first dawn uncovers. */
  function buried(room: Room): DebrisNode {
    const node = sim(room).economy!.nodes.find((n) => n.from === 1);
    if (!node) throw new Error('the first dawn uncovers no heap');
    return node;
  }

  it('lets a heap wait while a block stands where it would come up, and shows it on every screen when the ground is free', async () => {
    const { room, hostWorld } = nearDawn();
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    const heap = buried(room);
    const cell = cellOf(heap);
    // Nothing keeps the ground clear of a heap that is not there yet, so the crew can build on it.
    room.host.sendCommand({ type: 'place', ...cell, state: SCRAP });
    expect(hostWorld.cells.size).toBe(1);

    await room.settle(4000);
    expect(room.host.economy.debris.leftOf(heap.index)).toBe(0);
    expect(ada.session.economy.debris.leftOf(heap.index)).toBe(0);
    // The others of that dawn came up, on every screen.
    const others = sim(room).economy!.nodes.filter((n) => n.from === 1 && n.index !== heap.index);
    expect(others.length).toBeGreaterThan(0);
    for (const node of others) {
      expect(room.host.economy.debris.leftOf(node.index)).toBe(node.harvests);
      expect(ada.session.economy.debris.leftOf(node.index)).toBe(node.harvests);
    }

    // The block comes down; the next dawn brings the heap up.
    room.host.sendCommand({ type: 'break', ...cell });
    sim(room).warp(CYCLE_SECONDS);
    await room.settle(600);
    expect(room.host.economy.debris.leftOf(heap.index)).toBe(heap.harvests);
    expect(ada.session.economy.debris.leftOf(heap.index)).toBe(heap.harvests);
  });

  it('keeps a heap down at every dawn for as long as the block stands', async () => {
    const { room } = nearDawn();
    room.host.setLocalActive(true);
    const heap = buried(room);
    room.host.sendCommand({ type: 'place', ...cellOf(heap), state: SCRAP });
    await room.settle(4000);
    sim(room).warp(CYCLE_SECONDS);
    await room.settle(600);
    sim(room).warp(CYCLE_SECONDS);
    await room.settle(600);
    expect(room.host.economy.debris.leftOf(heap.index)).toBe(0);
  });

  it('brings the heap up when a block stands near it but outside its room', async () => {
    const { room } = nearDawn();
    room.host.setLocalActive(true);
    const heap = buried(room);
    room.host.sendCommand({
      type: 'place',
      x: Math.floor(heap.x) + 6,
      y: Math.floor(heap.y),
      z: Math.floor(heap.z),
      state: SCRAP,
    });
    await room.settle(4000);
    expect(room.host.economy.debris.leftOf(heap.index)).toBe(heap.harvests);
  });
});

describe('the Energy a block costs', () => {
  it('is spent on a block that is placed, and not on one the pool refused', () => {
    const { room } = arena({}, { stock: 8 });
    for (let i = 0; i < 8; i++) room.host.sendCommand(place(i));
    expect(energy(room)).toBe(VITALS.maxEnergy - 8 * VITALS.energy.perEdit);
    expect(placed(room)).toBe(8);
    // The pool is empty now: three more are refused, and cost nothing.
    stock(room.host.economy);
    economyPool(room).set(MATERIAL.scrap, 0);
    for (let i = 8; i < 11; i++) room.host.sendCommand(place(i));
    expect(energy(room)).toBe(VITALS.maxEnergy - 8 * VITALS.energy.perEdit);
    expect(placed(room)).toBe(8);
  });
});
