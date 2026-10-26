import type { CellState } from '../../shared/block-world';
import {
  MATERIALS,
  isKnownState,
  materialOf,
  moduleOfShape,
  stateShape,
} from '../../shared/blocks';
import {
  poolSlot,
  type DebrisNode,
  type DebrisView,
  type EconomyReading,
} from '../../shared/economy';
import { DEBRIS } from './balance';

/**
 * What the economy asks of a placement (SPEC section 9: one shared pool pays for all base
 * construction), and the room a heap of debris keeps to itself. The host enforces these rules, and
 * the screen that aims asks the same functions before a click is sent, so a ghost that is not red
 * is a block the host will accept. Pure, so a test can build.
 */

/** What one piece costs the crew: so many of a material. Every shape of a material costs the same. */
export interface PieceCost {
  /** The `MATERIAL` id the pool is charged. */
  readonly material: number;
  readonly name: string;
  readonly amount: number;
}

/**
 * What placing `state` costs, or null for a state the tables do not know (the world refuses it
 * anyway). A block costs its material's price, whatever its shape; a module costs what its own
 * table says, in the material that names.
 */
export function pieceCost(state: CellState): PieceCost | null {
  const module = moduleOfShape(stateShape(state));
  if (module) {
    const paid = MATERIALS.find((m) => m.id === module.cost.material);
    return paid && isKnownState(state)
      ? { material: paid.id, name: paid.name, amount: module.cost.amount }
      : null;
  }
  const material = materialOf(state);
  return material ? { material: material.id, name: material.name, amount: material.cost } : null;
}

/** The words for a pool that cannot pay: the host sends them and the ghost shows them. */
export function notEnough(name: string): string {
  return `not enough ${name}`;
}

/** The words for a block that would bury a heap. */
export const DEBRIS_IN_THE_WAY = 'debris is in the way';

/** The words for a material the crew has not researched yet: the host sends them and the ghost shows them. */
export function needsResearch(name: string): string {
  return `${name} needs research`;
}

/**
 * Why `state` may not be placed by a crew that has researched up to `tier`, or null when its material
 * is open to them. A module's material byte is its level, not a material, so a module is never locked
 * by a tier; the research that opens the other modules comes with them (5g, 5h).
 */
export function lockedRefusal(tier: number, state: CellState): string | null {
  if (moduleOfShape(stateShape(state))) return null;
  const material = materialOf(state);
  return material && material.tier > tier ? needsResearch(material.name) : null;
}

/**
 * Why a pool that holds `amountOf(material)` of each material cannot pay for `state`, or null when
 * it can. The words name the material that is short.
 */
export function shortfall(amountOf: (material: number) => number, state: CellState): string | null {
  const cost = pieceCost(state);
  if (!cost || amountOf(cost.material) >= cost.amount) return null;
  return notEnough(cost.name);
}

/** The top of the column a heap keeps clear, in blocks above the ground its middle is on. */
function columnHeight(node: DebrisNode): number {
  return DEBRIS.keepClear.height * node.scale;
}

/** How wide a heap's column is, from its axis to its edge. */
function columnRadius(node: DebrisNode): number {
  return DEBRIS.keepClear.radius * node.scale;
}

/** True when the cell (x, y, z) is inside the column that `node` keeps clear of blocks. */
export function keepsClear(node: DebrisNode, x: number, y: number, z: number): boolean {
  if (y >= node.y + columnHeight(node) || y + 1 <= node.y - DEBRIS.keepClear.below) return false;
  // The nearest point of the cell's footprint to the heap's axis.
  const dx = Math.min(x + 1, Math.max(x, node.x)) - node.x;
  const dz = Math.min(z + 1, Math.max(z, node.z)) - node.z;
  const radius = columnRadius(node);
  return dx * dx + dz * dz < radius * radius;
}

/**
 * The heap, lying there with strips left, that keeps the cell clear, or null. A heap that is gone
 * (stripped bare) or not uncovered yet keeps nothing clear: the first is not there any more, and
 * the second is waiting for the ground to be free (`builtOver`).
 */
export function heapInTheWay(
  debris: Pick<DebrisView, 'nodes' | 'leftOf'>,
  x: number,
  y: number,
  z: number,
): DebrisNode | null {
  for (const node of debris.nodes) {
    if (debris.leftOf(node.index) > 0 && keepsClear(node, x, y, z)) return node;
  }
  return null;
}

/** True when a block already stands in the column `node` keeps clear: it cannot be uncovered there. */
export function builtOver(
  node: DebrisNode,
  blockAt: (x: number, y: number, z: number) => CellState,
): boolean {
  const radius = columnRadius(node);
  const bottom = Math.floor(node.y - DEBRIS.keepClear.below);
  const top = Math.floor(node.y + columnHeight(node));
  for (let x = Math.floor(node.x - radius); x <= Math.floor(node.x + radius); x++) {
    for (let z = Math.floor(node.z - radius); z <= Math.floor(node.z + radius); z++) {
      for (let y = bottom; y <= top; y++) {
        if (keepsClear(node, x, y, z) && blockAt(x, y, z) !== 0) return true;
      }
    }
  }
  return false;
}

/** What a screen needs of the economy to tell a player whether the host would accept a block: the pool and the heaps. */
export interface PlacementEconomy {
  read(out: EconomyReading): EconomyReading;
  readonly debris: Pick<DebrisView, 'nodes' | 'leftOf'>;
}

/**
 * Why the economy refuses a piece at a cell, in the host's order (a heap in the way, a material the
 * crew has not researched, then a pool that is short), read from the economy as this screen has it.
 * Null when it would accept. Where there is no pool to read (`cap` is 0: a host without a run, or the
 * guest's first moment before the host has said) nothing is charged and nothing is locked, as the
 * host charges and locks nothing there.
 */
export function placementRefusal(
  economy: PlacementEconomy,
  scratch: EconomyReading,
  x: number,
  y: number,
  z: number,
  state: CellState,
): string | null {
  if (heapInTheWay(economy.debris, x, y, z)) return DEBRIS_IN_THE_WAY;
  const pool = economy.read(scratch);
  if (pool.cap <= 0) return null;
  return (
    lockedRefusal(pool.tier, state) ??
    shortfall((material) => pool.stock[poolSlot(material)] ?? 0, state)
  );
}
