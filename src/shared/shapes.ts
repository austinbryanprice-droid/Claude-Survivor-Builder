import {
  SHAPES,
  isUpsideDown,
  moduleFacing,
  moduleOfShape,
  shapeKind,
  wedgeFacing,
} from './blocks';
import type { ShapeKind } from './blocks';

/**
 * What each shape of the block table is, as geometry: the flat faces the mesher draws, the boxes
 * movement collides with, and which faces of a cell the shape fills so a neighbor can hide behind
 * it. Everything is in cell coordinates, 0 to 1 on each axis with y up, and is built once from
 * the shape ids in `blocks.ts`. Pure data: the renderer and the physics both read it and neither
 * owns it. A module's geometry is its body alone, one box: the mesher skips it and its model draws it.
 */

export type Point = readonly [number, number, number];

/** An axis-aligned box inside a cell: x0, y0, z0, x1, y1, z1. */
export type CellBox = readonly [number, number, number, number, number, number];

/** A rectangle on one side of a cell, in that side's tangent coordinates: a0, a1, b0, b1. */
export type SideRect = readonly [number, number, number, number];

/** The plane of a face as nx, ny, nz, d: a point p is on the inside of the face when n . p <= d. */
export type ShapePlane = readonly [number, number, number, number];

/** Sides of a cell are numbered axis * 2 + (negative ? 1 : 0): +x, -x, +y, -y, +z, -z. */
export const SIDE = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 } as const;

/** The two axes along a side of each axis, in increasing order: a runs along the first, b along the second. */
export const SIDE_TANGENTS: readonly (readonly [number, number])[] = [
  [1, 2],
  [0, 2],
  [0, 1],
];

/** The side across: the neighbor's face that touches this one. */
export const oppositeSide = (side: number): number => side ^ 1;

/** How many boxes a wedge is cut into for movement; each is a step of 1 / WEDGE_SLICES blocks high. */
export const WEDGE_SLICES = 32;

export interface ShapeFace {
  /** Indices into `vertices`, going counter-clockwise when seen from outside. */
  readonly loop: readonly number[];
  /** Unit vector pointing out of the shape. */
  readonly normal: Point;
  /** The side of the cell this face lies flat on, or -1 when it sits inside the cell or slants. */
  readonly side: number;
  /** Where the face lies on that side, as its bounding rectangle; null when `side` is -1. */
  readonly bounds: SideRect | null;
  /** True when the face fills `bounds` exactly, so it can cover a neighbor's face. */
  readonly exact: boolean;
}

export interface ShapeGeometry {
  readonly id: number;
  readonly kind: ShapeKind;
  readonly vertices: readonly Point[];
  readonly faces: readonly ShapeFace[];
  /**
   * The plane of each face, in the same order as `faces`. The shape is convex, so it is exactly the
   * points on the inside of every plane, which is all a ray needs to find where it meets it.
   */
  readonly planes: readonly ShapePlane[];
  /**
   * The solid parts for movement, or null when the shape is the whole cell. Their union contains
   * the shape, so a body that stands on the boxes never sinks into it.
   */
  readonly boxes: readonly CellBox[] | null;
  /** By side: the rectangle of that side of the cell this shape fills exactly, or null. */
  readonly cover: readonly (SideRect | null)[];
  /** By side: where this shape's face on that side lies (its bounding rectangle), or null. */
  readonly reach: readonly (SideRect | null)[];
  /** Fraction of the cell the shape fills. */
  readonly volume: number;
}

const EPSILON = 1e-9;

