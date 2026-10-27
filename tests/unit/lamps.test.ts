import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Color, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Atmosphere } from '../../src/engine/atmosphere';
import { ATMOSPHERE_GLSL } from '../../src/engine/glsl/atmosphere.glsl';
import {
  LAMP_LIGHT,
  LAMP_SLOTS,
  LampField,
  createLampUniforms,
  type LampSource,
} from '../../src/engine/lamps';
import { createLitMaterial } from '../../src/engine/lit-material';
import { skyStateAt } from '../../src/shared/daycycle';
import { createTestRegistry } from './helpers/registry';

const lamp = (x: number, y = 1, z = 0): LampSource => ({ x, y, z, ax: 1, ay: 0, az: 0 });
const origin = new Vector3();

function field() {
  const uniforms = createLampUniforms();
  return { uniforms, lamps: new LampField(uniforms) };
}

/** The x of each slot in use, smallest first. */
function slotsInUse(uniforms: ReturnType<typeof createLampUniforms>): number[] {
  return uniforms.uLampA.value
    .slice(0, uniforms.uLampCount.value)
    .map((slot) => slot.x)
    .sort((a, b) => a - b);
}

describe('the lamp field', () => {
  it('starts with no lamp in use and a black light', () => {
    const { uniforms, lamps } = field();
    expect(uniforms.uLampCount.value).toBe(0);
    expect(uniforms.uLampColor.value.equals(new Color(0, 0, 0))).toBe(true);
    expect(uniforms.uLampA.value).toHaveLength(LAMP_SLOTS);
    expect(uniforms.uLampB.value).toHaveLength(LAMP_SLOTS);
    expect(lamps.burning).toBe(0);
    expect(lamps.active).toBe(0);
  });

  it('writes the lamps that burn with where they leave, which way they are aimed and the beam’s edge', () => {
    const { uniforms, lamps } = field();
    lamps.set([
      { x: 3, y: 12.5, z: -4, ax: 0, ay: -0.25, az: 0.97 },
      { x: 5, y: 2, z: 1, ax: 1, ay: 0, az: 0 },
    ]);
    lamps.update(origin, 1);
    expect(lamps.burning).toBe(2);
    expect(lamps.active).toBe(2);
    expect(uniforms.uLampCount.value).toBe(2);
    const [a, b] = uniforms.uLampA.value;
    expect([a?.x, a?.y, a?.z, a?.w]).toEqual([3, 12.5, -4, 1]);
    expect([b?.x, b?.y, b?.z, b?.w]).toEqual([5, 2, 1, 1]);
    const aim = uniforms.uLampB.value[0];
    expect([aim?.x, aim?.y, aim?.z]).toEqual([0, -0.25, 0.97]);
    const cosCone = Math.cos((LAMP_LIGHT.cone * Math.PI) / 180);
    expect(aim?.w).toBeCloseTo(cosCone, 6);
  });

  it('lights a frame with the nearest lamps to the camera when more burn than there are slots', () => {
    const { uniforms, lamps } = field();
    const burning = Array.from({ length: 12 }, (_, i) => lamp(12 - i));
    lamps.set(burning);
    lamps.update(origin, 1);
    expect(lamps.burning).toBe(12);
    expect(lamps.active).toBe(LAMP_SLOTS);
    expect(slotsInUse(uniforms)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    lamps.update(new Vector3(12, 0, 0), 1);
    expect(slotsInUse(uniforms)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('is cut to the quality’s limit, and never past the slots there are', () => {
    const { uniforms, lamps } = field();
    lamps.set(Array.from({ length: 10 }, (_, i) => lamp(i + 1)));
    lamps.setLimit(3);
    lamps.update(origin, 1);
    expect(slotsInUse(uniforms)).toEqual([1, 2, 3]);
    lamps.setLimit(0);
    lamps.update(origin, 1);
    expect(uniforms.uLampCount.value).toBe(0);
    lamps.setLimit(99);
    lamps.update(origin, 1);
    expect(uniforms.uLampCount.value).toBe(LAMP_SLOTS);
    lamps.setLimit(Number.NaN);
    lamps.update(origin, 1);
    expect(uniforms.uLampCount.value).toBe(0);
  });

  it('follows the list it is handed, and falls back to none when it is emptied', () => {
    const { uniforms, lamps } = field();
    lamps.set([lamp(1), lamp(2)]);
    lamps.update(origin, 1);
    expect(uniforms.uLampCount.value).toBe(2);
    lamps.set([lamp(7)]);
    lamps.update(origin, 1);
    expect(slotsInUse(uniforms)).toEqual([7]);
    lamps.set([]);
    lamps.update(origin, 1);
    expect(uniforms.uLampCount.value).toBe(0);
    expect(lamps.active).toBe(0);
  });

  it('burns at full brightness at night and keeps a tenth of it in full day', () => {
    const { uniforms, lamps } = field();
    lamps.set([lamp(1)]);
    const color = new Color(LAMP_LIGHT.color);
    lamps.update(origin, 1);
    expect(uniforms.uLampColor.value.g).toBeCloseTo(color.g * LAMP_LIGHT.intensity, 6);
    expect(uniforms.uLampColor.value.r).toBeGreaterThan(uniforms.uLampColor.value.g);
    lamps.update(origin, 0);
    expect(uniforms.uLampColor.value.g).toBeCloseTo(
      color.g * LAMP_LIGHT.intensity * LAMP_LIGHT.day,
      6,
    );
    lamps.update(origin, 5);
    expect(uniforms.uLampColor.value.g).toBeCloseTo(color.g * LAMP_LIGHT.intensity, 6);
    lamps.update(origin, -3);
    expect(uniforms.uLampColor.value.g).toBeCloseTo(
      color.g * LAMP_LIGHT.intensity * LAMP_LIGHT.day,
      6,
    );
  });

  it('gives the lamp the color of the lens that throws it', () => {
    expect(LAMP_LIGHT.color).toBe('#ffc778');
    expect(LAMP_LIGHT.range).toBeGreaterThan(LAMP_LIGHT.half);
    expect(LAMP_LIGHT.spill).toBeGreaterThan(0);
    expect(LAMP_LIGHT.spill).toBeLessThan(1);
  });
});

describe('the lamps in the atmosphere', () => {
  const zones = {
    lake: { x: 0, z: 0, radius: 1, top: 0 },
    crash: { x: 0, z: 0, radius: 1, top: 0 },
  };

  it('are picked for the camera and the dark when the atmosphere updates', () => {
    const atmosphere = new Atmosphere(null, zones);
    const camera = new PerspectiveCamera();
    camera.position.set(2, 0, 0);
    camera.updateMatrixWorld();
    atmosphere.lamps.set([lamp(1), lamp(30)]);
    atmosphere.update(skyStateAt(-24, 300), camera, 0);
    expect(atmosphere.uniforms.uLampCount.value).toBe(2);
    const night = atmosphere.uniforms.uLampColor.value.g;
    atmosphere.update(skyStateAt(45, 180), camera, 0);
    const day = atmosphere.uniforms.uLampColor.value.g;
    expect(day).toBeGreaterThan(0);
    expect(day).toBeCloseTo(night * LAMP_LIGHT.day, 6);
  });

  it('reach every lit material through the shared uniforms', () => {
    const registry = createTestRegistry();
    const material = createLitMaterial(registry, { color: '#808080' });
    for (const name of ['uLampA', 'uLampB', 'uLampColor', 'uLampShape', 'uLampCount']) {
      expect(material.uniforms).toHaveProperty(name);
      expect(material.uniforms[name]).toBe(registry.atmosphere[name as 'uLampA']);
    }
    expect(material.fragmentShader).toContain('lampLight(vWorld, N)');
  });
});

describe('the lamp light in the shaders', () => {
  it('has a slot count the GLSL arrays are sized from, and the function the surfaces call', () => {
    expect(ATMOSPHERE_GLSL).toContain(`#define LAMP_SLOTS ${LAMP_SLOTS}`);
    expect(ATMOSPHERE_GLSL).toContain('uniform vec4 uLampA[LAMP_SLOTS];');
    expect(ATMOSPHERE_GLSL).toContain('uniform vec4 uLampB[LAMP_SLOTS];');
    expect(ATMOSPHERE_GLSL).toContain('vec3 lampLight(vec3 wp, vec3 n)');
  });

  /** Every source file that ends a lit color in the haze, and so is a surface that might take the lamps' light. */
  function surfaces(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) surfaces(path, found);
      else if (
        entry.name.endsWith('.ts') &&
        readFileSync(path, 'utf8').includes('applyAtmosphere(lit')
      )
        found.push(path);
    }
    return found;
  }

  // Surfaces that leave the lamps out on purpose: the water is a reflection of the sky, the backdrop is
  // the far hills, and the intro film plays before there is a base to light.
  const WITHOUT = [
    'world/render/water-render.ts',
    'world/render/backdrop-render.ts',
    'engine/intro/hull.ts',
    'engine/intro/particles.ts',
  ];

  it('is asked for by every lit surface, except the few that leave it out on purpose', () => {
    const root = join(__dirname, '..', '..', 'src');
    const lit = surfaces(root)
      .map((path) => path.slice(root.length + 1).replaceAll('\\', '/'))
      .sort();
    expect(lit.length).toBeGreaterThan(6);
    const missing = lit.filter(
      (file) =>
        !WITHOUT.includes(file) && !readFileSync(join(root, file), 'utf8').includes('lampLight('),
    );
    expect(missing).toEqual([]);
    for (const file of WITHOUT) {
      expect(readFileSync(join(root, file), 'utf8')).not.toContain('lampLight(');
    }
  });
});
