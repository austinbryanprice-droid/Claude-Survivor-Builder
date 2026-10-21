import { describe, expect, it } from 'vitest';
import {
  MATERIAL,
  SHAPE,
  SHAPES,
  WEDGE_FACINGS,
  isKnownState,
  isUpsideDown,
  packState,
  pieceName,
  shapeKind,
  slabShape,
  wedgeFacing,
  wedgeShape,
} from '../../src/shared/blocks';
import {
  SIDE,
  WEDGE_SLICES,
  oppositeSide,
  rectContains,
  shapeBoxes,
  shapeGeometry,
  type CellBox,
} from '../../src/shared/shapes';

const geometryOf = (id: number) => {
  const g = shapeGeometry(id);
  if (!g) throw new Error(`no geometry for shape ${id}`);
  return g;
};

/** The height of the shape's solid above the floor of the cell at (x, z), by the boxes, or 0 where there is none. */
function topAt(boxes: readonly CellBox[], x: number, z: number): number {
  let top = 0;
  for (const b of boxes) {
    if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) top = Math.max(top, b[4]);
  }
  return top;
}

describe('the shape table', () => {
  it('names a slab, a wedge and a block, in every orientation', () => {
    expect(SHAPES.map((s) => s.id)).toEqual([1, 8, 9, 16, 17, 18, 19, 20, 21, 22, 23]);
    expect(new Set(SHAPES.map((s) => s.name))).toEqual(new Set(['Block', 'Slab', 'Wedge']));
    expect(pieceName(packState(slabShape(false), MATERIAL.alloy))).toBe('Advanced Alloy Slab');
    expect(pieceName(packState(wedgeShape(2), MATERIAL.scrap))).toBe('Scrap Wedge');
  });

  it('never reuses an id: ids are saved and sent over the wire', () => {
    // These are the values the first release shipped; they must never change.
    expect(SHAPE.cube).toBe(1);
    expect(SHAPE.slab).toBe(8);
    expect(SHAPE.wedge).toBe(16);
    expect(new Set(SHAPES.map((s) => s.id)).size).toBe(SHAPES.length);
  });

  it('accepts a slab or a wedge in any material and refuses ids between the groups', () => {
    for (const shape of SHAPES) {
      expect(isKnownState(packState(shape.id, MATERIAL.energy))).toBe(true);
    }
    for (const id of [2, 7, 10, 15, 24, 31, 255]) {
      expect(isKnownState(packState(id, MATERIAL.scrap))).toBe(false);
    }
  });

  it('tells the kind, the facing and the turn of a shape from its id', () => {
    expect(shapeKind(SHAPE.cube)).toBe('cube');
    expect(shapeKind(slabShape(true))).toBe('slab');
    expect(shapeKind(wedgeShape(3, true))).toBe('wedge');
    expect(shapeKind(0)).toBeUndefined();
    expect(shapeKind(99)).toBeUndefined();
    expect(isUpsideDown(slabShape(false))).toBe(false);
    expect(isUpsideDown(slabShape(true))).toBe(true);
    expect(isUpsideDown(wedgeShape(1))).toBe(false);
    expect(isUpsideDown(wedgeShape(1, true))).toBe(true);
    expect(isUpsideDown(SHAPE.cube)).toBe(false);
    for (let facing = 0; facing < WEDGE_FACINGS; facing++) {
      expect(wedgeFacing(wedgeShape(facing))).toBe(facing);
      expect(wedgeFacing(wedgeShape(facing, true))).toBe(facing);
    }
    expect(wedgeFacing(SHAPE.cube)).toBe(-1);
    // Any whole number of quarter turns, forward or back, names one of the four.
    expect(wedgeShape(-1)).toBe(wedgeShape(3));
    expect(wedgeShape(5)).toBe(wedgeShape(1));
  });
});

