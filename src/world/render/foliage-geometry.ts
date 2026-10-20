import { BufferAttribute, BufferGeometry } from 'three';
import { createRng } from '../../shared/hash';

/** What a vertex belongs to, read by the foliage shaders from `aInfo.y`. */
export const PART_TRUNK = 0;
export const PART_LEAF = 1;
export const PART_FLAT = 2;

export type Lod = 0 | 1 | 2;
type Vec3 = readonly [number, number, number];

/** Height of the unit-scale models, in meters. */
export const PINE_HEIGHT = 12;
export const BROADLEAF_HEIGHT = 8.5;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Collects vertices into one indexed geometry. `aInfo` is (sway weight, part, ambient shade). */
class ModelBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly info: number[] = [];
  private readonly indices: number[] = [];

  vertex(
    p: Vec3,
    n: Vec3,
    u: number,
    v: number,
    sway: number,
    part: number,
    shade: number,
  ): number {
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    this.uvs.push(u, v);
    this.info.push(sway, part, shade);
    return this.positions.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  /** A tapered tube along +y; rings share vertices so the side is smooth. */
  tube(
    from: Vec3,
    to: Vec3,
    r0: number,
    r1: number,
    sides: number,
    rings: number,
    swayBase: number,
    swayTop: number,
    uvScale: number,
  ): void {
    const axis = norm([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
    // Any vector not parallel to the axis gives a stable frame.
    const ref: Vec3 = Math.abs(axis[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    const u = norm([
      ref[1] * axis[2] - ref[2] * axis[1],
      ref[2] * axis[0] - ref[0] * axis[2],
      ref[0] * axis[1] - ref[1] * axis[0],
    ]);
    const w: Vec3 = [
      axis[1] * u[2] - axis[2] * u[1],
      axis[2] * u[0] - axis[0] * u[2],
      axis[0] * u[1] - axis[1] * u[0],
    ];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const first = this.positions.length / 3;
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const r = r0 + (r1 - r0) * t;
      const cx = from[0] + (to[0] - from[0]) * t;
      const cy = from[1] + (to[1] - from[1]) * t;
      const cz = from[2] + (to[2] - from[2]) * t;
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const n: Vec3 = [u[0] * ca + w[0] * sa, u[1] * ca + w[1] * sa, u[2] * ca + w[2] * sa];
        this.vertex(
          [cx + n[0] * r, cy + n[1] * r, cz + n[2] * r],
          n,
          i / sides,
          t * length * uvScale,
          swayBase + (swayTop - swayBase) * t,
          PART_TRUNK,
          1,
        );
      }
    }
    const row = sides + 1;
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < sides; i++) {
        const a = first + j * row + i;
        this.quad(a, a + 1, a + 1 + row, a + row);
      }
    }
  }

  /** A cone as a flat-colored far-distance stand-in. */
  cone(y0: number, y1: number, radius: number, sides: number, shade: number, part: number): void {
    const apex = this.vertex([0, y1, 0], [0, 1, 0], 0.5, 1, 0.7, part, shade);
    const ring: number[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const n = norm([Math.cos(a), 0.55, Math.sin(a)]);
      ring.push(
        this.vertex(
          [Math.cos(a) * radius, y0, Math.sin(a) * radius],
          n,
          0.5,
          0,
          0.5,
          part,
          shade * 0.72,
        ),
      );
    }
    for (let i = 0; i < sides; i++)
      this.tri(apex, ring[i] as number, ring[(i + 1) % sides] as number);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    g.setAttribute('aInfo', new BufferAttribute(new Float32Array(this.info), 3));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

/** A drooping frond on a radial bough: `segments` strips from the trunk out to `reach`. */
function bough(
  m: ModelBuilder,
  angle: number,
  y: number,
  reach: number,
  width: number,
  droop: number,
  segments: number,
  height: number,
  lift: number,
): void {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const sx = -dz;
  const sz = dx;
  const normal = norm([dx * 0.72, 0.66 + lift, dz * 0.72]);
  const rows: [number, number][] = [];
  for (let j = 0; j <= segments; j++) {
    const t = j / segments;
    const r = 0.22 + (reach - 0.22) * t;
    const py = y - droop * reach * Math.pow(t, 1.35);
    const w = width * (1 - 0.12 * t) * 0.5;
    const hy = py / height;
    const sway = Math.pow(Math.max(hy, 0), 1.3) * (0.3 + 0.7 * t);
    const shade = (0.4 + 0.6 * t) * (0.58 + 0.42 * hy);
    // The edges hang a little lower than the spine, so the frond is slightly V-shaped.
    const left = m.vertex(
      [dx * r - sx * w, py - w * 0.16, dz * r - sz * w],
      normal,
      0,
      t,
      sway,
      PART_LEAF,
      shade,
    );
    const right = m.vertex(
      [dx * r + sx * w, py - w * 0.16, dz * r + sz * w],
      normal,
      1,
      t,
      sway,
      PART_LEAF,
      shade,
    );
    rows.push([left, right]);
  }
  for (let j = 0; j < segments; j++) {
    const a = rows[j] as [number, number];
    const b = rows[j + 1] as [number, number];
    m.quad(a[0], a[1], b[1], b[0]);
  }
}

export function buildPine(lod: Lod): BufferGeometry {
  const m = new ModelBuilder();
  const H = PINE_HEIGHT;
  m.tube(
    [0, 0, 0],
    [0, H * 0.97, 0],
    0.36,
    0.05,
    lod === 2 ? 4 : 7,
    lod === 0 ? 5 : 2,
    0,
    0.25,
    0.22,
  );
  const rng = createRng(0x51e0 + lod);

  if (lod === 2) {
    // Three stacked cones in flat color; only seen through heavy haze.
    for (let k = 0; k < 3; k++) {
      const f = k / 2;
      m.cone(
        H * (0.12 + 0.3 * f),
        H * (0.5 + 0.5 * f + 0.02),
        2.8 * (1 - 0.62 * f),
        6,
        0.85 - 0.25 * (1 - f),
        PART_FLAT,
      );
    }
    return m.geometry();
  }

  const tiers = lod === 0 ? 12 : 8;
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1);
    const y = H * (0.13 + 0.82 * f);
    const reach = 3.2 * Math.pow(1 - f * 0.93, 0.95);
    const count = Math.max(5, Math.round(reach * (lod === 0 ? 5.4 : 3.6)));
    const width = ((Math.PI * 2 * reach) / count) * 1.25 + 0.3;
    const offset = rng() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = offset + (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.14;
      bough(
        m,
        a,
        y + (rng() - 0.5) * 0.18,
        reach * (0.9 + 0.2 * rng()),
        width,
        0.55,
        lod === 0 ? 2 : 1,
        H,
        0,
      );
    }
    if (lod === 0 && k % 2 === 0) {
      // A shorter, offset ring below fills the gaps between the boughs above.
      const count2 = Math.max(5, Math.round(reach * 4.4));
      const width2 = ((Math.PI * 2 * reach * 0.8) / count2) * 1.25 + 0.3;
      for (let i = 0; i < count2; i++) {
        const a = offset + ((i + 0.5) / count2) * Math.PI * 2;
        bough(
          m,
          a,
          y - 0.6 - rng() * 0.2,
          reach * 0.78 * (0.9 + 0.2 * rng()),
          width2,
          0.5,
          2,
          H,
          0.08,
        );
      }
    }
  }
  // The leader: two crossed fronds pointing up.
  for (let i = 0; i < 2; i++) {
    const a = (i / 2) * Math.PI;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const up = norm([dx * 0.3, 1, dz * 0.3]);
    const y0 = H * 0.9;
    const y1 = H * 1.045;
    const w = 0.42;
    const a0 = m.vertex([-dx * w, y0, -dz * w], up, 0, 0.0, 0.9, PART_LEAF, 0.95);
    const a1 = m.vertex([dx * w, y0, dz * w], up, 1, 0.0, 0.9, PART_LEAF, 0.95);
    const a2 = m.vertex([dx * w * 0.2, y1, dz * w * 0.2], up, 1, 1.0, 1, PART_LEAF, 1);
    const a3 = m.vertex([-dx * w * 0.2, y1, -dz * w * 0.2], up, 0, 1.0, 1, PART_LEAF, 1);
    m.quad(a0, a1, a2, a3);
  }
  return m.geometry();
}

