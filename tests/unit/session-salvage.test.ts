import { describe, expect, it } from 'vitest';
import { REFUSAL } from '../../src/net/host-session';
import { MATERIAL } from '../../src/shared/blocks';
import { CYCLE_SECONDS } from '../../src/shared/daycycle';
import {
  createEconomyReading,
  type DebrisNode,
  type EconomyView,
  type HarvestEvent,
} from '../../src/shared/economy';
import { HOST_PLAYER_ID, type HostFrame } from '../../src/shared/protocol';
import { createReading, type SurvivalView } from '../../src/shared/survival-state';
import { DEBRIS, POOL } from '../../src/systems/economy/balance';
import { stripYield } from '../../src/systems/economy/economy';
import { debrisField } from '../../src/systems/economy/field';
import { SURVIVAL, VITALS } from '../../src/systems/survival/balance';
import type { SurvivalOptions } from '../../src/systems/survival/sim';
import { flatWorld } from './helpers/nav-world';
import { at, helloText, makeRoom, rawGuest, type RoomOptions } from './helpers/net';

type Room = ReturnType<typeof makeRoom>;

const SEED = 7;
const START = POOL.start[MATERIAL.scrap] as number;
const COOLDOWN_MS = DEBRIS.cooldown * 1000;

/** The heaps a run of this seed on flat ground has: the same list the host's simulation draws. */
const FIELD = (() => {
  const flat = flatWorld();
  return debrisField(SEED, flat.world, flat.core);
})();
const OPEN = FIELD.filter((node) => node.from === 0);
/** The heap the host and the first guest stand beside. */
const HEAP = OPEN[0] as DebrisNode;
/** The open heap farthest from `HEAP`: the second guest stands beside it, out of reach of the first. */
const FAR = OPEN.reduce((far, node) => (apart(node, HEAP) > apart(far, HEAP) ? node : far), HEAP);
/** The first heap a dawn uncovers. */
const BURIED = FIELD.find((node) => node.from === 1) as DebrisNode;

function apart(a: DebrisNode, b: DebrisNode): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Where each seat in the room stands: the host and the first guest beside `HEAP`, the others beside `FAR`. */
function seatFor(slot: number): { x: number; y: number; z: number } {
  const heap = slot < 2 ? HEAP : FAR;
  return { x: heap.x + (slot % 2 === 0 ? -1.5 : 1.5), y: heap.y, z: heap.z };
}

/** A sample of a player standing in their seat. */
function seat(slot: number) {
  const spot = seatFor(slot);
  return at(spot.x, spot.y, spot.z);
}

/** The options of a run on flat ground with the Core on it, in daylight and with no machines. */
function runOptions(extra: SurvivalOptions = {}): SurvivalOptions {
  const flat = flatWorld();
  return { nav: flat.world, core: flat.core, seed: SEED, waves: false, ...extra };
}

/** A room whose host plays a run with heaps of debris lying on the ground. */
function salvageRoom(extra: SurvivalOptions = {}, room: RoomOptions = {}): Room {
  return makeRoom({ survival: runOptions(extra), spawnFor: seatFor, ...room });
}

function economyOf(room: Room) {
  const economy = room.host.survivalSim?.economy;
  if (!economy) throw new Error('the run has no economy');
  return economy;
}

/** The command that strips a heap: it names the cell the heap's middle is in. */
function strip(heap: DebrisNode) {
  return {
    type: 'harvest' as const,
    x: Math.floor(heap.x),
    y: Math.floor(heap.y),
    z: Math.floor(heap.z),
  };
}

function stock(view: EconomyView): number[] {
  return [...view.read(createEconomyReading()).stock];
}

function listen(view: EconomyView): HarvestEvent[] {
  const seen: HarvestEvent[] = [];
  view.debris.onHarvest((event) => seen.push(event));
  return seen;
}

function gathered(view: SurvivalView): number {
  return view.read(createReading()).gathered;
}

function framesOf<K extends HostFrame['t']>(
  raw: Awaited<ReturnType<typeof rawGuest>>,
  kind: K,
): Extract<HostFrame, { t: K }>[] {
  return raw.frames.filter((frame): frame is Extract<HostFrame, { t: K }> => frame.t === kind);
}

