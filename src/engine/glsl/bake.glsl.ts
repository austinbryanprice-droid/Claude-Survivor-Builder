/**
 * One-time GPU bake of the tileable procedural textures: a shared noise atlas, water ripple
 * normals and the ground layers (grass, rock, dirt, ash, beach). Baking on the GPU takes
 * milliseconds where the same patterns on the CPU would take seconds. All noise is periodic so
 * every texture tiles. The hash, noise and color helpers are exported as `BAKE_COMMON` so the
 * structure tiles (`structure-bake.glsl.ts`) bake with the same ones.
 */

export const BAKE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Hash, periodic noise, Worley and color helpers shared by every bake shader. */
export const BAKE_COMMON = /* glsl */ `
precision highp float;
precision highp int;
varying vec2 vUv;

uvec2 pcg2d(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return v;
}

float hash21(ivec2 p, int seed) {
  uvec2 h = pcg2d(uvec2(p) + uvec2(uint(seed) * 9781u, uint(seed) * 6271u));
  return float(h.x >> 8u) * (1.0 / 16777216.0);
}

vec2 hash22(ivec2 p, int seed) {
  uvec2 h = pcg2d(uvec2(p) + uvec2(uint(seed) * 9781u, uint(seed) * 6271u));
  return vec2(float(h.x >> 8u), float(h.y >> 8u)) * (1.0 / 16777216.0);
}

// Periodic value noise; each period must be a power of two and equal the number of lattice
// cells the texture spans on that axis, so the texture tiles.
float vnoiseP(vec2 p, ivec2 period, int seed) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 m = period - 1;
  float a = hash21(i & m, seed);
  float b = hash21((i + ivec2(1, 0)) & m, seed);
  float c = hash21((i + ivec2(0, 1)) & m, seed);
  float d = hash21((i + ivec2(1, 1)) & m, seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float vnoise(vec2 p, int period, int seed) {
  return vnoiseP(p, ivec2(period), seed);
}

float fbm(vec2 p, int period, int octaves, int seed) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += vnoise(p, period, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2.0;
    period *= 2;
  }
  return sum / norm;
}

// Periodic Worley noise. Returns F1 and F2 distances (in cell units).
vec2 worley(vec2 p, int period, int seed) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  int m = period - 1;
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 c = ivec2(x, y);
      vec2 o = hash22((i + c) & m, seed);
      vec2 r = vec2(c) + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return sqrt(vec2(d1, d2));
}

// Id of the Worley cell nearest the point, as a hash in [0, 1).
float worleyId(vec2 p, int period, int seed) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  int m = period - 1;
  float best = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 c = ivec2(x, y);
      vec2 o = hash22((i + c) & m, seed);
      vec2 r = vec2(c) + o - f;
      float d = dot(r, r);
      if (d < best) { best = d; id = hash21(((i + c) & m) + ivec2(31, 17), seed); }
    }
  }
  return id;
}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 hex(float r, float g, float b) { return toLinear(vec3(r, g, b) / 255.0); }
`;

