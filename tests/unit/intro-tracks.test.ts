import { describe, expect, it } from 'vitest';
import { shakeAt, TRACKS } from '../../src/engine/intro/tracks';
import { SCENES, type SceneName } from '../../src/shared/intro';

describe('the camera tracks of the film', () => {
  it('has a track for every scene and none for a scene that is not in the film', () => {
    expect(Object.keys(TRACKS).sort()).toEqual(SCENES.map((scene) => scene.name).sort());
  });

  for (const scene of SCENES) {
    const keys = TRACKS[scene.name];
    const seconds = scene.to - scene.from;

    describe(`the ${scene.name} scene`, () => {
      it('starts on its first second, ends on its last and keeps its keys in order', () => {
        expect(keys.length).toBeGreaterThanOrEqual(2);
        expect(keys[0]?.t).toBe(0);
        expect(keys[keys.length - 1]?.t).toBeCloseTo(seconds, 9);
        for (let i = 1; i < keys.length; i++) {
          expect((keys[i] as { t: number }).t).toBeGreaterThan((keys[i - 1] as { t: number }).t);
        }
      });

      it('asks for a lens and a follow that the camera can give', () => {
        for (const key of keys) {
          expect(key.fov).toBeGreaterThanOrEqual(25);
          expect(key.fov).toBeLessThanOrEqual(85);
          expect(key.follow ?? 0).toBeGreaterThanOrEqual(0);
          expect(key.follow ?? 0).toBeLessThanOrEqual(1);
          expect(Math.abs(key.roll ?? 0)).toBeLessThan(20);
        }
      });

      it('never puts the eye on the point it looks at', () => {
        for (const key of keys) {
          const [ax, ay, az] = key.at;
          const [lx, ly, lz] = key.look;
          expect(Math.hypot(ax - lx, ay - ly, az - lz)).toBeGreaterThan(1);
        }
      });

      it('shakes within bounds', () => {
        for (let t = 0; t <= seconds; t += 0.1) {
          const shake = shakeAt(scene.from + t, scene.name as SceneName, t);
          expect(shake).toBeGreaterThanOrEqual(0);
          expect(shake).toBeLessThanOrEqual(0.5);
        }
      });
    });
  }

  it('shakes while the wreck ploughs in and is still where the dust settles', () => {
    expect(shakeAt(9, 'skid', 1)).toBeGreaterThan(0.2);
    expect(shakeAt(13, 'skid', 5)).toBeLessThan(shakeAt(9, 'skid', 1));
    expect(shakeAt(20, 'eyes', 3)).toBe(0);
    expect(shakeAt(40, 'wake', 2)).toBe(0);
  });
});
