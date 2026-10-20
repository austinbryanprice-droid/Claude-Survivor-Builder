/**
 * The terrain field sampled on a regular grid. The surface mesher, vertex normals, ambient
 * occlusion and collision all read this one grid, so the mesh you see is the surface you
 * stand on.
 *
 * Layout: nodes are 1 meter apart. Index = ix + nx * (iz + nz * iy), so each horizontal
 * slab is contiguous. Node (0, 0, 0) sits at `origin`.
 */
import { smin } from '../../shared/noise';
import { WORLD_HALF, Y_MAX, type TerrainField } from './field';

export interface SdfGrid {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly originX: number;
  readonly originZ: number;
  readonly cell: number;
  /** Signed distance at each node; negative inside the ground or a rock. */
  readonly data: Float32Array;
  /** Ground height per (ix, iz) column, without rock features. */
  readonly heights: Float32Array;
  index(ix: number, iy: number, iz: number): number;
  /** Trilinear sample in world coordinates; outside the grid it clamps to the border. */
  sample(x: number, y: number, z: number): number;
  /** Trilinear central-difference gradient (not normalized), written into `out`. */
  gradient(x: number, y: number, z: number, out: Float32Array | number[]): void;
  /** Ground height by bilinear interpolation of the column heights. */
  groundAt(x: number, z: number): number;
}

/** Nodes of padding beyond the playable square, so border chunks have neighbors to read. */
export const GRID_MARGIN = 2;

