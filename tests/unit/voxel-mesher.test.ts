import { describe, expect, it } from 'vitest';
import { MATERIAL, SHAPE, TILE_LAYOUTS, packState } from '../../src/shared/blocks';
import {
  AO_BRIGHTNESS,
  BEVEL,
  ChunkMesher,
  GROOVE_BRIGHTNESS,
  PRIMITIVE,
  meshChunk,
} from '../../src/world/voxels/mesher';
import { Cells, expectClosed, meshAll, randomCells, total } from './helpers/mesh';

describe('chunk mesher', () => {
  it('draws nothing for an empty chunk', () => {
    const mesh = meshChunk(new Cells(), 0, 0, 0);
    expect(mesh.triangleCount).toBe(0);
    expect(mesh.vertexCount).toBe(0);
  });

  it('draws one block as a closed beveled cube: 6 panels, 12 strips and 8 corners', () => {
    const cells = new Cells().set(3, 4, 5);
    const mesh = meshChunk(cells, 0, 0, 0);
    expect(mesh.triangleCount).toBe(6 * 2 + 12 * 2 + 8);
    expect(mesh.vertexCount).toBe(6 * 4 + 12 * 4 + 8 * 3);
    const result = expectClosed([mesh], 'one block');
    // Welded, it is a sphere: V - E + F = 2.
    expect(result.vertices - result.edges + result.triangles).toBe(2);
    expect(mesh.bounds).toEqual([3, 4, 5, 4, 5, 6]);
  });

  it('keeps the bevel inside the spec range', () => {
    expect(BEVEL).toBeGreaterThanOrEqual(0.05);
    expect(BEVEL).toBeLessThanOrEqual(0.12);
  });

  it('leaves the faces between two blocks undrawn and the seam as a groove', () => {
    const cells = new Cells().set(0, 0, 0).set(1, 0, 0);
    const mesh = meshChunk(cells, 0, 0, 0);
    expectClosed([mesh], 'two blocks');
    const { positions, normals, aux } = mesh;
    for (let i = 0; i < mesh.vertexCount; i++) {
      if (((aux[i * 4 + 2] as number) & 3) !== PRIMITIVE.panel) continue;
      // No panel lies on the plane x = 1, where the blocks touch.
      if (Math.abs(normals[i * 3] as number) === 1) {
        expect(positions[i * 3]).not.toBe(1);
      }
    }
    expect(mesh.triangleCount).toBeLessThan(2 * 44);
  });

  it('draws nothing for a block with solid cells all around it', () => {
    const cells = new Cells();
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) cells.set(x, y, z);
    const mesh = meshChunk(cells, 0, 0, 0);
    expectClosed([mesh], 'three by three by three');
    for (let i = 0; i < mesh.vertexCount; i++) {
      const inside = [0, 1, 2].every((k) => {
        const v = mesh.positions[i * 3 + k] as number;
        return v > 1.01 && v < 1.99;
      });
      expect(inside, `vertex ${i} is inside the middle block`).toBe(false);
    }
    expect(mesh.triangleCount).toBeLessThan(27 * 44);
  });

  it('seals the shafts where four blocks meet and the line of meeting opens to the air', () => {
    // A 2 by 2 column, 3 tall. Where four blocks meet along an edge the chamfers leave a shaft the
    // width of two bevels. Down the middle it opens at the top and the bottom (2 caps), and through
    // the two layers of side faces it opens on each of the four sides (2 lines of 2 caps, twice).
    const cells = new Cells();
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 2; x++) for (let z = 0; z < 2; z++) cells.set(x, y, z);
    const mesh = meshChunk(cells, 0, 0, 0);
    expectClosed([mesh], 'column');
    let capVertices = 0;
    for (let i = 0; i < mesh.vertexCount; i++)
      if (((mesh.aux[i * 4 + 2] as number) & 3) === PRIMITIVE.cap) capVertices++;
    expect(capVertices).toBe(10 * 4);
  });

  it('is closed over random worlds, including ones that cross chunk borders', () => {
    const cases: [number, number, number, [number, number, number]][] = [
      [1, 8, 0.3, [0, 0, 0]],
      [2, 8, 0.5, [12, 12, 12]],
      [3, 8, 0.7, [-4, 13, 29]],
      [4, 7, 0.9, [15, 15, 15]],
      [5, 10, 0.55, [-9, 3, -7]],
      [6, 6, 0.99, [14, -3, 14]],
    ];
    for (const [seed, size, density, at] of cases) {
      const cells = randomCells(seed, size, density, at);
      expectClosed(meshAll(cells), `seed ${seed} density ${density}`);
    }
  });

  it('draws the same pattern with the same number of triangles wherever it sits', () => {
    const counts = new Set<number>();
    for (const at of [
      [0, 0, 0],
      [5, 3, 7],
      [11, 14, 9],
      [-3, 12, -6],
    ] as [number, number, number][]) {
      counts.add(total(meshAll(randomCells(11, 9, 0.6, at)), 'triangleCount'));
    }
    expect(counts.size).toBe(1);
  });

  it('grows past 65535 vertices and switches to 32-bit indices', () => {
    // A checkerboard of separate blocks: 2048 of them, each 96 vertices.
    const cells = new Cells();
    for (let y = 0; y < 16; y++)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) if ((x + y + z) % 2 === 0) cells.set(x, y, z);
    const mesh = meshChunk(cells, 0, 0, 0);
    expect(mesh.vertexCount).toBe(2048 * 96);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);
    expectClosed([mesh], 'checkerboard');
    const small = meshChunk(new Cells().set(0, 0, 0), 0, 0, 0);
    expect(small.indices).toBeInstanceOf(Uint16Array);
  });

  it('darkens the corners of a face that a neighbouring block boxes in', () => {
    // A block with another one beside and above it: the top face's corner toward it is occluded.
    const cells = new Cells().set(0, 0, 0).set(1, 1, 0);
    const mesh = meshChunk(cells, 0, 0, 0);
    const { positions, normals, aux } = mesh;
    const topAo = new Map<string, number>();
    for (let i = 0; i < mesh.vertexCount; i++) {
      const x = positions[i * 3] as number;
      const y = positions[i * 3 + 1] as number;
      const z = positions[i * 3 + 2] as number;
      if (((aux[i * 4 + 2] as number) & 3) !== PRIMITIVE.panel) continue;
      if (normals[i * 3 + 1] !== 1 || x > 1 || y !== 1) continue;
      topAo.set(`${x.toFixed(2)},${z.toFixed(2)}`, aux[i * 4] as number);
    }
    const open = Math.round(AO_BRIGHTNESS[3] * 255);
    const side = Math.round(AO_BRIGHTNESS[2] * 255);
    expect(topAo.get(`${BEVEL.toFixed(2)},${BEVEL.toFixed(2)}`)).toBe(open);
    expect(topAo.get(`${(1 - BEVEL).toFixed(2)},${BEVEL.toFixed(2)}`)).toBe(side);
    expect(topAo.get(`${(1 - BEVEL).toFixed(2)},${(1 - BEVEL).toFixed(2)}`)).toBe(side);
  });

  it('shades the groove between blocks darker than an open face', () => {
    const cells = new Cells().set(0, 0, 0).set(1, 0, 0);
    const mesh = meshChunk(cells, 0, 0, 0);
    const groove = Math.round(GROOVE_BRIGHTNESS * 255);
    let grooveVertices = 0;
    for (let i = 0; i < mesh.vertexCount; i++) {
      if (mesh.aux[i * 4] === groove) grooveVertices++;
    }
    expect(grooveVertices).toBeGreaterThan(0);
    expect(groove).toBeLessThan(Math.round(AO_BRIGHTNESS[3] * 255));
  });

  it("carries each block's material to its vertices", () => {
    const cells = new Cells()
      .set(0, 0, 0, packState(SHAPE.cube, MATERIAL.scrap))
      .set(5, 0, 0, packState(SHAPE.cube, MATERIAL.alloy))
      .set(10, 0, 0, packState(SHAPE.cube, MATERIAL.energy));
    const mesh = meshChunk(cells, 0, 0, 0);
    const byCell = new Map<number, Set<number>>();
    for (let i = 0; i < mesh.vertexCount; i++) {
      const cell = Math.floor((mesh.positions[i * 3] as number) / 5);
      const set = byCell.get(cell) ?? new Set<number>();
      set.add(mesh.aux[i * 4 + 1] as number);
      byCell.set(cell, set);
    }
    expect([...(byCell.get(0) ?? [])]).toEqual([MATERIAL.scrap]);
    expect([...(byCell.get(1) ?? [])]).toEqual([MATERIAL.alloy]);
    expect([...(byCell.get(2) ?? [])]).toEqual([MATERIAL.energy]);
  });

  it('gives the same mesh every time for the same cells', () => {
    const cells = randomCells(21, 9, 0.6, [2, 2, 2]);
    const a = meshChunk(cells, 0, 0, 0);
    const b = new ChunkMesher().mesh(cells, 0, 0, 0);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    expect(Array.from(a.aux)).toEqual(Array.from(b.aux));
  });

  it('keeps texture coordinates in the tile and normals unit length', () => {
    const mesh = meshChunk(randomCells(31, 9, 0.6, [1, 1, 1]), 0, 0, 0);
    for (let i = 0; i < mesh.vertexCount; i++) {
      const u = mesh.uvs[i * 2] as number;
      const v = mesh.uvs[i * 2 + 1] as number;
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      const length = Math.hypot(
        mesh.normals[i * 3] as number,
        mesh.normals[i * 3 + 1] as number,
        mesh.normals[i * 3 + 2] as number,
      );
      expect(length).toBeCloseTo(1, 5);
    }
  });

  it('costs few triangles for a flat wall: about sixteen to a face', () => {
    const cells = new Cells();
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) cells.set(x, y, 0);
    const mesh = meshChunk(cells, 0, 0, 0);
    expectClosed([mesh], 'wall');
    // 64 blocks, two big faces each; the budget keeps a whole village inside a few hundred thousand.
    expect(mesh.triangleCount / 64).toBeLessThan(44);
  });

  it('gives each face one tile layout, carried above the primitive kind', () => {
    // Blocks two apart never touch, so every block shows all six faces.
    const cells = new Cells();
    for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) cells.set(x * 2, 0, z * 2);
    const mesh = meshChunk(cells, 0, 0, 0);
    const byFace = new Map<string, Set<number>>();
    const seen = new Set<number>();
    for (let i = 0; i < mesh.vertexCount; i++) {
      const packed = mesh.aux[i * 4 + 2] as number;
      const layout = packed >> 2;
      expect(layout).toBeGreaterThanOrEqual(0);
      expect(layout).toBeLessThan(TILE_LAYOUTS);
      seen.add(layout);
      if ((packed & 3) !== PRIMITIVE.panel) continue;
      // A panel is one face of one block: find the block by where the panel's corner sits.
      const x = Math.floor(mesh.positions[i * 3] as number);
      const z = Math.floor(mesh.positions[i * 3 + 2] as number);
      const key = `${x},${z},${mesh.normals[i * 3]},${mesh.normals[i * 3 + 1]},${mesh.normals[i * 3 + 2]}`;
      const set = byFace.get(key) ?? new Set<number>();
      set.add(layout);
      byFace.set(key, set);
    }
    // Every face's four panel vertices agree, and over many faces every layout turns up.
    expect(byFace.size).toBeGreaterThan(100);
    for (const set of byFace.values()) expect(set.size).toBe(1);
    expect(seen.size).toBe(TILE_LAYOUTS);
  });
});
