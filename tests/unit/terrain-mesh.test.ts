import { beforeAll, describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../../src/world/render/terrain-render';
import { GRID_MARGIN } from '../../src/world/terrain/grid';
import { meshHeightfield, topSurfaceHeight } from '../../src/world/terrain/heightfield';
import {
  meshRegion,
  surfaceHeightRange,
  type MeshRegion,
  type TerrainMeshData,
} from '../../src/world/terrain/surface-nets';
import { valley } from './helpers/valley';

const CHUNKS = 6;

function chunkRegion(cx: number, cz: number): MeshRegion {
  const { grid } = valley();
  const ix0 = GRID_MARGIN + cx * CHUNK_SIZE;
  const iz0 = GRID_MARGIN + cz * CHUNK_SIZE;
  const range = surfaceHeightRange(grid, ix0, ix0 + CHUNK_SIZE, iz0, iz0 + CHUNK_SIZE);
  return {
    ix0,
    ix1: ix0 + CHUNK_SIZE,
    iz0,
    iz1: iz0 + CHUNK_SIZE,
    iy0: range.low,
    iy1: range.high,
  };
}

describe('surface-nets terrain mesh', () => {
  const { field, grid } = valley();
  const meshes: TerrainMeshData[] = [];

  beforeAll(() => {
    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) meshes.push(meshRegion(grid, chunkRegion(cx, cz)));
    }
  });

  it('builds the recorded number of vertices and triangles for the whole valley', () => {
    let vertices = 0;
    let triangles = 0;
    for (const m of meshes) {
      vertices += m.vertexCount;
      triangles += m.triangleCount;
    }
    expect(vertices).toBe(65276);
    expect(triangles).toBe(123182);
  });

  it('indexes only vertices that exist and keeps every number finite', () => {
    for (const m of meshes) {
      expect(m.positions.length).toBe(m.vertexCount * 3);
      expect(m.normals.length).toBe(m.vertexCount * 3);
      expect(m.ao.length).toBe(m.vertexCount);
      expect(m.indices.length).toBe(m.triangleCount * 3);
      for (const i of m.indices) expect(i).toBeLessThan(m.vertexCount);
      for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
      for (const v of m.normals) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('puts every vertex close to the surface of the field', () => {
    let worst = 0;
    for (const m of meshes) {
      for (let v = 0; v < m.vertexCount; v += 7) {
        const d = Math.abs(
          field.sdf(
            m.positions[v * 3] as number,
            m.positions[v * 3 + 1] as number,
            m.positions[v * 3 + 2] as number,
          ),
        );
        worst = Math.max(worst, d);
      }
    }
    expect(worst).toBeLessThan(0.9);
  });

  it('gives unit normals and ambient occlusion in range', () => {
    for (const m of meshes) {
      for (let v = 0; v < m.vertexCount; v += 5) {
        const length = Math.hypot(
          m.normals[v * 3] as number,
          m.normals[v * 3 + 1] as number,
          m.normals[v * 3 + 2] as number,
        );
        expect(length).toBeCloseTo(1, 3);
        expect(m.ao[v]).toBeGreaterThanOrEqual(0);
        expect(m.ao[v]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('winds triangles to face out of the ground', () => {
    let agree = 0;
    let total = 0;
    for (const m of meshes) {
      for (let t = 0; t < m.triangleCount; t += 3) {
        const a = (m.indices[t * 3] as number) * 3;
        const b = (m.indices[t * 3 + 1] as number) * 3;
        const c = (m.indices[t * 3 + 2] as number) * 3;
        const p = m.positions;
        const e1 = [
          (p[b] as number) - (p[a] as number),
          (p[b + 1] as number) - (p[a + 1] as number),
          (p[b + 2] as number) - (p[a + 2] as number),
        ] as const;
        const e2 = [
          (p[c] as number) - (p[a] as number),
          (p[c + 1] as number) - (p[a + 1] as number),
          (p[c + 2] as number) - (p[a + 2] as number),
        ] as const;
        const nx = e1[1] * e2[2] - e1[2] * e2[1];
        const ny = e1[2] * e2[0] - e1[0] * e2[2];
        const nz = e1[0] * e2[1] - e1[1] * e2[0];
        const dot =
          nx * (m.normals[a] as number) +
          ny * (m.normals[a + 1] as number) +
          nz * (m.normals[a + 2] as number);
        total++;
        if (dot > 0) agree++;
      }
    }
    expect(agree / total).toBeGreaterThan(0.97);
  });

  it('reports bounds that contain the vertices', () => {
    for (const m of meshes) {
      const [x0, y0, z0, x1, y1, z1] = m.bounds;
      for (let v = 0; v < m.vertexCount; v += 11) {
        expect(m.positions[v * 3] as number).toBeGreaterThanOrEqual(x0);
        expect(m.positions[v * 3] as number).toBeLessThanOrEqual(x1);
        expect(m.positions[v * 3 + 1] as number).toBeGreaterThanOrEqual(y0);
        expect(m.positions[v * 3 + 1] as number).toBeLessThanOrEqual(y1);
        expect(m.positions[v * 3 + 2] as number).toBeGreaterThanOrEqual(z0);
        expect(m.positions[v * 3 + 2] as number).toBeLessThanOrEqual(z1);
      }
    }
  });
});

describe('smoothed-heightfield fallback', () => {
  const { grid } = valley();

  it('finds the ground height exactly in rock-free columns', () => {
    for (let i = 0; i < 40; i++) {
      const ix = 10 + ((i * 29) % (grid.nx - 20));
      const iz = 10 + ((i * 41) % (grid.nz - 20));
      // Skip columns a rock reaches into: the top surface is then above the ground.
      const top = topSurfaceHeight(grid, ix, iz, grid.ny - 2);
      const ground = grid.heights[ix + grid.nx * iz] as number;
      expect(top).toBeGreaterThanOrEqual(ground - 1e-3);
      if (top - ground < 1e-3) expect(top).toBeCloseTo(ground, 3);
    }
  });

  it('rises above the ground where a rock stands', () => {
    const { field } = valley();
    const rock = field.rocks[3];
    expect(rock).toBeDefined();
    if (!rock) return;
    const ix = Math.round((rock.x - grid.originX) / grid.cell);
    const iz = Math.round((rock.z - grid.originZ) / grid.cell);
    const top = topSurfaceHeight(grid, ix, iz, grid.ny - 2);
    expect(top).toBeGreaterThan((grid.heights[ix + grid.nx * iz] as number) + 2);
  });

  it('builds a regular grid: (n+1)^2 vertices and 2n^2 triangles per chunk', () => {
    const m = meshHeightfield(grid, chunkRegion(2, 2));
    expect(m.vertexCount).toBe((CHUNK_SIZE + 1) ** 2);
    expect(m.triangleCount).toBe(2 * CHUNK_SIZE ** 2);
    for (const i of m.indices) expect(i).toBeLessThan(m.vertexCount);
  });

  it('faces up', () => {
    const m = meshHeightfield(grid, chunkRegion(2, 2));
    const p = m.positions;
    for (let t = 0; t < m.triangleCount; t++) {
      const a = (m.indices[t * 3] as number) * 3;
      const b = (m.indices[t * 3 + 1] as number) * 3;
      const c = (m.indices[t * 3 + 2] as number) * 3;
      const ux = (p[b] as number) - (p[a] as number);
      const uz = (p[b + 2] as number) - (p[a + 2] as number);
      const vx = (p[c] as number) - (p[a] as number);
      const vz = (p[c + 2] as number) - (p[a + 2] as number);
      // The y component of the cross product: positive when the triangle faces up.
      expect(uz * vx - ux * vz).toBeGreaterThan(0);
    }
  });

  it('costs fewer triangles than surface nets over the whole valley', () => {
    let heightfield = 0;
    let nets = 0;
    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const region = chunkRegion(cx, cz);
        heightfield += meshHeightfield(grid, region).triangleCount;
        nets += meshRegion(grid, region).triangleCount;
      }
    }
    expect(heightfield).toBe(73728);
    expect(nets).toBeGreaterThan(heightfield);
  });
});
