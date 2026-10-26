import { describe, expect, it } from 'vitest';
import { MATERIAL, MODULE, SHAPE, moduleShape, packState } from '../../src/shared/blocks';
import { CYCLE_SECONDS, DAY_SECONDS } from '../../src/shared/daycycle';
import { createEconomyReading, type EconomyView } from '../../src/shared/economy';
import type { HostFrame } from '../../src/shared/protocol';
import { RESEARCH } from '../../src/systems/economy/balance';
import { moduleStands } from '../../src/systems/economy/build-rules';
import { RESEARCH_STEPS } from '../../src/systems/economy/research';
import { FLOOR, arena, sim, type Room } from './helpers/arena';
import type { TestWorld } from './helpers/net';
import { at, helloText, rawGuest } from './helpers/net';

const CLEAN = RESEARCH.perNight + RESEARCH.cleanNight;
const COMPOSITE = packState(SHAPE.cube, MATERIAL.composite);
/** The cell at the Core's side where the tests build, clear of every heap. */
const SPOT = { x: 8, y: FLOOR, z: -3 };

function reading(view: EconomyView) {
  return view.read(createEconomyReading());
}

function framesOf<K extends HostFrame['t']>(
  raw: Awaited<ReturnType<typeof rawGuest>>,
  kind: K,
): Extract<HostFrame, { t: K }>[] {
  return raw.frames.filter((frame): frame is Extract<HostFrame, { t: K }> => frame.t === kind);
}

/** Plays on to the dawn that ends the first night, which the arena opens in. */
function toDawn(room: Room): void {
  sim(room).warp(CYCLE_SECONDS - DAY_SECONDS - 1);
}

describe('the research the host tells its guests', () => {
  it('shows a guest the points with the pool, and the tier they open, from the first moment', async () => {
    const { room } = arena({}, { research: 55 });
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    await room.settle(400);
    expect(reading(ada.session.economy)).toMatchObject({ research: 55, tier: 3 });
    expect(reading(room.host.economy)).toMatchObject({ research: 55, tier: 3 });
  });

  it('sends the points on the pool frame, to a guest that arrives late too', async () => {
    const { room } = arena({}, { research: 21 });
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(400);
    expect(framesOf(raw, 'ec')[0]).toMatchObject({ rp: 21 });
  });

  it('tells a guest again when a dawn adds to the points, with nothing else in the pool changed', async () => {
    const { room } = arena({}, { stock: 5 });
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(600);
    expect(reading(ada.session.economy).research).toBe(0);
    const before = framesOf(raw, 'ec').length;

    toDawn(room);
    await room.settle(600);

    const words = framesOf(raw, 'ec').slice(before);
    expect(words).toHaveLength(1);
    expect(words[0]).toMatchObject({ rp: CLEAN });
    expect(reading(ada.session.economy).research).toBe(CLEAN);
    expect(reading(room.host.economy).research).toBe(CLEAN);
  });

  it('opens a tier on a guest’s screen at the dawn that reaches its row', async () => {
    const { room } = arena({}, { research: RESEARCH_STEPS[0]!.points - CLEAN });
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    await room.settle(400);
    expect(reading(ada.session.economy).tier).toBe(1);
    toDawn(room);
    await room.settle(600);
    expect(reading(ada.session.economy)).toMatchObject({
      research: RESEARCH_STEPS[0]!.points,
      tier: 2,
    });
  });

  it('says nothing more while the points and the pool stay as they were', async () => {
    const { room } = arena({}, {});
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(600);
    const before = framesOf(raw, 'ec').length;
    await room.settle(2000);
    expect(framesOf(raw, 'ec')).toHaveLength(before);
  });
});

