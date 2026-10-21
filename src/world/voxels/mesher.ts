import type { BlockWorld } from '../../shared/block-world';
import { TILE_LAYOUTS, stateMaterial } from '../../shared/blocks';
import { CHUNK_SIZE } from './chunk';

/**
 * Turns a chunk of cells into a triangle mesh. Every block is a cube with chamfered edges and
 * corners, so a wall of blocks shows the seam between them as a small groove and nothing is ever
 * merged into a bigger face. A block is made of up to four kinds of piece:
 *
 *  - panels, the six faces pulled in by the bevel width, drawn only where the cell across is empty;
 *  - strips, the 45 degree chamfers along the twelve edges;
 *  - corner triangles, the chamfers across the eight corners;
 *  - caps, which close the small shaft that opens where four blocks meet along an edge.
 *
 * What is drawn depends only on the 26 cells around a block, which is why a changed cell dirties
 * the chunks next to it. The union of the pieces is a closed surface wherever blocks are placed,
 * which `tests/unit/voxel-mesher.test.ts` checks over random worlds.
 *
 * This module is pure: it reads cells through `getBlock` and returns typed arrays, so it runs
 * under Vitest and could move to a Worker without changes.
 */

/** Width of the chamfer on every block edge in meters; the spec allows 0.05 to 0.12. */
export const BEVEL = 0.08;

/** Brightness of a face corner by how many of its neighbours box it in: 0 fully boxed in, 3 open. */
export const AO_BRIGHTNESS = [0.46, 0.64, 0.82, 1] as const;

/** Brightness of the groove between blocks and the shafts at their corners. */
export const GROOVE_BRIGHTNESS = 0.58;

/** What a vertex belongs to, so the shader can tell a bevel from a face. */
export const PRIMITIVE = { panel: 0, strip: 1, corner: 2, cap: 3 } as const;

/** The mesh of one chunk, ready to become a geometry. Positions are in world coordinates. */
export interface ChunkMeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** Texture coordinates inside the block face's tile; 0 to 1, with the bevel in the outer band. */
  readonly uvs: Float32Array;
  /**
   * Four bytes a vertex: ambient occlusion, material id, primitive kind in the low two bits with
   * the tile layout of the face above it, per-block random seed.
   */
  readonly aux: Uint8Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
  /** Box around the vertices: x0, y0, z0, x1, y1, z1. */
  readonly bounds: readonly [number, number, number, number, number, number];
}

// Neighbourhood bits: the 27 cells around (and including) a block, one bit each.
const bit = (dx: number, dy: number, dz: number): number =>
  1 << (dx + 1 + 3 * (dy + 1) + 9 * (dz + 1));
const CENTER = bit(0, 0, 0);
const FULL = (1 << 27) - 1;

/** The two axes along a face of each axis, in increasing order. */
const TANGENTS: readonly (readonly [number, number])[] = [
  [1, 2],
  [0, 2],
  [0, 1],
];

interface FaceDef {
  readonly axis: number;
  readonly sign: number;
  readonly t1: number;
  readonly t2: number;
  /** The neighbour across the face. */
  readonly bit: number;
  readonly dir: readonly [number, number, number];
}

/** Faces are numbered axis * 2 + (negative ? 1 : 0): +x, -x, +y, -y, +z, -z. */
const FACES: readonly FaceDef[] = (() => {
  const faces: FaceDef[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [1, -1]) {
      const dir: [number, number, number] = [0, 0, 0];
      dir[axis] = sign;
      const [t1, t2] = TANGENTS[axis] as readonly [number, number];
      faces.push({ axis, sign, t1, t2, bit: bit(dir[0], dir[1], dir[2]), dir });
    }
  }
  return faces;
})();

interface EdgeDef {
  readonly fa: number;
  readonly fb: number;
  /** The two neighbours across the faces and the one across the edge. */
  readonly need: number;
}

const EDGES: readonly EdgeDef[] = (() => {
  const edges: EdgeDef[] = [];
  for (let fa = 0; fa < 6; fa++) {
    for (let fb = fa + 1; fb < 6; fb++) {
      const a = FACES[fa] as FaceDef;
      const b = FACES[fb] as FaceDef;
      if (a.axis === b.axis) continue;
      const need =
        a.bit | b.bit | bit(a.dir[0] + b.dir[0], a.dir[1] + b.dir[1], a.dir[2] + b.dir[2]);
      edges.push({ fa, fb, need });
    }
  }
  return edges;
})();

