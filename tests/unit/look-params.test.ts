import { describe, expect, it } from 'vitest';
import { DEFAULT_BENCH_SECONDS } from '../../src/shared/flags';
import { readLookParams } from '../../src/spike/params';

describe('look spike URL switches', () => {
  it('opens the hero view at Balanced with everything on by default', () => {
    const p = readLookParams('');
    expect(p.quality).toBe('balanced');
    expect(p.seed).toBe(20261020);
    expect(p.time).toBeNull();
    expect(p.shot).toBeNull();
    expect(p.hud).toBe(true);
    expect(p.stats).toBe(true);
    expect(p.freeze).toBe(false);
    expect(p.bench).toBe(false);
    expect(p.terrain).toBe('surface-nets');
    expect(p.scale).toBeNull();
    expect(p.benchSeconds).toBe(DEFAULT_BENCH_SECONDS);
    expect(p.benchPresets).toEqual(['low', 'balanced', 'ultra']);
  });

  it('reads the switches', () => {
    const p = readLookParams(
      '?quality=ultra&seed=42&time=sunset&shot=valley&hud=0&stats=0&freeze=1&bench=1&terrain=heightfield&scale=0.5&debug',
    );
    expect(p).toMatchObject({
      quality: 'ultra',
      seed: 42,
      time: 'sunset',
      shot: 'valley',
      hud: false,
      stats: false,
      freeze: true,
      bench: true,
      terrain: 'heightfield',
      scale: 0.5,
      debug: true,
    });
  });

  it('ignores a moment it does not know and a scale it cannot use', () => {
    expect(readLookParams('?time=midnight').time).toBeNull();
    expect(readLookParams('?scale=0').scale).toBeNull();
    expect(readLookParams('?scale=abc').scale).toBeNull();
    expect(readLookParams('?scale=3').scale).toBe(1);
    expect(readLookParams('?terrain=voxels').terrain).toBe('surface-nets');
  });

  it('reads the benchmark switches the way the game page does', () => {
    expect(readLookParams('?bench=1').bench).toBe(true);
    expect(readLookParams('?bench').bench).toBe(true);
    expect(readLookParams('?bench=0').bench).toBe(false);
    expect(readLookParams('?bench=false').bench).toBe(false);
    expect(readLookParams('?debug').debug).toBe(true);
    expect(readLookParams('?benchSeconds=10').benchSeconds).toBe(10);
  });

  it('limits the benchmark settings to sane values', () => {
    expect(readLookParams('?benchSeconds=0').benchSeconds).toBe(0.1);
    expect(readLookParams('?benchSeconds=9999').benchSeconds).toBe(300);
    expect(readLookParams('?benchSeconds=abc').benchSeconds).toBe(DEFAULT_BENCH_SECONDS);
    expect(readLookParams('?benchPresets=ultra,low,ultra').benchPresets).toEqual(['ultra', 'low']);
    expect(readLookParams('?benchPresets=huge').benchPresets).toEqual(['low', 'balanced', 'ultra']);
  });
});
