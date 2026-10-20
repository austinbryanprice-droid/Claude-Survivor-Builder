/**
 * Shared atmosphere GLSL: the analytic sky, sun-tinted height fog with colored mist pockets,
 * and ambient light. Every material includes this chunk so the sky, the water reflections and
 * the distance haze always agree. Uniforms are shared objects, set once per frame by
 * `Atmosphere` in `atmosphere.ts`.
 *
 * Defines: SKY_RICH (lit cloud model), MIST (colored mist pockets).
 */

export const ATMOSPHERE_UNIFORMS = /* glsl */ `
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyHorizonSun;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec4 uSkyParams;
uniform vec4 uFogParams;
uniform vec4 uMistLake;
uniform vec4 uMistCrash;
uniform vec3 uMistLakeColor;
uniform vec3 uMistCrashColor;
uniform vec4 uMistParams;
uniform sampler2D uNoise;
`;

export const ATMOSPHERE_FUNCTIONS = /* glsl */ `
// uSkyParams: x cloud cover, y night (0..1), z time in seconds, w star brightness
// uFogParams: x base density (1/m), y height falloff (1/m), z base height (m), w unused
// uMistLake / uMistCrash: x, z center, radius, top height. uMistParams: x, y densities.

float skyNoise(vec2 p) {
  float n = texture2D(uNoise, p * 0.05).r * 0.52
          + texture2D(uNoise, p * 0.13 + vec2(0.37, 0.71)).g * 0.3
          + texture2D(uNoise, p * 0.31 + vec2(0.11, 0.53)).b * 0.18;
  return (n - 0.5) * 2.6 + 0.5;
}

float cloudDensity(vec2 p, float cover) {
  float t0 = 0.78 - cover * 0.62;
  return smoothstep(t0, t0 + 0.24, skyNoise(p));
}

vec3 skyGradient(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  float sunDot = dot(d, uSunDir);
  float sunSide = pow(clamp(sunDot * 0.5 + 0.5, 0.0, 1.0), 3.0);
  vec3 hz = mix(uSkyHorizon, uSkyHorizonSun, sunSide);
  vec3 col = mix(hz, uSkyMid, smoothstep(0.0, 0.26, h));
  col = mix(col, uSkyZenith, smoothstep(0.1, 0.62, h));
  float s = max(sunDot, 0.0);
  float s2 = s * s;
  float s4 = s2 * s2;
  float s8 = s4 * s4;
  float glowWide = s8 * s2 * s2;       // broad warm halo, reaching about 30 degrees
  float glowNear = pow(s, 56.0);       // bright core around the sun, about 10 degrees
  float lowSun = 1.0 - smoothstep(0.0, 0.7, h);
  col += uSkyHorizonSun * glowWide * (0.22 + 0.4 * lowSun);
  col += uSunColor * glowNear * 0.3;
  col = mix(col, hz, smoothstep(0.0, -0.18, d.y));
  return col;
}

vec4 cloudLayer(vec3 d) {
  if (d.y <= 0.005) return vec4(0.0);
  float fade = smoothstep(0.005, 0.2, d.y);
  float cover = uSkyParams.x;
  vec2 p = d.xz / (d.y * 0.85 + 0.2) * 1.15 + vec2(uSkyParams.z * 0.006, uSkyParams.z * 0.0025);
  float dens = cloudDensity(p, cover);
  if (dens <= 0.002) return vec4(0.0);
  float sunDot = max(dot(d, uSunDir), 0.0);
  #ifdef SKY_RICH
    vec2 sdir = normalize(uSunDir.xz + vec2(1e-4));
    float reach = clamp(0.1 / max(uSunDir.y, 0.25), 0.1, 0.32);
    float dens2 = cloudDensity(p + sdir * reach, cover);
    float lit = 1.0 - clamp((dens2 - dens * 0.3) * 2.4, 0.0, 1.0);
    vec3 col = mix(uCloudShade, uCloudLit, lit);
    col *= mix(1.0, 0.86, dens * dens);
    float edge = clamp(1.0 - dens, 0.0, 1.0);
    col += uCloudLit * pow(sunDot, 5.0) * (0.35 + edge) * 0.9;
  #else
    vec3 col = mix(uCloudShade, uCloudLit, clamp(0.35 + d.y * 0.5 + pow(sunDot, 4.0), 0.0, 1.0));
  #endif
  return vec4(col, dens * fade);
}

float hash13s(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// Sky color along a world-space direction; includes sun disc, clouds, stars and moon.
vec3 skyRadiance(vec3 d) {
  vec3 col = skyGradient(d);
  vec4 cl = cloudLayer(d);
  float sunDot = dot(d, uSunDir);
  float disc = smoothstep(0.99962, 0.99975, sunDot) * step(0.0, d.y + 0.02);
  float cloudCut = 1.0 - cl.a * 0.5;
  vec3 discColor = mix(uSunColor, vec3(max(uSunColor.r, max(uSunColor.g, uSunColor.b))), 0.55);
  col += discColor * 12.0 * disc * cloudCut;
  float night = uSkyParams.y;
  if (night > 0.01 && d.y > 0.0) {
    vec3 q = floor(d * 220.0);
    float h = hash13s(q);
    float star = step(0.9962, h) * (0.35 + 0.65 * hash13s(q + 7.0));
    col += vec3(0.75, 0.85, 1.0) * star * night * uSkyParams.w * (1.0 - cl.a) * smoothstep(0.0, 0.12, d.y);
    float md = dot(d, uMoonDir);
    col += vec3(0.78, 0.86, 1.0) * smoothstep(0.99935, 0.99965, md) * 2.2 * night * (1.0 - cl.a * 0.8);
    col += vec3(0.22, 0.3, 0.5) * pow(max(md, 0.0), 40.0) * 0.35 * night;
  }
  return mix(col, cl.rgb, cl.a);
}

vec3 fogColorFor(vec3 dir) {
  float s = max(dot(dir, uSunDir), 0.0);
  float scatter = clamp(pow(s, 3.0) * 0.55 + pow(s, 14.0) * 0.7, 0.0, 1.0);
  vec3 c = mix(uFogColor, uFogSunColor, scatter);
  return c * (1.0 + pow(s, 28.0) * 0.9);
}

#ifdef MIST
// Length of the segment c -> p that lies inside a vertical cylinder and below its top.
float mistPath(vec3 c, vec3 p, vec4 zone, out float midY, out vec2 midXZ) {
  midY = c.y;
  midXZ = c.xz;
  vec2 d2 = p.xz - c.xz;
  float a = dot(d2, d2);
  vec2 oc = c.xz - zone.xy;
  float t0 = 0.0, t1 = 1.0;
  float cc = dot(oc, oc) - zone.z * zone.z;
  if (a < 1e-6) {
    if (cc > 0.0) return 0.0;
  } else {
    float b = 2.0 * dot(oc, d2);
    float disc = b * b - 4.0 * a * cc;
    if (disc <= 0.0) return 0.0;
    float sq = sqrt(disc);
    t0 = max((-b - sq) / (2.0 * a), 0.0);
    t1 = min((-b + sq) / (2.0 * a), 1.0);
    if (t1 <= t0) return 0.0;
  }
  float dy = p.y - c.y;
  if (abs(dy) < 1e-4) {
    if (c.y > zone.w) return 0.0;
  } else {
    float tt = (zone.w - c.y) / dy;
    if (dy > 0.0) t1 = min(t1, tt); else t0 = max(t0, tt);
  }
  if (t1 <= t0) return 0.0;
  float m = 0.5 * (t0 + t1);
  midY = mix(c.y, p.y, m);
  midXZ = mix(c.xz, p.xz, m);
  return (t1 - t0) * length(p - c);
}

float mistTau(vec3 c, vec3 p, vec4 zone, float density) {
  float midY;
  vec2 midXZ;
  float path = mistPath(c, p, zone, midY, midXZ);
  if (path <= 0.0) return 0.0;
  float rr = length(midXZ - zone.xy) / zone.z;
  float soft = 1.0 - smoothstep(0.45, 1.0, rr);
  float topFade = smoothstep(zone.w, zone.w - 4.0, midY);
  float nz = 0.55 + 0.9 * texture2D(uNoise, midXZ * 0.018 + vec2(uSkyParams.z * 0.0012, 0.0)).r;
  return density * path * soft * topFade * nz;
}
#endif

// Blends a lit surface color toward the haze (and mist pockets) between the camera and wp.
vec3 applyAtmosphere(vec3 color, vec3 wp) {
  vec3 v = wp - uCamPos;
  float dist = length(v);
  vec3 dir = v / max(dist, 0.001);
  float k = uFogParams.y;
  float y0 = clamp(uCamPos.y - uFogParams.z, -30.0, 300.0);
  float y1 = clamp(wp.y - uFogParams.z, -30.0, 300.0);
  float e0 = exp(-k * y0);
  float e1 = exp(-k * y1);
  float dy = y1 - y0;
  float tau = (abs(dy) * k < 0.002)
    ? uFogParams.x * e0 * dist
    : uFogParams.x * dist * (e0 - e1) / (k * dy);
  color = mix(color, fogColorFor(dir), 1.0 - exp(-tau));
  #ifdef MIST
    float tl = mistTau(uCamPos, wp, uMistLake, uMistParams.x);
    color = mix(color, uMistLakeColor, 1.0 - exp(-tl));
    float tc = mistTau(uCamPos, wp, uMistCrash, uMistParams.y);
    color = mix(color, uMistCrashColor, 1.0 - exp(-tc));
  #endif
  return color;
}

vec3 ambientLight(vec3 n) {
  return mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5);
}
`;

export const ATMOSPHERE_GLSL = ATMOSPHERE_UNIFORMS + ATMOSPHERE_FUNCTIONS;