function sub(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Point, b: Point): Point {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Newell's method: the area-weighted normal of a polygon, not yet unit length. */
function polygonNormal(points: readonly Point[]): Point {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Point;
    const b = points[(i + 1) % points.length] as Point;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

function centroid(points: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  return [x / points.length, y / points.length, z / points.length];
}

/** A shape before it is oriented: a convex polyhedron given by its corners and the loops of its faces. */
interface Solid {
  readonly vertices: readonly Point[];
  readonly loops: readonly (readonly number[])[];
}

/** A box from (x0, y0, z0) to (x1, y1, z1). */
function boxSolid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Solid {
  const vertices: Point[] = [];
  for (const z of [z0, z1])
    for (const y of [y0, y1]) for (const x of [x0, x1]) vertices.push([x, y, z]);
  // Corner index is x + 2 * y + 4 * z.
  return {
    vertices,
    loops: [
      [1, 3, 7, 5],
      [0, 4, 6, 2],
      [2, 6, 7, 3],
      [0, 1, 5, 4],
      [4, 5, 7, 6],
      [0, 2, 3, 1],
    ],
  };
}

/**
 * The wedge rising toward +x: the cell cut along the diagonal from the low edge at x = 0 to the
 * top edge at x = 1, keeping the lower half. Its faces are the floor, the wall at x = 1, the slope
 * and a triangle on each side.
 */
const WEDGE: Solid = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
  ],
  loops: [
    [0, 1, 4, 3],
    [1, 2, 5, 4],
    [0, 3, 5, 2],
    [0, 2, 1],
    [3, 4, 5],
  ],
};

/** Turns a point a quarter turn about the vertical line through the middle of the cell, `turns` times. */
function turnPoint(p: Point, turns: number): Point {
  switch (turns & 3) {
    case 1:
      return [1 - p[2], p[1], p[0]];
    case 2:
      return [1 - p[0], p[1], 1 - p[2]];
    case 3:
      return [p[2], p[1], 1 - p[0]];
    default:
      return p;
  }
}

function turnBox(box: CellBox, turns: number): CellBox {
  const a = turnPoint([box[0], box[1], box[2]], turns);
  const b = turnPoint([box[3], box[4], box[5]], turns);
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.max(a[2], b[2]),
  ];
}

function flipBox(box: CellBox): CellBox {
  return [box[0], 1 - box[4], box[2], box[3], 1 - box[1], box[5]];
}

/** The wedge rising toward +x as stairs of 1 / WEDGE_SLICES blocks, each tread the highest point of its slice. */
function wedgeBoxes(): CellBox[] {
  const boxes: CellBox[] = [];
  for (let i = 0; i < WEDGE_SLICES; i++) {
    boxes.push([i / WEDGE_SLICES, 0, 0, (i + 1) / WEDGE_SLICES, (i + 1) / WEDGE_SLICES, 1]);
  }
  return boxes;
}

function rectOf(points: readonly Point[], side: number): SideRect {
  const [t1, t2] = SIDE_TANGENTS[side >> 1] as readonly [number, number];
  let a0 = Infinity;
  let a1 = -Infinity;
  let b0 = Infinity;
  let b1 = -Infinity;
  for (const p of points) {
    const a = p[t1] as number;
    const b = p[t2] as number;
    a0 = Math.min(a0, a);
    a1 = Math.max(a1, a);
    b0 = Math.min(b0, b);
    b1 = Math.max(b1, b);
  }
  return [a0, a1, b0, b1];
}

function area(points: readonly Point[]): number {
  const n = polygonNormal(points);
  return 0.5 * Math.hypot(n[0], n[1], n[2]);
}

