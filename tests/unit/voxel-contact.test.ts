import { describe, expect, it } from 'vitest';
import {
  CONTACT_BRIGHTNESS,
  CONTACT_HEIGHT,
  groundContact,
  meshChunk,
  type GroundHeight,
} from '../../src/world/voxels/mesher';
import { Cells } from './helpers/mesh';

describe('the shade of the ground on the foot of a wall', () => {
  it('is darkest at the ground and gone from the contact height up', () => {
    expect(groundContact(0)).toBeCloseTo(CONTACT_BRIGHTNESS, 12);
    expect(groundContact(CONTACT_HEIGHT)).toBe(1);
    expect(groundContact(CONTACT_HEIGHT + 5)).toBe(1);
  });

  it('is as dark below the ground as on it, where nothing shows anyway', () => {
    expect(groundContact(-0.01)).toBeCloseTo(CONTACT_BRIGHTNESS, 12);
    expect(groundContact(-30)).toBeCloseTo(CONTACT_BRIGHTNESS, 12);
  });

  it('eases in between and never gets darker with height', () => {
    let last = 0;
    for (let i = 0; i <= 200; i++) {
      const value = groundContact((i / 200) * CONTACT_HEIGHT);
      expect(value).toBeGreaterThanOrEqual(last - 1e-12);
      expect(value).toBeLessThanOrEqual(1);
      last = value;
    }
  });

  it('keeps its own brightness within the range the occlusion byte can take', () => {
    expect(CONTACT_BRIGHTNESS).toBeGreaterThan(0.3);
    expect(CONTACT_BRIGHTNESS).toBeLessThan(1);
    expect(CONTACT_HEIGHT).toBeGreaterThan(0);
  });
});

/** The occlusion byte each vertex would have with no ground, and the one it has with it. */
function bytes(cells: Cells, ground: GroundHeight) {
  const plain = meshChunk(cells, 0, 0, 0);
  const aux = Uint8Array.from(plain.aux.subarray(0, plain.vertexCount * 4));
  const positions = Float32Array.from(plain.positions.subarray(0, plain.vertexCount * 3));
  const shaded = meshChunk(cells, 0, 0, 0, ground);
  return { plain, shaded, plainAux: aux, plainPositions: positions };
}

describe('a mesh made with a ground', () => {
  it('is the same surface as one made without, only darker at the foot', () => {
    const cells = new Cells().set(3, 4, 5);
    const { plain, shaded, plainAux, plainPositions } = bytes(cells, () => 4);
    expect(shaded.vertexCount).toBe(plain.vertexCount);
    expect(shaded.triangleCount).toBe(plain.triangleCount);
    expect(shaded.bounds).toEqual(plain.bounds);
    for (let i = 0; i < plain.vertexCount * 3; i++) {
      expect(shaded.positions[i]).toBe(plainPositions[i]);
    }
    let darker = 0;
    for (let i = 0; i < plain.vertexCount; i++) {
      const before = plainAux[i * 4] as number;
      const after = shaded.aux[i * 4] as number;
      expect(after).toBeLessThanOrEqual(before);
      if (after < before) darker++;
      // The material, the primitive kind and the seed are not touched.
      for (let k = 1; k < 4; k++) expect(shaded.aux[i * 4 + k]).toBe(plainAux[i * 4 + k]);
    }
    expect(darker).toBeGreaterThan(0);
  });

  it('darkens each vertex by its height above the terrain under it', () => {
    const cells = new Cells().set(3, 4, 5).set(4, 4, 5).set(3, 5, 5);
    const slope: GroundHeight = (x, z) => 3.4 + 0.2 * (x - 3) + 0.1 * (z - 5);
    const { plain, shaded, plainAux, plainPositions } = bytes(cells, slope);
    for (let i = 0; i < plain.vertexCount; i++) {
      const x = plainPositions[i * 3] as number;
      const y = plainPositions[i * 3 + 1] as number;
      const z = plainPositions[i * 3 + 2] as number;
      const expected = (plainAux[i * 4] as number) * groundContact(y - slope(x, z));
      // The mesher works in doubles and the buffer holds floats, so a rounding step may differ.
      expect(Math.abs((shaded.aux[i * 4] as number) - expected)).toBeLessThanOrEqual(1.5);
    }
  });

  it('leaves a block that stands well above the ground exactly as it was', () => {
    const cells = new Cells().set(3, 40, 5).set(4, 40, 5);
    const { plain, shaded, plainAux } = bytes(cells, () => 4);
    for (let i = 0; i < plain.vertexCount * 4; i++) expect(shaded.aux[i]).toBe(plainAux[i]);
  });

  it('shades a face from the corner at its foot, so the dark fades up the wall', () => {
    const cells = new Cells().set(3, 4, 5);
    const shaded = meshChunk(cells, 0, 0, 0, () => 4);
    const low: number[] = [];
    const high: number[] = [];
    for (let i = 0; i < shaded.vertexCount; i++) {
      // The panels on the south face (normal +z).
      if (shaded.normals[i * 3 + 2] !== 1) continue;
      const y = shaded.positions[i * 3 + 1] as number;
      (y < 4.5 ? low : high).push(shaded.aux[i * 4] as number);
    }
    expect(low.length).toBeGreaterThan(0);
    expect(high.length).toBeGreaterThan(0);
    expect(Math.max(...low)).toBeLessThan(Math.min(...high));
  });
});
