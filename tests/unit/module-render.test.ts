import { Color, Euler, Group, Mesh, Vector3, type Object3D, type ShaderMaterial } from 'three';
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
import {
  MODULE_LOOKS,
  MODULE_LOOK_NAMES,
  modulePalette,
  type ModuleLook,
} from '../../src/world/render/module-models';
import { DIM_GLOW, ModuleRenderer } from '../../src/world/render/module-render';
import { createTestRegistry } from './helpers/registry';
import { TEST_SEED, terrain } from './helpers/valley';

const terminal = (facing: number) => packState(moduleShape(MODULE.terminal, facing), 1);
/** A turret's cell state: its level is the cell's material byte. */
const turret = (facing: number, level = 1) => packState(moduleShape(MODULE.turret, facing), level);
const generator = (facing: number) => packState(moduleShape(MODULE.generator, facing), 1);
const node = (facing: number) => packState(moduleShape(MODULE.node, facing), 1);

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

describe('a Generator as it is drawn', () => {
  it('stands on the floor of its cell with a mesh for each look, and no head to turn', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, generator(0));
    const group = renderer.at(cell.x, cell.y, cell.z) as Group;
    expect(group.userData).toEqual({ module: MODULE.generator, level: 1 });
    expect(group.position.toArray()).toEqual([cell.x + 0.5, cell.y, cell.z + 0.5]);
    expect(meshesOf(group)).toHaveLength(MODULE_LOOK_NAMES.length);
    expect(group.getObjectByName('head')).toBeUndefined();
    expect(renderer.aim(cell.x, cell.y, cell.z, cell.x + 5, cell.y + 1, cell.z)).toBe(false);
  });

  it('turns so its front looks the way it faces', () => {
    const { renderer, world, cell } = build();
    const fronts = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ];
    for (let facing = 0; facing < MODULE_FACINGS; facing++) {
      world.setBlock(cell.x, cell.y, cell.z, 0);
      world.setBlock(cell.x, cell.y, cell.z, generator(facing));
      const group = renderer.at(cell.x, cell.y, cell.z) as Group;
      const front = new Vector3(1, 0, 0).applyEuler(new Euler().copy(group.rotation));
      expect(front.x, `facing ${facing}`).toBeCloseTo(fronts[facing]?.[0] as number, 9);
      expect(front.z, `facing ${facing}`).toBeCloseTo(fronts[facing]?.[1] as number, 9);
    }
  });

  it('wears the Core’s paint, the same materials as a Terminal and a turret, and shares its model with other Generators', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, generator(0));
    world.setBlock(cell.x + 2, cell.y, cell.z, generator(2));
    world.setBlock(cell.x + 4, cell.y, cell.z, terminal(0));
    const [a, b, t] = [0, 2, 4].map((dx) =>
      meshesOf(renderer.at(cell.x + dx, cell.y, cell.z) as Group),
    );
    expect(a).toHaveLength(b?.length as number);
    a?.forEach((mesh, i) => {
      expect(mesh.geometry).toBe(b?.[i]?.geometry);
      expect(mesh.material).toBe(b?.[i]?.material);
    });
    // The Terminal has a mesh for every look too, so the nth mesh of each is the same look and the same material.
    a?.forEach((mesh, i) => expect(mesh.material).toBe(t?.[i]?.material));
    expect(renderer.object.children).toHaveLength(3);
  });

  it('is drawn when it is placed and gone when it is broken', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, generator(1));
    expect(renderer.count).toBe(1);
    world.setBlock(cell.x, cell.y, cell.z, 0);
    expect(renderer.count).toBe(0);
    expect(renderer.at(cell.x, cell.y, cell.z)).toBeUndefined();
  });
});

const headOf = (group: Group): Group => group.getObjectByName('head') as Group;

/** The meshes of a turret: its body and its head. */
const partsOf = (group: Group): Mesh[] => [...meshesOf(group), ...meshesOf(headOf(group))];

