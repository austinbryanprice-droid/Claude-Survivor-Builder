import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/shared/hash';
import type { Vec3 } from '../../src/shared/look';
import { castRay, createRayHit, type RayWorld } from '../../src/shared/raycast';
import { SparseCells } from '../../src/shared/solid';

/** Cells as a block world: whatever is set holds a block. */
function blocksOf(cells: SparseCells): RayWorld['blocks'] {
  return { getBlock: (x, y, z) => cells.get(x, y, z) };
}

function unit(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
}

function cast(world: RayWorld, origin: Vec3, dir: Vec3, max = 20) {
  const hit = createRayHit();
  return castRay(world, origin, dir, max, hit) ? hit : null;
}

/** Flat ground whose surface is at height `h`: positive above it, negative below. */
const plane = (h: number): RayWorld['ground'] => ({ distance: (_x, y) => y - h });

describe('castRay against blocks', () => {
  it('hits the near face of a block straight ahead and names the face', () => {
    const cells = new SparseCells();
    cells.set(5, 0, 0);
    const hit = cast({ blocks: blocksOf(cells) }, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 });
    expect(hit).not.toBeNull();
    expect(hit).toMatchObject({ kind: 'block', x: 5, y: 0, z: 0, nx: -1, ny: 0, nz: 0 });
    expect(hit?.distance).toBeCloseTo(4.5, 9);
  });

  it('looks the other way too, across zero and into negative cells', () => {
    const cells = new SparseCells();
    cells.set(-3, -2, -1);
    const hit = cast({ blocks: blocksOf(cells) }, { x: 0.5, y: -1.5, z: -0.5 }, unit(-1, 0, 0));
    expect(hit).toMatchObject({ x: -3, y: -2, z: -1, nx: 1, ny: 0, nz: 0 });
    expect(hit?.distance).toBeCloseTo(2.5, 9);

    const down = cast({ blocks: blocksOf(cells) }, { x: -2.5, y: 4.5, z: -0.5 }, unit(0, -1, 0));
    expect(down).toMatchObject({ x: -3, y: -2, z: -1, nx: 0, ny: 1, nz: 0 });
    expect(down?.distance).toBeCloseTo(5.5, 9);
  });

  it('names the face a sloped ray crosses first', () => {
    const cells = new SparseCells();
    cells.set(2, 2, 2);
    const world = { blocks: blocksOf(cells) };
    // Mostly along +x, so the -x face is the one it meets.
    expect(cast(world, { x: 0.2, y: 2.4, z: 2.4 }, unit(1, 0.1, 0.1))).toMatchObject({
      x: 2,
      y: 2,
      z: 2,
      nx: -1,
    });
    // From above and a little to the side, the top face.
    expect(cast(world, { x: 2.4, y: 6.5, z: 2.4 }, unit(0.05, -1, 0.02))).toMatchObject({
      x: 2,
      y: 2,
      z: 2,
      ny: 1,
    });
    // From the south side (z below the block), along +z: the -z face.
    expect(cast(world, { x: 2.5, y: 2.5, z: -3 }, { x: 0, y: 0, z: 1 })).toMatchObject({ nz: -1 });
  });

  it('skips the cell the ray starts in', () => {
    const cells = new SparseCells();
    cells.set(0, 0, 0);
    cells.set(3, 0, 0);
    const hit = cast({ blocks: blocksOf(cells) }, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 });
    expect(hit).toMatchObject({ x: 3, nx: -1 });
  });

  it('stops at the maximum distance', () => {
    const cells = new SparseCells();
    cells.set(10, 0, 0);
    const world = { blocks: blocksOf(cells) };
    const origin = { x: 0.5, y: 0.5, z: 0.5 };
    expect(cast(world, origin, { x: 1, y: 0, z: 0 }, 9.4)).toBeNull();
    expect(cast(world, origin, { x: 1, y: 0, z: 0 }, 9.6)).not.toBeNull();
  });

  it('returns nothing for an empty world, a zero range or a range that is not a number', () => {
    const world = { blocks: blocksOf(new SparseCells()) };
    const origin = { x: 0.5, y: 0.5, z: 0.5 };
    expect(cast(world, origin, { x: 1, y: 0, z: 0 })).toBeNull();
    expect(cast(world, origin, { x: 1, y: 0, z: 0 }, 0)).toBeNull();
    expect(cast(world, origin, { x: 1, y: 0, z: 0 }, Number.NaN)).toBeNull();
    const ground = { blocks: blocksOf(new SparseCells()), ground: plane(0) };
    expect(cast(ground, { x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, Number.NaN)).toBeNull();
  });

  it('finds the nearest of several blocks', () => {
    const cells = new SparseCells();
    cells.set(4, 0, 0);
    cells.set(7, 0, 0);
    cells.set(5, 3, 0);
    const hit = cast({ blocks: blocksOf(cells) }, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 });
    expect(hit).toMatchObject({ x: 4 });
  });

  it('agrees with a brute-force test of every cell for random rays', () => {
    const random = createRng(0x5eed);
    const cells = new SparseCells();
    const solid: [number, number, number][] = [];
    for (let i = 0; i < 160; i++) {
      const c: [number, number, number] = [
        Math.floor(random() * 16) - 8,
        Math.floor(random() * 16) - 8,
        Math.floor(random() * 16) - 8,
      ];
      if (cells.get(...c) === 0) {
        cells.set(...c);
        solid.push(c);
      }
    }
    const world = { blocks: blocksOf(cells) };
    const max = 14;
    let hits = 0;
    for (let i = 0; i < 4000; i++) {
      const origin = { x: random() * 16 - 8, y: random() * 16 - 8, z: random() * 16 - 8 };
      const dir = unit(random() - 0.5, random() - 0.5, random() - 0.5);
      const expected = bruteForce(solid, origin, dir, max);
      const hit = cast(world, origin, dir, max);
      if (!expected) {
        expect(hit).toBeNull();
        continue;
      }
      hits++;
      expect(hit).not.toBeNull();
      expect([hit?.x, hit?.y, hit?.z]).toEqual(expected.cell);
      expect([hit?.nx, hit?.ny, hit?.nz]).toEqual(expected.normal);
      expect(hit?.distance).toBeCloseTo(expected.distance, 7);
    }
    // The test means something only if rays do hit things.
    expect(hits).toBeGreaterThan(1000);
  });
});

