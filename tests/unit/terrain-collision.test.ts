import { describe, expect, it } from 'vitest';
import type { GroundBody } from '../../src/shared/ground';
import {
  WALKABLE_NORMAL_Y,
  createTerrainGround,
  resolveTerrain,
} from '../../src/world/terrain/collision';
import { tiltedPlane as slope } from './helpers/ground';
import { valley } from './helpers/valley';

const RADIUS = 0.36;
const PROBES = [RADIUS, 0.95, 1.5];

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

function body(x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): GroundBody {
  return { x, y, z, vx, vy, vz };
}

describe('terrain as a ground query', () => {
  it('reports the signed distance to the surface', () => {
    const ground = createTerrainGround(slope(0), 50);
    expect(ground.distance(3, 2.5, -1)).toBeCloseTo(2.5, 6);
    expect(ground.distance(0, -0.4, 0)).toBeCloseTo(-0.4, 6);
  });

  it('pushes a body out and says whether it stands on walkable ground', () => {
    const ground = createTerrainGround(slope(0), 50);
    const sunk = body(0, -0.3, 0, 1, -4, 0);
    expect(ground.pushOut(sunk, 0.3, [0.3, 0.9, 1.5])).toBe(true);
    expect(sunk.y).toBeCloseTo(0, 6);
    expect(sunk.vy).toBe(0);
    expect(sunk.vx).toBe(1);
    expect(ground.pushOut(body(0, 4, 0), 0.3, [0.3, 0.9, 1.5])).toBe(false);
  });

  it('sets a body that hovers over walkable ground back on it', () => {
    const ground = createTerrainGround(slope(0), 50);
    const hovering = body(0, 0.25, 0);
    expect(ground.snapDown(hovering, 0.3, 0.3, 0.4)).toBe(true);
    expect(hovering.y).toBeCloseTo(0, 6);
  });

  it('measures the drop along the way down, which is longer than the gap on a slope', () => {
    const angle = 0.4;
    const ground = createTerrainGround(slope(angle), 50);
    const hovering = body(0, 0.2, 0);
    expect(ground.snapDown(hovering, 0.3, 0.3, 0.4)).toBe(true);
    // Resting on the slope puts the sphere's center a radius from the plane, along the normal.
    expect(ground.distance(0, hovering.y + 0.3, 0)).toBeCloseTo(0.3, 6);
  });

  it('does not snap to ground that is too far below, too steep, or already touching', () => {
    const flat = createTerrainGround(slope(0), 50);
    expect(flat.snapDown(body(0, 0.5, 0), 0.3, 0.3, 0.4)).toBe(false);
    expect(flat.snapDown(body(0, -0.1, 0), 0.3, 0.3, 0.4)).toBe(false);
    const steep = createTerrainGround(slope(Math.acos(WALKABLE_NORMAL_Y - 0.05)), 50);
    expect(steep.snapDown(body(0, 0.2, 0), 0.3, 0.3, 0.4)).toBe(false);
  });

  it('keeps bodies inside the wall around the world and stops them against it', () => {
    const ground = createTerrainGround(slope(0), 10);
    const out = body(14, 0, -12, 3, 0, -5);
    ground.pushOut(out, 0.3, [0.3]);
    expect(out.x).toBe(10);
    expect(out.z).toBe(-10);
    expect(out.vx).toBe(0);
    expect(out.vz).toBe(0);
    const inside = body(9.5, 0, 0, 3, 0, 0);
    ground.pushOut(inside, 0.3, [0.3]);
    expect(inside.x).toBe(9.5);
    expect(inside.vx).toBe(3);
    const leaving = body(-12, 0, 0, 2, 0, 0);
    ground.pushOut(leaving, 0.3, [0.3]);
    expect(leaving.x).toBe(-10);
    expect(leaving.vx).toBe(2);
  });
});
