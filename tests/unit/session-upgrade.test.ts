import { describe, expect, it } from 'vitest';
import { REFUSAL } from '../../src/net/host-session';
import { MATERIAL, SHAPE, packState, stateMaterial, wedgeShape } from '../../src/shared/blocks';
import { createEconomyReading, type EconomyView } from '../../src/shared/economy';
import type { BlockCommand } from '../../src/shared/protocol';
import { createReading } from '../../src/shared/survival-state';
import { createVitalsReading } from '../../src/shared/vitals-state';
import {
  FULLY_UPGRADED,
  NOTHING_TO_UPGRADE,
  needsResearch,
  notEnough,
} from '../../src/systems/economy/build-rules';
import { RESEARCH_STEPS } from '../../src/systems/economy/research';
import { VITALS } from '../../src/systems/survival/balance';
import { FLOOR, arena, sim, type Room } from './helpers/arena';
import { at, makeRoom } from './helpers/net';

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const COMPOSITE = packState(SHAPE.cube, MATERIAL.composite);
const ALLOY = packState(SHAPE.cube, MATERIAL.alloy);
const ENERGY = packState(SHAPE.cube, MATERIAL.energy);

/** The cell at the Core's side where the tests build, clear of every heap. */
const SPOT = { x: 8, y: FLOOR, z: -3 };

function place(offset: number, state = SCRAP): BlockCommand {
  return { type: 'place', x: SPOT.x, y: SPOT.y, z: SPOT.z + offset, state };
}

