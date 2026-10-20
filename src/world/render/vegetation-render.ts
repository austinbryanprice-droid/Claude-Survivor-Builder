import {
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector4,
  type BufferGeometry,
  type Camera,
  type Group,
  type IUniform,
  type Texture,
} from 'three';
import { ATMOSPHERE_GLSL } from '../../engine/glsl/atmosphere.glsl';
import { SHADOW_FRAGMENT_PARS, SHADOW_VERTEX_PARS } from '../../engine/glsl/lighting.glsl';
import type { MaterialRegistry } from '../../engine/materials';
import type { BakedTextures } from '../../engine/texture-bake';
import type { QualitySettings } from '../../shared/quality';
import {
  CLUMP_STRIDE,
  GRASS_CELL,
  GRASS_CELLS_PER_SIDE,
  TREE_BROADLEAF,
  TREE_PINE,
  type GrassField,
  type TreeSpawn,
} from '../scatter';
import { WORLD_HALF } from '../terrain/field';
import { hash32, unitFloat } from '../../shared/hash';
import type { FoliageTextures } from './foliage-textures';
import { buildBroadleaf, buildGrassClump, buildPine, type Lod } from './foliage-geometry';
import type { GroundMaps } from './terrain-render';

const TREE_VERTEX = /* glsl */ `
${SHADOW_VERTEX_PARS}
uniform vec3 uCamPos;
uniform vec4 uSkyParams;
attribute vec3 aInfo;
attribute vec3 iPos;
attribute vec4 iData;   // scale, yaw, tint, phase
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vInfo;
varying float vTint;
varying float vViewDepth;

void main() {
  float sc = iData.x;
  float cy = cos(iData.y);
  float sy = sin(iData.y);
  vec3 p = position * sc;
  vec3 n = normal;
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  n = vec3(cy * n.x + sy * n.z, n.y, -sy * n.x + cy * n.z);
  vec3 wp = p + iPos;

  // Gusts lean the whole crown; a faster flutter shakes the leaves.
  float t = uSkyParams.z;
  float ph = iData.w * 6.2831;
  float gust = sin(t * 0.55 + dot(iPos.xz, vec2(0.045, 0.03)) + ph * 0.3) * 0.5 + 0.5;
  float lean = aInfo.x * sc * (0.05 + 0.1 * gust);
  wp.xz += vec2(0.82, 0.57) * lean * (0.65 + 0.35 * sin(t * 1.3 + ph));
  float leaf = step(0.5, aInfo.y) * step(aInfo.y, 1.5);
  float flutter = sin(t * 2.9 + ph * 2.0 + wp.y * 1.3 + wp.x * 0.9) + 0.6 * sin(t * 4.3 + ph * 3.0 + wp.z * 1.7);
  wp += vec3(0.6, 0.35, -0.5) * flutter * 0.03 * aInfo.x * leaf * sc;

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vViewDepth = -mv.z;
  vWorld = wp;
  vNormal = n;
  vUv = uv;
  vInfo = aInfo;
  vTint = iData.z;
  writeShadowVaryings(wp, n, vViewDepth);
}
`;