interface CornerDef {
  /** Which side of the block the corner is on, per axis: +1 or -1. */
  readonly signs: readonly [number, number, number];
  /** The faces meeting at the corner, one per axis. */
  readonly faces: readonly [number, number, number];
  /** The seven other cells that share the corner. */
  readonly others: number;
  /** All eight cells that share it, the block included. */
  readonly all: number;
}

const CORNERS: readonly CornerDef[] = (() => {
  const corners: CornerDef[] = [];
  for (const sz of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sx of [-1, 1]) {
        let all = 0;
        for (const dx of [0, sx])
          for (const dy of [0, sy]) for (const dz of [0, sz]) all |= bit(dx, dy, dz);
        corners.push({
          signs: [sx, sy, sz],
          faces: [sx > 0 ? 0 : 1, sy > 0 ? 2 : 3, sz > 0 ? 4 : 5],
          others: all & ~CENTER,
          all,
        });
      }
    }
  }
  return corners;
})();

/** Index of the corner with these signs in CORNERS. */
const cornerIndex = (sx: number, sy: number, sz: number): number =>
  (sx > 0 ? 1 : 0) + (sy > 0 ? 2 : 0) + (sz > 0 ? 4 : 0);

/**
 * Per axis, the edge along it that the block "owns" for caps (the one on its positive side of both
 * other axes), the strip bits that say four blocks meet there, and the two corners at its ends.
 */
const CAP_EDGES = [0, 1, 2].map((axis) => {
  const [j, k] = TANGENTS[axis] as readonly [number, number];
  const fj = j * 2;
  const fk = k * 2;
  const edge = EDGES.find((e) => e.fa === Math.min(fj, fk) && e.fb === Math.max(fj, fk)) as EdgeDef;
  const corner = (end: number): CornerDef => {
    const s = [0, 0, 0];
    s[j] = 1;
    s[k] = 1;
    s[axis] = end === 1 ? 1 : -1;
    return CORNERS[cornerIndex(s[0] as number, s[1] as number, s[2] as number)] as CornerDef;
  };
  return { axis, j, k, need: edge.need, low: corner(0), high: corner(1) };
});

/** The three cells that decide a face corner's occlusion: the two beside it and the one diagonal. */
const AO_BITS: readonly (readonly [number, number, number])[] = (() => {
  const table: [number, number, number][] = [];
  for (const face of FACES) {
    for (let c = 0; c < 4; c++) {
      // The cell in front of the face, moved one step along each tangent toward the corner.
      const d1: [number, number, number] = [0, 0, 0];
      const d2: [number, number, number] = [0, 0, 0];
      d1[face.t1] = c & 1 ? 1 : -1;
      d2[face.t2] = c & 2 ? 1 : -1;
      const n = face.dir;
      table.push([
        bit(n[0] + d1[0], n[1] + d1[1], n[2] + d1[2]),
        bit(n[0] + d2[0], n[1] + d2[1], n[2] + d2[2]),
        bit(n[0] + d1[0] + d2[0], n[1] + d1[1] + d2[1], n[2] + d1[2] + d2[2]),
      ]);
    }
  }
  return table;
})();

/** Around a panel the corners go low-low, high-low, high-high, low-high; corner c is `c & 1` along t1 and `c & 2` along t2. */
const PANEL_ORDER = [0, 1, 3, 2] as const;
/** The four corners of a cap's diamond, as offsets from the edge's middle along the two other axes. */
const CAP_DJ = [-BEVEL, 0, BEVEL, 0] as const;
const CAP_DK = [0, -BEVEL, 0, BEVEL] as const;

const AO_BYTES = AO_BRIGHTNESS.map((v) => Math.round(v * 255));
const GROOVE_BYTE = Math.round(GROOVE_BRIGHTNESS * 255);
const SQRT1_2 = Math.SQRT1_2;
const SQRT1_3 = 1 / Math.sqrt(3);

