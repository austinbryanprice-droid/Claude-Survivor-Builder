import { describe, expect, it } from 'vitest';
import {
  AIM_EXTRA,
  AIM_REFUSAL,
  BUILD_REACH,
  bodyOverlapsCell,
  createAim,
  updateAim,
  type Aim,
  type AimInput,
} from '../../src/shared/build-aim';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';
import type { Vec3 } from '../../src/shared/look';
import { createTerrainGround } from '../../src/world/terrain/collision';
import { createWorld, type VoxelWorld } from '../../src/world/voxels/world';
import { TEST_SEED, terrain } from './helpers/valley';

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const DOWN: Vec3 = { x: 0, y: -1, z: 0 };

/** A column in the crash clearing, where the ground is open and gentle. */
const SPOT = { x: 8, z: -4 };

function newWorld(): VoxelWorld {
  return createWorld(TEST_SEED, terrain());
}

function surface(world: VoxelWorld): number {
  return world.terrain.grid.groundAt(SPOT.x + 0.5, SPOT.z + 0.5);
}

/** An aim input from a point `height` above the ground at the spot, looking straight down. */
function lookDown(world: VoxelWorld, height: number, overrides: Partial<AimInput> = {}): AimInput {
  const origin = { x: SPOT.x + 0.5, y: surface(world) + height, z: SPOT.z + 0.5 };
  return {
    blocks: world,
    ground: createTerrainGround(world.terrain.grid, 90),
    origin,
    dir: DOWN,
    eye: origin,
    piece: SCRAP,
    bodies: [],
    ...overrides,
  };
}

function aimWith(input: AimInput): Aim {
  const aim = createAim();
  updateAim(aim, input);
  return aim;
}

describe('aiming at the terrain', () => {
  it('names the cell the ground passes through, and lets a block go there', () => {
    const world = newWorld();
    const aim = aimWith(lookDown(world, 3));
    expect(aim.on).toBe('terrain');
    expect(aim.hasPlace).toBe(true);
    expect(aim.place).toEqual({ x: SPOT.x, y: Math.floor(surface(world)), z: SPOT.z });
    expect(aim.placeRefusal).toBeNull();
    expect(aim.distance).toBeCloseTo(3, 1);
  });

  it('has nothing to place when the selected item is not a block', () => {
    const world = newWorld();
    const aim = aimWith(lookDown(world, 3, { piece: 0 }));
    expect(aim.on).toBe('terrain');
    expect(aim.hasPlace).toBe(false);
  });

  it('refuses a target just beyond reach, and sees nothing past that', () => {
    const world = newWorld();
    const near = aimWith(lookDown(world, BUILD_REACH - 1));
    expect(near.placeRefusal).toBeNull();
    const far = aimWith(lookDown(world, BUILD_REACH + 1));
    expect(far.on).toBe('terrain');
    expect(far.placeRefusal).toBe(AIM_REFUSAL.outOfReach);
    const beyond = aimWith(lookDown(world, BUILD_REACH + AIM_EXTRA + 1));
    expect(beyond.on).toBe('nothing');
    expect(beyond.hasPlace).toBe(false);
  });

  it('passes the world’s own refusal through', () => {
    const world = newWorld();
    const aim = aimWith(lookDown(world, 3, { piece: 0xffff }));
    expect(aim.placeRefusal).toBe('unknown-block');
  });
});