/** The nearest solid cell the ray enters, by intersecting the ray with each cell's box. */
function bruteForce(
  solid: readonly (readonly [number, number, number])[],
  origin: Vec3,
  dir: Vec3,
  max: number,
): { cell: number[]; normal: number[]; distance: number } | null {
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  let best: { cell: number[]; normal: number[]; distance: number } | null = null;
  for (const cell of solid) {
    let near = -Infinity;
    let far = Infinity;
    let axis = 0;
    for (let a = 0; a < 3; a++) {
      const lo = (cell[a] as number) - (o[a] as number);
      const hi = lo + 1;
      const da = d[a] as number;
      if (da === 0) {
        if (lo > 0 || hi < 0) {
          far = -Infinity;
        }
        continue;
      }
      const t0 = Math.min(lo / da, hi / da);
      const t1 = Math.max(lo / da, hi / da);
      if (t0 > near) {
        near = t0;
        axis = a;
      }
      far = Math.min(far, t1);
    }
    // Entered from outside, in front, in range (a cell the ray starts inside has near < 0).
    if (near > far || near <= 0 || near > max) continue;
    if (!best || near < best.distance) {
      const normal = [0, 0, 0];
      normal[axis] = (d[axis] as number) > 0 ? -1 : 1;
      best = { cell: [...cell], normal, distance: near };
    }
  }
  return best;
}

