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
import { TURRET_GUN, turretMuzzle } from '../../src/shared/turret';
import { createWorld, type VoxelWorld } from '../../src/world/voxels/world';
import { MODULE_LOOK_NAMES } from '../../src/world/render/module-models';
import { ModuleRenderer } from '../../src/world/render/module-render';
import { createTestRegistry } from './helpers/registry';
import { TEST_SEED, terrain } from './helpers/valley';

const terminal = (facing: number) => packState(moduleShape(MODULE.terminal, facing), 1);
const turret = (facing: number) => packState(moduleShape(MODULE.turret, facing), 1);

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

describe('the head of a turret', () => {
  const headOf = (group: Group): Group => group.getObjectByName('head') as Group;

  /** Where the tip of the barrel is in the world, with the head turned as it is. */
  function tip(renderer: ModuleRenderer, group: Group): Vector3 {
    renderer.object.updateWorldMatrix(true, true);
    return headOf(group).localToWorld(new Vector3(TURRET_GUN.reach, 0, 0));
  }

  it('hangs in the turret’s group at the pivot, on a mesh for each look it has', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, turret(0));
    const group = renderer.at(cell.x, cell.y, cell.z) as Group;
    expect(group.userData).toEqual({ module: MODULE.turret, level: 1 });
    // The body is three meshes and the head a group of four.
    expect(meshesOf(group)).toHaveLength(3);
    const head = headOf(group);
    expect(head).toBeDefined();
    expect(head.parent).toBe(group);
    expect(head.position.toArray()).toEqual([0, TURRET_GUN.pivot, 0]);
    expect(meshesOf(head)).toHaveLength(4);
    expect(head.rotation.order).toBe('YZX');
    expect(head.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(meshesOf(head).every((mesh) => mesh.castShadow && mesh.receiveShadow)).toBe(true);
  });

  it('is at rest pointing the way the turret faces', () => {
    const { renderer, world, cell } = build();
    const ahead = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ];
    for (let facing = 0; facing < MODULE_FACINGS; facing++) {
      world.setBlock(cell.x, cell.y, cell.z, 0);
      world.setBlock(cell.x, cell.y, cell.z, turret(facing));
      const at = tip(renderer, renderer.at(cell.x, cell.y, cell.z) as Group);
      const [dx, dz] = ahead[facing] as number[];
      expect(at.x - (cell.x + 0.5), `facing ${facing}`).toBeCloseTo(
        (dx as number) * TURRET_GUN.reach,
        9,
      );
      expect(at.y - cell.y, `facing ${facing}`).toBeCloseTo(TURRET_GUN.pivot, 9);
      expect(at.z - (cell.z + 0.5), `facing ${facing}`).toBeCloseTo(
        (dz as number) * TURRET_GUN.reach,
        9,
      );
    }
  });

  it('turns to point its barrel where the shared gun geometry says a bolt leaves, from any facing', () => {
    const { renderer, world, cell } = build();
    const targets: readonly (readonly [number, number, number])[] = [
      [14, 2, 0],
      [3, 1, 0],
      [-6, 4, 9],
      [8, 12, -30],
      [8.5, 0.2, -25],
      [20, 3, 20],
      [-2, 7, -4],
    ];
    const muzzle = { x: 0, y: 0, z: 0 };
    for (let facing = 0; facing < MODULE_FACINGS; facing++) {
      world.setBlock(cell.x, cell.y, cell.z, 0);
      world.setBlock(cell.x, cell.y, cell.z, turret(facing));
      const group = renderer.at(cell.x, cell.y, cell.z) as Group;
      for (const [tx, ty, tz] of targets) {
        const aimed = renderer.aim(cell.x, cell.y, cell.z, tx, cell.y + ty, tz);
        expect(aimed).toBe(true);
        turretMuzzle(cell.x, cell.y, cell.z, tx, cell.y + ty, tz, muzzle);
        const at = tip(renderer, group);
        expect(at.x, `facing ${facing} at ${tx},${ty},${tz}`).toBeCloseTo(muzzle.x, 6);
        expect(at.y, `facing ${facing} at ${tx},${ty},${tz}`).toBeCloseTo(muzzle.y, 6);
        expect(at.z, `facing ${facing} at ${tx},${ty},${tz}`).toBeCloseTo(muzzle.z, 6);
      }
    }
  });

  it('keeps the heading it was given until it is aimed again, and does not roll', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, turret(0));
    const group = renderer.at(cell.x, cell.y, cell.z) as Group;
    renderer.aim(cell.x, cell.y, cell.z, cell.x + 0.5, cell.y + TURRET_GUN.pivot, cell.z - 9);
    const head = headOf(group);
    const turned = head.rotation.toArray().slice(0, 3);
    renderer.update(1.7);
    renderer.update(4.2);
    expect(head.rotation.toArray().slice(0, 3)).toEqual(turned);
    expect(head.rotation.x).toBe(0);
    // A target level with the pivot is a heading and no lift.
    expect(head.rotation.z).toBeCloseTo(0, 9);
    // Aimed straight up it lifts a quarter turn and keeps its heading.
    renderer.aim(cell.x, cell.y, cell.z, cell.x + 0.5, cell.y + TURRET_GUN.pivot + 9, cell.z + 0.5);
    expect(head.rotation.z).toBeCloseTo(Math.PI / 2, 9);
    expect(head.rotation.y).toBeCloseTo(turned[1] as number, 9);
  });

  it('is at rest again when the cell is drawn again, as when it is turned by hand', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, turret(0));
    renderer.aim(cell.x, cell.y, cell.z, cell.x + 9, cell.y + 5, cell.z + 4);
    world.setBlock(cell.x, cell.y, cell.z, turret(1));
    const head = headOf(renderer.at(cell.x, cell.y, cell.z) as Group);
    expect(head.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('is not aimed where there is nothing to turn: no module, a module with no head, or no direction', () => {
    const { renderer, world, cell } = build();
    expect(renderer.aim(cell.x, cell.y, cell.z, cell.x + 5, cell.y, cell.z)).toBe(false);
    world.setBlock(cell.x, cell.y, cell.z, terminal(0));
    expect(renderer.aim(cell.x, cell.y, cell.z, cell.x + 5, cell.y, cell.z)).toBe(false);
    world.setBlock(cell.x + 2, cell.y, cell.z, turret(0));
    const pivot = [cell.x + 2.5, cell.y + TURRET_GUN.pivot, cell.z + 0.5] as const;
    expect(renderer.aim(cell.x + 2, cell.y, cell.z, ...pivot)).toBe(false);
    expect(renderer.aim(cell.x + 2, cell.y, cell.z, pivot[0] + 3, pivot[1], pivot[2])).toBe(true);
  });

  it('shares one model and one set of materials between turrets, head and all', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, turret(0));
    world.setBlock(cell.x + 2, cell.y, cell.z, turret(3));
    const a = renderer.at(cell.x, cell.y, cell.z) as Group;
    const b = renderer.at(cell.x + 2, cell.y, cell.z) as Group;
    const pairs = [
      [meshesOf(a), meshesOf(b)],
      [meshesOf(headOf(a)), meshesOf(headOf(b))],
    ] as const;
    for (const [first, second] of pairs) {
      expect(first).toHaveLength(second.length);
      first.forEach((mesh, i) => {
        expect(mesh.geometry).toBe(second[i]?.geometry);
        expect(mesh.material).toBe(second[i]?.material);
      });
    }
    // The head turns on its own: the other turret's stays where it was.
    renderer.aim(cell.x, cell.y, cell.z, cell.x + 6, cell.y + 3, cell.z + 6);
    expect(headOf(b).rotation.y).toBe(0);
  });

  it('is put away with the rest: its geometry is freed and its group leaves the scene', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, turret(0));
    const group = renderer.at(cell.x, cell.y, cell.z) as Group;
    const geometries = [...meshesOf(group), ...meshesOf(headOf(group))].map(
      (mesh) => mesh.geometry,
    );
    const freed = geometries.map((geometry) => vi.spyOn(geometry, 'dispose'));
    renderer.dispose();
    expect(geometries).toHaveLength(7);
    for (const spy of freed) expect(spy).toHaveBeenCalledTimes(1);
    expect(group.parent).toBeNull();
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
