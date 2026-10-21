import { MATERIAL, SHAPE, packState, slabShape, wedgeShape } from '../../shared/blocks';
import type { CellState } from '../../shared/block-world';
import type { VoxelWorld } from './world';

/**
 * Structures that build themselves, for looking at the block renderer before players can build.
 * `?demo=outpost` raises a small walled outpost near the crash site; `?demo=swatch` stands the
 * four material tiers side by side; `?demo=hall` raises a gabled hall to show slabs and wedges.
 * All of them place pieces the way a player would, one at a time and each only where
 * `checkPlace` allows, so the demo proves the same rules the host will enforce.
 */

export const DEMO_NAMES = ['outpost', 'swatch', 'hall'] as const;
export type DemoName = (typeof DEMO_NAMES)[number];

export function isDemoName(value: string | null | undefined): value is DemoName {
  return (DEMO_NAMES as readonly (string | null | undefined)[]).includes(value);
}

/** A circle on the ground, in meters, where the demo stands. */
export interface DemoClearing {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export interface DemoEdit {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly state: CellState;
}

export interface DemoResult {
  /** The blocks placed, in the order they went down. */
  readonly edits: readonly DemoEdit[];
  /** Blocks the world refused; zero on the default valley. */
  readonly refused: number;
  /** Height of the floor's lower face. */
  readonly floorY: number;
  /** Where the structure stands, so the scenery can keep clear of it. */
  readonly clearing: DemoClearing;
}

const { scrap, composite, alloy, energy } = MATERIAL;

/** An inclusive box of cells, with coordinates relative to the demo's south-west corner. */
interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
}

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => ({
  x0,
  y0,
  z0,
  x1,
  y1,
  z1,
});

interface PlanCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly material: number;
  readonly shape: number;
}

/** A plan is drawn with these, in order: later boxes paint over earlier ones, `clear` cuts holes. */
class Plan {
  readonly cells = new Map<string, PlanCell>();

  fill(b: Box, material: number, shape: number = SHAPE.cube): this {
    for (let y = b.y0; y <= b.y1; y++)
      for (let z = b.z0; z <= b.z1; z++)
        for (let x = b.x0; x <= b.x1; x++) this.put(x, y, z, material, shape);
    return this;
  }

  /** One cell of any shape. */
  put(x: number, y: number, z: number, material: number, shape: number = SHAPE.cube): this {
    this.cells.set(`${x},${y},${z}`, { x, y, z, material, shape });
    return this;
  }

  clear(b: Box): this {
    for (let y = b.y0; y <= b.y1; y++)
      for (let z = b.z0; z <= b.z1; z++)
        for (let x = b.x0; x <= b.x1; x++) this.cells.delete(`${x},${y},${z}`);
    return this;
  }

  /** A column from the floor up to and including `top`. */
  column(x: number, z: number, top: number, material: number): this {
    return this.fill(box(x, 0, z, x, top, z), material);
  }
}

