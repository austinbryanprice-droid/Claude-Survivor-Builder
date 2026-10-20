import { describe, expect, it } from 'vitest';
import { createContacts, moveBody, overlapsSolid, type Body } from '../../src/shared/collision';
import { createRng } from '../../src/shared/hash';
import { SparseCells } from '../../src/shared/solid';
import { flatWorld } from './helpers';

function body(x: number, y: number, z: number, halfWidth = 0.3, height = 1.8): Body {
  return { x, y, z, halfWidth, height };
}

describe('moveBody', () => {
  it('stops on a floor and reports the contact', () => {
    const world = flatWorld();
    const b = body(0.5, 3, 0.5);
    const contacts = createContacts();
    moveBody(b, 0, -10, 0, world, contacts);
    expect(b.y).toBeCloseTo(0, 3);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(contacts).toEqual({ x: false, y: true, z: false });
  });

  it('stops against a wall with a hairline gap, from both sides', () => {
    const world = flatWorld();
    world.fillBox(5, 0, -3, 5, 3, 3);
    const east = body(1.5, 0, 0.5);
    moveBody(east, 10, 0, 0, world, createContacts());
    expect(east.x).toBeCloseTo(5 - 0.3, 3);
    expect(east.x + 0.3).toBeLessThan(5);

    const west = body(8.5, 0, 0.5);
    const contacts = createContacts();
    moveBody(west, -10, 0, 0, world, contacts);
    expect(west.x).toBeCloseTo(6 + 0.3, 3);
    expect(west.x - 0.3).toBeGreaterThan(6);
    expect(contacts.x).toBe(true);
  });

  it('works for negative coordinates', () => {
    const world = flatWorld();
    world.fillBox(-6, 0, -3, -6, 3, 3);
    const b = body(-2.5, 0, 0.5);
    moveBody(b, -10, 0, 0, world, createContacts());
    expect(b.x).toBeCloseTo(-5 + 0.3, 3);
  });

  it('slides along a wall instead of stopping dead', () => {
    const world = flatWorld();
    world.fillBox(5, 0, -20, 5, 3, 20);
    const b = body(4, 0, 0.5);
    const contacts = createContacts();
    moveBody(b, 3, 0, 3, world, contacts);
    expect(contacts.x).toBe(true);
    expect(contacts.z).toBe(false);
    expect(b.z).toBeCloseTo(3.5, 6);
  });

  it('resolves the larger horizontal component first when a diagonal move meets a corner', () => {
    const world = flatWorld();
    world.fillBox(5, 0, 5, 5, 3, 5);
    // The pillar fills x and z from 5 to 6. Heading for it diagonally from (4, 4), whichever
    // axis has more distance to cover runs free first and the other is stopped by the pillar.
    const alongX = body(4, 0, 4);
    moveBody(alongX, 2, 0, 2, world, createContacts());
    expect(alongX.x).toBeCloseTo(6, 6);
    expect(alongX.z).toBeCloseTo(5 - 0.3, 3);

    const alongZ = body(4, 0, 4);
    moveBody(alongZ, 2, 0, 2.2, world, createContacts());
    expect(alongZ.z).toBeCloseTo(6.2, 6);
    expect(alongZ.x).toBeCloseTo(5 - 0.3, 3);
    expect(overlapsSolid(alongX, world)).toBe(false);
    expect(overlapsSolid(alongZ, world)).toBe(false);
  });

  it('stops at a ceiling', () => {
    const world = flatWorld();
    world.fillBox(-3, 3, -3, 3, 3, 3);
    const b = body(0.5, 0, 0.5);
    const contacts = createContacts();
    moveBody(b, 0, 5, 0, world, contacts);
    expect(contacts.y).toBe(true);
    expect(b.y + 1.8).toBeCloseTo(3, 3);
    expect(b.y + 1.8).toBeLessThan(3);
  });

  it('does not tunnel through a one-block floor or wall at any speed', () => {
    const world = flatWorld();
    world.fillBox(10, 0, -5, 10, 4, 5);
    const falling = body(0.5, 40, 0.5);
    moveBody(falling, 0, -200, 0, world, createContacts());
    expect(falling.y).toBeCloseTo(0, 3);
    const running = body(0.5, 0, 0.5);
    moveBody(running, 500, 0, 0, world, createContacts());
    expect(running.x).toBeCloseTo(10 - 0.3, 3);
  });

  it('fits through a doorway one block wide but not one that is too narrow', () => {
    const world = flatWorld();
    world.fillBox(5, 0, -6, 5, 3, 6);
    world.clearBox(5, 0, 0, 5, 1, 0);
    const slim = body(2.5, 0, 0.5);
    moveBody(slim, 10, 0, 0, world, createContacts());
    expect(slim.x).toBeGreaterThan(12);

    // A box wider than the doorway is stopped by the frame.
    const wide = body(2.5, 0, 0.5, 0.6, 1.8);
    moveBody(wide, 10, 0, 0, world, createContacts());
    expect(wide.x + 0.6).toBeLessThan(5);
  });

  it('passes a two-high tunnel for a 1.8 block box and is stopped by a one-high one', () => {
    const world = flatWorld();
    world.fillBox(5, 2, -2, 8, 2, 2);
    const walker = body(2.5, 0, 0.5);
    moveBody(walker, 10, 0, 0, world, createContacts());
    expect(walker.x).toBeGreaterThan(12);

    const low = flatWorld();
    low.fillBox(5, 1, -2, 8, 1, 2);
    const crawler = body(2.5, 0, 0.5);
    moveBody(crawler, 10, 0, 0, low, createContacts());
    expect(crawler.x).toBeCloseTo(5 - 0.3, 3);
  });

  it('lets a box that starts inside a block move out of it', () => {
    const world = flatWorld();
    world.set(0, 0, 0);
    const b = body(0.5, 0, 0.5);
    expect(overlapsSolid(b, world)).toBe(true);
    moveBody(b, 3, 0, 0, world, createContacts());
    expect(b.x).toBeCloseTo(3.5, 6);
    expect(overlapsSolid(b, world)).toBe(false);
  });

  it('ignores zero and non-finite moves', () => {
    const world = flatWorld();
    const b = body(0.5, 0, 0.5);
    moveBody(b, 0, 0, 0, world, createContacts());
    moveBody(b, Number.NaN, Number.POSITIVE_INFINITY, 0, world, createContacts());
    expect([b.x, b.y, b.z]).toEqual([0.5, 0, 0.5]);
  });

  it('stays put and never creeps into a wall it keeps pushing against', () => {
    const world = flatWorld();
    world.fillBox(5, 0, -3, 5, 3, 3);
    const b = body(4, 0, 0.5);
    const contacts = createContacts();
    moveBody(b, 2, 0, 0, world, contacts);
    const settled = b.x;
    for (let i = 0; i < 1000; i++) moveBody(b, 0.12, -0.0083, 0, world, contacts);
    expect(b.x).toBe(settled);
    expect(overlapsSolid(b, world)).toBe(false);
  });

  it('never ends a move overlapping a block, over many random worlds and moves', () => {
    const rng = createRng(20241020);
    for (let trial = 0; trial < 200; trial++) {
      const world = new SparseCells();
      for (let x = -6; x < 6; x++) {
        for (let y = -2; y < 6; y++) {
          for (let z = -6; z < 6; z++) if (rng() < 0.22) world.set(x, y, z);
        }
      }
      let b = body(0, 0, 0);
      let found = false;
      for (let attempt = 0; attempt < 200 && !found; attempt++) {
        b = body(rng() * 8 - 4, rng() * 5 - 1, rng() * 8 - 4);
        found = !overlapsSolid(b, world);
      }
      if (!found) continue;
      for (let step = 0; step < 40; step++) {
        const scale = rng() < 0.2 ? 6 : 1.2;
        moveBody(
          b,
          (rng() * 2 - 1) * scale,
          (rng() * 2 - 1) * scale,
          (rng() * 2 - 1) * scale,
          world,
          createContacts(),
        );
        expect(overlapsSolid(b, world)).toBe(false);
      }
    }
  });
});

describe('overlapsSolid', () => {
  it('treats touching as not overlapping and a hair of overlap as overlapping', () => {
    const world = new SparseCells();
    world.set(2, 0, 0);
    expect(overlapsSolid(body(1.7, 0, 0.5), world)).toBe(false);
    expect(overlapsSolid(body(1.71, 0, 0.5), world)).toBe(true);
  });
});