const TREE_FRAGMENT = /* glsl */ `
${SHADOW_FRAGMENT_PARS}
${ATMOSPHERE_GLSL}
uniform sampler2D uFoliage;
uniform vec3 uTintA;
uniform vec3 uTintB;
uniform vec4 uTree;   // x alpha cutoff, y translucency
uniform vec3 uFlat;   // color of the flat far-distance models
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vInfo;
varying float vTint;
varying float vViewDepth;

void main() {
  float part = vInfo.y;
  vec3 N = normalize(vNormal);
  vec3 toCam = uCamPos - vWorld;
  vec3 V = normalize(toCam);
  vec3 tint = mix(uTintA, uTintB, vTint);
  vec3 albedo;
  float alpha = 1.0;
  float leaf = 0.0;
  if (part < 0.5) {
    float streak = texture2D(uNoise, vec2(vUv.x * 5.0, vUv.y * 0.45)).r;
    float fine = texture2D(uNoise, vec2(vUv.x * 13.0 + 0.3, vUv.y * 1.4)).g;
    float bark = smoothstep(0.25, 0.8, streak * 0.65 + fine * 0.55);
    albedo = mix(vec3(0.045, 0.032, 0.022), vec3(0.2, 0.145, 0.095), bark);
  } else if (part < 1.5) {
    vec4 tex = texture2D(uFoliage, vUv, -0.5);
    alpha = tex.a;
    #ifndef ALPHA_TO_COVERAGE
      if (alpha < uTree.x) discard;
    #else
      alpha = smoothstep(uTree.x - 0.12, uTree.x + 0.12, alpha);
    #endif
    albedo = tex.rgb * tint;
    leaf = 1.0;
  } else {
    albedo = uFlat * tint;
    leaf = 1.0;
  }

  float ao = vInfo.z;
  float ndl = dot(N, uKeyDir);
  float wrap = mix(0.1, 0.5, leaf);
  float diff = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
  float shadow = sunShadow(vViewDepth);
  vec3 direct = uKeyColor * diff * shadow * mix(0.5, 1.0, ao);
  // Light shining through the leaves toward a camera that looks at the sun.
  float vdl = clamp(dot(-V, uKeyDir), 0.0, 1.0);
  float back = pow(vdl, 2.2) * uTree.y * leaf * shadow * (1.0 - 0.6 * diff);
  vec3 trans = uKeyColor * back * albedo * vec3(1.45, 0.95, 0.38) * ao;
  vec3 amb = ambientLight(N) * mix(0.45, 1.0, ao);
  vec3 lit = albedo * (direct + amb) + trans;

  lit = applyAtmosphere(lit, vWorld);
  gl_FragColor = vec4(lit, alpha);
}
`;

const TREE_DEPTH_VERTEX = /* glsl */ `
attribute vec3 aInfo;
attribute vec3 iPos;
attribute vec4 iData;
varying vec2 vUv;
varying float vPart;
void main() {
  float sc = iData.x;
  float cy = cos(iData.y);
  float sy = sin(iData.y);
  vec3 p = position * sc;
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  vUv = uv;
  vPart = aInfo.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(p + iPos, 1.0);
}
`;

const TREE_DEPTH_FRAGMENT = /* glsl */ `
uniform sampler2D uFoliage;
uniform float uCutoff;
varying vec2 vUv;
varying float vPart;
void main() {
  if (vPart > 0.5 && vPart < 1.5 && texture2D(uFoliage, vUv, -0.5).a < uCutoff) discard;
  gl_FragColor = vec4(1.0);
}
`;

const GRASS_VERTEX = /* glsl */ `
${SHADOW_VERTEX_PARS}
uniform vec3 uCamPos;
uniform vec4 uSkyParams;
uniform sampler2D uNoise;
uniform sampler2D uSplat;
uniform vec4 uGrass;   // x draw distance, y world half size, z unused, w flowers on
attribute vec3 aInfo;
attribute vec3 iPos;
attribute vec4 iData;  // scale, yaw, rank, unused
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vInfo;
varying vec3 vTint;
varying float vRank;
varying float vViewDepth;

void main() {
  float dist = distance(iPos.xz, uCamPos.xz);
  float fade = 1.0 - smoothstep(uGrass.x * 0.78, uGrass.x, dist);
  // Distant clumps are bigger, because thinning leaves fewer of them.
  float grow = 1.0 + 0.55 * smoothstep(0.25 * uGrass.x, 0.95 * uGrass.x, dist);
  float sc = iData.x * fade * grow;
  float cy = cos(iData.y);
  float sy = sin(iData.y);
  vec3 p = position * vec3(sc, sc * 0.92, sc);
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);

  float t = uSkyParams.z;
  float ph = iData.z * 91.7;
  float wave = sin(dot(iPos.xz, vec2(0.33, 0.21)) + t * 1.7) * 0.55
             + sin(dot(iPos.xz, vec2(-0.11, 0.4)) + t * 2.3 + ph) * 0.45;
  vec2 bend = vec2(0.82, 0.57) * (0.1 + 0.09 * wave) * sc + vec2(0.04, -0.03) * sin(t * 3.3 + ph * 2.0) * sc;
  vec3 wp = p + iPos;
  wp.xz += bend * aInfo.x;
  wp.y -= (bend.x * bend.x + bend.y * bend.y) * 0.5 * aInfo.x;

  vec2 suv = (iPos.xz + uGrass.y) / (uGrass.y * 2.0);
  vec4 splat = texture2D(uSplat, suv);
  float macroA = texture2D(uNoise, iPos.xz * 0.011).r;
  float lush = clamp(splat.a * 0.5 + macroA * 0.9 - 0.15, 0.0, 1.0);
  vec3 tint = mix(vec3(1.08, 1.0, 0.62), vec3(0.66, 0.92, 0.66), lush);
  vTint = tint * (0.85 + 0.3 * fract(iData.z * 13.7));

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vViewDepth = -mv.z;
  vWorld = wp;
  vUv = uv;
  vInfo = aInfo;
  vRank = iData.z;
  writeShadowVaryings(iPos + vec3(0.0, 0.3, 0.0), vec3(0.0, 1.0, 0.0), vViewDepth);
}
`;

