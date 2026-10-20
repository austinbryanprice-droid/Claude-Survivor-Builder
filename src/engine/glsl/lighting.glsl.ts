/**
 * GLSL shared by every lit material: the shadow varyings (so custom shaders can use three's
 * shadow maps, single or cascaded), the shadow lookup with a distance fade, and a bump helper.
 */

/** Vertex-stage pars: declares three's shadow varyings and a helper to fill them. */
export const SHADOW_VERTEX_PARS = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>

void writeShadowVaryings(vec3 wp, vec3 wn, float viewDepth) {
  #ifdef USE_SHADOWMAP
    #if NUM_SUN_LIGHT_SHADOWS > 0
      vSunShadowWorldPosition = vec4(wp, viewDepth);
      vSunShadowWorldNormal = wn;
    #endif
    #if NUM_DIR_LIGHT_SHADOWS > 0
      vDirectionalShadowCoord[0] = directionalShadowMatrix[0] * vec4(wp + wn * directionalLightShadows[0].shadowNormalBias, 1.0);
    #endif
  #endif
}
`;

/** Fragment-stage pars: three's shadow lookup plus `sunShadow(viewDepth)` with a fade. */
export const SHADOW_FRAGMENT_PARS = /* glsl */ `
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

// x: shadows on (0/1), y: fade start, z: fade end (view depth in meters)
uniform vec3 uShadowParams;

float sunShadow(float viewDepth) {
  float s = 1.0;
  #ifdef USE_SHADOWMAP
    if (uShadowParams.x > 0.5) {
      s = getShadowMask();
      s = mix(s, 1.0, smoothstep(uShadowParams.y, uShadowParams.z, viewDepth));
    }
  #endif
  return s;
}
`;

/** Bump from a height field via screen-space derivatives; `H` is in meters. */
export const BUMP_GLSL = /* glsl */ `
vec3 bumpNormal(vec3 P, vec3 N, float H) {
  vec3 dpdx = dFdx(P);
  vec3 dpdy = dFdy(P);
  vec3 r1 = cross(dpdy, N);
  vec3 r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dFdx(H) * r1 + dFdy(H) * r2);
  return normalize(abs(det) * N - grad);
}
`;
