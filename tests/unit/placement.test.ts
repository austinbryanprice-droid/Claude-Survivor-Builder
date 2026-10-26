import { describe, expect, it } from 'vitest';
import {
  MODULE,
  MODULE_FACINGS,
  SHAPE,
  SHAPE_KINDS,
  baseShape,
  isUpsideDown,
  moduleFacing,
  moduleShape,
  shapeKind,
  slabShape,
  wedgeFacing,
  wedgeShape,
  type ShapeKind,
} from '../../src/shared/blocks';
import { facingOf, nextTurn, orientShape, turnCount } from '../../src/shared/placement';

const ON_TOP = { ny: 1, height: 0 };
const UNDER = { ny: -1, height: 1 };
const side = (height: number) => ({ ny: 0, height });

describe('the kinds of shape', () => {
  it('start as the block, the lower slab and the wedge that rises toward +x', () => {
    expect(baseShape('cube')).toBe(SHAPE.cube);
    expect(baseShape('slab')).toBe(slabShape(false));
    expect(baseShape('wedge')).toBe(wedgeShape(0));
    for (const kind of SHAPE_KINDS) expect(shapeKind(baseShape(kind))).toBe(kind);
  });

  it('turn through as many positions as they have orientations', () => {
    expect(turnCount('cube')).toBe(1);
    expect(turnCount('slab')).toBe(2);
    expect(turnCount('wedge')).toBe(8);
  });

  it('come back to the automatic orientation after the last turn', () => {
    for (const kind of SHAPE_KINDS) {
      let turn = 0;
      const seen = new Set<number>();
      for (let i = 0; i < turnCount(kind); i++) {
        seen.add(turn);
        turn = nextTurn(kind, turn);
      }
      expect(turn).toBe(0);
      expect(seen.size).toBe(turnCount(kind));
    }
  });
});

describe('which way a view faces', () => {
  it('names the axis the look runs along most', () => {
    expect(facingOf(1, 0)).toBe(0);
    expect(facingOf(0, 1)).toBe(1);
    expect(facingOf(-1, 0)).toBe(2);
    expect(facingOf(0, -1)).toBe(3);
  });

  it('breaks the quarter turns at the diagonals, with the x axis winning a tie', () => {
    expect(facingOf(0.8, 0.6)).toBe(0);
    expect(facingOf(0.6, 0.8)).toBe(1);
    expect(facingOf(-0.6, 0.8)).toBe(1);
    expect(facingOf(-0.8, 0.6)).toBe(2);
    expect(facingOf(-0.8, -0.6)).toBe(2);
    expect(facingOf(-0.6, -0.8)).toBe(3);
    expect(facingOf(0.6, -0.8)).toBe(3);
    expect(facingOf(0.8, -0.6)).toBe(0);
    expect(facingOf(1, 1)).toBe(0);
  });

  it('still has an answer looking straight up or down', () => {
    expect(facingOf(0, 0)).toBe(0);
  });
});

describe('a block', () => {
  it('is a block however it is aimed or turned', () => {
    for (const surface of [ON_TOP, UNDER, side(0.2), side(0.9)]) {
      expect(orientShape('cube', 0, surface, 1, 0)).toBe(SHAPE.cube);
    }
  });
});

describe('a slab', () => {
  it('lies low on what is below it and hangs high from what is above', () => {
    expect(orientShape('slab', 0, ON_TOP, 1, 0)).toBe(slabShape(false));
    expect(orientShape('slab', 0, UNDER, 1, 0)).toBe(slabShape(true));
  });

  it('goes in the half of the cell the cursor is on, against a wall', () => {
    expect(orientShape('slab', 0, side(0.2), 1, 0)).toBe(slabShape(false));
    expect(orientShape('slab', 0, side(0.49), 1, 0)).toBe(slabShape(false));
    expect(orientShape('slab', 0, side(0.5), 1, 0)).toBe(slabShape(true));
    expect(orientShape('slab', 0, side(0.95), 1, 0)).toBe(slabShape(true));
  });

  it('does not care which way the player looks', () => {
    for (const [x, z] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      expect(orientShape('slab', 0, ON_TOP, x, z)).toBe(slabShape(false));
    }
  });

  it('flips with the turn key, wherever it was aimed', () => {
    expect(orientShape('slab', 1, ON_TOP, 1, 0)).toBe(slabShape(true));
    expect(orientShape('slab', 1, UNDER, 1, 0)).toBe(slabShape(false));
    expect(orientShape('slab', 1, side(0.2), 1, 0)).toBe(slabShape(true));
    expect(orientShape('slab', 1, side(0.8), 1, 0)).toBe(slabShape(false));
  });
});

