import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  LatheGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The building blocks of the creatures' models: smooth ellipsoids, tubes that taper along a path,
 * flat leaves and lathed domes, each marked with what it is made of and how it moves, then welded
 * into one indexed geometry per species. Everything is smooth-shaded (the look directive asks for
 * smooth, detailed models, not pixel cubes) and built in code, so there is no asset to list.
 *
 * A model is in its own space: the ground under a walker's feet (the underside of a swimmer or a
 * flier) is the origin, its face is +Z and its left is +X, in blocks.
 */

export type Point = readonly [number, number, number];

/** Surface looks. Each is a slot of the species' palette, and the fragment shader paints with it. */
export const LOOK = {
  /** The main coat, skin or hide. */
  coat: 0,
  /** The underside, and anything pale on the creature (a chin, a rump patch, a breast). */
  belly: 1,
  /** Horn, bone, shell or feather: the hard or flight parts. */
  trim: 2,
  /** Hooves, noses, beaks, claws and the seams between plates. */
  dark: 3,
  /** The eyes, which glow red once the creature is angry. */
  eye: 4,
  /** What the coat's markings are painted in (spots, moss, stripes, dapples). */
  mark: 5,
  /** Light the creature gives off (a jelly's lantern, a mushroom cap). */
  glow: 6,
  /** The other coat that a share of the species wear. */
  alt: 7,
} as const;

/** How many looks a palette holds. */
export const LOOK_COUNT = 8;

/** How a piece moves: the vertex shader reads this to bend, swing, flap, undulate or pulse it. */
export const HOW = {
  /** Rigid with the body. */
  body: 0,
  /** The upper segment of a leg, swinging about the hip. */
  leg: 1,
  /** The lower segment of a leg, hinged at the knee under the swing of the upper. */
  lowerLeg: 2,
  /** The head and neck, which lower to graze, rise to look and thrust to strike. */
  head: 3,
  /** An ear or a tail, which lifts as the creature is alarmed. */
  limp: 4,
  /** A wing, which flaps about the shoulder and sweeps back to dive. */
  wing: 5,
  /** A body that undulates from the head to the tail, by the weight of each vertex. */
  spine: 6,
  /** The flat disc of a ray, which ripples from its middle out to its edges. */
  fin: 7,
  /** A jelly's bell, which pulses. */
  bell: 8,
  /** A trailing tentacle, which waves by the weight of each vertex. */
  tentacle: 9,
} as const;

const vec = (p: Point): Vector3 => new Vector3(p[0], p[1], p[2]);

/** Scales, turns (Euler angles, in the order Y, X, Z) and moves a geometry, with its normals. */
function placed(
  geometry: BufferGeometry,
  at: Point,
  scale: Point,
  turn: Point = [0, 0, 0],
): BufferGeometry {
  const rotation = new Quaternion().setFromEuler(new Euler(turn[0], turn[1], turn[2], 'YXZ'));
  return geometry.applyMatrix4(new Matrix4().compose(vec(at), rotation, vec(scale)));
}

/** An ellipsoid with these half-sizes about this point. A positive turn about X tips its front end down. */
export function ellipsoid(
  radii: Point,
  at: Point,
  turn?: Point,
  detail: readonly [number, number] = [10, 6],
): BufferGeometry {
  return placed(new SphereGeometry(1, detail[0], detail[1]), at, radii, turn);
}

export interface TubeOptions {
  /** Corners round the tube. */
  sides?: number;
  /** The tube's size along its second axis against its first: 1 is round, less is a flat blade. */
  squash?: number;
  /** The direction the first axis is taken at right angles to; the second is at right angles to both. */
  ref?: Point;
  /** Which ends are closed. An end buried in another piece, or tapered to a point, can go open. */
  caps?: 'both' | 'start' | 'end' | 'none';
}

/**
 * A smooth tube along a path, as thick as `radii` says at each point of it. With the default
 * reference, a tube that runs along Z has its first axis along X (its width) and its second along Y
 * (its depth); one along X has the first axis along -Z (the chord of a wing) and the second along Y.
 * Every vertex gets `aWeight`, how far along the path it is (0 to 1), for the pieces that bend by it.
 */
