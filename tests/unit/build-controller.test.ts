import { describe, expect, it } from 'vitest';
import {
  BLASTER_SLOT,
  BuildController,
  HOTBAR_MATERIALS,
  HOTBAR_SLOTS,
  MIN_HAND_SCALE,
  NOTICE_SECONDS,
  NOT_READY,
  REPEAT_DELAY,
  REPEAT_INTERVAL,
  RESEND_GUARD,
  type BuildPorts,
  type BuildView,
} from '../../src/app/build-controller';
import {
  MATERIAL,
  MATERIALS,
  SHAPE,
  SHAPE_KINDS,
  isUpsideDown,
  packState,
  slabShape,
  stateShape,
  wedgeFacing,
  wedgeShape,
} from '../../src/shared/blocks';
import { AIM_REFUSAL, BUILD_REACH } from '../../src/shared/build-aim';
import type { DebrisNode } from '../../src/shared/economy';
import type { Vec3 } from '../../src/shared/look';
import { turnCount } from '../../src/shared/placement';
import type { BlockCommand } from '../../src/shared/protocol';
import { DEBRIS } from '../../src/systems/economy/balance';
import { BLASTER } from '../../src/systems/survival/balance';
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
  /** The shots fired, with the view each was aimed from, and whether the fake session takes them. */
  readonly shots: { origin: Vec3; dir: Vec3 }[];
  readonly gun: { ready: boolean };
  /** The heaps of debris in the fake valley, and the strips left of each (a heap not listed has none). */
  readonly heaps: { nodes: DebrisNode[]; left: Record<number, number> };
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
  const shots: { origin: Vec3; dir: Vec3 }[] = [];
  const gun = { ready: true };
  const heaps: Rig['heaps'] = { nodes: [], left: {} };
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
    fire(origin, dir) {
      if (!gun.ready) return false;
      shots.push({ origin: { ...origin }, dir: { ...dir } });
      return true;
    },
    debris: () => ({ nodes: heaps.nodes, leftOf: (index) => heaps.left[index] ?? 0 }),
  };
  const surface = world.terrain.grid.groundAt(SPOT.x + 0.5, SPOT.z + 0.5);
  return {
    world,
    controller: new BuildController(ports),
    sent,
    warmUps,
    session,
    bodies,
    shots,
    gun,
    heaps,
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
    expect(HOTBAR_MATERIALS).toEqual(MATERIALS.map((m) => m.id));
    expect(HOTBAR_MATERIALS.length).toBeLessThan(HOTBAR_SLOTS);
    HOTBAR_MATERIALS.forEach((material, slot) => {
      controller.selectSlot(slot);
      expect(controller.piece).toBe(packState(SHAPE.cube, material));
    });
  });

  it('holds no block in the slots after the materials', () => {
    const { controller } = rig();
    controller.selectSlot(HOTBAR_MATERIALS.length);
    expect(controller.piece).toBe(0);
    expect(controller.choice).toBeNull();
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

  describe('with the hands slowed by low Energy', () => {
    /** Presses and holds the secondary button, and says when (in seconds) each repeat after the click fired. */
    function repeats(scale: number | undefined): number[] {
      const r = rig();
      r.session.apply = true;
      if (scale !== undefined) r.controller.setHandScale(scale);
      const view = r.lookDown(5);
      r.controller.update(0.016, view);
      r.controller.press('secondary');
      const times: number[] = [];
      let seen = r.sent.length;
      for (let t = 0.005; t < 3 && times.length < 2; t += 0.005) {
        r.controller.update(0.005, view);
        if (r.sent.length > seen) {
          seen = r.sent.length;
          times.push(t);
        }
      }
      return times;
    }

    it('waits longer before it repeats, and repeats less often', () => {
      const [delay, next] = repeats(0.5);
      expect(delay).toBeCloseTo(REPEAT_DELAY / 0.5, 1);
      expect((next ?? 0) - (delay ?? 0)).toBeCloseTo(REPEAT_INTERVAL / 0.5, 1);
    });

    it('is at its normal pace by default, and when told 1', () => {
      for (const scale of [undefined, 1]) {
        const [delay, next] = repeats(scale);
        expect(delay).toBeCloseTo(REPEAT_DELAY, 1);
        expect((next ?? 0) - (delay ?? 0)).toBeCloseTo(REPEAT_INTERVAL, 1);
      }
    });

    it('never goes below the floor, never above normal, and ignores nonsense', () => {
      expect(repeats(0)[0]).toBeCloseTo(REPEAT_DELAY / MIN_HAND_SCALE, 1);
      expect(repeats(-3)[0]).toBeCloseTo(REPEAT_DELAY / MIN_HAND_SCALE, 1);
      expect(repeats(4)[0]).toBeCloseTo(REPEAT_DELAY, 1);
      expect(repeats(Number.NaN)[0]).toBeCloseTo(REPEAT_DELAY, 1);
    });

    it('still acts at once on a single click', () => {
      const r = rig();
      r.session.apply = true;
      r.controller.setHandScale(MIN_HAND_SCALE);
      r.controller.update(0.016, r.lookDown(5));
      r.controller.press('secondary');
      expect(r.sent).toHaveLength(1);
    });
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
      kind: 'cube',
      turn: 0,
    });
  });
});

