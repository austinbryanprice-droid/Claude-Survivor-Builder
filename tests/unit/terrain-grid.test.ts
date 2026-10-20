import { describe, expect, it } from 'vitest';
import { GRID_MARGIN } from '../../src/world/terrain/grid';
import { WORLD_HALF, WORLD_SIZE } from '../../src/world/terrain/field';
import { valley } from './helpers/valley';

describe('baked density grid', () => {
  const { field, grid } = valley();

  it('covers the world plus a margin, one node per meter', () => {
    expect(grid.cell).toBe(1);
    expect(grid.nx).toBe(WORLD_SIZE + 2 * GRID_MARGIN + 1);
    expect(grid.nz).toBe(grid.nx);
    expect(grid.originX).toBe(-WORLD_HALF - GRID_MARGIN);
    expect(grid.data.length).toBe(grid.nx * grid.ny * grid.nz);
  });

  it('holds the field value at every node it is asked about', () => {
    for (let i = 0; i < 60; i++) {
      const ix = 3 + ((i * 37) % (grid.nx - 6));
      const iz = 3 + ((i * 53) % (grid.nz - 6));
      const iy = 1 + ((i * 11) % (grid.ny - 2));
      const x = grid.originX + ix * grid.cell;
      const z = grid.originZ + iz * grid.cell;
      const y = iy * grid.cell;
      expect(grid.data[grid.index(ix, iy, iz)]).toBeCloseTo(field.sdf(x, y, z), 4);
      expect(grid.sample(x, y, z)).toBeCloseTo(field.sdf(x, y, z), 4);
    }
  });

  it('interpolates between nodes and clamps outside the grid', () => {
    const h = grid.groundAt(10, 20);
    expect(h).toBeCloseTo(field.heightAt(10, 20), 1);
    // The ground height is the zero of the field, so sampling there gives about zero.
    expect(Math.abs(grid.sample(10, h, 20))).toBeLessThan(0.1);
    expect(grid.sample(1000, 5, 1000)).toBe(
      grid.sample(WORLD_HALF + GRID_MARGIN, 5, WORLD_HALF + GRID_MARGIN),
    );
  });

  it('has a gradient that points up on open ground', () => {
    const g = new Float32Array(3);
    const h = grid.groundAt(10, 20);
    grid.gradient(10, h + 0.3, 20, g);
    const length = Math.hypot(g[0] as number, g[1] as number, g[2] as number);
    expect((g[1] as number) / length).toBeGreaterThan(0.9);
  });
});