export function buildBroadleaf(lod: Lod): BufferGeometry {
  const m = new ModelBuilder();
  const H = BROADLEAF_HEIGHT;
  const rng = createRng(0xb10d + lod);
  const centerY = H * 0.7;
  const radii: Vec3 = [H * 0.42, H * 0.31, H * 0.42];
  const trunkTop = H * 0.46;

  m.tube(
    [0, 0, 0],
    [0.12, trunkTop, 0.06],
    0.32,
    0.17,
    lod === 2 ? 4 : 7,
    lod === 0 ? 4 : 2,
    0,
    0.12,
    0.2,
  );

  if (lod === 2) {
    // A few flat-colored blobs for the canopy.
    const blob = (x: number, y: number, z: number, r: number, shade: number): void => {
      const c = m.vertex([x, y + r * 0.9, z], [0, 1, 0], 0.5, 1, 0.8, PART_FLAT, shade);
      const ring: number[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const n = norm([Math.cos(a), 0.45, Math.sin(a)]);
        ring.push(
          m.vertex(
            [x + Math.cos(a) * r, y, z + Math.sin(a) * r],
            n,
            0.5,
            0,
            0.6,
            PART_FLAT,
            shade * 0.7,
          ),
        );
      }
      for (let i = 0; i < 6; i++) m.tri(c, ring[i] as number, ring[(i + 1) % 6] as number);
      const low = m.vertex([x, y - r * 0.7, z], [0, -0.4, 0], 0.5, 0, 0.4, PART_FLAT, shade * 0.45);
      for (let i = 0; i < 6; i++) m.tri(low, ring[(i + 1) % 6] as number, ring[i] as number);
    };
    blob(0, centerY - 0.4, 0, H * 0.3, 0.9);
    blob(H * 0.18, centerY + 0.2, H * 0.1, H * 0.22, 1);
    blob(-H * 0.16, centerY - 0.1, -H * 0.12, H * 0.22, 0.95);
    return m.geometry();
  }

  const branches = lod === 0 ? 4 : 3;
  const clusters = lod === 0 ? 34 : 15;
  const centers: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < clusters; i++) {
    // Fibonacci shell with a random radial depth: even coverage with an uneven edge.
    const yy = 1 - ((i + 0.5) / clusters) * 1.55;
    const ring = Math.sqrt(Math.max(0, 1 - yy * yy));
    const a = i * golden + rng();
    const depth = 0.45 + 0.55 * Math.sqrt(rng());
    centers.push([
      Math.cos(a) * ring * radii[0] * depth,
      centerY + yy * radii[1] * depth,
      Math.sin(a) * ring * radii[2] * depth,
    ]);
  }

  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * Math.PI * 2 + rng() * 0.5;
    const target = centers[Math.floor((i / branches) * clusters * 0.8) + 2] as Vec3;
    const from: Vec3 = [0.12 * 0.9, trunkTop * (0.72 + 0.2 * rng()), 0.06 * 0.9];
    const to: Vec3 = [
      target[0] * 0.55 + Math.cos(a) * 0.3,
      target[1] - 0.45,
      target[2] * 0.55 + Math.sin(a) * 0.3,
    ];
    m.tube(from, to, 0.15, 0.05, 5, 2, 0.1, 0.35, 0.3);
  }

  const size = lod === 0 ? 3.2 : 5.0;
  for (let i = 0; i < clusters; i++) {
    const c = centers[i] as Vec3;
    const rel: Vec3 = [c[0] / radii[0], (c[1] - centerY) / radii[1], c[2] / radii[2]];
    const shell = Math.min(1, Math.hypot(rel[0], rel[1], rel[2]));
    const bent = norm([rel[0], rel[1] * 0.8 + 0.28, rel[2]]);
    const shade =
      (0.42 + 0.58 * smooth(0.25, 1, shell)) * (0.62 + 0.38 * smooth(-0.9, 0.9, rel[1]));
    const sway = 0.45 + 0.55 * shell;
    const half = (size * (0.8 + 0.4 * rng())) / 2;
    const cards = lod === 0 ? 3 : 2;
    const yaw0 = rng() * Math.PI;
    for (let k = 0; k < cards; k++) {
      const yaw = yaw0 + (k * Math.PI) / cards;
      // Each card is a square through the cluster center; the last one lies flatter.
      const tilt = k === cards - 1 && lod === 0 ? 1.15 : 0.18 + 0.5 * rng();
      const ax: Vec3 = [Math.cos(yaw), 0, Math.sin(yaw)];
      const ay: Vec3 = norm([
        -Math.sin(yaw) * Math.sin(tilt),
        Math.cos(tilt),
        Math.cos(yaw) * Math.sin(tilt),
      ]);
      const corner = (sx: number, sy: number): Vec3 => [
        c[0] + (ax[0] * sx + ay[0] * sy) * half,
        c[1] + (ax[1] * sx + ay[1] * sy) * half,
        c[2] + (ax[2] * sx + ay[2] * sy) * half,
      ];
      const p0 = corner(-1, -1);
      const p1 = corner(1, -1);
      const p2 = corner(1, 1);
      const p3 = corner(-1, 1);
      const v0 = m.vertex(p0, bent, 0, 0, sway, PART_LEAF, shade * 0.9);
      const v1 = m.vertex(p1, bent, 1, 0, sway, PART_LEAF, shade * 0.9);
      const v2 = m.vertex(p2, bent, 1, 1, sway, PART_LEAF, shade);
      const v3 = m.vertex(p3, bent, 0, 1, sway, PART_LEAF, shade);
      m.quad(v0, v1, v2, v3);
    }
  }
  return m.geometry();
}

/** Three crossed, bending cards: one clump of grass or flowers, 1.1 m wide and 0.85 m tall. */
export function buildGrassClump(): BufferGeometry {
  const m = new ModelBuilder();
  const rows = 3;
  const width = 1.1;
  const height = 0.85;
  for (let q = 0; q < 3; q++) {
    const a = (q / 3) * Math.PI;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const row: [number, number][] = [];
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      const w = (width / 2) * (1 - 0.1 * t);
      const sway = t * t;
      const shade = 0.5 + 0.5 * t;
      const n: Vec3 = [dx * 0.0, 1, dz * 0.0];
      const l = m.vertex([-dx * w, t * height, -dz * w], n, 0, t, sway, PART_LEAF, shade);
      const r = m.vertex([dx * w, t * height, dz * w], n, 1, t, sway, PART_LEAF, shade);
      row.push([l, r]);
    }
    for (let j = 0; j < rows; j++) {
      const a0 = row[j] as [number, number];
      const b0 = row[j + 1] as [number, number];
      m.quad(a0[0], a0[1], b0[1], b0[0]);
    }
  }
  return m.geometry();
}