const GRASS_FRAGMENT = /* glsl */ `
${SHADOW_FRAGMENT_PARS}
${ATMOSPHERE_GLSL}
uniform sampler2D uBlades;
uniform vec4 uGrass;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vInfo;
varying vec3 vTint;
varying float vRank;
varying float vViewDepth;

vec3 petalColor(float r) {
  float k = fract(r * 5.31);
  if (k < 0.28) return vec3(0.82, 0.8, 0.7);
  if (k < 0.52) return vec3(0.9, 0.52, 0.03);
  if (k < 0.74) return vec3(0.8, 0.05, 0.03);
  if (k < 0.9) return vec3(0.28, 0.1, 0.62);
  return vec3(0.85, 0.22, 0.38);
}

void main() {
  vec4 tex = texture2D(uBlades, vUv, -0.3);
  float alpha = tex.a;
  #ifndef ALPHA_TO_COVERAGE
    if (alpha < 0.42) discard;
  #else
    alpha = smoothstep(0.3, 0.55, alpha);
  #endif
  vec3 albedo = tex.rgb * vTint;
  if (uGrass.w > 0.5) {
    float petal = smoothstep(0.5, 0.78, min(tex.r, min(tex.g, tex.b)));
    albedo = mix(albedo, petalColor(vRank) * (0.75 + 0.5 * tex.r), petal);
  }
  float ao = vInfo.z;
  vec3 N = vec3(0.0, 1.0, 0.0);
  float ndl = dot(N, uKeyDir);
  float diff = clamp((ndl + 0.35) / 1.35, 0.0, 1.0);
  float shadow = sunShadow(vViewDepth);
  vec3 direct = uKeyColor * diff * shadow * mix(0.45, 1.0, ao);
  vec3 V = normalize(uCamPos - vWorld);
  float vdl = clamp(dot(-V, uKeyDir), 0.0, 1.0);
  float back = pow(vdl, 2.0) * shadow * (0.25 + 0.75 * vUv.y);
  vec3 trans = uKeyColor * back * albedo * vec3(1.4, 1.15, 0.5) * 0.9;
  vec3 amb = ambientLight(N) * mix(0.4, 1.0, ao);
  vec3 lit = albedo * (direct + amb) + trans;
  lit = applyAtmosphere(lit, vWorld);
  gl_FragColor = vec4(lit, alpha);
}
`;

/** Per-instance buffers and the mesh that draws them. */
interface Bucket {
  readonly mesh: Mesh;
  readonly geometry: InstancedBufferGeometry;
  readonly pos: InstancedBufferAttribute;
  readonly data: InstancedBufferAttribute;
  count: number;
}

function createBucket(
  base: BufferGeometry,
  capacity: number,
  material: ShaderMaterial,
  castShadow: boolean,
): Bucket {
  const geometry = new InstancedBufferGeometry();
  geometry.index = base.index;
  for (const name of ['position', 'normal', 'uv', 'aInfo']) {
    const attribute = base.getAttribute(name);
    if (attribute) geometry.setAttribute(name, attribute);
  }
  const pos = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const data = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  pos.setUsage(DynamicDrawUsage);
  data.setUsage(DynamicDrawUsage);
  geometry.setAttribute('iPos', pos);
  geometry.setAttribute('iData', data);
  geometry.instanceCount = 0;
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.visible = false;
  return { mesh, geometry, pos, data, count: 0 };
}

function commit(bucket: Bucket): void {
  bucket.geometry.instanceCount = bucket.count;
  bucket.pos.needsUpdate = true;
  bucket.data.needsUpdate = true;
  bucket.mesh.visible = bucket.count > 0;
}

