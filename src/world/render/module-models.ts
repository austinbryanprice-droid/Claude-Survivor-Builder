import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Shape,
  Vector2,
  type BufferGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MODULE, moduleFacing, moduleOfShape } from '../../shared/blocks';
import { TURRET_GUN } from '../../shared/turret';

/**
 * The functional modules as models, drawn in code like the Core and the machines: no assets, so
 * `CREDITS.md` is unchanged. A model is built once, in model space, and every placed module of that
 * kind shares it: the cell's middle is the origin of x and z, the floor of the cell is y = 0, and the
 * front looks toward +x. It stays inside the cell (height 1 at most), with a foundation that reaches
 * most of a cell below the floor, as the Core's does, so that a module the cursor stood over a slope
 * (the world lets it float up to `MODULE_FOOT`) has its foot in the ground and no gap shows. On a block
 * the foundation is inside the block.
 *
 * Each model is a few merged parts, one for each look (a material and what it glows): the whole
 * module costs a handful of draw calls. Placed modules turn by the group they sit in, and the build
 * ghost has the model turned to its facing and moved to the cell's corner (`moduleGhostGeometry`).
 *
 * A module with a part that moves by itself, such as a turret's gun, has that part as a second model,
 * its head, built around the point it turns on so that the renderer can turn it with one rotation.
 */

/** What a part of a model is made of; each look is one material and so one draw call. */
export type ModuleLook = 'plate' | 'trim' | 'amber' | 'lights' | 'screen' | 'beacon';

export interface ModuleLookSpec {
  readonly color: string;
  readonly gloss: number;
  readonly metalness: number;
  readonly glow?: string;
  readonly glowIntensity?: number;
}

/**
 * The looks of the modules, in the Core's palette: dark steel, lighter plates, amber trim and cyan
 * light, the cyan of a module that is powered and the amber of one that is working (the art direction).
 */
export const MODULE_LOOKS: Readonly<Record<ModuleLook, ModuleLookSpec>> = {
  plate: { color: '#31405a', gloss: 0.55, metalness: 0.65 },
  trim: { color: '#4d6079', gloss: 0.6, metalness: 0.55 },
  amber: { color: '#b9741f', gloss: 0.35, metalness: 0.3, glow: '#f2a43a', glowIntensity: 0.9 },
  lights: { color: '#0e2f36', gloss: 0.5, metalness: 0.1, glow: '#3ad1e0', glowIntensity: 1.4 },
  screen: { color: '#0e2f36', gloss: 0.9, metalness: 0.1, glow: '#2aa9b8', glowIntensity: 0.75 },
  beacon: { color: '#7a4a12', gloss: 0.3, metalness: 0.2, glow: '#f2a43a', glowIntensity: 2.2 },
};

/** The looks a model is made of, in the order they are drawn. */
export const MODULE_LOOK_NAMES = Object.keys(MODULE_LOOKS) as readonly ModuleLook[];

/** The merged geometry of a model for each look it uses, in model space. */
export type ModuleModel = Readonly<Partial<Record<ModuleLook, BufferGeometry>>>;

/**
 * The part of a module that turns on its own, in a space of its own: its origin is the point it turns
 * about, `pivot` above the floor of the cell on its middle line, and its front looks toward +x as the
 * module's does when the part is at rest.
 */
export interface ModuleHead {
  readonly pivot: number;
  readonly model: ModuleModel;
}

/** What draws a module: the body that stands still, and for a turret and the like the head that turns. */
export interface ModuleKit {
  readonly model: ModuleModel;
  readonly head?: ModuleHead;
}

/**
 * How far below the floor of its cell a model reaches: a little less than a cell, so that on a block
 * it stays inside it, and more than the world lets a module float over the ground (`MODULE_FOOT`).
 */
export const MODULE_SKIRT = 0.98;

type Parts = Partial<Record<ModuleLook, BufferGeometry[]>>;

