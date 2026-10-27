import {
  DoubleSide,
  Group,
  type InstancedBufferGeometry,
  type Mesh,
  type ShaderMaterial,
} from 'three';
import { describe, expect, it } from 'vitest';
import { FX_COLOR, createShotFx } from '../../src/engine/shot-fx';

const CYAN = '#3ad1e0';

function setup(seed?: number) {
  const fx = createShotFx(seed === undefined ? {} : { seed });
  const bolts = fx.object.getObjectByName('shot-bolts') as Mesh;
  const sparks = fx.object.getObjectByName('shot-sparks') as Mesh;
  const read = (mesh: Mesh, name: string): Float32Array =>
    (mesh.geometry as InstancedBufferGeometry).getAttribute(name).array as Float32Array;
  return {
    fx,
    bolts,
    sparks,
    boltCount: () => (bolts.geometry as InstancedBufferGeometry).instanceCount,
    sparkCount: () => (sparks.geometry as InstancedBufferGeometry).instanceCount,
    bolt: (name: string) => read(bolts, name),
    spark: (name: string) => read(sparks, name),
  };
}

const ORIGIN = { x: 0, y: 0, z: 0 };
const AWAY = { x: 0, y: 0, z: -1 };

describe('the bolts of the blaster', () => {
  it('are two meshes that draw nothing until something happens, so the first shot builds no programs', () => {
    const { fx, bolts, sparks, boltCount, sparkCount } = setup();
    expect(fx.object.children).toHaveLength(2);
    expect(fx.object.children[0]).toBe(bolts);
    expect(fx.object.children[1]).toBe(sparks);
    expect(bolts.visible && sparks.visible).toBe(true);
    expect(boltCount()).toBe(0);
    expect(sparkCount()).toBe(0);
    fx.update(0.016);
    expect(boltCount()).toBe(0);
    expect(sparkCount()).toBe(0);
    expect(fx.live()).toEqual({ bolts: 0, sparks: 0 });
  });

  it('are drawn on both faces, because the ribbon is turned to the camera in the shader and winds either way', () => {
    const { bolts } = setup();
    expect((bolts.material as ShaderMaterial).side).toBe(DoubleSide);
  });

  it('fly from the gun to the mark and are gone once the streak has passed', () => {
    const { fx, boltCount } = setup();
    fx.bolt(ORIGIN, { x: 0, y: 0, z: -40 }, CYAN);
    fx.update(0.016);
    expect(fx.live().bolts).toBe(1);
    expect(boltCount()).toBe(1);
    // 40 blocks and a streak of eight, at 170 a second: a little over a quarter of a second.
    fx.update(0.2);
    expect(fx.live().bolts).toBe(1);
    fx.update(0.1);
    expect(fx.live().bolts).toBe(0);
    expect(boltCount()).toBe(0);
  });

  it('stay up for a tenth of a second even when the mark is at arm’s length', () => {
    const { fx } = setup();
    fx.bolt(ORIGIN, { x: 0, y: 0, z: -0.5 }, CYAN);
    fx.update(0.09);
    expect(fx.live().bolts).toBe(1);
    fx.update(0.02);
    expect(fx.live().bolts).toBe(0);
  });

  it('draw nothing for a bolt that goes nowhere or has no real ends', () => {
    const { fx } = setup();
    fx.bolt(ORIGIN, ORIGIN, CYAN);
    fx.bolt(ORIGIN, { x: Number.NaN, y: 0, z: 0 }, CYAN);
    fx.bolt(ORIGIN, { x: Infinity, y: 0, z: 0 }, CYAN);
    fx.update(0.016);
    expect(fx.live().bolts).toBe(0);
  });

  it('are written where the shot began and ended, in the color of the shooter', () => {
    const { fx, bolt } = setup();
    fx.bolt({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: -6 }, '#ff0000');
    expect(Array.from(bolt('iFrom').slice(0, 3))).toEqual([1, 2, 3]);
    expect(Array.from(bolt('iTo').slice(0, 3))).toEqual([4, 5, -6]);
    expect(Array.from(bolt('iColor').slice(0, 3))).toEqual([1, 0, 0]);
    // Each is born at the moment the clock stands at.
    expect(bolt('iBolt')[0]).toBe(0);
    fx.update(1);
    fx.bolt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -10 }, '#ff0000');
    expect(bolt('iBolt')[4]).toBeCloseTo(1, 6);
  });

  it('are drawn wider and brighter for a heavy gun, and no more than a limit however heavy', () => {
    const { fx, bolt } = setup();
    for (const heft of [1, 2, 1000]) fx.bolt(ORIGIN, { x: 0, y: 0, z: -20 }, '#ff0000', heft);
    const width = (i: number) => bolt('iBolt')[i * 4 + 3] as number;
    const red = (i: number) => bolt('iColor')[i * 3] as number;
    expect(width(1)).toBeCloseTo(width(0) * 2, 6);
    expect(red(1)).toBeCloseTo(red(0) * Math.SQRT2, 6);
    // Past the limit a bolt is drawn at the limit: a little thicker than twice, and no thicker.
    expect(width(2)).toBeGreaterThan(width(1));
    expect(width(2)).toBeLessThan(width(0) * 3);
    expect(red(2)).toBeGreaterThan(red(1));
    // The shape of the bolt is the same, only its weight changes: where it flies and how fast.
    expect(bolt('iBolt')[1]).toBe(bolt('iBolt')[5]);
    expect(Array.from(bolt('iTo').slice(0, 3))).toEqual(Array.from(bolt('iTo').slice(3, 6)));
  });

  it('are drawn as a player’s when the heft is lighter than one or is not a number', () => {
    const { fx, bolt } = setup();
    const hefts = [undefined, 1, 0.2, 0, -4, Number.NaN];
    for (const heft of hefts) fx.bolt(ORIGIN, { x: 0, y: 0, z: -20 }, '#ff0000', heft);
    hefts.forEach((heft, i) => {
      expect(bolt('iBolt')[i * 4 + 3], `heft ${heft}`).toBe(bolt('iBolt')[3]);
      expect(bolt('iColor')[i * 3], `heft ${heft}`).toBe(1);
    });
  });

  it('are kept in a ring: when there is no more room, the oldest make way', () => {
    const { fx, boltCount } = setup();
    for (let i = 0; i < 100; i++) fx.bolt(ORIGIN, { x: 0, y: 0, z: -(i + 2) }, CYAN);
    fx.update(0.016);
    expect(fx.live().bolts).toBeLessThanOrEqual(64);
    expect(boltCount()).toBe(64);
  });

  it('draw only what has been written, as the count of the draw', () => {
    const { fx, boltCount } = setup();
    fx.bolt(ORIGIN, { x: 0, y: 0, z: -10 }, CYAN);
    fx.bolt(ORIGIN, { x: 5, y: 0, z: -10 }, CYAN);
    fx.bolt(ORIGIN, { x: -5, y: 0, z: -10 }, CYAN);
    fx.update(0.016);
    expect(boltCount()).toBe(3);
  });
});