/** Where the tip of the barrel is in the world, with the head turned as it is. */
function tip(renderer: ModuleRenderer, group: Group): Vector3 {
  renderer.object.updateWorldMatrix(true, true);
  return headOf(group).localToWorld(new Vector3(TURRET_GUN.reach, 0, 0));
}

describe('the head of a turret', () => {
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

describe('a turret raised to a better grade', () => {
  it('is drawn again at each level it is raised to, with that level’s model, in place of the old one', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, turret(1));
    const drawn = [renderer.at(cell.x, cell.y, cell.z) as Group];
    for (const level of [2, 3]) {
      const before = drawn[drawn.length - 1] as Group;
      world.setBlock(cell.x, cell.y, cell.z, turret(1, level));
      const group = renderer.at(cell.x, cell.y, cell.z) as Group;
      expect(group).not.toBe(before);
      expect(before.parent).toBeNull();
      expect(group.userData).toEqual({ module: MODULE.turret, level });
      expect(renderer.count).toBe(1);
      expect(renderer.object.children).toEqual([group]);
      // It faces the way it did, and its head is at rest again.
      expect(group.rotation.y).toBe(before.rotation.y);
      expect(headOf(group).rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
      drawn.push(group);
    }
    // Each level is a gun of its own: no mesh of the three shares its geometry with another.
    const geometries = drawn.flatMap((group) => partsOf(group).map((mesh) => mesh.geometry));
    expect(new Set(geometries).size).toBe(geometries.length);
  });

  it('shares a model and a set of materials between the turrets of a level, and not between levels', () => {
    const { renderer, world, cell } = build();
    // Two turrets at each level, side by side, and a Terminal to the west of them.
    [1, 1, 2, 2, 3, 3].forEach((level, i) =>
      world.setBlock(cell.x + 2 * i, cell.y, cell.z, turret(0, level)),
    );
    world.setBlock(cell.x - 2, cell.y, cell.z, terminal(0));
    const at = (i: number) => partsOf(renderer.at(cell.x + 2 * i, cell.y, cell.z) as Group);
    for (const [a, b] of [
      [0, 1],
      [2, 3],
      [4, 5],
    ] as const) {
      const first = at(a);
      const second = at(b);
      expect(first).toHaveLength(second.length);
      first.forEach((mesh, i) => {
        expect(mesh.geometry).toBe(second[i]?.geometry);
        expect(mesh.material).toBe(second[i]?.material);
      });
    }
    const levels = [at(0), at(2), at(4)];
    const shared = (a: number, b: number, of: 'geometry' | 'material') => {
      const these = new Set((levels[a] as Mesh[]).map((mesh) => mesh[of]));
      return (levels[b] as Mesh[]).some((mesh) => these.has(mesh[of]));
    };
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      expect(shared(a, b, 'geometry'), `levels ${a + 1} and ${b + 1}`).toBe(false);
      expect(shared(a, b, 'material'), `levels ${a + 1} and ${b + 1}`).toBe(false);
    }
    // The Basic Turret is painted as the Terminal is, in the Core's palette; the better grades are not.
    const plate = (parts: Mesh[]) => (parts[0] as Mesh).material;
    const terminalPlate = (meshesOf(renderer.at(cell.x - 2, cell.y, cell.z) as Group)[0] as Mesh)
      .material;
    expect(plate(levels[0] as Mesh[])).toBe(terminalPlate);
    expect(plate(levels[1] as Mesh[])).not.toBe(terminalPlate);
    expect(plate(levels[2] as Mesh[])).not.toBe(terminalPlate);
  });

  it('has the same meshes at each level but one: the Heavy Turret’s body shows amber, which the others’ do not', () => {
    const { renderer, world, cell } = build();
    const counts = [1, 2, 3].map((level) => {
      world.setBlock(cell.x, cell.y, cell.z, turret(0, level));
      const group = renderer.at(cell.x, cell.y, cell.z) as Group;
      return [meshesOf(group).length, meshesOf(headOf(group)).length];
    });
    expect(counts).toEqual([
      [3, 4],
      [3, 4],
      [4, 4],
    ]);
  });

  it.each([2, 3])(
    'points the barrel of level %i where the shared gun geometry says a bolt leaves, from any facing',
    (level) => {
      const { renderer, world, cell } = build();
      const muzzle = { x: 0, y: 0, z: 0 };
      for (let facing = 0; facing < MODULE_FACINGS; facing++) {
        world.setBlock(cell.x, cell.y, cell.z, 0);
        world.setBlock(cell.x, cell.y, cell.z, turret(facing, level));
        const group = renderer.at(cell.x, cell.y, cell.z) as Group;
        for (const [tx, ty, tz] of [
          [14, 2, 0],
          [-6, 4, 9],
          [8, 12, -30],
        ] as const) {
          expect(renderer.aim(cell.x, cell.y, cell.z, tx, cell.y + ty, tz)).toBe(true);
          turretMuzzle(cell.x, cell.y, cell.z, tx, cell.y + ty, tz, muzzle);
          const at = tip(renderer, group);
          expect(at.x, `facing ${facing} at ${tx},${ty},${tz}`).toBeCloseTo(muzzle.x, 6);
          expect(at.y, `facing ${facing} at ${tx},${ty},${tz}`).toBeCloseTo(muzzle.y, 6);
          expect(at.z, `facing ${facing} at ${tx},${ty},${tz}`).toBeCloseTo(muzzle.z, 6);
        }
      }
    },
  );

  it('is put away with the rest: every level’s geometry is freed, and so is every paint', () => {
    const { renderer, registry, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, turret(0, 1));
    world.setBlock(cell.x + 2, cell.y, cell.z, turret(0, 2));
    world.setBlock(cell.x + 4, cell.y, cell.z, turret(0, 3));
    const geometries = [0, 2, 4].flatMap((dx) =>
      partsOf(renderer.at(cell.x + dx, cell.y, cell.z) as Group).map((mesh) => mesh.geometry),
    );
    const freed = geometries.map((geometry) => vi.spyOn(geometry, 'dispose'));
    const release = vi.spyOn(registry, 'release');
    renderer.dispose();
    expect(geometries).toHaveLength(7 + 7 + 8);
    for (const spy of freed) expect(spy).toHaveBeenCalledTimes(1);
    // The Core's paint, made when the renderer was, and one for each grade drawn since.
    expect(release).toHaveBeenCalledTimes(3 * MODULE_LOOK_NAMES.length);
  });
});

