import { describe, expect, it } from 'vitest';
import { updateAim, createAim } from '../../src/shared/build-aim';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';
import { TICK_SECONDS } from '../../src/shared/fixed-step';
import type { GroundQuery } from '../../src/shared/ground';
import { createPlayerState, stepPlayer } from '../../src/shared/movement';
import { castRay, createRayHit } from '../../src/shared/raycast';
import {
  CORE_FOOTPRINT,
  CORE_HEIGHT,
  CORE_SKIRT,
  outpostDistance,
  outpostFor,
  withOutpost,
} from '../../src/world/outpost';
import { createTerrainGround } from '../../src/world/terrain/collision';
import { CRASH, WORLD_HALF } from '../../src/world/terrain/field';
import { VoxelWorld, createWorld } from '../../src/world/voxels/world';
import { input } from './helpers';
import { TEST_SEED, terrain, valley } from './helpers/valley';

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);

function coreWorld(): VoxelWorld {
  return createWorld(TEST_SEED, terrain());
}

/** Every cell of the box the Core fills, as "x,y,z". */
function coreCells(world: VoxelWorld): string[] {
  const core = world.outpost;
  if (!core) throw new Error('This world has no Core');
  const cells: string[] = [];
  for (let y = core.baseY - 2; y < core.baseY + CORE_HEIGHT + 2; y++) {
    for (let z = core.cellZ - 2; z < core.cellZ + CORE_FOOTPRINT + 2; z++) {
      for (let x = core.cellX - 2; x < core.cellX + CORE_FOOTPRINT + 2; x++) {
        if (core.contains(x, y, z)) cells.push(`${x},${y},${z}`);
      }
    }
  }
  return cells;
}

describe('where the Outpost Core stands', () => {
  const { grid } = valley();
  const core = outpostFor((x, z) => grid.groundAt(x, z));

  it('is centered on the crash site and fills a box of whole cells', () => {
    expect(core.x).toBeCloseTo(CRASH.x + 0.5, 6);
    expect(core.z).toBeCloseTo(CRASH.z + 0.5, 6);
    expect(Number.isInteger(core.cellX) && Number.isInteger(core.cellZ)).toBe(true);
    expect(Number.isInteger(core.baseY)).toBe(true);
    expect(core.x - core.cellX).toBe(CORE_FOOTPRINT / 2);
    expect(core.z - core.cellZ).toBe(CORE_FOOTPRINT / 2);
  });

  it('holds exactly footprint × footprint × height cells', () => {
    const world = coreWorld();
    expect(coreCells(world)).toHaveLength(CORE_FOOTPRINT * CORE_FOOTPRINT * CORE_HEIGHT);
  });

  it('contains its corners and nothing a cell beyond them', () => {
    const { cellX, cellZ, baseY } = core;
    const last = CORE_FOOTPRINT - 1;
    expect(core.contains(cellX, baseY, cellZ)).toBe(true);
    expect(core.contains(cellX + last, baseY + CORE_HEIGHT - 1, cellZ + last)).toBe(true);
    expect(core.contains(cellX - 1, baseY, cellZ)).toBe(false);
    expect(core.contains(cellX + CORE_FOOTPRINT, baseY, cellZ)).toBe(false);
    expect(core.contains(cellX, baseY - 1, cellZ)).toBe(false);
    expect(core.contains(cellX, baseY + CORE_HEIGHT, cellZ)).toBe(false);
    expect(core.contains(cellX, baseY, cellZ - 1)).toBe(false);
    expect(core.contains(cellX, baseY, cellZ + CORE_FOOTPRINT)).toBe(false);
  });

  it('starts at the middle of the ground under it: little of it buried, any gap beneath filled by its foundation', () => {
    let lowest = Infinity;
    let highest = -Infinity;
    for (let i = 0; i <= 12; i++) {
      for (let j = 0; j <= 12; j++) {
        const h = grid.groundAt(
          core.cellX + (CORE_FOOTPRINT * i) / 12,
          core.cellZ + (CORE_FOOTPRINT * j) / 12,
        );
        lowest = Math.min(lowest, h);
        highest = Math.max(highest, h);
      }
    }
    expect(Math.abs(core.baseY - (lowest + highest) / 2)).toBeLessThanOrEqual(0.5);
    // The foundation that is drawn below the base is deep enough to meet the lowest ground.
    expect(core.baseY - lowest).toBeLessThan(CORE_SKIRT);
    // And no more than a block of the plinth is buried where the ground is highest.
    expect(highest - core.baseY).toBeLessThan(1);
    // The crater floor is nearly level, and the box stands taller than the ground does.
    expect(highest - lowest).toBeLessThan(1);
    expect(core.baseY + CORE_HEIGHT).toBeGreaterThan(highest + 2);
  });

  it('is the same for every peer that builds the same seed', () => {
    const again = outpostFor((x, z) => valley().grid.groundAt(x, z));
    expect({ ...again, contains: undefined }).toEqual({ ...core, contains: undefined });
    expect(coreWorld().outpost?.baseY).toBe(core.baseY);
  });
});