describe('a wedge', () => {
  it('rises away from the player, so that a row of them is a ramp to walk up', () => {
    const looks = [
      [1, 0, 0],
      [0, 1, 1],
      [-1, 0, 2],
      [0, -1, 3],
    ] as const;
    for (const [x, z, facing] of looks) {
      const shape = orientShape('wedge', 0, ON_TOP, x, z);
      expect(shape).toBe(wedgeShape(facing));
      expect(wedgeFacing(shape)).toBe(facing);
      expect(isUpsideDown(shape)).toBe(false);
    }
  });

  it('is turned upside down under a ceiling and upright everywhere else', () => {
    expect(isUpsideDown(orientShape('wedge', 0, UNDER, 1, 0))).toBe(true);
    expect(isUpsideDown(orientShape('wedge', 0, ON_TOP, 1, 0))).toBe(false);
    // Against a wall it stays upright whichever half the cursor is on.
    expect(isUpsideDown(orientShape('wedge', 0, side(0.1), 1, 0))).toBe(false);
    expect(isUpsideDown(orientShape('wedge', 0, side(0.9), 1, 0))).toBe(false);
  });

  it('turns a quarter at a time with the turn key, then flips and turns again', () => {
    const seen = new Set<number>();
    for (let turn = 0; turn < turnCount('wedge'); turn++) {
      const shape = orientShape('wedge', turn, ON_TOP, 1, 0);
      seen.add(shape);
      expect(wedgeFacing(shape)).toBe(turn % 4);
      expect(isUpsideDown(shape)).toBe(turn >= 4);
    }
    // All eight orientations are reachable from any starting view.
    expect(seen.size).toBe(8);
  });

  it('turns relative to the view, so the same key gives the same answer facing any way', () => {
    // One step to the left of where the player looks, counting a quarter turn as +1 (+x -> +z -> -x -> -z).
    expect(wedgeFacing(orientShape('wedge', 1, ON_TOP, 0, 1))).toBe(2);
    expect(wedgeFacing(orientShape('wedge', 1, ON_TOP, -1, 0))).toBe(3);
    expect(wedgeFacing(orientShape('wedge', 1, ON_TOP, 0, -1))).toBe(0);
  });

  it('flips a ceiling wedge back upright on the fourth turn step', () => {
    expect(isUpsideDown(orientShape('wedge', 4, UNDER, 1, 0))).toBe(false);
    expect(isUpsideDown(orientShape('wedge', 0, UNDER, 1, 0))).toBe(true);
  });
});

describe('every orientation is a shape the table defines', () => {
  it('for every kind, turn and surface', () => {
    const surfaces = [ON_TOP, UNDER, side(0.2), side(0.8)];
    const looks = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [0.7, 0.7],
    ] as const;
    for (const kind of SHAPE_KINDS as readonly ShapeKind[]) {
      for (let turn = 0; turn < turnCount(kind); turn++) {
        for (const surface of surfaces) {
          for (const [x, z] of looks) {
            const shape = orientShape(kind, turn, surface, x, z);
            expect(shapeKind(shape), `${kind} ${turn}`).toBe(kind);
          }
        }
      }
    }
  });
});

describe('placing a module', () => {
  const place = (turn: number, lookX: number, lookZ: number, surface = ON_TOP): number =>
    orientShape('module', turn, surface, lookX, lookZ, MODULE.terminal);

  it('turns through its four facings and then comes round to the first', () => {
    expect(turnCount('module')).toBe(MODULE_FACINGS);
    let turn = 0;
    const seen = new Set<number>();
    for (let i = 0; i < turnCount('module'); i++) {
      seen.add(turn);
      turn = nextTurn('module', turn);
    }
    expect(turn).toBe(0);
    expect(seen.size).toBe(MODULE_FACINGS);
  });

  it('faces the player, so that the front is what they see', () => {
    // The front looks the way the module faces: toward the player, who looks the opposite way.
    expect(moduleFacing(place(0, -1, 0))).toBe(0);
    expect(moduleFacing(place(0, 0, -1))).toBe(1);
    expect(moduleFacing(place(0, 1, 0))).toBe(2);
    expect(moduleFacing(place(0, 0, 1))).toBe(3);
    for (let facing = 0; facing < MODULE_FACINGS; facing++) {
      const [x, z] = [
        [-1, 0],
        [0, -1],
        [1, 0],
        [0, 1],
      ][facing] as [number, number];
      expect(place(0, x, z)).toBe(moduleShape(MODULE.terminal, facing));
      expect(shapeKind(place(0, x, z))).toBe('module');
    }
  });

  it('turns a quarter turn a step, from the way it started', () => {
    for (let turn = 0; turn < MODULE_FACINGS; turn++) {
      expect(moduleFacing(place(turn, 1, 0))).toBe((2 + turn) % MODULE_FACINGS);
    }
    expect(place(MODULE_FACINGS, 1, 0)).toBe(place(0, 1, 0));
  });

  it('stands the same on a floor, a wall or a ceiling: it is the support rule that decides', () => {
    for (const surface of [ON_TOP, UNDER, side(0.2), side(0.8)]) {
      expect(place(1, 0, 1, surface)).toBe(place(1, 0, 1));
    }
  });

  it('names the module in the shape it makes', () => {
    expect(place(0, 1, 0)).toBeGreaterThanOrEqual(SHAPE.module);
  });
});