describe('the shape key and the turn key', () => {
  it('start on blocks and cycle block, slab, wedge, block', () => {
    const { controller } = rig();
    expect(controller.kind).toBe('cube');
    const seen: string[] = [];
    for (let i = 0; i < SHAPE_KINDS.length + 1; i++) {
      controller.cycleShape();
      seen.push(controller.kind);
    }
    expect(seen).toEqual(['slab', 'wedge', 'cube', 'slab']);
  });

  it('turn a slab through two positions and a wedge through eight, and a block not at all', () => {
    const { controller } = rig();
    for (const kind of SHAPE_KINDS) {
      while (controller.kind !== kind) controller.cycleShape();
      const turns = new Set<number>();
      for (let i = 0; i < turnCount(kind) * 2; i++) {
        turns.add(controller.turn);
        controller.turnPiece();
        expect(controller.turn).toBeLessThan(turnCount(kind));
      }
      expect(turns.size).toBe(turnCount(kind));
    }
  });

  it('start the turn over when the shape changes', () => {
    const { controller } = rig();
    controller.cycleShape();
    controller.turnPiece();
    expect(controller.turn).toBe(1);
    controller.cycleShape();
    expect(controller.turn).toBe(0);
  });

  it('keep the slot and change what every block slot makes', () => {
    const { controller } = rig();
    controller.selectSlot(2);
    controller.cycleShape();
    expect(controller.selected).toBe(2);
    expect(controller.piece).toBe(packState(slabShape(false), MATERIAL.alloy));
    controller.cycleShape();
    expect(controller.piece).toBe(packState(wedgeShape(0), MATERIAL.alloy));
    expect(controller.hudState()).toMatchObject({
      kind: 'wedge',
      piece: packState(wedgeShape(0), MATERIAL.alloy),
    });
  });

  it('change nothing for a slot that holds no block', () => {
    const { controller } = rig();
    controller.selectSlot(HOTBAR_SLOTS - 1);
    controller.cycleShape();
    expect(controller.piece).toBe(0);
    expect(controller.choice).toBeNull();
    expect(controller.hudState().kind).toBe('slab');
  });
});

describe('placing slabs and wedges', () => {
  it('places a slab low on top of a block, and high once turned', () => {
    const r = rig();
    r.world.setBlock(SPOT.x, Math.floor(r.surface), SPOT.z, packState(SHAPE.cube, MATERIAL.scrap));
    r.controller.cycleShape();
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    r.controller.release('secondary');
    expect(r.sent[0]).toMatchObject({
      type: 'place',
      state: packState(slabShape(false), MATERIAL.scrap),
    });
    r.controller.turnPiece();
    r.controller.update(RESEND_GUARD, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent[1]).toMatchObject({
      type: 'place',
      state: packState(slabShape(true), MATERIAL.scrap),
    });
  });

  it('places a wedge that rises away from where the player looks', () => {
    const r = rig();
    r.controller.cycleShape();
    r.controller.cycleShape();
    const above = { x: SPOT.x + 0.5, y: r.surface + 3, z: SPOT.z + 0.5 };
    const looks = [
      { x: 1, y: -3, z: 0, facing: 0 },
      { x: 0, y: -3, z: 1, facing: 1 },
      { x: -1, y: -3, z: 0, facing: 2 },
      { x: 0, y: -3, z: -1, facing: 3 },
    ];
    for (const look of looks) {
      const length = Math.hypot(look.x, look.y, look.z);
      // Stand back along the look so the ray comes down onto the spot.
      const origin = {
        x: above.x - (look.x / length) * 2,
        y: above.y,
        z: above.z - (look.z / length) * 2,
      };
      r.controller.update(RESEND_GUARD, {
        origin,
        dir: { x: look.x / length, y: look.y / length, z: look.z / length },
        eye: origin,
      });
      r.controller.press('secondary');
      r.controller.release('secondary');
      const sent = r.sent[r.sent.length - 1];
      expect(sent?.type).toBe('place');
      const state = sent?.type === 'place' ? sent.state : 0;
      expect(wedgeFacing(stateShape(state)), `looking ${look.facing}`).toBe(look.facing);
      expect(isUpsideDown(stateShape(state))).toBe(false);
    }
  });

  it('sends the same piece the aim shows', () => {
    const r = rig();
    r.controller.cycleShape();
    r.controller.turnPiece();
    r.controller.update(0.016, r.lookDown(3));
    const shown = r.controller.target.state;
    r.controller.press('secondary');
    expect(r.sent[0]).toMatchObject({ type: 'place', state: shown });
  });
});

