import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  Mesh,
  RGBAFormat,
  Sphere,
  UnsignedByteType,
  Vector3,
  type Camera,
  type Group,
  type IUniform,
  type ShaderMaterial,
} from 'three';
import { ATMOSPHERE_GLSL } from '../../engine/glsl/atmosphere.glsl';
import {
  BUMP_GLSL,
  SHADOW_FRAGMENT_PARS,
  SHADOW_VERTEX_PARS,
} from '../../engine/glsl/lighting.glsl';
import type { MaterialRegistry } from '../../engine/materials';
import type { BakedTextures } from '../../engine/texture-bake';
import type { TerrainMode } from '../../shared/view-flags';
import { WATER_LEVEL, WORLD_HALF, WORLD_SIZE, type TerrainField } from '../terrain/field';
import { GRID_MARGIN, type SdfGrid } from '../terrain/grid';
import { meshHeightfield } from '../terrain/heightfield';
import { meshRegion, surfaceHeightRange, type TerrainMeshData } from '../terrain/surface-nets';

/** Horizontal size of one terrain chunk in meters (a block of 2 by 2 view-distance chunks). */
export const CHUNK_SIZE = 32;
const CHUNKS_PER_SIDE = WORLD_SIZE / CHUNK_SIZE;

/** Where the water is: a depth map over the box that holds every spot below the waterline. */
export interface LakeMap {
  /** R: water depth over the ground (0..LAKE_DEPTH_RANGE meters). */
  readonly texture: DataTexture;
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

/** Ground cover maps painted from the field, sampled by the terrain shader and the water. */
export interface GroundMaps {
  /** R dirt, G ash, B beach, A lushness. */
  readonly splat: DataTexture;
  /** The same bytes as the splat texture, kept for scatter code that runs on the CPU. */
  readonly splatData: Uint8Array;
  readonly splatSize: number;
  /** Null when no ground lies below the waterline. */
  readonly lake: LakeMap | null;
}

/** Depth in meters that the lake map's 8-bit channel spans. */
export const LAKE_DEPTH_RANGE = 8;

const MAP_RES = 256;
const LAKE_RES = 512;
const LAKE_MARGIN = 4;

function makeMap(data: Uint8Array, width: number, height: number): DataTexture {
  const t = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function bakeLakeMap(grid: SdfGrid): LakeMap | null {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (let z = -WORLD_HALF; z <= WORLD_HALF; z++) {
    for (let x = -WORLD_HALF; x <= WORLD_HALF; x++) {
      if (grid.groundAt(x, z) >= WATER_LEVEL) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
  }
  if (x0 > x1) return null;
  x0 = Math.max(-WORLD_HALF, x0 - LAKE_MARGIN);
  z0 = Math.max(-WORLD_HALF, z0 - LAKE_MARGIN);
  x1 = Math.min(WORLD_HALF, x1 + LAKE_MARGIN);
  z1 = Math.min(WORLD_HALF, z1 + LAKE_MARGIN);
  const data = new Uint8Array(LAKE_RES * LAKE_RES * 4);
  for (let j = 0; j < LAKE_RES; j++) {
    const z = z0 + ((j + 0.5) / LAKE_RES) * (z1 - z0);
    for (let i = 0; i < LAKE_RES; i++) {
      const x = x0 + ((i + 0.5) / LAKE_RES) * (x1 - x0);
      const depth = (WATER_LEVEL - grid.groundAt(x, z)) / LAKE_DEPTH_RANGE;
      const o = (j * LAKE_RES + i) * 4;
      data[o] = Math.round(Math.min(1, Math.max(0, depth)) * 255);
      data[o + 3] = 255;
    }
  }
  return { texture: makeMap(data, LAKE_RES, LAKE_RES), x0, z0, x1, z1 };
}

export function bakeGroundMaps(field: TerrainField, grid: SdfGrid): GroundMaps {
  const splat = new Uint8Array(MAP_RES * MAP_RES * 4);
  const texel = WORLD_SIZE / MAP_RES;
  for (let j = 0; j < MAP_RES; j++) {
    for (let i = 0; i < MAP_RES; i++) {
      const x = -WORLD_HALF + (i + 0.5) * texel;
      const z = -WORLD_HALF + (j + 0.5) * texel;
      const h = grid.groundAt(x, z);
      const s = field.splatAt(x, z, h);
      const o = (j * MAP_RES + i) * 4;
      splat[o] = Math.round(s.dirt * 255);
      splat[o + 1] = Math.round(s.ash * 255);
      splat[o + 2] = Math.round(s.sand * 255);
      splat[o + 3] = Math.round(s.lush * 255);
    }
  }
  return {
    splat: makeMap(splat, MAP_RES, MAP_RES),
    splatData: splat,
    splatSize: MAP_RES,
    lake: bakeLakeMap(grid),
  };
}

const TERRAIN_VERTEX = /* glsl */ `
${SHADOW_VERTEX_PARS}
attribute float aAo;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAo;
varying float vViewDepth;

void main() {
  vWorld = position;
  vNormal = normal;
  vAo = aAo;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vViewDepth = -mv.z;
  writeShadowVaryings(position, normal, vViewDepth);
}
`;

const TERRAIN_FRAGMENT = /* glsl */ `
${SHADOW_FRAGMENT_PARS}
${ATMOSPHERE_GLSL}
${BUMP_GLSL}

uniform sampler2D uGrass;
uniform sampler2D uRock;
uniform sampler2D uDirt;
uniform sampler2D uAsh;
uniform sampler2D uSand;
uniform sampler2D uSplat;
uniform vec4 uWorld; // x half size, y water level

varying vec3 vWorld;
varying vec3 vNormal;
varying float vAo;
varying float vViewDepth;

void main() {
  vec3 P = vWorld;
  vec3 N = normalize(vNormal);
  vec2 suv = (P.xz + uWorld.x) / (uWorld.x * 2.0);
  vec4 splat = texture2D(uSplat, suv);
  float macroA = texture2D(uNoise, P.xz * 0.011).r;
  float macroB = texture2D(uNoise, P.xz * 0.043 + vec2(0.3, 0.7)).g;

  float slope = 1.0 - N.y;
  float wRock = smoothstep(0.24, 0.4, slope + (macroB - 0.5) * 0.14);

  // Planar ground layers, sampled in two scales so the tiling never shows.
  vec2 uv = P.xz;
  vec4 g1 = texture2D(uGrass, uv * 0.32);
  vec4 g2 = texture2D(uGrass, uv * 0.047 + vec2(0.37, 0.61));
  float lush = clamp(splat.a * 0.5 + macroA * 0.9 - 0.15, 0.0, 1.0);
  vec3 grassTint = mix(vec3(0.95, 0.92, 0.7), vec3(0.7, 0.9, 0.74), lush);
  vec3 col = g1.rgb * (0.6 + 0.9 * g2.a) * grassTint;
  float height = g1.a * 0.5 + g2.a * 0.5;

  float wSand = 0.0, wDirt = 0.0, wAsh = 0.0;
  if (splat.b > 0.02) {
    vec4 s = texture2D(uSand, uv * 0.42);
    wSand = smoothstep(0.38, 0.62, splat.b + (s.a - 0.5) * 0.5);
    col = mix(col, s.rgb, wSand);
    height = mix(height, s.a, wSand);
  }
  if (splat.r > 0.02) {
    vec4 d = texture2D(uDirt, uv * 0.36);
    wDirt = smoothstep(0.38, 0.62, splat.r + (d.a - 0.5) * 0.5);
    col = mix(col, d.rgb, wDirt);
    height = mix(height, d.a, wDirt);
  }
  if (splat.g > 0.02) {
    vec4 a = texture2D(uAsh, uv * 0.3);
    wAsh = smoothstep(0.3, 0.6, splat.g + (a.a - 0.5) * 0.45);
    col = mix(col, a.rgb, wAsh);
    height = mix(height, a.a, wAsh);
  }

  if (wRock > 0.001) {
    vec3 w3 = pow(abs(N), vec3(4.0));
    w3 /= (w3.x + w3.y + w3.z);
    vec4 rx = texture2D(uRock, P.zy * 0.13);
    vec4 ry = texture2D(uRock, P.xz * 0.13);
    vec4 rz = texture2D(uRock, P.xy * 0.13);
    vec4 rock = rx * w3.x + ry * w3.y + rz * w3.z;
    rock.rgb *= 0.78 + 0.5 * macroB;
    col = mix(col, rock.rgb, wRock);
    height = mix(height, rock.a, wRock);
  }

  #ifdef DETAIL_BUMP
    float relief = mix(0.07, 0.22, wRock);
    N = bumpNormal(P, N, height * relief);
  #endif

  // Submerged ground is darkened and tinted by the water above it.
  float depth = max(uWorld.y - P.y, 0.0);
  vec3 absorb = exp(-depth * vec3(0.5, 0.17, 0.12));
  col *= mix(vec3(1.0), absorb * vec3(0.7, 0.95, 0.95), smoothstep(0.0, 0.05, depth));
  col *= mix(1.0, 0.72, smoothstep(0.5, 0.0, P.y - uWorld.y) * step(0.0, P.y - uWorld.y));

  float shadow = sunShadow(vViewDepth);
  float ndl = dot(N, uKeyDir);
  float diff = clamp((ndl + 0.08) / 1.08, 0.0, 1.0);
  float aoDirect = mix(1.0, vAo, 0.4);
  vec3 direct = uKeyColor * diff * shadow * aoDirect;
  vec3 amb = ambientLight(N) * vAo;
  vec3 lit = col * (direct + amb);

  lit = applyAtmosphere(lit, P);
  gl_FragColor = vec4(lit, 1.0);
}
`;

export interface TerrainChunk {
  readonly mesh: Mesh;
  readonly centerX: number;
  readonly centerZ: number;
  readonly triangles: number;
  readonly vertices: number;
}

export interface TerrainBuildStats {
  readonly chunks: number;
  readonly vertices: number;
  readonly triangles: number;
  readonly gridMs: number;
  readonly meshMs: number;
}

/** The terrain as 6 by 6 chunk meshes sharing one material. */
export class TerrainRenderer {
  readonly chunks: TerrainChunk[] = [];
  readonly material: ShaderMaterial;
  readonly group: Group;
  private viewDistance = 192;

  constructor(
    group: Group,
    grid: SdfGrid,
    private readonly maps: GroundMaps,
    textures: BakedTextures,
    registry: MaterialRegistry,
    private readonly mode: TerrainMode = 'surface-nets',
  ) {
    this.group = group;
    const uniforms: Record<string, IUniform> = {
      uGrass: { value: textures.grass },
      uRock: { value: textures.rock },
      uDirt: { value: textures.dirt },
      uAsh: { value: textures.ash },
      uSand: { value: textures.sand },
      uSplat: { value: maps.splat },
      uWorld: { value: new Vector3(WORLD_HALF, WATER_LEVEL, 0) },
    };
    this.material = registry.create({
      vertexShader: TERRAIN_VERTEX,
      fragmentShader: TERRAIN_FRAGMENT,
      uniforms,
    });
    this.build(grid);
  }

  stats: TerrainBuildStats = { chunks: 0, vertices: 0, triangles: 0, gridMs: 0, meshMs: 0 };

  private build(grid: SdfGrid): void {
    const t0 = performance.now();
    let vertices = 0;
    let triangles = 0;
    for (let cz = 0; cz < CHUNKS_PER_SIDE; cz++) {
      for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
        const ix0 = GRID_MARGIN + cx * CHUNK_SIZE;
        const iz0 = GRID_MARGIN + cz * CHUNK_SIZE;
        const range = surfaceHeightRange(grid, ix0, ix0 + CHUNK_SIZE, iz0, iz0 + CHUNK_SIZE);
        const region = {
          ix0,
          ix1: ix0 + CHUNK_SIZE,
          iz0,
          iz1: iz0 + CHUNK_SIZE,
          iy0: range.low,
          iy1: range.high,
        };
        const data =
          this.mode === 'heightfield' ? meshHeightfield(grid, region) : meshRegion(grid, region);
        if (data.vertexCount === 0) continue;
        const mesh = new Mesh(this.toGeometry(data), this.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.chunks.push({
          mesh,
          centerX: -WORLD_HALF + (cx + 0.5) * CHUNK_SIZE,
          centerZ: -WORLD_HALF + (cz + 0.5) * CHUNK_SIZE,
          triangles: data.triangleCount,
          vertices: data.vertexCount,
        });
        vertices += data.vertexCount;
        triangles += data.triangleCount;
      }
    }
    this.stats = {
      chunks: this.chunks.length,
      vertices,
      triangles,
      gridMs: 0,
      meshMs: performance.now() - t0,
    };
  }

  private toGeometry(data: TerrainMeshData): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
    const ao = new Uint8Array(data.vertexCount);
    for (let i = 0; i < ao.length; i++) ao[i] = Math.round((data.ao[i] as number) * 255);
    geometry.setAttribute('aAo', new BufferAttribute(ao, 1, true));
    geometry.setIndex(
      data.vertexCount < 65535
        ? new BufferAttribute(Uint16Array.from(data.indices), 1)
        : new BufferAttribute(data.indices, 1),
    );
    const [x0, y0, z0, x1, y1, z1] = data.bounds;
    const center = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    geometry.boundingSphere = new Sphere(
      center,
      Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2) / 2 + 0.5,
    );
    return geometry;
  }

  /** Limits how far chunks are drawn, in meters from the camera. */
  setViewDistance(meters: number): void {
    this.viewDistance = meters;
  }

  /** Hides chunks beyond the view distance; frustum culling handles the rest. */
  update(camera: Camera): void {
    const cx = camera.position.x;
    const cz = camera.position.z;
    const limit = this.viewDistance + CHUNK_SIZE * 0.75;
    for (const chunk of this.chunks) {
      const dx = chunk.centerX - cx;
      const dz = chunk.centerZ - cz;
      chunk.mesh.visible = dx * dx + dz * dz < limit * limit;
    }
  }

  dispose(): void {
    for (const chunk of this.chunks) {
      chunk.mesh.geometry.dispose();
      this.group.remove(chunk.mesh);
    }
    this.chunks.length = 0;
    this.maps.splat.dispose();
    this.maps.lake?.texture.dispose();
  }
}