describe('the landing of a bolt', () => {
  it('is told to whoever asked: the head takes the length at the speed of the light', () => {
    const { fx } = setup();
    // The head flies the 34 blocks at 170 a second, whatever the length of the streak behind it.
    expect(fx.bolt(ORIGIN, { x: 0, y: 0, z: -34 }, CYAN)).toBeCloseTo(34 / 170, 6);
    // So near that the flight would be over in a couple of frames, it is slowed to last a tenth of a second.
    const near = fx.bolt(ORIGIN, { x: 0, y: 0, z: -1 }, CYAN);
    expect(near).toBeGreaterThan(1 / 170);
    expect(near).toBeLessThan(0.1);
    expect(fx.bolt(ORIGIN, ORIGIN, CYAN)).toBe(0);
  });

  it('holds the sparks and the burst back until it arrives', () => {
    const { fx, spark, sparkCount } = setup();
    const arrives = fx.bolt(ORIGIN, { x: 0, y: 0, z: -34 }, CYAN);
    fx.impact({ x: 0, y: 0, z: -34 }, AWAY, CYAN, arrives);
    fx.burst({ x: 0, y: 0, z: -34 }, arrives);
    // Everything is written, and everything is counted as on its way, so that the draw keeps going.
    expect(fx.live().sparks).toBe(11 + 32);
    expect(spark('iLife')[0]).toBeCloseTo(arrives, 6);
    expect(spark('iLife')[11 * 4]).toBeCloseTo(arrives, 6);
    fx.update(arrives * 0.5);
    expect(sparkCount()).toBe(43);
    // The shader works out that a spark born in the future is not there yet: nothing else is needed.
    fx.update(arrives * 0.5 + 0.01);
    expect(fx.live().sparks).toBe(43);
    fx.update(1.5);
    expect(fx.live().sparks).toBe(0);
    expect(sparkCount()).toBe(0);
  });

  it('is not held to a delay that makes no sense', () => {
    const { fx, spark } = setup();
    fx.impact(ORIGIN, AWAY, CYAN, -3);
    expect(spark('iLife')[0]).toBe(0);
    fx.impact(ORIGIN, AWAY, CYAN, Number.NaN);
    expect(spark('iLife')[11 * 4]).toBe(0);
    fx.burst(ORIGIN, Infinity);
    expect(spark('iLife')[22 * 4]).toBe(0);
  });
});