describe('shape geometry', () => {
  it('has geometry for every shape in the table and for nothing else', () => {
    for (const shape of SHAPES) expect(shapeGeometry(shape.id)?.id).toBe(shape.id);
    expect(shapeGeometry(0)).toBeUndefined();
    expect(shapeGeometry(2)).toBeUndefined();
    expect(shapeGeometry(200)).toBeUndefined();
  });

  it('fills the volume each kind is named for: all, half and half', () => {
    expect(geometryOf(SHAPE.cube).volume).toBeCloseTo(1, 9);
    for (const shape of SHAPES) {
      if (shape.kind === 'slab' || shape.kind === 'wedge') {
        expect(geometryOf(shape.id).volume, `shape ${shape.id}`).toBeCloseTo(0.5, 9);
      }
    }
  });

  it('keeps every corner inside the cell and every face turned away from the middle of the shape', () => {
    for (const shape of SHAPES) {
      const g = geometryOf(shape.id);
      const mid = [0, 0, 0];
      for (const v of g.vertices) {
        for (let k = 0; k < 3; k++) {
          expect(v[k]).toBeGreaterThanOrEqual(0);
          expect(v[k]).toBeLessThanOrEqual(1);
          mid[k] = (mid[k] as number) + (v[k] as number) / g.vertices.length;
        }
      }
      for (const face of g.faces) {
        const p = g.vertices[face.loop[0] as number]!;
        const away =
          (face.normal[0] as number) * ((p[0] as number) - (mid[0] as number)) +
          (face.normal[1] as number) * ((p[1] as number) - (mid[1] as number)) +
          (face.normal[2] as number) * ((p[2] as number) - (mid[2] as number));
        expect(away, `shape ${shape.id}`).toBeGreaterThan(0);
        expect(Math.hypot(...face.normal)).toBeCloseTo(1, 9);
      }
    }
  });

  it('is a closed solid: every edge belongs to two faces and Euler holds', () => {
    for (const shape of SHAPES) {
      const g = geometryOf(shape.id);
      const edges = new Map<string, number>();
      for (const face of g.faces) {
        for (let k = 0; k < face.loop.length; k++) {
          const a = face.loop[k] as number;
          const b = face.loop[(k + 1) % face.loop.length] as number;
          const key = a < b ? `${a}_${b}` : `${b}_${a}`;
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      for (const count of edges.values()) expect(count).toBe(2);
      expect(g.vertices.length - edges.size + g.faces.length, `shape ${shape.id}`).toBe(2);
    }
  });

  it('gives the cube six whole sides and no boxes, since a cube is the whole cell', () => {
    const g = geometryOf(SHAPE.cube);
    expect(g.boxes).toBeNull();
    expect(shapeBoxes(SHAPE.cube)).toBeNull();
    for (let side = 0; side < 6; side++) expect(g.cover[side]).toEqual([0, 1, 0, 1]);
  });

  it('puts a bottom slab in the lower half and a top slab in the upper half', () => {
    expect(shapeBoxes(slabShape(false))).toEqual([[0, 0, 0, 1, 0.5, 1]]);
    expect(shapeBoxes(slabShape(true))).toEqual([[0, 0.5, 0, 1, 1, 1]]);
  });

  it('covers only the flat side of a slab entirely: the other sides are half height', () => {
    const lower = geometryOf(slabShape(false));
    expect(lower.cover[SIDE.ny]).toEqual([0, 1, 0, 1]);
    expect(lower.cover[SIDE.py]).toBeNull();
    expect(lower.cover[SIDE.px]).toEqual([0, 0.5, 0, 1]);
    const upper = geometryOf(slabShape(true));
    expect(upper.cover[SIDE.py]).toEqual([0, 1, 0, 1]);
    expect(upper.cover[SIDE.ny]).toBeNull();
    expect(upper.cover[SIDE.nz]).toEqual([0, 1, 0.5, 1]);
  });

  it('covers a wedge on its floor and its wall, and only reaches over the triangles at its sides', () => {
    const g = geometryOf(wedgeShape(0));
    expect(g.cover[SIDE.ny]).toEqual([0, 1, 0, 1]);
    expect(g.cover[SIDE.px]).toEqual([0, 1, 0, 1]);
    expect(g.cover[SIDE.py]).toBeNull();
    expect(g.cover[SIDE.nx]).toBeNull();
    // The triangles at the sides fill half of a square: they are in reach but cover nothing.
    expect(g.cover[SIDE.pz]).toBeNull();
    expect(g.cover[SIDE.nz]).toBeNull();
    expect(g.reach[SIDE.pz]).toEqual([0, 1, 0, 1]);
    expect(g.reach[SIDE.nz]).toEqual([0, 1, 0, 1]);
  });

  it('turns the wall of a wedge toward the side it rises to', () => {
    // Rising toward +x, +z, -x and -z puts the wall on that side.
    const walls = [SIDE.px, SIDE.pz, SIDE.nx, SIDE.nz];
    for (let facing = 0; facing < WEDGE_FACINGS; facing++) {
      const g = geometryOf(wedgeShape(facing));
      expect(g.cover[walls[facing] as number], `facing ${facing}`).toEqual([0, 1, 0, 1]);
      expect(g.cover[oppositeSide(walls[facing] as number)]).toBeNull();
      expect(g.cover[SIDE.ny]).toEqual([0, 1, 0, 1]);
    }
  });

  it('turns an upside-down wedge over: the flat face is on top and the wall still on the high side', () => {
    for (let facing = 0; facing < WEDGE_FACINGS; facing++) {
      const g = geometryOf(wedgeShape(facing, true));
      expect(g.cover[SIDE.py]).toEqual([0, 1, 0, 1]);
      expect(g.cover[SIDE.ny]).toBeNull();
    }
    expect(geometryOf(wedgeShape(0, true)).cover[SIDE.px]).toEqual([0, 1, 0, 1]);
  });

  it('cuts a wedge into stairs for movement that follow its slope from above', () => {
    for (let facing = 0; facing < WEDGE_FACINGS; facing++) {
      const boxes = shapeBoxes(wedgeShape(facing)) as readonly CellBox[];
      expect(boxes).toHaveLength(WEDGE_SLICES);
      const rise = (t: number): { x: number; z: number } => {
        // t runs 0 to 1 from the low edge to the wall, along the way the wedge rises.
        return [
          { x: t, z: 0.5 },
          { x: 0.5, z: t },
          { x: 1 - t, z: 0.5 },
          { x: 0.5, z: 1 - t },
        ][facing] as { x: number; z: number };
      };
      let last = 0;
      for (let i = 0; i < WEDGE_SLICES; i++) {
        const t = (i + 0.5) / WEDGE_SLICES;
        const { x, z } = rise(t);
        const top = topAt(boxes, x, z);
        // The tread is the highest point of its slice, and never more than one step above the slope.
        expect(top).toBeCloseTo((i + 1) / WEDGE_SLICES, 9);
        expect(top).toBeGreaterThanOrEqual(t);
        expect(top - t).toBeLessThanOrEqual(1 / WEDGE_SLICES + 1e-9);
        expect(top).toBeGreaterThan(last);
        last = top;
      }
    }
  });

  it('hangs an upside-down wedge from the top of the cell', () => {
    const boxes = shapeBoxes(wedgeShape(0, true)) as readonly CellBox[];
    expect(boxes).toHaveLength(WEDGE_SLICES);
    for (const b of boxes) expect(b[4]).toBe(1);
    // The wall end reaches the floor of the cell; the low end hangs by one step.
    expect(Math.min(...boxes.map((b) => b[1]))).toBe(0);
    const low = boxes.find((b) => b[0] === 0) as CellBox;
    expect(low[1]).toBeCloseTo(1 - 1 / WEDGE_SLICES, 9);
  });

  it('keeps every box inside its cell', () => {
    for (const shape of SHAPES) {
      for (const box of shapeBoxes(shape.id) ?? []) {
        for (let k = 0; k < 3; k++) {
          expect(box[k] as number).toBeGreaterThanOrEqual(0);
          expect(box[k + 3] as number).toBeLessThanOrEqual(1);
          expect(box[k + 3] as number).toBeGreaterThan(box[k] as number);
        }
      }
    }
  });

  it('tests whether one rectangle holds another', () => {
    expect(rectContains([0, 1, 0, 1], [0, 0.5, 0, 1])).toBe(true);
    expect(rectContains([0, 0.5, 0, 1], [0, 1, 0, 1])).toBe(false);
    expect(rectContains([0, 1, 0, 1], [0, 1, 0, 1])).toBe(true);
    expect(rectContains([0.25, 0.75, 0, 1], [0, 0.5, 0, 1])).toBe(false);
  });
});
