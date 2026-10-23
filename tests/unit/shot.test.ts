import { describe, expect, it } from 'vitest';
import { createEnemyPose, type EnemyPose } from '../../src/shared/enemy-state';
import { lookDirection, rightVector, type Vec3 } from '../../src/shared/look';
import {
  SHOT_FLAG,
  createShotTrace,
  muzzleOf,
  rayHitsBox,
  traceShot,
  type Hitbox,
} from '../../src/shared/shot';
import { SCRAP } from './helpers/nav-world';

const BOX: Hitbox = { halfWidth: 0.5, height: 1 };
const hitboxOf = (kind: number): Hitbox | undefined => (kind === 0 ? BOX : undefined);

function body(id: number, x: number, y: number, z: number, kind = 0): EnemyPose {
  return { ...createEnemyPose(), id, kind, x, y, z };
}

function vec(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
}

describe('a ray against the box a machine presents', () => {
  const hit = (o: [number, number, number], d: [number, number, number], limit = 100): number =>
    rayHitsBox(...o, ...d, 0, 0, 0, 0.5, 1, limit);

  it('enters at the near face', () => {
    expect(hit([0, 0.5, -5], [0, 0, 1])).toBeCloseTo(4.5, 9);
    expect(hit([5, 0.5, 0], [-1, 0, 0])).toBeCloseTo(4.5, 9);
    expect(hit([0, 5, 0], [0, -1, 0])).toBeCloseTo(4, 9);
  });

  it('misses beside, above and below the box', () => {
    expect(hit([0.6, 0.5, -5], [0, 0, 1])).toBe(-1);
    expect(hit([0, 1.05, -5], [0, 0, 1])).toBe(-1);
    expect(hit([0, -0.05, -5], [0, 0, 1])).toBe(-1);
  });

  it('counts the edges of the box in', () => {
    expect(hit([0.5, 0.5, -5], [0, 0, 1])).toBeCloseTo(4.5, 9);
    expect(hit([0, 1, -5], [0, 0, 1])).toBeCloseTo(4.5, 9);
  });

  it('finds the box on a slant', () => {
    const d = vec(1, 0.5, 4);
    // At z = -0.5 the ray has x = 0.125 + ... : aim at the middle of the box from 10 blocks away.
    const target = { x: 0, y: 0.5, z: 0 };
    const from: [number, number, number] = [-d.x * 10, target.y - d.y * 10, -d.z * 10];
    const t = hit(from, [d.x, d.y, d.z]);
    expect(t).toBeGreaterThan(9);
    expect(t).toBeLessThan(10);
  });

  it('meets a box it starts inside at once', () => {
    expect(hit([0.1, 0.5, 0.1], [1, 0, 0])).toBe(0);
  });

  it('misses a box behind it or beyond the limit', () => {
    expect(hit([0, 0.5, 5], [0, 0, 1])).toBe(-1);
    expect(hit([0, 0.5, -5], [0, 0, 1], 4)).toBe(-1);
    expect(hit([0, 0.5, -5], [0, 0, 1], 4.5)).toBeCloseTo(4.5, 9);
  });

  it('runs along a pair of faces without trouble', () => {
    // Level with the sides, inside them: enters at the front. Outside them: never.
    expect(hit([0.2, 0.5, -3], [0, 0, 1])).toBeCloseTo(2.5, 9);
    expect(hit([0.7, 0.5, -3], [0, 0, 1])).toBe(-1);
    expect(hit([0.2, 1.5, -3], [0, 0, 1])).toBe(-1);
  });
});

