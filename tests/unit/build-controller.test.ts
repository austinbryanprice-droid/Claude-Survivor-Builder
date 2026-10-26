import { describe, expect, it } from 'vitest';
import {
  BLASTER_SLOT,
  BuildController,
  HOTBAR_MATERIALS,
  HOTBAR_MODULES,
  HOTBAR_SLOTS,
  LADDER_STAY,
  MIN_HAND_SCALE,
  MODULE_SLOT,
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
  MODULE,
  MODULE_FACINGS,
  SHAPE,
  SHAPE_KINDS,
  isUpsideDown,
  moduleFacing,
  moduleOfShape,
  moduleShape,
  packState,
  slabShape,
  stateMaterial,
  stateShape,
  wedgeFacing,
  wedgeShape,
} from '../../src/shared/blocks';
import { AIM_REFUSAL, BUILD_REACH } from '../../src/shared/build-aim';
import type { DebrisNode } from '../../src/shared/economy';
import type { Vec3 } from '../../src/shared/look';
import { turnCount } from '../../src/shared/placement';
import type { BlockCommand } from '../../src/shared/protocol';
import { DEBRIS, RESEARCH } from '../../src/systems/economy/balance';
import {
  DEBRIS_IN_THE_WAY,
  FULLY_UPGRADED,
  needsResearch,
  notEnough,
} from '../../src/systems/economy/build-rules';
import { BLASTER, POWER } from '../../src/systems/survival/balance';
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
  /**
   * The crew's pool in the fake economy: with no ceiling (`cap` 0) there is no pool, and nothing costs
   * anything or is locked. `tier` is the highest material the crew has researched (all of them, unless a test says less),
   * and `claimed` the points a Terminal has read (enough for every group of modules, unless a test says less).
   */
  readonly pool: { cap: number; stock: number[]; tier: number; research: number; claimed: number };
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
  const pool: Rig['pool'] = { cap: 0, stock: [], tier: 4, research: 0, claimed: 9999 };
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
          command.type === 'place' || command.type === 'upgrade' ? command.state : 0,
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
    economy: () => ({
      read(out) {
        for (let i = 0; i < out.stock.length; i++) out.stock[i] = pool.stock[i] ?? 0;
        out.cap = pool.cap;
        out.tier = pool.tier;
        out.research = pool.research;
        out.claimed = pool.claimed;
        return out;
      },
      debris: { nodes: heaps.nodes, leftOf: (index) => heaps.left[index] ?? 0 },
    }),
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
    pool,
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
    // The key is for the block the view meets: it is upgraded, and the heap behind it is left alone.
    expect(r.sent).toEqual([
      {
        type: 'upgrade',
        x: SPOT.x + 2,
        y: Math.floor(y),
        z: SPOT.z,
        state: packState(SHAPE.cube, MATERIAL.composite),
      },
    ]);
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