/** Grows the output arrays as pieces are added, and hands out exact-size copies when done. */
class MeshBuilder {
  private vertexCapacity = 4096;
  private indexCapacity = 8192;
  private positions = new Float32Array(this.vertexCapacity * 3);
  private normals = new Float32Array(this.vertexCapacity * 3);
  private uvs = new Float32Array(this.vertexCapacity * 2);
  private aux = new Uint8Array(this.vertexCapacity * 4);
  private indices = new Uint32Array(this.indexCapacity);
  vertexCount = 0;
  indexCount = 0;
  private minX = Infinity;
  private minY = Infinity;
  private minZ = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  private maxZ = -Infinity;

  reset(): void {
    this.vertexCount = 0;
    this.indexCount = 0;
    this.minX = this.minY = this.minZ = Infinity;
    this.maxX = this.maxY = this.maxZ = -Infinity;
  }

  private growVertices(): void {
    this.vertexCapacity *= 2;
    const grow = <T extends Float32Array | Uint8Array>(old: T, length: number): T => {
      const next = new (old.constructor as new (n: number) => T)(length);
      next.set(old);
      return next;
    };
    this.positions = grow(this.positions, this.vertexCapacity * 3);
    this.normals = grow(this.normals, this.vertexCapacity * 3);
    this.uvs = grow(this.uvs, this.vertexCapacity * 2);
    this.aux = grow(this.aux, this.vertexCapacity * 4);
  }

  vertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
    ao: number,
    material: number,
    kind: number,
    seed: number,
  ): number {
    if (this.vertexCount === this.vertexCapacity) this.growVertices();
    const i = this.vertexCount++;
    const p = this.positions;
    p[i * 3] = x;
    p[i * 3 + 1] = y;
    p[i * 3 + 2] = z;
    const n = this.normals;
    n[i * 3] = nx;
    n[i * 3 + 1] = ny;
    n[i * 3 + 2] = nz;
    this.uvs[i * 2] = u;
    this.uvs[i * 2 + 1] = v;
    const a = this.aux;
    a[i * 4] = ao;
    a[i * 4 + 1] = material;
    a[i * 4 + 2] = kind;
    a[i * 4 + 3] = seed;
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (z < this.minZ) this.minZ = z;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
    if (z > this.maxZ) this.maxZ = z;
    return i;
  }

  private push(a: number, b: number, c: number): void {
    if (this.indexCount + 3 > this.indexCapacity) {
      this.indexCapacity *= 2;
      const next = new Uint32Array(this.indexCapacity);
      next.set(this.indices);
      this.indices = next;
    }
    this.indices[this.indexCount++] = a;
    this.indices[this.indexCount++] = b;
    this.indices[this.indexCount++] = c;
  }

  /** True when the triangle a, b, c faces the way (nx, ny, nz) points. */
  private faces(a: number, b: number, c: number, nx: number, ny: number, nz: number): boolean {
    const p = this.positions;
    const e1x = (p[b * 3] as number) - (p[a * 3] as number);
    const e1y = (p[b * 3 + 1] as number) - (p[a * 3 + 1] as number);
    const e1z = (p[b * 3 + 2] as number) - (p[a * 3 + 2] as number);
    const e2x = (p[c * 3] as number) - (p[a * 3] as number);
    const e2y = (p[c * 3 + 1] as number) - (p[a * 3 + 1] as number);
    const e2z = (p[c * 3 + 2] as number) - (p[a * 3 + 2] as number);
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    return cx * nx + cy * ny + cz * nz > 0;
  }

  /** A triangle wound to face the given normal. */
  triangle(a: number, b: number, c: number, nx: number, ny: number, nz: number): void {
    if (this.faces(a, b, c, nx, ny, nz)) this.push(a, b, c);
    else this.push(a, c, b);
  }

  /**
   * A flat four-cornered piece, given in order around its edge, wound to face the normal. It is
   * split along whichever diagonal joins the brighter pair, so shading does not run along a crease.
   */
  quad(a: number, b: number, c: number, d: number, nx: number, ny: number, nz: number): void {
    const ao = this.aux;
    const flip =
      (ao[b * 4] as number) + (ao[d * 4] as number) > (ao[a * 4] as number) + (ao[c * 4] as number);
    if (!this.faces(a, b, c, nx, ny, nz)) {
      const t = b;
      b = d;
      d = t;
    }
    if (flip) {
      this.push(b, c, d);
      this.push(b, d, a);
    } else {
      this.push(a, b, c);
      this.push(a, c, d);
    }
  }

  finish(): ChunkMeshData {
    const vertexCount = this.vertexCount;
    const indexCount = this.indexCount;
    let indices: Uint16Array | Uint32Array;
    if (vertexCount < 65536) {
      indices = new Uint16Array(indexCount);
      indices.set(this.indices.subarray(0, indexCount));
    } else {
      indices = this.indices.slice(0, indexCount);
    }
    return {
      positions: this.positions.slice(0, vertexCount * 3),
      normals: this.normals.slice(0, vertexCount * 3),
      uvs: this.uvs.slice(0, vertexCount * 2),
      aux: this.aux.slice(0, vertexCount * 4),
      indices,
      vertexCount,
      triangleCount: indexCount / 3,
      bounds:
        vertexCount === 0
          ? [0, 0, 0, 0, 0, 0]
          : [this.minX, this.minY, this.minZ, this.maxX, this.maxY, this.maxZ],
    };
  }
}