export interface VegetationStats {
  /** Visible trees by LOD (near, mid, far), both kinds together. */
  readonly trees: readonly [number, number, number];
  readonly grass: number;
  readonly flowers: number;
  readonly triangles: number;
}

const TREE_LOD_MID = 2.4;
const TREE_LOD_FAR = 7;
const MOVE_THRESHOLD = 1.1;

interface PackedTrees {
  /** x, y, z, scale, yaw, tint, phase per tree. */
  readonly data: Float32Array;
  readonly count: number;
}

function pack(trees: readonly TreeSpawn[], kind: number): PackedTrees {
  const own = trees.filter((t) => t.kind === kind);
  const data = new Float32Array(own.length * 7);
  own.forEach((t, i) => {
    data.set([t.x, t.y, t.z, t.scale, t.yaw, t.tint, unitFloat(hash32(i * 7 + kind))], i * 7);
  });
  return { data, count: own.length };
}

/**
 * Trees, grass and flowers as instanced meshes. Trees pick a model by distance and the grass
 * is assembled from the cells around the camera whenever it has moved about a meter, so the
 * per-frame cost is only the draw calls.
 */
export class VegetationRenderer {
  private readonly pines: PackedTrees;
  private readonly broadleaves: PackedTrees;
  private readonly treeBuckets: Bucket[][] = [];
  private readonly grassBucket: Bucket;
  private readonly flowerBucket: Bucket;
  private readonly materials: ShaderMaterial[] = [];
  private readonly depthMaterials: ShaderMaterial[] = [];
  private readonly grassMaterial: ShaderMaterial;
  private readonly flowerMaterial: ShaderMaterial;
  private readonly triangles: number[][] = [];
  private grassTriangles = 0;
  private quality: QualitySettings | null = null;
  private lastX = Number.POSITIVE_INFINITY;
  private lastZ = Number.POSITIVE_INFINITY;
  private lastY = Number.POSITIVE_INFINITY;
  stats: VegetationStats = { trees: [0, 0, 0], grass: 0, flowers: 0, triangles: 0 };

  constructor(
    private readonly parent: Group,
    trees: readonly TreeSpawn[],
    private readonly grass: GrassField,
    foliage: FoliageTextures,
    baked: BakedTextures,
    maps: GroundMaps,
    registry: MaterialRegistry,
  ) {
    this.pines = pack(trees, TREE_PINE);
    this.broadleaves = pack(trees, TREE_BROADLEAF);

    const treeMaterial = (
      texture: Texture,
      a: Color,
      b: Color,
      translucency: number,
      flat: Color,
    ): { material: ShaderMaterial; depth: ShaderMaterial } => {
      const material = registry.create({
        vertexShader: TREE_VERTEX,
        fragmentShader: TREE_FRAGMENT,
        side: DoubleSide,
        uniforms: {
          uFoliage: { value: texture },
          uTintA: { value: a },
          uTintB: { value: b },
          uTree: { value: new Vector4(0.46, translucency, 0, 0) },
          uFlat: { value: flat },
        },
      });
      const depth = new ShaderMaterial({
        vertexShader: TREE_DEPTH_VERTEX,
        fragmentShader: TREE_DEPTH_FRAGMENT,
        uniforms: { uFoliage: { value: texture }, uCutoff: { value: 0.46 } },
        side: DoubleSide,
      });
      this.materials.push(material);
      this.depthMaterials.push(depth);
      return { material, depth };
    };

    const pine = treeMaterial(
      foliage.frond,
      new Color(0.7, 0.92, 0.72),
      new Color(0.95, 0.95, 0.7),
      0.65,
      new Color(0.032, 0.075, 0.034),
    );
    const broad = treeMaterial(
      foliage.leaves,
      new Color(0.78, 0.98, 0.6),
      new Color(0.5, 0.88, 0.5),
      0.8,
      new Color(0.06, 0.15, 0.03),
    );

    const models: [PackedTrees, ReturnType<typeof treeMaterial>, (lod: Lod) => BufferGeometry][] = [
      [this.pines, pine, buildPine],
      [this.broadleaves, broad, buildBroadleaf],
    ];
    models.forEach(([packed, mats, build], kind) => {
      const row: Bucket[] = [];
      const tri: number[] = [];
      for (const lod of [0, 1, 2] as const) {
        const geometry = build(lod);
        const bucket = createBucket(geometry, Math.max(1, packed.count), mats.material, lod < 2);
        bucket.mesh.customDepthMaterial = mats.depth;
        bucket.mesh.name = `${kind === 0 ? 'pine' : 'broadleaf'}-lod${lod}`;
        parent.add(bucket.mesh);
        row.push(bucket);
        tri.push((geometry.index?.count ?? 0) / 3);
      }
      this.treeBuckets.push(row);
      this.triangles.push(tri);
    });

    const grassUniforms = (texture: Texture, flowers: boolean): Record<string, IUniform> => ({
      uBlades: { value: texture },
      uSplat: { value: maps.splat },
      uNoise: { value: baked.noise },
      uGrass: { value: new Vector4(34, WORLD_HALF, 0, flowers ? 1 : 0) },
    });
    this.grassMaterial = registry.create({
      vertexShader: GRASS_VERTEX,
      fragmentShader: GRASS_FRAGMENT,
      side: DoubleSide,
      uniforms: grassUniforms(foliage.grass, false),
    });
    this.flowerMaterial = registry.create({
      vertexShader: GRASS_VERTEX,
      fragmentShader: GRASS_FRAGMENT,
      side: DoubleSide,
      uniforms: grassUniforms(foliage.flowers, true),
    });
    this.materials.push(this.grassMaterial, this.flowerMaterial);
    const clump = buildGrassClump();
    this.grassTriangles = (clump.index?.count ?? 0) / 3;
    this.grassBucket = createBucket(clump, 60000, this.grassMaterial, false);
    this.flowerBucket = createBucket(clump, 6000, this.flowerMaterial, false);
    this.grassBucket.mesh.name = 'grass';
    this.flowerBucket.mesh.name = 'flowers';
    // Layer 1: drawn by the main camera only, left out of the water reflection.
    this.grassBucket.mesh.layers.set(1);
    this.flowerBucket.mesh.layers.set(1);
    parent.add(this.grassBucket.mesh, this.flowerBucket.mesh);
  }