describe('the pulse blaster', () => {
  /** A rig with the blaster in hand, after a frame that aimed it along the view. */
  function armed() {
    const r = rig();
    r.controller.selectSlot(BLASTER_SLOT);
    const view: BuildView = {
      origin: { x: 1.5, y: 20, z: -3 },
      dir: { x: 0, y: 0, z: -1 },
      eye: { x: 1.5, y: 19, z: -1 },
    };
    r.controller.update(0.016, view);
    return { ...r, view };
  }

  it('lives in the slot after the materials, and only there is it in hand', () => {
    const { controller } = rig();
    expect(BLASTER_SLOT).toBe(HOTBAR_MATERIALS.length);
    expect(BLASTER_SLOT).toBeLessThan(HOTBAR_SLOTS);
    for (let slot = 0; slot < HOTBAR_SLOTS; slot++) {
      controller.selectSlot(slot);
      expect(controller.armed).toBe(slot === BLASTER_SLOT);
      expect(controller.hudState().blaster).toBe(slot === BLASTER_SLOT);
    }
  });

  it('fires along the line the camera looks on a left click, from where the camera is', () => {
    const r = armed();
    r.controller.press('primary');
    expect(r.shots).toEqual([{ origin: r.view.origin, dir: r.view.dir }]);
    expect(r.sent).toEqual([]);
  });

  it('breaks no block with a left click, though one is under the cursor, and places none with a right one', () => {
    const r = rig();
    const y = Math.floor(r.surface);
    r.world.setBlock(SPOT.x, y, SPOT.z, packState(SHAPE.cube, MATERIAL.scrap));
    r.controller.selectSlot(BLASTER_SLOT);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('primary');
    r.controller.release('primary');
    r.controller.press('secondary');
    expect(r.sent).toEqual([]);
    expect(r.shots).toHaveLength(1);
    // Put the blaster away and the same click breaks the block again.
    r.controller.selectSlot(0);
    r.controller.press('primary');
    expect(r.sent).toEqual([{ type: 'break', x: SPOT.x, y, z: SPOT.z }]);
    expect(r.shots).toHaveLength(1);
  });

  it('waits for the blaster to be ready between clicks', () => {
    const r = armed();
    r.controller.press('primary');
    r.controller.release('primary');
    r.controller.update(BLASTER.interval * 0.5, r.view);
    r.controller.press('primary');
    r.controller.release('primary');
    expect(r.shots).toHaveLength(1);
    r.controller.update(BLASTER.interval * 0.6, r.view);
    r.controller.press('primary');
    expect(r.shots).toHaveLength(2);
  });

  it('fires again and again while the button is held, at the blaster’s pace and not a builder’s', () => {
    const r = armed();
    r.controller.press('primary');
    // Eighteen frames of 0.1 s. A repeat comes on the first frame after the interval has run out,
    // here every fourth (0.4 s); a held click that broke blocks would come every other frame after the first.
    for (let i = 0; i < 18; i++) r.controller.update(0.1, r.view);
    expect(r.shots.length).toBe(1 + 4);
    r.controller.release('primary');
    for (let i = 0; i < 10; i++) r.controller.update(0.1, r.view);
    expect(r.shots.length).toBe(1 + 4);
    expect(BLASTER.interval).toBeGreaterThan(REPEAT_INTERVAL * 2);
  });

  it('shoots more slowly with tired hands', () => {
    const r = armed();
    r.controller.setHandScale(0.5);
    r.controller.press('primary');
    r.controller.release('primary');
    r.controller.update(BLASTER.interval * 1.1, r.view);
    r.controller.press('primary');
    r.controller.release('primary');
    expect(r.shots).toHaveLength(1);
    r.controller.update(BLASTER.interval * 1.1, r.view);
    r.controller.press('primary');
    expect(r.shots).toHaveLength(2);
  });

  it('has nothing to aim with before the first frame has looked', () => {
    const r = rig();
    r.controller.selectSlot(BLASTER_SLOT);
    r.controller.press('primary');
    expect(r.shots).toEqual([]);
    expect(r.controller.hudState().refusal).toBeNull();
    r.controller.release('primary');
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('primary');
    expect(r.shots).toHaveLength(1);
  });

  it('says so when there is nobody to fire at yet, and is ready the moment there is', () => {
    const r = armed();
    r.gun.ready = false;
    r.controller.press('primary');
    r.controller.release('primary');
    expect(r.shots).toEqual([]);
    expect(r.controller.hudState().refusal).toBe(NOT_READY);
    r.gun.ready = true;
    r.controller.press('primary');
    expect(r.shots).toHaveLength(1);
  });

  it('draws its own sight on the crosshair, in Build Mode or not, and gives the cursor back with the slot', () => {
    const r = rig();
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().crosshair).toBe('place');
    r.controller.selectSlot(BLASTER_SLOT);
    expect(r.controller.hudState().crosshair).toBe('blaster');
    r.controller.toggleBuildMode();
    expect(r.controller.hudState().crosshair).toBe('blaster');
    r.controller.selectSlot(1);
    expect(r.controller.hudState().crosshair).toBe('place');
  });

  it('counts the hits the host reports, and whether the latest felled its machine', () => {
    const { controller } = rig();
    expect(controller.hudState()).toMatchObject({ hits: 0, kill: false });
    controller.noteHit(false);
    expect(controller.hudState()).toMatchObject({ hits: 1, kill: false });
    controller.noteHit(true);
    expect(controller.hudState()).toMatchObject({ hits: 2, kill: true });
    controller.noteHit(false);
    expect(controller.hudState()).toMatchObject({ hits: 3, kill: false });
  });

  it('lets go of the trigger when the pointer is let go', () => {
    const r = armed();
    r.controller.press('primary');
    r.controller.releaseAll();
    for (let i = 0; i < 20; i++) r.controller.update(0.1, r.view);
    expect(r.shots).toHaveLength(1);
  });
});

