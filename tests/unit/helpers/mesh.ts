import { expect } from 'vitest';
import { MATERIAL, SHAPE, packState } from '../../../src/shared/blocks';
import { CHUNK_SIZE } from '../../../src/world/voxels/chunk';
import { ChunkMesher, type ChunkMeshData } from '../../../src/world/voxels/mesher';

/** Helpers for tests that mesh small worlds and check the result is one closed, consistently wound surface. */

export const CUBE = packState(SHAPE.cube, MATERIAL.scrap);

/** A bare grid of cells the mesher can read, with no terrain and no bounds. */
export class Cells {
  private readonly map = new Map<string, number>();
  set(x: number, y: number, z: number, state = CUBE): this {
    this.map.set(`${x},${y},${z}`, state);
    return this;
  }
  getBlock = (x: number, y: number, z: number): number => this.map.get(`${x},${y},${z}`) ?? 0;
  /** The chunk coordinates that hold at least one cell, so the whole world can be meshed. */
  chunks(): [number, number, number][] {
    const seen = new Set<string>();
    const out: [number, number, number][] = [];
    for (const key of this.map.keys()) {
      const [x, y, z] = key.split(',').map(Number) as [number, number, number];
      const c: [number, number, number] = [
        Math.floor(x / CHUNK_SIZE),
        Math.floor(y / CHUNK_SIZE),
        Math.floor(z / CHUNK_SIZE),
      ];
      const id = c.join(',');
      if (!seen.has(id)) {
        seen.add(id);
        out.push(c);
      }
    }
    return out;
  }
  get size(): number {
    return this.map.size;
  }
}

export function meshAll(cells: Cells): ChunkMeshData[] {
  const mesher = new ChunkMesher();
  return cells.chunks().map(([cx, cy, cz]) => mesher.mesh(cells, cx, cy, cz));
}

export const total = (meshes: ChunkMeshData[], field: 'triangleCount' | 'vertexCount'): number =>
  meshes.reduce((sum, m) => sum + m[field], 0);

export interface Audit {
  triangles: number;
  /** Edges used by one triangle only, so the surface has a hole there. */
  open: string[];
  /** Edges used twice the same way round, or more than twice. */
  tangled: string[];
  degenerate: number;
  /** Triangles whose winding disagrees with their vertex normals. */
  inverted: number;
  /** Corners, edges and faces after joining vertices that sit in the same place. */
  vertices: number;
  edges: number;
}

/** Joins vertices by position and checks the pieces make one closed, consistently wound surface. */
export function audit(meshes: ChunkMeshData[]): Audit {
  const ids = new Map<string, number>();
  const weld = (p: Float32Array, i: number): number => {
    const key = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]
      .map((v) => Math.round((v as number) * 1000))
      .join(',');
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    return id;
  };
  const directed = new Map<string, number>();
  let triangles = 0;
  let degenerate = 0;
  let inverted = 0;
  for (const m of meshes) {
    const p = m.positions;
    const n = m.normals;
    for (let t = 0; t < m.indices.length; t += 3) {
      const tri = [m.indices[t], m.indices[t + 1], m.indices[t + 2]] as [number, number, number];
      const w = tri.map((i) => weld(p, i)) as [number, number, number];
      triangles++;
      if (w[0] === w[1] || w[1] === w[2] || w[2] === w[0]) {
        degenerate++;
        continue;
      }
      for (let e = 0; e < 3; e++) {
        const key = `${w[e]}>${w[(e + 1) % 3]}`;
        directed.set(key, (directed.get(key) ?? 0) + 1);
      }
      const [a, b, c] = tri;
      const e1 = [0, 1, 2].map((k) => (p[b * 3 + k] as number) - (p[a * 3 + k] as number));
      const e2 = [0, 1, 2].map((k) => (p[c * 3 + k] as number) - (p[a * 3 + k] as number));
      const cross = [
        (e1[1] as number) * (e2[2] as number) - (e1[2] as number) * (e2[1] as number),
        (e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number),
        (e1[0] as number) * (e2[1] as number) - (e1[1] as number) * (e2[0] as number),
      ];
      const area = Math.hypot(...(cross as [number, number, number]));
      if (area < 1e-6) degenerate++;
      let along = 0;
      for (let k = 0; k < 3; k++) along += (cross[k] as number) * (n[a * 3 + k] as number);
      if (along <= 0.3 * area) inverted++;
    }
  }
  const open: string[] = [];
  const tangled: string[] = [];
  const undirected = new Set<string>();
  for (const [key, count] of directed) {
    const [u, v] = key.split('>') as [string, string];
    undirected.add(Number(u) < Number(v) ? key : `${v}>${u}`);
    if (count !== 1) tangled.push(`${key} x${count}`);
    if (!directed.has(`${v}>${u}`)) open.push(key);
  }
  return {
    triangles,
    open,
    tangled,
    degenerate,
    inverted,
    vertices: ids.size,
    edges: undirected.size,
  };
}

export function expectClosed(meshes: ChunkMeshData[], label: string): Audit {
  const result = audit(meshes);
  expect(result.degenerate, `${label}: degenerate triangles`).toBe(0);
  expect(result.open.slice(0, 5), `${label}: open edges (${result.open.length})`).toEqual([]);
  expect(result.tangled.slice(0, 5), `${label}: tangled edges (${result.tangled.length})`).toEqual(
    [],
  );
  expect(result.inverted, `${label}: triangles facing against their normals`).toBe(0);
  return result;
}

/** A small deterministic generator so every run builds the same worlds. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function randomCells(
  seed: number,
  size: number,
  density: number,
  at: [number, number, number],
): Cells {
  const random = rng(seed);
  const cells = new Cells();
  for (let y = 0; y < size; y++)
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++)
        if (random() < density) cells.set(at[0] + x, at[1] + y, at[2] + z);
  return cells;
}
