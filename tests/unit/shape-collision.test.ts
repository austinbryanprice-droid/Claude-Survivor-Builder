import { describe, expect, it } from 'vitest';
import { MATERIAL, SHAPE, packState, slabShape, wedgeShape } from '../../src/shared/blocks';
import {
  createContacts,
  moveBody,
  overlapsSolid,
  snapToFloor,
  type Body,
} from '../../src/shared/collision';
import { MoveGuard } from '../../src/shared/move-guard';
import { createPlayerSample, type PlayerSample } from '../../src/shared/protocol';
import { WEDGE_SLICES } from '../../src/shared/shapes';
import { pointSolid } from '../../src/shared/solid';
import { createWorld } from '../../src/world/voxels/world';
import { ShapeCells, shapeFloor } from './helpers/shape-cells';
import { TEST_SEED, terrain } from './helpers/valley';

const PLUS_X = 0;
const MINUS_X = 2;

function body(x: number, y: number, z: number, halfWidth = 0.3, height = 1.8): Body {
  return { x, y, z, halfWidth, height };
}

/** One call of the move, with the step height a grounded player has. */
function move(b: Body, dx: number, dy: number, dz: number, world: ShapeCells, step = 0) {
  const contacts = createContacts();
  moveBody(b, dx, dy, dz, world, contacts, step);
  return contacts;
}

describe('a body against slabs', () => {
  it('lands on a slab at half a block, or at the top of an upper slab', () => {
    const lower = shapeFloor();
    lower.set(2, 0, 2, slabShape(false));
    const a = body(2.5, 3, 2.5);
    expect(move(a, 0, -10, 0, lower).y).toBe(true);
    expect(a.y).toBeCloseTo(0.5, 3);

    const upper = shapeFloor();
    upper.set(2, 0, 2, slabShape(true));
    const b = body(2.5, 3, 2.5);
    expect(move(b, 0, -10, 0, upper).y).toBe(true);
    expect(b.y).toBeCloseTo(1, 3);
  });

  it('falls past a slab it is beside, and stops against its side', () => {
    const world = shapeFloor();
    world.set(3, 0, 2, slabShape(false));
    const beside = body(2.5, 3, 2.5);
    move(beside, 0, -10, 0, world);
    expect(beside.y).toBeCloseTo(0, 3);

    const walker = body(1.5, 0, 2.5);
    const contacts = move(walker, 5, 0, 0, world);
    expect(contacts.x).toBe(true);
    expect(walker.x).toBeCloseTo(3 - 0.3, 3);
    expect(walker.x + 0.3).toBeLessThan(3);
  });

  it('walks over a slab when the feet are already on its top', () => {
    const world = shapeFloor();
    world.fillShape(2, 0, 2, 4, 0, 2, slabShape(false));
    const walker = body(1.5, 0.5, 2.5);
    const contacts = move(walker, 4, 0, 0, world);
    expect(contacts.x).toBe(false);
    expect(walker.x).toBeCloseTo(5.5, 6);
  });

  it('bumps its head on the underside of an upper slab, half a block into the cell', () => {
    const world = shapeFloor();
    world.set(2, 2, 2, slabShape(true));
    const b = body(2.5, 0, 2.5);
    const contacts = move(b, 0, 3, 0, world);
    expect(contacts.y).toBe(true);
    // The slab's underside is at 2.5, and the body is 1.8 tall.
    expect(b.y).toBeCloseTo(2.5 - 1.8, 3);
  });

  it('walks under an upper slab above head height, and is stopped by one that is too low', () => {
    const high = shapeFloor();
    high.fillShape(2, 2, 2, 2, 2, 2, slabShape(true));
    const under = body(0.5, 0, 2.5);
    expect(move(under, 4, 0, 0, high).x).toBe(false);
    expect(under.x).toBeCloseTo(4.5, 6);

    const low = shapeFloor();
    low.set(2, 1, 2, slabShape(true));
    const blocked = body(0.5, 0, 2.5);
    expect(move(blocked, 4, 0, 0, low).x).toBe(true);
    expect(blocked.x).toBeCloseTo(2 - 0.3, 3);
  });
});

