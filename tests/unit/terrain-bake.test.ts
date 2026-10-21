import { describe, expect, it } from 'vitest';
import { bakeTerrain } from '../../src/world/terrain/terrain';

describe('bakeTerrain', () => {
  it('bakes the field and the ground grid for the seed and times both for the benchmark report', () => {
    const terrain = bakeTerrain(7);
    expect(terrain.seed).toBe(7);
    expect(Number.isFinite(terrain.buildMs.field)).toBe(true);
    expect(terrain.buildMs.field).toBeGreaterThanOrEqual(0);
    // Baking the grid samples the field at every point, so it cannot be instant.
    expect(terrain.buildMs.grid).toBeGreaterThan(0);
    expect(terrain.grid.groundAt(0, 0)).toBeGreaterThan(0);
  });
});