/** What a module is built from: the parts that stand still, and the parts that turn about `pivot`. */
interface Build {
  readonly body: Parts;
  readonly head?: { readonly pivot: number; readonly parts: Parts };
}

/**
 * A box of the given size, centered at (x, y, z), ready to be merged with its neighbors. `rounding` is
 * the radius of its edges as a fraction of its thinnest side: the big pieces are softened over two
 * segments, thin ones with a chamfer, and 0 leaves a plain box, for what is too small to show a bevel.
 */
function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rounding = 0.3,
): BufferGeometry {
  const thin = Math.min(w, h, d);
  const geometry =
    rounding > 0
      ? new RoundedBoxGeometry(w, h, d, thin >= 0.2 ? 2 : 1, thin * rounding)
      : new BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  return geometry;
}

/**
 * A round bar lying along x, `length` long and `radius` thick, centered at (x, y, z): a barrel, a
 * sleeve or a ring. It is drawn with `sides` flats, which at this size read as round.
 */
function tube(
  length: number,
  radius: number,
  x: number,
  y: number,
  z: number,
  sides = 12,
): BufferGeometry {
  const geometry = new CylinderGeometry(radius, radius, length, sides);
  geometry.rotateZ(-Math.PI / 2);
  geometry.translate(x, y, z);
  return geometry;
}

/** A round post standing upright, `height` tall and `radius` thick, centered at (x, y, z): a stem or an axle. */
function post(height: number, radius: number, x: number, y: number, z: number): BufferGeometry {
  const geometry = new CylinderGeometry(radius, radius, height, 12);
  geometry.translate(x, y, z);
  return geometry;
}

/**
 * A prism: the polygon (x, y points, counterclockwise) extruded across z, centered on z = 0, with its
 * edges softened by `bevel`. The sides stand on the outline and the end faces are drawn in from it.
 */
function prism(outline: readonly (readonly [number, number])[], depth: number, bevel: number) {
  const shape = new Shape(outline.map(([x, y]) => new Vector2(x, y)));
  const geometry = new ExtrudeGeometry(shape, {
    depth: depth - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 2,
    steps: 1,
  });
  geometry.translate(0, 0, -(depth - bevel * 2) / 2);
  return geometry;
}

function merge(parts: readonly BufferGeometry[]): BufferGeometry {
  // The box parts are indexed and the prism is not, and a merge needs them alike.
  const flat = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  const merged = mergeGeometries(flat, false);
  parts.forEach((part) => part.dispose());
  flat.forEach((part) => part.dispose());
  if (!merged) throw new Error('A module could not merge its parts');
  return merged;
}

/**
 * The Research Terminal: a field console on a steel pad. A cabinet stands at the back with a screen on
 * its front, a sloped desk falls away from it toward the player with a second screen and a row of keys,
 * and a pair of masts carries a blinking amber beacon. Cyan screens and light strips mean it is on.
 */