export const BAKE_FRAGMENT = /* glsl */ `
${BAKE_COMMON}
uniform int uLayer;
uniform float uSeed;

// Layer 0: tileable noise atlas. R, G, B: fbm at three scales; A: Worley F1.
vec4 bakeNoise(vec2 uv) {
  float r = fbm(uv * 8.0, 8, 5, 3);
  float g = fbm(uv * 8.0 + 3.7, 8, 5, 11);
  float b = fbm(uv * 16.0, 16, 4, 23);
  float a = worley(uv * 16.0, 16, 5).x;
  return vec4(r, g, b, a);
}

float rippleHeight(vec2 uv) {
  float h = fbm(uv * 16.0, 16, 4, 41) * 0.65 + fbm(uv * 32.0 + 5.0, 32, 3, 53) * 0.35;
  return h;
}

// Layer 1: water ripples. RG: slope in x and z, B: height.
vec4 bakeRipple(vec2 uv) {
  float e = 1.0 / 256.0;
  float h = rippleHeight(uv);
  float hx = rippleHeight(uv + vec2(e, 0.0));
  float hz = rippleHeight(uv + vec2(0.0, e));
  vec2 s = vec2(hx - h, hz - h) * 28.0;
  return vec4(s * 0.5 + 0.5, h, 1.0);
}

// Ground layers write sRGB-intended albedo (converted to linear here) and height in alpha.
vec4 bakeGrass(vec2 uv) {
  vec2 p = uv * 16.0;
  float big = fbm(uv * 4.0, 4, 4, 61);
  // Blade streaks, stretched along three directions (cell counts match the periods).
  float s1 = vnoiseP(vec2(uv.x * 128.0, uv.y * 16.0), ivec2(128, 16), 71);
  float s2 = vnoiseP(vec2(uv.y * 128.0 + 3.1, uv.x * 16.0), ivec2(128, 16), 73);
  float s3 = vnoiseP(vec2((p.x + p.y) * 8.0, (p.x - p.y) * 1.0), ivec2(128, 16), 79);
  float blades = (s1 + s2 + s3) / 3.0;
  float clump = worley(uv * 32.0, 32, 83).x;
  vec3 deep = hex(34.0, 62.0, 24.0);
  vec3 mid = hex(64.0, 102.0, 36.0);
  vec3 light = hex(118.0, 146.0, 58.0);
  vec3 dry = hex(150.0, 136.0, 66.0);
  vec3 col = mix(deep, mid, smoothstep(0.25, 0.7, big));
  col = mix(col, light, smoothstep(0.45, 0.85, blades) * 0.75);
  col *= mix(0.72, 1.12, smoothstep(0.1, 0.8, clump));
  float dryMask = smoothstep(0.62, 0.8, fbm(uv * 8.0 + 7.0, 8, 3, 89));
  col = mix(col, dry, dryMask * 0.5);
  // Occasional tiny flowers.
  float fl = hash21(ivec2(floor(uv * 128.0)), 97);
  vec2 fp = fract(uv * 128.0) - 0.5;
  float fd = smoothstep(0.2, 0.08, length(fp));
  if (fl > 0.985) col = mix(col, hex(240.0, 226.0, 150.0), fd * 0.85);
  else if (fl > 0.972) col = mix(col, hex(222.0, 150.0, 190.0), fd * 0.8);
  float height = clamp(blades * 0.7 + (1.0 - clump) * 0.3, 0.0, 1.0);
  return vec4(col, height);
}

vec4 bakeRock(vec2 uv) {
  // Blocky fracture faces with hairline cracks, layered strata and grit. The warp is periodic,
  // so the texture still tiles.
  float warp = fbm(uv * 4.0, 4, 3, 103) - 0.5;
  vec2 wuv = uv + warp * 0.07;
  vec2 w = worley(wuv * 4.0, 4, 101);
  float cracks = smoothstep(0.0, 0.05, w.y - w.x);
  float strata = vnoiseP(vec2(wuv.x * 4.0, wuv.y * 32.0), ivec2(4, 32), 107);
  float strata2 = vnoiseP(vec2(wuv.x * 8.0, wuv.y * 64.0), ivec2(8, 64), 131);
  float grain = fbm(uv * 64.0, 64, 3, 109);
  float large = fbm(uv * 4.0, 4, 4, 113);
  vec3 warm = hex(138.0, 120.0, 100.0);
  vec3 cool = hex(108.0, 110.0, 108.0);
  vec3 dark = hex(52.0, 48.0, 46.0);
  vec3 col = mix(cool, warm, smoothstep(0.3, 0.7, large));
  col *= 0.62 + strata * 0.5 + strata2 * 0.18;
  col *= 0.8 + grain * 0.4;
  col = mix(dark, col, 0.35 + 0.65 * cracks);
  float id = worleyId(wuv * 4.0, 4, 101);
  col *= 0.84 + id * 0.3;
  float lichen = smoothstep(0.68, 0.86, fbm(uv * 16.0 + 2.0, 16, 4, 127));
  col = mix(col, hex(118.0, 128.0, 72.0), lichen * 0.4);
  float height = clamp(cracks * 0.35 + strata * 0.25 + grain * 0.3 + w.x * 0.15, 0.0, 1.0);
  return vec4(col, height);
}

vec4 bakeDirt(vec2 uv) {
  vec2 w = worley(uv * 32.0, 32, 131);
  float pebble = smoothstep(0.42, 0.28, w.x);
  float id = worleyId(uv * 32.0, 32, 131);
  float fine = fbm(uv * 128.0, 128, 3, 137);
  float large = fbm(uv * 4.0, 4, 4, 139);
  vec3 soil = mix(hex(70.0, 58.0, 42.0), hex(104.0, 88.0, 62.0), large);
  soil *= 0.78 + fine * 0.45;
  vec3 peb = mix(hex(138.0, 130.0, 118.0), hex(110.0, 94.0, 80.0), id);
  vec3 col = mix(soil, peb * (0.8 + 0.4 * (1.0 - w.x)), pebble * 0.85);
  vec2 cw = worley(uv * 8.0, 8, 141);
  float cracks = smoothstep(0.0, 0.1, cw.y - cw.x);
  col *= 0.94 + 0.06 * cracks;
  float height = clamp(pebble * 0.6 + fine * 0.3 + (1.0 - w.x) * 0.15, 0.0, 1.0);
  return vec4(col, height);
}

vec4 bakeAsh(vec2 uv) {
  vec2 w = worley(uv * 16.0, 16, 151);
  float flake = smoothstep(0.0, 0.18, w.y - w.x);
  float id = worleyId(uv * 16.0, 16, 151);
  float fine = fbm(uv * 64.0, 64, 3, 157);
  float large = fbm(uv * 4.0, 4, 4, 163);
  vec3 col = mix(hex(36.0, 34.0, 33.0), hex(96.0, 90.0, 84.0), large * 0.7 + fine * 0.3);
  col *= 0.78 + id * 0.34;
  col = mix(col * 0.72, col, flake);
  // Pale ash drifts over the charcoal.
  float drift = smoothstep(0.52, 0.78, fbm(uv * 6.0 + 4.0, 8, 3, 169));
  col = mix(col, hex(128.0, 124.0, 118.0) * (0.8 + fine * 0.4), drift * 0.45);
  // Faint ember tint in a few cracks.
  float ember = smoothstep(0.78, 0.92, fbm(uv * 8.0, 8, 3, 167)) * (1.0 - flake);
  col = mix(col, hex(170.0, 70.0, 30.0), ember * 0.3);
  float height = clamp(flake * 0.55 + fine * 0.4, 0.0, 1.0);
  return vec4(col, height);
}

vec4 bakeSand(vec2 uv) {
  vec2 w = worley(uv * 32.0, 32, 171);
  float id = worleyId(uv * 32.0, 32, 171);
  float pebble = smoothstep(0.46, 0.3, w.x);
  float fine = fbm(uv * 128.0, 128, 3, 173);
  float large = fbm(uv * 4.0, 4, 4, 179);
  vec3 sand = mix(hex(128.0, 110.0, 82.0), hex(168.0, 148.0, 110.0), large);
  sand *= 0.85 + fine * 0.3;
  vec3 peb = mix(hex(122.0, 116.0, 104.0), hex(92.0, 80.0, 68.0), id);
  vec3 col = mix(sand, peb * (0.85 + 0.3 * (1.0 - w.x)), pebble * 0.55);
  float height = clamp(pebble * 0.5 + fine * 0.25, 0.0, 1.0);
  return vec4(col, height);
}

void main() {
  vec4 c;
  if (uLayer == 0) c = bakeNoise(vUv);
  else if (uLayer == 1) c = bakeRipple(vUv);
  else if (uLayer == 2) c = bakeGrass(vUv);
  else if (uLayer == 3) c = bakeRock(vUv);
  else if (uLayer == 4) c = bakeDirt(vUv);
  else if (uLayer == 5) c = bakeAsh(vUv);
  else c = bakeSand(vUv);
  gl_FragColor = c;
}
`;
