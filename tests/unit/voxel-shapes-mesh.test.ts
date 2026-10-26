import { describe, expect, it } from 'vitest';
import {
  MATERIAL,
  MODULE,
  SHAPES,
  SHAPE,
  moduleShape,
  packState,
  slabShape,
  wedgeShape,
} from '../../src/shared/blocks';
import { shapeGeometry } from '../../src/shared/shapes';
import {
  AO_BRIGHTNESS,
  BEVEL,
  GROOVE_BRIGHTNESS,
  PRIMITIVE,
  meshChunk,
  type ChunkMeshData,
} from '../../src/world/voxels/mesher';
import { buildTemplate } from '../../src/world/voxels/shape-template';
import { Cells, audit, expectClosed } from './helpers/mesh';

const CUBE = packState(SHAPE.cube, MATERIAL.scrap);
const piece = (shape: number, material: number = MATERIAL.scrap): number =>
  packState(shape, material);

const mesh = (cells: Cells): ChunkMeshData => meshChunk(cells, 0, 0, 0);

/** The shapes the mesher draws: every shape but the modules, which are drawn from their own models. */
const SOLIDS = SHAPES.filter((shape) => shape.kind !== 'module');

const kindOf = (m: ChunkMeshData, i: number): number => (m.aux[i * 4 + 2] as number) & 3;

/** The panel vertices that lie on the plane `axis = value`, facing along `sign`. */
function panelVerticesOn(m: ChunkMeshData, axis: number, value: number, sign: number): number {
  let count = 0;
  for (let i = 0; i < m.vertexCount; i++) {
    if (kindOf(m, i) !== PRIMITIVE.panel) continue;
    if (Math.abs((m.normals[i * 3 + axis] as number) - sign) > 1e-6) continue;
    if (Math.abs((m.positions[i * 3 + axis] as number) - value) < 1e-6) count++;
  }
  return count;
}

describe('one slab or wedge alone', () => {
  for (const shape of SOLIDS) {
    const geometry = shapeGeometry(shape.id)!;
    describe(`${shape.name} ${shape.id}`, () => {
      const cells = new Cells().set(3, 4, 5, piece(shape.id));
      const m = mesh(cells);

      it('is one closed, consistently wound skin', () => {
        const result = expectClosed([m], `shape ${shape.id}`);
        // Welded, it is a sphere: V - E + F = 2.
        expect(result.vertices - result.edges + result.triangles).toBe(2);
      });

      it('is made of a panel per face, a strip per edge and a corner per vertex', () => {
        const template = buildTemplate(geometry, BEVEL);
        let triangles = 0;
        for (const p of template.pieces) triangles += p.count === 4 ? 2 : p.count - 2;
        expect(m.triangleCount).toBe(triangles);
        const faces = geometry.faces.length;
        const edges = geometry.faces.reduce((n, f) => n + f.loop.length, 0) / 2;
        expect(template.pieces).toHaveLength(faces + edges + geometry.vertices.length);
      });

      it('reaches as far as the shape does, less one bevel at a sharp edge, and no farther', () => {
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (const v of geometry.vertices) {
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k] as number, v[k] as number);
            hi[k] = Math.max(hi[k] as number, v[k] as number);
          }
        }
        const at = [3, 4, 5];
        for (let k = 0; k < 3; k++) {
          const low = (m.bounds[k] as number) - (at[k] as number);
          const high = (m.bounds[k + 3] as number) - (at[k] as number);
          expect(low).toBeGreaterThanOrEqual((lo[k] as number) - 1e-6);
          expect(low).toBeLessThanOrEqual((lo[k] as number) + BEVEL);
          expect(high).toBeLessThanOrEqual((hi[k] as number) + 1e-6);
          expect(high).toBeGreaterThanOrEqual((hi[k] as number) - BEVEL);
        }
      });

      it('keeps every vertex on or inside the planes of its faces, so the bevel cuts in and never out', () => {
        for (let i = 0; i < m.vertexCount; i++) {
          const p = [0, 1, 2].map((k) => (m.positions[i * 3 + k] as number) - [3, 4, 5][k]!);
          for (const face of geometry.faces) {
            const origin = geometry.vertices[face.loop[0] as number]!;
            const out = [0, 1, 2].reduce(
              (sum, k) =>
                sum + (face.normal[k] as number) * ((p[k] as number) - (origin[k] as number)),
              0,
            );
            expect(out).toBeLessThanOrEqual(1e-6);
          }
        }
      });

      it('has unit normals, tile coordinates in range and the cell material', () => {
        for (let i = 0; i < m.vertexCount; i++) {
          expect(
            Math.hypot(m.normals[i * 3]!, m.normals[i * 3 + 1]!, m.normals[i * 3 + 2]!),
          ).toBeCloseTo(1, 5);
          for (const t of [m.uvs[i * 2]!, m.uvs[i * 2 + 1]!]) {
            expect(t).toBeGreaterThanOrEqual(0);
            expect(t).toBeLessThanOrEqual(1);
          }
          expect(m.aux[i * 4 + 1]).toBe(MATERIAL.scrap);
          if (kindOf(m, i) === PRIMITIVE.panel) {
            for (const t of [m.uvs[i * 2]!, m.uvs[i * 2 + 1]!]) {
              expect(t).toBeGreaterThanOrEqual(BEVEL - 1e-6);
              expect(t).toBeLessThanOrEqual(1 - BEVEL + 1e-6);
            }
          }
        }
      });

      it('draws the panel of each face on the plane the face lies in', () => {
        for (const face of geometry.faces) {
          if (face.side < 0) continue;
          const axis = face.side >> 1;
          const plane = geometry.vertices[face.loop[0] as number]![axis] as number;
          const sign = face.side & 1 ? -1 : 1;
          const world = plane + [3, 4, 5][axis]!;
          expect(panelVerticesOn(m, axis, world, sign)).toBe(face.loop.length);
        }
      });
    });
  }

  it('shades nothing and grooves nothing when the shape has the cell to itself', () => {
    for (const shape of SOLIDS) {
      const m = mesh(new Cells().set(0, 0, 0, piece(shape.id)));
      for (let i = 0; i < m.vertexCount; i++) expect(m.aux[i * 4]).toBe(255);
    }
  });

  it('varies the look of a shape from cell to cell as blocks do', () => {
    const seeds = new Set<number>();
    for (let x = 0; x < 8; x++) {
      const m = mesh(new Cells().set(x, 0, 0, piece(slabShape(false))));
      seeds.add(m.aux[3] as number);
    }
    expect(seeds.size).toBeGreaterThan(3);
  });
});

