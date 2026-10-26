import { Box3, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  MODULE,
  MODULES,
  MODULE_FACINGS,
  MODULE_FOOT,
  SHAPE,
  moduleShape,
} from '../../src/shared/blocks';
import {
  MODULE_LOOKS,
  MODULE_LOOK_NAMES,
  MODULE_SKIRT,
  buildModuleModel,
  moduleGhostGeometry,
  type ModuleModel,
} from '../../src/world/render/module-models';

function boundsOf(geometries: readonly BufferGeometry[]): Box3 {
  const box = new Box3();
  for (const geometry of geometries) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox as Box3);
  }
  return box;
}

const partsOf = (model: ModuleModel): BufferGeometry[] =>
  MODULE_LOOK_NAMES.flatMap((look) => model[look] ?? []);

/** The points of a geometry that satisfy a test, as vectors. */
function pointsWhere(geometry: BufferGeometry, keep: (point: Vector3) => boolean): Vector3[] {
  const position = geometry.getAttribute('position');
  const found: Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    const point = new Vector3().fromBufferAttribute(position, i);
    if (keep(point)) found.push(point);
  }
  return found;
}

function triangles(geometry: BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
}

describe('the Research Terminal model', () => {
  const model = buildModuleModel(MODULE.terminal) as ModuleModel;

  it('is made of one merged geometry for each look, and only looks the table defines', () => {
    expect(Object.keys(model).sort()).toEqual([...MODULE_LOOK_NAMES].sort());
    for (const look of MODULE_LOOK_NAMES) {
      const geometry = model[look] as BufferGeometry;
      expect(geometry.getAttribute('position').count, look).toBeGreaterThan(0);
      expect(geometry.getAttribute('normal').count, look).toBe(
        geometry.getAttribute('position').count,
      );
      expect(MODULE_LOOKS[look].color, look).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('has finite positions and unit normals', () => {
    for (const geometry of partsOf(model)) {
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      for (let i = 0; i < position.count; i++) {
        expect(Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i))).toBe(true);
        expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 3);
      }
    }
  });

  it('stays inside its cell, over the body the cursor aims at, with a foundation below the floor', () => {
    const box = boundsOf(partsOf(model));
    const [x0, , z0, x1, , z1] = MODULES.find((def) => def.id === MODULE.terminal)!.body;
    // The cell's middle is the origin; the body lies 0.1 in from each edge, and trim may stand a hair proud of it.
    const slack = 0.02;
    expect(box.min.x).toBeGreaterThanOrEqual(x0 - 0.5 - slack);
    expect(box.max.x).toBeLessThanOrEqual(x1 - 0.5 + slack);
    expect(box.min.z).toBeGreaterThanOrEqual(z0 - 0.5 - slack);
    expect(box.max.z).toBeLessThanOrEqual(z1 - 0.5 + slack);
    expect(box.min.y).toBeGreaterThanOrEqual(-MODULE_SKIRT - 1e-6);
    expect(box.max.y).toBeLessThanOrEqual(1);
  });

  it('has a foundation that reaches farther down than the world lets a module float, and not through a block', () => {
    const box = boundsOf(partsOf(model));
    expect(box.min.y).toBeCloseTo(-MODULE_SKIRT, 6);
    expect(MODULE_SKIRT).toBeGreaterThan(MODULE_FOOT);
    expect(MODULE_SKIRT).toBeLessThan(1);
  });

  it('fills its body, so that nothing is solid that is not drawn', () => {
    const box = boundsOf(partsOf(model));
    const size = box.getSize(new Vector3());
    expect(size.x).toBeGreaterThan(0.76);
    expect(size.z).toBeGreaterThan(0.76);
    expect(box.max.y).toBeGreaterThan(0.9);
  });

  it('looks toward +x: the keys and the desk are in front, the cabinet and the masts behind', () => {
    const keys = pointsWhere(model.amber as BufferGeometry, (p) => p.x > 0.1);
    expect(keys.length).toBeGreaterThan(0);
    const tallest = Math.max(
      ...partsOf(model).flatMap((g) => pointsWhere(g, () => true).map((p) => p.y)),
    );
    const masts = partsOf(model).flatMap((g) => pointsWhere(g, (p) => p.y > tallest - 0.03));
    expect(masts.length).toBeGreaterThan(0);
    expect(masts.every((p) => p.x < -0.2)).toBe(true);
    // Each screen faces the front: one on the cabinet, one on the desk.
    const screens = model.screen as BufferGeometry;
    expect(pointsWhere(screens, (p) => p.x < -0.05).length).toBeGreaterThan(0);
    expect(pointsWhere(screens, (p) => p.x > 0.05).length).toBeGreaterThan(0);
  });

  it('lights the screens and the strips cyan and the trim amber, and leaves the steel dark', () => {
    const cyan = (hex: string | undefined) => {
      expect(hex).toBeDefined();
      const value = parseInt((hex as string).slice(1), 16);
      return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
    };
    for (const look of ['screen', 'lights'] as const) {
      const glow = cyan(MODULE_LOOKS[look].glow);
      expect(glow.b, look).toBeGreaterThan(glow.r);
      expect(glow.g, look).toBeGreaterThan(glow.r);
    }
    for (const look of ['amber', 'beacon'] as const) {
      const glow = cyan(MODULE_LOOKS[look].glow);
      expect(glow.r, look).toBeGreaterThan(glow.b);
      expect(glow.r, look).toBeGreaterThan(glow.g);
    }
    for (const look of ['plate', 'trim'] as const) expect(MODULE_LOOKS[look].glow).toBeUndefined();
  });

  it('is built the same way every time, so two pictures of it agree', () => {
    const again = buildModuleModel(MODULE.terminal) as ModuleModel;
    for (const look of MODULE_LOOK_NAMES) {
      const a = (model[look] as BufferGeometry).getAttribute('position').array;
      const b = (again[look] as BufferGeometry).getAttribute('position').array;
      expect(Array.from(b), look).toEqual(Array.from(a));
    }
  });

  it('is a few thousand triangles, a handful of draw calls', () => {
    const count = partsOf(model).reduce((sum, geometry) => sum + triangles(geometry), 0);
    expect(count).toBeGreaterThan(200);
    expect(count).toBeLessThan(4000);
    expect(MODULE_LOOK_NAMES.length).toBeLessThanOrEqual(6);
  });

  it('has no model for a module the table does not define', () => {
    expect(buildModuleModel(0)).toBeUndefined();
    expect(buildModuleModel(99)).toBeUndefined();
  });
});

