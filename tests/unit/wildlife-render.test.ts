import { Group, type InstancedBufferGeometry, type Mesh, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createWildlifeRenderer } from '../../src/engine/wildlife-render';
import { buildModel } from '../../src/engine/wildlife-models';
import { NET } from '../../src/shared/net-config';
import {
  WILD_FLAG,
  WILD_SPECIES,
  WILD_SPECIES_COUNT,
  createWildPose,
  type WildPose,
} from '../../src/shared/wildlife-state';
import { wildHitboxOf } from '../../src/systems/wildlife/balance';
import { createTestRegistry } from './helpers/registry';

const WATER_LEVEL = 7;
const NAMES = Object.keys(WILD_SPECIES) as (keyof typeof WILD_SPECIES)[];
/** The creatures that live in the lake, and so are drawn after its surface. */
const IN_THE_LAKE = new Set<number>([WILD_SPECIES.shoal, WILD_SPECIES.ray, WILD_SPECIES.jelly]);

function pose(
  id: number,
  species: number = WILD_SPECIES.stag,
  extra: Partial<WildPose> = {},
): WildPose {
  return { ...createWildPose(), id, kind: species, x: id, y: 10, z: -id, ...extra };
}

function setup(capacity?: number) {
  const registry = createTestRegistry();
  const renderer = createWildlifeRenderer({
    registry,
    waterLevel: WATER_LEVEL,
    ...(capacity ? { capacity } : {}),
  });
  const meshes = renderer.object.children as Mesh[];
  const geometryOf = (species: number): InstancedBufferGeometry =>
    (meshes[species] as Mesh).geometry as InstancedBufferGeometry;
  const value = (species: number, name: string, index: number, width = 4): number[] => {
    const array = geometryOf(species).getAttribute(name).array as Float32Array;
    return Array.from(array.slice(index * width, index * width + width));
  };
  return { renderer, registry, meshes, geometryOf, value };
}

