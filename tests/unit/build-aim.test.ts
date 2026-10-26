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
import {
  MATERIAL,
  MODULE,
  SHAPE,
  isUpsideDown,
  moduleFacing,
  moduleShape,
  packState,
  slabShape,
  stateMaterial,
  stateShape,
  wedgeFacing,
  wedgeShape,
} from '../../src/shared/blocks';
import type { Vec3 } from '../../src/shared/look';
import type { PieceChoice } from '../../src/shared/placement';
import { createTerrainGround } from '../../src/world/terrain/collision';
import { createWorld, type VoxelWorld } from '../../src/world/voxels/world';
import { TEST_SEED, terrain } from './helpers/valley';

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const BLOCK: PieceChoice = { material: MATERIAL.scrap, kind: 'cube', turn: 0 };
const SLAB: PieceChoice = { material: MATERIAL.scrap, kind: 'slab', turn: 0 };
const WEDGE: PieceChoice = { material: MATERIAL.scrap, kind: 'wedge', turn: 0 };
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
    piece: BLOCK,
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
    expect(aim.state).toBe(SCRAP);
    expect(aim.placeRefusal).toBeNull();
    expect(aim.distance).toBeCloseTo(3, 1);
  });

  it('has nothing to place when the selected item is not a block', () => {
    const world = newWorld();
    const aim = aimWith(lookDown(world, 3, { piece: null }));
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
    const aim = aimWith(lookDown(world, 3, { piece: { ...BLOCK, material: 200 } }));
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
      piece: BLOCK,
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

describe("the host's further rules", () => {
  it("are asked about the cell and the piece a click would place, and their reason is the ghost's", () => {
    const world = newWorld();
    const input = lookDown(world, 3);
    const open = aimWith(input);
    const asked: number[][] = [];
    const aim = aimWith({
      ...input,
      rules: (x, y, z, state) => {
        asked.push([x, y, z, state]);
        return 'not enough Scrap';
      },
    });
    expect(asked).toEqual([[open.place.x, open.place.y, open.place.z, open.state]]);
    expect(aim.placeRefusal).toBe('not enough Scrap');
    expect(aimWith({ ...input, rules: () => null }).placeRefusal).toBeNull();
  });

  it('come last, after reach, the world and the bodies, as the host asks them', () => {
    const world = newWorld();
    const input = lookDown(world, 3);
    const { x, y, z } = aimWith(input).place;
    const rules = () => 'not enough Scrap';
    // A player in the cell: the body is named first.
    expect(aimWith({ ...input, bodies: [{ x: x + 0.5, y, z: z + 0.5 }], rules }).placeRefusal).toBe(
      AIM_REFUSAL.inTheWay,
    );
    // Beyond reach: reach is named first.
    expect(aimWith({ ...lookDown(world, 7), rules }).placeRefusal).toBe(AIM_REFUSAL.outOfReach);
    // A world that refuses: its reason is named first.
    const refusing = {
      ...world,
      getBlock: world.getBlock.bind(world),
      checkBreak: world.checkBreak.bind(world),
      checkPlace: () => 'occupied',
    };
    expect(aimWith({ ...input, blocks: refusing, rules }).placeRefusal).toBe('occupied');
  });

  it('are not asked when there is nothing to place', () => {
    const world = newWorld();
    let asked = 0;
    const rules = () => {
      asked++;
      return 'not enough Scrap';
    };
    expect(aimWith({ ...lookDown(world, 3), piece: null, rules }).placeRefusal).toBeNull();
    expect(asked).toBe(0);
  });
});

/** Blocks held in a map, with the world's rules out of the way, so a test can set up any shape it likes. */
function cells(
  entries: readonly (readonly [number, number, number, number])[],
): AimInput['blocks'] {
  const map = new Map(entries.map(([x, y, z, state]) => [`${x},${y},${z}`, state]));
  return {
    getBlock: (x, y, z) => map.get(`${x},${y},${z}`) ?? 0,
    checkPlace: () => null,
    checkBreak: () => null,
  };
}

/** An aim from `from`, looking along `look` (not yet a unit vector), at the given cells. */
function aimIn(
  blocks: AimInput['blocks'],
  from: Vec3,
  look: Vec3,
  piece: PieceChoice | null = BLOCK,
  ground?: AimInput['ground'],
): Aim {
  const length = Math.hypot(look.x, look.y, look.z);
  const dir = { x: look.x / length, y: look.y / length, z: look.z / length };
  return aimWith({ blocks, ground, origin: from, eye: from, dir, piece, bodies: [] });
}

describe('aiming at a slab', () => {
  const lower = packState(slabShape(false), MATERIAL.alloy);
  const upper = packState(slabShape(true), MATERIAL.alloy);

  it('lands on the top of a lower slab, half a block down, and builds in the cell above', () => {
    const blocks = cells([[4, 0, 4, lower]]);
    const aim = aimIn(blocks, { x: 4.5, y: 4, z: 4.5 }, DOWN);
    expect(aim.on).toBe('block');
    expect(aim.target).toEqual({ x: 4, y: 0, z: 4 });
    expect(aim.targetState).toBe(lower);
    expect(aim.distance).toBeCloseTo(3.5, 6);
    expect(aim.place).toEqual({ x: 4, y: 1, z: 4 });
  });

  it('looks over the empty half of a lower slab to the block behind it', () => {
    const behind = packState(SHAPE.cube, MATERIAL.scrap);
    const blocks = cells([
      [4, 0, 4, lower],
      [6, 0, 4, behind],
    ]);
    // Level with the upper half of the slab's cell: nothing is there to hit.
    const high = aimIn(blocks, { x: 1.5, y: 0.75, z: 4.5 }, { x: 1, y: 0, z: 0 });
    expect(high.target).toEqual({ x: 6, y: 0, z: 4 });
    expect(high.place).toEqual({ x: 5, y: 0, z: 4 });
    // Level with the lower half: the slab's side face, and a block goes beside it.
    const low = aimIn(blocks, { x: 1.5, y: 0.25, z: 4.5 }, { x: 1, y: 0, z: 0 });
    expect(low.target).toEqual({ x: 4, y: 0, z: 4 });
    expect(low.place).toEqual({ x: 3, y: 0, z: 4 });
  });

  it('builds below an upper slab when the cursor is on its underside', () => {
    const blocks = cells([[4, 5, 4, upper]]);
    const aim = aimIn(blocks, { x: 4.5, y: 1, z: 4.5 }, { x: 0, y: 1, z: 0 });
    expect(aim.target).toEqual({ x: 4, y: 5, z: 4 });
    // The underside is inside the cell, half a block up from its floor.
    expect(aim.distance).toBeCloseTo(4.5, 6);
    expect(aim.place).toEqual({ x: 4, y: 4, z: 4 });
  });

  it('lays a held slab low on a surface and high under one', () => {
    const wall = packState(SHAPE.cube, MATERIAL.scrap);
    const blocks = cells([
      [4, 0, 4, wall],
      [8, 5, 4, wall],
    ]);
    const onTop = aimIn(blocks, { x: 4.5, y: 4, z: 4.5 }, DOWN, SLAB);
    expect(onTop.state).toBe(packState(slabShape(false), MATERIAL.scrap));
    const under = aimIn(blocks, { x: 8.5, y: 1, z: 4.5 }, { x: 0, y: 1, z: 0 }, SLAB);
    expect(under.place).toEqual({ x: 8, y: 4, z: 4 });
    expect(under.state).toBe(packState(slabShape(true), MATERIAL.scrap));
  });

  it('puts a held slab against a wall in the half of the cell the cursor is on', () => {
    const wall = packState(SHAPE.cube, MATERIAL.scrap);
    const blocks = cells([[6, 3, 4, wall]]);
    const east = { x: 1, y: 0, z: 0 };
    const low = aimIn(blocks, { x: 1.5, y: 3.2, z: 4.5 }, east, SLAB);
    expect(low.place).toEqual({ x: 5, y: 3, z: 4 });
    expect(low.state).toBe(packState(slabShape(false), MATERIAL.scrap));
    const high = aimIn(blocks, { x: 1.5, y: 3.8, z: 4.5 }, east, SLAB);
    expect(high.place).toEqual({ x: 5, y: 3, z: 4 });
    expect(high.state).toBe(packState(slabShape(true), MATERIAL.scrap));
  });

  it('turns the held slab over with the turn key', () => {
    const wall = packState(SHAPE.cube, MATERIAL.scrap);
    const blocks = cells([[4, 0, 4, wall]]);
    const flipped = aimIn(blocks, { x: 4.5, y: 4, z: 4.5 }, DOWN, { ...SLAB, turn: 1 });
    expect(flipped.state).toBe(packState(slabShape(true), MATERIAL.scrap));
  });

  it('puts a held slab in the half of the cell the ground leaves open', () => {
    // Flat ground at 2.3 cuts its cell low, so the slab sits on it; at 2.7 the lower half would be
    // buried and never seen, so the slab goes in the upper half.
    const flat = (height: number): AimInput['ground'] => ({ distance: (_x, y) => y - height });
    const blocks = cells([]);
    const from = { x: 4.5, y: 6, z: 4.5 };
    const low = aimIn(blocks, from, DOWN, SLAB, flat(2.3));
    expect(low.on).toBe('terrain');
    expect(low.place).toEqual({ x: 4, y: 2, z: 4 });
    expect(low.state).toBe(packState(slabShape(false), MATERIAL.scrap));
    const high = aimIn(blocks, from, DOWN, SLAB, flat(2.7));
    expect(high.place).toEqual({ x: 4, y: 2, z: 4 });
    expect(high.state).toBe(packState(slabShape(true), MATERIAL.scrap));
    // The turn key still flips either.
    const turned = aimIn(blocks, from, DOWN, { ...SLAB, turn: 1 }, flat(2.3));
    expect(turned.state).toBe(packState(slabShape(true), MATERIAL.scrap));
  });

  it('hangs a held slab high under ground that faces down', () => {
    // A ceiling of ground at 5.5 with the open air below it: the field is positive below the surface plane.
    const ceiling: AimInput['ground'] = { distance: (_x, y) => 5.5 - y };
    const aim = aimIn(cells([]), { x: 4.5, y: 2, z: 4.5 }, { x: 0, y: 1, z: 0 }, SLAB, ceiling);
    expect(aim.on).toBe('terrain');
    expect(aim.state).toBe(packState(slabShape(true), MATERIAL.scrap));
  });
});

describe('aiming at a wedge', () => {
  /** A wedge that rises toward +x, upright. */
  const ramp = packState(wedgeShape(0), MATERIAL.composite);

  it('hits the slope where the slope is', () => {
    const blocks = cells([[4, 0, 4, ramp]]);
    // Straight down through the middle of the cell the slope is half a block up.
    const aim = aimIn(blocks, { x: 4.5, y: 4, z: 4.5 }, DOWN);
    expect(aim.target).toEqual({ x: 4, y: 0, z: 4 });
    expect(aim.distance).toBeCloseTo(3.5, 6);
    // The slope faces up and back about equally; the vertical wins, so a block goes on top.
    expect(aim.place).toEqual({ x: 4, y: 1, z: 4 });
  });

  it('hits the tall wall from behind and builds beside it', () => {
    const blocks = cells([[4, 0, 4, ramp]]);
    const aim = aimIn(blocks, { x: 7.5, y: 0.5, z: 4.5 }, { x: -1, y: 0, z: 0 });
    expect(aim.target).toEqual({ x: 4, y: 0, z: 4 });
    // The wall stands on the edge of the cell at x = 5.
    expect(aim.distance).toBeCloseTo(2.5, 6);
    expect(aim.place).toEqual({ x: 5, y: 0, z: 4 });
  });

  it('hits the three-cornered side where the wedge is and not above the slope', () => {
    const blocks = cells([[4, 0, 4, ramp]]);
    const from = (y: number) => ({ x: 4.8, y, z: 7.5 });
    const south = { x: 0, y: 0, z: -1 };
    const low = aimIn(blocks, from(0.2), south);
    expect(low.target).toEqual({ x: 4, y: 0, z: 4 });
    expect(low.place).toEqual({ x: 4, y: 0, z: 5 });
    // At 0.9 the ray is above the slope (0.8 high at this x) and the side has no face there.
    expect(aimIn(blocks, from(0.9), south).on).toBe('nothing');
  });

  it('puts a held wedge on the surface rising away from the player', () => {
    const wall = packState(SHAPE.cube, MATERIAL.scrap);
    const blocks = cells([[4, 0, 4, wall]]);
    const from = { x: 3.5, y: 4, z: 4.5 };
    const toward = (x: number, z: number) => aimIn(blocks, from, { x, y: -3, z }, WEDGE);
    // Looking along +x and down onto the block's top.
    const east = toward(1, 0);
    expect(east.place).toEqual({ x: 4, y: 1, z: 4 });
    expect(stateShape(east.state)).toBe(wedgeShape(0));
    expect(stateMaterial(east.state)).toBe(MATERIAL.scrap);
    // Looking mostly along +z.
    const north = aimIn(blocks, { x: 4.5, y: 4, z: 3.2 }, { x: 0, y: -3, z: 1 }, WEDGE);
    expect(north.target).toEqual({ x: 4, y: 0, z: 4 });
    expect(wedgeFacing(stateShape(north.state))).toBe(1);
  });

  it('hangs a held wedge upside down under a ceiling', () => {
    const wall = packState(SHAPE.cube, MATERIAL.scrap);
    const blocks = cells([[4, 6, 4, wall]]);
    const aim = aimIn(blocks, { x: 4.5, y: 2, z: 4.5 }, { x: 0, y: 1, z: 0 }, WEDGE);
    expect(aim.place).toEqual({ x: 4, y: 5, z: 4 });
    expect(isUpsideDown(stateShape(aim.state))).toBe(true);
  });

  it('stands a held wedge upright on the ground, rising away from the player', () => {
    const flat: AimInput['ground'] = { distance: (_x, y) => y - 2.7 };
    const aim = aimIn(cells([]), { x: 2.5, y: 6, z: 4.5 }, { x: 1, y: -2, z: 0 }, WEDGE, flat);
    expect(aim.on).toBe('terrain');
    expect(wedgeFacing(stateShape(aim.state))).toBe(0);
    expect(isUpsideDown(stateShape(aim.state))).toBe(false);
  });

  it('checks the oriented piece against the world, not the base shape', () => {
    const seen: number[] = [];
    const blocks = {
      ...cells([[4, 0, 4, packState(SHAPE.cube, MATERIAL.scrap)]]),
      checkPlace: (_x: number, _y: number, _z: number, state: number) => {
        seen.push(state);
        return null;
      },
    };
    aimIn(blocks, { x: 4.5, y: 4, z: 4.5 }, DOWN, { ...SLAB, turn: 1 });
    expect(seen).toEqual([packState(slabShape(true), MATERIAL.scrap)]);
  });
});

describe('aiming with a module in hand', () => {
  const HELD: PieceChoice = { material: 1, kind: 'module', turn: 0, module: MODULE.terminal };
  const wall = packState(SHAPE.cube, MATERIAL.scrap);
  const terminal = (facing: number) => packState(moduleShape(MODULE.terminal, facing), 1);

  it('puts the module on a block facing the player, at level 1', () => {
    const blocks = cells([[4, 0, 4, wall]]);
    // Looking along +x and down onto the block's top: the module's front looks back at the player, along -x.
    const aim = aimIn(blocks, { x: 3.2, y: 4, z: 4.5 }, { x: 1, y: -3, z: 0 }, HELD);
    expect(aim.place).toEqual({ x: 4, y: 1, z: 4 });
    expect(aim.state).toBe(terminal(2));
    expect(stateMaterial(aim.state)).toBe(1);
    expect(moduleFacing(stateShape(aim.state))).toBe(2);
    // Turning the piece moves its front a quarter turn.
    const turned = aimIn(
      blocks,
      { x: 3.2, y: 4, z: 4.5 },
      { x: 1, y: -3, z: 0 },
      { ...HELD, turn: 1 },
    );
    expect(moduleFacing(stateShape(turned.state))).toBe(3);
  });

  it('asks the world about the module as it will stand, not about a base shape', () => {
    const seen: number[] = [];
    const blocks = {
      ...cells([[4, 0, 4, wall]]),
      checkPlace: (_x: number, _y: number, _z: number, state: number) => {
        seen.push(state);
        return null;
      },
    };
    aimIn(blocks, { x: 4.5, y: 4, z: 5.5 }, { x: 0, y: -3, z: -1 }, HELD);
    expect(seen).toEqual([terminal(1)]);
  });

  it('passes the world’s refusal of a module through, such as nothing to stand on', () => {
    const blocks = {
      ...cells([[4, 0, 4, wall]]),
      checkPlace: () => 'unsupported',
    };
    const aim = aimIn(blocks, { x: 3.2, y: 4, z: 4.5 }, { x: 1, y: -3, z: 0 }, HELD);
    expect(aim.placeRefusal).toBe('unsupported');
  });

  it('aims at a module by its body: the cursor passes through the gap between body and cell edge', () => {
    const blocks = cells([
      [4, 0, 4, wall],
      [4, 1, 4, terminal(0)],
      [4, 0, 5, wall],
    ]);
    // Through the middle of the cell the body fills (0.1 to 0.9 of it): a hit, and it is the module.
    const hit = aimIn(blocks, { x: 4.5, y: 1.5, z: 6.5 }, { x: 0, y: 0, z: -1 }, null);
    expect(hit.target).toEqual({ x: 4, y: 1, z: 4 });
    // At 0.05 of the cell the ray is in the gap beside the body, and passes on to what is behind.
    const miss = aimIn(blocks, { x: 4.05, y: 1.5, z: 6.5 }, { x: 0, y: 0, z: -1 }, null);
    expect(miss.on).toBe('nothing');
  });
});
