import { Color, Vector2, type IUniform, type ShaderMaterial } from 'three';
import { ATMOSPHERE_GLSL } from './glsl/atmosphere.glsl';
import { SHADOW_FRAGMENT_PARS, SHADOW_VERTEX_PARS } from './glsl/lighting.glsl';
import type { MaterialRegistry } from './materials';

/**
 * A plain lit surface for small props and characters: one color, an optional glow, a little sheen.
 * It takes the same light, shadows and haze as the terrain, which three's own standard material
 * cannot (the scene has no three.js lights; the atmosphere carries the sun and the sky).
 */

const LIT_VERTEX = /* glsl */ `
${SHADOW_VERTEX_PARS}
varying vec3 vWorld;
varying vec3 vNormal;
varying float vViewDepth;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vWorld = world.xyz;
  vNormal = n;
  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;
  vViewDepth = -mv.z;
  writeShadowVaryings(world.xyz, n, vViewDepth);
}
`;

const LIT_FRAGMENT = /* glsl */ `
${SHADOW_FRAGMENT_PARS}
${ATMOSPHERE_GLSL}

uniform vec3 uColor;
uniform vec3 uGlow;
// x: gloss (0 matte, 1 mirror-like), y: metalness
uniform vec2 uSurface;
// How much the glow follows the way a face points: 0 gives off the same light everywhere, 1 lets
// a face turned away from the viewer and the key light give off about a third of it, so a cut
// gem reads as facets.
uniform float uFacets;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vViewDepth;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  float shadow = sunShadow(vViewDepth);
  float ndl = dot(N, uKeyDir);
  float diff = clamp((ndl + 0.08) / 1.08, 0.0, 1.0);

  float gloss = uSurface.x;
  float metal = uSurface.y;
  vec3 albedo = uColor * (1.0 - 0.7 * metal);
  vec3 H = normalize(uKeyDir + V);
  float shine = pow(max(dot(N, H), 0.0), mix(6.0, 120.0, gloss)) * (0.2 + 0.8 * gloss) * step(0.0, ndl);
  vec3 specColor = mix(vec3(0.05), uColor, metal);

  // A faint rim from the sky keeps a dark suit readable against dark ground.
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  float facing = 0.5 * max(dot(N, V), 0.0) + 0.5 * diff;
  vec3 glow = uGlow * mix(1.0, 0.3 + 0.7 * facing, uFacets);
  vec3 lit = albedo * (uKeyColor * diff * shadow + ambientLight(N))
           + uKeyColor * specColor * shine * shadow
           + uAmbSky * rim * 0.18 * (0.4 + 0.6 * metal)
           + glow;
  lit += albedo * lampLight(vWorld, N);
  lit = applyAtmosphere(lit, vWorld);
  gl_FragColor = vec4(lit, 1.0);
}
`;

export interface LitMaterialOptions {
  /** Base color; CSS color strings are read as sRGB, like everywhere else in the game. */
  color: string;
  /** Color the surface gives off by itself; dark by default. */
  glow?: string;
  /** Scales the glow; above 1 it is bright enough to bloom. */
  glowIntensity?: number;
  /** 0 is matte, 1 is polished. */
  gloss?: number;
  metalness?: number;
  /** 0 (the default) glows evenly; towards 1 the glow dims on faces turned away, so flat facets show. */
  facets?: number;
}

export function createLitMaterial(
  registry: MaterialRegistry,
  options: LitMaterialOptions,
): ShaderMaterial {
  const glow = new Color(options.glow ?? '#000000').multiplyScalar(options.glowIntensity ?? 1);
  const uniforms: Record<string, IUniform> = {
    uColor: { value: new Color(options.color) },
    uGlow: { value: glow },
    uSurface: { value: new Vector2(options.gloss ?? 0.4, options.metalness ?? 0.2) },
    uFacets: { value: options.facets ?? 0 },
  };
  return registry.create({
    vertexShader: LIT_VERTEX,
    fragmentShader: LIT_FRAGMENT,
    uniforms,
  });
}
