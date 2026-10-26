import { Box3, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  MATERIAL,
  MODULE,
  MODULES,
  MODULE_FACINGS,
  MODULE_FOOT,
  SHAPE,
  moduleShape,
} from '../../src/shared/blocks';
import { TURRET_GUN } from '../../src/shared/turret';
import {
  MODULE_LOOKS,
  MODULE_LOOK_NAMES,
  MODULE_SKIRT,
  buildModuleKit,
  moduleGhostGeometry,
  modulePalette,
  type ModuleKit,
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
  const model = (buildModuleKit(MODULE.terminal) as ModuleKit).model;

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
    const again = (buildModuleKit(MODULE.terminal) as ModuleKit).model;
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
    expect(buildModuleKit(0)).toBeUndefined();
    expect(buildModuleKit(99)).toBeUndefined();
  });
});

describe('the Basic Turret model', () => {
  const kit = buildModuleKit(MODULE.turret) as ModuleKit;
  const head = kit.head as NonNullable<ModuleKit['head']>;

  it('is a body that stands still and a head that turns, each made of looks the table defines', () => {
    expect(Object.keys(kit.model).sort()).toEqual(['lights', 'plate', 'trim']);
    expect(Object.keys(head.model).sort()).toEqual(['amber', 'lights', 'plate', 'trim']);
    for (const geometry of [...partsOf(kit.model), ...partsOf(head.model)]) {
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      expect(position.count).toBeGreaterThan(0);
      expect(normal.count).toBe(position.count);
      for (let i = 0; i < position.count; i++) {
        expect(Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i))).toBe(true);
        expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 3);
      }
    }
  });

  it('keeps its pad over the body the cursor aims at, with a foundation below the floor', () => {
    const box = boundsOf(partsOf(kit.model));
    const [x0, , z0, x1, , z1] = MODULES.find((def) => def.id === MODULE.turret)!.body;
    const slack = 0.02;
    expect(box.min.x).toBeGreaterThanOrEqual(x0 - 0.5 - slack);
    expect(box.max.x).toBeLessThanOrEqual(x1 - 0.5 + slack);
    expect(box.min.z).toBeGreaterThanOrEqual(z0 - 0.5 - slack);
    expect(box.max.z).toBeLessThanOrEqual(z1 - 0.5 + slack);
    expect(box.min.y).toBeCloseTo(-MODULE_SKIRT, 6);
    expect(box.max.y).toBeLessThan(TURRET_GUN.pivot);
  });

  it('turns about the pivot the shared gun geometry names, and its barrel ends where a bolt leaves', () => {
    expect(head.pivot).toBe(TURRET_GUN.pivot);
    const box = boundsOf(partsOf(head.model));
    // Nothing of the head is farther from the pivot than the muzzle, and the barrel's tip is on the axis.
    let farthest = 0;
    for (const geometry of partsOf(head.model)) {
      for (const point of pointsWhere(geometry, () => true)) {
        farthest = Math.max(farthest, point.length());
      }
    }
    expect(farthest).toBeCloseTo(TURRET_GUN.reach, 2);
    // (The amber ring at the tip is wider than the barrel, so its rim is a hair farther than its middle.)
    expect(farthest).toBeLessThanOrEqual(TURRET_GUN.reach + 0.01);
    expect(box.max.x).toBeCloseTo(TURRET_GUN.reach, 6);
    const tip = pointsWhere(
      head.model.amber as BufferGeometry,
      (p) => p.x > TURRET_GUN.reach - 0.01,
    );
    expect(tip.length).toBeGreaterThan(0);
  });

  it('looks toward +x: the barrel and the eye in front, the strip behind, the amber ring at the tip', () => {
    const lights = head.model.lights as BufferGeometry;
    expect(pointsWhere(lights, (p) => p.x > 0.1).length).toBeGreaterThan(0);
    expect(pointsWhere(lights, (p) => p.x < -0.1).length).toBeGreaterThan(0);
    const plate = head.model.plate as BufferGeometry;
    // The barrel is the plate beyond the housing: thin, on the axis.
    const barrel = pointsWhere(plate, (p) => p.x > 0.27);
    expect(barrel.length).toBeGreaterThan(0);
    expect(barrel.every((p) => Math.abs(p.y) < 0.04 && Math.abs(p.z) < 0.04)).toBe(true);
    expect(box(head.model).min.x).toBeGreaterThan(-0.25);
    // The column's strip is on the front of the body.
    const strip = pointsWhere(kit.model.lights as BufferGeometry, (p) => p.y > 0.2);
    expect(strip.length).toBeGreaterThan(0);
    expect(strip.every((p) => p.x > 0.1)).toBe(true);
  });

  it('swings clear of its column and inside its cell when it dips or lifts to follow a shot', () => {
    const vertices = partsOf(head.model).flatMap((geometry) => pointsWhere(geometry, () => true));
    // How far a point is inside the column (a box 0.26 across from the pad's top to its collar), or 0.
    const inside = (p: Vector3): number =>
      Math.max(0, Math.min(0.13 - Math.abs(p.x), 0.13 - Math.abs(p.z), p.y - 0.18, 0.35 - p.y));
    const deepest = (degrees: number): number => {
      const pitch = (degrees * Math.PI) / 180;
      return Math.max(
        ...vertices.map((point) => {
          const moved = point.clone().applyAxisAngle(new Vector3(0, 0, 1), pitch);
          moved.y += head.pivot;
          expect(moved.y).toBeLessThanOrEqual(1.01);
          return inside(moved);
        }),
      );
    };
    // Dipping or lifting up to 45 degrees touches nothing, and at the steepest the muzzle ring's rim
    // is at most six centimeters into the column’s side, where the gun is nearly on end.
    for (let degrees = -45; degrees <= 60; degrees += 5) {
      expect(deepest(degrees), `${degrees} degrees`).toBe(0);
    }
    for (let degrees = -70; degrees < -45; degrees += 5) {
      expect(deepest(degrees), `${degrees} degrees`).toBeLessThan(0.06);
    }
    // Whatever the heading, the head is inside the cell.
    for (const point of vertices) expect(Math.hypot(point.x, point.z)).toBeLessThan(0.5);
  });

  it('lights its eye cyan and its muzzle and lamp amber', () => {
    expect(MODULE_LOOKS.lights.glow).toBe('#3ad1e0');
    expect(MODULE_LOOKS.amber.glow).toBe('#f2a43a');
  });

  it('is built the same way every time, so two pictures of it agree', () => {
    const again = buildModuleKit(MODULE.turret) as ModuleKit;
    const same = (a: ModuleModel, b: ModuleModel) => {
      for (const look of MODULE_LOOK_NAMES) {
        const first = a[look]?.getAttribute('position').array;
        const second = b[look]?.getAttribute('position').array;
        expect(second ? Array.from(second) : second, look).toEqual(
          first ? Array.from(first) : first,
        );
      }
    };
    same(kit.model, again.model);
    same(head.model, (again.head as NonNullable<ModuleKit['head']>).model);
  });

  it('is a few thousand triangles at most, in seven draw calls', () => {
    const count = [...partsOf(kit.model), ...partsOf(head.model)].reduce(
      (sum, geometry) => sum + triangles(geometry),
      0,
    );
    expect(count).toBeGreaterThan(200);
    expect(count).toBeLessThan(3000);
    expect(partsOf(kit.model).length + partsOf(head.model).length).toBe(7);
  });

  it('is the only module with a head so far', () => {
    expect((buildModuleKit(MODULE.terminal) as ModuleKit).head).toBeUndefined();
  });
});