const PAD = CHUNK_SIZE + 2;
const PAD_AREA = PAD * PAD;

/**
 * The mesher. It holds scratch buffers between chunks, so make one and reuse it; `meshChunk`
 * below does. It is not reentrant.
 */
export class ChunkMesher {
  private readonly cells = new Uint16Array(PAD * PAD * PAD);
  private readonly builder = new MeshBuilder();
  /** The occlusion byte of each corner of each exposed face; unused for a hidden face. */
  private readonly faceAo = new Uint8Array(24);
  private readonly local = new Float64Array(3);
  /** The vertices of the piece being built, kept here so a piece costs no allocation. */
  private readonly ids = new Int32Array(4);
  private mask = 0;
  private x = 0;
  private y = 0;
  private z = 0;
  private hash = 0;
  private layoutHash = 0;
  private material = 0;

  /** Meshes the chunk at chunk coordinates (cx, cy, cz). The world's cells outside it are read for context. */
  mesh(world: Pick<BlockWorld, 'getBlock'>, cx: number, cy: number, cz: number): ChunkMeshData {
    const x0 = cx * CHUNK_SIZE;
    const y0 = cy * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const cells = this.cells;
    for (let py = 0; py < PAD; py++) {
      for (let pz = 0; pz < PAD; pz++) {
        const row = py * PAD_AREA + pz * PAD;
        for (let px = 0; px < PAD; px++) {
          cells[row + px] = world.getBlock(x0 - 1 + px, y0 - 1 + py, z0 - 1 + pz);
        }
      }
    }

    this.builder.reset();
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const at = (ly + 1) * PAD_AREA + (lz + 1) * PAD + (lx + 1);
          const state = cells[at] as number;
          if (state === 0) continue;
          const mask = this.neighbourhood(at);
          // A block with solid cells all round it has nothing to show.
          if (mask === FULL) continue;
          this.mask = mask;
          this.x = x0 + lx;
          this.y = y0 + ly;
          this.z = z0 + lz;
          this.hash = cellHash(this.x, this.y, this.z);
          this.layoutHash = Math.imul(this.hash ^ (this.hash >>> 16), 0x85ebca6b) >>> 0;
          this.material = stateMaterial(state);
          this.emitCell();
        }
      }
    }
    return this.builder.finish();
  }

  private neighbourhood(at: number): number {
    const cells = this.cells;
    let mask = 0;
    let b = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        const row = at + dy * PAD_AREA + dz * PAD;
        for (let dx = -1; dx <= 1; dx++) {
          if (cells[row + dx] !== 0) mask |= 1 << b;
          b++;
        }
      }
    }
    return mask;
  }

  private emitCell(): void {
    const mask = this.mask;
    for (let f = 0; f < 6; f++) {
      if ((mask & (FACES[f] as FaceDef).bit) === 0) {
        this.computeFaceAo(f);
        this.emitPanel(f);
      }
    }
    for (let i = 0; i < EDGES.length; i++) {
      const edge = EDGES[i] as EdgeDef;
      if ((mask & edge.need) !== edge.need) this.emitStrip(edge);
    }
    for (let i = 0; i < CORNERS.length; i++) {
      const corner = CORNERS[i] as CornerDef;
      if ((mask & corner.others) !== corner.others) this.emitCorner(corner);
    }
    for (let i = 0; i < CAP_EDGES.length; i++) {
      const cap = CAP_EDGES[i] as (typeof CAP_EDGES)[number];
      if ((mask & cap.need) !== cap.need) continue;
      if ((mask & cap.low.all) !== cap.low.all) this.emitCap(cap.axis, cap.j, cap.k, 0);
      if ((mask & cap.high.all) !== cap.high.all) this.emitCap(cap.axis, cap.j, cap.k, 1);
    }
  }

  private computeFaceAo(f: number): void {
    const mask = this.mask;
    for (let c = 0; c < 4; c++) {
      const [s1, s2, corner] = AO_BITS[f * 4 + c] as readonly [number, number, number];
      const a = (mask & s1) !== 0;
      const b = (mask & s2) !== 0;
      const level = a && b ? 0 : 3 - (a ? 1 : 0) - (b ? 1 : 0) - ((mask & corner) !== 0 ? 1 : 0);
      this.faceAo[f * 4 + c] = AO_BYTES[level] as number;
    }
  }

  /** Occlusion of a vertex that lies on face `f`: the face's own table, or the groove if it is hidden. */
  private aoOn(f: number): number {
    const face = FACES[f] as FaceDef;
    if ((this.mask & face.bit) !== 0) return GROOVE_BYTE;
    const l = this.local;
    const c = ((l[face.t1] as number) > 0.5 ? 1 : 0) + ((l[face.t2] as number) > 0.5 ? 2 : 0);
    return this.faceAo[f * 4 + c] as number;
  }

  /** Adds a vertex at `local`, with its texture coordinates taken from face `owner`'s tile. */
  private vertex(
    owner: number,
    nx: number,
    ny: number,
    nz: number,
    ao: number,
    kind: number,
  ): number {
    const l = this.local;
    const face = FACES[owner] as FaceDef;
    let u = l[face.t1] as number;
    let v = l[face.t2] as number;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    // Each face of each block turns its tile one of eight ways, so repeats do not line up.
    const variant = (this.hash >>> (8 + 3 * owner)) & 7;
    if (variant & 1) u = 1 - u;
    if (variant & 2) v = 1 - v;
    if (variant & 4) {
      const t = u;
      u = v;
      v = t;
    }
    // Which of the material's tiles this face shows rides above the primitive kind.
    const layout = (this.layoutHash >>> (2 * owner)) % TILE_LAYOUTS;
    return this.builder.vertex(
      this.x + (l[0] as number),
      this.y + (l[1] as number),
      this.z + (l[2] as number),
      nx,
      ny,
      nz,
      u,
      v,
      ao,
      this.material,
      kind | (layout << 2),
      this.hash & 255,
    );
  }

  private emitPanel(f: number): void {
    const face = FACES[f] as FaceDef;
    const l = this.local;
    const plane = face.sign > 0 ? 1 : 0;
    const ids = this.ids;
    for (let i = 0; i < 4; i++) {
      const c = PANEL_ORDER[i] as number;
      l[face.axis] = plane;
      l[face.t1] = c & 1 ? 1 - BEVEL : BEVEL;
      l[face.t2] = c & 2 ? 1 - BEVEL : BEVEL;
      ids[i] = this.vertex(
        f,
        face.dir[0],
        face.dir[1],
        face.dir[2],
        this.faceAo[f * 4 + c] as number,
        PRIMITIVE.panel,
      );
    }
    this.builder.quad(
      ids[0] as number,
      ids[1] as number,
      ids[2] as number,
      ids[3] as number,
      face.dir[0],
      face.dir[1],
      face.dir[2],
    );
  }

  /** The chamfer along the edge where faces `fa` and `fb` meet. */
  private emitStrip(edge: EdgeDef): void {
    const a = FACES[edge.fa] as FaceDef;
    const b = FACES[edge.fb] as FaceDef;
    const along = 3 - a.axis - b.axis;
    const planeA = a.sign > 0 ? 1 : 0;
    const planeB = b.sign > 0 ? 1 : 0;
    const insetA = a.sign > 0 ? 1 - BEVEL : BEVEL;
    const insetB = b.sign > 0 ? 1 - BEVEL : BEVEL;
    const nx = (a.dir[0] + b.dir[0]) * SQRT1_2;
    const ny = (a.dir[1] + b.dir[1]) * SQRT1_2;
    const nz = (a.dir[2] + b.dir[2]) * SQRT1_2;
    // The strip takes its texture from the face that is visible, so it continues that face's tile.
    const owner = (this.mask & a.bit) === 0 || (this.mask & b.bit) !== 0 ? edge.fa : edge.fb;
    const l = this.local;
    const ids = this.ids;
    // Around the strip: the low and high end on face A's panel border, then back along face B's.
    for (let i = 0; i < 4; i++) {
      const onB = i >= 2;
      if (onB) {
        l[b.axis] = planeB;
        l[a.axis] = insetA;
      } else {
        l[a.axis] = planeA;
        l[b.axis] = insetB;
      }
      l[along] = i === 0 || i === 3 ? BEVEL : 1 - BEVEL;
      ids[i] = this.vertex(owner, nx, ny, nz, this.aoOn(onB ? edge.fb : edge.fa), PRIMITIVE.strip);
    }
    this.builder.quad(
      ids[0] as number,
      ids[1] as number,
      ids[2] as number,
      ids[3] as number,
      nx,
      ny,
      nz,
    );
  }

  /** The chamfer across a corner, a triangle joining the three panels' nearest points. */
  private emitCorner(corner: CornerDef): void {
    const signs = corner.signs;
    const nx = signs[0] * SQRT1_3;
    const ny = signs[1] * SQRT1_3;
    const nz = signs[2] * SQRT1_3;
    const l = this.local;
    // The corner continues the tile of the first visible face, or the x face if none is.
    let owner = corner.faces[0];
    for (let i = 0; i < 3; i++) {
      const f = corner.faces[i] as number;
      if ((this.mask & (FACES[f] as FaceDef).bit) === 0) {
        owner = f;
        break;
      }
    }
    const ids = this.ids;
    for (let i = 0; i < 3; i++) {
      const f = corner.faces[i] as number;
      const face = FACES[f] as FaceDef;
      for (let axis = 0; axis < 3; axis++) {
        const s = signs[axis] as number;
        l[axis] = axis === face.axis ? (s > 0 ? 1 : 0) : s > 0 ? 1 - BEVEL : BEVEL;
      }
      ids[i] = this.vertex(owner, nx, ny, nz, this.aoOn(f), PRIMITIVE.corner);
    }
    this.builder.triangle(ids[0] as number, ids[1] as number, ids[2] as number, nx, ny, nz);
  }

  /**
   * Closes the diamond shaft at one end of the edge along `axis` on the block's high side of `j`
   * and `k`. Four blocks meet there; their chamfers leave a shaft the width of two bevels, and
   * where the shaft opens into the air this flat piece seals it, a bevel's depth in from the end.
   */
  private emitCap(axis: number, j: number, k: number, end: number): void {
    const l = this.local;
    const depth = end === 1 ? 1 - BEVEL : BEVEL;
    const dir = end === 1 ? 1 : -1;
    const nx = axis === 0 ? dir : 0;
    const ny = axis === 1 ? dir : 0;
    const nz = axis === 2 ? dir : 0;
    const owner = axis * 2;
    const ids = this.ids;
    for (let i = 0; i < 4; i++) {
      l[axis] = depth;
      l[j] = 1 + (CAP_DJ[i] as number);
      l[k] = 1 + (CAP_DK[i] as number);
      ids[i] = this.vertex(owner, nx, ny, nz, GROOVE_BYTE, PRIMITIVE.cap);
    }
    this.builder.quad(
      ids[0] as number,
      ids[1] as number,
      ids[2] as number,
      ids[3] as number,
      nx,
      ny,
      nz,
    );
  }
}

/** A well-mixed number for a cell: the low byte seeds its look, the bits above turn its tiles. */
function cellHash(x: number, y: number, z: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

const shared = new ChunkMesher();

/** Meshes one chunk with a shared mesher. */
export function meshChunk(
  world: Pick<BlockWorld, 'getBlock'>,
  cx: number,
  cy: number,
  cz: number,
): ChunkMeshData {
  return shared.mesh(world, cx, cy, cz);
}