/** The outpost: an 11 by 9 floor, walls with a gate and windows, a courtyard roof, four towers, a core and a stair. */
function outpostPlan(): Plan {
  const plan = new Plan();
  // Floor, with a composite inlay and an alloy square under the core.
  plan.fill(box(0, 0, 0, 10, 0, 8), scrap);
  plan.fill(box(3, 0, 2, 7, 0, 6), composite);
  plan.fill(box(4, 0, 3, 6, 0, 5), alloy);
  // Walls three high, composite along the top row.
  plan.fill(box(0, 1, 0, 10, 3, 0), scrap).fill(box(0, 1, 8, 10, 3, 8), scrap);
  plan.fill(box(0, 1, 0, 0, 3, 8), scrap).fill(box(10, 1, 0, 10, 3, 8), scrap);
  plan.fill(box(0, 3, 0, 10, 3, 0), composite).fill(box(0, 3, 8, 10, 3, 8), composite);
  plan.fill(box(0, 3, 0, 0, 3, 8), composite).fill(box(10, 3, 0, 10, 3, 8), composite);
  // The gate faces east, toward the lake; windows look north and west and onto the lake side of the south wall.
  plan.clear(box(10, 1, 3, 10, 3, 5));
  plan.clear(box(3, 2, 0, 4, 2, 0)).clear(box(6, 2, 0, 7, 2, 0));
  plan.clear(box(0, 2, 3, 0, 2, 5));
  plan.clear(box(7, 2, 8, 8, 2, 8));
  // Roof: composite with an alloy rim, and an open courtyard over the core.
  plan.fill(box(0, 4, 0, 10, 4, 8), composite);
  plan.fill(box(0, 4, 0, 10, 4, 0), alloy).fill(box(0, 4, 8, 10, 4, 8), alloy);
  plan.fill(box(0, 4, 0, 0, 4, 8), alloy).fill(box(10, 4, 0, 10, 4, 8), alloy);
  plan.clear(box(3, 4, 2, 7, 4, 6));
  // Towers at the four corners, alloy, with a composite band and an energy lamp on top.
  for (const [tx, tz] of [
    [0, 0],
    [9, 0],
    [0, 7],
    [9, 7],
  ] as const) {
    plan.fill(box(tx, 1, tz, tx + 1, 4, tz + 1), alloy);
    plan.fill(box(tx, 5, tz, tx + 1, 5, tz + 1), composite);
    const lx = tx === 0 ? 0 : 10;
    const lz = tz === 0 ? 0 : 8;
    plan.fill(box(lx, 6, lz, lx, 6, lz), alloy);
    plan.fill(box(lx, 7, lz, lx, 7, lz), energy);
  }
  // The core: an alloy pedestal with an energy column, and four composite posts around it.
  plan.fill(box(4, 1, 3, 6, 1, 5), alloy);
  plan.fill(box(5, 1, 4, 5, 3, 4), energy);
  for (const [px, pz] of [
    [4, 3],
    [6, 3],
    [4, 5],
    [6, 5],
  ] as const) {
    plan.column(px, pz, 2, composite).fill(box(px, 0, pz, px, 0, pz), alloy);
    plan.fill(box(px, 1, pz, px, 1, pz), alloy);
  }
  // A stair up the south side to the roof, one block a step.
  plan.column(2, 9, 1, scrap).column(3, 9, 2, scrap).column(4, 9, 3, scrap);
  plan.column(5, 9, 4, composite);
  // Lamp posts either side of the gate.
  for (const z of [2, 6]) {
    plan.column(11, z, 3, alloy);
    plan.fill(box(11, 4, z, 11, 4, z), energy);
  }
  return plan;
}

/** Four walls of five blocks by four, one per tier, each with a two block cube in front of it. */
function swatchPlan(): Plan {
  const plan = new Plan();
  [scrap, composite, alloy, energy].forEach((material, i) => {
    const x = i * 7;
    plan.fill(box(x, 0, 0, x + 4, 0, 6), scrap);
    plan.fill(box(x, 1, 0, x + 4, 4, 0), material);
    plan.fill(box(x + 1, 1, 3, x + 2, 2, 4), material);
  });
  return plan;
}

// The directions a wedge can rise toward, as `wedgeShape` takes them.
const PLUS_X = 0;
const MINUS_X = 2;
const MINUS_Z = 3;

/**
 * A hall under a gabled roof, to show slabs and wedges: a platform with a ramp up to it, composite
 * walls with a door whose top corners are cut by upside-down wedges, slit windows with slab sills,
 * and a roof of wedges stepped up to a ridge, with eaves and gable overhangs. The front, with the
 * ramp and the lamp posts, faces south (+z).
 */
function hallPlan(): Plan {
  const plan = new Plan();
  // The platform, one block high, and the ramp that climbs to its front edge.
  plan.fill(box(0, 0, 0, 9, 0, 9), scrap);
  plan.fill(box(3, 0, 10, 6, 0, 10), scrap, wedgeShape(MINUS_Z));
  // Walls, three high, with the door in the front (south) wall.
  plan.fill(box(1, 1, 1, 8, 3, 1), composite).fill(box(1, 1, 8, 8, 3, 8), composite);
  plan.fill(box(1, 1, 1, 1, 3, 8), composite).fill(box(8, 1, 1, 8, 3, 8), composite);
  plan.clear(box(4, 1, 8, 5, 2, 8));
  // The top corners of the doorway are cut away by upside-down wedges, so it reads as an arch.
  plan.put(4, 2, 8, composite, wedgeShape(MINUS_X, true));
  plan.put(5, 2, 8, composite, wedgeShape(PLUS_X, true));
  // Windows: the upper half of a cell is open above a slab sill.
  for (const z of [3, 4, 5, 6]) {
    plan.put(1, 2, z, composite, slabShape(false)).put(8, 2, z, composite, slabShape(false));
  }
  for (const x of [2, 7]) plan.put(x, 2, 8, composite, slabShape(false));
  // The roof: wedges climb from the eaves, cubes fill the gable behind them. It stands one block
  // past the walls at both ends, and the first wedge of each slope hangs over the wall as an eave.
  for (let z = 0; z <= 9; z++) {
    plan.put(0, 3, z, alloy, wedgeShape(PLUS_X)).put(9, 3, z, alloy, wedgeShape(MINUS_X));
    for (let row = 0; row < 4; row++) {
      const left = 1 + row;
      const right = 8 - row;
      plan.put(left, 4 + row, z, alloy, wedgeShape(PLUS_X));
      plan.put(right, 4 + row, z, alloy, wedgeShape(MINUS_X));
      if (right - left > 1) plan.fill(box(left + 1, 4 + row, z, right - 1, 4 + row, z), alloy);
    }
  }
  // Lamp posts either side of the ramp, each capped with an energy lamp and a slab.
  for (const x of [2, 7]) {
    plan.fill(box(x, 0, 10, x, 2, 10), alloy);
    plan.put(x, 3, 10, energy);
    plan.put(x, 4, 10, alloy, slabShape(false));
  }
  return plan;
}