describe('shapes beside blocks and each other', () => {
  it('hides the faces where a slab sits on a block and keeps one closed skin around the pair', () => {
    const cells = new Cells().set(0, 0, 0, CUBE).set(0, 1, 0, piece(slabShape(false)));
    const m = mesh(cells);
    expectClosed([m], 'slab on a block');
    // Neither the block's top nor the slab's bottom is drawn on the plane y = 1.
    expect(panelVerticesOn(m, 1, 1, 1)).toBe(0);
    expect(panelVerticesOn(m, 1, 1, -1)).toBe(0);
    // The slab's top and the block's floor are.
    expect(panelVerticesOn(m, 1, 1.5, 1)).toBe(4);
    expect(panelVerticesOn(m, 1, 0, -1)).toBe(4);
  });

  it('closes a slab under a block the same way', () => {
    const cells = new Cells().set(0, 0, 0, piece(slabShape(true))).set(0, 1, 0, CUBE);
    const m = mesh(cells);
    expectClosed([m], 'block on an upper slab');
    expect(panelVerticesOn(m, 1, 1, 1)).toBe(0);
  });

  it('closes two wedges standing wall to wall into one peak', () => {
    const cells = new Cells().set(0, 0, 0, piece(wedgeShape(0))).set(1, 0, 0, piece(wedgeShape(2)));
    const m = mesh(cells);
    expectClosed([m], 'a ridge');
    // Their walls meet on the plane x = 1 and neither is drawn.
    expect(panelVerticesOn(m, 0, 1, 1)).toBe(0);
    expect(panelVerticesOn(m, 0, 1, -1)).toBe(0);
  });

  it('closes a wedge on a block of the same width', () => {
    const cells = new Cells().set(0, 0, 0, CUBE).set(0, 1, 0, piece(wedgeShape(1)));
    expectClosed([mesh(cells)], 'a roof on a wall');
  });

  it('closes slabs side by side in a row, and a ring of them round a block', () => {
    const row = new Cells();
    for (let x = 0; x < 4; x++) row.set(x, 0, 0, piece(slabShape(false)));
    const m = mesh(row);
    const result = audit([m]);
    expect(result.open).toEqual([]);
    expect(result.inverted).toBe(0);
    // Equal sides meet and both are hidden: three seams, no panel on any of them.
    for (const x of [1, 2, 3]) {
      expect(panelVerticesOn(m, 0, x, 1)).toBe(0);
      expect(panelVerticesOn(m, 0, x, -1)).toBe(0);
    }
    expectClosed([m], 'a floor of slabs');
  });

  it('draws the whole face of a block that a slab only half covers, and hides the slab side against it', () => {
    const cells = new Cells().set(0, 0, 0, CUBE).set(1, 0, 0, piece(slabShape(false)));
    const m = mesh(cells);
    const result = audit([m]);
    expect(result.inverted).toBe(0);
    expect(result.degenerate).toBe(0);
    // The block shows its +x face in full; the slab's -x face is hidden behind the block.
    expect(panelVerticesOn(m, 0, 1, 1)).toBe(4);
    expect(panelVerticesOn(m, 0, 1, -1)).toBe(0);
  });

  it('draws the triangle at the side of a wedge even against another wedge: it covers nothing', () => {
    const cells = new Cells().set(0, 0, 0, piece(wedgeShape(0))).set(0, 0, 1, piece(wedgeShape(0)));
    const m = mesh(cells);
    expect(panelVerticesOn(m, 2, 1, 1)).toBe(3);
    expect(panelVerticesOn(m, 2, 1, -1)).toBe(3);
    const result = audit([m]);
    expect(result.open).toEqual([]);
  });

  it('draws nothing for a shape shut in by blocks on all six sides', () => {
    const cells = new Cells().set(1, 1, 1, piece(wedgeShape(2)));
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const) {
      cells.set(1 + dx, 1 + dy, 1 + dz, CUBE);
    }
    const m = mesh(cells);
    // The six blocks hide the wedge; they still draw their own outer faces.
    let inside = 0;
    for (let i = 0; i < m.vertexCount; i++) {
      const [x, y, z] = [0, 1, 2].map((k) => m.positions[i * 3 + k] as number);
      if (x! > 1.1 && x! < 1.9 && y! > 1.1 && y! < 1.9 && z! > 1.1 && z! < 1.9) inside++;
    }
    expect(inside).toBe(0);
  });

  it('treats a shape beside a block as an empty cell when it bevels the block', () => {
    // The block's skin is the same with a slab or with nothing beside it, except where the slab covers a face.
    const alone = mesh(new Cells().set(0, 0, 0, CUBE));
    const beside = mesh(new Cells().set(0, 0, 0, CUBE).set(0, 0, 1, piece(wedgeShape(0))));
    expect(beside.triangleCount).toBeGreaterThanOrEqual(alone.triangleCount);
    expect(panelVerticesOn(beside, 2, 1, 1)).toBe(4);
  });

  it('darkens the top of a slab where a wall rises past it, and leaves the rest bright', () => {
    const cells = new Cells().set(0, 0, 0, piece(slabShape(false))).set(1, 0, 0, CUBE);
    const m = mesh(cells);
    const brightest = Math.round(AO_BRIGHTNESS[3]! * 255);
    let near = 255;
    let far = 255;
    for (let i = 0; i < m.vertexCount; i++) {
      if (kindOf(m, i) !== PRIMITIVE.panel) continue;
      if (Math.abs((m.positions[i * 3 + 1] as number) - 0.5) > 1e-6) continue;
      if (Math.abs((m.normals[i * 3 + 1] as number) - 1) > 1e-6) continue;
      const x = m.positions[i * 3] as number;
      const ao = m.aux[i * 4] as number;
      if (x > 0.5) near = Math.min(near, ao);
      else far = Math.min(far, ao);
    }
    expect(far).toBe(brightest);
    expect(near).toBeLessThan(brightest);
  });

  it('shades the groove where a face is hidden, as it does for blocks', () => {
    const cells = new Cells().set(0, 0, 0, CUBE).set(0, 1, 0, piece(slabShape(false)));
    const m = mesh(cells);
    const groove = Math.round(GROOVE_BRIGHTNESS * 255);
    // Strips and corners next to the hidden contact faces carry the groove value.
    let grooved = 0;
    for (let i = 0; i < m.vertexCount; i++) if (m.aux[i * 4] === groove) grooved++;
    expect(grooved).toBeGreaterThan(0);
  });

  it('meshes a shape on the edge of a chunk in that chunk only, with its neighbor read across the edge', () => {
    const cells = new Cells().set(15, 0, 0, CUBE).set(16, 0, 0, piece(slabShape(false)));
    const left = meshChunk(cells, 0, 0, 0);
    const right = meshChunk(cells, 1, 0, 0);
    expect(left.triangleCount).toBeGreaterThan(0);
    expect(right.triangleCount).toBeGreaterThan(0);
    // The block in the left chunk shows its +x face because the slab does not cover it.
    expect(panelVerticesOn(left, 0, 16, 1)).toBe(4);
    // The slab's -x face is hidden behind the block in the other chunk.
    expect(panelVerticesOn(right, 0, 16, -1)).toBe(0);
  });
});

describe('modules beside blocks', () => {
  it('draw nothing of their own: the model is drawn by the module renderer', () => {
    for (let facing = 0; facing < 4; facing++) {
      const cells = new Cells().set(3, 4, 5, piece(moduleShape(MODULE.terminal, facing), 1));
      expect(mesh(cells).vertexCount, `facing ${facing}`).toBe(0);
    }
  });

  it('leave the block under them whole, top included, since they cover none of it', () => {
    const alone = mesh(new Cells().set(0, 0, 0, CUBE));
    const cells = new Cells()
      .set(0, 0, 0, CUBE)
      .set(0, 1, 0, piece(moduleShape(MODULE.terminal, 0), 1));
    const m = mesh(cells);
    expectClosed([m], 'a block with a module on it');
    expect(m.vertexCount).toBe(alone.vertexCount);
    expect(m.triangleCount).toBe(alone.triangleCount);
    expect(panelVerticesOn(m, 1, 1, 1)).toBe(4);
  });
});
