import { Euler, Group, Mesh, Vector3, type Color, type ShaderMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  MODULE,
  MODULE_FACINGS,
  MATERIAL,
  SHAPE,
  moduleShape,
  packState,
} from '../../src/shared/blocks';
import { createWorld, type VoxelWorld } from '../../src/world/voxels/world';
import { MODULE_LOOK_NAMES } from '../../src/world/render/module-models';
import { ModuleRenderer } from '../../src/world/render/module-render';
import { createTestRegistry } from './helpers/registry';
import { TEST_SEED, terrain } from './helpers/valley';

const terminal = (facing: number) => packState(moduleShape(MODULE.terminal, facing), 1);

/** A world with the cell where the tests build, and a renderer drawing it. */
function build() {
  const world: VoxelWorld = createWorld(TEST_SEED, terrain());
  const registry = createTestRegistry();
  const parent = new Group();
  const renderer = new ModuleRenderer(parent, registry, world);
  const y = Math.floor(world.terrain.grid.groundAt(8.5, -3.5));
  return { world, registry, parent, renderer, cell: { x: 8, y, z: -4 } };
}

const meshesOf = (group: Group): Mesh[] =>
  group.children.filter((child): child is Mesh => child instanceof Mesh);

const glowOf = (mesh: Mesh): Color =>
  (mesh.material as ShaderMaterial).uniforms.uGlow?.value as Color;

const brightness = (color: Color): number => color.r + color.g + color.b;

describe('the modules as they are drawn', () => {
  it('draw nothing in a world with none, and hang their group from the parent they are given', () => {
    const { renderer, parent, world, cell } = build();
    expect(renderer.count).toBe(0);
    expect(parent.children).toEqual([renderer.object]);
    expect(renderer.object.name).toBe('modules');
    expect(renderer.object.children).toHaveLength(0);
    // A block is the mesher's, not theirs.
    world.setBlock(cell.x, cell.y, cell.z, packState(SHAPE.cube, MATERIAL.scrap));
    expect(renderer.count).toBe(0);
  });

  it('stand a module on the floor of its cell, in the middle, one mesh for each look', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, terminal(0));
    expect(renderer.count).toBe(1);
    const group = renderer.at(cell.x, cell.y, cell.z) as Group;
    expect(group.name).toBe('module');
    expect(group.position.toArray()).toEqual([cell.x + 0.5, cell.y, cell.z + 0.5]);
    expect(group.userData).toEqual({ module: MODULE.terminal, level: 1 });
    const meshes = meshesOf(group);
    expect(meshes).toHaveLength(MODULE_LOOK_NAMES.length);
    expect(meshes.every((mesh) => mesh.castShadow && mesh.receiveShadow)).toBe(true);
    expect(renderer.object.children).toEqual([group]);
  });

  it('turn the model so its front looks the way the module faces', () => {
    const { renderer, world, cell } = build();
    const fronts = [
      [1, 0, 0],
      [0, 0, 1],
      [-1, 0, 0],
      [0, 0, -1],
    ];
    for (let facing = 0; facing < MODULE_FACINGS; facing++) {
      world.setBlock(cell.x, cell.y, cell.z, 0);
      world.setBlock(cell.x, cell.y, cell.z, terminal(facing));
      const group = renderer.at(cell.x, cell.y, cell.z) as Group;
      // The model's front is +x; where the group puts it is the way the module faces.
      const front = new Vector3(1, 0, 0).applyEuler(new Euler().copy(group.rotation));
      const want = fronts[facing] as number[];
      expect(front.x, `facing ${facing}`).toBeCloseTo(want[0] as number, 9);
      expect(front.z, `facing ${facing}`).toBeCloseTo(want[2] as number, 9);
    }
  });

  it('draw the module again when it is turned, in place of the old one', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, terminal(0));
    const first = renderer.at(cell.x, cell.y, cell.z) as Group;
    world.setBlock(cell.x, cell.y, cell.z, terminal(2));
    const second = renderer.at(cell.x, cell.y, cell.z) as Group;
    expect(second).not.toBe(first);
    expect(first.parent).toBeNull();
    expect(renderer.count).toBe(1);
    expect(renderer.object.children).toEqual([second]);
  });

  it('take a module away when it is broken', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, terminal(0));
    const group = renderer.at(cell.x, cell.y, cell.z) as Group;
    world.setBlock(cell.x, cell.y, cell.z, 0);
    expect(renderer.count).toBe(0);
    expect(renderer.at(cell.x, cell.y, cell.z)).toBeUndefined();
    expect(group.parent).toBeNull();
    // A module replaced by a block is gone as well.
    world.setBlock(cell.x, cell.y, cell.z, terminal(1));
    world.setBlock(cell.x, cell.y, cell.z, packState(SHAPE.cube, MATERIAL.scrap));
    expect(renderer.count).toBe(0);
  });

  it('draw the modules that already stand when they are made, as a late joiner meets them', () => {
    const world = createWorld(TEST_SEED, terrain());
    const y = Math.floor(world.terrain.grid.groundAt(8.5, -3.5));
    world.setBlock(8, y, -4, terminal(1));
    world.setBlock(10, y, -4, terminal(3));
    const renderer = new ModuleRenderer(new Group(), createTestRegistry(), world);
    expect(renderer.count).toBe(2);
    expect(renderer.at(8, y, -4)).toBeDefined();
    expect(renderer.at(10, y, -4)).toBeDefined();
  });

  it('share one model and one set of materials between every module of a kind', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, terminal(0));
    world.setBlock(cell.x + 2, cell.y, cell.z, terminal(2));
    const a = meshesOf(renderer.at(cell.x, cell.y, cell.z) as Group);
    const b = meshesOf(renderer.at(cell.x + 2, cell.y, cell.z) as Group);
    expect(a).toHaveLength(b.length);
    a.forEach((mesh, i) => {
      expect(mesh.geometry).toBe(b[i]?.geometry);
      expect(mesh.material).toBe(b[i]?.material);
    });
  });
});