function terminal(): Parts {
  // The desk's slope, from where it meets the cabinet down to the front edge, and the frame laid on it:
  // x along the slope (toward the front), y out of it, z across.
  const back: readonly [number, number] = [-0.1, 0.54];
  const front: readonly [number, number] = [0.28, 0.38];
  const tilt = Math.atan2(back[1] - front[1], front[0] - back[0]);
  const middle: readonly [number, number] = [(back[0] + front[0]) / 2, (back[1] + front[1]) / 2];
  const onDesk = (geometry: BufferGeometry): BufferGeometry => {
    geometry.rotateZ(-tilt);
    geometry.translate(middle[0], middle[1], 0);
    return geometry;
  };

  const keys = [-0.16, -0.08, 0, 0.08, 0.16].map((z) =>
    onDesk(box(0.045, 0.022, 0.05, 0.14, 0.011, z, 0)),
  );
  // What the screens show: bright lines on dark glass. The cabinet's has a header, three bars and a
  // blip; the desk's has three rows.
  const readout = [
    box(0.006, 0.016, 0.36, -0.074, 0.77, 0, 0),
    box(0.006, 0.014, 0.3, -0.074, 0.725, -0.05, 0),
    box(0.006, 0.014, 0.2, -0.074, 0.69, -0.1, 0),
    box(0.006, 0.014, 0.26, -0.074, 0.655, -0.07, 0),
    box(0.006, 0.06, 0.06, -0.074, 0.69, 0.15, 0),
    ...[
      [-0.11, 0.3, -0.02],
      [-0.06, 0.2, -0.07],
      [-0.01, 0.26, -0.04],
    ].map(([x, length, z]) =>
      onDesk(box(0.016, 0.004, length as number, x as number, 0.026, z as number, 0)),
    ),
  ];
  return {
    plate: [
      // The foundation under the pad: it meets the ground where the module floats over it.
      box(0.72, 0.78, 0.72, 0, -0.59, 0, 0),
      box(0.8, 0.36, 0.8, 0, -0.12, 0),
      box(0.72, 0.14, 0.72, 0, 0.13, 0),
      box(0.24, 0.64, 0.6, -0.22, 0.52, 0, 0.16),
      prism(
        [
          [-0.1, 0.2],
          [0.28, 0.2],
          [0.28, 0.38],
          [-0.1, 0.54],
        ],
        0.52,
        0.02,
      ),
    ],
    trim: [
      box(0.76, 0.04, 0.76, 0, 0.2, 0, 0.4),
      box(0.28, 0.05, 0.64, -0.22, 0.865, 0, 0.4),
      box(0.03, 0.28, 0.5, -0.095, 0.69, 0, 0.4),
      onDesk(box(0.3, 0.012, 0.44, -0.05, 0.006, 0, 0.4)),
      box(0.028, 0.07, 0.028, -0.3, 0.925, -0.22, 0),
      box(0.028, 0.05, 0.028, -0.3, 0.915, 0.2, 0),
    ],
    amber: [
      ...keys,
      box(0.18, 0.035, 0.02, -0.22, 0.36, 0.305, 0),
      box(0.18, 0.035, 0.02, -0.22, 0.36, -0.305, 0),
      box(0.18, 0.035, 0.02, -0.22, 0.46, 0.305, 0),
      box(0.18, 0.035, 0.02, -0.22, 0.46, -0.305, 0),
      box(0.06, 0.016, 0.06, -0.3, 0.945, 0.2, 0),
    ],
    lights: [
      ...readout,
      box(0.76, 0.02, 0.76, 0, 0.07, 0, 0),
      box(0.012, 0.035, 0.36, 0.285, 0.29, 0, 0),
      ...[-0.15, -0.05, 0.05, 0.15].map((z) => box(0.02, 0.3, 0.05, -0.345, 0.52, z, 0)),
    ],
    screen: [
      box(0.02, 0.22, 0.44, -0.085, 0.69, 0, 0),
      onDesk(box(0.26, 0.012, 0.38, -0.05, 0.018, 0, 0)),
    ],
    beacon: [box(0.045, 0.03, 0.045, -0.3, 0.975, -0.22, 0)],
  };
}

/**
 * The Basic Turret: a gun on a short column on a steel pad. The pad and the column stand still, with a
 * cyan strip down the front of the column so that the way the turret faces reads; the head (a housing
 * with a sleeve and a barrel, an amber ring at its tip and a cyan eye above it) turns about
 * `TURRET_GUN.pivot` to point where it shoots, and the tip of the barrel is `TURRET_GUN.reach` from the
 * pivot, which is where a bolt leaves (`turretMuzzle`). The head's swing stays above the column and
 * inside the cell.
 */
