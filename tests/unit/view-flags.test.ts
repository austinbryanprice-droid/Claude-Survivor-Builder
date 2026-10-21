import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, readViewFlags } from '../../src/shared/view-flags';

describe('view URL switches', () => {
  it('opens the hero view with everything on by default', () => {
    const v = readViewFlags('');
    expect(v.quality).toBeNull();
    expect(v.seed).toBe(DEFAULT_SEED);
    expect(v.time).toBeNull();
    expect(v.clock).toBe(false);
    expect(v.night).toBeNull();
    expect(v.shot).toBeNull();
    expect(v.demo).toBeNull();
    expect(v.hud).toBe(true);
    expect(v.stats).toBe(true);
    expect(v.freeze).toBe(false);
    expect(v.terrain).toBe('surface-nets');
    expect(v.scale).toBeNull();
    expect(v.benchPresets).toEqual(['low', 'balanced', 'ultra']);
  });

  it('reads the switches', () => {
    const v = readViewFlags(
      '?quality=ultra&seed=42&time=sunset&shot=valley&hud=0&stats=0&freeze=1&clock&terrain=heightfield&scale=0.5',
    );
    expect(v).toMatchObject({
      quality: 'ultra',
      seed: 42,
      time: 'sunset',
      shot: 'valley',
      hud: false,
      stats: false,
      freeze: true,
      clock: true,
      terrain: 'heightfield',
      scale: 0.5,
    });
  });

  it('passes the name of a demo structure through for the world to check', () => {
    expect(readViewFlags('?demo=outpost').demo).toBe('outpost');
    expect(readViewFlags('?demo=swatch&shot=swatch').demo).toBe('swatch');
    // A bare switch is an empty name, which the app reads as the outpost.
    expect(readViewFlags('?demo').demo).toBe('');
  });

  it('ignores a preset, a moment or a scale it cannot use', () => {
    expect(readViewFlags('?quality=extreme').quality).toBeNull();
    expect(readViewFlags('?time=midnight').time).toBeNull();
    expect(readViewFlags('?scale=0').scale).toBeNull();
    expect(readViewFlags('?scale=abc').scale).toBeNull();
    expect(readViewFlags('?scale=3').scale).toBe(1);
    expect(readViewFlags('?terrain=voxels').terrain).toBe('surface-nets');
    expect(readViewFlags('?seed=abc').seed).toBe(DEFAULT_SEED);
  });

  it('starts the run at a night when asked, and only for a night that exists', () => {
    expect(readViewFlags('?night=1').night).toBe(1);
    expect(readViewFlags('?night=5').night).toBe(5);
    expect(readViewFlags('?night=99').night).toBe(99);
    for (const bad of ['0', '100', '-2', '2.5', 'five', '', '007x', '1e1']) {
      expect(readViewFlags(`?night=${bad}`).night, bad).toBeNull();
    }
    expect(readViewFlags('?night').night).toBeNull();
  });

  it('turns the flags off with 0', () => {
    expect(readViewFlags('?clock=0').clock).toBe(false);
    expect(readViewFlags('?freeze=0').freeze).toBe(false);
    expect(readViewFlags('?freeze').freeze).toBe(true);
  });

  it('picks the presets the benchmark runs, once each and in the order given', () => {
    expect(readViewFlags('?benchPresets=ultra,low,ultra').benchPresets).toEqual(['ultra', 'low']);
    expect(readViewFlags('?benchPresets=balanced').benchPresets).toEqual(['balanced']);
    expect(readViewFlags('?benchPresets=huge').benchPresets).toEqual(['low', 'balanced', 'ultra']);
  });
});