describe('the field the tests stand in', () => {
  it('has open heaps well apart and a heap for the first dawn to uncover', () => {
    expect(OPEN.length).toBeGreaterThan(8);
    expect(apart(FAR, HEAP)).toBeGreaterThan(20);
    expect(BURIED.from).toBe(1);
  });
});

describe('the host stripping a heap', () => {
  async function standing() {
    const room = salvageRoom();
    await room.openRoom();
    room.host.publishState(seat(0));
    return room;
  }

  it('puts the strip into the pool and tells its own screen what it got', async () => {
    const room = await standing();
    const seen = listen(room.host.economy);
    expect(stock(room.host.economy)).toEqual([START, 0, 0, 0]);

    room.host.sendCommand(strip(HEAP));

    const worth = stripYield(SEED, HEAP.index, 0);
    expect(stock(room.host.economy)).toEqual([START + worth, 0, 0, 0]);
    expect(room.host.economy.debris.leftOf(HEAP.index)).toBe(HEAP.harvests - 1);
    expect(seen).toEqual([
      {
        by: HOST_PLAYER_ID,
        node: HEAP.index,
        material: MATERIAL.scrap,
        gained: worth,
        left: HEAP.harvests - 1,
        full: false,
      },
    ]);
    expect(gathered(room.host.survival)).toBe(worth);
  });

  it('strips a heap bare in as many strips as it had, no faster than the cooldown allows', async () => {
    const room = await standing();
    const reasons: string[] = [];
    room.host.onRejected((rejection) => reasons.push(rejection.reason));
    let total = 0;
    for (let strips = 0; strips < HEAP.harvests; strips++) {
      room.host.sendCommand(strip(HEAP));
      total += stripYield(SEED, HEAP.index, strips);
      // The same instant again: too soon, or (after the last strip) nothing is left.
      room.host.sendCommand(strip(HEAP));
      await room.settle(COOLDOWN_MS + 50);
    }
    expect(reasons).toEqual([
      ...Array<string>(HEAP.harvests - 1).fill(REFUSAL.rate),
      REFUSAL.depleted,
    ]);
    expect(room.host.economy.debris.leftOf(HEAP.index)).toBe(0);
    expect(stock(room.host.economy)[0]).toBe(START + total);

    room.host.sendCommand(strip(HEAP));
    expect(reasons.at(-1)).toBe(REFUSAL.depleted);
    expect(stock(room.host.economy)[0]).toBe(START + total);
  });

  it('is told there is nothing in a cell that holds no heap', async () => {
    const room = await standing();
    const reasons: string[] = [];
    room.host.onRejected((rejection) => reasons.push(rejection.reason));
    room.host.sendCommand({ ...strip(HEAP), x: Math.floor(HEAP.x) + 1 });
    expect(reasons).toEqual([REFUSAL.nothing]);
    expect(stock(room.host.economy)[0]).toBe(START);
  });

  it('cannot reach a heap across the valley, and a heap the dawn has not uncovered is bare', async () => {
    const room = await standing();
    const reasons: string[] = [];
    room.host.onRejected((rejection) => reasons.push(rejection.reason));
    room.host.publishState(at(HEAP.x - 30, HEAP.y, HEAP.z));
    room.host.sendCommand(strip(HEAP));
    expect(reasons).toEqual([REFUSAL.reach]);

    room.host.publishState(at(BURIED.x - 1.5, BURIED.y, BURIED.z));
    room.host.sendCommand(strip(BURIED));
    expect(reasons).toEqual([REFUSAL.reach, REFUSAL.depleted]);
    expect(stock(room.host.economy)[0]).toBe(START);
  });

  it('takes what the pool has room for, uses the strip up, and is refused when there is none', async () => {
    const room = await standing();
    const reasons: string[] = [];
    room.host.onRejected((rejection) => reasons.push(rejection.reason));
    const seen = listen(room.host.economy);
    economyOf(room).pool.set(MATERIAL.scrap, POOL.cap - 3);

    room.host.sendCommand(strip(HEAP));
    expect(stock(room.host.economy)[0]).toBe(POOL.cap);
    expect(seen[0]).toMatchObject({ gained: 3, full: true, left: HEAP.harvests - 1 });

    await room.settle(COOLDOWN_MS + 50);
    room.host.sendCommand(strip(HEAP));
    expect(reasons).toEqual([REFUSAL.poolFull]);
    // Refused for room: the strip was not used up.
    expect(room.host.economy.debris.leftOf(HEAP.index)).toBe(HEAP.harvests - 1);
    expect(gathered(room.host.survival)).toBe(3);
  });

  it('cannot strip a heap while down, or once the run is over', async () => {
    const room = await standing();
    const reasons: string[] = [];
    room.host.onRejected((rejection) => reasons.push(rejection.reason));
    room.host.survivalSim?.hurtPlayer(HOST_PLAYER_ID, VITALS.maxHealth * 10);
    room.host.sendCommand(strip(HEAP));
    expect(reasons).toEqual([REFUSAL.down]);

    const lost = await standing();
    const again: string[] = [];
    lost.host.onRejected((rejection) => again.push(rejection.reason));
    lost.host.survivalSim?.hurtCore(SURVIVAL.core.maxHealth);
    lost.host.sendCommand(strip(HEAP));
    expect(again).toEqual([REFUSAL.over]);
    expect(stock(lost.host.economy)[0]).toBe(START);
  });

  it('has no heaps in a run with no ground under it', async () => {
    const room = makeRoom({ survival: true });
    await room.openRoom();
    const reasons: string[] = [];
    room.host.onRejected((rejection) => reasons.push(rejection.reason));
    room.host.sendCommand({ type: 'harvest', x: 5, y: 0, z: 5 });
    expect(reasons).toEqual([REFUSAL.nothing]);
    expect(room.host.economy.debris.nodes).toEqual([]);
    expect(stock(room.host.economy)).toEqual([0, 0, 0, 0]);
  });
});

