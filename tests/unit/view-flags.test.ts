import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, readViewFlags, wildlifeWanted } from '../../src/shared/view-flags';

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
    expect(v.waves).toBe(true);
    expect(v.stock).toBeNull();
    expect(v.research).toBeNull();
    expect(v.intro).toBe('auto');
    expect(v.introAt).toBeNull();
    expect(v.title).toBe('auto');
    expect(v.sound).toBe(true);
    expect(v.wildlife).toBe('auto');
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

  it('keeps the waves on unless they are asked to stay away', () => {
    expect(readViewFlags('?waves=0').waves).toBe(false);
    expect(readViewFlags('?waves=1').waves).toBe(true);
    expect(readViewFlags('?waves').waves).toBe(true);
    expect(readViewFlags('?night=3&waves=0')).toMatchObject({ night: 3, waves: false });
  });

  it('opens the pool with the stock it is asked for, and with the table when it is not', () => {
    expect(readViewFlags('?stock=200').stock).toBe(200);
    expect(readViewFlags('?stock=0').stock).toBe(0);
    expect(readViewFlags('?stock=9999').stock).toBe(9999);
    for (const bad of ['-1', '1.5', 'many', '', '10000', '1e3', '0x10']) {
      expect(readViewFlags(`?stock=${bad}`).stock, bad).toBeNull();
    }
    expect(readViewFlags('?stock').stock).toBeNull();
    expect(readViewFlags('?night=3&stock=40')).toMatchObject({ night: 3, stock: 40 });
  });

  it('opens the run with the research it is asked for, and earns it by surviving when it is not', () => {
    expect(readViewFlags('?research=55').research).toBe(55);
    expect(readViewFlags('?research=0').research).toBe(0);
    expect(readViewFlags('?research=9999').research).toBe(9999);
    for (const bad of ['-1', '1.5', 'lots', '', '10000', '1e3', '0x10']) {
      expect(readViewFlags(`?research=${bad}`).research, bad).toBeNull();
    }
    expect(readViewFlags('?research').research).toBeNull();
    expect(readViewFlags('?stock=40&research=100')).toMatchObject({ stock: 40, research: 100 });
  });

  it('asks for the opening film, or for none, and otherwise leaves it to the settings', () => {
    for (const on of ['?intro', '?intro=', '?intro=on', '?intro=1', '?intro=true', '?intro=ON']) {
      expect(readViewFlags(on).intro, on).toBe('on');
    }
    for (const off of ['?intro=off', '?intro=0', '?intro=false', '?intro=OFF']) {
      expect(readViewFlags(off).intro, off).toBe('off');
    }
    for (const other of ['', '?intro=maybe', '?intro=2', '?hud=0']) {
      expect(readViewFlags(other).intro, other).toBe('auto');
    }
  });

  it('asks for the title screen, or for none, and otherwise leaves it to the page', () => {
    for (const on of ['?title', '?title=', '?title=on', '?title=1', '?title=true', '?title=ON']) {
      expect(readViewFlags(on).title, on).toBe('on');
    }
    for (const off of ['?title=off', '?title=0', '?title=false', '?title=OFF']) {
      expect(readViewFlags(off).title, off).toBe('off');
    }
    for (const other of ['', '?title=maybe', '?title=2', '?hud=0']) {
      expect(readViewFlags(other).title, other).toBe('auto');
    }
    expect(readViewFlags('?title=off&intro=on')).toMatchObject({ title: 'off', intro: 'on' });
  });

  it('keeps the page silent only when it is told to, whatever else the address says', () => {
    for (const off of ['?sound=off', '?sound=0', '?sound=false', '?sound=OFF']) {
      expect(readViewFlags(off).sound, off).toBe(false);
    }
    for (const other of ['', '?sound', '?sound=on', '?sound=1', '?sound=loud', '?title=off']) {
      expect(readViewFlags(other).sound, other).toBe(true);
    }
    expect(readViewFlags('?sound=off&intro=on')).toMatchObject({ sound: false, intro: 'on' });
  });

  it('asks for the wildlife, or for none, and otherwise leaves it to the page', () => {
    for (const on of ['?wildlife', '?wildlife=', '?wildlife=on', '?wildlife=1', '?wildlife=ON']) {
      expect(readViewFlags(on).wildlife, on).toBe('on');
    }
    for (const off of ['?wildlife=off', '?wildlife=0', '?wildlife=false', '?wildlife=OFF']) {
      expect(readViewFlags(off).wildlife, off).toBe('off');
    }
    for (const other of ['', '?wildlife=maybe', '?wildlife=2', '?waves=0']) {
      expect(readViewFlags(other).wildlife, other).toBe('auto');
    }
  });

  it('gives a person’s game its wildlife, and a scripted browser’s only when the address asks', () => {
    expect(wildlifeWanted('auto', false)).toBe(true);
    expect(wildlifeWanted('auto', true)).toBe(false);
    expect(wildlifeWanted('on', true)).toBe(true);
    expect(wildlifeWanted('on', false)).toBe(true);
    expect(wildlifeWanted('off', false)).toBe(false);
    expect(wildlifeWanted('off', true)).toBe(false);
  });

  it('holds the film at the second it is asked for, for pictures and tests', () => {
    expect(readViewFlags('?introAt=12.5').introAt).toBe(12.5);
    expect(readViewFlags('?introAt=0').introAt).toBe(0);
    expect(readViewFlags('?introAt=44').introAt).toBe(44);
    for (const bad of ['-1', 'soon', '', ' ', 'NaN', 'Infinity']) {
      expect(readViewFlags(`?introAt=${bad}`).introAt, bad).toBeNull();
    }
    expect(readViewFlags('?introAt').introAt).toBeNull();
    expect(readViewFlags('?intro=on&introAt=7')).toMatchObject({ intro: 'on', introAt: 7 });
  });

  it('picks the presets the benchmark runs, once each and in the order given', () => {
    expect(readViewFlags('?benchPresets=ultra,low,ultra').benchPresets).toEqual(['ultra', 'low']);
    expect(readViewFlags('?benchPresets=balanced').benchPresets).toEqual(['balanced']);
    expect(readViewFlags('?benchPresets=huge').benchPresets).toEqual(['low', 'balanced', 'ultra']);
  });
});
