import { describe, expect, it } from 'vitest';
import { MATERIAL } from '../../src/shared/blocks';
import type { DebrisNode } from '../../src/shared/economy';
import type { Vec3 } from '../../src/shared/look';
import { aimAtDebris, createDebrisAim } from '../../src/systems/economy/aim';
import { DEBRIS } from '../../src/systems/economy/balance';

function heap(
  index: number,
  x: number,
  z: number,
  overrides: Partial<DebrisNode> = {},
): DebrisNode {
  return {
    index,
    x,
    y: 10,
    z,
    yaw: 0,
    scale: 1,
    harvests: 3,
    grade: MATERIAL.scrap,
    from: 0,
    ...overrides,
  };
}

/** A field with the strips left of each heap: by default every heap has all of its strips. */
function field(nodes: DebrisNode[], left: Record<number, number> = {}) {
  return {
    nodes,
    leftOf: (index: number) => left[index] ?? nodes[index]?.harvests ?? 0,
  };
}

const EYE: Vec3 = { x: 0, y: 11.6, z: 0 };
const ALONG_X: Vec3 = { x: 1, y: 0, z: 0 };

function look(
  nodes: DebrisNode[],
  dir: Vec3,
  extra: { left?: Record<number, number>; blockedAt?: number; origin?: Vec3 } = {},
) {
  const out = createDebrisAim();
  const found = aimAtDebris(out, {
    debris: field(nodes, extra.left),
    origin: extra.origin ?? EYE,
    dir,
    eye: EYE,
    blockedAt: extra.blockedAt ?? Infinity,
  });
  return { found, ...out };
}

/** The unit vector from the eyes to a point. */
function toward(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x - EYE.x, y - EYE.y, z - EYE.z);
  return { x: (x - EYE.x) / length, y: (y - EYE.y) / length, z: (z - EYE.z) / length };
}

describe('aiming at a heap of debris', () => {
  it('finds a heap the cursor is on, within reach, and says how many strips it has left', () => {
    const nodes = [heap(0, 3, 0)];
    const dir = toward(3, 10 + DEBRIS.lift, 0);
    const aim = look(nodes, dir);
    expect(aim.found).toBe(true);
    expect(aim.index).toBe(0);
    expect(aim.left).toBe(3);
    expect(aim.distance).toBeGreaterThan(1.5);
    expect(aim.distance).toBeLessThan(3);
  });

  it('is on a heap up to its radius off the middle, and not past it', () => {
    const nodes = [heap(0, 3, 0)];
    const middle = 10 + DEBRIS.lift;
    const near = toward(3, middle, DEBRIS.radius * 0.9);
    expect(look(nodes, near).found).toBe(true);
    const wide = toward(3, middle, DEBRIS.radius * 1.4);
    expect(look(nodes, wide).found).toBe(false);
  });

  it('counts the size of a heap in: a larger one is easier to hit', () => {
    const middle = 10 + DEBRIS.lift;
    const aside = toward(3, middle, DEBRIS.radius * 1.2);
    expect(look([heap(0, 3, 0, { scale: 1 })], aside).found).toBe(false);
    expect(look([heap(0, 3, 0, { scale: 1.25 })], aside).found).toBe(true);
  });

  it('ignores a heap beyond reach of the eyes, however squarely the cursor is on it', () => {
    const far = DEBRIS.reach + 0.5;
    const nodes = [heap(0, far, 0)];
    expect(look(nodes, toward(far, 10 + DEBRIS.lift, 0)).found).toBe(false);
    const close = [heap(0, DEBRIS.reach - 0.5, 0)];
    expect(look(close, toward(DEBRIS.reach - 0.5, 10 + DEBRIS.lift, 0)).found).toBe(true);
  });

  it('ignores a heap with nothing left, and one that is not uncovered yet', () => {
    const nodes = [heap(0, 3, 0), heap(1, 3, 0.1, { from: 2 })];
    const dir = toward(3, 10 + DEBRIS.lift, 0);
    expect(look(nodes, dir, { left: { 0: 0, 1: 0 } }).found).toBe(false);
    const other = look(nodes, dir, { left: { 0: 0 } });
    expect(other.index).toBe(1);
  });

  it('takes the nearer of two heaps on the same line', () => {
    const nodes = [heap(0, 4, 0), heap(1, 2.2, 0)];
    const dir = toward(2.2, 10 + DEBRIS.lift, 0);
    expect(look(nodes, dir).index).toBe(1);
    expect(look(nodes, ALONG_X).found).toBe(true);
  });

  it('does not see a heap behind a block or a hill the view meets first', () => {
    const nodes = [heap(0, 4, 0)];
    const dir = toward(4, 10 + DEBRIS.lift, 0);
    expect(look(nodes, dir, { blockedAt: 1.5 }).found).toBe(false);
    expect(look(nodes, dir, { blockedAt: 6 }).found).toBe(true);
    // A hit on the very surface the heap stands on is not in the way.
    const sameSpot = look(nodes, dir);
    expect(look(nodes, dir, { blockedAt: sameSpot.distance }).found).toBe(true);
  });

  it('looks away: a heap behind the view is not aimed at', () => {
    const nodes = [heap(0, -3, 0)];
    expect(look(nodes, ALONG_X).found).toBe(false);
  });

  it('is on a heap from the first step when the view starts inside it', () => {
    const nodes = [heap(0, 0.3, 0)];
    const aim = look(nodes, ALONG_X);
    expect(aim.found).toBe(true);
    expect(aim.distance).toBe(0);
  });

  it('starts level with the eyes in third person, so a heap behind the player is not picked', () => {
    // The camera is four blocks behind the eyes, looking forward along x; a heap just behind the eyes lies on the ray.
    const camera = { x: -4, y: 11.6, z: 0 };
    const behind = [heap(0, -1.5, 0)];
    const out = createDebrisAim();
    const found = aimAtDebris(out, {
      debris: field(behind),
      origin: camera,
      dir: ALONG_X,
      eye: EYE,
      blockedAt: Infinity,
    });
    expect(found).toBe(false);
    // Aimed from the camera at the middle of a heap ahead of the eyes, the cursor finds it.
    const ahead = [heap(0, 3, 0)];
    const length = Math.hypot(3 - camera.x, 10 + DEBRIS.lift - camera.y, 0 - camera.z);
    const dirFromCamera = {
      x: (3 - camera.x) / length,
      y: (10 + DEBRIS.lift - camera.y) / length,
      z: (0 - camera.z) / length,
    };
    expect(
      aimAtDebris(out, {
        debris: field(ahead),
        origin: camera,
        dir: dirFromCamera,
        eye: EYE,
        blockedAt: Infinity,
      }),
    ).toBe(true);
  });

  it('answers none, and clears the last answer, for a field with no heaps', () => {
    const out = createDebrisAim();
    out.index = 4;
    out.left = 2;
    expect(
      aimAtDebris(out, {
        debris: field([]),
        origin: EYE,
        dir: ALONG_X,
        eye: EYE,
        blockedAt: Infinity,
      }),
    ).toBe(false);
    expect(out).toEqual({ index: -1, left: 0, distance: 0 });
  });
});
