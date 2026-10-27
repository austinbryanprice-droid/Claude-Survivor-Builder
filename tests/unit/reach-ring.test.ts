import type { BufferAttribute, Mesh, ShaderMaterial } from 'three';
import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import { reachEdge } from '../../src/shared/power';
import { ReachRing } from '../../src/world/render/reach-ring';

/** The ribbon is made of this many pieces round the ring (`SEGMENTS` in the renderer), and each has two vertices. */
const PIECES = 96;
const RADIUS = 6;
const CELL = { x: 0, y: 10, z: 0 };
const MIDDLE = { x: 0.5, z: 0.5 };

/** A ring over the ground a function gives, with what the tests read of its two meshes. */
function ringOver(ground: (x: number, z: number) => number) {
  const calls = { count: 0 };
  const counted = (x: number, z: number): number => {
    calls.count++;
    return ground(x, z);
  };
  const parent = new Group();
  const ring = new ReachRing(parent, counted);
  const [ribbon, curtain] = ring.object.children as [Mesh, Mesh];
  const positions = (mesh: Mesh): number[] =>
    Array.from((mesh.geometry.getAttribute('position') as BufferAttribute).array);
  return { ring, parent, ribbon, curtain, calls, positions };
}

const level = (): number => 10;
const bearing = (piece: number) => {
  const angle = (piece / PIECES) * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle) };
};

/** How far from the middle of the cell the ribbon's middle lies at a piece, and how high above the ground. */
function ribbonAt(points: number[], piece: number, ground: (x: number, z: number) => number) {
  const inner = piece * 6;
  const outer = inner + 3;
  const x = ((points[inner] as number) + (points[outer] as number)) / 2;
  const z = ((points[inner + 2] as number) + (points[outer + 2] as number)) / 2;
  const y = ((points[inner + 1] as number) + (points[outer + 1] as number)) / 2;
  return { x, z, out: Math.hypot(x - MIDDLE.x, z - MIDDLE.z), above: y - ground(x, z) };
}