describe('the hands of a player who is down', () => {
  it('do nothing: no block is broken or placed, and no shot is fired', () => {
    const r = rig();
    r.controller.update(0.016, r.lookDown(3));
    r.controller.setDown(true);
    r.controller.press('primary');
    r.controller.press('secondary');
    expect(r.sent).toEqual([]);
    r.controller.selectSlot(BLASTER_SLOT);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('primary');
    expect(r.shots).toEqual([]);
  });

  it('let go of a button that was held when the player went down, and stay still when it is repeated', () => {
    const r = rig();
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    const placed = r.sent.length;
    expect(placed).toBeGreaterThan(0);
    r.controller.setDown(true);
    for (let i = 0; i < 30; i++) r.controller.update(0.1, r.lookDown(3));
    expect(r.sent).toHaveLength(placed);
  });

  it('work again, from the next click, once the player is back on their feet', () => {
    const r = rig();
    r.controller.selectSlot(BLASTER_SLOT);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.setDown(true);
    r.controller.press('primary');
    r.controller.setDown(false);
    expect(r.shots).toEqual([]);
    r.controller.press('primary');
    expect(r.shots).toHaveLength(1);
  });

  it('say nothing for a click they cannot make: no notice about the blaster not being ready', () => {
    const r = rig();
    r.controller.selectSlot(BLASTER_SLOT);
    r.controller.update(0.016, r.lookDown(3));
    r.gun.ready = false;
    r.controller.setDown(true);
    r.controller.press('primary');
    expect(r.controller.hudState().refusal).toBeNull();
  });
});