describe('a body against wedges', () => {
  it('stands at the height of the highest part under its feet', () => {
    const world = shapeFloor();
    world.set(2, 0, 2, wedgeShape(PLUS_X));
    const b = body(2.5, 3, 2.5);
    expect(move(b, 0, -10, 0, world).y).toBe(true);
    // The feet span x 2.2 to 2.8 of a slope that rises 1 over 1, drawn as small steps.
    expect(b.y).toBeCloseTo(13 / 16, 3);
    expect(b.y).toBeGreaterThanOrEqual(0.8);
  });

  it('is climbed from its low end by a body that may step, and not by one that may not', () => {
    const world = shapeFloor();
    world.fillShape(2, 0, 2, 2, 0, 2, wedgeShape(PLUS_X));
    const stopped = body(1.5, 0, 2.5);
    expect(move(stopped, 0.5, 0, 0, world, 0).x).toBe(true);
    expect(stopped.x).toBeCloseTo(2 - 0.3, 3);
    expect(stopped.y).toBeCloseTo(0, 6);

    const climbing = body(1.5, 0, 2.5);
    const contacts = move(climbing, 0.5, 0, 0, world, 0.6);
    expect(contacts).toEqual({ x: false, y: true, z: false });
    expect(climbing.x).toBeCloseTo(2, 6);
    // The feet now span x 1.7 to 2.3: the wedge reaches 0.3 into its cell, as small steps.
    expect(climbing.y).toBeCloseTo(5 / 16, 3);
  });

  it('is stopped by its tall end', () => {
    const world = shapeFloor();
    world.set(2, 0, 2, wedgeShape(MINUS_X));
    const b = body(0.5, 0, 2.5);
    const contacts = move(b, 4, 0, 0, world, 0.6);
    expect(contacts.x).toBe(true);
    expect(b.x).toBeCloseTo(2 - 0.3, 3);
    expect(b.y).toBeCloseTo(0, 6);
  });

  it('is walked under only as far as the slope of an upside-down wedge leaves head room', () => {
    const world = shapeFloor();
    world.set(2, 1, 2, wedgeShape(PLUS_X, true));
    const b = body(0.5, 0, 2.5);
    const contacts = move(b, 4, 0, 0, world, 0.6);
    expect(contacts.x).toBe(true);
    // The slope comes down to 1.8 at x = 3/16 into the cell, where its underside is 2 - 4/16.
    expect(b.x).toBeCloseTo(2 + 3 / 16 - 0.3, 3);
    expect(b.y).toBeCloseTo(0, 6);
  });
});

