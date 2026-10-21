import { describe, expect, it } from 'vitest';
import {
  BuildController,
  HOTBAR_PIECES,
  HOTBAR_SLOTS,
  NOTICE_SECONDS,
  NOT_READY,
  REPEAT_DELAY,
  RESEND_GUARD,
  type BuildPorts,
  type BuildView,
} from '../../src/app/build-controller';
import { MATERIAL, MATERIALS, SHAPE, packState } from '../../src/shared/blocks';
import { AIM_REFUSAL, BUILD_REACH } from '../../src/shared/build-aim';
import type { Vec3 } from '../../src/shared/look';
import type { BlockCommand } from '../../src/shared/protocol';
import { createTerrainGround } from '../../src/world/terrain/collision';
import { createWorld, type VoxelWorld } from '../../src/world/voxels/world';
import { TEST_SEED, terrain } from './helpers/valley';

const SPOT = { x: 8, z: -4 };

interface Rig {
  readonly world: VoxelWorld;
  readonly controller: BuildController;
  readonly sent: BlockCommand[];
  readonly warmUps: { count: number };
  /** Whether the fake session accepts commands, and whether it applies them to the world at once. */
  readonly session: { open: boolean; apply: boolean };
  readonly bodies: Vec3[];
  /** The ground height at the spot. */
  readonly surface: number;
  /** A view from `height` above the ground at the spot, looking straight down. */
  lookDown(height: number): BuildView;
}

function rig(): Rig {
  const world = createWorld(TEST_SEED, terrain());
  const ground = createTerrainGround(world.terrain.grid, 90);
  const sent: BlockCommand[] = [];
  const warmUps = { count: 0 };
  const session = { open: true, apply: false };
  const bodies: Vec3[] = [];
  const ports: BuildPorts = {
    blocks: () => world,
    ground: () => ground,
    send(command) {
      if (!session.open) return false;
      sent.push(command);
      if (session.apply) {
        world.setBlock(
          command.x,
          command.y,
          command.z,
          command.type === 'place' ? command.state : 0,
        );
      }
      return true;
    },
    bodies: () => bodies,
    warmUp: () => {
      warmUps.count++;
    },
  };
  const surface = world.terrain.grid.groundAt(SPOT.x + 0.5, SPOT.z + 0.5);
  return {
    world,
    controller: new BuildController(ports),
    sent,
    warmUps,
    session,
    bodies,
    surface,
    lookDown(height) {
      const origin = { x: SPOT.x + 0.5, y: surface + height, z: SPOT.z + 0.5 };
      return { origin, dir: { x: 0, y: -1, z: 0 }, eye: origin };
    },
  };
}

describe('the hotbar', () => {
  it('starts on the first slot, which holds a Scrap block, and has one block slot per material', () => {
    const { controller } = rig();
    expect(controller.selected).toBe(0);
    expect(controller.piece).toBe(packState(SHAPE.cube, MATERIAL.scrap));
    expect(HOTBAR_PIECES).toHaveLength(MATERIALS.length);
    expect(HOTBAR_PIECES.length).toBeLessThan(HOTBAR_SLOTS);
    HOTBAR_PIECES.forEach((piece, slot) => {
      controller.selectSlot(slot);
      expect(controller.piece).toBe(piece);
    });
  });

  it('holds no block in the slots after the materials', () => {
    const { controller } = rig();
    controller.selectSlot(HOTBAR_PIECES.length);
    expect(controller.piece).toBe(0);
    controller.selectSlot(HOTBAR_SLOTS - 1);
    expect(controller.piece).toBe(0);
  });

  it('wraps around the ends with the wheel and ignores slots that do not exist', () => {
    const { controller } = rig();
    controller.scrollSlot(-1);
    expect(controller.selected).toBe(HOTBAR_SLOTS - 1);
    controller.scrollSlot(1);
    expect(controller.selected).toBe(0);
    controller.scrollSlot(HOTBAR_SLOTS + 3);
    expect(controller.selected).toBe(3);
    controller.selectSlot(HOTBAR_SLOTS);
    controller.selectSlot(-1);
    controller.selectSlot(1.5);
    expect(controller.selected).toBe(3);
  });
});