  get treeCount(): number {
    return this.pines.count + this.broadleaves.count;
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    const msaa = q.antiAlias === 'msaa';
    for (const material of [...this.materials]) {
      if (material.alphaToCoverage !== msaa) {
        material.alphaToCoverage = msaa;
        material.needsUpdate = true;
      }
    }
    for (const material of [this.grassMaterial, this.flowerMaterial]) {
      (material.uniforms.uGrass?.value as Vector4).x = q.grassDistance;
    }
    // Shadow-casting trees only where there is a shadow map.
    for (const row of this.treeBuckets) {
      row.forEach((bucket, lod) => {
        bucket.mesh.castShadow = lod < 2 && q.shadows !== 'blob';
      });
    }
    this.grassBucket.mesh.visible = false;
    this.flowerBucket.mesh.visible = false;
    this.lastX = Number.POSITIVE_INFINITY;
  }

  /** Re-sorts the instances when the camera has moved far enough to change what is drawn. */
  update(camera: Camera): void {
    const q = this.quality;
    if (!q) return;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const moved = Math.hypot(cx - this.lastX, cz - this.lastZ, (cy - this.lastY) * 0.5);
    if (moved < MOVE_THRESHOLD) return;
    this.lastX = cx;
    this.lastY = cy;
    this.lastZ = cz;
    this.assembleTrees(cx, cy, cz, q);
    this.assembleGrass(cx, cz, q);
    this.refreshStats();
  }

  private assembleTrees(cx: number, cy: number, cz: number, q: QualitySettings): void {
    const near = q.treeNearDistance;
    const mid = near * TREE_LOD_MID;
    const far = near * TREE_LOD_FAR;
    const sets = [this.pines, this.broadleaves];
    sets.forEach((packed, kind) => {
      const row = this.treeBuckets[kind] as Bucket[];
      for (const bucket of row) bucket.count = 0;
      const d = packed.data;
      for (let i = 0; i < packed.count; i++) {
        const o = i * 7;
        const x = d[o] as number;
        const y = d[o + 1] as number;
        const z = d[o + 2] as number;
        const dist = Math.hypot(x - cx, (y - cy) * 0.6, z - cz);
        if (dist > far) continue;
        const lod = dist < near ? 0 : dist < mid ? 1 : 2;
        const bucket = row[lod] as Bucket;
        const n = bucket.count++;
        const pa = bucket.pos.array as Float32Array;
        const da = bucket.data.array as Float32Array;
        pa[n * 3] = x;
        pa[n * 3 + 1] = y;
        pa[n * 3 + 2] = z;
        da[n * 4] = d[o + 3] as number;
        da[n * 4 + 1] = d[o + 4] as number;
        da[n * 4 + 2] = d[o + 5] as number;
        da[n * 4 + 3] = d[o + 6] as number;
      }
      for (const bucket of row) commit(bucket);
    });
  }