describe('guests stripping heaps', () => {
  /** The host, Ada beside `HEAP` and Bob beside `FAR`, all heard from. */
  async function crew() {
    const room = salvageRoom();
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    const bob = await room.join(code, 'Bob');
    ada.session.publishState(seat(1));
    bob.session.publishState(seat(2));
    await room.settle(100);
    return { room, ada, bob };
  }

  it('fill the one pool the whole crew shares, and every screen sees the heaps shrink', async () => {
    const { room, ada, bob } = await crew();
    const hostSeen = listen(room.host.economy);
    const adaSeen = listen(ada.session.economy);
    const bobSeen = listen(bob.session.economy);

    ada.session.sendCommand(strip(HEAP));
    bob.session.sendCommand(strip(FAR));
    await room.settle(COOLDOWN_MS);

    const adaWorth = stripYield(SEED, HEAP.index, 0);
    const bobWorth = stripYield(SEED, FAR.index, 0);
    const adaEvent = {
      by: ada.session.localId,
      node: HEAP.index,
      material: MATERIAL.scrap,
      gained: adaWorth,
      left: HEAP.harvests - 1,
      full: false,
    };
    const bobEvent = {
      by: bob.session.localId,
      node: FAR.index,
      material: MATERIAL.scrap,
      gained: bobWorth,
      left: FAR.harvests - 1,
      full: false,
    };
    for (const seen of [hostSeen, adaSeen, bobSeen]) {
      expect(seen).toHaveLength(2);
      expect(seen).toContainEqual(adaEvent);
      expect(seen).toContainEqual(bobEvent);
    }
    for (const view of [room.host.economy, ada.session.economy, bob.session.economy]) {
      expect(stock(view)).toEqual([START + adaWorth + bobWorth, 0, 0, 0]);
      expect(view.debris.leftOf(HEAP.index)).toBe(HEAP.harvests - 1);
      expect(view.debris.leftOf(FAR.index)).toBe(FAR.harvests - 1);
    }
    // The results tile reaches every screen with the next word on the run.
    for (const view of [room.host.survival, ada.session.survival, bob.session.survival]) {
      expect(gathered(view)).toBe(adaWorth + bobWorth);
    }
  });

  it('are refused with the reason to show, and nothing changes for anyone', async () => {
    const { room, ada, bob } = await crew();
    const refusals = { ada: [] as string[], bob: [] as string[] };
    ada.session.onRejected((rejection) => refusals.ada.push(rejection.reason));
    bob.session.onRejected((rejection) => refusals.bob.push(rejection.reason));

    // Ada names a cell with no heap in it; Bob, beside the far heap, reaches for the first.
    ada.session.sendCommand({ ...strip(HEAP), z: Math.floor(HEAP.z) + 2 });
    bob.session.sendCommand(strip(HEAP));
    await room.settle(COOLDOWN_MS);

    expect(refusals.ada).toEqual([REFUSAL.nothing]);
    expect(refusals.bob).toEqual([REFUSAL.reach]);
    expect(stock(room.host.economy)[0]).toBe(START);
    expect(stock(bob.session.economy)[0]).toBe(START);
  });

  it('are held to the cooldown one by one, so two of them can strip in the same instant', async () => {
    const { room, ada, bob } = await crew();
    const refusals: string[] = [];
    ada.session.onRejected((rejection) => refusals.push(rejection.reason));
    bob.session.onRejected((rejection) => refusals.push(rejection.reason));

    ada.session.sendCommand(strip(HEAP));
    bob.session.sendCommand(strip(FAR));
    ada.session.sendCommand(strip(HEAP));
    await room.settle(100);
    expect(refusals).toEqual([REFUSAL.rate]);
    expect(room.host.economy.debris.leftOf(HEAP.index)).toBe(HEAP.harvests - 1);
    expect(room.host.economy.debris.leftOf(FAR.index)).toBe(FAR.harvests - 1);

    await room.settle(COOLDOWN_MS);
    ada.session.sendCommand(strip(HEAP));
    await room.settle(100);
    expect(room.host.economy.debris.leftOf(HEAP.index)).toBe(HEAP.harvests - 2);
    expect(refusals).toEqual([REFUSAL.rate]);
  });

  it('are told the pool is full when the crew has all it can hold', async () => {
    const { room, ada } = await crew();
    const refusals: string[] = [];
    ada.session.onRejected((rejection) => refusals.push(rejection.reason));
    economyOf(room).pool.set(MATERIAL.scrap, POOL.cap);

    ada.session.sendCommand(strip(HEAP));
    await room.settle(400);

    expect(refusals).toEqual([REFUSAL.poolFull]);
    expect(stock(ada.session.economy)[0]).toBe(POOL.cap);
    expect(ada.session.economy.debris.leftOf(HEAP.index)).toBe(HEAP.harvests);
  });
});