describe('placing and breaking', () => {
  it('places the selected block where the cursor points', () => {
    const r = rig();
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent).toEqual([
      {
        type: 'place',
        x: SPOT.x,
        y: Math.floor(r.surface),
        z: SPOT.z,
        state: packState(SHAPE.cube, MATERIAL.scrap),
      },
    ]);
    // The world changes only when the host's event comes back, never here.
    expect(r.world.blockCount).toBe(0);
  });

  it('places the material of the selected slot', () => {
    const r = rig();
    r.controller.selectSlot(2);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent[0]).toMatchObject({
      type: 'place',
      state: packState(SHAPE.cube, MATERIAL.alloy),
    });
  });

  it('breaks the block under the cursor, whichever slot is selected', () => {
    const r = rig();
    const y = Math.floor(r.surface);
    r.world.setBlock(SPOT.x, y, SPOT.z, packState(SHAPE.cube, MATERIAL.scrap));
    r.controller.selectSlot(HOTBAR_SLOTS - 1);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('primary');
    expect(r.sent).toEqual([{ type: 'break', x: SPOT.x, y, z: SPOT.z }]);
  });

  it('does nothing for a break on bare ground, and nothing for a place with a slot that holds no block', () => {
    const r = rig();
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('primary');
    r.controller.release('primary');
    r.controller.selectSlot(HOTBAR_SLOTS - 1);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent).toEqual([]);
  });

  it('sends nothing the rules refuse, and shows why for a moment', () => {
    const r = rig();
    r.controller.update(0.016, r.lookDown(BUILD_REACH + 1));
    r.controller.press('secondary');
    r.controller.release('secondary');
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBe(AIM_REFUSAL.outOfReach);
    r.controller.update(NOTICE_SECONDS + 0.1, r.lookDown(BUILD_REACH + 1));
    // Outside Build Mode the live reason stays off the screen once the notice has expired.
    expect(r.controller.hudState().refusal).toBeNull();
  });

  it('refuses a cell a player stands in', () => {
    const r = rig();
    r.bodies.push({ x: SPOT.x + 0.5, y: Math.floor(r.surface), z: SPOT.z + 0.5 });
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBe(AIM_REFUSAL.inTheWay);
  });

  it('says so when there is nobody to send to yet, and keeps working once there is', () => {
    const r = rig();
    r.session.open = false;
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBe(NOT_READY);
    r.session.open = true;
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent).toHaveLength(1);
  });

  it('shows the host’s reason when a command comes back refused', () => {
    const r = rig();
    r.controller.noteRejection('a player is in the way');
    expect(r.controller.hudState().refusal).toBe('a player is in the way');
    r.controller.update(NOTICE_SECONDS + 0.1, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBeNull();
  });

  it('does not send the same command twice before an answer could have come back', () => {
    const r = rig();
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    r.controller.release('secondary');
    r.controller.update(0.1, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent).toHaveLength(1);
    r.controller.update(RESEND_GUARD, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent).toHaveLength(2);
  });
});

describe('holding a button', () => {
  it('repeats after a delay and stops when the button is let go', () => {
    const r = rig();
    r.session.apply = true;
    const view = r.lookDown(5);
    r.controller.update(0.016, view);
    r.controller.press('secondary');
    expect(r.sent).toHaveLength(1);
    // Not yet: the delay has not passed.
    r.controller.update(REPEAT_DELAY / 2, view);
    expect(r.sent).toHaveLength(1);
    // Each repeat builds on what the last one placed, so the commands are all different.
    for (let i = 0; i < 12; i++) r.controller.update(0.05, view);
    const placed = r.sent.length;
    expect(placed).toBeGreaterThanOrEqual(3);
    expect(new Set(r.sent.map((c) => `${c.x},${c.y},${c.z}`)).size).toBe(placed);
    r.controller.release('secondary');
    for (let i = 0; i < 12; i++) r.controller.update(0.05, view);
    expect(r.sent).toHaveLength(placed);
  });

  it('stops everything when the pointer is let go', () => {
    const r = rig();
    r.session.apply = true;
    const view = r.lookDown(5);
    r.controller.update(0.016, view);
    r.controller.press('secondary');
    r.controller.releaseAll();
    for (let i = 0; i < 20; i++) r.controller.update(0.05, view);
    expect(r.sent).toHaveLength(1);
  });

  it('digs down through a column of blocks while the primary button is held', () => {
    const r = rig();
    r.session.apply = true;
    const y = Math.floor(r.surface);
    for (let i = 0; i < 4; i++) {
      r.world.setBlock(SPOT.x, y + i, SPOT.z, packState(SHAPE.cube, MATERIAL.scrap));
    }
    const view = r.lookDown(4);
    r.controller.update(0.016, view);
    r.controller.press('primary');
    for (let i = 0; i < 40; i++) r.controller.update(0.05, view);
    r.controller.release('primary');
    expect(r.world.blockCount).toBe(0);
    expect(r.sent.every((c) => c.type === 'break')).toBe(true);
  });
});

describe('Build Mode', () => {
  it('toggles, and warms the renderer up each time it starts', () => {
    const r = rig();
    expect(r.controller.inBuildMode).toBe(false);
    r.controller.toggleBuildMode();
    expect(r.controller.inBuildMode).toBe(true);
    expect(r.warmUps.count).toBe(1);
    r.controller.toggleBuildMode();
    expect(r.controller.inBuildMode).toBe(false);
    expect(r.warmUps.count).toBe(1);
    r.controller.toggleBuildMode();
    expect(r.warmUps.count).toBe(2);
  });

  it('changes the crosshair over a placeable surface, in or out of Build Mode', () => {
    const r = rig();
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().crosshair).toBe('place');
    r.controller.toggleBuildMode();
    expect(r.controller.hudState().crosshair).toBe('place');
    expect(r.controller.hudState().refusal).toBeNull();
    // Nothing to build on: open air.
    r.controller.update(0.016, { ...r.lookDown(3), dir: { x: 0, y: 1, z: 0 } });
    expect(r.controller.hudState().crosshair).toBe('none');
  });

  it('shows what is wrong with a spot, but only in Build Mode', () => {
    const r = rig();
    r.controller.update(0.016, r.lookDown(BUILD_REACH + 1));
    expect(r.controller.hudState()).toMatchObject({ crosshair: 'none', refusal: null });
    r.controller.toggleBuildMode();
    expect(r.controller.hudState()).toMatchObject({
      crosshair: 'blocked',
      refusal: AIM_REFUSAL.outOfReach,
    });
  });

  it('reports the selected slot and piece for the HUD', () => {
    const r = rig();
    r.controller.selectSlot(3);
    expect(r.controller.hudState()).toMatchObject({
      selected: 3,
      piece: packState(SHAPE.cube, MATERIAL.energy),
      buildMode: false,
    });
  });
});
