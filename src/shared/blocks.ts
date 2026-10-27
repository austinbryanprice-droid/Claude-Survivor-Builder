import type { CellState } from './block-world';

/**
 * The content of the voxel world as data: which shapes a cell can take and which materials they
 * can be made of. A cell state packs the two into 16 bits, the shape in the low byte and the
 * material in the high byte, so an upgrade is a new material on the same shape and the world can
 * be re-meshed in place. Ids are stored in saves and sent over the wire, so they never change
 * once shipped; add new ones at the end of their group.
 *
 * A shape id names a kind and, where the kind has them, an orientation, so a placed piece is one
 * number and nothing else has to travel with it:
 *
 *  - `SHAPE.cube`: the whole cell.
 *  - `SHAPE.slab` + 0 is a slab filling the lower half of the cell, + 1 the upper half.
 *  - `SHAPE.wedge` + facing is a wedge that rises toward +x (facing 0), +z (1), -x (2) or -z (3),
 *    and + 4 turns it upside down: the sloped face then looks down and the flat one is on top.
 *    A wedge is half a cube cut along the diagonal, so its slope is 45 degrees and rises one block.
 *  - `SHAPE.module` + (module - 1) * 4 + facing is a functional module (Phase 5d): a model drawn in
 *    code that stands in one cell, its front looking toward +x (facing 0), +z (1), -x (2) or -z (3).
 *    The material byte of a module is its level, 1 for the model as it is built and up for its
 *    upgrades, so a module is placed, broken and upgraded as any block is.
 */

export const SHAPE = {
  empty: 0,
  cube: 1,
  slab: 8,
  wedge: 16,
  module: 32,
} as const;

/** The kinds of structural piece a material makes. */
export type BlockKind = 'cube' | 'slab' | 'wedge';

export type ShapeKind = BlockKind | 'module';

/** The kinds of block a player chooses between, in the order the shape key cycles through them. */
export const SHAPE_KINDS: readonly BlockKind[] = ['cube', 'slab', 'wedge'];

export const MATERIAL = {
  none: 0,
  scrap: 1,
  composite: 2,
  alloy: 3,
  energy: 4,
} as const;

export interface ShapeDef {
  readonly id: number;
  /** What a player calls it; every orientation of a kind shares one name. */
  readonly name: string;
  readonly kind: ShapeKind;
}

/** How many ways a module can face: the way its front looks, toward +x, +z, -x or -z. */
export const MODULE_FACINGS = 4;

/**
 * How a module meets the ground, which cuts through a cell at any height. A module stands on a
 * foundation that reaches down into the ground, so its cell may float up to `MODULE_FOOT` over the
 * ground at its middle; and where the ground reaches higher than `MODULE_SINK` of a cell, the cursor
 * puts the module in the cell above it, rather than bury it. The host's rule and the cursor share
 * both, so a click that passes one passes the other.
 */
export const MODULE_FOOT = 0.9;
export const MODULE_SINK = 0.25;

/** The functional modules (SPEC section 9). Ids are stored in saves and sent on the wire, so they never change. */
export const MODULE = {
  terminal: 1,
  turret: 2,
  generator: 3,
  node: 4,
  storage: 5,
  bed: 6,
  light: 7,
} as const;

/**
 * One step up a module's ladder (SPEC section 9: basic turret, auto-turret, heavy turret): the module as
 * it stands at its next level. Raising a standing module to it takes `cost` from the shared pool and
 * the piece it replaces is used up, as in every upgrade (Phase 5e). What opens it is the research of the
 * material that pays, as a block of that material is opened, so a step has no row of its own.
 */
export interface ModuleRaise {
  /** What a player calls the module at this level. */
  readonly name: string;
  /** What raising a standing module to this level takes from the pool, and what breaking it gives back. */
  readonly cost: { readonly material: number; readonly amount: number };
}