describe('the lights of a module', () => {
  it('start a paint made late where the others are, so that a raised turret does not flash its base glow', () => {
    const { renderer, world, cell } = build();
    renderer.update(1.2);
    world.setBlock(cell.x, cell.y, cell.z, turret(0, 3));
    const parts = partsOf(renderer.at(cell.x, cell.y, cell.z) as Group);
    const made = parts.map((mesh) => glowOf(mesh).toArray());
    renderer.update(1.2);
    expect(parts.map((mesh) => glowOf(mesh).toArray())).toEqual(made);
  });

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

/** Every mesh in a module's group, its head's among them, with the look it is of. */
function lookedMeshes(group: Group): { mesh: Mesh; look: ModuleLook }[] {
  const found: { mesh: Mesh; look: ModuleLook }[] = [];
  group.traverse((object: Object3D) => {
    const look = object.userData.look as ModuleLook | undefined;
    if (object instanceof Mesh && look !== undefined) found.push({ mesh: object, look });
  });
  return found;
}

describe('a module without power', () => {
  const glows = (look: ModuleLook) => MODULE_LOOKS[look].glow !== undefined;

  it('burns its glowing looks low and leaves its plates and trim as they are', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, node(0));
    const group = renderer.at(cell.x, cell.y, cell.z) as Group;
    const lit = lookedMeshes(group).map(({ mesh }) => mesh.material);
    expect(renderer.isPowered(cell.x, cell.y, cell.z)).toBe(true);
    expect(renderer.setPowered(cell.x, cell.y, cell.z, false)).toBe(true);
    expect(renderer.isPowered(cell.x, cell.y, cell.z)).toBe(false);
    lookedMeshes(group).forEach(({ mesh, look }, i) => {
      if (!glows(look)) {
        expect(mesh.material, look).toBe(lit[i]);
        return;
      }
      expect(mesh.material, look).not.toBe(lit[i]);
      const spec = MODULE_LOOKS[look];
      const want = new Color(spec.glow).multiplyScalar((spec.glowIntensity ?? 1) * DIM_GLOW);
      expect(glowOf(mesh).toArray(), look).toEqual(want.toArray());
    });
  });

  it('still reads as a module: dim is on standby, not out', () => {
    expect(DIM_GLOW).toBeGreaterThan(0.05);
    expect(DIM_GLOW).toBeLessThan(0.5);
  });

  it('gets its lights back with the very materials it had', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, node(1));
    const group = renderer.at(cell.x, cell.y, cell.z) as Group;
    const lit = lookedMeshes(group).map(({ mesh }) => mesh.material);
    renderer.setPowered(cell.x, cell.y, cell.z, false);
    expect(renderer.setPowered(cell.x, cell.y, cell.z, true)).toBe(true);
    expect(renderer.isPowered(cell.x, cell.y, cell.z)).toBe(true);
    expect(lookedMeshes(group).map(({ mesh }) => mesh.material)).toEqual(lit);
  });

  it('says whether anything changed: nothing does when the lights are as asked, or no module stands there', () => {
    const { renderer, world, cell } = build();
    expect(renderer.setPowered(cell.x, cell.y, cell.z, false)).toBe(false);
    expect(renderer.isPowered(cell.x, cell.y, cell.z)).toBeNull();
    world.setBlock(cell.x, cell.y, cell.z, node(0));
    expect(renderer.setPowered(cell.x, cell.y, cell.z, true)).toBe(false);
    expect(renderer.setPowered(cell.x, cell.y, cell.z, false)).toBe(true);
    expect(renderer.setPowered(cell.x, cell.y, cell.z, false)).toBe(false);
    world.setBlock(cell.x, cell.y, cell.z, 0);
    expect(renderer.isPowered(cell.x, cell.y, cell.z)).toBeNull();
  });

  it('holds its dim lights still while the lit ones breathe', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, node(0));
    world.setBlock(cell.x + 2, cell.y, cell.z, node(0));
    renderer.setPowered(cell.x, cell.y, cell.z, false);
    const dim = lookedMeshes(renderer.at(cell.x, cell.y, cell.z) as Group).filter(({ look }) =>
      glows(look),
    );
    const lit = lookedMeshes(renderer.at(cell.x + 2, cell.y, cell.z) as Group).filter(({ look }) =>
      glows(look),
    );
    renderer.update(0.3);
    const dimAt = dim.map(({ mesh }) => glowOf(mesh).toArray());
    const litAt = lit.map(({ mesh }) => glowOf(mesh).toArray());
    renderer.update(1.9);
    expect(dim.map(({ mesh }) => glowOf(mesh).toArray())).toEqual(dimAt);
    expect(lit.map(({ mesh }) => glowOf(mesh).toArray())).not.toEqual(litAt);
  });

  it('is dimmer than the same module with power, in every look that glows', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, node(0));
    world.setBlock(cell.x + 2, cell.y, cell.z, node(0));
    renderer.setPowered(cell.x + 2, cell.y, cell.z, false);
    renderer.update(0.1);
    const lit = lookedMeshes(renderer.at(cell.x, cell.y, cell.z) as Group);
    const dim = lookedMeshes(renderer.at(cell.x + 2, cell.y, cell.z) as Group);
    lit.forEach(({ mesh, look }, i) => {
      if (!glows(look)) return;
      expect(brightness(glowOf(dim[i]?.mesh as Mesh)), look).toBeLessThan(brightness(glowOf(mesh)));
    });
  });

  it('shares one set of dim materials between the modules of a paint, and keeps another for each grade', () => {
    const { renderer, world, cell } = build();
    for (const [dx, state] of [
      [0, node(0)],
      [2, node(3)],
      [4, turret(0, 1)],
      [6, turret(0, 2)],
    ] as const) {
      world.setBlock(cell.x + dx, cell.y, cell.z, state);
      renderer.setPowered(cell.x + dx, cell.y, cell.z, false);
    }
    const dimOf = (dx: number, look: ModuleLook) =>
      lookedMeshes(renderer.at(cell.x + dx, cell.y, cell.z) as Group).find((m) => m.look === look)
        ?.mesh.material;
    // The Node, the Scrap turret: the Core's paint, one dim material for a look.
    expect(dimOf(0, 'screen')).toBe(dimOf(2, 'screen'));
    expect(dimOf(0, 'lights')).toBe(dimOf(4, 'lights'));
    // The Auto Turret is Composite, whose cyan is brighter: its own dim set.
    expect(modulePalette(MATERIAL.composite).lights).not.toBe(MODULE_LOOKS.lights);
    expect(dimOf(6, 'lights')).not.toBe(dimOf(0, 'lights'));
  });

  it('dims a turret’s head with the rest of it, and lights it again', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, turret(0, 1));
    const group = renderer.at(cell.x, cell.y, cell.z) as Group;
    const head = group.getObjectByName('head') as Group;
    const lit = lookedMeshes(head).map(({ mesh }) => mesh.material);
    renderer.setPowered(cell.x, cell.y, cell.z, false);
    lookedMeshes(head).forEach(({ mesh, look }, i) => {
      if (glows(look)) expect(mesh.material, look).not.toBe(lit[i]);
      else expect(mesh.material, look).toBe(lit[i]);
    });
    expect(lookedMeshes(head).some(({ look }) => glows(look))).toBe(true);
    renderer.setPowered(cell.x, cell.y, cell.z, true);
    expect(lookedMeshes(head).map(({ mesh }) => mesh.material)).toEqual(lit);
  });

  it('starts with its lights up when it is drawn again, as a raised turret is', () => {
    const { renderer, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, turret(0, 1));
    renderer.setPowered(cell.x, cell.y, cell.z, false);
    world.setBlock(cell.x + 2, cell.y, cell.z, turret(0, 2));
    world.setBlock(cell.x, cell.y, cell.z, turret(0, 2));
    expect(renderer.isPowered(cell.x, cell.y, cell.z)).toBe(true);
    // Its materials are the Auto Turret's own lit ones, as a turret that was never dim has.
    const redrawn = lookedMeshes(renderer.at(cell.x, cell.y, cell.z) as Group);
    const never = lookedMeshes(renderer.at(cell.x + 2, cell.y, cell.z) as Group);
    expect(redrawn.map(({ mesh }) => mesh.material)).toEqual(
      never.map(({ mesh }) => mesh.material),
    );
    expect(renderer.setPowered(cell.x, cell.y, cell.z, false)).toBe(true);
  });

  it('is given back with the rest: the dim materials are freed with the lit ones', () => {
    const { renderer, registry, world, cell } = build();
    world.setBlock(cell.x, cell.y, cell.z, node(0));
    renderer.setPowered(cell.x, cell.y, cell.z, false);
    const release = vi.spyOn(registry, 'release');
    renderer.dispose();
    expect(release).toHaveBeenCalledTimes(
      MODULE_LOOK_NAMES.length + MODULE_LOOK_NAMES.filter(glows).length,
    );
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