describe('what the pool says about a placement', () => {
  /** The pool the fake economy reads: so many of Scrap, Composite, Alloy and Energy-Infused, under a ceiling. */
  function stocked(...stock: number[]) {
    const r = rig();
    r.pool.cap = 400;
    r.pool.stock.splice(0, r.pool.stock.length, ...stock);
    return r;
  }

  it('shows a block the pool cannot pay for as refused, naming what is short, in Build Mode', () => {
    const r = stocked(0, 9, 9, 9);
    r.controller.toggleBuildMode();
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBe(notEnough('Scrap'));
    expect(r.controller.hudState().crosshair).toBe('blocked');
  });

  it('sends nothing for a click it cannot pay for, and says why for a moment', () => {
    const r = stocked(0, 9, 9, 9);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    r.controller.release('secondary');
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBe('not enough Scrap');
    r.controller.update(NOTICE_SECONDS + 0.1, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBeNull();
  });

  it('sends the click once the pool holds what the piece costs', () => {
    const r = stocked(1, 0, 0, 0);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent).toHaveLength(1);
    expect(r.controller.hudState().refusal).toBeNull();
  });

  it('asks about the material of the slot in hand, not about Scrap alone', () => {
    const r = stocked(40, 0, 3, 0);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.selectSlot(1);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    r.controller.release('secondary');
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBe('not enough Reinforced Composite');
    r.controller.selectSlot(2);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({
      type: 'place',
      state: packState(SHAPE.cube, MATERIAL.alloy),
    });
  });

  it('shows a material the crew has not researched as refused, in the words the host would use, whatever the pool holds', () => {
    const r = stocked(40, 0, 9, 0);
    r.pool.tier = 1;
    r.controller.toggleBuildMode();
    r.controller.selectSlot(1);
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBe(needsResearch('Reinforced Composite'));
    expect(r.controller.hudState().crosshair).toBe('blocked');
    // Alloy has plenty in the pool and is still shut; opening its tier opens the slot.
    r.controller.selectSlot(2);
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBe(needsResearch('Advanced Alloy'));
    r.pool.tier = 3;
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBeNull();
    expect(r.controller.hudState().crosshair).toBe('place');
  });

  it('sends nothing for a click on a material it has not researched, and says why for a moment', () => {
    const r = stocked(40, 9, 0, 0);
    r.pool.tier = 1;
    r.controller.selectSlot(1);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    r.controller.release('secondary');
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBe('Reinforced Composite needs research');
    r.controller.update(NOTICE_SECONDS + 0.1, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBeNull();
    r.pool.tier = 2;
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent).toHaveLength(1);
  });

  it('locks nothing where there is no pool, whatever the tier', () => {
    const r = rig();
    r.pool.tier = 1;
    r.controller.selectSlot(3);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent).toHaveLength(1);
  });

  it('charges every shape of a material the same: a slab or a wedge costs what a block does', () => {
    const short = stocked(0, 0, 0, 0);
    const enough = stocked(1, 0, 0, 0);
    short.controller.toggleBuildMode();
    enough.controller.toggleBuildMode();
    for (let i = 0; i < SHAPE_KINDS.length; i++) {
      short.controller.update(0.016, short.lookDown(3));
      enough.controller.update(0.016, enough.lookDown(3));
      expect(short.controller.hudState().refusal, short.controller.kind).toBe(notEnough('Scrap'));
      expect(enough.controller.hudState().refusal, enough.controller.kind).toBeNull();
      short.controller.cycleShape();
      enough.controller.cycleShape();
    }
  });

  it('asks about the pool as it stands each frame, so a refusal ends when the pool is filled', () => {
    const r = stocked(0, 0, 0, 0);
    r.controller.toggleBuildMode();
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBe('not enough Scrap');
    r.pool.stock[0] = 5;
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBeNull();
    expect(r.controller.hudState().crosshair).toBe('place');
  });

  it('charges nothing where there is no pool to read', () => {
    const r = rig();
    expect(r.pool.cap).toBe(0);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent).toHaveLength(1);
  });

  it('answers the reach and the world’s rules before the pool', () => {
    const r = stocked(0, 0, 0, 0);
    r.controller.toggleBuildMode();
    r.controller.update(0.016, r.lookDown(BUILD_REACH + 1));
    expect(r.controller.hudState().refusal).toBe(AIM_REFUSAL.outOfReach);
    r.bodies.push({ x: SPOT.x + 0.5, y: Math.floor(r.surface), z: SPOT.z + 0.5 });
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBe(AIM_REFUSAL.inTheWay);
  });

  it('breaks a block whatever the pool holds, and sends the break', () => {
    const r = stocked(0, 0, 0, 0);
    const y = Math.floor(r.surface);
    r.world.setBlock(SPOT.x, y, SPOT.z, packState(SHAPE.cube, MATERIAL.scrap));
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('primary');
    expect(r.sent).toEqual([{ type: 'break', x: SPOT.x, y, z: SPOT.z }]);
  });
});

describe('a heap of debris in the way of a placement', () => {
  /** A rig with a heap lying where the cursor points, and a pool that could pay for any block. */
  function heapUnderCursor(left = 3) {
    const r = rig();
    r.heaps.nodes.push({
      index: 0,
      x: SPOT.x + 0.5,
      y: r.surface,
      z: SPOT.z + 0.5,
      yaw: 0,
      scale: 1,
      harvests: 3,
      grade: MATERIAL.scrap,
      from: 0,
    });
    r.heaps.left[0] = left;
    r.pool.cap = 400;
    r.pool.stock.splice(0, 4, 50, 50, 50, 50);
    return r;
  }

  it('refuses a block on the cell the heap lies in, with its own words, before the pool is asked', () => {
    const r = heapUnderCursor();
    r.pool.stock[0] = 0;
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    r.controller.release('secondary');
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBe(DEBRIS_IN_THE_WAY);
  });

  it('shows the ghost as refused in Build Mode', () => {
    const r = heapUnderCursor();
    r.controller.toggleBuildMode();
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBe('debris is in the way');
    expect(r.controller.hudState().crosshair).toBe('blocked');
  });

  it('lets the block go once the heap is stripped bare, as the host would', () => {
    const r = heapUnderCursor();
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    r.controller.release('secondary');
    expect(r.sent).toEqual([]);
    r.heaps.left[0] = 0;
    r.controller.update(RESEND_GUARD, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent).toHaveLength(1);
  });

  it('does not keep a block off ground away from the heap', () => {
    const r = heapUnderCursor();
    r.heaps.nodes[0] = { ...r.heaps.nodes[0]!, x: SPOT.x + 10.5 };
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent).toHaveLength(1);
  });
});