export function tube(
  path: readonly Point[],
  radii: readonly number[],
  options: TubeOptions = {},
): BufferGeometry {
  const { sides = 6, squash = 1, ref = [0, 1, 0], caps = 'both' } = options;
  const rings = path.length;
  const centres = path.map(vec);
  const lengths = [0];
  for (let i = 1; i < rings; i++) {
    lengths.push(
      (lengths[i - 1] as number) + (centres[i] as Vector3).distanceTo(centres[i - 1] as Vector3),
    );
  }
  const total = (lengths[rings - 1] as number) || 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const along: number[] = [];
  const index: number[] = [];

  const tangent = new Vector3();
  const first = new Vector3();
  const second = new Vector3();
  const offset = new Vector3();
  const normal = new Vector3();
  const references = [vec(ref), new Vector3(1, 0, 0), new Vector3(0, 0, 1)];

  const frame = (i: number): void => {
    const before = centres[Math.max(i - 1, 0)] as Vector3;
    const after = centres[Math.min(i + 1, rings - 1)] as Vector3;
    tangent.subVectors(after, before).normalize();
    for (const reference of references) {
      first.crossVectors(reference, tangent);
      if (first.lengthSq() > 1e-4) break;
    }
    first.normalize();
    second.crossVectors(tangent, first);
  };

  for (let i = 0; i < rings; i++) {
    frame(i);
    const r = radii[i] as number;
    const behind = Math.max(i - 1, 0);
    const ahead = Math.min(i + 1, rings - 1);
    const run = (lengths[ahead] as number) - (lengths[behind] as number);
    const slope = run > 0 ? ((radii[ahead] as number) - (radii[behind] as number)) / run : 0;
    const c = centres[i] as Vector3;
    for (let j = 0; j < sides; j++) {
      const angle = (j / sides) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      offset
        .copy(first)
        .multiplyScalar(cos)
        .addScaledVector(second, sin * squash);
      positions.push(c.x + offset.x * r, c.y + offset.y * r, c.z + offset.z * r);
      normal
        .copy(first)
        .multiplyScalar(cos)
        .addScaledVector(second, sin / squash)
        .addScaledVector(tangent, -slope)
        .normalize();
      normals.push(normal.x, normal.y, normal.z);
      along.push((lengths[i] as number) / total);
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j;
      const b = i * sides + ((j + 1) % sides);
      const c = (i + 1) * sides + j;
      const d = (i + 1) * sides + ((j + 1) % sides);
      index.push(a, b, c, b, d, c);
    }
  }

  // A cap is a flat fan with its own vertices, so that its edge does not shade into the tube's side.
  const close = (ring: number, outward: 1 | -1): void => {
    frame(ring);
    const c = centres[ring] as Vector3;
    const hub = positions.length / 3;
    positions.push(c.x, c.y, c.z);
    normals.push(tangent.x * outward, tangent.y * outward, tangent.z * outward);
    along.push((lengths[ring] as number) / total);
    for (let j = 0; j < sides; j++) {
      const at = (ring * sides + j) * 3;
      positions.push(
        positions[at] as number,
        positions[at + 1] as number,
        positions[at + 2] as number,
      );
      normals.push(tangent.x * outward, tangent.y * outward, tangent.z * outward);
      along.push((lengths[ring] as number) / total);
    }
    for (let j = 0; j < sides; j++) {
      const a = hub + 1 + j;
      const b = hub + 1 + ((j + 1) % sides);
      if (outward > 0) index.push(hub, a, b);
      else index.push(hub, b, a);
    }
  };
  if (caps === 'both' || caps === 'start') close(0, -1);
  if (caps === 'both' || caps === 'end') close(rings - 1, 1);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('aWeight', new BufferAttribute(new Float32Array(along), 1));
  geometry.setIndex(index);
  return geometry;
}