function upgrade(offset: number, state: number): BlockCommand {
  return { type: 'upgrade', x: SPOT.x, y: SPOT.y, z: SPOT.z + offset, state };
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

function upgraded(room: Room): number {
  return sim(room).read(createReading()).upgraded;
}

/** A crew that has researched every tier (a Terminal has read 100 points) with plenty of every material. */
function rich() {
  return arena({}, { stock: 20, research: RESEARCH_STEPS[2]!.points });
}

describe('the host upgrading a piece in place', () => {
  it('swaps the material, takes the better piece’s price from the pool and gives nothing back for the old block', () => {
    const { room, hostWorld } = rich();
    room.host.sendCommand(place(0));
    expect(stock(room.host.economy)).toEqual([19, 20, 20, 20]);
    room.host.sendCommand(upgrade(0, COMPOSITE));
    expect(hostWorld.getBlock(SPOT.x, SPOT.y, SPOT.z)).toBe(COMPOSITE);
    expect(hostWorld.cells.size).toBe(1);
    expect(stock(room.host.economy)).toEqual([19, 19, 20, 20]);
  });

  it('climbs one tier a command, to Energy-Infused and no further', () => {
    const { room, hostWorld } = rich();
    const seen = reasons(room.host);
    room.host.sendCommand(place(0));
    const climbed = [stateMaterial(hostWorld.getBlock(SPOT.x, SPOT.y, SPOT.z))];
    for (const to of [COMPOSITE, ALLOY, ENERGY]) {
      room.host.sendCommand(upgrade(0, to));
      climbed.push(stateMaterial(hostWorld.getBlock(SPOT.x, SPOT.y, SPOT.z)));
    }
    expect(climbed).toEqual([MATERIAL.scrap, MATERIAL.composite, MATERIAL.alloy, MATERIAL.energy]);
    expect(seen).toEqual([]);
    expect(stock(room.host.economy)).toEqual([19, 19, 19, 19]);
    room.host.sendCommand(upgrade(0, packState(SHAPE.cube, 5)));
    expect(seen).toEqual([FULLY_UPGRADED]);
  });

  it('keeps the shape and the way the piece faces', () => {
    const { room, hostWorld } = rich();
    const shapes = [
      packState(wedgeShape(2, true), MATERIAL.scrap),
      packState(SHAPE.slab + 1, MATERIAL.scrap),
    ];
    shapes.forEach((state, offset) => room.host.sendCommand(place(offset, state)));
    shapes.forEach((state, offset) => {
      const better = state + (1 << 8);
      room.host.sendCommand(upgrade(offset, better));
      expect(hostWorld.getBlock(SPOT.x, SPOT.y, SPOT.z + offset)).toBe(better);
    });
  });

  it('tells the guests as it tells them of any block, and their worlds show the better piece', async () => {
    const { room } = rich();
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    const bob = await room.join(code, 'Bob');
    room.host.sendCommand(place(0));
    await room.settle(200);
    room.host.sendCommand(upgrade(0, COMPOSITE));
    await room.settle(200);
    for (const guest of [ada, bob]) {
      expect(guest.world().getBlock(SPOT.x, SPOT.y, SPOT.z)).toBe(COMPOSITE);
    }
  });

  it('is done for a guest who asks, and the guest’s pool and the host’s agree afterwards', async () => {
    const { room, hostWorld } = rich();
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    ada.session.publishState(at(SPOT.x - 2, SPOT.y, SPOT.z));
    await room.settle(100);
    ada.session.sendCommand(place(0));
    await room.settle(200);
    ada.session.sendCommand(upgrade(0, COMPOSITE));
    await room.settle(300);
    expect(hostWorld.getBlock(SPOT.x, SPOT.y, SPOT.z)).toBe(COMPOSITE);
    expect(stock(room.host.economy)).toEqual([19, 19, 20, 20]);
    expect(stock(ada.session.economy)).toEqual([19, 19, 20, 20]);
  });

  it('counts it for the results screen and for the guests, once for each upgrade', async () => {
    const { room } = rich();
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    room.host.sendCommand(place(0));
    room.host.sendCommand(place(1));
    expect(upgraded(room)).toBe(0);
    room.host.sendCommand(upgrade(0, COMPOSITE));
    room.host.sendCommand(upgrade(0, ALLOY));
    room.host.sendCommand(upgrade(1, COMPOSITE));
    expect(upgraded(room)).toBe(3);
    await room.settle(700);
    expect(ada.session.survival.read(createReading()).upgraded).toBe(3);
    // It is not a block placed.
    expect(sim(room).read(createReading()).placed).toBe(2);
  });

  it('costs the player the Energy an edit does', () => {
    const { room } = rich();
    for (let i = 0; i < 8; i++) room.host.sendCommand(place(i));
    expect(energy(room)).toBe(VITALS.maxEnergy - 8 * VITALS.energy.perEdit);
    for (let i = 0; i < 8; i++) room.host.sendCommand(upgrade(i, COMPOSITE));
    expect(energy(room)).toBe(VITALS.maxEnergy - 16 * VITALS.energy.perEdit);
  });

  it('costs no Energy when the host turns it away', () => {
    const { room } = arena({}, { stock: 20 });
    for (let i = 0; i < 8; i++) room.host.sendCommand(place(i));
    for (let i = 0; i < 8; i++) room.host.sendCommand(upgrade(i, COMPOSITE)); // not researched
    expect(energy(room)).toBe(VITALS.maxEnergy - 8 * VITALS.energy.perEdit);
  });

  it('stops counting once the run is over', () => {
    const { room } = rich();
    room.host.sendCommand(place(0));
    sim(room).hurtCore(sim(room).coreMax);
    expect(sim(room).over).toBe(true);
    room.host.sendCommand(upgrade(0, COMPOSITE));
    expect(upgraded(room)).toBe(0);
  });
});

describe('the host turning an upgrade away', () => {
  it('says nothing is there for an empty cell', () => {
    const { room, hostWorld } = rich();
    const seen = reasons(room.host);
    room.host.sendCommand(upgrade(0, COMPOSITE));
    expect(seen).toEqual([NOTHING_TO_UPGRADE]);
    expect(hostWorld.cells.size).toBe(0);
    expect(stock(room.host.economy)).toEqual([20, 20, 20, 20]);
  });

  it('says a piece of the best material is fully upgraded', () => {
    const { room, hostWorld } = rich();
    const seen = reasons(room.host);
    hostWorld.setBlock(SPOT.x, SPOT.y, SPOT.z, ENERGY);
    room.host.sendCommand(upgrade(0, ENERGY));
    expect(seen).toEqual([FULLY_UPGRADED]);
  });

  it('says the better material needs research, and takes nothing', () => {
    const { room, hostWorld } = arena({}, { stock: 20 });
    const seen = reasons(room.host);
    room.host.sendCommand(place(0));
    room.host.sendCommand(upgrade(0, COMPOSITE));
    expect(seen).toEqual([needsResearch('Reinforced Composite')]);
    expect(hostWorld.getBlock(SPOT.x, SPOT.y, SPOT.z)).toBe(SCRAP);
    expect(stock(room.host.economy)).toEqual([19, 20, 20, 20]);
    expect(upgraded(room)).toBe(0);
  });

  it('does not count points no Terminal has read as research', () => {
    const { room } = arena({}, { stock: 20 });
    sim(room).economy!.research.set(RESEARCH_STEPS[0]!.points, false);
    const seen = reasons(room.host);
    room.host.sendCommand(place(0));
    room.host.sendCommand(upgrade(0, COMPOSITE));
    expect(seen).toEqual([needsResearch('Reinforced Composite')]);
  });

  it('says the pool is short of the better material, naming it, though it holds Scrap', () => {
    const { room, hostWorld } = arena({}, { stock: 1, research: RESEARCH_STEPS[0]!.points });
    const seen = reasons(room.host);
    room.host.sendCommand(place(0));
    sim(room).economy!.pool.set(MATERIAL.composite, 0);
    sim(room).economy!.pool.set(MATERIAL.scrap, 5);
    room.host.sendCommand(upgrade(0, COMPOSITE));
    expect(seen).toEqual([notEnough('Reinforced Composite')]);
    expect(hostWorld.getBlock(SPOT.x, SPOT.y, SPOT.z)).toBe(SCRAP);
    expect(stock(room.host.economy)).toEqual([5, 0, 1, 1]);
  });

  it('turns away a command for a piece other than the one the player saw, and charges nothing', () => {
    const { room, hostWorld } = rich();
    const seen = reasons(room.host);
    room.host.sendCommand(place(0));
    // Two players press E on the same Scrap block: the first upgrade goes through, the second is stale.
    room.host.sendCommand(upgrade(0, COMPOSITE));
    room.host.sendCommand(upgrade(0, COMPOSITE));
    expect(seen).toEqual([REFUSAL.changed]);
    expect(hostWorld.getBlock(SPOT.x, SPOT.y, SPOT.z)).toBe(COMPOSITE);
    expect(stock(room.host.economy)).toEqual([19, 19, 20, 20]);
    expect(upgraded(room)).toBe(1);
  });

  it('turns away a command that names a piece the upgrade would not make', () => {
    const { room, hostWorld } = rich();
    const seen = reasons(room.host);
    room.host.sendCommand(place(0));
    room.host.sendCommand(upgrade(0, ENERGY)); // two tiers at once
    room.host.sendCommand(upgrade(0, packState(SHAPE.slab, MATERIAL.composite))); // another shape
    expect(seen).toEqual([REFUSAL.changed, REFUSAL.changed]);
    expect(hostWorld.getBlock(SPOT.x, SPOT.y, SPOT.z)).toBe(SCRAP);
  });

  it('turns away a block that was broken and built again since the player looked', () => {
    const { room, hostWorld } = rich();
    const seen = reasons(room.host);
    room.host.sendCommand(place(0, COMPOSITE));
    // The player saw the Scrap block that stood here, which a machine has since chewed through.
    room.host.sendCommand(upgrade(0, COMPOSITE));
    expect(seen).toEqual([REFUSAL.changed]);
    expect(hostWorld.getBlock(SPOT.x, SPOT.y, SPOT.z)).toBe(COMPOSITE);
  });

  it('turns away a guest too far from the piece, and one who is down', async () => {
    const { room, hostWorld } = rich();
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    room.host.sendCommand(place(0));
    room.host.sendCommand(place(30));
    const seen = reasons(ada.session);
    ada.session.publishState(at(SPOT.x - 2, SPOT.y, SPOT.z));
    await room.settle(200);
    ada.session.sendCommand(upgrade(30, COMPOSITE));
    await room.settle(200);
    expect(seen).toEqual([REFUSAL.reach]);

    sim(room).hurtPlayer(ada.session.localId, VITALS.maxHealth * 10);
    expect(sim(room).isDown(ada.session.localId)).toBe(true);
    ada.session.sendCommand(upgrade(0, COMPOSITE));
    await room.settle(200);
    expect(seen).toEqual([REFUSAL.reach, REFUSAL.down]);
    expect(hostWorld.getBlock(SPOT.x, SPOT.y, SPOT.z)).toBe(SCRAP);
  });

  it('works in a host with no run, where nothing is charged or locked, and still says when nothing is better', () => {
    const room = makeRoom();
    const seen = reasons(room.host);
    const cell = (z: number) => ({ x: 0, y: 0, z });
    room.host.sendCommand({ type: 'place', ...cell(0), state: SCRAP });
    room.hostWorld.setBlock(0, 0, 1, ENERGY);
    room.host.sendCommand({ type: 'upgrade', ...cell(0), state: COMPOSITE });
    expect(room.hostWorld.getBlock(0, 0, 0)).toBe(COMPOSITE);
    room.host.sendCommand({ type: 'upgrade', ...cell(1), state: ENERGY });
    room.host.sendCommand({ type: 'upgrade', ...cell(2), state: COMPOSITE });
    expect(seen).toEqual([FULLY_UPGRADED, NOTHING_TO_UPGRADE]);
  });
});