describe('the creatures on screen', () => {
  it('are one mesh for each species, drawn in one call whatever their number, and hidden when there are none', () => {
    const { renderer, meshes, geometryOf } = setup();
    expect(meshes.map((mesh) => mesh.name)).toEqual([
      'stags',
      'hares',
      'mossbacks',
      'shoals',
      'rays',
      'jellies',
      'finches',
      'kites',
    ]);
    expect(meshes).toHaveLength(WILD_SPECIES_COUNT);
    for (const mesh of meshes) expect(mesh.visible).toBe(false);
    renderer.update(0.016, [
      pose(1, WILD_SPECIES.stag),
      pose(2, WILD_SPECIES.stag),
      pose(3, WILD_SPECIES.kite),
    ]);
    expect(geometryOf(WILD_SPECIES.stag).instanceCount).toBe(2);
    expect(geometryOf(WILD_SPECIES.kite).instanceCount).toBe(1);
    expect(meshes.filter((mesh) => mesh.visible).map((mesh) => mesh.name)).toEqual([
      'stags',
      'kites',
    ]);
    renderer.update(0.016, [pose(3, WILD_SPECIES.kite)]);
    expect(meshes[WILD_SPECIES.stag]?.visible).toBe(false);
    expect(geometryOf(WILD_SPECIES.stag).instanceCount).toBe(0);
    renderer.update(0.016, []);
    for (const mesh of meshes) expect(mesh.visible).toBe(false);
  });

  it('are put where their poses say, facing as they face, and listed in the order of the poses whatever their species', () => {
    const { renderer, value } = setup();
    renderer.update(0.016, [
      pose(7, WILD_SPECIES.hare, { x: 3.5, y: 11.25, z: -8, yaw: 1.5, health: 0.4, speed: 2 }),
      pose(2, WILD_SPECIES.jelly, { x: -4, y: 5, z: 6, flags: WILD_FLAG.alarmed }),
      pose(9, WILD_SPECIES.hare, { x: 1, y: 12, z: 2 }),
    ]);
    expect(value(WILD_SPECIES.hare, 'iPos', 0).slice(0, 3)).toEqual([3.5, 11.25, -8]);
    expect(value(WILD_SPECIES.hare, 'iPos', 1).slice(0, 3)).toEqual([1, 12, 2]);
    expect(value(WILD_SPECIES.hare, 'iData', 0)[0]).toBeCloseTo(1.5, 6);
    expect(value(WILD_SPECIES.jelly, 'iPos', 0).slice(0, 3)).toEqual([-4, 5, 6]);
    expect(renderer.list()).toEqual([
      {
        id: 7,
        kind: WILD_SPECIES.hare,
        x: 3.5,
        y: 11.25,
        z: -8,
        health: expect.closeTo(0.4, 6),
        flags: 0,
        yaw: expect.closeTo(1.5, 6),
        speed: 2,
      },
      {
        id: 2,
        kind: WILD_SPECIES.jelly,
        x: -4,
        y: 5,
        z: 6,
        health: 1,
        flags: WILD_FLAG.alarmed,
        yaw: 0,
        speed: 0,
      },
      {
        id: 9,
        kind: WILD_SPECIES.hare,
        x: 1,
        y: 12,
        z: 2,
        health: 1,
        flags: 0,
        yaw: 0,
        speed: 0,
      },
    ]);
  });

  it('draw no more than they have room for, and never write past the buffers', () => {
    const { renderer, geometryOf } = setup(4);
    renderer.update(
      0.016,
      Array.from({ length: 9 }, (_, i) => pose(i + 1)),
    );
    expect(geometryOf(WILD_SPECIES.stag).instanceCount).toBe(4);
    expect(renderer.list()).toHaveLength(4);
    // The room the network allows for is the room the picture has by default.
    const full = setup();
    full.renderer.update(
      0.016,
      Array.from({ length: NET.maxWildlife + 5 }, (_, i) => pose(i + 1)),
    );
    expect(full.geometryOf(WILD_SPECIES.stag).instanceCount).toBe(NET.maxWildlife);
    expect(full.renderer.list()).toHaveLength(NET.maxWildlife);
  });

  it('skip a species the picture does not know, and know every one the wire names', () => {
    const { renderer, geometryOf } = setup();
    renderer.update(0.016, [pose(1, WILD_SPECIES_COUNT), pose(2, 200), pose(3, WILD_SPECIES.hare)]);
    expect(renderer.list().map((creature) => creature.id)).toEqual([3]);
    expect(geometryOf(WILD_SPECIES.hare).instanceCount).toBe(1);
    expect(renderer.trianglesOf(WILD_SPECIES_COUNT)).toBe(0);
    for (const name of NAMES) {
      expect(renderer.trianglesOf(WILD_SPECIES[name]), name).toBeGreaterThan(0);
    }
  });

  it('walk their legs as far as they walk, and no further', () => {
    const { renderer, value } = setup();
    const stag = (speed: number) => pose(1, WILD_SPECIES.stag, { speed });
    renderer.update(0.05, [stag(0)]);
    const standing = value(WILD_SPECIES.stag, 'iData', 0)[2] as number;
    renderer.update(0.05, [stag(0)]);
    expect(value(WILD_SPECIES.stag, 'iData', 0)[2]).toBeCloseTo(standing, 9);
    let before = value(WILD_SPECIES.stag, 'iData', 0)[2] as number;
    renderer.update(0.05, [stag(1.5)]);
    const after = value(WILD_SPECIES.stag, 'iData', 0)[2] as number;
    expect(Math.abs(after - before)).toBeGreaterThan(0.1);
    // Twice the time at the same speed is twice the stride.
    before = after;
    renderer.update(0.1, [stag(1.5)]);
    const longer = value(WILD_SPECIES.stag, 'iData', 0)[2] as number;
    expect(longer - before).toBeCloseTo(2 * (after - standing), 6);
  });

  it('ease the gait in and out instead of snapping from standing to walking', () => {
    const { renderer, value } = setup();
    renderer.update(0.016, [pose(1, WILD_SPECIES.stag, { speed: 0 })]);
    expect(value(WILD_SPECIES.stag, 'iData', 0)[3]).toBe(0);
    renderer.update(0.016, [pose(1, WILD_SPECIES.stag, { speed: 2 })]);
    const first = value(WILD_SPECIES.stag, 'iData', 0)[3] as number;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.5);
    for (let i = 0; i < 60; i++) renderer.update(0.016, [pose(1, WILD_SPECIES.stag, { speed: 2 })]);
    expect(value(WILD_SPECIES.stag, 'iData', 0)[3]).toBeGreaterThan(0.99);
    for (let i = 0; i < 60; i++) renderer.update(0.016, [pose(1, WILD_SPECIES.stag, { speed: 0 })]);
    expect(value(WILD_SPECIES.stag, 'iData', 0)[3]).toBeLessThan(0.01);
  });

  it('keep beating what beats of their own accord (wings, tails, bells) and stand quite still where nothing does', () => {
    const { renderer, value } = setup();
    const at = (species: number): number => value(species, 'iData', 0)[2] as number;
    const poses = [
      pose(1, WILD_SPECIES.stag),
      pose(2, WILD_SPECIES.finch),
      pose(3, WILD_SPECIES.shoal),
      pose(4, WILD_SPECIES.jelly),
    ];
    renderer.update(0.05, poses);
    const start = poses.map((p) => at(p.kind));
    renderer.update(0.05, poses);
    const moved = poses.map((p, i) => at(p.kind) - (start[i] as number));
    // A stag at rest does not; a finch beats at 38 radians a second; a fish and a jelly keep to their own time.
    expect(moved[0]).toBeCloseTo(0, 9);
    expect(moved[1]).toBeCloseTo(38 * 0.05, 6);
    expect(moved[2]).toBeGreaterThan(0.3);
    expect(moved[3]).toBeGreaterThan(0.05);
  });

  it('start each creature at its own point in the cycle and its own size, so a herd is not a stamp', () => {
    const { renderer, value } = setup();
    renderer.update(
      0.016,
      [1, 2, 3, 4].map((id) => pose(id, WILD_SPECIES.hare)),
    );
    const phases = [0, 1, 2, 3].map((i) => value(WILD_SPECIES.hare, 'iData', i)[2]);
    expect(new Set(phases).size).toBe(4);
    const sizes = [0, 1, 2, 3].map((i) => value(WILD_SPECIES.hare, 'iData', i)[1] as number);
    for (const size of sizes) {
      expect(size).toBeGreaterThan(0.94);
      expect(size).toBeLessThan(1.06);
    }
    expect(new Set(sizes).size).toBe(4);
    // A species is drawn at its own scale: the stag a little smaller than its model, a shoal's fish larger.
    renderer.update(0.016, [pose(1, WILD_SPECIES.stag), pose(1, WILD_SPECIES.shoal)]);
    expect(value(WILD_SPECIES.stag, 'iData', 0)[1]).toBeCloseTo(0.85 * (sizes[0] as number), 6);
    expect(value(WILD_SPECIES.shoal, 'iData', 0)[1]).toBeCloseTo(1.4 * (sizes[0] as number), 6);
  });

  it('startle quickly and settle slowly, and run their cycle faster for it', () => {
    const { renderer, value } = setup();
    const shoal = (flags: number) => pose(1, WILD_SPECIES.shoal, { flags });
    const mood = (slot: number): number => value(WILD_SPECIES.shoal, 'iMood', 0)[slot] as number;
    renderer.update(0.05, [shoal(0)]);
    const calm = value(WILD_SPECIES.shoal, 'iData', 0)[2] as number;
    renderer.update(0.05, [shoal(0)]);
    const calmStep = (value(WILD_SPECIES.shoal, 'iData', 0)[2] as number) - calm;
    expect(mood(0)).toBe(0);
    for (let i = 0; i < 20; i++) renderer.update(0.05, [shoal(WILD_FLAG.alarmed)]);
    expect(mood(0)).toBeGreaterThan(0.95);
    const hot = value(WILD_SPECIES.shoal, 'iData', 0)[2] as number;
    renderer.update(0.05, [shoal(WILD_FLAG.alarmed)]);
    expect((value(WILD_SPECIES.shoal, 'iData', 0)[2] as number) - hot).toBeGreaterThan(
      calmStep * 1.5,
    );
    // The flag drops: a tenth of a second later it is still afraid, two seconds later it is not.
    renderer.update(0.1, [shoal(0)]);
    expect(mood(0)).toBeGreaterThan(0.5);
    for (let i = 0; i < 40; i++) renderer.update(0.05, [shoal(0)]);
    expect(mood(0)).toBeLessThan(0.02);
  });

  it('glint and lunge when they fight back, and let go of it when they calm down', () => {
    const { renderer, value } = setup();
    const mood = (slot: number): number => value(WILD_SPECIES.stag, 'iMood', 0)[slot] as number;
    renderer.update(0.016, [pose(1)]);
    expect(mood(1)).toBe(0);
    expect(mood(2)).toBe(0);
    for (let i = 0; i < 40; i++) {
      renderer.update(0.05, [
        pose(1, WILD_SPECIES.stag, { flags: WILD_FLAG.angry | WILD_FLAG.strike }),
      ]);
    }
    expect(mood(1)).toBeGreaterThan(0.95);
    expect(mood(2)).toBeGreaterThan(0.95);
    // The blow lands and the wind-up is over, but the eyes stay red until it has calmed down.
    for (let i = 0; i < 10; i++) {
      renderer.update(0.05, [pose(1, WILD_SPECIES.stag, { flags: WILD_FLAG.angry })]);
    }
    expect(mood(2)).toBeLessThan(0.05);
    expect(mood(1)).toBeGreaterThan(0.8);
    for (let i = 0; i < 80; i++) renderer.update(0.05, [pose(1)]);
    expect(mood(1)).toBeLessThan(0.01);
  });

  it('flash when they are hit, then settle', () => {
    const { renderer, value } = setup();
    const flash = (): number => value(WILD_SPECIES.mossback, 'iState', 0)[0] as number;
    renderer.update(0.016, [pose(1, WILD_SPECIES.mossback)]);
    expect(flash()).toBe(0);
    renderer.update(0.016, [pose(1, WILD_SPECIES.mossback, { flags: WILD_FLAG.hurt })]);
    expect(flash()).toBe(1);
    // The flag is gone but the light is not, and it dies away within a fraction of a second.
    renderer.update(0.05, [pose(1, WILD_SPECIES.mossback)]);
    expect(flash()).toBeGreaterThan(0.5);
    expect(flash()).toBeLessThan(1);
    for (let i = 0; i < 10; i++) renderer.update(0.05, [pose(1, WILD_SPECIES.mossback)]);
    expect(flash()).toBe(0);
  });

  it('put their heads down to graze when they stand about unafraid, and not while they walk or run', () => {
    const grazed = (extra: Partial<WildPose>): number => {
      const { renderer, value } = setup();
      let most = 0;
      // The valley's clock goes round every fourteen seconds or so: sixteen seconds sees every creature graze.
      for (let i = 0; i < 160; i++) {
        renderer.update(0.1, [pose(50, WILD_SPECIES.stag, extra)]);
        most = Math.max(most, value(WILD_SPECIES.stag, 'iMood', 0)[3] as number);
      }
      return most;
    };
    expect(grazed({})).toBeGreaterThan(0.9);
    expect(grazed({ speed: 1 })).toBeLessThan(0.01);
    expect(grazed({ flags: WILD_FLAG.alarmed })).toBeLessThan(0.01);
    expect(grazed({ flags: WILD_FLAG.angry })).toBeLessThan(0.01);
  });

  it('bank into a turn and tip with a climb, as far as their kind does and no further', () => {
    const { renderer, value } = setup();
    const state = (species: number, slot: number): number =>
      value(species, 'iState', 0)[slot] as number;
    // A kite turns to the left (a rising heading) and climbs.
    for (let i = 0; i < 30; i++) {
      renderer.update(0.05, [
        pose(1, WILD_SPECIES.kite, { yaw: i * 0.08, y: 20 + i * 0.1, speed: 2 }),
        pose(2, WILD_SPECIES.jelly, { yaw: i * 0.08, y: 5 + i * 0.1, speed: 2 }),
      ]);
    }
    const left = state(WILD_SPECIES.kite, 2);
    expect(left).toBeGreaterThan(0.3);
    const climb = state(WILD_SPECIES.kite, 3);
    expect(Math.abs(climb)).toBeGreaterThan(0.1);
    // A jelly neither banks nor tips toward its heading: it hangs upright and pulses.
    expect(Math.abs(state(WILD_SPECIES.jelly, 3))).toBeLessThan(1e-6);
    // Turning the other way banks the other way, and flying straight and level straightens it.
    for (let i = 0; i < 30; i++) {
      renderer.update(0.05, [pose(1, WILD_SPECIES.kite, { yaw: 2.4 - i * 0.08, y: 23, speed: 2 })]);
    }
    expect(state(WILD_SPECIES.kite, 2)).toBeLessThan(-0.3);
    for (let i = 0; i < 80; i++) {
      renderer.update(0.05, [pose(1, WILD_SPECIES.kite, { yaw: 0, y: 23, speed: 2 })]);
    }
    expect(Math.abs(state(WILD_SPECIES.kite, 2))).toBeLessThan(0.05);
    expect(Math.abs(state(WILD_SPECIES.kite, 3))).toBeLessThan(0.05);
  });

  it('dive with the nose down when they strike from the air, and strike level when they do not fly', () => {
    const { renderer, value } = setup();
    const tip = (species: number): number => value(species, 'iState', 0)[3] as number;
    const strike = (id: number, species: number) =>
      pose(id, species, { flags: WILD_FLAG.angry | WILD_FLAG.strike, y: 20 });
    for (let i = 0; i < 40; i++) {
      renderer.update(0.05, [strike(1, WILD_SPECIES.kite), strike(2, WILD_SPECIES.stag)]);
    }
    expect(Math.abs(tip(WILD_SPECIES.kite))).toBeGreaterThan(0.5);
    expect(Math.abs(tip(WILD_SPECIES.stag))).toBeLessThan(1e-6);
  });

  it('grow out of nothing when they arrive, and only then', () => {
    const { renderer, value } = setup();
    renderer.update(0.016, [pose(1)]);
    expect(value(WILD_SPECIES.stag, 'iState', 0)[1]).toBeLessThan(0.1);
    for (let i = 0; i < 60; i++) renderer.update(0.016, [pose(1)]);
    expect(value(WILD_SPECIES.stag, 'iState', 0)[1]).toBe(1);
    // A creature that goes and comes back is a new arrival.
    renderer.update(0.016, []);
    renderer.update(0.016, [pose(1)]);
    expect(value(WILD_SPECIES.stag, 'iState', 0)[1]).toBeLessThan(0.1);
  });

  it('treat a long frame as a short one, so a hidden tab does not spin the legs', () => {
    const { renderer, value } = setup();
    renderer.update(0.016, [pose(1, WILD_SPECIES.stag, { speed: 2 })]);
    const a = value(WILD_SPECIES.stag, 'iData', 0)[2] as number;
    renderer.update(30, [pose(1, WILD_SPECIES.stag, { speed: 2 })]);
    const b = value(WILD_SPECIES.stag, 'iData', 0)[2] as number;
    expect(Math.abs(b - a)).toBeLessThan(2 * 2.9 * 0.1 + 1e-6);
    expect(value(WILD_SPECIES.stag, 'iState', 0)[1]).toBeLessThan(1);
  });

  it('are drawn about as big as the box the host tests shots against, so that what you hit is what you see', () => {
    const { renderer, value } = setup();
    // The way each species is longest, which the host's square box is sized to (a ray's tail trails past its disc).
    const across: Record<keyof typeof WILD_SPECIES, 'x' | 'z'> = {
      stag: 'z',
      hare: 'z',
      mossback: 'z',
      shoal: 'z',
      ray: 'x',
      jelly: 'x',
      finch: 'x',
      kite: 'x',
    };
    for (const name of NAMES) {
      const species = WILD_SPECIES[name];
      renderer.update(0.016, [pose(1, species)]);
      const size = value(species, 'iData', 0)[1] as number;
      const model = buildModel(species);
      expect(model, name).toBeDefined();
      (model as NonNullable<typeof model>).computeBoundingBox();
      const box = (model as NonNullable<typeof model>).boundingBox as NonNullable<
        NonNullable<typeof model>['boundingBox']
      >;
      const reach =
        across[name] === 'x'
          ? Math.max(Math.abs(box.min.x), Math.abs(box.max.x))
          : Math.max(Math.abs(box.min.z), Math.abs(box.max.z));
      const hitbox = wildHitboxOf(species);
      expect(hitbox, name).not.toBeNull();
      const ratio = (reach * size) / (hitbox as NonNullable<typeof hitbox>).halfWidth;
      expect(ratio, `${name} is drawn ${ratio.toFixed(2)} of its box`).toBeGreaterThan(0.75);
      expect(ratio, `${name} is drawn ${ratio.toFixed(2)} of its box`).toBeLessThan(1.3);
    }
  });

  it('draw the creatures of the lake after its surface and see-through, and the rest as solid things with shadows', () => {
    const { meshes } = setup();
    for (const name of NAMES) {
      const species = WILD_SPECIES[name];
      const mesh = meshes[species] as Mesh;
      const material = mesh.material as ShaderMaterial;
      if (IN_THE_LAKE.has(species)) {
        // The lake's surface is drawn at 10 and the shot effects at 12.
        expect(mesh.renderOrder, name).toBe(11);
        expect(material.transparent, name).toBe(true);
        expect(mesh.castShadow, name).toBe(false);
        expect(mesh.customDepthMaterial, name).toBeUndefined();
        expect(material.uniforms.uWater?.value.z, name).toBe(1);
        expect(material.uniforms.uWater?.value.x, name).toBe(WATER_LEVEL);
      } else {
        expect(mesh.renderOrder, name).toBe(0);
        expect(material.transparent, name).toBe(false);
        expect(mesh.castShadow, name).toBe(true);
        expect(mesh.customDepthMaterial, name).toBeDefined();
        expect(material.uniforms.uWater?.value.z, name).toBe(0);
      }
      expect(mesh.receiveShadow, name).toBe(true);
      expect(mesh.frustumCulled, name).toBe(false);
    }
    // A jelly is glass all through: it writes no depth, so what is behind it shows.
    expect((meshes[WILD_SPECIES.jelly]?.material as ShaderMaterial).depthWrite).toBe(false);
    expect((meshes[WILD_SPECIES.shoal]?.material as ShaderMaterial).depthWrite).toBe(true);
  });

  it('are lit like the rest of the world, and cast a shadow that moves the same way', () => {
    const { meshes, registry } = setup();
    const stag = meshes[WILD_SPECIES.stag] as Mesh;
    const material = stag.material as ShaderMaterial;
    expect(material.uniforms.uShadowParams).toBe(registry.shadowParams);
    expect(material.uniforms.uKeyDir).toBeDefined();
    const depth = stag.customDepthMaterial as ShaderMaterial;
    expect(depth.vertexShader).toContain('poseVertex');
    expect(material.vertexShader).toContain('poseVertex');
    // The body and its shadow carry themselves with the same numbers.
    for (const uniform of ['uLegs', 'uHead', 'uFlight', 'uSwim', 'uClock']) {
      expect(depth.uniforms[uniform], uniform).toBe(material.uniforms[uniform]);
    }
    const shadows = new Set(
      [
        WILD_SPECIES.stag,
        WILD_SPECIES.hare,
        WILD_SPECIES.mossback,
        WILD_SPECIES.finch,
        WILD_SPECIES.kite,
      ].map((species) => (meshes[species] as Mesh).customDepthMaterial),
    );
    expect(shadows.size).toBe(5);
  });

  it('cost a few thousand triangles for a crowd of every species, drawn a handful of times a frame', () => {
    const { renderer } = setup();
    let herd = 0;
    for (const name of NAMES) herd += renderer.trianglesOf(WILD_SPECIES[name]);
    // One of each: well under ten thousand, so that a valley's worth (a dozen of each) stays under a hundred thousand.
    expect(herd).toBeLessThan(10_000);
    expect(herd * 12).toBeLessThan(100_000);
  });

  it('give the materials back and leave the scene when they are done', () => {
    const { renderer, registry } = setup();
    const scene = new Group();
    scene.add(renderer.object);
    renderer.update(0.016, [pose(1), pose(2, WILD_SPECIES.kite)]);
    const materials = Reflect.get(registry, 'materials') as Set<unknown>;
    // One material for each species: they differ in coat.
    expect(materials.size).toBe(WILD_SPECIES_COUNT);
    renderer.dispose();
    expect(materials.size).toBe(0);
    expect(renderer.object.children).toHaveLength(0);
    expect(renderer.list()).toEqual([]);
    expect(scene.children).toHaveLength(0);
  });
});