describe('the sparks of the blaster', () => {
  it('are a flash and a few sparks at the muzzle', () => {
    const { fx, spark } = setup();
    fx.muzzle(ORIGIN, AWAY, CYAN);
    expect(fx.live()).toEqual({ bolts: 0, sparks: 5 });
    // The first of them is the flash: it stands still and is marked as one.
    expect(spark('iLife')[3]).toBe(1);
    expect(spark('iLife')[7]).toBe(0);
    expect(Array.from(spark('iVelocity').slice(0, 3))).toEqual([0, 0, 0]);
    expect(spark('iOrigin')[3]).toBe(0);
    expect(spark('iOrigin')[7]).toBe(1);
  });

  it('swell the flash at the muzzle of a heavy gun, and no further than a limit', () => {
    const { fx, spark } = setup();
    for (const heft of [1, 2, 1000, Number.NaN]) fx.muzzle(ORIGIN, AWAY, CYAN, heft);
    // The flash is the first of the five sparks a muzzle writes, and its size the third of its life.
    const size = (muzzle: number) => spark('iLife')[muzzle * 5 * 4 + 2] as number;
    expect(size(1) / size(0)).toBeCloseTo(Math.SQRT2, 6);
    expect(size(2)).toBeGreaterThan(size(1));
    expect(size(2) / size(0)).toBeLessThan(2);
    expect(size(3)).toBe(size(0));
    // The sparks thrown along the bolt are the same for any gun.
    expect(fx.live().sparks).toBe(20);
  });

  it('are thrown the way the bolt goes from the muzzle, and back the way it came from a mark', () => {
    const { fx, spark } = setup();
    fx.muzzle(ORIGIN, AWAY, CYAN);
    const muzzle = spark('iVelocity');
    let forward = 0;
    for (let i = 1; i < 5; i++) forward += muzzle[i * 3 + 2] as number;
    expect(forward).toBeLessThan(0);

    const struck = setup();
    struck.fx.impact({ x: 0, y: 0, z: -20 }, AWAY, CYAN);
    expect(struck.fx.live().sparks).toBe(11);
    const velocity = struck.spark('iVelocity');
    let back = 0;
    for (let i = 1; i < 11; i++) back += velocity[i * 3 + 2] as number;
    expect(back).toBeGreaterThan(0);
  });

  it('come apart in a burst of thirty and two flashes when a machine falls', () => {
    const { fx, spark } = setup();
    fx.burst({ x: 3, y: 4, z: 5 });
    expect(fx.live().sparks).toBe(32);
    expect(spark('iLife')[3]).toBe(1);
    expect(spark('iLife')[7]).toBe(1);
    expect(spark('iLife')[11]).toBe(0);
    // Thrown every way at once: some up and some down, some each side.
    const velocity = spark('iVelocity');
    const spread = (axis: number): [number, number] => {
      let least = Infinity;
      let most = -Infinity;
      for (let i = 2; i < 32; i++) {
        const v = velocity[i * 3 + axis] as number;
        least = Math.min(least, v);
        most = Math.max(most, v);
      }
      return [least, most];
    };
    for (const axis of [0, 1, 2]) {
      const [least, most] = spread(axis);
      expect(least).toBeLessThan(0);
      expect(most).toBeGreaterThan(0);
    }
  });

  it('go off in a blast when a breacher does: a flash wider than a machine’s, a white core and sixty-four sparks every way', () => {
    const { fx, spark } = setup();
    fx.blast({ x: 3, y: 4, z: 5 });
    expect(fx.live().sparks).toBe(66);
    // Two flashes, then sparks.
    expect(spark('iLife')[3]).toBe(1);
    expect(spark('iLife')[7]).toBe(1);
    expect(spark('iLife')[11]).toBe(0);
    // The flash is wider than the burst of a machine felled, and the core inside it is not as wide.
    const burst = setup();
    burst.fx.burst({ x: 3, y: 4, z: 5 });
    expect(spark('iLife')[2]).toBeGreaterThan(2 * (burst.spark('iLife')[2] as number));
    expect(spark('iLife')[6]).toBeLessThan(spark('iLife')[2] as number);
    expect(Array.from(spark('iOrigin').slice(0, 3))).toEqual([3, 4, 5]);
    // Thrown every way at once.
    const velocity = spark('iVelocity');
    for (const axis of [0, 1, 2]) {
      let least = Infinity;
      let most = -Infinity;
      for (let i = 2; i < 66; i++) {
        const v = velocity[i * 3 + axis] as number;
        least = Math.min(least, v);
        most = Math.max(most, v);
      }
      expect(least).toBeLessThan(0);
      expect(most).toBeGreaterThan(0);
    }
  });

  it('let a blast die away more slowly than a burst: its flashes in 0.4 seconds, its sparks within a second and a fifth', () => {
    const { fx } = setup();
    fx.blast(ORIGIN);
    fx.update(0.016);
    expect(fx.live().sparks).toBe(66);
    fx.update(0.45);
    expect(fx.live().sparks).toBe(64);
    fx.update(0.8);
    expect(fx.live().sparks).toBe(0);
  });

  it('die out: the flashes first, the sparks after, and the draw stops when all are gone', () => {
    const { fx, sparkCount } = setup();
    fx.burst(ORIGIN);
    fx.update(0.016);
    expect(sparkCount()).toBe(32);
    fx.update(0.3);
    // Both flashes (0.22 and 0.12 seconds) have ended; the sparks last at least 0.4.
    expect(fx.live().sparks).toBe(30);
    fx.update(0.6);
    expect(fx.live().sparks).toBe(0);
    expect(sparkCount()).toBe(0);
  });

  it('are the same every time for the same seed, and differ for another', () => {
    const a = setup(7);
    const b = setup(7);
    const c = setup(8);
    for (const rig of [a, b, c]) rig.fx.impact(ORIGIN, AWAY, CYAN);
    expect(Array.from(a.spark('iVelocity'))).toEqual(Array.from(b.spark('iVelocity')));
    expect(Array.from(a.spark('iVelocity'))).not.toEqual(Array.from(c.spark('iVelocity')));
  });

  it('are kept in a ring too, and never write past the buffers', () => {
    const { fx, sparkCount } = setup();
    for (let i = 0; i < 40; i++) fx.burst(ORIGIN);
    fx.update(0.016);
    expect(sparkCount()).toBe(768);
    expect(fx.live().sparks).toBeLessThanOrEqual(768);
  });

  it('use the amber of a strike for the machines and the shooter’s own color for the rest', () => {
    const { fx, spark } = setup();
    fx.impact(ORIGIN, AWAY, FX_COLOR.hit);
    const amber = Array.from(spark('iColor').slice(0, 3));
    const other = setup();
    other.fx.impact(ORIGIN, AWAY, CYAN);
    const cyan = Array.from(other.spark('iColor').slice(0, 3));
    expect(amber[0]).toBeGreaterThan(amber[2] as number);
    expect(cyan[2]).toBeGreaterThan(cyan[0] as number);
  });
});

