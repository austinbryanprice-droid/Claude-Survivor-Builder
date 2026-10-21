import type { CellState } from './block-world';

/**
 * The content of the voxel world as data: which shapes a cell can take and which materials they
 * can be made of. A cell state packs the two into 16 bits, the shape in the low byte and the
 * material in the high byte, so an upgrade is a new material on the same shape and the world can
 * be re-meshed in place. Ids are stored in saves and sent over the wire, so they never change
 * once shipped; add new ones at the end.
 */

export const SHAPE = {
  empty: 0,
  cube: 1,
} as const;

export const MATERIAL = {
  none: 0,
  scrap: 1,
  composite: 2,
  alloy: 3,
  energy: 4,
} as const;

export interface ShapeDef {
  readonly id: number;
  readonly name: string;
}

export interface MaterialDef {
  readonly id: number;
  readonly name: string;
  /** 1 for Scrap up to 4 for Energy-Infused (spec section 9). */
  readonly tier: number;
}

export const SHAPES: readonly ShapeDef[] = [{ id: SHAPE.cube, name: 'Block' }];

export const MATERIALS: readonly MaterialDef[] = [
  { id: MATERIAL.scrap, name: 'Scrap', tier: 1 },
  { id: MATERIAL.composite, name: 'Reinforced Composite', tier: 2 },
  { id: MATERIAL.alloy, name: 'Advanced Alloy', tier: 3 },
  { id: MATERIAL.energy, name: 'Energy-Infused', tier: 4 },
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