describe('the module slot', () => {
  const terminal = packState(moduleShape(MODULE.terminal, 0), 1);

  it('sits after the blaster, and only there is a module in hand', () => {
    const { controller } = rig();
    expect(MODULE_SLOT).toBe(BLASTER_SLOT + 1);
    expect(MODULE_SLOT).toBeLessThan(HOTBAR_SLOTS);
    expect(HOTBAR_MODULES).toEqual([MODULE.terminal, MODULE.turret, MODULE.generator]);
    for (let slot = 0; slot < HOTBAR_SLOTS; slot++) {
      controller.selectSlot(slot);
      expect(controller.modular, `slot ${slot}`).toBe(slot === MODULE_SLOT);
      expect(controller.armed, `slot ${slot}`).toBe(slot === BLASTER_SLOT);
    }
  });

  it('holds the Research Terminal at its first level, before it is turned', () => {
    const { controller } = rig();
    controller.selectSlot(MODULE_SLOT);
    expect(controller.module).toBe(MODULE.terminal);
    expect(controller.piece).toBe(terminal);
    expect(controller.choice).toEqual({
      material: 1,
      kind: 'module',
      turn: 0,
      module: MODULE.terminal,
    });
    expect(controller.hudState()).toMatchObject({
      selected: MODULE_SLOT,
      module: MODULE.terminal,
      piece: terminal,
      blaster: false,
    });
  });

  it('turns through four facings, and the shape key keeps the block slots’ kind as it was', () => {
    const { controller } = rig();
    controller.cycleShape();
    expect(controller.kind).toBe('slab');
    controller.selectSlot(MODULE_SLOT);
    const turns = new Set<number>();
    for (let i = 0; i < MODULE_FACINGS * 2; i++) {
      turns.add(controller.turn);
      controller.turnPiece();
      expect(controller.turn).toBeLessThan(MODULE_FACINGS);
    }
    expect(turns.size).toBe(MODULE_FACINGS);
    // The shape key chooses the next module and starts its turn over, and leaves the block kind alone.
    controller.cycleShape();
    expect(controller.module).toBe(MODULE.turret);
    expect(controller.turn).toBe(0);
    expect(controller.kind).toBe('slab');
    controller.selectSlot(0);
    expect(controller.piece).toBe(packState(slabShape(false), MATERIAL.scrap));
  });

  it('starts the turn over on the way into and out of the slot, and keeps it between block slots', () => {
    const { controller } = rig();
    controller.cycleShape();
    controller.cycleShape();
    controller.turnPiece();
    controller.turnPiece();
    expect(controller.turn).toBe(2);
    controller.selectSlot(2);
    expect(controller.turn).toBe(2);
    controller.selectSlot(MODULE_SLOT);
    expect(controller.turn).toBe(0);
    controller.turnPiece();
    controller.selectSlot(0);
    expect(controller.turn).toBe(0);
    controller.scrollSlot(1);
    expect(controller.turn).toBe(0);
  });

  it('places the module the aim shows, and nothing else', () => {
    const r = rig();
    r.controller.selectSlot(MODULE_SLOT);
    r.controller.update(0.016, r.lookDown(3));
    const shown = r.controller.target.state;
    expect(moduleFacing(stateShape(shown))).toBeGreaterThanOrEqual(0);
    expect(stateShape(shown)).toBeGreaterThanOrEqual(SHAPE.module);
    // On the ground a module goes in the cell the ground cuts, or the one above it, as the aim decides.
    const { x, y, z } = r.controller.target.place;
    expect([Math.floor(r.surface), Math.floor(r.surface) + 1]).toContain(y);
    r.controller.press('secondary');
    r.controller.release('secondary');
    expect(r.sent).toEqual([{ type: 'place', x, y, z, state: shown }]);
  });

  it('breaks with a left click as a block does, and fires nothing', () => {
    const r = rig();
    const y = Math.floor(r.surface);
    r.world.setBlock(SPOT.x, y, SPOT.z, terminal);
    r.controller.selectSlot(MODULE_SLOT);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('primary');
    expect(r.sent).toEqual([{ type: 'break', x: SPOT.x, y, z: SPOT.z }]);
    expect(r.shots).toEqual([]);
  });

  it('charges 40 Scrap and says what is short', () => {
    const r = rig();
    r.pool.cap = 400;
    r.pool.stock.splice(0, 4, 39, 9, 9, 9);
    r.controller.selectSlot(MODULE_SLOT);
    r.controller.toggleBuildMode();
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBe(notEnough('Scrap'));
    expect(r.controller.hudState().crosshair).toBe('blocked');
    r.pool.stock[0] = 40;
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBeNull();
    expect(r.controller.hudState().crosshair).toBe('place');
  });

  it('chooses the Basic Turret and the Generator with the shape key, each at its first level, and goes round to the Terminal again', () => {
    const { controller } = rig();
    controller.selectSlot(MODULE_SLOT);
    expect(controller.module).toBe(MODULE.terminal);
    controller.cycleShape();
    expect(controller.module).toBe(MODULE.turret);
    expect(controller.piece).toBe(packState(moduleShape(MODULE.turret, 0), 1));
    expect(controller.choice).toEqual({
      material: 1,
      kind: 'module',
      turn: 0,
      module: MODULE.turret,
    });
    controller.cycleShape();
    expect(controller.module).toBe(MODULE.generator);
    expect(controller.piece).toBe(packState(moduleShape(MODULE.generator, 0), 1));
    controller.cycleShape();
    expect(controller.module).toBe(MODULE.terminal);
  });

  it('charges 25 Scrap for a turret, and sends the turret the aim shows', () => {
    const r = rig();
    r.pool.cap = 400;
    r.pool.stock.splice(0, 4, 24, 9, 9, 9);
    r.controller.selectSlot(MODULE_SLOT);
    r.controller.cycleShape();
    r.controller.toggleBuildMode();
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBe(notEnough('Scrap'));
    r.pool.stock[0] = 25;
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBeNull();
    const shown = r.controller.target.state;
    expect(moduleOfShape(stateShape(shown))?.id).toBe(MODULE.turret);
    expect(stateMaterial(shown)).toBe(1);
    const { x, y, z } = r.controller.target.place;
    r.controller.press('secondary');
    r.controller.release('secondary');
    expect(r.sent).toEqual([{ type: 'place', x, y, z, state: shown }]);
  });

  it('is never locked by a tier', () => {
    const r = rig();
    r.pool.cap = 400;
    r.pool.stock.splice(0, 4, 40, 0, 0, 0);
    r.pool.tier = 1;
    r.controller.selectSlot(MODULE_SLOT);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.press('secondary');
    expect(r.sent).toHaveLength(1);
  });

  it('holds the Generator back until a Terminal has read the Power points, in the words of a closed material', () => {
    const power = RESEARCH.groups[0].points;
    const r = rig();
    r.pool.cap = 400;
    r.pool.stock.splice(0, 4, 100, 0, 0, 0);
    r.pool.claimed = power - 1;
    r.controller.selectSlot(MODULE_SLOT);
    r.controller.cycleShape();
    r.controller.cycleShape();
    expect(r.controller.module).toBe(MODULE.generator);
    r.controller.toggleBuildMode();
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBe(needsResearch('Generator'));
    expect(r.controller.hudState().crosshair).toBe('blocked');
    r.controller.press('secondary');
    r.controller.release('secondary');
    expect(r.sent).toEqual([]);
    // The Terminal reads the points (and the refusal of the click has been on the screen long enough): the same click goes.
    r.pool.claimed = power;
    r.controller.update(NOTICE_SECONDS + 0.1, r.lookDown(3));
    expect(r.controller.hudState().refusal).toBeNull();
    expect(r.controller.hudState().crosshair).toBe('place');
    const shown = r.controller.target.state;
    expect(moduleOfShape(stateShape(shown))?.id).toBe(MODULE.generator);
    const { x, y, z } = r.controller.target.place;
    r.controller.press('secondary');
    r.controller.release('secondary');
    expect(r.sent).toEqual([{ type: 'place', x, y, z, state: shown }]);
  });

  it('does not hold a Terminal or a turret back for the Power points', () => {
    const r = rig();
    r.pool.cap = 400;
    r.pool.stock.splice(0, 4, 100, 0, 0, 0);
    r.pool.claimed = 0;
    r.controller.selectSlot(MODULE_SLOT);
    r.controller.toggleBuildMode();
    for (let i = 0; i < 2; i++) {
      r.controller.update(0.016, r.lookDown(3));
      expect(r.controller.hudState().refusal, `module ${r.controller.module}`).toBeNull();
      r.controller.cycleShape();
    }
  });
});