describe('what the host tells a guest about the economy', () => {
  it('opens with the pool and the whole list of heaps, as they stand, for a guest who arrives late', async () => {
    const room = salvageRoom();
    const code = await room.openRoom();
    const first = await room.join(code, 'Ada');
    first.session.publishState(seat(1));
    await room.settle(100);
    first.session.sendCommand(strip(HEAP));
    await room.settle(COOLDOWN_MS);

    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(400);

    const pool = framesOf(raw, 'ec');
    const list = framesOf(raw, 'nl');
    expect(pool[0]).toEqual({
      t: 'ec',
      pl: [START + stripYield(SEED, HEAP.index, 0), 0, 0, 0],
      cap: POOL.cap,
      rp: 0,
      cl: 0,
    });
    expect(list[0]?.n).toHaveLength(FIELD.length);
    expect(list[0]?.n[HEAP.index]).toEqual([
      HEAP.x,
      HEAP.y,
      HEAP.z,
      HEAP.yaw,
      HEAP.scale,
      HEAP.harvests,
      HEAP.grade,
      HEAP.from,
      HEAP.harvests - 1,
    ]);
    // A heap a dawn will uncover is on the list too, with nothing to strip yet.
    expect(list[0]?.n[BURIED.index]?.[8]).toBe(0);
    expect(list[0]?.n[BURIED.index]?.[7]).toBe(1);
  });

  it('brings a late guest to the same economy as the others, heap by heap', async () => {
    const room = salvageRoom();
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    ada.session.publishState(seat(1));
    await room.settle(100);
    ada.session.sendCommand(strip(HEAP));
    await room.settle(COOLDOWN_MS);
    ada.session.sendCommand(strip(HEAP));
    await room.settle(COOLDOWN_MS);

    const late = await room.join(code, 'Late');
    await room.settle(400);

    const hostNodes = room.host.economy.debris.nodes;
    expect(hostNodes).toHaveLength(FIELD.length);
    expect(late.session.economy.debris.nodes).toEqual(hostNodes);
    for (const node of hostNodes) {
      expect(late.session.economy.debris.leftOf(node.index)).toBe(
        room.host.economy.debris.leftOf(node.index),
      );
    }
    expect(late.session.economy.debris.leftOf(HEAP.index)).toBe(HEAP.harvests - 2);
    expect(stock(late.session.economy)).toEqual(stock(room.host.economy));
    expect(late.session.economy.read(createEconomyReading()).cap).toBe(POOL.cap);
  });

  it('says each strip once, to everyone, with who did it and what the heap has left', async () => {
    const room = salvageRoom();
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(400);
    ada.session.publishState(seat(1));
    await room.settle(100);

    ada.session.sendCommand(strip(HEAP));
    await room.settle(100);

    expect(framesOf(raw, 'hd')).toEqual([
      {
        t: 'hd',
        p: ada.session.localId,
        i: HEAP.index,
        m: MATERIAL.scrap,
        g: stripYield(SEED, HEAP.index, 0),
        l: HEAP.harvests - 1,
        f: false,
      },
    ]);
  });

  it('sends the pool when it changes, once for strips in the same moment, and never when it has not', async () => {
    const room = salvageRoom();
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    const bob = await room.join(code, 'Bob');
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(600);
    ada.session.publishState(seat(1));
    bob.session.publishState(seat(2));
    await room.settle(100);
    const before = framesOf(raw, 'ec').length;

    // Quiet: the pool did not change, so nothing is sent.
    await room.settle(2000);
    expect(framesOf(raw, 'ec')).toHaveLength(before);

    // Two strips in the same moment are one word about the pool.
    ada.session.sendCommand(strip(HEAP));
    bob.session.sendCommand(strip(FAR));
    await room.settle(600);
    const words = framesOf(raw, 'ec').slice(before);
    expect(words).toHaveLength(1);
    expect(words[0]?.pl[0]).toBe(
      START + stripYield(SEED, HEAP.index, 0) + stripYield(SEED, FAR.index, 0),
    );
  });

  it('uncovers the heaps of a night at its dawn, on every screen', async () => {
    const room = salvageRoom({ startAt: CYCLE_SECONDS - 3 });
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    const seen = ada.session.economy.debris;
    expect(seen.leftOf(BURIED.index)).toBe(0);
    expect(room.host.economy.debris.leftOf(BURIED.index)).toBe(0);
    const version = seen.version;

    await room.settle(4000);

    expect(room.host.economy.debris.leftOf(BURIED.index)).toBe(BURIED.harvests);
    expect(seen.leftOf(BURIED.index)).toBe(BURIED.harvests);
    expect(seen.version).toBeGreaterThan(version);
    // The heaps of later nights are still under the ground.
    const later = FIELD.find((node) => node.from === 2);
    if (later) expect(seen.leftOf(later.index)).toBe(0);
  });

  it('starts over with a run: a fresh pool and every heap whole, on the host and on every guest', async () => {
    const options = runOptions();
    const room = makeRoom({
      survival: options,
      spawnFor: seatFor,
      restartable: { survival: options, nextSeed: () => 9001 },
    });
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    ada.session.publishState(seat(1));
    await room.settle(100);
    ada.session.sendCommand(strip(HEAP));
    await room.settle(COOLDOWN_MS + 600);
    expect(stock(ada.session.economy)[0]).toBeGreaterThan(START);
    expect(gathered(ada.session.survival)).toBeGreaterThan(0);

    room.host.survivalSim?.hurtCore(SURVIVAL.core.maxHealth);
    await room.settle(100);
    room.host.restartRun('retry');
    await room.settle(600);

    expect(room.host.run).toBe(2);
    for (const view of [room.host.economy, ada.session.economy]) {
      expect(stock(view)).toEqual([START, 0, 0, 0]);
      expect(view.debris.leftOf(HEAP.index)).toBe(HEAP.harvests);
      expect(view.debris.nodes).toHaveLength(FIELD.length);
    }
    expect(gathered(room.host.survival)).toBe(0);
    expect(gathered(ada.session.survival)).toBe(0);

    // The new run's heaps can be stripped again.
    ada.session.publishState(seat(1));
    await room.settle(200);
    ada.session.sendCommand(strip(HEAP));
    await room.settle(COOLDOWN_MS + 200);
    expect(stock(room.host.economy)[0]).toBe(START + stripYield(SEED, HEAP.index, 0));
    expect(stock(ada.session.economy)[0]).toBe(START + stripYield(SEED, HEAP.index, 0));
  });
});
