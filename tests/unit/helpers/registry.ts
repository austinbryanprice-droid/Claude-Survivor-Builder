import { Vector3 } from 'three';
import { Atmosphere } from '../../../src/engine/atmosphere';
import { MaterialRegistry } from '../../../src/engine/materials';

/** A material registry that needs no WebGL: enough to build lit materials and count them. */
export function createTestRegistry(): MaterialRegistry {
  const atmosphere = new Atmosphere(null, {
    lake: { x: 0, z: 0, radius: 1, top: 0 },
    crash: { x: 0, z: 0, radius: 1, top: 0 },
  });
  return new MaterialRegistry(atmosphere.uniforms, { value: new Vector3(1, 60, 90) });
}
