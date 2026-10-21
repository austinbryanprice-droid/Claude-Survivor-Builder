import { Color } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createLitMaterial } from '../../src/engine/lit-material';
import { createTestRegistry } from './helpers/registry';

describe('material registry', () => {
  it('recompiles the materials it made when the switches change', () => {
    const registry = createTestRegistry();
    const material = createLitMaterial(registry, { color: '#808080' });
    const before = material.version;
    registry.setSwitches({ richSky: false, mist: false, detailBump: false });
    expect(material.version).toBeGreaterThan(before);
    expect(material.defines).not.toHaveProperty('MIST');
  });

  it('forgets and frees a material that is released, and leaves the others alone', () => {
    const registry = createTestRegistry();
    const kept = createLitMaterial(registry, { color: '#808080' });
    const gone = createLitMaterial(registry, { color: new Color('#ff0000').getStyle() });
    const dispose = vi.spyOn(gone, 'dispose');

    registry.release(gone);
    expect(dispose).toHaveBeenCalledTimes(1);

    const keptVersion = kept.version;
    const goneVersion = gone.version;
    registry.setSwitches({ richSky: false, mist: true, detailBump: true });
    expect(kept.version).toBeGreaterThan(keptVersion);
    expect(gone.version).toBe(goneVersion);
  });

  it('ignores a material it never made, and one released twice', () => {
    const registry = createTestRegistry();
    const stranger = createLitMaterial(createTestRegistry(), { color: '#808080' });
    const own = createLitMaterial(registry, { color: '#808080' });
    const strangerDispose = vi.spyOn(stranger, 'dispose');
    const ownDispose = vi.spyOn(own, 'dispose');

    registry.release(stranger);
    expect(strangerDispose).not.toHaveBeenCalled();

    registry.release(own);
    registry.release(own);
    expect(ownDispose).toHaveBeenCalledTimes(1);
  });
});