/** The turrets by level: the Basic Turret and the two steps up its ladder. */
const TURRET_LEVELS = [1, 2, 3] as const;

describe('the turrets at every level', () => {
  const kitAt = (level: number) => buildModuleKit(MODULE.turret, level) as ModuleKit;
  const headAt = (level: number) => kitAt(level).head as NonNullable<ModuleKit['head']>;
  const everyPart = (level: number) => [
    ...partsOf(kitAt(level).model),
    ...partsOf(headAt(level).model),
  ];

  it.each(TURRET_LEVELS)(
    'level %i is a body that stands still and a head that turns, of looks the table defines',
    (level) => {
      for (const model of [kitAt(level).model, headAt(level).model]) {
        for (const look of Object.keys(model)) expect(MODULE_LOOK_NAMES).toContain(look);
      }
      for (const geometry of everyPart(level)) {
        const position = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        expect(position.count).toBeGreaterThan(0);
        expect(normal.count).toBe(position.count);
        for (let i = 0; i < position.count; i++) {
          expect(Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i))).toBe(
            true,
          );
          expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 3);
        }
      }
    },
  );

  it.each(TURRET_LEVELS)(
    'level %i keeps its pad over the body the cursor aims at, below its pivot, with a foundation under the floor',
    (level) => {
      const box = boundsOf(partsOf(kitAt(level).model));
      const [x0, , z0, x1, , z1] = MODULES.find((def) => def.id === MODULE.turret)!.body;
      const slack = 0.02;
      expect(box.min.x).toBeGreaterThanOrEqual(x0 - 0.5 - slack);
      expect(box.max.x).toBeLessThanOrEqual(x1 - 0.5 + slack);
      expect(box.min.z).toBeGreaterThanOrEqual(z0 - 0.5 - slack);
      expect(box.max.z).toBeLessThanOrEqual(z1 - 0.5 + slack);
      expect(box.min.y).toBeCloseTo(-MODULE_SKIRT, 6);
      expect(box.max.y).toBeLessThan(TURRET_GUN.pivot);
    },
  );

  it.each(TURRET_LEVELS)(
    'level %i turns about the pivot the shared gun geometry names, and its barrel ends where a bolt leaves',
    (level) => {
      const head = headAt(level);
      expect(head.pivot).toBe(TURRET_GUN.pivot);
      let farthest = 0;
      for (const geometry of partsOf(head.model)) {
        for (const point of pointsWhere(geometry, () => true)) {
          farthest = Math.max(farthest, point.length());
        }
      }
      // Nothing of the head is farther from the pivot than the muzzle, bar the rim of a wider tip.
      expect(farthest).toBeLessThanOrEqual(TURRET_GUN.reach + 0.01);
      expect(farthest).toBeGreaterThan(TURRET_GUN.reach - 0.01);
      expect(boundsOf(partsOf(head.model)).max.x).toBeGreaterThan(TURRET_GUN.reach - 0.02);
      // The tip glows amber, on the axis the bolt leaves along.
      const tip = pointsWhere(
        head.model.amber as BufferGeometry,
        (p) => p.x > TURRET_GUN.reach - 0.02,
      );
      expect(tip.length).toBeGreaterThan(0);
    },
  );

  it.each(TURRET_LEVELS)(
    'level %i swings clear of its column and inside its cell when it dips or lifts to follow a shot',
    (level) => {
      const head = headAt(level);
      const vertices = partsOf(head.model).flatMap((geometry) => pointsWhere(geometry, () => true));
      // How far a point is inside the column (a box 0.26 across from the pad's top to its collar), or 0.
      const inside = (p: Vector3): number =>
        Math.max(0, Math.min(0.13 - Math.abs(p.x), 0.13 - Math.abs(p.z), p.y - 0.18, 0.35 - p.y));
      const deepest = (degrees: number): number => {
        const pitch = (degrees * Math.PI) / 180;
        return Math.max(
          ...vertices.map((point) => {
            const moved = point.clone().applyAxisAngle(new Vector3(0, 0, 1), pitch);
            moved.y += head.pivot;
            expect(moved.y).toBeLessThanOrEqual(1.01);
            return inside(moved);
          }),
        );
      };
      for (let degrees = -45; degrees <= 45; degrees += 5) {
        expect(deepest(degrees), `${degrees} degrees`).toBeLessThan(0.005);
      }
      for (const point of vertices) expect(Math.hypot(point.x, point.z)).toBeLessThan(0.5);
    },
  );

  it('is a different gun at each level, and a bigger one: the head and what it is made of grow with the grade', () => {
    const size = (level: number) => boundsOf(partsOf(headAt(level).model)).getSize(new Vector3());
    const volume = (level: number) => {
      const box = size(level);
      return box.x * box.y * box.z;
    };
    expect(volume(2)).toBeGreaterThan(volume(1));
    expect(volume(3)).toBeGreaterThan(volume(2));
    const triangleCount = (level: number) =>
      everyPart(level).reduce((sum, geometry) => sum + triangles(geometry), 0);
    expect(triangleCount(2)).toBeGreaterThan(triangleCount(1));
    expect(triangleCount(3)).toBeGreaterThan(triangleCount(2));
    // The Auto Turret has two barrels side by side, which the other two do not: at the tip of the
    // barrels there is plate on either side of the axis and none on it. The Heavy Turret's one barrel
    // is thicker than the Basic Turret's.
    const tips = (level: number) =>
      pointsWhere(headAt(level).model.plate as BufferGeometry, (p) => p.x > 0.35);
    expect(tips(2).some((p) => p.z > 0.03) && tips(2).some((p) => p.z < -0.03)).toBe(true);
    expect(tips(2).every((p) => Math.abs(p.z) > 0.03)).toBe(true);
    expect(tips(1).every((p) => Math.abs(p.z) < 0.04)).toBe(true);
    expect(tips(3).every((p) => Math.abs(p.z) < 0.05)).toBe(true);
    const thickness = (level: number) =>
      Math.max(...tips(level).map((p) => Math.max(Math.abs(p.y), Math.abs(p.z))));
    expect(thickness(3)).toBeGreaterThan(thickness(1));
  });

  it.each(TURRET_LEVELS)(
    'level %i is built the same way every time, so two pictures of it agree',
    (level) => {
      const a = kitAt(level);
      const b = kitAt(level);
      for (const [first, second] of [
        [a.model, b.model],
        [
          (a.head as NonNullable<ModuleKit['head']>).model,
          (b.head as NonNullable<ModuleKit['head']>).model,
        ],
      ] as const) {
        for (const look of MODULE_LOOK_NAMES) {
          const x = first[look]?.getAttribute('position').array;
          const y = second[look]?.getAttribute('position').array;
          expect(y ? Array.from(y) : y, `level ${level} ${look}`).toEqual(x ? Array.from(x) : x);
        }
      }
    },
  );

  it.each(TURRET_LEVELS)(
    'level %i is a few thousand triangles at most, in at most eight draw calls',
    (level) => {
      const count = everyPart(level).reduce((sum, geometry) => sum + triangles(geometry), 0);
      expect(count).toBeGreaterThan(200);
      expect(count).toBeLessThan(4500);
      expect(everyPart(level).length).toBeLessThanOrEqual(8);
    },
  );

  it('draws a level the table does not have as the nearest one it does', () => {
    const same = (a: ModuleKit, b: ModuleKit) => {
      expect(a.palette).toBe(b.palette);
      for (const look of MODULE_LOOK_NAMES) {
        const x = a.model[look]?.getAttribute('position').array;
        const y = b.model[look]?.getAttribute('position').array;
        expect(y ? Array.from(y) : y).toEqual(x ? Array.from(x) : x);
      }
    };
    same(kitAt(0), kitAt(1));
    same(kitAt(9), kitAt(3));
    same(kitAt(2.4), kitAt(2));
    // A module with no ladder is the one model whatever level it is asked for.
    same(
      buildModuleKit(MODULE.terminal, 3) as ModuleKit,
      buildModuleKit(MODULE.terminal) as ModuleKit,
    );
  });
});