/** A flat, convex outline (a fin, a vane, a barb), drawn from both sides. */
export function leaf(points: readonly Point[]): BufferGeometry {
  const count = points.length;
  const first = vec(points[0] as Point);
  const normal = new Vector3()
    .crossVectors(vec(points[1] as Point).sub(first), vec(points[2] as Point).sub(first))
    .normalize();
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  for (const side of [1, -1]) {
    const base = positions.length / 3;
    for (const p of points) {
      positions.push(p[0], p[1], p[2]);
      normals.push(normal.x * side, normal.y * side, normal.z * side);
    }
    for (let i = 1; i < count - 1; i++) {
      if (side > 0) index.push(base, base + i, base + i + 1);
      else index.push(base, base + i + 1, base + i);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setIndex(index);
  return geometry;
}

/** A dome or bowl turned from a profile of (radius, height) points from the bottom up, then scaled and moved. */
export function lathe(
  profile: readonly (readonly [number, number])[],
  segments: number,
  at: Point,
  scale: Point = [1, 1, 1],
): BufferGeometry {
  const points = profile.map(([r, y]) => new Vector2(r, y));
  return placed(new LatheGeometry(points, segments), at, scale);
}

/** How a piece looks and moves. */
export interface Rig {
  look: number;
  how?: number;
  /** For a leg, its place in the stride in half turns; for an ear or a tail, how far it lifts with alarm, in radians; for a tentacle, its own phase. */
  group?: number;
  /** For a wing, a jaw or a fin, which side it is on (1 left, -1 right). */
  side?: number;
  /** Where it turns: the hip, the neck's base, a shoulder, the middle of a bell. */
  hip?: Point;
  /** Where a lower leg bends. */
  knee?: Point;
  /** `true` keeps how far along its tube each vertex is; a function gives the weight from the vertex itself. */
  weight?: true | ((x: number, y: number, z: number) => number);
}

/** Marks every vertex of a piece with what it is made of, how it moves and where it turns. */
export function rigged(geometry: BufferGeometry, rig: Rig): BufferGeometry {
  const { look, how = HOW.body, group = 0, side = 0, hip = [0, 0, 0], knee = [0, 0, 0] } = rig;
  const position = geometry.getAttribute('position');
  const count = position.count;
  const along = geometry.getAttribute('aWeight');
  const part = new Float32Array(count * 4);
  const pivot = new Float32Array(count * 3);
  const aux = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    part.set([look, how, group, side], i * 4);
    pivot.set(hip, i * 3);
    let weight = 0;
    if (typeof rig.weight === 'function') {
      weight = rig.weight(position.getX(i), position.getY(i), position.getZ(i));
    } else if (rig.weight && along) {
      weight = along.getX(i);
    }
    aux.set([weight, knee[0], knee[1], knee[2]], i * 4);
  }
  geometry.setAttribute('aPart', new BufferAttribute(part, 4));
  geometry.setAttribute('aHip', new BufferAttribute(pivot, 3));
  geometry.setAttribute('aAux', new BufferAttribute(aux, 4));
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('aWeight');
  return geometry;
}

/**
 * Welds the pieces of a model into one indexed geometry, then slides the whole of it `shiftZ` along
 * its length and `shiftY` up, so that the model lies about the middle of the animal and not of its
 * body, and so that the underside of a bird sits on the origin.
 */
export function weld(
  parts: BufferGeometry[],
  name: string,
  shiftZ = 0,
  shiftY = 0,
): BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`The ${name} could not be put together`);
  if (shiftZ !== 0 || shiftY !== 0) {
    const position = merged.getAttribute('position');
    const pivot = merged.getAttribute('aHip');
    const aux = merged.getAttribute('aAux');
    for (let i = 0; i < position.count; i++) {
      position.setY(i, position.getY(i) + shiftY);
      position.setZ(i, position.getZ(i) + shiftZ);
      pivot.setY(i, pivot.getY(i) + shiftY);
      pivot.setZ(i, pivot.getZ(i) + shiftZ);
      aux.setZ(i, aux.getZ(i) + shiftY);
      aux.setW(i, aux.getW(i) + shiftZ);
    }
  }
  return merged;
}

/** The same point on the other side of the body. */
export const across = (side: number, p: Point): Point => [p[0] * side, p[1], p[2]];

/** A path mirrored the same way. */
export const acrossAll = (side: number, path: readonly Point[]): Point[] =>
  path.map((p) => across(side, p));

/** How many triangles a welded model has. */
export function triangleCount(geometry: BufferGeometry): number {
  const index = geometry.getIndex();
  return index ? index.count / 3 : geometry.getAttribute('position').count / 3;
}
