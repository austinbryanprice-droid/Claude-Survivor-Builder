import { SIDE_TANGENTS, type Point, type ShapeGeometry } from '../../shared/shapes';

/**
 * The beveled surface of a shape that is not a cube, worked out once per shape. A shape is a convex
 * solid; its surface is made the way the cube's is, from three kinds of piece:
 *
 *  - a panel for each face, pulled in from every edge by the bevel width;
 *  - a strip along each edge, the chamfer that joins the two panels either side of it;
 *  - a corner for each vertex, the small polygon that joins the panels and strips around it.
 *
 * Every piece is closed against the next, so the surface of one piece alone is a watertight skin.
 * What a piece needs from its neighbors (whether its face is hidden, how dark a corner is) is
 * decided per cell by the mesher; this module only holds the geometry.
 */

export const PIECE = { panel: 0, strip: 1, corner: 2 } as const;

/** Where on a tile a strip or a corner reads its color: inside the plain dark band at the tile's rim. */
const BAND_U = 0.04;
const BAND_V = 0.5;

export interface TemplatePiece {
  readonly kind: number;
  /** The face that owns the piece: its tile layout and orientation are used, and a panel is hidden with it. */
  readonly face: number;
  readonly count: number;
  /** Cell coordinates of each corner of the piece, in order around it. */
  readonly position: Float64Array;
  /** Tile coordinates of each corner, before the cell's own tile orientation is applied. */
  readonly uv: Float64Array;
  readonly normal: Point;
  /**
   * What decides the darkness at each corner: the side of the cell it faces times 8, plus its
   * corner on that side times 2, plus one if it sits inside the cell rather than on its boundary;
   * or -1 when nothing does.
   */
  readonly ao: Int8Array;
}

export interface ShapeTemplate {
  readonly geometry: ShapeGeometry;
  readonly pieces: readonly TemplatePiece[];
}

type Vec = [number, number, number];

const unit = (v: Vec): Vec => {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
};
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Each corner of a face pulled in from both its edges by `bevel`, within the face's plane. */
function insetFace(points: readonly Vec[], normal: Vec, bevel: number): Vec[] {
  const count = points.length;
  // The direction into the face from each edge, edge k running from points[k] to points[k + 1].
  const inward: Vec[] = [];
  for (let k = 0; k < count; k++) {
    const a = points[k] as Vec;
    const b = points[(k + 1) % count] as Vec;
    inward.push(unit(cross(normal, unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]))));
  }
  const out: Vec[] = [];
  for (let k = 0; k < count; k++) {
    const before = inward[(k + count - 1) % count] as Vec;
    const after = inward[k] as Vec;
    // The corner moves along the bisector far enough that both edges move in by `bevel`.
    const scale = bevel / (1 + dot(before, after));
    const p = points[k] as Vec;
    out.push([
      p[0] + (before[0] + after[0]) * scale,
      p[1] + (before[1] + after[1]) * scale,
      p[2] + (before[2] + after[2]) * scale,
    ]);
  }
  return out;
}

/** Tile coordinates for the inset corners of a face: its tile is fitted over the face's bounding rectangle. */
function panelUv(
  face: ShapeGeometry['faces'][number],
  corners: readonly Vec[],
  originals: readonly Vec[],
  bevel: number,
): number[] {
  let tu: Vec;
  let tv: Vec;
  const normal = face.normal as Vec;
  if (face.side >= 0) {
    const [a, b] = SIDE_TANGENTS[face.side >> 1] as readonly [number, number];
    tu = [0, 0, 0];
    tv = [0, 0, 0];
    tu[a] = 1;
    tv[b] = 1;
  } else {
    // A slanted face: u runs level along it, v up its slope.
    tu = Math.abs(normal[1]) > 0.999 ? [1, 0, 0] : unit(cross([0, 1, 0], normal));
    tv = cross(normal, tu);
  }
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of originals) {
    const u = dot(p, tu);
    const v = dot(p, tv);
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const fit = (c: number, extent: number): number =>
    bevel + (c - bevel) * ((1 - 2 * bevel) / Math.max(extent - 2 * bevel, 1e-6));
  const uv: number[] = [];
  for (const p of corners) {
    uv.push(fit(dot(p, tu) - u0, u1 - u0), fit(dot(p, tv) - v0, v1 - v0));
  }
  return uv;
}

/** What darkens a corner of a piece that lies on `face` at `p`, as `TemplatePiece.ao` encodes it. */
function aoKey(face: ShapeGeometry['faces'][number], p: Vec): number {
  let side = face.side;
  let inside = 0;
  if (side < 0) {
    const n = face.normal;
    let axis = -1;
    for (let k = 0; k < 3; k++) if (Math.abs(n[k] as number) > 0.999) axis = k;
    if (axis < 0) return -1;
    side = axis * 2 + ((n[axis] as number) > 0 ? 0 : 1);
    inside = 1;
  }
  const [a, b] = SIDE_TANGENTS[side >> 1] as readonly [number, number];
  const corner = ((p[a] as number) > 0.5 ? 1 : 0) + ((p[b] as number) > 0.5 ? 2 : 0);
  return side * 8 + corner * 2 + inside;
}