describe('the spray of a heap stripped', () => {
  it('is two flashes and eighteen bits of scrap, in gold', () => {
    const { fx, spark } = setup();
    fx.strip({ x: 3, y: 4, z: 5 });
    expect(fx.live()).toEqual({ bolts: 0, sparks: 20 });
    // The two flashes come first and stand still; the bits after them are marked as sparks.
    expect(spark('iLife')[3]).toBe(1);
    expect(spark('iLife')[7]).toBe(1);
    expect(spark('iLife')[11]).toBe(0);
    expect(Array.from(spark('iOrigin').slice(0, 3))).toEqual([3, 4, 5]);
    const gold = Array.from(spark('iColor').slice(0, 3));
    expect(gold[0]).toBeGreaterThan(gold[1] as number);
    expect(gold[1]).toBeGreaterThan(gold[2] as number);
  });

  it('is flung up and out, every way along the ground and mostly upward', () => {
    const { fx, spark } = setup();
    fx.strip(ORIGIN);
    const velocity = spark('iVelocity');
    let up = 0;
    let down = 0;
    let west = 0;
    let east = 0;
    let north = 0;
    let south = 0;
    for (let i = 2; i < 20; i++) {
      const [vx, vy, vz] = [velocity[i * 3], velocity[i * 3 + 1], velocity[i * 3 + 2]] as number[];
      if ((vy as number) > 0) up++;
      else down++;
      if ((vx as number) > 0) east++;
      else west++;
      if ((vz as number) > 0) south++;
      else north++;
    }
    expect(up).toBeGreaterThan(down);
    expect(Math.min(east, west, north, south)).toBeGreaterThan(0);
  });

  it('is over inside a second, and the draw stops when it is', () => {
    const { fx, sparkCount } = setup();
    fx.strip(ORIGIN);
    fx.update(0.016);
    expect(sparkCount()).toBe(20);
    fx.update(0.25);
    // Both flashes (0.2 and 0.1 seconds) have ended; the bits last at least 0.35.
    expect(fx.live().sparks).toBe(18);
    fx.update(0.6);
    expect(fx.live().sparks).toBe(0);
    expect(sparkCount()).toBe(0);
  });
});

