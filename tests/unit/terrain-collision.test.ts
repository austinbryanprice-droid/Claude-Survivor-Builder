import { describe, expect, it } from 'vitest';
import type { SdfGrid } from '../../src/world/terrain/grid';
import { WALKABLE_NORMAL_Y, resolveTerrain } from '../../src/world/terrain/collision';
import { valley } from './helpers/valley';

const RADIUS = 0.36;
const PROBES = [RADIUS, 0.95, 1.5];

/** A planar ground tilted by `angle` radians about the z axis, passing through the origin. */
function slope(angle: number): SdfGrid {
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  return {
    sample: (x: number, y: number) => x * nx + y * ny,
    gradient: (_x: number, _y: number, _z: number, out: Float32Array | number[]) => {
      out[0] = nx;
      out[1] = ny;
      out[2] = 0;
    },
  } as unknown as SdfGrid;
}

describe('terrain collision', () => {
  it('lifts a body out of flat ground and calls it grounded', () => {
    const position = { x: 0, y: -0.3, z: 0 };
    const velocity = { x: 1, y: -4, z: 0 };
    const grounded = resolveTerrain(slope(0), position, velocity, RADIUS, PROBES);
    expect(grounded).toBe(true);
    expect(position.y).toBeCloseTo(0, 6);
    expect(velocity.y).toBe(0);
    expect(velocity.x).toBe(1);
  });

  it('leaves a body in the air alone', () => {
    const position = { x: 2, y: 3, z: -1 };
    const velocity = { x: 0, y: -2, z: 0 };
    const grounded = resolveTerrain(slope(0), position, velocity, RADIUS, PROBES);
    expect(grounded).toBe(false);
    expect(position).toEqual({ x: 2, y: 3, z: -1 });
    expect(velocity.y).toBe(-2);
  });

  it('does not count a steep slope as ground and slides the velocity along it', () => {
    const steep = Math.acos(WALKABLE_NORMAL_Y - 0.05);
    const position = { x: 0, y: -0.2, z: 0 };
    const velocity = { x: 0, y: -3, z: 0 };
    expect(resolveTerrain(slope(steep), position, velocity, RADIUS, PROBES)).toBe(false);
    const nx = -Math.sin(steep);
    const ny = Math.cos(steep);
    expect(velocity.x * nx + velocity.y * ny).toBeCloseTo(0, 6);
  });

  it('counts a gentle slope as ground', () => {
    const position = { x: 0, y: -0.2, z: 0 };
    const velocity = { x: 0, y: -3, z: 0 };
    expect(resolveTerrain(slope(0.5), position, velocity, RADIUS, PROBES)).toBe(true);
  });

  it('lands on the real valley floor', () => {
    const { grid } = valley();
    const position = { x: 10, y: grid.groundAt(10, 20) + 3, z: 20 };
    const velocity = { x: 0, y: 0, z: 0 };
    let grounded = false;
    for (let i = 0; i < 180; i++) {
      velocity.y -= 24 / 60;
      position.y += velocity.y / 60;
      grounded = resolveTerrain(grid, position, velocity, RADIUS, PROBES);
    }
    expect(grounded).toBe(true);
    expect(Math.abs(position.y - grid.groundAt(10, 20))).toBeLessThan(0.12);
  });

  it('never lets a body walk into a rock', () => {
    const { field, grid } = valley();
    const rock = field.rocks[3];
    expect(rock).toBeDefined();
    if (!rock) return;
    for (const approach of [0.3, 1.1, 2.4, 4.0, 5.3]) {
      const dirX = Math.cos(approach);
      const dirZ = Math.sin(approach);
      const position = {
        x: rock.x + dirX * (rock.rx + 8),
        y: 0,
        z: rock.z + dirZ * (rock.rz + 8),
      };
      position.y = grid.groundAt(position.x, position.z) + 0.2;
      const velocity = { x: 0, y: 0, z: 0 };
      for (let step = 0; step < 400; step++) {
        velocity.x = -dirX * 4.4;
        velocity.z = -dirZ * 4.4;
        velocity.y -= 24 / 60;
        position.x += velocity.x / 60;
        position.y += velocity.y / 60;
        position.z += velocity.z / 60;
        resolveTerrain(grid, position, velocity, RADIUS, PROBES);
        for (const h of PROBES) {
          expect(grid.sample(position.x, position.y + h, position.z)).toBeGreaterThan(RADIUS - 0.1);
        }
      }
    }
  });
});