export function buildTemplate(geometry: ShapeGeometry, bevel: number): ShapeTemplate {
  const faces = geometry.faces;
  const originals = faces.map((f) => f.loop.map((i) => geometry.vertices[i] as Vec));
  const insets = faces.map((f, i) => insetFace(originals[i] as Vec[], f.normal as Vec, bevel));
  const pieces: TemplatePiece[] = [];

  const makePiece = (
    kind: number,
    face: number,
    corners: readonly { p: Vec; from: number }[],
    normal: Vec,
    uv: readonly number[],
  ): TemplatePiece => {
    const position = new Float64Array(corners.length * 3);
    const ao = new Int8Array(corners.length);
    corners.forEach(({ p, from }, k) => {
      position.set(p, k * 3);
      ao[k] = aoKey(faces[from] as ShapeGeometry['faces'][number], p);
    });
    return { kind, face, count: corners.length, position, uv: Float64Array.from(uv), normal, ao };
  };

  // Panels.
  faces.forEach((face, i) => {
    const corners = (insets[i] as Vec[]).map((p) => ({ p, from: i }));
    pieces.push(
      makePiece(
        PIECE.panel,
        i,
        corners,
        face.normal as Vec,
        panelUv(face, insets[i] as Vec[], originals[i] as Vec[], bevel),
      ),
    );
  });

  const band = (count: number): number[] => {
    const uv: number[] = [];
    for (let k = 0; k < count; k++) uv.push(BAND_U, BAND_V);
    return uv;
  };

  // Strips: each edge is walked once by each of the two faces that share it, in opposite directions.
  const edgeOwners = new Map<string, { face: number; at: number }[]>();
  faces.forEach((face, i) => {
    const loop = face.loop;
    for (let k = 0; k < loop.length; k++) {
      const a = loop[k] as number;
      const b = loop[(k + 1) % loop.length] as number;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const list = edgeOwners.get(key) ?? [];
      list.push({ face: i, at: k });
      edgeOwners.set(key, list);
    }
  });
  for (const owners of edgeOwners.values()) {
    if (owners.length !== 2)
      throw new Error('A shape must be a closed solid: every edge joins two faces');
    const [f, g] = owners as [{ face: number; at: number }, { face: number; at: number }];
    const fLoop = (faces[f.face] as ShapeGeometry['faces'][number]).loop;
    const gLoop = (faces[g.face] as ShapeGeometry['faces'][number]).loop;
    const fa = (insets[f.face] as Vec[])[f.at] as Vec;
    const fb = (insets[f.face] as Vec[])[(f.at + 1) % fLoop.length] as Vec;
    // Face g walks the edge the other way: it meets b first and then a.
    const gb = (insets[g.face] as Vec[])[g.at] as Vec;
    const ga = (insets[g.face] as Vec[])[(g.at + 1) % gLoop.length] as Vec;
    const nf = (faces[f.face] as ShapeGeometry['faces'][number]).normal as Vec;
    const ng = (faces[g.face] as ShapeGeometry['faces'][number]).normal as Vec;
    pieces.push(
      makePiece(
        PIECE.strip,
        Math.min(f.face, g.face),
        [
          { p: fa, from: f.face },
          { p: fb, from: f.face },
          { p: gb, from: g.face },
          { p: ga, from: g.face },
        ],
        unit([nf[0] + ng[0], nf[1] + ng[1], nf[2] + ng[2]]),
        band(4),
      ),
    );
  }

  // Corners: around each vertex, the faces that meet there in turn.
  for (let v = 0; v < geometry.vertices.length; v++) {
    const around: { face: number; at: number }[] = [];
    faces.forEach((face, i) => {
      const at = face.loop.indexOf(v);
      if (at >= 0) around.push({ face: i, at });
    });
    if (around.length < 3)
      throw new Error('A shape must be a closed solid: every corner joins three faces');
    // Put the faces in order around the vertex: leave one along the edge toward the next corner of
    // its loop, and the next face is the one that walks that edge back to the vertex.
    const ordered = [around[0] as (typeof around)[number]];
    while (ordered.length < around.length) {
      const last = ordered[ordered.length - 1] as (typeof around)[number];
      const loop = (faces[last.face] as ShapeGeometry['faces'][number]).loop;
      const next = loop[(last.at + 1) % loop.length] as number;
      const following = around.find((e) => {
        const l = (faces[e.face] as ShapeGeometry['faces'][number]).loop;
        return !ordered.includes(e) && l[(e.at + l.length - 1) % l.length] === next;
      });
      if (!following)
        throw new Error('A shape must be a closed solid: the faces around a corner do not close');
      ordered.push(following);
    }
    const sum: Vec = [0, 0, 0];
    for (const e of ordered) {
      const n = (faces[e.face] as ShapeGeometry['faces'][number]).normal;
      sum[0] += n[0];
      sum[1] += n[1];
      sum[2] += n[2];
    }
    pieces.push(
      makePiece(
        PIECE.corner,
        (ordered[0] as (typeof around)[number]).face,
        ordered.map((e) => ({ p: (insets[e.face] as Vec[])[e.at] as Vec, from: e.face })),
        unit(sum),
        band(ordered.length),
      ),
    );
  }

  return { geometry, pieces };
}