describe('the ring on the ground that shows how far power reaches', () => {
  const generator = packState(moduleShape(MODULE.generator, 0), 1);
  const terminal = packState(moduleShape(MODULE.terminal, 0), 1);

  /** The Generator in the module slot, the cursor looking down at the spot from 3 blocks up. */
  function holdingGenerator() {
    const r = rig();
    r.controller.selectSlot(MODULE_SLOT);
    r.controller.cycleShape();
    r.controller.cycleShape();
    expect(r.controller.module).toBe(MODULE.generator);
    return r;
  }

  it('is round the cell a Generator in hand would stand in', () => {
    const r = holdingGenerator();
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.target.hasPlace).toBe(true);
    const { place } = r.controller.target;
    expect(r.controller.reach.cell).toEqual({ x: place.x, y: place.y, z: place.z });
    expect(r.controller.reach.radius).toBe(POWER.generator.radius);
  });

  it('is nowhere while the cursor is on nothing a Generator could stand on', () => {
    const r = holdingGenerator();
    // Looking straight up at the sky.
    const origin = { x: SPOT.x + 0.5, y: r.surface + 3, z: SPOT.z + 0.5 };
    r.controller.update(0.016, { origin, dir: { x: 0, y: 1, z: 0 }, eye: origin });
    expect(r.controller.target.hasPlace).toBe(false);
    expect(r.controller.reach).toEqual({ cell: null, radius: 0 });
  });

  it('is nowhere for a module that gives nothing by radius, or a block', () => {
    const r = rig();
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.reach).toEqual({ cell: null, radius: 0 });
    r.controller.selectSlot(MODULE_SLOT);
    expect(r.controller.module).toBe(MODULE.terminal);
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.reach).toEqual({ cell: null, radius: 0 });
    r.controller.cycleShape();
    expect(r.controller.module).toBe(MODULE.turret);
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.reach).toEqual({ cell: null, radius: 0 });
  });

  it('is round a Generator the cursor is on, whatever is in hand', () => {
    const r = rig();
    const y = Math.floor(r.surface);
    r.world.setBlock(SPOT.x, y, SPOT.z, generator);
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.target.on).toBe('block');
    expect(r.controller.reach.cell).toEqual({ x: SPOT.x, y, z: SPOT.z });
    expect(r.controller.reach.radius).toBe(POWER.generator.radius);
    r.controller.selectSlot(BLASTER_SLOT);
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.reach.cell).toEqual({ x: SPOT.x, y, z: SPOT.z });
  });

  it('is not round a Terminal the cursor is on', () => {
    const r = rig();
    r.world.setBlock(SPOT.x, Math.floor(r.surface), SPOT.z, terminal);
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.target.on).toBe('block');
    expect(r.controller.reach).toEqual({ cell: null, radius: 0 });
  });

  it('is round the one in hand where it would stand, not the one the cursor is on', () => {
    const r = holdingGenerator();
    r.world.setBlock(SPOT.x, Math.floor(r.surface), SPOT.z, generator);
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.target.hasPlace).toBe(true);
    const { place, target } = r.controller.target;
    expect(place).not.toEqual(target);
    expect(r.controller.reach.cell).toEqual({ x: place.x, y: place.y, z: place.z });
  });
});