  private assembleGrass(cx: number, cz: number, q: QualitySettings): void {
    const radius = q.grassDistance;
    const density = q.foliageDensity;
    this.grassBucket.count = 0;
    this.flowerBucket.count = 0;
    const gPos = this.grassBucket.pos.array as Float32Array;
    const gData = this.grassBucket.data.array as Float32Array;
    const fPos = this.flowerBucket.pos.array as Float32Array;
    const fData = this.flowerBucket.data.array as Float32Array;
    const gMax = gPos.length / 3;
    const fMax = fPos.length / 3;
    const c0 = Math.max(0, Math.floor((cx - radius + WORLD_HALF) / GRASS_CELL));
    const c1 = Math.min(
      GRASS_CELLS_PER_SIDE - 1,
      Math.floor((cx + radius + WORLD_HALF) / GRASS_CELL),
    );
    const r0 = Math.max(0, Math.floor((cz - radius + WORLD_HALF) / GRASS_CELL));
    const r1 = Math.min(
      GRASS_CELLS_PER_SIDE - 1,
      Math.floor((cz + radius + WORLD_HALF) / GRASS_CELL),
    );
    const rr = radius * radius;
    for (let rz = r0; rz <= r1; rz++) {
      for (let rx = c0; rx <= c1; rx++) {
        const cell = this.grass.cell(rx, rz);
        const fill = (
          src: Float32Array,
          pos: Float32Array,
          data: Float32Array,
          bucket: Bucket,
          max: number,
          falloff: number,
        ): void => {
          for (let o = 0; o + CLUMP_STRIDE <= src.length; o += CLUMP_STRIDE) {
            const x = src[o] as number;
            const z = src[o + 2] as number;
            const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
            if (d2 > rr) continue;
            const f = 1 - Math.sqrt(d2) / radius;
            const rank = src[o + 5] as number;
            if (rank >= density * Math.pow(f, falloff)) continue;
            if (bucket.count >= max) return;
            const n = bucket.count++;
            pos[n * 3] = x;
            pos[n * 3 + 1] = src[o + 1] as number;
            pos[n * 3 + 2] = z;
            data[n * 4] = src[o + 3] as number;
            data[n * 4 + 1] = src[o + 4] as number;
            data[n * 4 + 2] = rank;
            data[n * 4 + 3] = 0;
          }
        };
        fill(cell.grass, gPos, gData, this.grassBucket, gMax, 0.8);
        // Flowers have no density curve of their own: they keep to the near field.
        fill(cell.flowers, fPos, fData, this.flowerBucket, fMax, 0.35);
      }
    }
    commit(this.grassBucket);
    commit(this.flowerBucket);
  }

  private refreshStats(): void {
    const trees: [number, number, number] = [0, 0, 0];
    let triangles = 0;
    this.treeBuckets.forEach((row, kind) => {
      row.forEach((bucket, lod) => {
        trees[lod] = (trees[lod] as number) + bucket.count;
        triangles += bucket.count * ((this.triangles[kind]?.[lod] as number) ?? 0);
      });
    });
    triangles += (this.grassBucket.count + this.flowerBucket.count) * this.grassTriangles;
    this.stats = {
      trees,
      grass: this.grassBucket.count,
      flowers: this.flowerBucket.count,
      triangles,
    };
  }

  dispose(): void {
    const all = [...this.treeBuckets.flat(), this.grassBucket, this.flowerBucket];
    for (const bucket of all) {
      this.parent.remove(bucket.mesh);
      bucket.geometry.dispose();
    }
    for (const m of [...this.materials, ...this.depthMaterials]) m.dispose();
  }
}