describe('stepping up', () => {
  it('climbs a slab in one move when it is given a step height, and is stopped without', () => {
    const world = shapeFloor();
    world.set(2, 0, 2, slabShape(false));
    const plain = body(1.5, 0, 2.5);
    expect(move(plain, 1, 0, 0, world, 0).x).toBe(true);
    expect(plain.x).toBeCloseTo(1.7, 3);

    const climber = body(1.5, 0, 2.5);
    const contacts = move(climber, 1, 0, 0, world, 0.6);
    expect(contacts).toEqual({ x: false, y: true, z: false });
    expect(climber.x).toBeCloseTo(2.5, 6);
    expect(climber.y).toBeCloseTo(0.5, 3);
  });

  it('does not climb a whole block, or a ledge that floats above the feet', () => {
    const cube = shapeFloor();
    cube.set(2, 0, 2, SHAPE.cube);
    const a = body(1.5, 0, 2.5);
    expect(move(a, 1, 0, 0, cube, 0.6).x).toBe(true);
    expect(a.x).toBeCloseTo(1.7, 3);
    expect(a.y).toBeCloseTo(0, 6);

    const floating = shapeFloor();
    floating.set(2, 0, 2, slabShape(true));
    const b = body(1.5, 0, 2.5);
    expect(move(b, 1, 0, 0, floating, 0.6).x).toBe(true);
    expect(b.x).toBeCloseTo(1.7, 3);
    expect(b.y).toBeCloseTo(0, 6);
  });

  it('does not climb where the head would hit a ceiling', () => {
    const world = shapeFloor();
    world.set(2, 0, 2, slabShape(false));
    // The slab's top is at 0.5, so a body on it reaches 2.3; a cube at y = 2 starts at 2.
    world.set(2, 2, 2, SHAPE.cube);
    const b = body(1.5, 0, 2.5);
    expect(move(b, 1, 0, 0, world, 0.6).x).toBe(true);
    expect(b.x).toBeCloseTo(1.7, 3);
    expect(b.y).toBeCloseTo(0, 6);
  });

  it('keeps sliding along a wall that it cannot climb', () => {
    const world = shapeFloor();
    world.fillShape(3, 0, 0, 3, 3, 5, SHAPE.cube);
    const b = body(2.5, 0, 2.5);
    const contacts = move(b, 1, 0, 1, world, 0.6);
    expect(contacts.x).toBe(true);
    expect(contacts.z).toBe(false);
    expect(b.z).toBeCloseTo(3.5, 6);
    expect(b.y).toBeCloseTo(0, 6);
  });

  it('never leaves the body inside the shapes it climbs', () => {
    const world = shapeFloor();
    for (let z = 0; z < 6; z++) world.set(3, 0, z, wedgeShape(PLUS_X));
    world.fillShape(4, 0, 0, 8, 0, 5, SHAPE.cube);
    for (const [dx, dz] of [
      [0.07, 0],
      [0.07, 0.03],
      [0.05, -0.05],
      [0.12, 0.01],
    ] as const) {
      const b = body(1.2, 0, 2.5);
      for (let i = 0; i < 90; i++) {
        move(b, dx, -0.01, dz, world, 0.6);
        expect(overlapsSolid(b, world), `step ${i} of (${dx}, ${dz})`).toBe(false);
      }
    }
  });
});

describe('snapToFloor', () => {
  it('sets a hovering body down on a floor within reach, and leaves one that is too high', () => {
    const world = shapeFloor();
    const near = body(0.5, 0.3, 0.5);
    expect(snapToFloor(near, 0.4, world)).toBe(true);
    expect(near.y).toBeCloseTo(0, 3);

    const far = body(0.5, 0.8, 0.5);
    expect(snapToFloor(far, 0.4, world)).toBe(false);
    expect(far.y).toBe(0.8);
  });

  it('finds the top of a slab or the slope of a wedge', () => {
    const world = shapeFloor();
    world.set(2, 0, 2, slabShape(false));
    world.set(4, 0, 2, wedgeShape(PLUS_X));
    const onSlab = body(2.5, 0.8, 2.5);
    expect(snapToFloor(onSlab, 0.4, world)).toBe(true);
    expect(onSlab.y).toBeCloseTo(0.5, 3);

    const onWedge = body(4.5, 1.1, 2.5);
    expect(snapToFloor(onWedge, 0.4, world)).toBe(true);
    expect(onWedge.y).toBeCloseTo(13 / 16, 3);
  });
});

describe('overlapsSolid with partial cells', () => {
  it('counts only the part of a cell that a slab or a wedge fills', () => {
    const world = new ShapeCells();
    world.set(0, 0, 0, slabShape(true));
    // The upper slab fills y 0.5 to 1 of its cell.
    expect(overlapsSolid(body(0.5, -1.3, 0.5), world)).toBe(false);
    expect(overlapsSolid(body(0.5, -1.2, 0.5), world)).toBe(true);
    expect(overlapsSolid(body(0.5, 1, 0.5), world)).toBe(false);
    expect(overlapsSolid(body(0.5, 0.9, 0.5), world)).toBe(true);

    const ramp = new ShapeCells();
    ramp.set(0, 0, 0, wedgeShape(PLUS_X));
    // The wedge is under a tenth of a block high at its low end, and half a block high in the middle.
    expect(overlapsSolid(body(0.04, 0.03, 0.5, 0.02, 1), ramp)).toBe(true);
    expect(overlapsSolid(body(0.04, 0.1, 0.5, 0.02, 1), ramp)).toBe(false);
    expect(overlapsSolid(body(0.5, 0.2, 0.5, 0.02, 1), ramp)).toBe(true);
    expect(overlapsSolid(body(0.5, 0.6, 0.5, 0.02, 1), ramp)).toBe(false);
  });

  it('still counts a whole cube as the whole cell', () => {
    const world = new ShapeCells();
    world.set(0, 0, 0, SHAPE.cube);
    expect(overlapsSolid(body(0.5, 0.9, 0.5), world)).toBe(true);
    expect(overlapsSolid(body(0.5, 1, 0.5), world)).toBe(false);
  });
});