describe('the research ladder of a Terminal', () => {
  const terminal = packState(moduleShape(MODULE.terminal, 0), 1);

  /** A rig with a Research Terminal standing on the ground at the spot, and the cursor on it from `height` above. */
  function terminalAtSpot(height = 3) {
    const r = rig();
    const y = Math.floor(r.surface);
    r.world.setBlock(SPOT.x, y, SPOT.z, terminal);
    r.controller.update(0.016, r.lookDown(height));
    return { ...r, y };
  }

  it('is offered while the cursor is on a Terminal in reach, and E opens it and shuts it again', () => {
    const r = terminalAtSpot();
    expect(r.controller.hudState().terminal).toBe('aimed');
    expect(r.controller.ladderOpen).toBe(false);
    r.controller.interact();
    expect(r.controller.ladderOpen).toBe(true);
    expect(r.controller.hudState().terminal).toBe('open');
    r.controller.interact();
    expect(r.controller.ladderOpen).toBe(false);
    expect(r.controller.hudState().terminal).toBe('aimed');
    // It asks the host for nothing.
    expect(r.sent).toEqual([]);
  });

  it('is not offered for a plain block, bare ground or a Terminal out of reach', () => {
    const r = rig();
    r.world.setBlock(SPOT.x, Math.floor(r.surface), SPOT.z, packState(SHAPE.cube, MATERIAL.scrap));
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.target.on).toBe('block');
    expect(r.controller.hudState().terminal).toBe('none');
    r.controller.interact();
    expect(r.controller.ladderOpen).toBe(false);

    r.world.setBlock(SPOT.x, Math.floor(r.surface), SPOT.z, terminal);
    r.controller.update(0.016, r.lookDown(BUILD_REACH + 1));
    expect(r.controller.target.breakRefusal).toBe(AIM_REFUSAL.outOfReach);
    expect(r.controller.hudState().terminal).toBe('none');
    r.controller.interact();
    expect(r.controller.ladderOpen).toBe(false);

    r.world.setBlock(SPOT.x, Math.floor(r.surface), SPOT.z, 0);
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.target.on).toBe('terrain');
    expect(r.controller.hudState().terminal).toBe('none');
  });

  it('stays open as the player looks away, and shuts when the mouse is freed', () => {
    const r = terminalAtSpot();
    r.controller.interact();
    r.controller.update(0.016, {
      origin: { x: SPOT.x + 0.5, y: r.surface + 3, z: SPOT.z + 0.5 },
      dir: { x: 1, y: 0, z: 0 },
      eye: { x: SPOT.x + 0.5, y: r.surface + 3, z: SPOT.z + 0.5 },
    });
    expect(r.controller.target.on).not.toBe('block');
    expect(r.controller.ladderOpen).toBe(true);
    r.controller.clearAim();
    expect(r.controller.ladderOpen).toBe(false);
  });

  it('keeps showing a little past the reach that opened it, and shuts once the player is well away', () => {
    const r = terminalAtSpot();
    r.controller.interact();
    r.controller.update(0.016, r.lookDown(BUILD_REACH + 0.5));
    expect(r.controller.ladderOpen).toBe(true);
    r.controller.update(0.016, r.lookDown(LADDER_STAY + 1.5));
    expect(r.controller.ladderOpen).toBe(false);
    expect(r.controller.hudState().terminal).toBe('none');
  });

  it('shuts when the Terminal is gone, whoever broke it', () => {
    const r = terminalAtSpot();
    r.controller.interact();
    r.world.setBlock(SPOT.x, r.y, SPOT.z, 0);
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.ladderOpen).toBe(false);
  });

  it('shuts for a player who is down, and stays shut until it is opened again', () => {
    const r = terminalAtSpot();
    r.controller.interact();
    r.controller.setDown(true);
    expect(r.controller.ladderOpen).toBe(false);
    expect(r.controller.hudState().terminal).toBe('none');
    r.controller.interact();
    expect(r.controller.ladderOpen).toBe(false);
    r.controller.setDown(false);
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().terminal).toBe('aimed');
    r.controller.interact();
    expect(r.controller.ladderOpen).toBe(true);
  });

  it('is not offered when a heap of debris lies in front of the Terminal, which E strips instead', () => {
    const r = terminalAtSpot(4);
    const heap: DebrisNode = {
      index: 0,
      x: SPOT.x + 0.5,
      y: r.surface + 2,
      z: SPOT.z + 0.5,
      yaw: 0,
      scale: 1,
      harvests: 3,
      grade: MATERIAL.scrap,
      from: 0,
    };
    r.heaps.nodes.push(heap);
    r.heaps.left[0] = 3;
    r.controller.update(0.016, r.lookDown(4));
    expect(r.controller.salvageTarget.index).toBe(0);
    expect(r.controller.hudState().terminal).toBe('none');
    r.controller.interact();
    expect(r.controller.ladderOpen).toBe(false);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ type: 'harvest' });
  });

  it('ignores a heap of debris behind the Terminal', () => {
    const r = rig();
    const y = Math.floor(r.surface);
    // The Terminal is up on a pillar, three blocks over the heap, and the view is from above.
    r.world.setBlock(SPOT.x, y + 3, SPOT.z, terminal);
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
    r.controller.update(0.016, r.lookDown(6));
    // The Terminal is the first thing the view meets, so the heap under it is out of sight.
    expect(r.controller.salvageTarget.index).toBe(-1);
    expect(r.controller.hudState().terminal).toBe('aimed');
    r.controller.interact();
    expect(r.controller.ladderOpen).toBe(true);
    expect(r.sent).toEqual([]);
  });
});