describe('the clock of the blaster’s light', () => {
  it('starts over after a long quiet, so that it never grows large enough to blur', () => {
    const { fx, bolt, spark } = setup();
    fx.bolt(ORIGIN, { x: 0, y: 0, z: -10 }, CYAN);
    fx.burst(ORIGIN);
    fx.update(700);
    // Everything has played out and the quiet has gone on past ten minutes: the slots are cleared.
    expect(bolt('iBolt')[0]).toBe(-1e6);
    expect(spark('iLife')[0]).toBe(-1e6);
    expect(fx.live()).toEqual({ bolts: 0, sparks: 0 });
    fx.bolt(ORIGIN, { x: 0, y: 0, z: -10 }, CYAN);
    expect(bolt('iBolt')[4]).toBe(0);
    fx.update(0.016);
    expect(fx.live().bolts).toBe(1);
  });

  it('does not start over while something is still playing', () => {
    const { fx, bolt } = setup();
    fx.update(599.9);
    fx.bolt(ORIGIN, { x: 0, y: 0, z: -100 }, CYAN);
    // Past the quiet, but the bolt flies on for another half second.
    fx.update(0.2);
    expect(fx.live().bolts).toBe(1);
    expect(bolt('iBolt')[0]).toBeCloseTo(599.9, 3);
    fx.update(1);
    expect(bolt('iBolt')[0]).toBe(-1e6);
  });

  it('ignores a frame that runs backwards', () => {
    const { fx } = setup();
    fx.bolt(ORIGIN, { x: 0, y: 0, z: -10 }, CYAN);
    fx.update(-5);
    fx.update(0.01);
    expect(fx.live().bolts).toBe(1);
  });
});

describe('taking the light off the stage', () => {
  it('removes it from its parent', () => {
    const { fx } = setup();
    const parent = new Group();
    parent.add(fx.object);
    fx.dispose();
    expect(fx.object.parent).toBeNull();
    expect(parent.children).toHaveLength(0);
  });
});
