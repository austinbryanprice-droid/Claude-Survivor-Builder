import { Box3, Group, Vector3, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { MODULE, moduleShape, packState } from '../../src/shared/blocks';
import { lampSource } from '../../src/world/render/lamp-source';
import { LAMP_HEIGHT, LAMP_TILT } from '../../src/world/render/module-models';
import { ModuleRenderer } from '../../src/world/render/module-render';
import { createWorld } from '../../src/world/voxels/world';
import { createTestRegistry } from './helpers/registry';
import { TEST_SEED, terrain } from './helpers/valley';

const FACINGS = [0, 1, 2, 3] as const;
const UP = new Vector3(0, 1, 0);

/** Which way a facing looks across the ground, as (x, z): the first, then a quarter turn each. */
const across = (facing: number): Vector3 =>
  new Vector3(
    Math.round(Math.cos((facing * Math.PI) / 2)),
    0,
    Math.round(Math.sin((facing * Math.PI) / 2)),
  );

/** A Light drawn by the module renderer in a cell, the way the game draws one, and the lamp the watcher would hand the stage for it. */
function drawn(facing: number) {
  const world = createWorld(TEST_SEED, terrain());
  const renderer = new ModuleRenderer(new Group(), createTestRegistry(), world);
  const x = 8;
  const z = -4;
  const y = Math.floor(world.terrain.grid.groundAt(8.5, -3.5));
  world.setBlock(x, y, z, packState(moduleShape(MODULE.light, facing), 1));
  const group = renderer.at(x, y, z) as Group;
  group.updateMatrixWorld(true);
  const lens = group.children.find((child) => child.userData.look === 'lamp') as Mesh;
  const source = lampSource(x, y, z, facing);
  return {
    cell: { x, y, z },
    lens,
    source,
    from: new Vector3(source.x, source.y, source.z),
    aim: new Vector3(source.ax, source.ay, source.az),
  };
}

/** The vertices of the lens as the scene has them, in meters. */
function lensPoints(lens: Mesh): Vector3[] {
  const position = lens.geometry.getAttribute('position');
  return Array.from({ length: position.count }, (_, i) =>
    lens.localToWorld(new Vector3().fromBufferAttribute(position, i)),
  );
}

describe('where a Light’s lamp is', () => {
  it('leaves a little in front of the middle of the lens that is drawn, and on its axis', () => {
    for (const facing of FACINGS) {
      const { lens, from, aim } = drawn(facing);
      const middle = new Box3().setFromObject(lens).getCenter(new Vector3());
      const step = from.clone().sub(middle);
      expect(step.dot(aim), `facing ${facing}`).toBeCloseTo(0.05, 3);
      const aside = step.clone().addScaledVector(aim, -step.dot(aim));
      expect(aside.length(), `facing ${facing}`).toBeLessThan(1e-6);
    }
  });

  it('is clear of the lens, so that the housing does not light itself from inside', () => {
    for (const facing of FACINGS) {
      const { lens, from, aim } = drawn(facing);
      const points = lensPoints(lens);
      expect(points.length).toBeGreaterThan(0);
      for (const point of points) {
        expect(point.clone().sub(from).dot(aim), `facing ${facing}`).toBeLessThan(0);
      }
    }
  });

  it('is aimed square out of the big face of the lens, a unit step', () => {
    for (const facing of FACINGS) {
      const { lens, aim } = drawn(facing);
      expect(aim.length()).toBeCloseTo(1, 9);
      const normal = lens.geometry.getAttribute('normal');
      const face = new Vector3();
      for (let i = 0; i < normal.count; i++) {
        const n = new Vector3().fromBufferAttribute(normal, i).transformDirection(lens.matrixWorld);
        if (n.dot(across(facing)) > 0.5) face.add(n);
      }
      expect(face.length()).toBeGreaterThan(0);
      expect(face.normalize().dot(aim), `facing ${facing}`).toBeCloseTo(1, 6);
    }
  });

  it('looks the way the Light faces, down by the lean of its head', () => {
    for (const facing of FACINGS) {
      const { aim } = drawn(facing);
      const side = across(facing);
      expect(aim.x, `facing ${facing}`).toBeCloseTo(side.x * Math.cos(LAMP_TILT), 9);
      expect(aim.z, `facing ${facing}`).toBeCloseTo(side.z * Math.cos(LAMP_TILT), 9);
      expect(aim.y).toBeCloseTo(-Math.sin(LAMP_TILT), 9);
    }
    // Below level, but a floodlight and not a spotlight at the ground.
    expect(LAMP_TILT).toBeGreaterThan(0.1);
    expect(LAMP_TILT).toBeLessThan(0.5);
  });

  it('stays inside the Light’s own cell, high on the mast', () => {
    for (const facing of FACINGS) {
      const { cell, source } = drawn(facing);
      expect(source.x).toBeGreaterThan(cell.x);
      expect(source.x).toBeLessThan(cell.x + 1);
      expect(source.z).toBeGreaterThan(cell.z);
      expect(source.z).toBeLessThan(cell.z + 1);
      expect(source.y).toBeGreaterThan(cell.y + LAMP_HEIGHT - 0.2);
      expect(source.y).toBeLessThan(cell.y + LAMP_HEIGHT);
    }
  });

  it('turns by quarter turns as the Light does, about the middle of its cell', () => {
    const base = drawn(0);
    const middle = new Vector3(base.cell.x + 0.5, 0, base.cell.z + 0.5);
    const first = base.from.clone().sub(middle);
    for (const facing of FACINGS) {
      const { cell, from, aim } = drawn(facing);
      const turn = -(facing * Math.PI) / 2;
      const there = new Vector3(from.x - (cell.x + 0.5), from.y, from.z - (cell.z + 0.5));
      const expected = first.clone().setY(0).applyAxisAngle(UP, turn).setY(first.y);
      expect(there.distanceTo(expected), `facing ${facing}`).toBeLessThan(1e-9);
      expect(aim.distanceTo(base.aim.clone().applyAxisAngle(UP, turn))).toBeLessThan(1e-9);
    }
  });

  it('reads only the low two bits of a facing, as a module’s shape does', () => {
    const wrapped = lampSource(3, 7, -2, 5);
    const plain = lampSource(3, 7, -2, 1);
    expect(wrapped).toEqual(plain);
  });

  it('moves with its cell and with nothing else', () => {
    const here = lampSource(0, 0, 0, 2);
    const there = lampSource(10, 4, -6, 2);
    expect(there.x - here.x).toBeCloseTo(10, 9);
    expect(there.y - here.y).toBeCloseTo(4, 9);
    expect(there.z - here.z).toBeCloseTo(-6, 9);
    expect([there.ax, there.ay, there.az]).toEqual([here.ax, here.ay, here.az]);
  });
});