describe('a guest building with a material the crew has not researched', () => {
  async function crew() {
    const built = arena({}, { stock: 10 });
    const code = await built.room.openRoom();
    const ada = await built.room.join(code, 'Ada');
    ada.session.publishState(at(SPOT.x - 2, SPOT.y, SPOT.z));
    await built.room.settle(100);
    return { ...built, ada };
  }

  it('is told the material needs research, and nothing is built or paid', async () => {
    const { room, hostWorld, ada } = await crew();
    const seen: string[] = [];
    ada.session.onRejected((rejection) => seen.push(rejection.reason));
    ada.session.sendCommand({ type: 'place', x: SPOT.x, y: SPOT.y, z: SPOT.z, state: COMPOSITE });
    await room.settle(300);
    expect(seen).toEqual(['Reinforced Composite needs research']);
    expect(hostWorld.cells.size).toBe(0);
    expect(reading(room.host.economy).stock).toEqual([10, 10, 10, 10]);
  });

  it('builds with it once the research is done', async () => {
    const { room, hostWorld, ada } = await crew();
    sim(room).economy!.research.set(RESEARCH_STEPS[0]!.points);
    await room.settle(400);
    expect(reading(ada.session.economy).tier).toBe(2);
    ada.session.sendCommand({ type: 'place', x: SPOT.x, y: SPOT.y, z: SPOT.z, state: COMPOSITE });
    await room.settle(300);
    expect(hostWorld.cells.size).toBe(1);
    expect(reading(room.host.economy).stock).toEqual([10, 9, 10, 10]);
  });
});

describe('a Research Terminal placed in the room', () => {
  const TERMINAL = packState(moduleShape(MODULE.terminal, 0), 1);
  const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
  const UNREAD = RESEARCH_STEPS[0]!.points + 2;

  /** A crew with Scrap for a Terminal and points earned that nothing has read, in a world that knows what stands in it. */
  async function crew(stock = 50) {
    const held: { world?: TestWorld } = {};
    const built = arena(
      {},
      { stock, standing: (module) => !!held.world && moduleStands(held.world, module) },
    );
    held.world = built.hostWorld;
    const code = await built.room.openRoom();
    const ada = await built.room.join(code, 'Ada');
    ada.session.publishState(at(SPOT.x - 2, SPOT.y, SPOT.z));
    await built.room.settle(100);
    sim(built.room).economy!.research.set(UNREAD, false);
    return { ...built, ada };
  }
  const place = (ada: Awaited<ReturnType<typeof crew>>['ada'], state: number) =>
    ada.session.sendCommand({ type: 'place', x: SPOT.x, y: SPOT.y, z: SPOT.z, state });

  it('reads the points the crew has earned the moment it stands, and opens what they reach', async () => {
    const { room, hostWorld, ada } = await crew();
    expect(reading(room.host.economy)).toMatchObject({ research: UNREAD, claimed: 0, tier: 1 });
    place(ada, TERMINAL);
    await room.settle(300);
    expect(hostWorld.cells.size).toBe(1);
    expect(reading(room.host.economy)).toMatchObject({
      research: UNREAD,
      claimed: UNREAD,
      tier: 2,
    });
  });

  it('reads nothing for a Terminal the host refuses, such as one the pool cannot pay for', async () => {
    const { room, hostWorld, ada } = await crew(39);
    const seen: string[] = [];
    ada.session.onRejected((rejection) => seen.push(rejection.reason));
    place(ada, TERMINAL);
    await room.settle(300);
    expect(seen).toEqual(['not enough Scrap']);
    expect(hostWorld.cells.size).toBe(0);
    expect(reading(room.host.economy)).toMatchObject({ claimed: 0, tier: 1 });
  });

  it('reads nothing for a block', async () => {
    const { room, hostWorld, ada } = await crew();
    place(ada, SCRAP);
    await room.settle(300);
    expect(hostWorld.cells.size).toBe(1);
    expect(reading(room.host.economy)).toMatchObject({ research: UNREAD, claimed: 0, tier: 1 });
  });

  it('reads the next dawn’s points while it stands, and keeps what it read when it is broken', async () => {
    const { room, ada } = await crew();
    place(ada, TERMINAL);
    await room.settle(300);
    toDawn(room);
    expect(reading(room.host.economy)).toMatchObject({
      research: UNREAD + CLEAN,
      claimed: UNREAD + CLEAN,
    });

    ada.session.sendCommand({ type: 'break', x: SPOT.x, y: SPOT.y, z: SPOT.z });
    await room.settle(300);
    sim(room).warp(CYCLE_SECONDS);
    // The Terminal is gone: the second night's points are earned and nobody has read them.
    expect(reading(room.host.economy)).toMatchObject({
      research: UNREAD + 2 * CLEAN,
      claimed: UNREAD + CLEAN,
      tier: 2,
    });
  });
});
