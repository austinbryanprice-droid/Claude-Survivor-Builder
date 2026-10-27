import { describe, expect, it } from 'vitest';
import { SessionHub } from '../../src/net/hub';
import type { CellState } from '../../src/shared/block-world';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';
import type { BlockCommand, WorldEvent } from '../../src/shared/protocol';
import { RESEARCH_STEPS } from '../../src/systems/economy/research';
import { FLOOR, arena } from './helpers/arena';

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const COMPOSITE = packState(SHAPE.cube, MATERIAL.composite);
const SPOT = { x: 8, y: FLOOR, z: -3 };

interface Heard {
  readonly event: WorldEvent;
  readonly previous: CellState;
}

function listen(session: {
  onEvent(listener: (event: WorldEvent, previous: CellState) => void): unknown;
}): Heard[] {
  const heard: Heard[] = [];
  session.onEvent((event, previous) => heard.push({ event, previous }));
  return heard;
}

/** A crew that has researched every tier, so that a piece can be raised. */
function rich() {
  return arena({}, { stock: 20, research: RESEARCH_STEPS[2]!.points });
}

/** Places a block, raises it, and breaks it, all in the same cell. */
function buildAndBreak(send: (command: BlockCommand) => void): void {
  send({ type: 'place', ...SPOT, state: SCRAP });
  send({ type: 'upgrade', ...SPOT, state: COMPOSITE });
  send({ type: 'break', ...SPOT });
}

describe('what a cell held before its event', () => {
  it('is nothing for a block placed, the old block for one raised, and the raised one for one broken', () => {
    const { room } = rich();
    const heard = listen(room.host);
    buildAndBreak((command) => room.host.sendCommand(command));
    expect(heard.map((entry) => [entry.event.state, entry.previous])).toEqual([
      [SCRAP, 0],
      [COMPOSITE, SCRAP],
      [0, COMPOSITE],
    ]);
  });

  it('is told to a guest from its own copy of the world, in the same order', async () => {
    const { room } = rich();
    const code = await room.openRoom();
    const guest = await room.join(code, 'Guest');
    const heard = listen(guest.session);
    buildAndBreak((command) => room.host.sendCommand(command));
    await room.settle(300);
    expect(heard.map((entry) => [entry.event.state, entry.previous])).toEqual([
      [SCRAP, 0],
      [COMPOSITE, SCRAP],
      [0, COMPOSITE],
    ]);
  });

  it('goes through the hub that stands between the game and its session', () => {
    const { room } = rich();
    const hub = new SessionHub(room.host);
    const heard = listen(hub);
    buildAndBreak((command) => hub.sendCommand(command));
    expect(heard.map((entry) => entry.previous)).toEqual([0, SCRAP, COMPOSITE]);
  });
});