describe('the ring that shows where a module’s power reaches', () => {
  it('is not on screen until it is shown a cell, and is taken away with null or a radius of nothing', () => {
    const { ring, ribbon, curtain } = ringOver(level);
    expect(ring.shown).toBeNull();
    expect([ribbon.visible, curtain.visible]).toEqual([false, false]);

    ring.show(CELL, RADIUS);
    expect(ring.shown).toEqual({ ...CELL, radius: RADIUS });
    expect([ribbon.visible, curtain.visible]).toEqual([true, true]);

    ring.show(null);
    expect(ring.shown).toBeNull();
    expect([ribbon.visible, curtain.visible]).toEqual([false, false]);

    ring.show(CELL, RADIUS);
    ring.show(CELL, 0);
    expect(ring.shown).toBeNull();
    expect([ribbon.visible, curtain.visible]).toEqual([false, false]);
  });

  it('lays the ribbon on the ground at the edge of the reach, by the rule the host charges by', () => {
    const { ring, positions } = ringOver(level);
    ring.show(CELL, RADIUS);
    const points = positions(ring.object.children[0] as Mesh);
    expect(points).toHaveLength((PIECES + 1) * 2 * 3);
    for (const piece of [0, 12, 24, 48, 71, PIECES]) {
      const { x, z } = bearing(piece);
      const edge = reachEdge(CELL.x, CELL.y, CELL.z, RADIUS, x, z, level);
      const at = ribbonAt(points, piece, level);
      expect(at.out, `piece ${piece}`).toBeCloseTo(edge, 5);
      // On level ground a body's middle is above the cell's middle, so the edge is a little inside the radius.
      expect(edge).toBeLessThan(RADIUS);
      expect(edge).toBeGreaterThan(RADIUS - 0.1);
      // It floats a hair above the ground, not on it.
      expect(at.above).toBeGreaterThan(0);
      expect(at.above).toBeLessThan(0.2);
    }
  });

  it('is pulled in where the ground climbs away from the cell, and lies along the ground', () => {
    // The ground rises toward +x and stays level toward -x.
    const slope = (x: number): number => 10 + Math.max(0, x - 0.5) * 0.9;
    const ground = (x: number): number => slope(x);
    const { ring, ribbon, positions } = ringOver(ground);
    ring.show(CELL, RADIUS);
    const points = positions(ribbon);
    const uphill = ribbonAt(points, 0, ground);
    const level = ribbonAt(points, PIECES / 2, ground);
    expect(uphill.out).toBeLessThan(level.out - 1);
    expect(uphill.out).toBeCloseTo(reachEdge(CELL.x, CELL.y, CELL.z, RADIUS, 1, 0, ground), 5);
    // Each piece sits just above the ground under it, uphill and level alike.
    expect(uphill.above).toBeGreaterThan(0);
    expect(level.above).toBeGreaterThan(0);
    expect(Math.abs(uphill.above - level.above)).toBeLessThan(0.05);
  });

  it('stands a curtain on the middle of the ribbon, taller than the grass and the same all the way round', () => {
    const slope = (x: number): number => 10 + Math.max(0, x - 0.5) * 0.5;
    const { ring, ribbon, curtain, positions } = ringOver(slope);
    ring.show(CELL, RADIUS);
    const ribbonPoints = positions(ribbon);
    const curtainPoints = positions(curtain);
    expect(curtainPoints).toHaveLength((PIECES + 1) * 2 * 3);
    const heights = new Set<string>();
    for (let piece = 0; piece <= PIECES; piece++) {
      const foot = piece * 6;
      const top = foot + 3;
      const middle = ribbonAt(ribbonPoints, piece, slope);
      // The foot is where the ribbon's middle is, and the top straight above it.
      expect(curtainPoints[foot], `piece ${piece}`).toBeCloseTo(middle.x, 5);
      expect(curtainPoints[foot + 2], `piece ${piece}`).toBeCloseTo(middle.z, 5);
      expect(curtainPoints[top], `piece ${piece}`).toBe(curtainPoints[foot]);
      expect(curtainPoints[top + 2], `piece ${piece}`).toBe(curtainPoints[foot + 2]);
      heights.add(
        ((curtainPoints[top + 1] as number) - (curtainPoints[foot + 1] as number)).toFixed(4),
      );
    }
    // The grass is as tall as a block here, and the curtain has to clear it.
    expect(heights.size).toBe(1);
    expect(Number([...heights][0])).toBeGreaterThan(1);
    expect(Number([...heights][0])).toBeLessThan(2);
  });

  it('closes up: the last piece is the first', () => {
    const { ring, ribbon, curtain, positions } = ringOver(level);
    ring.show(CELL, RADIUS);
    for (const mesh of [ribbon, curtain]) {
      const points = positions(mesh);
      const last = PIECES * 6;
      for (let i = 0; i < 6; i++)
        expect(points[last + i], `${mesh.id} ${i}`).toBeCloseTo(points[i] as number, 5);
    }
  });

  it('reads the ground again only when the cell or the radius is not the one it was laid for', () => {
    const { ring, calls } = ringOver(level);
    ring.show(CELL, RADIUS);
    const laid = calls.count;
    expect(laid).toBeGreaterThan(0);
    ring.show(CELL, RADIUS);
    ring.show({ ...CELL }, RADIUS);
    expect(calls.count).toBe(laid);
    ring.show({ ...CELL, x: 1 }, RADIUS);
    expect(calls.count).toBeGreaterThan(laid);
    const second = calls.count;
    ring.show({ ...CELL, x: 1 }, RADIUS + 1);
    expect(calls.count).toBeGreaterThan(second);
  });

  it('moves the dashes of both meshes from one clock, and casts no shadow', () => {
    const { ring, ribbon, curtain } = ringOver(level);
    ring.update(3.5);
    for (const mesh of [ribbon, curtain]) {
      expect((mesh.material as ShaderMaterial).uniforms.uTime?.value, mesh.id.toString()).toBe(3.5);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(false);
    }
  });

  it('takes itself out of the scene when it is disposed of', () => {
    const { ring, parent } = ringOver(level);
    expect(parent.children).toContain(ring.object);
    ring.dispose();
    expect(parent.children).not.toContain(ring.object);
  });
});