describe('the interact key and heaps of debris', () => {
  /** A rig with one heap of debris on the ground at the spot, and a view from `height` above it looking straight down. */
  function heapAtSpot(height = 3) {
    const r = rig();
    const heap: DebrisNode = {
      index: 0,
      x: SPOT.x + 0.5,
      y: r.surface,
      z: SPOT.z + 0.5,
      yaw: 0,
      scale: 1,
      harvests: 3,
      grade: MATERIAL.scrap,
      from: 0,
    };
    r.heaps.nodes.push(heap);
    r.heaps.left[0] = 3;
    const view = r.lookDown(height);
    r.controller.update(0.016, view);
    return { ...r, heap, view };
  }

  it('strips the heap the cursor is on, naming the cell its middle is in', () => {
    const r = heapAtSpot();
    expect(r.controller.hudState().salvage).toBe(3);
    expect(r.controller.salvageTarget.index).toBe(0);
    r.controller.interact();
    expect(r.sent).toEqual([{ type: 'harvest', x: SPOT.x, y: Math.floor(r.surface), z: SPOT.z }]);
  });

  it('does nothing when the cursor is on no heap, and says nothing about it', () => {
    const r = rig();
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().salvage).toBe(0);
    r.controller.interact();
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBeNull();
  });

  it('does nothing for a heap with nothing left, or one out of the eyes’ reach', () => {
    const r = heapAtSpot();
    r.heaps.left[0] = 0;
    r.controller.update(0.016, r.view);
    expect(r.controller.hudState().salvage).toBe(0);
    r.controller.interact();
    expect(r.sent).toEqual([]);

    r.heaps.left[0] = 3;
    // Eyes four blocks higher than reach allows from the middle of the heap.
    const high = r.lookDown(DEBRIS.reach + 2);
    r.controller.update(0.016, high);
    expect(r.controller.hudState().salvage).toBe(0);
    r.controller.interact();
    expect(r.sent).toEqual([]);
  });

  it('does not strip a heap behind a block the view meets first', () => {
    const r = heapAtSpot();
    // Three blocks off, level with the heap's middle and looking straight at it.
    const y = r.surface + DEBRIS.lift;
    const origin = { x: SPOT.x + 3.5, y, z: SPOT.z + 0.5 };
    const view = { origin, dir: { x: -1, y: 0, z: 0 }, eye: origin };
    r.controller.update(0.016, view);
    expect(r.controller.hudState().salvage).toBe(3);
    // A block between the two, which the view meets first.
    r.world.setBlock(SPOT.x + 2, Math.floor(y), SPOT.z, packState(SHAPE.cube, MATERIAL.scrap));
    r.controller.update(0.016, view);
    expect(r.controller.hudState().salvage).toBe(0);
    r.controller.interact();
    expect(r.sent).toEqual([]);
  });

  it('keeps the pace of the hands: one strip, then none until they are ready again', () => {
    const r = heapAtSpot();
    r.controller.interact();
    r.controller.interact();
    expect(r.sent).toHaveLength(1);
    r.controller.update(DEBRIS.pace * 0.5, r.view);
    r.controller.interact();
    expect(r.sent).toHaveLength(1);
    r.controller.update(DEBRIS.pace * 0.6, r.view);
    r.controller.interact();
    expect(r.sent).toHaveLength(2);
    // The hands are a little slower than the host, so a patient player is never told they were too quick.
    expect(DEBRIS.pace).toBeGreaterThan(DEBRIS.cooldown);
  });

  it('is slowed by low Energy as the other hand work is', () => {
    const r = heapAtSpot();
    r.controller.setHandScale(0.5);
    r.controller.interact();
    // Half the hands' speed: the time a strip takes is doubled.
    r.controller.update(DEBRIS.pace * 1.2, r.view);
    r.controller.interact();
    expect(r.sent).toHaveLength(1);
    r.controller.update(DEBRIS.pace * 1.2, r.view);
    r.controller.interact();
    expect(r.sent).toHaveLength(2);
  });

  it('works with the blaster in hand, and strips nothing while the player is down', () => {
    const r = heapAtSpot();
    r.controller.selectSlot(BLASTER_SLOT);
    r.controller.setDown(true);
    r.controller.interact();
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().salvage).toBe(0);
    r.controller.setDown(false);
    r.controller.interact();
    expect(r.sent).toHaveLength(1);
    expect(r.shots).toEqual([]);
  });

  it('says it is still connecting, and keeps its hands ready, while there is nobody to ask', () => {
    const r = heapAtSpot();
    r.session.open = false;
    r.controller.interact();
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBe(NOT_READY);
    r.session.open = true;
    r.controller.interact();
    expect(r.sent).toHaveLength(1);
  });

  it('forgets the heap when the mouse is freed', () => {
    const r = heapAtSpot();
    expect(r.controller.hudState().salvage).toBe(3);
    r.controller.clearAim();
    expect(r.controller.hudState().salvage).toBe(0);
    r.controller.interact();
    expect(r.sent).toEqual([]);
  });
});