describe('how far a point is from the Core', () => {
  const core = outpostFor((x, z) => valley().grid.groundAt(x, z));
  const midY = core.baseY + CORE_HEIGHT / 2;
  const half = CORE_FOOTPRINT / 2;

  it('is negative inside, zero on a face and the plain distance in front of one', () => {
    expect(outpostDistance(core, core.x, midY, core.z)).toBeCloseTo(
      -Math.min(half, CORE_HEIGHT / 2),
      9,
    );
    expect(outpostDistance(core, core.x + half, midY, core.z)).toBeCloseTo(0, 9);
    expect(outpostDistance(core, core.x + half + 3, midY, core.z)).toBeCloseTo(3, 9);
    expect(outpostDistance(core, core.x, core.baseY + CORE_HEIGHT + 2, core.z)).toBeCloseTo(2, 9);
  });

  it('is the straight line to the nearest edge or corner beyond one', () => {
    expect(outpostDistance(core, core.x + half + 3, midY, core.z + half + 4)).toBeCloseTo(5, 9);
    expect(
      outpostDistance(core, core.x + half + 1, core.baseY + CORE_HEIGHT + 2, core.z + half + 2),
    ).toBeCloseTo(3, 9);
  });
});

describe('the Core in the voxel world', () => {
  it('is solid for movement and the camera, but holds no block', () => {
    const world = coreWorld();
    const core = world.outpost!;
    for (const cell of coreCells(world)) {
      const [x, y, z] = cell.split(',').map(Number) as [number, number, number];
      expect(world.isSolid(x, y, z), cell).toBe(true);
      expect(world.getBlock(x, y, z), cell).toBe(0);
      // A whole cube to the movement code: no partial boxes.
      expect(world.boxesAt(x, y, z), cell).toBeNull();
    }
    expect(world.isSolid(core.cellX - 1, core.baseY, core.cellZ)).toBe(false);
    expect(world.isSolid(core.cellX, core.baseY + CORE_HEIGHT, core.cellZ)).toBe(false);
  });

  it('is not an edit: it is never saved, sent or counted as a block', () => {
    const world = coreWorld();
    const seen: string[] = [];
    world.forEachEdit((x, y, z) => seen.push(`${x},${y},${z}`));
    expect(seen).toEqual([]);
    expect(world.blockCount).toBe(0);
    expect(world.chunkCount).toBe(0);
    expect(world.revision).toBe(0);
    expect(world.dirtyCount).toBe(0);
  });

  it('refuses a block in any of its cells, and says why', () => {
    const world = coreWorld();
    for (const cell of coreCells(world)) {
      const [x, y, z] = cell.split(',').map(Number) as [number, number, number];
      expect(world.checkPlace(x, y, z, SCRAP), cell).toBe('reserved');
    }
  });

  it('has nothing to break in its cells', () => {
    const world = coreWorld();
    const core = world.outpost!;
    expect(world.checkBreak(core.cellX + 1, core.baseY + 1, core.cellZ + 1)).toBe('empty');
  });

  it('lets players build right up against it, on the ground or on its roof', () => {
    const world = coreWorld();
    const core = world.outpost!;
    // Beside the base: the ground carries it, and the Core does too.
    expect(world.checkPlace(core.cellX - 1, core.baseY, core.cellZ, SCRAP)).toBeNull();
    // On top, a cell in the air that only the Core holds up.
    expect(
      world.checkPlace(core.cellX + 1, core.baseY + CORE_HEIGHT, core.cellZ + 1, SCRAP),
    ).toBeNull();
    // Part-way up a wall of it: nothing but the Core to rest on.
    expect(
      world.checkPlace(core.cellX + CORE_FOOTPRINT, core.baseY + 3, core.cellZ, SCRAP),
    ).toBeNull();
    // A world without a Core has nothing there to hold a block up.
    const bare = new VoxelWorld(TEST_SEED, terrain());
    expect(bare.checkPlace(core.cellX + CORE_FOOTPRINT, core.baseY + 3, core.cellZ, SCRAP)).toBe(
      'unsupported',
    );
  });

  it('is built from the seed alone, so a joining player has the same one', () => {
    const a = coreWorld();
    const b = coreWorld();
    expect(coreCells(a)).toEqual(coreCells(b));
  });
});

