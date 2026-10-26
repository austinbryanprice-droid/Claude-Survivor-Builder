import type { BlockWorld, CellState } from '../../shared/block-world';
import {
  MATERIALS,
  isKnownState,
  materialOf,
  moduleLevelCost,
  moduleLevels,
  moduleOfShape,
  stateMaterial,
  stateShape,
  withMaterial,
} from '../../shared/blocks';
import {
  poolSlot,
  type DebrisNode,
  type DebrisView,
  type EconomyReading,
} from '../../shared/economy';
import { DEBRIS } from './balance';
import { moduleLock } from './research';

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
 * table says for the level it is at, in the material that names. A module above its first level is
 * not placed but raised, so this is what raising a module to that level costs, and what breaking one
 * that stands at it gives back.
 */
export function pieceCost(state: CellState): PieceCost | null {
  const module = moduleOfShape(stateShape(state));
  if (module) {
    if (!isKnownState(state)) return null;
    const price = moduleLevelCost(module, stateMaterial(state));
    const paid = MATERIALS.find((m) => m.id === price.material);
    return paid ? { material: paid.id, name: paid.name, amount: price.amount } : null;
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
 * is open to them. A module's material byte is its level, not a material, so what opens a module is
 * the material that pays for it: the Terminal and the Basic Turret are paid in Scrap and never locked,
 * and the steps up the turret's ladder are opened by Composite and Alloy, as a block of them is. A
 * module that belongs to a group of research is held back by that as well (`groupRefusal`).
 */
export function lockedRefusal(tier: number, state: CellState): string | null {
  const price = pieceCost(state);
  const material = moduleOfShape(stateShape(state))
    ? MATERIALS.find((m) => m.id === price?.material)
    : materialOf(state);
  return material && material.tier > tier ? needsResearch(material.name) : null;
}

/**
 * Why `state` may not be placed by a crew whose Research Terminal has read `claimed` points because
 * the module belongs to a group the points do not reach yet (the Generator waits for Power), in the
 * same words as a material not researched, or null when it is open to them or no group gates it.
 */
export function groupRefusal(claimed: number, state: CellState): string | null {
  const module = moduleOfShape(stateShape(state));
  return module && moduleLock(module.id, claimed) ? needsResearch(module.name) : null;
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

/** True when a module of this kind (a `MODULE` id) stands anywhere in the world: a Terminal reads the crew's research only while one does. */
export function moduleStands(world: Pick<BlockWorld, 'forEachEdit'>, module: number): boolean {
  let found = false;
  world.forEachEdit((_x, _y, _z, state) => {
    if (!found && moduleOfShape(stateShape(state))?.id === module) found = true;
  });
  return found;
}

/** What a screen needs of the economy to tell a player whether the host would accept a block: the pool and the heaps. */
export interface PlacementEconomy {
  read(out: EconomyReading): EconomyReading;
  readonly debris: Pick<DebrisView, 'nodes' | 'leftOf'>;
}

/**
 * Why the economy refuses a piece at a cell, in the host's order (a heap in the way, a material or a
 * group of modules the crew has not researched, then a pool that is short), read from the economy as
 * this screen has it. Null when it would accept. Where there is no pool to read (`cap` is 0: a host
 * without a run, or the guest's first moment before the host has said) nothing is charged and nothing
 * is locked, as the host charges and locks nothing there.
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
    groupRefusal(pool.claimed, state) ??
    shortfall((material) => pool.stock[poolSlot(material)] ?? 0, state)
  );
}

/** The words for an upgrade aimed at a cell with nothing in it. */
export const NOTHING_TO_UPGRADE = 'nothing to upgrade there';

/** The words for a piece that has no better material to become. */
export const FULLY_UPGRADED = 'already fully upgraded';

/** What an upgrade in place makes of a piece, and what it takes from the pool. */
export interface UpgradeStep {
  /** The piece as it stands. */
  readonly from: CellState;
  /** The same piece in the next material up: the same shape, facing and half of the cell. */
  readonly to: CellState;
  /** The price of the better piece. The block it replaces is used up, so nothing comes back for it. */
  readonly cost: PieceCost;
}

/**
 * The piece `state` becomes when it is upgraded one step: a block in the next material up, a module
 * at its next level (the same shape, so it keeps its facing). Null when there is no better self: the
 * material is the best there is (Energy-Infused), or the module is at the top of its ladder.
 */
function betterPiece(state: CellState): CellState | null {
  const module = moduleOfShape(stateShape(state));
  if (module) {
    const level = stateMaterial(state);
    return level >= 1 && level < moduleLevels(module) ? withMaterial(state, level + 1) : null;
  }
  const material = materialOf(state);
  const better = material && MATERIALS.find((m) => m.tier === material.tier + 1);
  return better ? withMaterial(state, better.id) : null;
}

/**
 * What upgrading `state` in place makes of it, or null when it cannot be upgraded: nothing stands
 * there, or it is as good as it gets (a block of Energy-Infused, a module at the top of its ladder, a
 * module with no ladder such as the Terminal). The better piece costs what a new one of the same
 * shape costs, or for a module what its table says for the level.
 */
export function upgradeStep(state: CellState): UpgradeStep | null {
  if (state === 0) return null;
  const to = betterPiece(state);
  const cost = to === null ? null : pieceCost(to);
  return to !== null && cost ? { from: state, to, cost } : null;
}

/** Why `state` could not be upgraded whatever the crew holds: nothing is there, or it is as good as it gets. Null when it has a better self. */
export function upgradeBlocker(state: CellState): string | null {
  if (state === 0) return NOTHING_TO_UPGRADE;
  return upgradeStep(state) ? null : FULLY_UPGRADED;
}

/**
 * Why a crew that has researched up to `tier`, with a pool that holds `amountOf(material)` of each,
 * cannot upgrade the piece `state` now, or null when it can. The host asks it of the cell a command
 * names, and the screen of the cell under the cursor. In that order: nothing there or nothing
 * better, the better material not yet researched, then a pool too short for its price.
 */
export function upgradeRefusal(
  tier: number,
  amountOf: (material: number) => number,
  state: CellState,
): string | null {
  const step = upgradeStep(state);
  if (!step) return upgradeBlocker(state);
  return lockedRefusal(tier, step.to) ?? shortfall(amountOf, step.to);
}

/**
 * What the screen asks before it offers an upgrade: the same rules as the host's, read from the
 * economy as this screen has it. Where there is no pool to read (`cap` is 0) nothing is charged and
 * nothing is locked, as the host charges and locks nothing there, but a piece with no better self
 * is still refused.
 */
export function upgradeRefusalOnScreen(
  economy: Pick<PlacementEconomy, 'read'>,
  scratch: EconomyReading,
  state: CellState,
): string | null {
  const pool = economy.read(scratch);
  if (pool.cap <= 0) return upgradeBlocker(state);
  return upgradeRefusal(pool.tier, (material) => pool.stock[poolSlot(material)] ?? 0, state);
}