describe('aiming at a block', () => {
  /** A block resting on the ground at the spot, or `lift` cells higher (a ray level with it then runs clear of the hills). */
  function withBlock(lift = 0): { world: VoxelWorld; x: number; y: number; z: number } {
    const world = newWorld();
    const x = SPOT.x;
    const z = SPOT.z;
    const y = Math.floor(surface(world)) + lift;
    expect(world.setBlock(x, y, z, SCRAP)).toBe(true);
    return { world, x, y, z };
  }

  it('targets the block and puts the new one on the face the cursor is on', () => {
    const { world, x, y, z } = withBlock();
    // From above: the top face, so the new block goes on top.
    const top = aimWith(lookDown(world, 3));
    expect(top.on).toBe('block');
    expect(top.target).toEqual({ x, y, z });
    expect(top.breakRefusal).toBeNull();
    expect(top.place).toEqual({ x, y: y + 1, z });
    expect(top.placeRefusal).toBeNull();
  });

  it('puts the new block on the side face the cursor is on', () => {
    const { world, x, y, z } = withBlock(3);
    // From the west, level with the block: the west face.
    const eye = { x: x - 3, y: y + 0.5, z: z + 0.5 };
    const side = aimWith({
      ...lookDown(world, 3),
      origin: eye,
      eye,
      dir: { x: 1, y: 0, z: 0 },
    });
    expect(side.on).toBe('block');
    expect(side.target).toEqual({ x, y, z });
    expect(side.place).toEqual({ x: x - 1, y, z });
    expect(side.placeRefusal).toBeNull();
  });

  it('shows a block out of reach but will not break it', () => {
    const { world, x, y, z } = withBlock();
    const origin = { x: x + 0.5, y: y + 0.5 + BUILD_REACH + 1, z: z + 0.5 };
    const aim = aimWith({ ...lookDown(world, 3), origin, eye: origin });
    expect(aim.on).toBe('block');
    expect(aim.breakRefusal).toBe(AIM_REFUSAL.outOfReach);
  });

  it('passes the world’s reasons for a refused break and a refused placement through', () => {
    const blocks = {
      getBlock: (x: number, y: number, z: number) => (x === 5 && y === 0 && z === 0 ? SCRAP : 0),
      checkPlace: () => 'buried',
      checkBreak: () => 'out-of-bounds',
    };
    const eye = { x: 0.5, y: 0.5, z: 0.5 };
    const aim = aimWith({
      blocks,
      origin: eye,
      eye,
      dir: { x: 1, y: 0, z: 0 },
      piece: SCRAP,
      bodies: [],
    });
    expect(aim.on).toBe('block');
    expect(aim.breakRefusal).toBe('out-of-bounds');
    expect(aim.placeRefusal).toBe('buried');
  });

  it('does not let a camera behind the player aim at what stands between them', () => {
    const { world, x, y, z } = withBlock(3);
    // The player stands 1.5 east of the block looking west; the camera is 3 behind them, to the
    // east, and a second block sits between the camera and the player.
    world.setBlock(x + 4, y, z, SCRAP);
    const eye = { x: x + 2.5, y: y + 0.5, z: z + 0.5 };
    const camera = { x: x + 5.5, y: y + 0.5, z: z + 0.5 };
    const aim = aimWith({
      ...lookDown(world, 3),
      origin: camera,
      eye,
      dir: { x: -1, y: 0, z: 0 },
    });
    expect(aim.on).toBe('block');
    expect(aim.target).toEqual({ x, y, z });
    // Reach and distance are the eyes', not the camera's.
    expect(aim.breakRefusal).toBeNull();
    expect(aim.distance).toBeCloseTo(1.5, 1);
  });
});

describe('bodies in the way', () => {
  it('refuses a cell a player stands in', () => {
    const world = newWorld();
    const input = lookDown(world, 3);
    const { x, y, z } = aimWith(input).place;
    const feet = { x: x + 0.5, y, z: z + 0.5 };
    expect(aimWith({ ...input, bodies: [feet] }).placeRefusal).toBe(AIM_REFUSAL.inTheWay);
    // Another player two blocks off is no problem.
    expect(aimWith({ ...input, bodies: [{ x: x + 2.5, y, z: z + 0.5 }] }).placeRefusal).toBeNull();
  });

  it('measures the overlap as the host does, margin included', () => {
    const feet = { x: 5.5, y: 10, z: 5.5 };
    // In the cell: yes. Two cells off: no.
    expect(bodyOverlapsCell(feet, 5, 10, 5)).toBe(true);
    expect(bodyOverlapsCell(feet, 7, 10, 5)).toBe(false);
    expect(bodyOverlapsCell(feet, 4, 10, 5)).toBe(false);
    // The margin: a body that only touches a cell's wall counts as overlapping it.
    expect(bodyOverlapsCell({ ...feet, x: 5.7 }, 6, 10, 5)).toBe(true);
    expect(bodyOverlapsCell({ ...feet, x: 5.64 }, 6, 10, 5)).toBe(false);
    // Head room: the body is 1.8 tall, so the cell above the feet is in the way and the next is not.
    expect(bodyOverlapsCell(feet, 5, 11, 5)).toBe(true);
    expect(bodyOverlapsCell(feet, 5, 12, 5)).toBe(false);
    // Below the feet only the margin reaches.
    expect(bodyOverlapsCell(feet, 5, 9, 5)).toBe(true);
    expect(bodyOverlapsCell({ ...feet, y: 10.06 }, 5, 9, 5)).toBe(false);
  });
});