describe('upgrading the block under the cursor with E', () => {
  const scrap = packState(SHAPE.cube, MATERIAL.scrap);
  const composite = packState(SHAPE.cube, MATERIAL.composite);

  /** A rig in Build Mode with `state` standing on the ground at the spot, a pool of 9 of everything and the cursor on it from `height` above. */
  function wallAtSpot(state = scrap, height = 3) {
    const r = rig();
    r.pool.cap = 400;
    r.pool.stock.splice(0, r.pool.stock.length, 9, 9, 9, 9);
    const y = Math.floor(r.surface);
    r.world.setBlock(SPOT.x, y, SPOT.z, state);
    r.controller.toggleBuildMode();
    r.controller.update(0.016, r.lookDown(height));
    return { ...r, y };
  }

  it('offers the next material up under the cursor, and E sends it as the piece the player saw', () => {
    const r = wallAtSpot();
    expect(r.controller.hudState().upgrade).toBe(composite);
    expect(r.controller.hudState().upgradeRefusal).toBeNull();
    r.controller.interact();
    expect(r.sent).toEqual([{ type: 'upgrade', x: SPOT.x, y: r.y, z: SPOT.z, state: composite }]);
    // The world changes only when the host's event comes back, never here.
    expect(r.world.getBlock(SPOT.x, r.y, SPOT.z)).toBe(scrap);
  });

  it('keeps the shape, the facing and the half of the cell the block has', () => {
    const slab = packState(slabShape(true), MATERIAL.composite);
    const r = wallAtSpot(slab);
    r.controller.interact();
    expect(r.sent[0]).toMatchObject({
      type: 'upgrade',
      state: packState(slabShape(true), MATERIAL.alloy),
    });
    const wedge = packState(wedgeShape(2, true), MATERIAL.alloy);
    const w = wallAtSpot(wedge);
    expect(w.controller.target.on).toBe('block');
    w.controller.interact();
    expect(w.sent[0]).toMatchObject({
      type: 'upgrade',
      state: packState(wedgeShape(2, true), MATERIAL.energy),
    });
  });

  it('climbs one material a press, up to the best there is', () => {
    const r = wallAtSpot();
    r.session.apply = true;
    for (const material of [MATERIAL.composite, MATERIAL.alloy, MATERIAL.energy]) {
      r.controller.interact();
      expect(r.world.getBlock(SPOT.x, r.y, SPOT.z)).toBe(packState(SHAPE.cube, material));
      r.controller.update(RESEND_GUARD, r.lookDown(3));
    }
    expect(r.sent.map((c) => c.type)).toEqual(['upgrade', 'upgrade', 'upgrade']);
    // Nothing is better than Energy-Infused: the card goes away and E says so.
    expect(r.controller.hudState().upgrade).toBe(0);
    r.controller.interact();
    expect(r.sent).toHaveLength(3);
    expect(r.controller.hudState().refusal).toBe(FULLY_UPGRADED);
  });

  it('works outside Build Mode too, as a click does, and the card is there while the upgrade would go', () => {
    const r = wallAtSpot();
    r.controller.toggleBuildMode();
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.inBuildMode).toBe(false);
    expect(r.controller.hudState().upgrade).toBe(composite);
    r.controller.interact();
    expect(r.sent).toEqual([{ type: 'upgrade', x: SPOT.x, y: r.y, z: SPOT.z, state: composite }]);
  });

  it('keeps the reason for a refusal off the screen outside Build Mode, until E asks', () => {
    const r = wallAtSpot();
    r.pool.stock[1] = 0;
    r.controller.update(0.016, r.lookDown(3));
    // In Build Mode the card is there, in red.
    expect(r.controller.hudState().upgrade).toBe(composite);
    expect(r.controller.hudState().upgradeRefusal).toBe(notEnough('Reinforced Composite'));
    r.controller.toggleBuildMode();
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().upgrade).toBe(0);
    expect(r.controller.hudState().upgradeRefusal).toBeNull();
    // A press still says why, for a moment, and sends nothing.
    r.controller.interact();
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBe(notEnough('Reinforced Composite'));
  });

  it('is not offered for bare ground, empty air or a block out of reach, and E says only what it can know', () => {
    const r = wallAtSpot();
    r.world.setBlock(SPOT.x, r.y, SPOT.z, 0);
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.target.on).toBe('terrain');
    expect(r.controller.hudState().upgrade).toBe(0);
    r.controller.interact();
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).not.toBe(FULLY_UPGRADED);

    r.world.setBlock(SPOT.x, r.y, SPOT.z, scrap);
    r.controller.update(0.016, r.lookDown(BUILD_REACH + 1));
    expect(r.controller.target.breakRefusal).toBe(AIM_REFUSAL.outOfReach);
    expect(r.controller.hudState().upgrade).toBe(0);
    r.controller.interact();
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBe(AIM_REFUSAL.outOfReach);
  });

  it('shows what the pool cannot pay for as refused, naming what is short, and sends nothing', () => {
    const r = wallAtSpot();
    r.pool.stock.splice(0, 4, 9, 0, 9, 9);
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().upgrade).toBe(composite);
    expect(r.controller.hudState().upgradeRefusal).toBe(notEnough('Reinforced Composite'));
    r.controller.interact();
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBe(notEnough('Reinforced Composite'));
    // Once the pool holds the price the same press goes.
    r.pool.stock[1] = 1;
    r.controller.update(NOTICE_SECONDS + 0.1, r.lookDown(3));
    expect(r.controller.hudState().upgradeRefusal).toBeNull();
    r.controller.interact();
    expect(r.sent).toHaveLength(1);
  });

  it('shows a material the crew has not researched as refused, in the words the host would use', () => {
    const r = wallAtSpot();
    r.pool.tier = 1;
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().upgradeRefusal).toBe(needsResearch('Reinforced Composite'));
    r.controller.interact();
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBe(needsResearch('Reinforced Composite'));
    r.pool.tier = 2;
    r.controller.update(NOTICE_SECONDS + 0.1, r.lookDown(3));
    expect(r.controller.hudState().upgradeRefusal).toBeNull();
  });

  it('charges and locks nothing where there is no pool to read, as the host does', () => {
    const r = wallAtSpot();
    r.pool.cap = 0;
    r.pool.tier = 1;
    r.pool.stock.fill(0);
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().upgrade).toBe(composite);
    expect(r.controller.hudState().upgradeRefusal).toBeNull();
    r.controller.interact();
    expect(r.sent).toHaveLength(1);
  });

  it('does not send the same upgrade twice before an answer could have come back', () => {
    const r = wallAtSpot();
    r.controller.interact();
    r.controller.update(0.1, r.lookDown(3));
    r.controller.interact();
    expect(r.sent).toHaveLength(1);
    r.controller.update(RESEND_GUARD, r.lookDown(3));
    r.controller.interact();
    expect(r.sent).toHaveLength(2);
  });

  it('says so when there is nobody to send to yet', () => {
    const r = wallAtSpot();
    r.session.open = false;
    r.controller.interact();
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBe(NOT_READY);
  });

  it('leaves a Terminal to its ladder and a heap of debris in front of the block to its strip', () => {
    const terminal = packState(moduleShape(MODULE.terminal, 0), 1);
    const r = wallAtSpot(terminal);
    expect(r.controller.hudState().upgrade).toBe(0);
    r.controller.interact();
    expect(r.controller.ladderOpen).toBe(true);
    expect(r.sent).toEqual([]);

    const h = wallAtSpot(scrap, 4);
    h.heaps.nodes.push({
      index: 0,
      x: SPOT.x + 0.5,
      y: h.surface + 2,
      z: SPOT.z + 0.5,
      yaw: 0,
      scale: 1,
      harvests: 3,
      grade: MATERIAL.scrap,
      from: 0,
    });
    h.heaps.left[0] = 3;
    h.controller.update(0.016, h.lookDown(4));
    expect(h.controller.salvageTarget.index).toBe(0);
    expect(h.controller.hudState().upgrade).toBe(0);
    h.controller.interact();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ type: 'harvest' });
  });

  it('is not offered while a ladder is open, and the first press shuts the ladder', () => {
    const terminal = packState(moduleShape(MODULE.terminal, 0), 1);
    const r = wallAtSpot(terminal);
    r.controller.interact();
    expect(r.controller.ladderOpen).toBe(true);
    // The cursor moves on to a plain block next door while the Terminal's ladder stays up.
    r.world.setBlock(SPOT.x + 1, Math.floor(r.surface), SPOT.z, scrap);
    const beside = { x: SPOT.x + 1.5, y: r.surface + 3, z: SPOT.z + 0.5 };
    const view = { origin: beside, dir: { x: 0, y: -1, z: 0 }, eye: beside };
    r.controller.update(0.016, view);
    expect(r.controller.target.targetState).toBe(scrap);
    expect(r.controller.ladderOpen).toBe(true);
    expect(r.controller.hudState().upgrade).toBe(0);
    r.controller.interact();
    expect(r.controller.ladderOpen).toBe(false);
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().upgrade).toBe(composite);
  });

  it('does nothing for a player who is down', () => {
    const r = wallAtSpot();
    r.controller.setDown(true);
    expect(r.controller.hudState().upgrade).toBe(0);
    r.controller.interact();
    expect(r.sent).toEqual([]);
    r.controller.setDown(false);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.interact();
    expect(r.sent).toHaveLength(1);
  });

  it('works with the blaster in hand: the key is the key, whatever the left button does', () => {
    const r = wallAtSpot();
    r.controller.selectSlot(BLASTER_SLOT);
    r.controller.update(0.016, r.lookDown(3));
    r.controller.interact();
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ type: 'upgrade' });
    expect(r.shots).toEqual([]);
  });
});

