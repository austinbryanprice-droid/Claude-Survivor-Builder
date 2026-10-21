import type { IUniform, ShaderMaterial } from 'three';
import { ATMOSPHERE_GLSL } from '../../engine/glsl/atmosphere.glsl';
import {
  BUMP_GLSL,
  SHADOW_FRAGMENT_PARS,
  SHADOW_VERTEX_PARS,
} from '../../engine/glsl/lighting.glsl';
import type { MaterialRegistry } from '../../engine/materials';
import type { StructureTextures } from '../../engine/texture-bake';

/**
 * The surface of everything players build: one material for every block of every tier. A block's
 * material id picks a layer of the baked tile arrays (`StructureTextures`), so an upgrade is a
 * different number in the mesh and never a different mesh. It takes the terrain's light, shadows
 * and haze, adds a sheen to the polished tiers and lets the energy tier glow and pulse.
 *
 * Per-vertex inputs (see `world/voxels/mesher.ts`): position and normal in world space, the tile
 * coordinate, and `aAux` with ambient occlusion, material id, primitive kind and a per-block seed
 * as bytes.
 */

const STRUCTURE_VERTEX = /* glsl */ `
${SHADOW_VERTEX_PARS}
attribute vec4 aAux;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec4 vAux;
varying float vViewDepth;

void main() {
  vWorld = position;
  vNormal = normal;
  vUv = uv;
  vAux = aAux;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vViewDepth = -mv.z;
  writeShadowVaryings(position, normal, vViewDepth);
}
`;

const STRUCTURE_FRAGMENT = /* glsl */ `
${SHADOW_FRAGMENT_PARS}
${ATMOSPHERE_GLSL}
${BUMP_GLSL}

uniform highp sampler2DArray uAlbedo;
uniform highp sampler2DArray uData;
uniform float uTiers;
uniform float uLayouts;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec4 vAux;
varying float vViewDepth;

void main() {
  vec3 P = vWorld;
  vec3 N = normalize(vNormal);
  float tier = clamp(floor(vAux.y + 0.5) - 1.0, 0.0, uTiers - 1.0);
  // The primitive kind takes the low two bits of z; the face's tile layout rides above it.
  float tileLayout = mod(floor(vAux.z * 0.25 + 0.01), uLayouts);
  float layer = tier * uLayouts + tileLayout;
  float ao = vAux.x / 255.0;
  float seed = vAux.w / 255.0;

  vec4 tex = texture(uAlbedo, vec3(vUv, layer));
  vec3 surface = texture(uData, vec3(vUv, layer)).rgb;
  vec3 col = tex.rgb;
  float gloss = surface.r;
  float metal = surface.g;
  float glow = surface.b;

  // No two blocks are quite alike: a little brightness and warmth per block, and a slow drift
  // across the structure so a long wall does not read as one flat tint.
  float drift = texture2D(uNoise, P.xz * 0.045 + vec2(P.y * 0.037, P.y * 0.021)).r;
  col *= (0.87 + 0.26 * seed) * (0.86 + 0.28 * drift);
  col *= vec3(1.0 + 0.05 * (seed - 0.5), 1.0, 1.0 - 0.05 * (seed - 0.5));

  #ifdef DETAIL_BUMP
    N = bumpNormal(P, N, tex.a * 0.03);
  #endif

  float shadow = sunShadow(vViewDepth);
  float ndl = dot(N, uKeyDir);
  float diff = clamp((ndl + 0.08) / 1.08, 0.0, 1.0);
  vec3 V = normalize(uCamPos - P);

  vec3 albedo = col * (1.0 - 0.76 * metal);
  vec3 specColor = mix(vec3(0.04), col, metal);
  vec3 H = normalize(uKeyDir + V);
  float shine = pow(max(dot(N, H), 0.0), mix(8.0, 140.0, gloss)) * (0.15 + 0.85 * gloss) * step(0.0, ndl);
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  // A rough surface sees the sky and the ground blurred together, a polished one mostly the sky.
  vec3 R = reflect(-V, N);
  vec3 envRough = ambientLight(R) * 1.1;
  vec3 envSharp = mix(uAmbGround * 0.9, skyGradient(R), smoothstep(-0.05, 0.3, R.y));
  vec3 env = mix(envRough, envSharp, gloss * gloss);

  float aoDirect = mix(1.0, ao, 0.45);
  // Metal has little diffuse color of its own: it shows what it reflects, so a low orange sun tints
  // it only part of the way and it stays steel rather than turning to tan. Glints keep the full color.
  float keyLuma = dot(uKeyColor, vec3(0.2126, 0.7152, 0.0722));
  vec3 keyDiffuse = mix(uKeyColor, vec3(keyLuma), 0.6 * metal);
  vec3 direct = keyDiffuse * diff * shadow * aoDirect;
  vec3 ambient = ambientLight(N) * ao;
  vec3 lit = albedo * (direct + ambient);
  lit += uKeyColor * specColor * shine * shadow * aoDirect;
  lit += env * mix(vec3(1.0), col, metal) * mix(0.05, 0.85, metal) * gloss * (0.3 + 0.7 * fresnel) * ao;

  // Energy-Infused blocks pulse; other tiers' trims glow steadily.
  float pulse = 0.78 + 0.22 * sin(uSkyParams.z * 2.2 + seed * 40.0 + P.x * 0.7 + P.z * 0.9);
  float isEnergy = step(2.5, tier);
  lit += col * glow * mix(1.0, pulse * 1.9, isEnergy);

  lit = applyAtmosphere(lit, P);
  gl_FragColor = vec4(lit, 1.0);
}
`;

/** Creates the one lit material that draws every block. */
export function createStructureMaterial(
  registry: MaterialRegistry,
  textures: StructureTextures,
  tiers: number,
  layouts: number,
): ShaderMaterial {
  const uniforms: Record<string, IUniform> = {
    uAlbedo: { value: textures.albedo },
    uData: { value: textures.data },
    uTiers: { value: tiers },
    uLayouts: { value: layouts },
  };
  return registry.create({
    vertexShader: STRUCTURE_VERTEX,
    fragmentShader: STRUCTURE_FRAGMENT,
    uniforms,
  });
}