export interface ModuleDef {
  readonly id: number;
  /** What a player calls it as it is built, at its first level. */
  readonly name: string;
  /**
   * The levels above the first, from the second: its cell's material byte is its level, 1 for the model
   * as it is built and one more for each step here. Empty for a module that stays as it is built.
   */
  readonly raises: readonly ModuleRaise[];
  /** What placing it takes from the shared pool: so many of a material, whatever way it faces. */
  readonly cost: { readonly material: number; readonly amount: number };
  /**
   * The part of its cell it fills, as a box in cell coordinates (0 to 1, y up) with its front toward
   * +x. Movement collides with it and the cursor aims at it; the model is drawn in code and fits
   * inside the cell.
   */
  readonly body: readonly [x0: number, y0: number, z0: number, x1: number, y1: number, z1: number];
  /**
   * Which way its front looks when the aim places it, before the turn key: toward the player who aims
   * it, so that a console's screen is what they see, or the way the player looks, so that a gun points
   * where they were looking.
   */
  readonly facesPlayer: boolean;
}

export interface MaterialDef {
  readonly id: number;
  readonly name: string;
  /** 1 for Scrap up to 4 for Energy-Infused (spec section 9). */
  readonly tier: number;
  /**
   * What one block costs, in units of the shared pool's stock of this material, whatever its shape.
   * Build Mode shows it, the host takes it from the pool when a block is placed and gives it back
   * when a player breaks one (Phase 5b), and the balance pass (5j) tunes the numbers.
   */
  readonly cost: number;
}

/**
 * The modules, in the order of their ids. The Research Terminal is the first (Phase 5d), the Basic
 * Turret the second (5f), the Generator the third (5g1), the Power Node the fourth (5g2), Storage the
 * fifth (5h1), the Bed the sixth (5h2) and the Light the seventh (5h3). The costs of building one are
 * Scrap only (about 40, 25, 40, 12, 30, 20 and 10), because the notes price them in Composite, which the
 * Terminal itself unlocks (docs/decisions.md); the Turret's two steps up are paid in the better materials
 * (5f2). What opens the Generator and the Node, and Storage, the Bed and the Light, is a group of research
 * points, not a material (`RESEARCH.groups`).
 */
export const MODULES: readonly ModuleDef[] = [
  {
    id: MODULE.terminal,
    name: 'Research Terminal',
    raises: [],
    cost: { material: MATERIAL.scrap, amount: 40 },
    body: [0.1, 0, 0.1, 0.9, 0.9, 0.9],
    facesPlayer: true,
  },
  {
    id: MODULE.turret,
    name: 'Basic Turret',
    // Judged by the balance pass (5j): the second step costs twice the first, as a better material costs more.
    raises: [
      { name: 'Auto Turret', cost: { material: MATERIAL.composite, amount: 10 } },
      { name: 'Heavy Turret', cost: { material: MATERIAL.alloy, amount: 20 } },
    ],
    cost: { material: MATERIAL.scrap, amount: 25 },
    body: [0.14, 0, 0.14, 0.86, 0.78, 0.86],
    facesPlayer: false,
  },
  {
    id: MODULE.generator,
    name: 'Generator',
    raises: [],
    cost: { material: MATERIAL.scrap, amount: 40 },
    body: [0.12, 0, 0.12, 0.88, 0.85, 0.88],
    facesPlayer: true,
  },
  {
    id: MODULE.node,
    name: 'Power Node',
    raises: [],
    // A relay is cheap, so a crew can carry power across a base with a few of them.
    cost: { material: MATERIAL.scrap, amount: 12 },
    body: [0.18, 0, 0.18, 0.82, 0.95, 0.82],
    facesPlayer: true,
  },
  {
    id: MODULE.storage,
    name: 'Storage',
    raises: [],
    // It raises the pool's ceiling for good (`POOL.perStorage`), so it costs about what the other base modules do.
    cost: { material: MATERIAL.scrap, amount: 30 },
    body: [0.07, 0, 0.1, 0.93, 0.72, 0.9],
    facesPlayer: true,
  },
  {
    id: MODULE.bed,
    name: 'Bed',
    raises: [],
    // A cot is the cheapest comfort: a crew puts one where it fights, so it is not much to lose.
    cost: { material: MATERIAL.scrap, amount: 20 },
    // Lying along z with its long side toward +x, and low enough for a body to step up onto.
    body: [0.14, 0, 0.03, 0.86, 0.46, 0.97],
    facesPlayer: true,
  },
  {
    id: MODULE.light,
    name: 'Light',
    raises: [],
    // The cheapest module, so that a crew can light the whole of a base and not one corner of it.
    cost: { material: MATERIAL.scrap, amount: 10 },
    // The footprint of its pad and the height of its mast: a lamp is easy to walk round, and the cursor finds the pad.
    body: [0.25, 0, 0.25, 0.75, 0.95, 0.75],
    facesPlayer: true,
  },
];

