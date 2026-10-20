/**
 * The smoothed-heightfield fallback the surface-nets mesher is measured against: the top
 * surface of the same density grid as a regular height grid, two triangles per cell. It is
 * cheaper to build and to draw, but it cannot show overhangs, so rock outcrops lose their
 * undercuts and cliff faces become one stretched slope. Normals and ambient occlusion come from
 * the same field as the surface-nets mesh, so the two differ in shape only.
 */
import type { SdfGrid } from './grid';
import { ambientOcclusion, type MeshRegion, type TerrainMeshData } from './surface-nets';

/**
 * Height of the topmost surface in one grid column, found by scanning down from `start` to the
 * first node inside the ground and interpolating to the zero crossing above it. Returns 0 for a
 * column with no ground.
 */
export function topSurfaceHeight(grid: SdfGrid, ix: number, iz: number, start: number): number {
  const { nx, nz, data, cell } = grid;
  const slab = nx * nz;
  const column = ix + nx * iz;
  for (let iy = Math.min(start, grid.ny - 2); iy >= 0; iy--) {
    const inside = data[column + slab * iy] as number;
    if (inside >= 0) continue;
    const above = data[column + slab * (iy + 1)] as number;
    const t = above > inside ? -inside / (above - inside) : 0;
    return (iy + t) * cell;
  }
  return 0;
}

/** Meshes the columns of a region as a height grid; `iy1` bounds where the scan starts. */
export function meshHeightfield(grid: SdfGrid, region: MeshRegion): TerrainMeshData {
  const { cell } = grid;
  const { ix0, ix1, iz0, iz1, iy1 } = region;
  const w = ix1 - ix0 + 1;
  const d = iz1 - iz0 + 1;
  const vertexCount = w * d;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const ao = new Float32Array(vertexCount);
  const g = new Float32Array(3);
  let minY = Infinity;
  let maxY = -Infinity;

  for (let k = 0; k < d; k++) {
    for (let i = 0; i < w; i++) {
      const v = i + w * k;
      const x = grid.originX + (ix0 + i) * cell;
      const z = grid.originZ + (iz0 + k) * cell;
      const y = topSurfaceHeight(grid, ix0 + i, iz0 + k, iy1);
      positions[v * 3] = x;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      grid.gradient(x, y, z, g);
      const len = Math.sqrt((g[0] as number) ** 2 + (g[1] as number) ** 2 + (g[2] as number) ** 2);
      const nxv = len > 1e-6 ? (g[0] as number) / len : 0;
      const nyv = len > 1e-6 ? (g[1] as number) / len : 1;
      const nzv = len > 1e-6 ? (g[2] as number) / len : 0;
      normals[v * 3] = nxv;
      normals[v * 3 + 1] = nyv;
      normals[v * 3 + 2] = nzv;
      ao[v] = ambientOcclusion(grid, x, y, z, nxv, nyv, nzv);
    }
  }

  const indices = new Uint32Array((w - 1) * (d - 1) * 6);
  let n = 0;
  const diag = (p: number, q: number): number => {
    const dx = (positions[p * 3] as number) - (positions[q * 3] as number);
    const dy = (positions[p * 3 + 1] as number) - (positions[q * 3 + 1] as number);
    const dz = (positions[p * 3 + 2] as number) - (positions[q * 3 + 2] as number);
    return dx * dx + dy * dy + dz * dz;
  };
  for (let k = 0; k < d - 1; k++) {
    for (let i = 0; i < w - 1; i++) {
      const a = i + w * k;
      const b = a + 1;
      const c = a + w + 1;
      const e = a + w;
      // Counter-clockwise seen from above, split along the shorter diagonal.
      if (diag(a, c) <= diag(b, e)) {
        indices[n++] = a;
        indices[n++] = e;
        indices[n++] = c;
        indices[n++] = a;
        indices[n++] = c;
        indices[n++] = b;
      } else {
        indices[n++] = a;
        indices[n++] = e;
        indices[n++] = b;
        indices[n++] = b;
        indices[n++] = e;
        indices[n++] = c;
      }
    }
  }

  return {
    positions,
    normals,
    ao,
    indices,
    vertexCount,
    triangleCount: indices.length / 3,
    bounds: [
      grid.originX + ix0 * cell,
      minY,
      grid.originZ + iz0 * cell,
      grid.originX + ix1 * cell,
      maxY,
      grid.originZ + iz1 * cell,
    ],
  };
}