const PLANS: Record<
  DemoName,
  { plan: () => Plan; origin: { x: number; z: number }; width: number; depth: number }
> = {
  outpost: { plan: outpostPlan, origin: { x: -5, z: 3 }, width: 12, depth: 10 },
  swatch: { plan: swatchPlan, origin: { x: -6, z: 14 }, width: 28, depth: 7 },
  hall: { plan: hallPlan, origin: { x: -5, z: 3 }, width: 10, depth: 11 },
};

/** The lowest y at which a block can stand in a column of the terrain, or null where none can. */
function lowestLegalY(world: VoxelWorld, x: number, z: number, state: CellState): number | null {
  const { grid } = world.terrain;
  let low = Infinity;
  let high = -Infinity;
  for (const [dx, dz] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    const h = grid.groundAt(x + dx, z + dz);
    if (h < low) low = h;
    if (h > high) high = h;
  }
  for (let y = Math.max(0, Math.floor(low) - 1); y <= Math.ceil(high) + 1; y++) {
    if (world.checkPlace(x, y, z, state) === null) return y;
  }
  return null;
}

/**
 * Builds a demo structure on the terrain. The floor sits at one height over the whole site: the
 * highest of the lowest legal heights across its columns, so the ground never leaves a gap under
 * the structure, and lower columns get a foundation of scrap. Blocks go down from the bottom up,
 * and every one is checked with `checkPlace` first.
 */
export function buildDemo(world: VoxelWorld, name: DemoName): DemoResult {
  const { plan: makePlan, origin, width, depth } = PLANS[name];
  const plan = makePlan();
  const cells = [...plan.cells.values()];
  const probe = packState(SHAPE.cube, scrap);

  // Every column the plan touches, and where the ground lets it begin.
  const bases = new Map<string, number>();
  let floorY = -Infinity;
  for (const { x, z } of cells) {
    const key = `${x},${z}`;
    if (bases.has(key)) continue;
    const base = lowestLegalY(world, origin.x + x, origin.z + z, probe);
    if (base === null) continue;
    bases.set(key, base);
    floorY = Math.max(floorY, base);
  }

  const edits: DemoEdit[] = [];
  const wanted: DemoEdit[] = [];
  for (const [key, base] of bases) {
    const [x, z] = key.split(',').map(Number) as [number, number];
    for (let y = base; y < floorY; y++) {
      wanted.push({ x: origin.x + x, y, z: origin.z + z, state: packState(SHAPE.cube, scrap) });
    }
  }
  for (const c of cells) {
    if (!bases.has(`${c.x},${c.z}`)) continue;
    wanted.push({
      x: origin.x + c.x,
      y: floorY + c.y,
      z: origin.z + c.z,
      state: packState(c.shape, c.material),
    });
  }
  wanted.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);

  // A piece that hangs out over the edge of the structure can only go down once what holds it is
  // there, so what the world refuses is tried again after the rest, until a pass places nothing.
  let pending = wanted;
  while (pending.length > 0) {
    const later: DemoEdit[] = [];
    for (const edit of pending) {
      if (world.checkPlace(edit.x, edit.y, edit.z, edit.state) === null) {
        world.setBlock(edit.x, edit.y, edit.z, edit.state);
        edits.push(edit);
      } else {
        later.push(edit);
      }
    }
    if (later.length === pending.length) break;
    pending = later;
  }
  const refused = pending.length;

  return {
    edits,
    refused,
    floorY,
    clearing: {
      x: origin.x + width / 2,
      z: origin.z + depth / 2,
      radius: Math.hypot(width, depth) / 2 + 2.5,
    },
  };
}
