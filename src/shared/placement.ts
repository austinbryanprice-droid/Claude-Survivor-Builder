import {
  MODULE_FACINGS,
  baseShape,
  moduleShape,
  slabShape,
  wedgeShape,
  WEDGE_FACINGS,
} from './blocks';
import type { ShapeKind } from './blocks';

/**
 * Which way up a slab or a wedge goes, and which way a wedge faces, when the player has only said
 * what kind of piece they hold. The aim works it out from the face the cursor is on and the way
 * the player looks, as a player would expect: a slab on the ground lies low, a slab hung from a
 * ceiling sits high, a wedge rises away from the player. The turn key adds to that. Pure, so the
 * preview and the host's idea of the click can never disagree.
 */

/** What the player holds: a material and a kind of shape, turned by `turn` steps from the automatic orientation. */
export interface PieceChoice {
  /** Material id (`MATERIAL`); 0 when the selected item is not a block. For a module, its level. */
  readonly material: number;
  readonly kind: ShapeKind;
  /** How many times the turn key has been pressed since the kind was chosen, below `turnCount(kind)`. */
  readonly turn: number;
  /** For `kind` 'module': which module (`MODULE`). Absent, or 0, for a block. */
  readonly module?: number;
}

/** The face the cursor is on, as far as orientation cares. */
export interface Surface {
  /** Which way the face points, vertically: 1 up (the top of a block), -1 down, 0 sideways, or the ground. */
  readonly ny: number;
  /** How high up the cell a new block would take the cursor is, 0 to 1. Decides a slab placed against a wall or on the ground. */
  readonly height: number;
}

/**
 * How many different positions the turn key cycles through for a kind. A block looks the same
 * every way. A slab has two, low and high. A wedge turns through the four directions it can rise
 * toward, and then does so again upside down. A module turns through the four ways its front can look.
 */
export function turnCount(kind: ShapeKind): number {
  if (kind === 'slab') return 2;
  if (kind === 'wedge') return 2 * WEDGE_FACINGS;
  if (kind === 'module') return MODULE_FACINGS;
  return 1;
}

/** The turn after `turn`, wrapping back to the automatic orientation. */
export function nextTurn(kind: ShapeKind, turn: number): number {
  return (turn + 1) % turnCount(kind);
}

/** The direction a view along (dx, dz) faces most: 0 is +x, 1 is +z, 2 is -x, 3 is -z. */
export function facingOf(dx: number, dz: number): number {
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 0 : 2;
  return dz >= 0 ? 1 : 3;
}

/**
 * The shape id the piece takes at a place on a surface, seen from a view along (lookX, lookZ).
 *
 *  - A block is a block.
 *  - A slab goes in the half the surface points toward: low when it rests on a block, high when
 *    it hangs from one, and against a wall, or on the ground, in the half the cursor is on. The
 *    ground cuts through its cell at any height, and a slab in the half under it would not show.
 *  - A wedge rises away from the player, so that a row of them is a ramp to walk up. It is turned
 *    upside down under a ceiling, where the flat side goes against it.
 *  - A module faces the player, so that its screen and its front are what they see.
 *
 * Each turn step then moves the wedge a quarter turn (and flips it every fourth step), flips a
 * slab, or turns a module a quarter turn.
 */
export function orientShape(
  kind: ShapeKind,
  turn: number,
  surface: Surface,
  lookX: number,
  lookZ: number,
  module = 0,
): number {
  if (kind === 'module') {
    return moduleShape(module, facingOf(lookX, lookZ) + 2 + (turn % MODULE_FACINGS));
  }
  if (kind === 'slab') {
    const upper = surface.ny < 0 || (surface.ny === 0 && surface.height >= 0.5);
    return slabShape(upper !== ((turn & 1) === 1));
  }
  if (kind === 'wedge') {
    const facing = (facingOf(lookX, lookZ) + (turn & 3)) % WEDGE_FACINGS;
    const flipped = turn >= WEDGE_FACINGS;
    return wedgeShape(facing, surface.ny < 0 !== flipped);
  }
  return baseShape('cube');
}
