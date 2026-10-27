import type { Box3, BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/engine/wildlife-models';
import { HOW, LOOK, LOOK_COUNT, triangleCount } from '../../src/engine/wildlife-shapes';
import { WILD_SPECIES, WILD_SPECIES_COUNT } from '../../src/shared/wildlife-state';

const NAMES = Object.keys(WILD_SPECIES) as (keyof typeof WILD_SPECIES)[];

/** What a species' model may cost in triangles, at most and at least: a crowd of them is drawn three times a frame (body, shadow, depth). */
const TRIANGLES: Record<keyof typeof WILD_SPECIES, readonly [number, number]> = {
  stag: [700, 2200],
  hare: [350, 1100],
  mossback: [650, 2200],
  shoal: [40, 260],
  ray: [190, 1000],
  jelly: [280, 1100],
  finch: [100, 450],
  kite: [280, 1100],
};

/** How tall each species is built, in blocks, as a range: the stag's is its antlers, the jelly's its bell and tentacles. */
const HEIGHT: Record<keyof typeof WILD_SPECIES, readonly [number, number]> = {
  stag: [1.5, 2],
  hare: [0.35, 0.6],
  mossback: [1, 1.4],
  shoal: [0.1, 0.25],
  ray: [0.2, 0.5],
  jelly: [0.7, 1.1],
  finch: [0.05, 0.2],
  kite: [0.1, 0.4],
};

function model(species: number): BufferGeometry {
  const geometry = buildModel(species);
  if (!geometry) throw new Error(`no model for species ${species}`);
  return geometry;
}

function boundsOf(geometry: BufferGeometry): Box3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox as Box3;
}

function valuesOf(geometry: BufferGeometry, name: string): number[] {
  return Array.from(geometry.getAttribute(name).array);
}

