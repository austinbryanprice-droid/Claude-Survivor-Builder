import { BAKE_COMMON } from './bake.glsl';

/**
 * The surface of a block, baked once on the GPU. A tile is what one face of one block shows, from
 * 0 to 1 on both axes, and every material has several layouts of it (`TILE_LAYOUTS`) so a wall is
 * never one stamp repeated. The outer band, the width of the bevel (0.08), is what the chamfers
 * show, so it is plain: a dark edge that makes the groove between blocks read, with the pattern
 * fading in over the next 0.12. Each tile is drawn twice, once as albedo (sRGB color, height in
 * alpha) and once as surface data (R gloss, G metalness, B how much it glows by itself).
 *
 *   tier 0, Scrap: patchwork plates of salvaged metal, rust, rivets and run-off streaks.
 *   tier 1, Reinforced Composite: laminated grey-green panels, weave and ribs, with a cyan trim.
 *   tier 2, Advanced Alloy: brushed steel plates with amber markings, a vent and hazard stripes.
 *   tier 3, Energy-Infused: dark graphite with cyan veins and conduits that the shader pulses.
 */
export const STRUCTURE_BAKE_FRAGMENT = /* glsl */ `
${BAKE_COMMON}
uniform int uTier;
uniform int uLayout;
uniform int uPass;

vec3 gCol;
float gHeight;
vec3 gData;

// Distance from the tile's border; 0 on the border, 0.5 in the middle.
float edgeDistance(vec2 uv) {
  vec2 d = min(uv, 1.0 - uv);
  return min(d.x, d.y);
}

// 0 across the bevel band, 1 once the pattern has faded fully in.
float fieldMask(float e) {
  return smoothstep(0.08, 0.2, e);
}

// Signed distance to a box of half-size h around the origin.
float sdBox(vec2 p, vec2 h) {
  vec2 d = abs(p) - h;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// 1 inside a shape (negative distance), 0 outside, softened over w.
float fillMask(float d, float w) {
  return smoothstep(w, -w, d);
}

// A thin line along the zero of a distance, about w wide.
float lineMask(float d, float w) {
  return smoothstep(w, w * 0.3, abs(d));
}

// A round head (a rivet or a bolt) of radius r.
float headMask(vec2 uv, vec2 c, float r) {
  return smoothstep(r, r * 0.62, length(uv - c));
}

// Hexagonal cells one unit wide. x is the distance from the cell's middle in a hexagonal metric
// (0 in the middle, 0.5 at the rim), yz the middle of the cell.
vec3 hexCell(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - s * 0.5;
  vec2 b = mod(p - s * 0.5, s) - s * 0.5;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  return vec3(max(dot(q, vec2(0.5, 0.8660254)), q.x), p - g);
}

void scrapTile(vec2 uv, int lay) {
  float e = edgeDistance(uv);
  int sd = lay * 31;
  // Salvaged plates, each column's rows shifted so the seams do not line up.
  vec2 grid = lay == 0 ? vec2(3.0, 3.0) : (lay == 1 ? vec2(2.0, 2.0) : (lay == 2 ? vec2(1.0, 4.0) : vec2(2.0, 3.0)));
  vec2 warp = (vec2(fbm(uv * 4.0, 4, 3, 211 + sd), fbm(uv * 4.0 + 5.3, 4, 3, 213 + sd)) - 0.5) * 0.05;
  vec2 w = uv + warp;
  float column = floor(w.x * grid.x);
  vec2 q = vec2(w.x * grid.x, w.y * grid.y + hash21(ivec2(int(column), 0), 217 + sd) * grid.y);
  ivec2 cell = ivec2(floor(q));
  vec2 f = fract(q);
  float id = hash21(cell & ivec2(15), 221 + sd);

  vec3 base = hex(152.0, 80.0, 44.0);
  if (id > 0.16) base = hex(102.0, 72.0, 54.0);
  if (id > 0.34) base = hex(64.0, 108.0, 102.0);
  if (id > 0.5) base = hex(122.0, 120.0, 112.0);
  if (id > 0.66) base = hex(168.0, 132.0, 54.0);
  if (id > 0.82) base = hex(150.0, 62.0, 46.0);
  if (id > 0.92) base = hex(88.0, 94.0, 100.0);

  float n1 = fbm(uv * 16.0, 16, 4, 223 + sd);
  float n2 = fbm(uv * 64.0, 64, 3, 227 + sd);
  float seam = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  vec3 col = base * (0.7 + 0.62 * n1) * (0.88 + 0.24 * n2);

  // Rust creeps in from the seams and settles in the low patches; paint chips off where it does.
  float rust = smoothstep(0.42, 0.8, n1 + (0.16 - seam) * 1.4);
  col = mix(col, hex(128.0, 60.0, 28.0) * (0.8 + 0.5 * n2), rust * 0.7);
  float bare = smoothstep(0.7, 0.92, fbm(uv * 32.0, 32, 3, 231 + sd) + (0.1 - seam) * 0.8);
  col = mix(col, hex(104.0, 98.0, 92.0) * (0.8 + 0.4 * n2), bare * 0.55 * (1.0 - rust));

  // Run-off streaks under each plate's top edge.
  float streak = vnoiseP(vec2(uv.x * 64.0, uv.y * 4.0), ivec2(64, 4), 229 + sd);
  col *= 1.0 - 0.34 * smoothstep(0.55, 0.9, streak) * (1.0 - f.y);

  // Corrugated sheets in one layout.
  float rib = 0.0;
  if (lay == 2) {
    rib = 0.5 + 0.5 * sin(uv.x * 6.2831853 * 9.0);
    col *= 0.76 + 0.3 * rib;
  }

  // A dark seam line, and rivets near the corners of every plate.
  float seamLine = smoothstep(0.0, 0.04, seam);
  col *= mix(0.4, 1.0, seamLine);
  vec2 corner = min(f, 1.0 - f);
  float rivet = smoothstep(0.05, 0.022, length(corner - 0.1));
  col = mix(col, hex(168.0, 162.0, 150.0) * (0.8 + 0.4 * n2), rivet);

  // One layout carries a bolted-on repair plate with a shadow under it.
  float patchIn = 0.0;
  if (lay == 3) {
    float shadow = fillMask(sdBox(uv - vec2(0.58, 0.47), vec2(0.23, 0.16)), 0.035);
    col *= 1.0 - 0.5 * shadow;
    patchIn = fillMask(sdBox(uv - vec2(0.56, 0.5), vec2(0.23, 0.16)), 0.004);
    vec3 plate = hex(126.0, 130.0, 132.0) * (0.78 + 0.5 * n2) * (0.9 + 0.2 * n1);
    col = mix(col, plate, patchIn);
    vec2 pc = abs(uv - vec2(0.56, 0.5)) - vec2(0.19, 0.12);
    float pr = smoothstep(0.026, 0.012, length(pc));
    col = mix(col, hex(176.0, 170.0, 158.0), pr * patchIn);
    rivet = max(rivet, pr * patchIn);
    seamLine = min(seamLine, 1.0 - 0.8 * lineMask(sdBox(uv - vec2(0.56, 0.5), vec2(0.23, 0.16)), 0.012));
  }

  float field = fieldMask(e);
  gCol = mix(hex(56.0, 38.0, 30.0), col, field);
  float plateHeight = hash21(cell & ivec2(15), 239 + sd) * 0.12;
  gHeight = mix(0.5, clamp(0.4 + plateHeight + (seamLine - 1.0) * 0.28 + rivet * 0.4 + n2 * 0.16 - rust * 0.08 + rib * 0.1 + patchIn * 0.1, 0.0, 1.0), field);
  gData = vec3(0.18 + 0.1 * (1.0 - rust) + 0.2 * bare, 0.05 + 0.7 * rivet + 0.25 * bare + 0.12 * (1.0 - rust) * seamLine, 0.0);
}

void compositeTile(vec2 uv, int lay) {
  float e = edgeDistance(uv);
  int sd = lay * 29;
  float mottle = fbm(uv * 8.0, 8, 4, 235 + sd);
  float fine = fbm(uv * 64.0, 64, 3, 237 + sd);
  vec3 dark = hex(46.0, 60.0, 56.0);
  vec3 light = hex(106.0, 122.0, 112.0);
  float seam = 0.0;
  float bolts = 0.0;
  float trim = 0.0;
  float relief = 0.55;
  float pattern = 0.5;

  if (lay == 0) {
    // Two laminated slabs, one above the other, bolted at the corners; a cyan line along the top.
    float bands = vnoiseP(vec2(uv.x * 4.0, uv.y * 128.0), ivec2(4, 128), 233);
    pattern = bands;
    seam = lineMask(uv.y - 0.5, 0.014);
    float lower = step(uv.y, 0.5);
    pattern = mix(pattern, bands * 0.85, lower);
    bolts = headMask(abs(uv - 0.5) - vec2(0.3, 0.4), vec2(0.0), 0.04);
    trim = lineMask(uv.y - 0.84, 0.012) * step(0.2, uv.x) * step(uv.x, 0.8);
  } else if (lay == 1) {
    // Woven laminate with a vertical cyan indicator slot.
    float twill = fract((uv.x + uv.y) * 34.0);
    float weft = step(0.5, fract((uv.x - uv.y) * 34.0));
    pattern = 0.35 + 0.35 * smoothstep(0.0, 0.9, twill) + 0.25 * weft;
    seam = lineMask(sdBox(uv - vec2(0.5), vec2(0.34, 0.34)), 0.012);
    bolts = headMask(abs(uv - 0.5) - vec2(0.34), vec2(0.0), 0.034);
    float slot = fillMask(sdBox(uv - vec2(0.28, 0.5), vec2(0.022, 0.2)), 0.006);
    trim = slot;
  } else if (lay == 2) {
    // Ribbed panel: raised ridges running down the block.
    float ridge = 0.5 + 0.5 * cos(uv.x * 6.2831853 * 6.0);
    pattern = 0.25 + 0.6 * ridge;
    relief = 0.3 + 0.5 * ridge;
    seam = lineMask(uv.y - 0.5, 0.01) * 0.6;
    bolts = max(headMask(uv, vec2(0.5, 0.2), 0.04), headMask(uv, vec2(0.5, 0.8), 0.04));
  } else {
    // A honeycomb core showing through a framed window.
    vec3 hc = hexCell(uv * 7.0 + vec2(0.3, 0.1));
    float cellEdge = 0.5 - hc.x;
    float win = fillMask(sdBox(uv - 0.5, vec2(0.3)), 0.006);
    pattern = mix(0.45, 0.2 + 0.6 * smoothstep(0.0, 0.12, cellEdge), win);
    relief = mix(0.55, 0.3 + 0.4 * smoothstep(0.0, 0.1, cellEdge), win);
    seam = lineMask(sdBox(uv - 0.5, vec2(0.3)), 0.014);
    bolts = headMask(abs(uv - 0.5) - vec2(0.36), vec2(0.0), 0.03);
    float coreId = hash21(ivec2(floor(hc.yz * 3.0)), 241);
    trim = win * step(0.93, coreId) * smoothstep(0.0, 0.1, cellEdge);
  }

  vec3 col = mix(dark, light, 0.25 + 0.7 * pattern);
  col *= (0.8 + 0.36 * mottle) * (0.92 + 0.16 * fine);
  col *= 1.0 - 0.55 * seam;
  col = mix(col, hex(38.0, 44.0, 46.0), bolts * 0.85);
  col += hex(120.0, 132.0, 130.0) * 0.14 * smoothstep(0.0, 1.0, bolts) * (1.0 - bolts);
  col = mix(col, hex(70.0, 226.0, 234.0), trim * 0.9);

  float field = fieldMask(e);
  gCol = mix(hex(34.0, 42.0, 42.0), col, field);
  gHeight = mix(0.5, clamp(relief - seam * 0.3 + bolts * 0.25 + mottle * 0.1, 0.0, 1.0), field);
  gData = vec3(0.5 - 0.15 * seam, 0.3, trim * 0.75 * field);
}

void alloyTile(vec2 uv, int lay) {
  float e = edgeDistance(uv);
  int sd = lay * 23;
  // Brushed steel: streaks along the plate, and a finer grain across them.
  float brush = vnoiseP(vec2(uv.x * 2.0, uv.y * 256.0), ivec2(2, 256), 241 + sd);
  float grain = vnoiseP(vec2(uv.x * 8.0, uv.y * 128.0), ivec2(8, 128), 243 + sd);
  float wear = fbm(uv * 8.0, 8, 4, 245 + sd);
  vec3 steel = mix(hex(58.0, 66.0, 80.0), hex(112.0, 120.0, 134.0), 0.3 + 0.5 * brush);
  steel *= (0.86 + 0.24 * grain) * (0.86 + 0.24 * wear);
  vec3 col = steel;
  float seam = 0.0;
  float bolts = 0.0;
  float amber = 0.0;
  float glow = 0.0;
  float recess = 0.0;
  float gloss = 0.78;

  if (lay == 0) {
    // Two plates with an amber bar and its end caps across the middle.
    seam = lineMask(uv.x - 0.5, 0.012);
    float bar = fillMask(sdBox(uv - vec2(0.5, 0.5), vec2(0.3, 0.045)), 0.005);
    float capL = fillMask(sdBox(uv - vec2(0.18, 0.5), vec2(0.025, 0.1)), 0.005);
    float capR = fillMask(sdBox(uv - vec2(0.82, 0.5), vec2(0.025, 0.1)), 0.005);
    amber = max(bar, max(capL, capR));
    bolts = max(headMask(uv, vec2(0.22, 0.24), 0.032), max(headMask(uv, vec2(0.78, 0.24), 0.032), max(headMask(uv, vec2(0.22, 0.76), 0.032), headMask(uv, vec2(0.78, 0.76), 0.032))));
    glow = amber * 0.35;
  } else if (lay == 1) {
    // A hazard band low on the plate.
    float band = fillMask(sdBox(uv - vec2(0.5, 0.3), vec2(0.34, 0.075)), 0.005);
    float stripe = step(0.5, fract((uv.x + uv.y) * 9.0));
    amber = band * stripe;
    col = mix(col, hex(40.0, 44.0, 50.0), band * (1.0 - stripe));
    seam = lineMask(uv.y - 0.62, 0.012);
    bolts = max(headMask(uv, vec2(0.24, 0.76), 0.034), headMask(uv, vec2(0.76, 0.76), 0.034));
    glow = amber * 0.25;
  } else if (lay == 2) {
    // A vent: a recessed frame with slots.
    float frame = fillMask(sdBox(uv - 0.5, vec2(0.3, 0.26)), 0.006);
    float slots = step(0.38, fract(uv.y * 11.0)) * step(abs(uv.x - 0.5), 0.25);
    col = mix(col, hex(26.0, 30.0, 36.0) * (0.8 + 0.4 * wear), frame * 0.9);
    col = mix(col, hex(54.0, 60.0, 68.0), frame * slots * 0.8);
    recess = frame;
    seam = lineMask(sdBox(uv - 0.5, vec2(0.3, 0.26)), 0.014);
    bolts = max(headMask(uv, vec2(0.2, 0.2), 0.03), max(headMask(uv, vec2(0.8, 0.2), 0.03), max(headMask(uv, vec2(0.2, 0.8), 0.03), headMask(uv, vec2(0.8, 0.8), 0.03))));
    gloss = 0.5;
  } else {
    // A plain plate, diagonal seam, an amber indicator light.
    seam = lineMask(uv.y - uv.x * 0.7 - 0.12, 0.012);
    amber = headMask(uv, vec2(0.74, 0.72), 0.05);
    glow = amber * 0.8;
    bolts = max(headMask(uv, vec2(0.24, 0.26), 0.034), headMask(uv, vec2(0.3, 0.78), 0.034));
  }

  col *= 1.0 - 0.5 * seam;
  col = mix(col, hex(48.0, 52.0, 58.0), bolts);
  col += hex(190.0, 198.0, 208.0) * 0.1 * bolts * (1.0 - bolts);
  col = mix(col, hex(240.0, 158.0, 38.0), amber);

  float field = fieldMask(e);
  // The chamfer of a steel block is polished.
  gCol = mix(hex(98.0, 106.0, 118.0), col, field);
  gHeight = mix(0.5, clamp(0.5 - seam * 0.25 - recess * 0.3 + bolts * 0.3 + brush * 0.06, 0.0, 1.0), field);
  gData = vec3(gloss - 0.25 * seam, 0.9 * (1.0 - amber), glow * field);
}

void energyTile(vec2 uv, int lay) {
  float e = edgeDistance(uv);
  int sd = lay * 19;
  // Dark graphite with a mottled sheen.
  float mottle = fbm(uv * 16.0, 16, 4, 251 + sd);
  float fine = fbm(uv * 64.0, 64, 3, 253 + sd);
  vec3 col = hex(28.0, 32.0, 40.0) * (0.7 + 0.7 * mottle) * (0.85 + 0.3 * fine);

  // Veins run along the borders of a Worley pattern, a thick network and a finer one inside it.
  float scale1 = lay == 2 ? 11.0 : 6.0;
  vec2 w1 = worley(uv * scale1 + vec2(0.4), lay == 2 ? 16 : 8, 401 + sd);
  vec2 w2 = worley(uv * 16.0, 16, 409 + sd);
  float vein1 = smoothstep(lay == 2 ? 0.07 : 0.1, 0.0, w1.y - w1.x);
  float vein2 = smoothstep(0.07, 0.0, w2.y - w2.x) * 0.55;
  float vein = max(vein1, vein2 * smoothstep(0.1, 0.5, mottle));

  // A conduit around the block in one layout, a node in the middle of another, a cross in the third.
  float conduit = 0.0;
  if (lay == 0) conduit = lineMask(e - 0.115, 0.012);
  if (lay == 1) {
    float d = length(uv - 0.5);
    conduit = max(lineMask(d - 0.2, 0.016), fillMask(d - 0.07, 0.01));
    vein *= 0.65;
  }
  if (lay == 3) {
    conduit = max(lineMask(uv.y - 0.5, 0.016), lineMask(uv.y - 0.3, 0.009)) * step(0.1, uv.x) * step(uv.x, 0.9);
    vein *= 0.5;
  }
  float glow = max(vein, conduit);
  col = mix(col, hex(48.0, 222.0, 242.0), glow);

  float field = fieldMask(e);
  gCol = mix(hex(18.0, 22.0, 28.0), col, field);
  gHeight = mix(0.5, clamp(0.5 + mottle * 0.18 - glow * 0.12, 0.0, 1.0), field);
  gData = vec3(0.78, 0.45, glow * field);
}

void main() {
  gCol = vec3(0.0);
  gHeight = 0.5;
  gData = vec3(0.3, 0.0, 0.0);
  if (uTier == 0) scrapTile(vUv, uLayout);
  else if (uTier == 1) compositeTile(vUv, uLayout);
  else if (uTier == 2) alloyTile(vUv, uLayout);
  else energyTile(vUv, uLayout);
  gl_FragColor = uPass == 0 ? vec4(gCol, gHeight) : vec4(gData, 1.0);
}
`;
