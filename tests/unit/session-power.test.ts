import { describe, expect, it } from 'vitest';
import { MODULE, moduleShape, packState } from '../../src/shared/blocks';
import { HOST_PLAYER_ID } from '../../src/shared/protocol';
import { createVitalsReading, type VitalsView } from '../../src/shared/vitals-state';
import { POWER } from '../../src/systems/survival/balance';
import { TestWorld, at, makeRoom } from './helpers/net';

const GENERATOR = packState(moduleShape(MODULE.generator, 0), 1);
/** Where the Generator stands: a good way from the Core, which is at the crash site, so only it can charge anyone here. */
const SPOT = { x: 8, y: 0, z: 0 };

function read(view: VitalsView) {
  return { ...view.read(createVitalsReading()) };
}

/** A room whose host world holds one Generator, walked for modules as the game's own world is. */
function generatorRoom() {
  const hostWorld = new TestWorld(4242);
  hostWorld.setBlock(SPOT.x, SPOT.y, SPOT.z, GENERATOR);
  const room = makeRoom({
    hostWorld,
    survival: {
      modules: (visit) => hostWorld.forEachEdit((x, y, z, state) => visit({ x, y, z, state })),
    },
  });
  return { room, hostWorld };
}

describe('a Generator in a room', () => {
  it('charges a guest in its reach, who is told so, and not the host out of it', async () => {
    const { room } = generatorRoom();
    const code = await room.openRoom();
    const guest = await room.join(code);
    room.host.survivalSim?.playerVitals(guest.session.localId)?.set({ energy: 10 });
    room.host.survivalSim?.playerVitals(HOST_PLAYER_ID)?.set({ energy: 10 });
    room.host.setLocalActive(true);
    const near = SPOT.x + 3.5;
    const far = SPOT.x + 0.5 + POWER.generator.radius + 3;
    for (let i = 0; i < 6; i++) {
      guest.session.publishState(at(near, 0, 0.5));
      room.host.publishState(at(far, 0, 0.5));
      await room.settle(250);
    }
    const mine = read(guest.session.vitals);
    expect(mine.charging).toBe(true);
    expect(mine.energy).toBeGreaterThan(10);
    const hosts = read(room.host.vitals);
    expect(hosts.charging).toBe(false);
    expect(hosts.energy).toBeLessThanOrEqual(10);
  });

  it('stops charging the moment it is broken, on the guest’s screen too', async () => {
    const { room, hostWorld } = generatorRoom();
    const code = await room.openRoom();
    const guest = await room.join(code);
    room.host.survivalSim?.playerVitals(guest.session.localId)?.set({ energy: 10 });
    room.host.setLocalActive(true);
    for (let i = 0; i < 4; i++) {
      guest.session.publishState(at(SPOT.x + 3.5, 0, 0.5));
      await room.settle(250);
    }
    expect(read(guest.session.vitals).charging).toBe(true);
    room.host.sendCommand({ type: 'break', x: SPOT.x, y: SPOT.y, z: SPOT.z });
    expect(hostWorld.getBlock(SPOT.x, SPOT.y, SPOT.z)).toBe(0);
    for (let i = 0; i < 4; i++) {
      guest.session.publishState(at(SPOT.x + 3.5, 0, 0.5));
      await room.settle(250);
    }
    expect(read(guest.session.vitals).charging).toBe(false);
  });

  it('charges a guest beside one a guest placed, as soon as it stands', async () => {
    const hostWorld = new TestWorld(4242);
    const room = makeRoom({
      hostWorld,
      survival: {
        modules: (visit) => hostWorld.forEachEdit((x, y, z, state) => visit({ x, y, z, state })),
      },
    });
    const code = await room.openRoom();
    const guest = await room.join(code);
    room.host.survivalSim?.playerVitals(guest.session.localId)?.set({ energy: 10 });
    room.host.setLocalActive(true);
    guest.session.publishState(at(SPOT.x + 3.5, 0, 0.5));
    await room.settle(500);
    expect(read(guest.session.vitals).charging).toBe(false);
    guest.session.sendCommand({
      type: 'place',
      x: SPOT.x,
      y: SPOT.y,
      z: SPOT.z,
      state: GENERATOR,
    });
    for (let i = 0; i < 4; i++) {
      guest.session.publishState(at(SPOT.x + 3.5, 0, 0.5));
      await room.settle(250);
    }
    expect(hostWorld.getBlock(SPOT.x, SPOT.y, SPOT.z)).toBe(GENERATOR);
    expect(read(guest.session.vitals).charging).toBe(true);
  });
});