describe('the paint of a module’s grade', () => {
  const channels = (hex: string) => {
    const value = parseInt(hex.slice(1), 16);
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  };
  const spread = (hex: string) => {
    const { r, g, b } = channels(hex);
    return Math.max(r, g, b) - Math.min(r, g, b);
  };

  it('is the Core’s palette for Scrap, and for a grade with no dress of its own', () => {
    expect(modulePalette(MATERIAL.scrap)).toBe(MODULE_LOOKS);
    expect(modulePalette(MATERIAL.energy)).toBe(MODULE_LOOKS);
    expect(modulePalette(99)).toBe(MODULE_LOOKS);
  });

  it('is one object for each grade, so a renderer can keep one set of materials for it', () => {
    expect(modulePalette(MATERIAL.composite)).toBe(modulePalette(MATERIAL.composite));
    expect(modulePalette(MATERIAL.alloy)).toBe(modulePalette(MATERIAL.alloy));
    expect(modulePalette(MATERIAL.composite)).not.toBe(modulePalette(MATERIAL.alloy));
    expect(modulePalette(MATERIAL.composite)).not.toBe(MODULE_LOOKS);
  });

  it('dresses Composite in grey-green panels with cyan light, as its blocks and heaps are', () => {
    const paint = modulePalette(MATERIAL.composite);
    for (const look of ['plate', 'trim'] as const) {
      const { r, g, b } = channels(paint[look].color);
      // Green leads, blue follows and red is least: grey with a green cast, not saturated.
      expect(g, look).toBeGreaterThan(b);
      expect(b, look).toBeGreaterThanOrEqual(r);
      expect(spread(paint[look].color), look).toBeLessThan(70);
    }
    const glow = channels(paint.lights.glow as string);
    expect(glow.b).toBeGreaterThan(glow.r);
    expect(glow.g).toBeGreaterThan(glow.r);
    expect(paint.lights.glowIntensity as number).toBeGreaterThan(
      MODULE_LOOKS.lights.glowIntensity as number,
    );
  });

  it('dresses Alloy in brushed steel inlaid with amber and a pale lamp, as its blocks and heaps are', () => {
    const paint = modulePalette(MATERIAL.alloy);
    for (const look of ['plate', 'trim'] as const) {
      expect(spread(paint[look].color), look).toBeLessThan(40);
      expect(paint[look].metalness, look).toBeGreaterThan(MODULE_LOOKS[look].metalness);
    }
    const inlay = channels(paint.amber.glow as string);
    expect(inlay.r).toBeGreaterThan(inlay.b);
    expect(inlay.r).toBeGreaterThan(inlay.g);
    const lamp = channels(paint.lights.glow as string);
    expect(Math.min(lamp.r, lamp.g, lamp.b)).toBeGreaterThan(150);
    // The steel is lighter than the Core’s dark plates, or it would read as black in a low sun.
    expect(channels(paint.plate.color).g).toBeGreaterThan(channels(MODULE_LOOKS.plate.color).g);
  });

  it('leaves the looks a grade does not name as they are', () => {
    expect(modulePalette(MATERIAL.composite).amber).toBe(MODULE_LOOKS.amber);
    expect(modulePalette(MATERIAL.composite).beacon).toBe(MODULE_LOOKS.beacon);
    expect(modulePalette(MATERIAL.alloy).screen).toBe(MODULE_LOOKS.screen);
    for (const material of [MATERIAL.composite, MATERIAL.alloy]) {
      for (const look of MODULE_LOOK_NAMES) {
        expect(modulePalette(material)[look].color, look).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('is what each level of a turret is drawn in: the grade of the material that pays for it', () => {
    expect((buildModuleKit(MODULE.turret, 1) as ModuleKit).palette).toBe(MODULE_LOOKS);
    expect((buildModuleKit(MODULE.turret, 2) as ModuleKit).palette).toBe(
      modulePalette(MATERIAL.composite),
    );
    expect((buildModuleKit(MODULE.turret, 3) as ModuleKit).palette).toBe(
      modulePalette(MATERIAL.alloy),
    );
    expect((buildModuleKit(MODULE.terminal) as ModuleKit).palette).toBe(MODULE_LOOKS);
  });
});

function box(model: ModuleModel): Box3 {
  return boundsOf(partsOf(model));
}

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

  it('shows a turret with its head at rest, its muzzle ahead of the way it faces', () => {
    const ahead = [
      (p: Vector3) => p.x - 0.5,
      (p: Vector3) => p.z - 0.5,
      (p: Vector3) => 0.5 - p.x,
      (p: Vector3) => 0.5 - p.z,
    ];
    for (let facing = 0; facing < MODULE_FACINGS; facing++) {
      const ghost = moduleGhostGeometry(moduleShape(MODULE.turret, facing)) as BufferGeometry;
      const box = boundsOf([ghost]);
      expect(box.min.x, `facing ${facing}`).toBeGreaterThanOrEqual(0);
      expect(box.max.x, `facing ${facing}`).toBeLessThanOrEqual(1);
      expect(box.min.z, `facing ${facing}`).toBeGreaterThanOrEqual(0);
      expect(box.max.z, `facing ${facing}`).toBeLessThanOrEqual(1);
      const farthest = Math.max(
        ...pointsWhere(ghost, () => true).map((p) => (ahead[facing] as (p: Vector3) => number)(p)),
      );
      expect(farthest, `facing ${facing}`).toBeCloseTo(TURRET_GUN.reach, 2);
      // The head is up where the pivot is: the tallest point of the ghost is the roof, above the column.
      expect(box.max.y, `facing ${facing}`).toBeGreaterThan(TURRET_GUN.pivot);
    }
  });
});
