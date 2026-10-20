/**
 * Surface nets: one vertex per grid cell the surface passes through, joined into quads across
 * each sign-changing edge. Smooth, watertight and cheap, and it keeps overhangs that a
 * heightfield cannot. Normals come from the field gradient and ambient occlusion from short
 * probes along the normal, so both are smooth and identical on either side of a chunk border.
 */
import type { SdfGrid } from './grid';

export interface TerrainMeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** Ambient occlusion per vertex, 1 = open sky, 0 = fully occluded. */
  readonly ao: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
  /** Axis-aligned bounds: minX, minY, minZ, maxX, maxY, maxZ. */
  readonly bounds: readonly [number, number, number, number, number, number];
}

/** Half-open cell ranges in grid node indices. A chunk owns the edges whose lower node is inside. */
export interface MeshRegion {
  readonly ix0: number;
  readonly ix1: number;
  readonly iz0: number;
  readonly iz1: number;
  readonly iy0: number;
  readonly iy1: number;
}

/** Cube corner offsets: bit 0 = +x, bit 1 = +y, bit 2 = +z. */
const CORNER_X = [0, 1, 0, 1, 0, 1, 0, 1];
const CORNER_Y = [0, 0, 1, 1, 0, 0, 1, 1];
const CORNER_Z = [0, 0, 0, 0, 1, 1, 1, 1];
/** The 12 cube edges as corner pairs. */
const EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/** Highest solid node layer in the columns of a footprint, to bound the vertical scan. */
export function surfaceHeightRange(
  grid: SdfGrid,
  ix0: number,
  ix1: number,
  iz0: number,
  iz1: number,
): { low: number; high: number } {
  const { nx, nz, ny, data } = grid;
  let low = ny - 1;
  let high = 0;
  const x0 = Math.max(0, ix0 - 2);
  const x1 = Math.min(nx - 1, ix1 + 2);
  const z0 = Math.max(0, iz0 - 2);
  const z1 = Math.min(nz - 1, iz1 + 2);
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      const ground = Math.floor(grid.heights[ix + nx * iz] as number);
      if (ground - 3 < low) low = ground - 3;
      let top = ny - 1;
      while (top > 0 && (data[ix + nx * (iz + nz * top)] as number) >= 0) top--;
      if (top > high) high = top;
    }
  }
  return { low: Math.max(0, low), high: Math.min(ny - 2, high + 3) };
}