export function bakeGrid(field: TerrainField): SdfGrid {
  const cell = 1;
  const side = WORLD_HALF * 2 + GRID_MARGIN * 2 + 1;
  const nx = side;
  const nz = side;
  const ny = Y_MAX + 1;
  const originX = -WORLD_HALF - GRID_MARGIN;
  const originZ = -WORLD_HALF - GRID_MARGIN;

  const heights = new Float32Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      heights[ix + nx * iz] = field.heightAt(originX + ix * cell, originZ + iz * cell);
    }
  }

  const data = new Float32Array(nx * nz * ny);
  const slab = nx * nz;
  for (let iy = 0; iy < ny; iy++) {
    const y = iy * cell;
    const base = iy * slab;
    for (let i = 0; i < slab; i++) data[base + i] = y - (heights[i] as number);
  }

  // Rock features union in with a smooth minimum, in the same order as `field.sdf`.
  for (const rock of field.rocks) {
    const ix0 = Math.max(0, Math.floor((rock.x - rock.bound - originX) / cell));
    const ix1 = Math.min(nx - 1, Math.ceil((rock.x + rock.bound - originX) / cell));
    const iz0 = Math.max(0, Math.floor((rock.z - rock.bound - originZ) / cell));
    const iz1 = Math.min(nz - 1, Math.ceil((rock.z + rock.bound - originZ) / cell));
    const iy0 = Math.max(0, Math.floor((rock.y - rock.bound) / cell));
    const iy1 = Math.min(ny - 1, Math.ceil((rock.y + rock.bound) / cell));
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = originX + ix * cell;
          const z = originZ + iz * cell;
          const dx = x - rock.x;
          const dz = z - rock.z;
          if (dx * dx + dz * dz > rock.bound * rock.bound) continue;
          const idx = ix + nx * (iz + nz * iy);
          data[idx] = smin(data[idx] as number, field.rockSdf(rock, x, iy * cell, z), 1.3);
        }
      }
    }
  }

  const index = (ix: number, iy: number, iz: number): number => ix + nx * (iz + nz * iy);

  const clampI = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

  const sample = (x: number, y: number, z: number): number => {
    let fx = (x - originX) / cell;
    let fy = y / cell;
    let fz = (z - originZ) / cell;
    fx = fx < 0 ? 0 : fx > nx - 1.0001 ? nx - 1.0001 : fx;
    fy = fy < 0 ? 0 : fy > ny - 1.0001 ? ny - 1.0001 : fy;
    fz = fz < 0 ? 0 : fz > nz - 1.0001 ? nz - 1.0001 : fz;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const iz = Math.floor(fz);
    const u = fx - ix;
    const v = fy - iy;
    const w = fz - iz;
    const i000 = ix + nx * (iz + nz * iy);
    const i100 = i000 + 1;
    const i010 = i000 + slab;
    const i110 = i010 + 1;
    const i001 = i000 + nx;
    const i101 = i001 + 1;
    const i011 = i010 + nx;
    const i111 = i011 + 1;
    const x00 = (data[i000] as number) * (1 - u) + (data[i100] as number) * u;
    const x10 = (data[i010] as number) * (1 - u) + (data[i110] as number) * u;
    const x01 = (data[i001] as number) * (1 - u) + (data[i101] as number) * u;
    const x11 = (data[i011] as number) * (1 - u) + (data[i111] as number) * u;
    const y0 = x00 * (1 - v) + x10 * v;
    const y1 = x01 * (1 - v) + x11 * v;
    return y0 * (1 - w) + y1 * w;
  };

  const nodeGradient = (ix: number, iy: number, iz: number, out: number[]): void => {
    const xm = clampI(ix - 1, nx - 1);
    const xp = clampI(ix + 1, nx - 1);
    const ym = clampI(iy - 1, ny - 1);
    const yp = clampI(iy + 1, ny - 1);
    const zm = clampI(iz - 1, nz - 1);
    const zp = clampI(iz + 1, nz - 1);
    out[0] =
      ((data[xp + nx * (iz + nz * iy)] as number) - (data[xm + nx * (iz + nz * iy)] as number)) /
      ((xp - xm) * cell);
    out[1] =
      ((data[ix + nx * (iz + nz * yp)] as number) - (data[ix + nx * (iz + nz * ym)] as number)) /
      ((yp - ym) * cell);
    out[2] =
      ((data[ix + nx * (zp + nz * iy)] as number) - (data[ix + nx * (zm + nz * iy)] as number)) /
      ((zp - zm) * cell);
  };

  const g = [0, 0, 0];
  const gradient = (x: number, y: number, z: number, out: Float32Array | number[]): void => {
    let fx = (x - originX) / cell;
    let fy = y / cell;
    let fz = (z - originZ) / cell;
    fx = fx < 0 ? 0 : fx > nx - 1.0001 ? nx - 1.0001 : fx;
    fy = fy < 0 ? 0 : fy > ny - 1.0001 ? ny - 1.0001 : fy;
    fz = fz < 0 ? 0 : fz > nz - 1.0001 ? nz - 1.0001 : fz;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const iz = Math.floor(fz);
    const u = fx - ix;
    const v = fy - iy;
    const w = fz - iz;
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (let k = 0; k < 8; k++) {
      const dx = k & 1;
      const dy = (k >> 1) & 1;
      const dz = (k >> 2) & 1;
      const weight = (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
      nodeGradient(ix + dx, iy + dy, iz + dz, g);
      gx += (g[0] as number) * weight;
      gy += (g[1] as number) * weight;
      gz += (g[2] as number) * weight;
    }
    out[0] = gx;
    out[1] = gy;
    out[2] = gz;
  };

  const groundAt = (x: number, z: number): number => {
    let fx = (x - originX) / cell;
    let fz = (z - originZ) / cell;
    fx = fx < 0 ? 0 : fx > nx - 1.0001 ? nx - 1.0001 : fx;
    fz = fz < 0 ? 0 : fz > nz - 1.0001 ? nz - 1.0001 : fz;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const u = fx - ix;
    const w = fz - iz;
    const i00 = ix + nx * iz;
    const h0 = (heights[i00] as number) * (1 - u) + (heights[i00 + 1] as number) * u;
    const h1 = (heights[i00 + nx] as number) * (1 - u) + (heights[i00 + nx + 1] as number) * u;
    return h0 * (1 - w) + h1 * w;
  };

  return { nx, ny, nz, originX, originZ, cell, data, heights, index, sample, gradient, groundAt };
}
