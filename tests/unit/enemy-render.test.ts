import type { InstancedBufferGeometry, Mesh, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createEnemyRenderer } from '../../src/engine/enemy-render';
import {
  ENEMY_FLAG,
  ENEMY_KIND,
  createEnemyPose,
  type EnemyPose,
} from '../../src/shared/enemy-state';
import { NET } from '../../src/shared/net-config';
import { createTestRegistry } from './helpers/registry';

function pose(id: number, extra: Partial<EnemyPose> = {}): EnemyPose {
  return { ...createEnemyPose(), id, x: id, y: 10, z: -id, ...extra };
}

function setup(capacity?: number) {
  const registry = createTestRegistry();
  const renderer = createEnemyRenderer({ registry, ...(capacity ? { capacity } : {}) });
  const mesh = renderer.object.children[0] as Mesh;
  const geometry = mesh.geometry as InstancedBufferGeometry;
  const value = (name: string, index: number, width: number): number[] => {
    const array = geometry.getAttribute(name).array as Float32Array;
    return Array.from(array.slice(index * width, index * width + width));
  };
  return { renderer, registry, mesh, geometry, value };
}

describe('the machines on screen', () => {
  it('are one mesh for each kind, drawn in one call whatever their number, and hidden when there are none', () => {
    const { renderer, mesh, geometry } = setup();
    expect(renderer.object.children.map((child) => child.name)).toEqual(['crawlers', 'armored']);
    expect(mesh.visible).toBe(false);
    renderer.update(0.016, [pose(1), pose(2), pose(3)]);
    expect(mesh.visible).toBe(true);
    expect(geometry.instanceCount).toBe(3);
    renderer.update(0.016, [pose(1)]);
    expect(geometry.instanceCount).toBe(1);
    renderer.update(0.016, []);
    expect(mesh.visible).toBe(false);
    expect(geometry.instanceCount).toBe(0);
  });

  it('put each machine where its pose says, in the order of the poses', () => {
    const { renderer, value } = setup();
    renderer.update(0.016, [
      pose(7, { x: 3.5, y: 11.25, z: -8, yaw: 1.5, health: 0.4 }),
      pose(2, { x: -4, y: 9, z: 6 }),
    ]);
    expect(value('iPos', 0, 3)).toEqual([3.5, 11.25, -8]);
    expect(value('iPos', 1, 3)).toEqual([-4, 9, 6]);
    expect(value('iData', 0, 4)[0]).toBeCloseTo(1.5, 6);
    expect(value('iState', 0, 4)[0]).toBeCloseTo(0.4, 6);
    expect(renderer.list()).toEqual([
      { id: 7, kind: 0, x: 3.5, y: 11.25, z: -8, health: expect.closeTo(0.4, 6) },
      { id: 2, kind: 0, x: -4, y: 9, z: 6, health: 1 },
    ]);
  });

  it('draw no more than they have room for, and never write past the buffers', () => {
    const { renderer, geometry } = setup(4);
    const crowd = Array.from({ length: 9 }, (_, i) => pose(i + 1));
    renderer.update(0.016, crowd);
    expect(geometry.instanceCount).toBe(4);
    expect(renderer.list()).toHaveLength(4);
    // The room the network allows for is the room the picture has by default.
    const full = setup();
    full.renderer.update(
      0.016,
      Array.from({ length: NET.maxEnemies + 5 }, (_, i) => pose(i + 1)),
    );
    expect(full.geometry.instanceCount).toBe(NET.maxEnemies);
  });

  it('walk their legs as far as they walk, and no further', () => {
    const { renderer, value } = setup();
    renderer.update(0.05, [pose(1, { speed: 0 })]);
    const standing = value('iData', 0, 4)[2] as number;
    renderer.update(0.05, [pose(1, { speed: 0 })]);
    expect(value('iData', 0, 4)[2]).toBeCloseTo(standing, 9);
    let before = value('iData', 0, 4)[2] as number;
    renderer.update(0.05, [pose(1, { speed: 2.6 })]);
    const after = value('iData', 0, 4)[2] as number;
    expect(Math.abs(after - before)).toBeGreaterThan(0.3);
    // Twice the time at the same speed is twice the stride (modulo a full turn).
    before = after;
    renderer.update(0.1, [pose(1, { speed: 2.6 })]);
    const longer = value('iData', 0, 4)[2] as number;
    expect(longer - before).toBeCloseTo(2 * (after - standing), 6);
  });

  it('ease the legs in and out instead of snapping from standing to walking', () => {
    const { renderer, value } = setup();
    renderer.update(0.016, [pose(1, { speed: 0 })]);
    expect(value('iData', 0, 4)[3]).toBe(0);
    renderer.update(0.016, [pose(1, { speed: 2.6 })]);
    const first = value('iData', 0, 4)[3] as number;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.5);
    for (let i = 0; i < 60; i++) renderer.update(0.016, [pose(1, { speed: 2.6 })]);
    expect(value('iData', 0, 4)[3]).toBeGreaterThan(0.99);
    for (let i = 0; i < 60; i++) renderer.update(0.016, [pose(1, { speed: 0 })]);
    expect(value('iData', 0, 4)[3]).toBeLessThan(0.01);
  });

  it('lunge when they bite and flash when they are hit, then settle', () => {
    const { renderer, value } = setup();
    renderer.update(0.016, [pose(1)]);
    expect(value('iState', 0, 4).slice(1, 3)).toEqual([0, 0]);
    for (let i = 0; i < 20; i++) renderer.update(0.016, [pose(1, { flags: ENEMY_FLAG.attack })]);
    expect(value('iState', 0, 4)[2]).toBeGreaterThan(0.9);
    renderer.update(0.016, [pose(1, { flags: ENEMY_FLAG.hurt })]);
    expect(value('iState', 0, 4)[1]).toBe(1);
    // The flag is gone but the light is not, and it dies away within a fraction of a second.
    renderer.update(0.05, [pose(1)]);
    const fading = value('iState', 0, 4)[1] as number;
    expect(fading).toBeGreaterThan(0.5);
    expect(fading).toBeLessThan(1);
    for (let i = 0; i < 30; i++) renderer.update(0.016, [pose(1)]);
    expect(value('iState', 0, 4).slice(1, 3)).toEqual([0, expect.closeTo(0, 3)]);
  });

  it('rise out of the ground when they arrive, and only then', () => {
    const { renderer, value } = setup();
    renderer.update(0.016, [pose(1)]);
    expect(value('iState', 0, 4)[3]).toBeLessThan(0.1);
    for (let i = 0; i < 60; i++) renderer.update(0.016, [pose(1)]);
    expect(value('iState', 0, 4)[3]).toBe(1);
    // A machine that goes and comes back is a new arrival.
    renderer.update(0.016, []);
    renderer.update(0.016, [pose(1)]);
    expect(value('iState', 0, 4)[3]).toBeLessThan(0.1);
  });

  it('keep every machine at its own point in the stride, so a crowd does not march in step', () => {
    const { renderer, value } = setup();
    renderer.update(0.016, [pose(1), pose(2), pose(3), pose(4)]);
    const phases = [0, 1, 2, 3].map((i) => value('iData', i, 4)[2]);
    expect(new Set(phases).size).toBe(4);
    const sizes = [0, 1, 2, 3].map((i) => value('iData', i, 4)[1] as number);
    for (const size of sizes) {
      expect(size).toBeGreaterThan(0.94);
      expect(size).toBeLessThan(1.06);
    }
    expect(new Set(sizes).size).toBe(4);
  });

  it('treat a long frame as a short one, so a hidden tab does not spin the legs', () => {
    const { renderer, value } = setup();
    renderer.update(0.016, [pose(1, { speed: 2.6 })]);
    const a = value('iData', 0, 4)[2] as number;
    renderer.update(30, [pose(1, { speed: 2.6 })]);
    const b = value('iData', 0, 4)[2] as number;
    expect(Math.abs(b - a)).toBeLessThan(2.6 * 0.1 * 5 + 1e-6);
    expect(value('iState', 0, 4)[3]).toBeLessThan(1);
  });

  it('have a body of a few hundred triangles each, and a hundred cost under a hundred thousand', () => {
    const { renderer } = setup();
    expect(renderer.trianglesPerMachine).toBeGreaterThan(300);
    expect(renderer.trianglesPerMachine).toBeLessThan(1000);
    expect(renderer.trianglesPerMachine * 100).toBeLessThan(100_000);
  });

  it('draw the armored crawlers in a mesh of their own, larger, in the order of the poses among the rest', () => {
    const { renderer, geometry } = setup();
    const [crawlers, armored] = renderer.object.children as Mesh[];
    const plated = armored!.geometry as InstancedBufferGeometry;
    renderer.update(0.016, [
      pose(1),
      pose(2, { kind: ENEMY_KIND.armored, x: 5, y: 12, z: -3 }),
      pose(3),
      pose(4, { kind: ENEMY_KIND.armored }),
    ]);
    expect(geometry.instanceCount).toBe(2);
    expect(plated.instanceCount).toBe(2);
    expect(crawlers!.visible).toBe(true);
    expect(armored!.visible).toBe(true);
    const at = (name: string, index: number, width: number): number[] =>
      Array.from(
        (plated.getAttribute(name).array as Float32Array).slice(
          index * width,
          index * width + width,
        ),
      );
    expect(at('iPos', 0, 3)).toEqual([5, 12, -3]);
    // The same spread of sizes, on a larger body.
    for (const index of [0, 1]) {
      const size = at('iData', index, 4)[1] as number;
      expect(size).toBeGreaterThan(0.94 * 1.2);
      expect(size).toBeLessThan(1.06 * 1.2);
    }
    // The list reads every machine on screen, in the order the poses came.
    expect(renderer.list().map((machine) => [machine.id, machine.kind])).toEqual([
      [1, 0],
      [2, 1],
      [3, 0],
      [4, 1],
    ]);
    // Without crawlers the crawlers' mesh is hidden, and the armored ones stay.
    renderer.update(0.016, [pose(2, { kind: ENEMY_KIND.armored })]);
    expect(crawlers!.visible).toBe(false);
    expect(armored!.visible).toBe(true);
  });

  it('stride more slowly in armor, and draw a kind it does not know as a crawler', () => {
    const { renderer, geometry } = setup();
    const plated = (renderer.object.children[1] as Mesh).geometry as InstancedBufferGeometry;
    const phase = (g: InstancedBufferGeometry, index: number): number =>
      (g.getAttribute('iData').array as Float32Array)[index * 4 + 2] as number;
    // The same id walks the same distance in the same time: only the stride differs.
    renderer.update(0.05, [pose(5), pose(5 + 1000, { kind: ENEMY_KIND.armored })]);
    const crawlerStart = phase(geometry, 0);
    const armoredStart = phase(plated, 0);
    renderer.update(0.05, [
      pose(5, { speed: 2 }),
      pose(5 + 1000, { kind: ENEMY_KIND.armored, speed: 2 }),
    ]);
    const crawlerStep = phase(geometry, 0) - crawlerStart;
    const armoredStep = phase(plated, 0) - armoredStart;
    expect(crawlerStep).toBeGreaterThan(0);
    expect(armoredStep).toBeGreaterThan(0);
    expect(armoredStep).toBeLessThan(crawlerStep);
    // A kind the picture has no model for is a crawler.
    renderer.update(0.016, [pose(9, { kind: 7 })]);
    expect(geometry.instanceCount).toBe(1);
    expect(plated.instanceCount).toBe(0);
    expect(renderer.trianglesOf(7)).toBe(renderer.trianglesPerMachine);
  });

  it('give the armored crawler more of a body than the crawler, still within the budget of a hundred', () => {
    const { renderer } = setup();
    expect(renderer.trianglesOf(ENEMY_KIND.armored)).toBeGreaterThan(renderer.trianglesPerMachine);
    expect(renderer.trianglesOf(ENEMY_KIND.armored)).toBeLessThan(2000);
    expect(renderer.trianglesOf(ENEMY_KIND.armored) * 100).toBeLessThan(200_000);
  });

  it('are lit like the rest of the world, and cast a shadow that moves the same way', () => {
    const { mesh, registry } = setup();
    const material = mesh.material as ShaderMaterial;
    expect(material.uniforms.uShadowParams).toBe(registry.shadowParams);
    expect(material.uniforms.uKeyDir).toBeDefined();
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    expect(mesh.frustumCulled).toBe(false);
    const depth = mesh.customDepthMaterial as ShaderMaterial;
    expect(depth.vertexShader).toContain('poseVertex');
    expect(material.vertexShader).toContain('poseVertex');
  });

  it('give the materials back and leave the scene when they are done', () => {
    const { renderer, registry } = setup();
    const host = { children: [] as unknown[] };
    renderer.update(0.016, [pose(1)]);
    const materials = Reflect.get(registry, 'materials') as Set<unknown>;
    // One material for each kind: they differ in color.
    expect(materials.size).toBe(2);
    renderer.dispose();
    expect(materials.size).toBe(0);
    expect(renderer.object.children).toHaveLength(0);
    expect(host.children).toHaveLength(0);
    expect(renderer.list()).toEqual([]);
  });
});