describe('the creatures’ models', () => {
  it('exist for every species the wire names and for no other number', () => {
    for (let species = 0; species < WILD_SPECIES_COUNT; species++) {
      expect(buildModel(species)).toBeDefined();
    }
    expect(buildModel(WILD_SPECIES_COUNT)).toBeUndefined();
    expect(buildModel(-1)).toBeUndefined();
    expect(buildModel(2.5)).toBeUndefined();
    expect(NAMES).toHaveLength(WILD_SPECIES_COUNT);
  });

  it('are each one indexed mesh, with the attributes the shaders read and nothing else', () => {
    for (const name of NAMES) {
      const geometry = model(WILD_SPECIES[name]);
      const count = geometry.getAttribute('position').count;
      expect(Object.keys(geometry.attributes).sort(), name).toEqual([
        'aAux',
        'aHip',
        'aPart',
        'normal',
        'position',
      ]);
      expect(geometry.getAttribute('normal').count, name).toBe(count);
      expect(geometry.getAttribute('aPart').itemSize, name).toBe(4);
      expect(geometry.getAttribute('aHip').itemSize, name).toBe(3);
      expect(geometry.getAttribute('aAux').itemSize, name).toBe(4);
      for (const attribute of ['aPart', 'aHip', 'aAux']) {
        expect(geometry.getAttribute(attribute).count, `${name} ${attribute}`).toBe(count);
      }
      const index = geometry.getIndex();
      expect(index, name).not.toBeNull();
      const indices = Array.from((index as NonNullable<typeof index>).array);
      expect(indices.length % 3, name).toBe(0);
      expect(Math.max(...indices), name).toBeLessThan(count);
      expect(Math.min(...indices), name).toBeGreaterThanOrEqual(0);
      // Welded: a smooth body shares its vertices between triangles instead of repeating them.
      expect(count, name).toBeLessThan(indices.length * 0.75);
    }
  });

  it('hold only real numbers, and smooth unit normals', () => {
    for (const name of NAMES) {
      const geometry = model(WILD_SPECIES[name]);
      for (const attribute of ['position', 'normal', 'aPart', 'aHip', 'aAux']) {
        for (const value of valuesOf(geometry, attribute)) {
          expect(Number.isFinite(value), `${name} ${attribute}`).toBe(true);
        }
      }
      const normals = valuesOf(geometry, 'normal');
      for (let i = 0; i < normals.length; i += 3) {
        const length = Math.hypot(
          normals[i] as number,
          normals[i + 1] as number,
          normals[i + 2] as number,
        );
        expect(Math.abs(length - 1), `${name} normal ${i / 3}`).toBeLessThan(0.002);
      }
    }
  });

  it('cost a few hundred triangles to a couple of thousand, as the look directive and the frame budget ask', () => {
    for (const name of NAMES) {
      const [least, most] = TRIANGLES[name];
      const count = triangleCount(model(WILD_SPECIES[name]));
      expect(count, name).toBeGreaterThanOrEqual(least);
      expect(count, name).toBeLessThanOrEqual(most);
    }
  });

  it('give every vertex a look the palette has, a way to move the shader knows and a weight that is never negative', () => {
    const ways = new Set<number>(Object.values(HOW));
    for (const name of NAMES) {
      const geometry = model(WILD_SPECIES[name]);
      const part = valuesOf(geometry, 'aPart');
      const aux = valuesOf(geometry, 'aAux');
      for (let i = 0; i < part.length; i += 4) {
        const look = part[i] as number;
        expect(
          Number.isInteger(look) && look >= 0 && look < LOOK_COUNT,
          `${name} look ${look}`,
        ).toBe(true);
        expect(ways.has(part[i + 1] as number), `${name} way ${part[i + 1]}`).toBe(true);
        const side = part[i + 3] as number;
        expect(Math.abs(side) <= 1, `${name} side ${side}`).toBe(true);
        // How far along its body a piece sits: 0 at the head or the root and 1 at the tip, a little over for a fish's tail fin.
        const weight = aux[i] as number;
        expect(weight >= -1e-6 && weight <= 1.5, `${name} weight ${weight}`).toBe(true);
      }
    }
  });

  it('paint a coat on every species, and give a face its eyes', () => {
    const looksOf = (name: keyof typeof WILD_SPECIES): Set<number> => {
      const part = valuesOf(model(WILD_SPECIES[name]), 'aPart');
      const looks = new Set<number>();
      for (let i = 0; i < part.length; i += 4) looks.add(part[i] as number);
      return looks;
    };
    for (const name of NAMES) expect(looksOf(name).has(LOOK.coat), name).toBe(true);
    for (const name of ['stag', 'hare', 'mossback', 'kite'] as const) {
      expect(looksOf(name).has(LOOK.eye), name).toBe(true);
    }
    // Light that a creature gives off is on the two that glow: a mossback's mushrooms and a jelly's lantern.
    expect(looksOf('mossback').has(LOOK.glow)).toBe(true);
    expect(looksOf('jelly').has(LOOK.glow)).toBe(true);
    expect(looksOf('stag').has(LOOK.glow)).toBe(false);
  });

  it('move the way their kind does: legs and a head on land, wings in the air, a body that ripples or pulses in the water', () => {
    const waysOf = (name: keyof typeof WILD_SPECIES): Set<number> => {
      const part = valuesOf(model(WILD_SPECIES[name]), 'aPart');
      const ways = new Set<number>();
      for (let i = 1; i < part.length; i += 4) ways.add(part[i] as number);
      return ways;
    };
    for (const name of ['stag', 'hare', 'mossback'] as const) {
      expect(waysOf(name).has(HOW.leg), name).toBe(true);
      expect(waysOf(name).has(HOW.head), name).toBe(true);
    }
    // The long-legged ones bend at the knee.
    expect(waysOf('stag').has(HOW.lowerLeg)).toBe(true);
    expect(waysOf('hare').has(HOW.lowerLeg)).toBe(true);
    for (const name of ['finch', 'kite'] as const) {
      expect(waysOf(name).has(HOW.wing), name).toBe(true);
      expect(waysOf(name).has(HOW.leg), name).toBe(false);
    }
    expect(waysOf('shoal').has(HOW.spine)).toBe(true);
    expect(waysOf('ray').has(HOW.fin)).toBe(true);
    expect(waysOf('jelly').has(HOW.bell)).toBe(true);
    expect(waysOf('jelly').has(HOW.tentacle)).toBe(true);
  });

  it('are the same every time they are built, so every screen draws the same creature', () => {
    for (const name of NAMES) {
      const first = model(WILD_SPECIES[name]);
      const second = model(WILD_SPECIES[name]);
      for (const attribute of ['position', 'normal', 'aPart', 'aHip', 'aAux']) {
        expect(valuesOf(second, attribute), `${name} ${attribute}`).toEqual(
          valuesOf(first, attribute),
        );
      }
      expect(
        Array.from((second.getIndex() as NonNullable<ReturnType<typeof second.getIndex>>).array),
      ).toEqual(
        Array.from((first.getIndex() as NonNullable<ReturnType<typeof first.getIndex>>).array),
      );
    }
  });

  it('stand on their origin, with the feet or the underside of the body at the ground and the body even left to right', () => {
    for (const name of NAMES) {
      const bounds = boundsOf(model(WILD_SPECIES[name]));
      expect(Math.abs(bounds.min.y), `${name} underside`).toBeLessThan(0.03);
      expect(Math.abs(bounds.min.x + bounds.max.x), `${name} sides`).toBeLessThan(0.02);
      // About the middle of the animal from head to tail, so the box that the host tests shots against sits on it
      // (the ray's tail trails far behind the disc, so it is the one that is not centred).
      if (name !== 'ray') {
        expect(Math.abs(bounds.min.z + bounds.max.z) / 2, `${name} middle`).toBeLessThan(0.1);
      }
    }
  });

  it('are as tall as the animal they are of', () => {
    for (const name of NAMES) {
      const [least, most] = HEIGHT[name];
      const top = boundsOf(model(WILD_SPECIES[name])).max.y;
      expect(top, name).toBeGreaterThanOrEqual(least);
      expect(top, name).toBeLessThanOrEqual(most);
    }
  });
});