/** Orients a solid's loops outward, finds which faces lie flat on the cell and fills in the rest. */
function describe(
  id: number,
  kind: ShapeKind,
  solid: Solid,
  boxes: readonly CellBox[] | null,
): ShapeGeometry {
  const { vertices } = solid;
  const centre = centroid(vertices);

  const faces: ShapeFace[] = [];
  const cover: (SideRect | null)[] = [null, null, null, null, null, null];
  const reach: (SideRect | null)[] = [null, null, null, null, null, null];
  for (const source of solid.loops) {
    let loop = source;
    let points = loop.map((i) => vertices[i] as Point);
    let n = polygonNormal(points);
    const length = Math.hypot(n[0], n[1], n[2]);
    if (dot(n, sub(centroid(points), centre)) < 0) {
      loop = [...loop].reverse();
      points = loop.map((i) => vertices[i] as Point);
      n = polygonNormal(points);
    }
    const normal: Point = [n[0] / length, n[1] / length, n[2] / length];

    let side = -1;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(Math.abs(normal[axis] as number) - 1) > EPSILON) continue;
      const positive = (normal[axis] as number) > 0;
      const plane = positive ? 1 : 0;
      if (points.every((p) => Math.abs((p[axis] as number) - plane) < EPSILON)) {
        side = axis * 2 + (positive ? 0 : 1);
      }
    }
    let bounds: SideRect | null = null;
    let exact = false;
    if (side >= 0) {
      bounds = rectOf(points, side);
      const filled = (bounds[1] - bounds[0]) * (bounds[3] - bounds[2]);
      exact = points.length === 4 && Math.abs(area(points) - filled) < 1e-7;
      reach[side] = bounds;
      if (exact) cover[side] = bounds;
    }
    faces.push({ loop, normal, side, bounds, exact });
  }

  const planes = faces.map((face): ShapePlane => {
    const corner = vertices[face.loop[0] as number] as Point;
    return [face.normal[0], face.normal[1], face.normal[2], dot(face.normal, corner)];
  });

  // Volume by the divergence theorem over the faces (each fan-triangulated from its first corner).
  let volume = 0;
  for (const face of faces) {
    const a = vertices[face.loop[0] as number] as Point;
    for (let i = 1; i + 1 < face.loop.length; i++) {
      const b = vertices[face.loop[i] as number] as Point;
      const c = vertices[face.loop[i + 1] as number] as Point;
      volume += dot(a, cross(b, c)) / 6;
    }
  }

  return { id, kind, vertices, faces, planes, boxes, cover, reach, volume: Math.abs(volume) };
}

function turnSolid(solid: Solid, turns: number, flip: boolean): Solid {
  return {
    vertices: solid.vertices.map((v) => {
      const p: Point = flip ? [v[0], 1 - v[1], v[2]] : v;
      return turnPoint(p, turns);
    }),
    loops: solid.loops,
  };
}

function build(id: number): ShapeGeometry | undefined {
  const kind = shapeKind(id);
  if (kind === 'cube') return describe(id, kind, boxSolid(0, 0, 0, 1, 1, 1), null);
  if (kind === 'slab') {
    const upper = isUpsideDown(id);
    const box: CellBox = upper ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
    return describe(id, kind, boxSolid(...box), [box]);
  }
  if (kind === 'wedge') {
    const flip = isUpsideDown(id);
    const turns = wedgeFacing(id);
    const boxes = wedgeBoxes().map((b) => turnBox(flip ? flipBox(b) : b, turns));
    return describe(id, kind, turnSolid(WEDGE, turns, flip), boxes);
  }
  if (kind === 'module') {
    // A module is drawn from its model, not from faces, so its geometry is only the body the cursor aims
    // at and movement stands against: one box, turned to the way the module faces.
    const module = moduleOfShape(id);
    if (!module) return undefined;
    const box = turnBox(module.body, moduleFacing(id));
    return describe(id, kind, boxSolid(...box), [box]);
  }
  return undefined;
}

const GEOMETRY: (ShapeGeometry | undefined)[] = new Array<ShapeGeometry | undefined>(256);
for (const shape of SHAPES) GEOMETRY[shape.id] = build(shape.id);

/** The geometry of a shape id, or undefined for an id the table does not define (empty included). */
export function shapeGeometry(id: number): ShapeGeometry | undefined {
  return GEOMETRY[id & 0xff];
}

/**
 * The solid parts of a cell holding this shape for movement: null when it is the whole cell (or
 * not a known shape), otherwise a list of boxes in cell coordinates.
 */
export function shapeBoxes(id: number): readonly CellBox[] | null {
  return GEOMETRY[id & 0xff]?.boxes ?? null;
}

/** True when `outer` contains `inner`, both rectangles on the same side. */
export function rectContains(outer: SideRect, inner: SideRect): boolean {
  return (
    outer[0] <= inner[0] + EPSILON &&
    outer[1] >= inner[1] - EPSILON &&
    outer[2] <= inner[2] + EPSILON &&
    outer[3] >= inner[3] - EPSILON
  );
}