/** How many levels a module has: the one it is built at and one for each step up its ladder. */
export function moduleLevels(module: ModuleDef): number {
  return 1 + module.raises.length;
}

/** What a module is called at a level (1 is as it is built), or its first name for a level it does not have. */
export function moduleLevelName(module: ModuleDef, level: number): string {
  return module.raises[level - 2]?.name ?? module.name;
}

/** What building a module at a level takes from the pool: its own price as it is built, the step's price above that. */
export function moduleLevelCost(
  module: ModuleDef,
  level: number,
): { readonly material: number; readonly amount: number } {
  return module.raises[level - 2]?.cost ?? module.cost;
}

/** The shape id of a module standing so its front looks toward `facing` (0 is +x, 1 is +z, 2 is -x, 3 is -z). */
export function moduleShape(module: number, facing: number): number {
  const turn = ((Math.round(facing) % MODULE_FACINGS) + MODULE_FACINGS) % MODULE_FACINGS;
  return SHAPE.module + (module - 1) * MODULE_FACINGS + turn;
}

/** The module with this id (`MODULE`), or undefined when the table has none. */
export function moduleDef(module: number): ModuleDef | undefined {
  return MODULES.find((def) => def.id === module);
}

/** The module a shape id names, or undefined when the shape is not a module. */
export function moduleOfShape(shape: number): ModuleDef | undefined {
  if (shape < SHAPE.module) return undefined;
  return moduleDef(Math.floor((shape - SHAPE.module) / MODULE_FACINGS) + 1);
}

/** The way a module's front looks, 0 to 3, or -1 when the shape is not a module. */
export function moduleFacing(shape: number): number {
  return moduleOfShape(shape) === undefined ? -1 : (shape - SHAPE.module) % MODULE_FACINGS;
}

export const SHAPES: readonly ShapeDef[] = [
  { id: SHAPE.cube, name: 'Block', kind: 'cube' },
  ...[0, 1].map((half): ShapeDef => ({ id: SHAPE.slab + half, name: 'Slab', kind: 'slab' })),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((turn): ShapeDef => ({
    id: SHAPE.wedge + turn,
    name: 'Wedge',
    kind: 'wedge',
  })),
  ...MODULES.flatMap((def) =>
    Array.from({ length: MODULE_FACINGS }, (_, facing): ShapeDef => ({
      id: moduleShape(def.id, facing),
      name: def.name,
      kind: 'module',
    })),
  ),
];

/** The four directions a wedge can rise toward: +x, +z, -x, -z. */
export const WEDGE_FACINGS = 4;

/** The shape a kind of block starts as: the whole cell, the lower slab, the wedge rising toward +x. */
export function baseShape(kind: BlockKind): number {
  if (kind === 'slab') return SHAPE.slab;
  if (kind === 'wedge') return SHAPE.wedge;
  return SHAPE.cube;
}

/** The id of a slab in the lower or the upper half of its cell. */
export function slabShape(upper: boolean): number {
  return SHAPE.slab + (upper ? 1 : 0);
}

/** The id of a wedge rising toward `facing` (0 is +x, 1 is +z, 2 is -x, 3 is -z), optionally upside down. */
export function wedgeShape(facing: number, upsideDown = false): number {
  const turn = ((Math.round(facing) % WEDGE_FACINGS) + WEDGE_FACINGS) % WEDGE_FACINGS;
  return SHAPE.wedge + turn + (upsideDown ? WEDGE_FACINGS : 0);
}