function turret(): Build {
  const { pivot, reach } = TURRET_GUN;
  const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => [sx, sz] as const));
  return {
    body: {
      plate: [
        // The foundation under the pad: it meets the ground where the module floats over it.
        box(0.5, 0.78, 0.5, 0, -0.59, 0, 0),
        box(0.72, 0.36, 0.72, 0, -0.12, 0),
        box(0.62, 0.12, 0.62, 0, 0.12, 0),
        box(0.26, 0.17, 0.26, 0, 0.265, 0, 0.25),
        post(0.15, 0.07, 0, 0.435, 0),
      ],
      trim: [
        box(0.66, 0.03, 0.66, 0, 0.18, 0, 0.4),
        box(0.34, 0.03, 0.34, 0, 0.35, 0, 0.4),
        ...corners.map(([sx, sz]) => box(0.07, 0.04, 0.07, sx * 0.27, 0.2, sz * 0.27, 0)),
      ],
      lights: [box(0.68, 0.02, 0.68, 0, 0.07, 0, 0), box(0.012, 0.1, 0.1, 0.133, 0.265, 0, 0)],
    },
    head: {
      pivot,
      parts: {
        plate: [
          box(0.37, 0.24, 0.34, -0.015, 0, 0, 0.25),
          tube(0.12, 0.065, 0.19, 0, 0),
          tube(reach - 0.2, 0.032, (reach + 0.2) / 2, 0, 0, 10),
        ],
        trim: [
          box(0.3, 0.035, 0.26, -0.03, 0.1375, 0, 0.4),
          box(0.2, 0.1, 0.02, -0.04, 0, 0.18, 0),
          box(0.2, 0.1, 0.02, -0.04, 0, -0.18, 0),
        ],
        amber: [
          tube(0.04, 0.05, reach - 0.02, 0, 0, 10),
          box(0.05, 0.02, 0.05, -0.1, 0.165, 0.08, 0),
        ],
        lights: [box(0.012, 0.03, 0.22, 0.176, 0.1, 0, 0), box(0.012, 0.06, 0.2, -0.206, 0, 0, 0)],
      },
    },
  };
}

/** The models, by module id. */
const BUILDERS: Readonly<Record<number, () => Build>> = {
  [MODULE.terminal]: () => ({ body: terminal() }),
  [MODULE.turret]: turret,
};

/** One merged geometry for each look the parts use. */
function mergeLooks(parts: Parts): ModuleModel {
  const model: Partial<Record<ModuleLook, BufferGeometry>> = {};
  for (const look of MODULE_LOOK_NAMES) {
    const geometry = parts[look];
    if (geometry && geometry.length > 0) model[look] = merge(geometry);
  }
  return model;
}

/**
 * Builds the model of a module (`MODULE`): one merged geometry for each look its body uses, and the same
 * for its head if it has one. Undefined for a module the table has no picture of. The caller owns the
 * geometries and disposes them.
 */
export function buildModuleKit(module: number): ModuleKit | undefined {
  const build = BUILDERS[module];
  if (!build) return undefined;
  const { body, head } = build();
  const kit: ModuleKit = { model: mergeLooks(body) };
  return head ? { ...kit, head: { pivot: head.pivot, model: mergeLooks(head.parts) } } : kit;
}

/**
 * The whole model of a module shape as one geometry in cell coordinates: turned to the way the shape
 * faces and moved so the cell's corner is the origin, as the build ghost and the break outline have
 * every shape, with the head at rest. Undefined for a shape that is not a module.
 */
export function moduleGhostGeometry(shape: number): BufferGeometry | undefined {
  const module = moduleOfShape(shape);
  const kit = module ? buildModuleKit(module.id) : undefined;
  if (!kit) return undefined;
  const parts = MODULE_LOOK_NAMES.flatMap((look) => kit.model[look] ?? []);
  if (kit.head) {
    for (const look of MODULE_LOOK_NAMES) {
      const part = kit.head.model[look];
      if (part) parts.push(part.translate(0, kit.head.pivot, 0));
    }
  }
  const geometry = merge(parts);
  geometry.rotateY((-moduleFacing(shape) * Math.PI) / 2);
  geometry.translate(0.5, 0, 0.5);
  return geometry;
}