describe('raising a turret with E', () => {
  /** A turret facing west at `level`: its cell's material byte is its level. */
  const turret = (level: number) => packState(moduleShape(MODULE.turret, 2), level);

  /**
   * A rig in Build Mode with a turret at `level` standing at the spot, a pool of 99 of everything and
   * the cursor on it from `height` above. It stands a cell up, clear of the hill: the turret is lower
   * than a block, so the cursor would meet the hill first if the turret stood in it.
   */
  function turretAtSpot(level = 1, height = 3) {
    const r = rig();
    r.pool.cap = 400;
    r.pool.stock.splice(0, r.pool.stock.length, 99, 99, 99, 99);
    const y = Math.floor(r.surface) + 1;
    r.world.setBlock(SPOT.x, y, SPOT.z, turret(level));
    r.controller.toggleBuildMode();
    r.controller.update(0.016, r.lookDown(height));
    return { ...r, y };
  }

  it('offers the next level under the cursor, and E sends it as the piece the player saw, facing as it did', () => {
    const r = turretAtSpot();
    expect(r.controller.target.on).toBe('block');
    expect(r.controller.hudState().terminal).toBe('none');
    expect(r.controller.hudState().upgrade).toBe(turret(2));
    expect(r.controller.hudState().upgradeRefusal).toBeNull();
    r.controller.interact();
    expect(r.sent).toEqual([{ type: 'upgrade', x: SPOT.x, y: r.y, z: SPOT.z, state: turret(2) }]);
    // The world changes only when the host's event comes back, never here.
    expect(r.world.getBlock(SPOT.x, r.y, SPOT.z)).toBe(turret(1));
    expect(moduleFacing(stateShape(turret(2)))).toBe(moduleFacing(stateShape(turret(1))));
  });

  it('climbs one level a press, up to the top of the ladder, and then says so', () => {
    const r = turretAtSpot();
    r.session.apply = true;
    for (const level of [2, 3]) {
      r.controller.interact();
      expect(r.world.getBlock(SPOT.x, r.y, SPOT.z)).toBe(turret(level));
      r.controller.update(RESEND_GUARD, r.lookDown(3));
    }
    expect(r.sent.map((c) => c.type)).toEqual(['upgrade', 'upgrade']);
    // The Heavy Turret is the top: the card goes away and E says so.
    expect(r.controller.hudState().upgrade).toBe(0);
    r.controller.interact();
    expect(r.sent).toHaveLength(2);
    expect(r.controller.hudState().refusal).toBe(FULLY_UPGRADED);
  });

  it('shows a level whose material is short as refused, naming it, and sends nothing', () => {
    const r = turretAtSpot();
    r.pool.stock[1] = 9;
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().upgradeRefusal).toBe(notEnough('Reinforced Composite'));
    r.controller.interact();
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBe(notEnough('Reinforced Composite'));
    // The next step up is paid in Alloy, which the pool is short of instead.
    const heavy = turretAtSpot(2);
    heavy.pool.stock[2] = 0;
    heavy.controller.update(0.016, heavy.lookDown(3));
    expect(heavy.controller.hudState().upgrade).toBe(turret(3));
    expect(heavy.controller.hudState().upgradeRefusal).toBe(notEnough('Advanced Alloy'));
  });

  it('shows a level whose material the crew has not researched as refused, in the host’s words', () => {
    const r = turretAtSpot();
    r.pool.tier = 1;
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().upgradeRefusal).toBe(needsResearch('Reinforced Composite'));
    r.controller.interact();
    expect(r.sent).toEqual([]);
    // Composite is open at tier 2, but the Heavy Turret's Alloy waits for tier 3.
    r.pool.tier = 2;
    r.controller.update(NOTICE_SECONDS + 0.1, r.lookDown(3));
    expect(r.controller.hudState().upgradeRefusal).toBeNull();
    const heavy = turretAtSpot(2);
    heavy.pool.tier = 2;
    heavy.controller.update(0.016, heavy.lookDown(3));
    expect(heavy.controller.hudState().upgradeRefusal).toBe(needsResearch('Advanced Alloy'));
    heavy.pool.tier = 3;
    heavy.controller.update(NOTICE_SECONDS + 0.1, heavy.lookDown(3));
    expect(heavy.controller.hudState().upgradeRefusal).toBeNull();
  });

  it('keeps the card off the screen outside Build Mode while the upgrade would be refused', () => {
    const r = turretAtSpot();
    r.pool.stock[1] = 0;
    r.controller.toggleBuildMode();
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().upgrade).toBe(0);
    r.pool.stock[1] = 99;
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().upgrade).toBe(turret(2));
  });

  it('is not offered for a turret out of reach, and E says so', () => {
    const r = turretAtSpot(1, BUILD_REACH + 1);
    expect(r.controller.target.breakRefusal).toBe(AIM_REFUSAL.outOfReach);
    expect(r.controller.hudState().upgrade).toBe(0);
    r.controller.interact();
    expect(r.sent).toEqual([]);
    expect(r.controller.hudState().refusal).toBe(AIM_REFUSAL.outOfReach);
  });

  it('charges and locks nothing where there is no pool to read, as the host does', () => {
    const r = turretAtSpot();
    r.pool.cap = 0;
    r.pool.tier = 1;
    r.pool.stock.fill(0);
    r.controller.update(0.016, r.lookDown(3));
    expect(r.controller.hudState().upgrade).toBe(turret(2));
    expect(r.controller.hudState().upgradeRefusal).toBeNull();
    r.controller.interact();
    expect(r.sent).toHaveLength(1);
  });
});