/** What kind of shape an id names, or undefined for an id the table does not define. */
export function shapeKind(shape: number): ShapeKind | undefined {
  return SHAPES.find((s) => s.id === shape)?.kind;
}

/** The direction a wedge rises toward, 0 to 3, or -1 when the shape is not a wedge. */
export function wedgeFacing(shape: number): number {
  return shapeKind(shape) === 'wedge' ? (shape - SHAPE.wedge) % WEDGE_FACINGS : -1;
}

/** True for a slab in the upper half of its cell and for a wedge turned upside down. */
export function isUpsideDown(shape: number): boolean {
  const kind = shapeKind(shape);
  if (kind === 'slab') return shape === SHAPE.slab + 1;
  if (kind === 'wedge') return shape - SHAPE.wedge >= WEDGE_FACINGS;
  return false;
}

/**
 * The four materials. A block costs more the better it is (SPEC section 9: "upgrade costs rise with tier"):
 * 1, 2, 3 and 5 of its own material, which is also what an upgrade in place to it takes. The balance
 * simulator (`src/systems/economy/simulator.ts`) holds these to the spec's pace; docs/decisions.md, Phase 5j.
 */
export const MATERIALS: readonly MaterialDef[] = [
  { id: MATERIAL.scrap, name: 'Scrap', tier: 1, cost: 1 },
  { id: MATERIAL.composite, name: 'Reinforced Composite', tier: 2, cost: 2 },
  { id: MATERIAL.alloy, name: 'Advanced Alloy', tier: 3, cost: 3 },
  { id: MATERIAL.energy, name: 'Energy-Infused', tier: 4, cost: 5 },
];

/** How many different tiles each material has. Each face of each block picks one by chance, so a wall is never a stamp. */
export const TILE_LAYOUTS = 4;

const MAX_STATE = 0xffff;

/** Packs a shape and a material into a cell state. */
export function packState(shape: number, material: number): CellState {
  return ((material & 0xff) << 8) | (shape & 0xff);
}

export function stateShape(state: CellState): number {
  return state & 0xff;
}

export function stateMaterial(state: CellState): number {
  return (state >> 8) & 0xff;
}

/** The same shape in another material: what an in-place upgrade does to a cell. */
export function withMaterial(state: CellState, material: number): CellState {
  return packState(stateShape(state), material);
}

/** True for a whole number a cell can hold: 0 (empty) up to 65535. */
export function isCellState(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_STATE;
}

/**
 * True when the state names a shape and a material the tables define, so it can be placed. A module's
 * material byte is its level, so it is known when it is a level the module has.
 */
export function isKnownState(state: CellState): boolean {
  if (!isCellState(state)) return false;
  const shape = stateShape(state);
  const material = stateMaterial(state);
  if (!SHAPES.some((s) => s.id === shape)) return false;
  const module = moduleOfShape(shape);
  if (module) return material >= 1 && material <= moduleLevels(module);
  return MATERIALS.some((m) => m.id === material);
}

/** The material a cell state is made of, or undefined when the tables do not know it. */
export function materialOf(state: CellState): MaterialDef | undefined {
  const id = stateMaterial(state);
  return MATERIALS.find((m) => m.id === id);
}

/** The tier of a material (1 for Scrap up to 4), or 1 for an id the table does not know. */
export function materialTier(id: number): number {
  return MATERIALS.find((m) => m.id === id)?.tier ?? 1;
}

/**
 * What a player calls a placed piece, such as "Scrap Block", "Research Terminal" or "Auto Turret", or
 * an empty string for a state the tables do not know.
 */
export function pieceName(state: CellState): string {
  const module = moduleOfShape(stateShape(state));
  if (module) return isKnownState(state) ? moduleLevelName(module, stateMaterial(state)) : '';
  const material = materialOf(state);
  const shape = SHAPES.find((s) => s.id === stateShape(state));
  return material && shape ? `${material.name} ${shape.name}` : '';
}
