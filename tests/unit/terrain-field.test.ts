import { describe, expect, it } from 'vitest';
import {
  CRASH,
  LAKE,
  WATER_LEVEL,
  WORLD_HALF,
  createTerrainField,
} from '../../src/world/terrain/field';
import { TEST_SEED, valley } from './helpers/valley';

describe('terrain field', () => {
  const { field } = valley();

  it('builds the same valley from the same seed and a different one from another', () => {
    const again = createTerrainField(TEST_SEED);
    const other = createTerrainField(TEST_SEED + 1);
    let differs = 0;
    for (let i = 0; i < 50; i++) {
      const x = -90 + i * 3.7;
      const z = 85 - i * 3.1;
      expect(again.heightAt(x, z)).toBe(field.heightAt(x, z));
      if (other.heightAt(x, z) !== field.heightAt(x, z)) differs++;
    }
    expect(differs).toBeGreaterThan(45);
    expect(again.rocks).toEqual(field.rocks);
  });

  it('matches the recorded heights, so a change to the valley is noticed', () => {
    const at = (x: number, z: number): number => field.heightAt(x, z);
    expect(at(0, 0)).toBeCloseTo(10.830014499726856, 9);
    expect(at(10, 20)).toBeCloseTo(12.409531350890973, 9);
    expect(at(-40, 33)).toBeCloseTo(15.494519910342959, 9);
    expect(at(LAKE.x, LAKE.z)).toBeCloseTo(3.9870385164485587, 9);
    expect(at(CRASH.x, CRASH.z)).toBeCloseTo(9.547983026869169, 9);
    expect(at(80, -70)).toBeCloseTo(32.02317447392551, 9);
  });

  it('has a lake below the waterline and a flat clearing at the crash site', () => {
    expect(field.heightAt(LAKE.x, LAKE.z)).toBeLessThan(WATER_LEVEL - 2);
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const x = CRASH.x + Math.cos(angle) * 6;
      const z = CRASH.z + Math.sin(angle) * 6;
      expect(Math.abs(field.heightAt(x, z) - CRASH.floor)).toBeLessThan(2.6);
    }
  });

  it('is gentle enough to walk: no cliffs in the open valley', () => {
    let steepest = 0;
    for (let i = 0; i < 400; i++) {
      const x = -50 + (i % 20) * 5;
      const z = -50 + Math.floor(i / 20) * 5;
      const slope = Math.abs(field.heightAt(x + 0.5, z) - field.heightAt(x, z)) / 0.5;
      steepest = Math.max(steepest, slope);
    }
    expect(steepest).toBeLessThan(1.2);
  });

  it('places 29 rock outcrops, none on the crash clearing, all inside the world', () => {
    expect(field.rocks).toHaveLength(29);
    for (const rock of field.rocks) {
      expect(Math.hypot(rock.x - CRASH.x, rock.z - CRASH.z)).toBeGreaterThan(CRASH.radius + 4);
      expect(Math.abs(rock.x)).toBeLessThan(WORLD_HALF);
      expect(Math.abs(rock.z)).toBeLessThan(WORLD_HALF);
      expect(field.rockSdf(rock, rock.x, rock.y, rock.z)).toBeLessThan(0);
    }
  });

  it('answers the signed distance: positive in the air, negative underground and inside rocks', () => {
    const h = field.heightAt(10, 20);
    expect(field.sdf(10, h + 5, 20)).toBeCloseTo(5, 6);
    expect(field.sdf(10, h - 3, 20)).toBeCloseTo(-3, 6);
    const rock = field.rocks[3];
    expect(rock).toBeDefined();
    if (rock) expect(field.sdf(rock.x, rock.y, rock.z)).toBeLessThan(-1);
  });

  it('draws a skyline that matches the valley inside the rim and towers over it far away', () => {
    expect(field.skylineAt(0, 0)).toBeCloseTo(field.heightAt(0, 0), 9);
    expect(field.skylineAt(150, -200)).toBeCloseTo(79.12382452110185, 9);
    expect(field.skylineAt(-600, 400)).toBeCloseTo(173.77015405654558, 9);
    expect(field.skylineAt(-600, 400)).toBeGreaterThan(field.heightAt(-600, 400));
  });

  it('paints a path, ash at the crash site and beach at the waterline', () => {
    const ground = (x: number, z: number): number => field.heightAt(x, z);
    expect(field.splatAt(12, 2, ground(12, 2)).dirt).toBeGreaterThan(0.5);
    expect(field.splatAt(CRASH.x, CRASH.z, ground(CRASH.x, CRASH.z)).ash).toBeGreaterThan(0.8);
    expect(field.splatAt(-60, 60, ground(-60, 60)).ash).toBe(0);
    for (let i = 0; i < 20; i++) {
      const s = field.splatAt(-60 + i * 6, 60 - i * 4, 15);
      for (const v of [s.dirt, s.ash, s.sand, s.lush]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