describe('walking into the Core', () => {
  function walkAt(world: VoxelWorld, fromX: number, z: number, toward: number, seconds: number) {
    const ground = createTerrainGround(valley().grid, WORLD_HALF - 1);
    const collision = {
      isSolid: (x: number, y: number, z: number) => world.isSolid(x, y, z),
      boxesAt: (x: number, y: number, z: number) => world.boxesAt(x, y, z),
      ground,
    };
    const player = createPlayerState(fromX, valley().grid.groundAt(fromX, z) + 0.05, z);
    const walk = input({ forward: 1, yaw: toward });
    for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) {
      stepPlayer(player, walk, TICK_SECONDS, collision);
    }
    return player;
  }

  it('stops a player at its face', () => {
    const world = coreWorld();
    const core = world.outpost!;
    const face = core.cellX + CORE_FOOTPRINT;
    // Yaw π/2 walks toward -x: from the east side straight at the Core.
    const player = walkAt(world, face + 5, core.z, Math.PI / 2, 6);
    expect(player.x).toBeGreaterThan(face);
    expect(player.x).toBeLessThan(face + 0.6);
  });

  it('would walk straight through the same spot if there were no Core', () => {
    const bare = new VoxelWorld(TEST_SEED, terrain(), null);
    const core = coreWorld().outpost!;
    const face = core.cellX + CORE_FOOTPRINT;
    const player = walkAt(bare, face + 5, core.z, Math.PI / 2, 6);
    // The only thing the bare run is missing is the Core, and it ends far past its middle.
    expect(player.x).toBeLessThan(core.cellX);
  });
});

describe('aiming at the Core', () => {
  const world = coreWorld();
  const core = world.outpost!;
  const terrainGround = createTerrainGround(valley().grid, WORLD_HALF - 1);
  const withCore = withOutpost(terrainGround, core);
  const eyeY = core.baseY + 1.6;
  const origin = { x: core.cellX + CORE_FOOTPRINT + 4.5, y: eyeY, z: core.z };
  const west = { x: -1, y: 0, z: 0 };

  it('stops the cursor on its face and offers the cell in front of it', () => {
    const hit = createRayHit();
    expect(castRay({ blocks: world, ground: withCore }, origin, west, 8, hit)).toBe(true);
    expect(hit.kind).toBe('terrain');
    expect(hit.distance).toBeCloseTo(4.5, 2);
    expect(hit.nx).toBe(1);
    expect([hit.x, hit.y, hit.z]).toEqual([
      core.cellX + CORE_FOOTPRINT,
      Math.floor(eyeY),
      Math.floor(core.z),
    ]);
  });

  it('would see straight through it on the bare terrain', () => {
    const hit = createRayHit();
    castRay({ blocks: world, ground: terrainGround }, origin, west, 8, hit);
    // Eight blocks reaches only the far side of the Core's box, and the bare ground shows nothing nearer.
    expect(hit.kind === 'terrain' ? hit.distance : Infinity).not.toBeCloseTo(4.5, 1);
  });

  it('lets a click build against the face but not into it', () => {
    const aim = createAim();
    const eye = { x: origin.x, y: eyeY, z: origin.z };
    updateAim(aim, {
      blocks: world,
      ground: withCore,
      origin,
      dir: west,
      eye,
      piece: { kind: 'cube', material: MATERIAL.scrap, turn: 0 },
      bodies: [],
    });
    expect(aim.on).toBe('terrain');
    expect(aim.hasPlace).toBe(true);
    expect(aim.place.x).toBe(core.cellX + CORE_FOOTPRINT);
    expect(aim.placeRefusal).toBeNull();
  });
});

describe('the ground with the Core in it', () => {
  it('answers pushes and snaps with the terrain alone', () => {
    const calls: string[] = [];
    const inner: GroundQuery = {
      distance: () => 20,
      pushOut: () => {
        calls.push('push');
        return true;
      },
      snapDown: () => {
        calls.push('snap');
        return false;
      },
    };
    const core = outpostFor((x, z) => valley().grid.groundAt(x, z));
    const wrapped = withOutpost(inner, core);
    const body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    expect(wrapped.pushOut(body, 0.3, [0.3])).toBe(true);
    expect(wrapped.snapDown(body, 0.3, 0.3, 0.5)).toBe(false);
    expect(calls).toEqual(['push', 'snap']);
    // Far from the Core the terrain's distance stands; near it, the Core's does.
    expect(wrapped.distance(core.x + 50, core.baseY, core.z)).toBe(20);
    expect(wrapped.distance(core.x + CORE_FOOTPRINT / 2 + 3, core.baseY + 1, core.z)).toBeCloseTo(
      3,
      9,
    );
    expect(wrapped.distance(core.x, core.baseY + 1, core.z)).toBeLessThan(0);
  });
});