describe('a bolt on its way', () => {
  const trace = createShotTrace();
  const fly = (
    origin: Vec3,
    dir: Vec3,
    bodies: readonly EnemyPose[],
    options: {
      world?: Parameters<typeof traceShot>[0];
      alive?: (id: number) => boolean;
      count?: number;
    } = {},
  ) =>
    traceShot(
      options.world ?? null,
      origin,
      dir,
      40,
      bodies,
      options.count ?? bodies.length,
      hitboxOf,
      options.alive ?? null,
      trace,
    );

  const level = { x: 0, y: 1.6, z: 0 };
  const north = { x: 0, y: 0, z: -1 };

  /** Flat ground at y = 0 and one block of scrap at (0, 1, -10). */
  const world = {
    blocks: {
      getBlock: (x: number, y: number, z: number) => (x === 0 && y === 1 && z === -10 ? SCRAP : 0),
    },
    ground: { distance: (_x: number, y: number) => y },
  };

  it('flies its whole range through empty air', () => {
    fly({ x: 0, y: 1.6, z: 0 }, north, []);
    expect(trace).toEqual({ distance: 40, flags: 0, index: -1 });
  });

  it('strikes a machine in its way, at the near face of its box', () => {
    fly(level, north, [body(7, 0, 0.7, -12)]);
    expect(trace.flags).toBe(SHOT_FLAG.enemy);
    expect(trace.index).toBe(0);
    expect(trace.distance).toBeCloseTo(11.5, 9);
  });

  it('goes by a machine it is aimed beside', () => {
    fly(level, north, [body(7, 1.2, 0.7, -12)]);
    expect(trace.flags).toBe(0);
    expect(trace.index).toBe(-1);
  });

  it('strikes the nearest of two machines in line', () => {
    fly(level, north, [body(1, 0, 0.7, -20), body(2, 0, 0.7, -12)]);
    expect(trace.index).toBe(1);
    expect(trace.distance).toBeCloseTo(11.5, 9);
  });

  it('is stopped by a block, which shields what is behind it', () => {
    fly({ x: 0.5, y: 1.5, z: 0.5 }, north, [], { world });
    expect(trace.flags).toBe(SHOT_FLAG.world);
    // The ray starts half a block into the cell at z = 0 and meets the block's face at z = -9.
    expect(trace.distance).toBeCloseTo(9.5, 6);
    fly({ x: 0.5, y: 1.5, z: 0.5 }, north, [body(3, 0.5, 1, -15)], { world });
    expect(trace.flags).toBe(SHOT_FLAG.world);
    expect(trace.index).toBe(-1);
  });

  it('strikes a machine in front of a block', () => {
    fly({ x: 0.5, y: 1.5, z: 0.5 }, north, [body(3, 0.5, 1, -6)], { world });
    expect(trace.flags).toBe(SHOT_FLAG.enemy);
    expect(trace.distance).toBeCloseTo(6, 9);
  });

  it('is stopped by the ground', () => {
    fly({ x: 0, y: 2, z: 0 }, vec(0, -1, -1), [], { world });
    expect(trace.flags).toBe(SHOT_FLAG.world);
    expect(trace.distance).toBeCloseTo(2 * Math.SQRT2, 1);
  });

  it('passes through a machine that is gone, or of a kind nobody knows', () => {
    fly(level, north, [body(7, 0, 0.7, -12), body(8, 0, 0.7, -20, 9)], { alive: (id) => id !== 7 });
    expect(trace.flags).toBe(0);
  });

  it('looks only at the machines it is told of', () => {
    fly(level, north, [body(1, 0, 0.7, -12), body(2, 0, 0.7, -20)], { count: 0 });
    expect(trace.flags).toBe(0);
  });
});

describe('the muzzle of the blaster', () => {
  const out: Vec3 = { x: 0, y: 0, z: 0 };
  const forward: Vec3 = { x: 0, y: 0, z: 0 };
  const right: Vec3 = { x: 0, y: 0, z: 0 };

  it('is ahead of the eyes, to the right and below, whichever way they look', () => {
    for (const yaw of [0, 0.7, 2.1, -1.4, 3.1]) {
      for (const pitch of [0, 0.5, -0.9, 1.3]) {
        muzzleOf(3, 5, -2, yaw, pitch, out);
        lookDirection(yaw, pitch, forward);
        rightVector(yaw, right);
        const dx = out.x - 3;
        const dy = out.y - 5;
        const dz = out.z + 2;
        expect(dx * forward.x + dy * forward.y + dz * forward.z).toBeCloseTo(0.55, 9);
        expect(dx * right.x + dy * right.y + dz * right.z).toBeCloseTo(0.24, 9);
        // Up is right x forward; the muzzle sits below the line of sight.
        const upX = right.y * forward.z - right.z * forward.y;
        const upY = right.z * forward.x - right.x * forward.z;
        const upZ = right.x * forward.y - right.y * forward.x;
        expect(dx * upX + dy * upY + dz * upZ).toBeCloseTo(-0.2, 9);
      }
    }
  });
});