describe('the lights of a module', () => {
  it('shimmer on the screens and breathe on the strips with the stage’s clock', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, terminal(0));
    const screen = meshesOf(renderer.at(cell.x, cell.y, cell.z) as Group)[
      MODULE_LOOK_NAMES.indexOf('screen')
    ] as Mesh;
    expect(screen).toBeDefined();
    const seen = new Set<number>();
    for (const time of [0, 0.4, 0.9, 1.7, 2.6]) {
      renderer.update(time);
      for (const mesh of meshesOf(renderer.at(cell.x, cell.y, cell.z) as Group)) {
        expect(brightness(glowOf(mesh))).toBeGreaterThanOrEqual(0);
      }
      seen.add(Math.round(brightness(glowOf(screen)) * 1000));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('are the same at the same time, so a frozen page gives the same picture twice', () => {
    const a = build();
    const b = build();
    for (const made of [a, b]) {
      made.world.setBlock(made.cell.x, made.cell.y, made.cell.z, terminal(0));
      made.renderer.update(3.1);
    }
    const glows = (made: ReturnType<typeof build>) =>
      meshesOf(made.renderer.at(made.cell.x, made.cell.y, made.cell.z) as Group).map((mesh) =>
        glowOf(mesh).toArray(),
      );
    expect(glows(a)).toEqual(glows(b));
  });

  it('blink the beacon: bright for a moment, then dim', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, terminal(0));
    const meshes = meshesOf(renderer.at(cell.x, cell.y, cell.z) as Group);
    const beacon = meshes[MODULE_LOOK_NAMES.indexOf('beacon')] as Mesh;
    renderer.update(0.1);
    const on = brightness(glowOf(beacon));
    renderer.update(1.2);
    const off = brightness(glowOf(beacon));
    expect(on).toBeGreaterThan(off * 3);
    renderer.update(2.3);
    expect(brightness(glowOf(beacon))).toBeCloseTo(on, 9);
  });
});

describe('putting the modules away', () => {
  it('takes them out of the scene and gives the materials back, and stops listening', () => {
    const { renderer, parent, registry, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, terminal(0));
    const group = renderer.at(cell.x, cell.y, cell.z) as Group;
    const release = vi.spyOn(registry, 'release');
    renderer.dispose();
    expect(parent.children).toHaveLength(0);
    expect(group.parent).toBeNull();
    expect(release).toHaveBeenCalledTimes(MODULE_LOOK_NAMES.length);
    // A module placed after that is nobody's to draw.
    world.setBlock(cell.x + 3, cell.y, cell.z, terminal(0));
    expect(renderer.count).toBe(0);
    expect(parent.children).toHaveLength(0);
  });
});