describe('pointSolid', () => {
  it('is true inside a cube, and false outside the part of a slab or wedge that is filled', () => {
    const world = new ShapeCells();
    world.set(0, 0, 0, SHAPE.cube);
    world.set(2, 0, 0, slabShape(false));
    world.set(4, 0, 0, wedgeShape(PLUS_X));
    expect(pointSolid(world, 0.5, 0.99, 0.5)).toBe(true);
    expect(pointSolid(world, 1.5, 0.5, 0.5)).toBe(false);
    expect(pointSolid(world, 2.5, 0.25, 0.5)).toBe(true);
    expect(pointSolid(world, 2.5, 0.75, 0.5)).toBe(false);
    expect(pointSolid(world, 4.9, 0.5, 0.5)).toBe(true);
    expect(pointSolid(world, 4.1, 0.5, 0.5)).toBe(false);
  });

  it('treats a world without partial cells as whole cells', () => {
    const world = { isSolid: (x: number, y: number, z: number) => x === 0 && y === 0 && z === 0 };
    expect(pointSolid(world, 0.1, 0.9, 0.5)).toBe(true);
    expect(pointSolid(world, 1.1, 0.9, 0.5)).toBe(false);
  });
});

describe('the host move guard with partial cells', () => {
  const at = (x: number, y: number, z: number): PlayerSample => ({
    ...createPlayerSample(),
    x,
    y,
    z,
  });

  it('does not count a body as buried in a slab it stands next to the top of', () => {
    const world = new ShapeCells();
    // A lower slab in the cell the middle of the body is in: the body stands on it, 0.5 up.
    world.fillShape(0, 0, 0, 0, 0, 0, slabShape(false));
    const guard = new MoveGuard();
    guard.place(0.5, 0.5, 0.5, 0);
    // Feet at 0, middle at 0.9: above the slab's top at 0.5, so not inside it.
    for (let t = 100; t < 3000; t += 100) {
      expect(guard.check(at(0.5, 0, 0.5), t, world).ok, `at ${t} ms`).toBe(true);
    }
  });

  it('still moves back a body whose middle stays inside a slab', () => {
    const world = new ShapeCells();
    world.set(0, 0, 0, slabShape(true));
    const guard = new MoveGuard();
    guard.place(2.5, 0, 0.5, 0);
    // Feet at 0 put the middle at 0.9, inside the upper slab (0.5 to 1).
    let verdict = guard.check(at(0.5, 0, 0.5), 50, world);
    for (let t = 100; t < 5000 && verdict.ok; t += 100)
      verdict = guard.check(at(0.5, 0, 0.5), t, world);
    expect(verdict).toEqual({ ok: false, reason: 'inside-solid' });
  });
});

describe('the voxel world as a solid query', () => {
  it('gives the boxes of a slab or a wedge, and none for a cube or an empty cell', () => {
    const world = createWorld(TEST_SEED, terrain());
    const y = 20;
    const cube = packState(SHAPE.cube, MATERIAL.scrap);
    expect(world.setBlock(8, y, -4, cube)).toBe(true);
    expect(world.setBlock(9, y, -4, packState(slabShape(false), MATERIAL.alloy))).toBe(true);
    expect(world.setBlock(10, y, -4, packState(wedgeShape(PLUS_X), MATERIAL.composite))).toBe(true);

    expect(world.isSolid(8, y, -4)).toBe(true);
    expect(world.boxesAt(8, y, -4)).toBeNull();
    expect(world.boxesAt(9, y, -4)).toEqual([[0, 0, 0, 1, 0.5, 1]]);
    expect(world.boxesAt(10, y, -4)).toHaveLength(WEDGE_SLICES);
    expect(world.boxesAt(11, y, -4)).toBeNull();
  });
});