export function meshRegion(grid: SdfGrid, region: MeshRegion): TerrainMeshData {
  const { nx, nz, data, cell } = grid;
  const slab = nx * nz;
  const { ix0, ix1, iz0, iz1, iy0, iy1 } = region;

  // Cells run one layer below the owned range so each quad has all four of its cells.
  const cx = ix1 - ix0 + 1;
  const cy = iy1 - iy0 + 1;
  const cz = iz1 - iz0 + 1;
  const cellVertex = new Int32Array(cx * cy * cz).fill(-1);
  const cellId = (i: number, j: number, k: number): number => i + cx * (k + cz * j);

  const px: number[] = [];
  const corner = new Float32Array(8);

  for (let j = 0; j < cy; j++) {
    const iy = iy0 - 1 + j;
    if (iy < 0 || iy >= grid.ny - 1) continue;
    for (let k = 0; k < cz; k++) {
      const iz = iz0 - 1 + k;
      if (iz < 0 || iz >= nz - 1) continue;
      for (let i = 0; i < cx; i++) {
        const ix = ix0 - 1 + i;
        if (ix < 0 || ix >= nx - 1) continue;
        const base = ix + nx * iz + slab * iy;
        const d0 = data[base] as number;
        const d1 = data[base + 1] as number;
        const d2 = data[base + slab] as number;
        const d3 = data[base + slab + 1] as number;
        const d4 = data[base + nx] as number;
        const d5 = data[base + nx + 1] as number;
        const d6 = data[base + slab + nx] as number;
        const d7 = data[base + slab + nx + 1] as number;
        const mask =
          (d0 < 0 ? 1 : 0) |
          (d1 < 0 ? 2 : 0) |
          (d2 < 0 ? 4 : 0) |
          (d3 < 0 ? 8 : 0) |
          (d4 < 0 ? 16 : 0) |
          (d5 < 0 ? 32 : 0) |
          (d6 < 0 ? 64 : 0) |
          (d7 < 0 ? 128 : 0);
        if (mask === 0 || mask === 255) continue;
        corner[0] = d0;
        corner[1] = d1;
        corner[2] = d2;
        corner[3] = d3;
        corner[4] = d4;
        corner[5] = d5;
        corner[6] = d6;
        corner[7] = d7;

        let sx = 0;
        let sy = 0;
        let sz = 0;
        let count = 0;
        for (let e = 0; e < 12; e++) {
          const [a, b] = EDGES[e] as readonly [number, number];
          const inA = (mask >> a) & 1;
          const inB = (mask >> b) & 1;
          if (inA === inB) continue;
          const da = corner[a] as number;
          const db = corner[b] as number;
          const t = da / (da - db);
          sx += (CORNER_X[a] as number) + ((CORNER_X[b] as number) - (CORNER_X[a] as number)) * t;
          sy += (CORNER_Y[a] as number) + ((CORNER_Y[b] as number) - (CORNER_Y[a] as number)) * t;
          sz += (CORNER_Z[a] as number) + ((CORNER_Z[b] as number) - (CORNER_Z[a] as number)) * t;
          count++;
        }
        const inv = 1 / count;
        cellVertex[cellId(i, j, k)] = px.length / 3;
        px.push(
          grid.originX + (ix + sx * inv) * cell,
          (iy + sy * inv) * cell,
          grid.originZ + (iz + sz * inv) * cell,
        );
      }
    }
  }

  const vertexCount = px.length / 3;
  const idx: number[] = [];

  const emit = (v0: number, v1: number, v2: number, v3: number): void => {
    // Split along the shorter diagonal so thin slivers are avoided.
    const diag = (p: number, q: number): number => {
      const dx = (px[p * 3] as number) - (px[q * 3] as number);
      const dy = (px[p * 3 + 1] as number) - (px[q * 3 + 1] as number);
      const dz = (px[p * 3 + 2] as number) - (px[q * 3 + 2] as number);
      return dx * dx + dy * dy + dz * dz;
    };
    if (diag(v0, v2) <= diag(v1, v3)) idx.push(v0, v1, v2, v0, v2, v3);
    else idx.push(v1, v2, v3, v1, v3, v0);
  };

  for (let iy = iy0; iy < iy1; iy++) {
    for (let iz = iz0; iz < iz1; iz++) {
      for (let ix = ix0; ix < ix1; ix++) {
        const base = ix + nx * iz + slab * iy;
        const d0 = data[base] as number;
        const inside0 = d0 < 0;
        const i = ix - ix0 + 1;
        const j = iy - iy0 + 1;
        const k = iz - iz0 + 1;
        // Axis x: ring cells step in y then z.
        if (inside0 !== (data[base + 1] as number) < 0) {
          const c0 = cellVertex[cellId(i, j, k)] as number;
          const c1 = cellVertex[cellId(i, j - 1, k)] as number;
          const c2 = cellVertex[cellId(i, j - 1, k - 1)] as number;
          const c3 = cellVertex[cellId(i, j, k - 1)] as number;
          if (c0 >= 0 && c1 >= 0 && c2 >= 0 && c3 >= 0) {
            if (inside0) emit(c0, c1, c2, c3);
            else emit(c0, c3, c2, c1);
          }
        }
        // Axis y: ring cells step in z then x.
        if (inside0 !== (data[base + slab] as number) < 0) {
          const c0 = cellVertex[cellId(i, j, k)] as number;
          const c1 = cellVertex[cellId(i, j, k - 1)] as number;
          const c2 = cellVertex[cellId(i - 1, j, k - 1)] as number;
          const c3 = cellVertex[cellId(i - 1, j, k)] as number;
          if (c0 >= 0 && c1 >= 0 && c2 >= 0 && c3 >= 0) {
            if (inside0) emit(c0, c1, c2, c3);
            else emit(c0, c3, c2, c1);
          }
        }
        // Axis z: ring cells step in x then y.
        if (inside0 !== (data[base + nx] as number) < 0) {
          const c0 = cellVertex[cellId(i, j, k)] as number;
          const c1 = cellVertex[cellId(i - 1, j, k)] as number;
          const c2 = cellVertex[cellId(i - 1, j - 1, k)] as number;
          const c3 = cellVertex[cellId(i, j - 1, k)] as number;
          if (c0 >= 0 && c1 >= 0 && c2 >= 0 && c3 >= 0) {
            if (inside0) emit(c0, c1, c2, c3);
            else emit(c0, c3, c2, c1);
          }
        }
      }
    }
  }

  const positions = Float32Array.from(px);
  const normals = new Float32Array(vertexCount * 3);
  const ao = new Float32Array(vertexCount);
  const g = new Float32Array(3);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 3] as number;
    const y = positions[v * 3 + 1] as number;
    const z = positions[v * 3 + 2] as number;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
    grid.gradient(x, y, z, g);
    const len = Math.sqrt((g[0] as number) ** 2 + (g[1] as number) ** 2 + (g[2] as number) ** 2);
    const inv2 = len > 1e-6 ? 1 / len : 0;
    const nxv = len > 1e-6 ? (g[0] as number) * inv2 : 0;
    const nyv = len > 1e-6 ? (g[1] as number) * inv2 : 1;
    const nzv = len > 1e-6 ? (g[2] as number) * inv2 : 0;
    normals[v * 3] = nxv;
    normals[v * 3 + 1] = nyv;
    normals[v * 3 + 2] = nzv;
    ao[v] = ambientOcclusion(grid, x, y, z, nxv, nyv, nzv);
  }

  return {
    positions,
    normals,
    ao,
    indices: Uint32Array.from(idx),
    vertexCount,
    triangleCount: idx.length / 3,
    bounds: [minX, minY, minZ, maxX, maxY, maxZ],
  };
}

/** Short and long probes along the normal; the field value there says how boxed in the point is. */
const AO_PROBES: readonly (readonly [number, number])[] = [
  [0.7, 0.4],
  [1.8, 0.3],
  [4.0, 0.2],
  [9.0, 0.1],
];

export function ambientOcclusion(
  grid: SdfGrid,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
): number {
  let occlusion = 0;
  for (const [dist, weight] of AO_PROBES) {
    const d = grid.sample(x + nx * dist, y + ny * dist, z + nz * dist);
    const open = d / dist;
    occlusion += weight * Math.min(1, Math.max(0, 1 - open));
  }
  return Math.min(1, Math.max(0, 1 - occlusion * 1.15));
}
