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
 */

export const SHAPE = {
  empty: 0,
  cube: 1,
  slab: 8,
  wedge: 16,
} as const;

export type ShapeKind = 'cube' | 'slab' | 'wedge';

/** The kinds a player chooses between, in the order the shape key cycles through them. */
export const SHAPE_KINDS: readonly ShapeKind[] = ['cube', 'slab', 'wedge'];

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

export const SHAPES: readonly ShapeDef[] = [
  { id: SHAPE.cube, name: 'Block', kind: 'cube' },
  ...[0, 1].map((half): ShapeDef => ({ id: SHAPE.slab + half, name: 'Slab', kind: 'slab' })),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((turn): ShapeDef => ({
    id: SHAPE.wedge + turn,
    name: 'Wedge',
    kind: 'wedge',
  })),
];

/** The four directions a wedge can rise toward: +x, +z, -x, -z. */
export const WEDGE_FACINGS = 4;

/** The shape a kind starts as: the whole cell, the lower slab, the wedge rising toward +x. */
export function baseShape(kind: ShapeKind): number {
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

export const MATERIALS: readonly MaterialDef[] = [
  { id: MATERIAL.scrap, name: 'Scrap', tier: 1, cost: 1 },
  { id: MATERIAL.composite, name: 'Reinforced Composite', tier: 2, cost: 1 },
  { id: MATERIAL.alloy, name: 'Advanced Alloy', tier: 3, cost: 1 },
  { id: MATERIAL.energy, name: 'Energy-Infused', tier: 4, cost: 1 },
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

/** True when the state names a shape and a material the tables define, so it can be placed. */
export function isKnownState(state: CellState): boolean {
  if (!isCellState(state)) return false;
  const shape = stateShape(state);
  const material = stateMaterial(state);
  return SHAPES.some((s) => s.id === shape) && MATERIALS.some((m) => m.id === material);
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

/** What a player calls a placed piece, such as "Scrap Block", or an empty string for a state the tables do not know. */
export function pieceName(state: CellState): string {
  const material = materialOf(state);
  const shape = SHAPES.find((s) => s.id === stateShape(state));
  return material && shape ? `${material.name} ${shape.name}` : '';
}