describe('the ghost of a module', () => {
  it('is the whole model in one geometry, in cell coordinates, whichever way it faces', () => {
    for (let facing = 0; facing < MODULE_FACINGS; facing++) {
      const ghost = moduleGhostGeometry(moduleShape(MODULE.terminal, facing)) as BufferGeometry;
      const box = boundsOf([ghost]);
      expect(box.min.x, `facing ${facing}`).toBeGreaterThanOrEqual(0);
      expect(box.max.x, `facing ${facing}`).toBeLessThanOrEqual(1);
      expect(box.min.z, `facing ${facing}`).toBeGreaterThanOrEqual(0);
      expect(box.max.z, `facing ${facing}`).toBeLessThanOrEqual(1);
      expect(box.max.y).toBeLessThanOrEqual(1);
    }
  });

  it('turns with the module: the masts stand at its back', () => {
    // The masts are the tallest points of the model, behind the front; the back is the side the module does not face.
    const back = [
      (p: Vector3) => p.x < 0.5,
      (p: Vector3) => p.z < 0.5,
      (p: Vector3) => p.x > 0.5,
      (p: Vector3) => p.z > 0.5,
    ];
    for (let facing = 0; facing < MODULE_FACINGS; facing++) {
      const ghost = moduleGhostGeometry(moduleShape(MODULE.terminal, facing)) as BufferGeometry;
      const masts = pointsWhere(ghost, (p) => p.y > 0.95);
      expect(masts.length, `facing ${facing}`).toBeGreaterThan(0);
      expect(masts.every(back[facing] as (p: Vector3) => boolean), `facing ${facing}`).toBe(true);
    }
  });

  it('is nothing for a shape that is not a module', () => {
    expect(moduleGhostGeometry(SHAPE.cube)).toBeUndefined();
    expect(moduleGhostGeometry(SHAPE.wedge + 3)).toBeUndefined();
    expect(moduleGhostGeometry(0)).toBeUndefined();
  });
});