describe('castRay against the ground', () => {
  it('hits flat ground at the right distance and names the cell above it', () => {
    const world: RayWorld = { blocks: blocksOf(new SparseCells()), ground: plane(2.4) };
    const hit = cast(world, { x: 0.5, y: 5.5, z: 0.5 }, { x: 0, y: -1, z: 0 });
    expect(hit).toMatchObject({ kind: 'terrain', x: 0, y: 2, z: 0, nx: 0, ny: 1, nz: 0 });
    expect(hit?.distance).toBeCloseTo(3.1, 3);
  });

  it('puts the cell on the open side when the surface sits exactly on a cell boundary', () => {
    const world: RayWorld = { blocks: blocksOf(new SparseCells()), ground: plane(3) };
    const hit = cast(world, { x: 1.5, y: 7, z: -2.5 }, { x: 0, y: -1, z: 0 });
    expect(hit).toMatchObject({ kind: 'terrain', x: 1, y: 3, z: -3 });
  });

  it('measures a slanted ray and a sloped surface', () => {
    // Ground rising toward +x: the surface is where y = 0.5 * x.
    const slope: RayWorld['ground'] = {
      distance: (x, y) => (y - 0.5 * x) / Math.hypot(1, 0.5),
    };
    const world: RayWorld = { blocks: blocksOf(new SparseCells()), ground: slope };
    const hit = cast(world, { x: 0, y: 4, z: 0.5 }, unit(1, -1, 0), 30);
    // y = 4 - t/sqrt2 and x = t/sqrt2, so 4 - s = 0.5 s at s = 8/3.
    expect(hit?.kind).toBe('terrain');
    expect(hit?.distance).toBeCloseTo((8 / 3) * Math.SQRT2, 3);
    // The surface faces up and back toward -x, mostly up.
    expect(hit).toMatchObject({ nx: 0, ny: 1, nz: 0 });
  });

  it('finds the point on a sphere and faces the dominant axis of its normal', () => {
    const ball: RayWorld['ground'] = {
      distance: (x, y, z) => Math.hypot(x - 10, y - 0, z - 0) - 2,
    };
    const world: RayWorld = { blocks: blocksOf(new SparseCells()), ground: ball };
    const hit = cast(world, { x: 0, y: 0.1, z: 0.1 }, unit(10, 0, 0), 20);
    expect(hit?.kind).toBe('terrain');
    expect(hit?.distance).toBeGreaterThan(7.99);
    expect(hit?.distance).toBeLessThan(8.01);
    expect(hit).toMatchObject({ nx: -1, ny: 0, nz: 0 });
  });

  it('prefers whichever of a block and the ground the ray meets first', () => {
    const cells = new SparseCells();
    cells.set(0, 4, 0);
    const world: RayWorld = { blocks: blocksOf(cells), ground: plane(2.4) };
    const down = { x: 0, y: -1, z: 0 };
    // The block hangs above the ground: the ray from higher up meets it first.
    expect(cast(world, { x: 0.5, y: 8.5, z: 0.5 }, down)).toMatchObject({
      kind: 'block',
      x: 0,
      y: 4,
      ny: 1,
    });
    // Below the block, the ground comes first.
    expect(cast(world, { x: 0.5, y: 3.5, z: 0.5 }, down)).toMatchObject({ kind: 'terrain', y: 2 });
    // A block buried under the ground cannot be reached through it.
    const buried = new SparseCells();
    buried.set(0, 0, 0);
    const under: RayWorld = { blocks: blocksOf(buried), ground: plane(2.4) };
    expect(cast(under, { x: 0.5, y: 6.5, z: 0.5 }, down)).toMatchObject({ kind: 'terrain' });
  });

  it('does not hit ground behind a block that is nearer, or beyond the range', () => {
    const cells = new SparseCells();
    cells.set(3, 2, 0);
    const world: RayWorld = { blocks: blocksOf(cells), ground: plane(0) };
    // Looking level at a block, with ground far below.
    expect(cast(world, { x: 0.5, y: 2.5, z: 0.5 }, { x: 1, y: 0, z: 0 })).toMatchObject({
      kind: 'block',
      x: 3,
    });
    expect(cast(world, { x: 0.5, y: 5, z: 0.5 }, { x: 0, y: -1, z: 0 }, 4)).toBeNull();
  });

  it('lets a ray that starts underground come up and hit the ground only when it re-enters', () => {
    const world: RayWorld = { blocks: blocksOf(new SparseCells()), ground: plane(2) };
    // Straight up from under the surface: it leaves the ground and never goes back in.
    expect(cast(world, { x: 0.5, y: 1, z: 0.5 }, { x: 0, y: 1, z: 0 })).toBeNull();
    // A hill: the ray starts inside it and ends up inside a second one beyond a dip.
    const hills: RayWorld['ground'] = {
      distance: (x, y) => y - (x < 3 || x > 8 ? 2 : -1),
    };
    const hit = cast(
      { blocks: blocksOf(new SparseCells()), ground: hills },
      { x: 1, y: 1, z: 0 },
      {
        x: 1,
        y: 0,
        z: 0,
      },
    );
    expect(hit?.kind).toBe('terrain');
    expect(hit?.distance).toBeGreaterThan(6.99);
    expect(hit?.distance).toBeLessThan(7.01);
  });

  it('reuses one hit object without leaking the old answer', () => {
    const cells = new SparseCells();
    cells.set(2, 0, 0);
    const world: RayWorld = { blocks: blocksOf(cells), ground: plane(-5) };
    const hit = createRayHit();
    expect(castRay(world, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 10, hit)).toBe(true);
    expect(hit.kind).toBe('block');
    expect(castRay(world, { x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: -1, z: 0 }, 10, hit)).toBe(true);
    expect(hit).toMatchObject({ kind: 'terrain', ny: 1 });
    expect(hit.distance).toBeCloseTo(5.5, 3);
  });
});
