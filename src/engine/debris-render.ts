import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DebrisView } from '../shared/economy';
import { createRng } from '../shared/hash';
import { NET } from '../shared/net-config';
import { ATMOSPHERE_GLSL } from './glsl/atmosphere.glsl';
import { SHADOW_FRAGMENT_PARS, SHADOW_VERTEX_PARS } from './glsl/lighting.glsl';
import type { MaterialRegistry } from './materials';

/**
 * The heaps of wreckage the crew strips for materials, drawn as one instanced mesh: a buckled hull
 * plate half sunk in the ground with a rib of the station's frame standing out of it, a pile of
 * crates, barrels or a broken console on top, bent beams, scorched rubble round the foot and a
 * leaning mast that carries an amber lamp, so a heap can be found across the valley. Built from
 * boxes, cylinders and bent slabs in code (no assets), and the whole field costs one draw call and
 * one more for its shadows.
 *
 * A heap is stripped a few times and the picture shows how many are left: the model is made in layers,
 * and each layer goes (its pieces shrink away, thrown a little outward) once the share of strips
 * left falls below its mark, so the top of a heap goes first and the last strip takes the rest. All of
 * that, and the rise out of the ground when a dawn uncovers a heap and the sink back into it when the
 * last strip is taken, is worked out in the vertex shader from a few numbers per heap.
 *
 * What a heap shows comes from the view the network layer keeps (`DebrisView`); this only dresses it.
 * What it keeps per heap is what the picture needs and the host does not say: the eased share left,
 * how far up out of the ground it is, the flash of a strip and the glow of the cursor on it.
 */

/** Seconds a heap takes to come up out of the ground when a dawn uncovers it, and to sink back when stripped bare. */
const RISE_SECONDS = 0.9;
const SINK_SECONDS = 0.6;
/** How quickly the share shown follows the share left, a strip taking about a third of a second to show. */
const STRIP_FOLLOW = 9;
/** A strip lights the heap white-hot, and the light dies away in this long. */
const FLASH_FADE = 0.3;
/** How quickly the glow of the cursor comes and goes. */
const AIM_FOLLOW = 14;
/** A frame longer than this (a hidden tab, a breakpoint) is not time passing for the heaps. */
const MAX_STEP = 0.1;
/** Below this, an easing value is taken to have arrived. */
const ARRIVED = 0.002;

/** Surface looks. They index the surfaces in the fragment shader. */
const LOOK = {
  patchwork: 0,
  painted: 1,
  steel: 2,
  scorch: 3,
  hazard: 4,
  lamp: 5,
  beacon: 6,
  screen: 7,
} as const;

/** The share of strips left below which a layer of the model has gone. */
const GOES = { stays: 0, last: 0.2, low: 0.4, middle: 0.6, top: 0.8 } as const;

/** How many ways the top of a heap is dressed: crates, barrels or a console. */
const VARIANTS = 3;

/**
 * The model is drawn at this multiple of the sizes written into it below. The grass of the valley
 * stands up to a block and a third, so a heap that is only a block tall is swallowed by it.
 */
const MODEL_SCALE = 1.5;

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

const VERTEX_ATTRIBUTES = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iData;   // yaw, size, share of strips left (as shown), how far up out of the ground
attribute vec4 iState;  // flash, aimed, which dressing, a number of its own
attribute vec4 aPart;   // look, share at which it goes, dressing it belongs to (0: all), a number of its own
attribute vec3 aCenter; // the middle of the piece, in the model's own space
`;

const POSE_GLSL = /* glsl */ `
vec3 rotY(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

// Puts a vertex of the model where this heap has it, in the world.
void poseVertex(vec3 p, vec3 n, out vec3 wp, out vec3 wn) {
  float goes = aPart.y;
  float dressing = aPart.z;
  float mine = (dressing < 0.5 || abs(dressing - iState.z) < 0.5) ? 1.0 : 0.0;
  // A layer goes as the share left falls below its mark: its pieces shrink to their middles, thrown a little outward.
  float kept = goes <= 0.0 ? 1.0 : smoothstep(goes - 0.04, goes + 0.04, iData.z);
  kept *= mine;
  vec3 away = normalize(vec3(aCenter.x, 0.5, aCenter.z) + vec3(0.0001));
  p = aCenter + away * (1.0 - kept) * 0.45 + (p - aCenter) * kept;

  // Up out of the ground when uncovered, back into it when stripped bare: the ground hides the part below it.
  float up = smoothstep(0.0, 1.0, iData.w);
  p.y -= (1.0 - up) * 4.8;

  p *= iData.y;
  wp = rotY(p, iData.x) + iPos;
  wn = rotY(n, iData.x);
}
`;

const VERTEX = /* glsl */ `
${SHADOW_VERTEX_PARS}
${VERTEX_ATTRIBUTES}
${POSE_GLSL}
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vModel;
varying vec3 vModelNormal;
varying float vViewDepth;
varying float vLook;
varying float vPhase;
varying float vFlash;
varying float vAimed;

void main() {
  vec3 wp;
  vec3 wn;
  poseVertex(position, normal, wp, wn);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vViewDepth = -mv.z;
  vWorld = wp;
  vNormal = wn;
  vModel = position;
  vModelNormal = normal;
  vLook = aPart.x;
  vPhase = aPart.w + iState.w * 11.0;
  vFlash = iState.x;
  vAimed = iState.y;
  writeShadowVaryings(wp, wn, vViewDepth);
}
`;

const FRAGMENT = /* glsl */ `
${SHADOW_FRAGMENT_PARS}
${ATMOSPHERE_GLSL}

uniform vec3 uRust;
uniform vec3 uRustDark;
uniform vec3 uPaint;
uniform vec3 uPaintDark;
uniform vec3 uPrimer;
uniform vec3 uSteel;
uniform vec3 uSteelWorn;
uniform vec3 uScorch;
uniform vec3 uEmber;
uniform vec3 uHazard;
uniform vec3 uBlack;
uniform vec3 uLampGlow;
uniform vec3 uBeaconGlow;
uniform vec3 uGlass;
uniform vec3 uScreenGlow;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vModel;
varying vec3 vModelNormal;
varying float vViewDepth;
varying float vLook;
varying float vPhase;
varying float vFlash;
varying float vAimed;

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash13s(i);
  float b = hash13s(i + vec3(1.0, 0.0, 0.0));
  float c = hash13s(i + vec3(0.0, 1.0, 0.0));
  float d = hash13s(i + vec3(1.0, 1.0, 0.0));
  float e = hash13s(i + vec3(0.0, 0.0, 1.0));
  float g = hash13s(i + vec3(1.0, 0.0, 1.0));
  float h = hash13s(i + vec3(0.0, 1.0, 1.0));
  float k = hash13s(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}

// The plane of the face a point is on, so that a pattern lies flat on it.
vec2 faceUv(vec3 q, vec3 n) {
  vec3 a = abs(n);
  if (a.y > a.x && a.y > a.z) return q.xz;
  return a.x > a.z ? q.zy : q.xy;
}

// The base color of a look at a point of the model, the light it gives off, and x: gloss, y: metalness.
void surface(float look, vec3 q, vec3 mn, float t, float phase, out vec3 base, out vec3 glow, out vec2 finish) {
  glow = vec3(0.0);
  float wear = vnoise(q * 3.3 + phase);
  float grit = vnoise(q * 13.0 + phase * 2.0);
  float near = 1.0 - smoothstep(8.0, 22.0, vViewDepth);

  if (look < 1.5) {
    // Patchwork plates, salvaged and bolted on again: rust, chipped paint and grey primer, with rivets.
    // Look 1 is the painted kind, which keeps more of its paint.
    vec2 uv = faceUv(q, mn) * 1.8 + phase;
    vec2 cell = floor(uv);
    vec2 f = fract(uv);
    float pick = hash13s(vec3(cell, floor(phase)));
    if (look > 0.5) pick = pick * 0.45;
    vec3 plate;
    if (pick < 0.3) plate = uPaint;
    else if (pick < 0.46) plate = mix(uPaint, uPaintDark, 0.5);
    else if (pick < 0.72) plate = uRust;
    else if (pick < 0.88) plate = uPrimer;
    else plate = uRustDark;
    // Rust blooms through the paint where the plate is worn, and the primer shows in the chips.
    float chip = smoothstep(0.52, 0.62, wear + grit * 0.25);
    plate = mix(plate, uRust, chip * (pick < 0.46 ? 0.85 : 0.35));
    plate = mix(plate, uRustDark, smoothstep(0.55, 0.9, grit) * 0.5);
    float seam = 1.0 - smoothstep(0.0, 0.05, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    plate *= 1.0 - 0.55 * seam;
    vec2 corner = vec2(0.5) - abs(f - 0.5);
    float rivet = smoothstep(0.075, 0.05, length(corner - vec2(0.1))) * near;
    plate = mix(plate, uPrimer * 1.25, rivet * 0.8);
    base = plate;
    finish = vec2(0.28, 0.35);
  } else if (look < 2.5) {
    // Dark steel, bright where it has been scraped.
    base = mix(uSteel, uSteelWorn, smoothstep(0.6, 0.9, grit) * 0.5 + smoothstep(0.75, 1.0, wear) * 0.2);
    finish = vec2(0.5, 0.75);
  } else if (look < 3.5) {
    // Scorched rubble, with embers that have not gone out.
    base = mix(uScorch, uRustDark, wear * 0.5);
    float ember = smoothstep(0.86, 0.96, grit) * (0.55 + 0.45 * sin(t * 2.2 + phase * 5.0 + wear * 9.0));
    glow = uEmber * ember * 0.9;
    finish = vec2(0.15, 0.1);
  } else if (look < 4.5) {
    // Hazard stripes, worn away in patches.
    float stripe = step(0.5, fract((q.x + q.y + q.z) * 3.2));
    vec3 paint = mix(uBlack, uHazard, stripe);
    base = mix(paint, uRustDark, smoothstep(0.5, 0.75, wear) * 0.7);
    finish = vec2(0.35, 0.3);
  } else if (look < 5.5) {
    // The mast's lamp: an amber glow that breathes.
    base = uHazard * 0.5;
    glow = uLampGlow * (0.65 + 0.35 * sin(t * 2.4 + phase));
    finish = vec2(0.6, 0.2);
  } else if (look < 6.5) {
    // A beacon that blinks cyan: the station's, still talking to nobody.
    float blink = step(0.35, fract(t * 0.7 + phase * 0.37));
    base = uBlack * 2.0;
    glow = uBeaconGlow * (0.25 + 0.75 * blink);
    finish = vec2(0.7, 0.2);
  } else {
    // A cracked console screen, flickering with lines.
    float lines = 0.55 + 0.45 * sin(q.y * 70.0 + t * 3.0);
    float flicker = 0.75 + 0.25 * step(0.5, fract(sin(floor(t * 9.0) + phase) * 437.58));
    float crack = smoothstep(0.42, 0.5, vnoise(vec3(q.xy * 9.0, phase)));
    base = uGlass;
    glow = uScreenGlow * lines * flicker * crack;
    finish = vec2(0.9, 0.1);
  }
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  float shadow = sunShadow(vViewDepth);
  float ndl = dot(N, uKeyDir);
  float diff = clamp((ndl + 0.08) / 1.08, 0.0, 1.0);
  float t = uSkyParams.z;

  vec3 base;
  vec3 glow;
  vec2 finish;
  surface(vLook, vModel, normalize(vModelNormal), t, vPhase, base, glow, finish);
  float gloss = finish.x;
  float metal = finish.y;
  vec3 albedo = base * (1.0 - 0.6 * metal);
  vec3 H = normalize(uKeyDir + V);
  float shine = pow(max(dot(N, H), 0.0), mix(6.0, 90.0, gloss)) * (0.2 + 0.8 * gloss) * step(0.0, ndl);
  vec3 specColor = mix(vec3(0.05), base, metal);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);

  // The foot of a heap is darker where it meets the ground.
  float ground = mix(0.55, 1.0, smoothstep(0.0, 0.7, vModel.y));

  vec3 lit = albedo * (uKeyColor * diff * shadow + ambientLight(N)) * ground
           + uKeyColor * specColor * shine * shadow
           + uAmbSky * rim * 0.18 * (0.4 + 0.6 * metal)
           + glow;
  // The cursor on a heap lights its edges, and a strip lights all of it white-hot for a moment.
  lit += vec3(1.0, 0.78, 0.42) * vAimed * (0.03 + 0.6 * rim) * (0.85 + 0.15 * sin(t * 5.0));
  lit = mix(lit, vec3(1.0, 0.82, 0.64) * 1.5, vFlash * 0.7);
  lit = applyAtmosphere(lit, vWorld);
  gl_FragColor = vec4(lit, 1.0);
}
`;

const DEPTH_VERTEX = /* glsl */ `
${VERTEX_ATTRIBUTES}
${POSE_GLSL}
void main() {
  vec3 wp;
  vec3 wn;
  poseVertex(position, normal, wp, wn);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const DEPTH_FRAGMENT = /* glsl */ `
void main() {
  gl_FragColor = vec4(1.0);
}
`;

type Point = readonly [number, number, number];

/** Turns a piece about its own middle (the axes in turn) and puts it at a point. */
function put(geometry: BufferGeometry, at: Point, spin: Point = [0, 0, 0]): BufferGeometry {
  geometry.rotateX(spin[0]);
  geometry.rotateY(spin[1]);
  geometry.rotateZ(spin[2]);
  return geometry.translate(at[0], at[1], at[2]);
}

function box(w: number, h: number, d: number, at: Point, spin?: Point): BufferGeometry {
  return put(new BoxGeometry(w, h, d).toNonIndexed(), at, spin);
}

/** A cylinder standing along y: lay it down by spinning it a quarter turn about z or x. */
function drum(radius: number, length: number, at: Point, spin?: Point, sides = 10): BufferGeometry {
  return put(new CylinderGeometry(radius, radius, length, sides).toNonIndexed(), at, spin);
}

/**
 * A thin slab buckled by a few waves and curled up at the ends, with smooth normals: a hull plate
 * that took the fall. The waves depend on where a point is and not on which face it is on, so
 * the slab stays whole.
 */
function plate(
  w: number,
  d: number,
  thick: number,
  at: Point,
  spin: Point,
  buckle: number,
  curl: number,
  seed: number,
): BufferGeometry {
  const slab = new BoxGeometry(w, thick, d, 6, 1, 4);
  const position = slab.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const waves =
      Math.sin(x * 4.3 + seed) * Math.cos(z * 3.7 + seed * 1.7) +
      0.5 * Math.sin(x * 9.1 - z * 6.3 + seed * 2.3);
    const ends = (x / (w / 2)) ** 2;
    position.setY(i, position.getY(i) + waves * buckle * 0.5 + ends * curl);
  }
  slab.computeVertexNormals();
  return put(slab.toNonIndexed(), at, spin);
}

/** Marks every vertex of a piece with how it looks, when it goes and where its middle is. */
function piece(
  geometry: BufferGeometry,
  look: number,
  goes: number,
  dressing: number,
  phase: number,
): BufferGeometry {
  geometry.computeBoundingBox();
  const middle = new Vector3();
  geometry.boundingBox?.getCenter(middle);
  const count = geometry.getAttribute('position').count;
  const part = new Float32Array(count * 4);
  const center = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    part.set([look, goes, dressing, phase], i * 4);
    center.set([middle.x, middle.y, middle.z], i * 3);
  }
  geometry.setAttribute('aPart', new BufferAttribute(part, 4));
  geometry.setAttribute('aCenter', new BufferAttribute(center, 3));
  geometry.deleteAttribute('uv');
  return geometry;
}

/**
 * A heap in its own space: the ground under its middle is the origin. About 2.9 across and 1.7 tall,
 * with a mast to 4.4 blocks, so the cursor's ball (`DEBRIS.radius` round a point `DEBRIS.lift` up)
 * takes in the whole of the heap and the mast is the part that shows from afar. The sizes written
 * below are before `MODEL_SCALE`.
 */
function buildHeap(): BufferGeometry {
  const rng = createRng(0x5c4a9);
  const parts: BufferGeometry[] = [];
  const add = (
    geometry: BufferGeometry,
    look: number,
    goes: number = GOES.stays,
    dressing = 0,
  ): void => {
    geometry.scale(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
    parts.push(piece(geometry, look, goes, dressing, rng() * 8));
  };

  // What is left of the station's hull: a slab half sunk in the ground, another leaning on it, and a
  // rib of the frame standing out of the heap in an arc.
  add(plate(1.9, 1.3, 0.1, [0.05, 0.14, 0], [0.14, 0.4, -0.2], 0.14, 0.1, 1.3), LOOK.patchwork);
  add(
    plate(1.1, 0.8, 0.08, [-0.45, 0.55, 0.4], [-0.95, 0.25, 0.12], 0.1, 0.07, 2.9),
    LOOK.painted,
    GOES.low,
  );
  for (let s = 0; s < 6; s++) {
    const from = (15 + s * 25) * DEG;
    const middle = from + 12.5 * DEG;
    const radius = 0.85;
    const length = 2 * radius * Math.sin(12.5 * DEG) + 0.04;
    add(
      box(
        length,
        0.09,
        0.07,
        [0.2 + Math.cos(middle) * radius, 0.02 + Math.sin(middle) * radius, -0.38],
        [0, 0, middle + Math.PI / 2],
      ),
      LOOK.steel,
      GOES.last,
    );
  }

  // The mast, with a cross arm and the lamp.
  add(box(0.075, 2.7, 0.075, [-0.55, 1.5, -0.3], [0, 0, 0.05]), LOOK.steel, GOES.last);
  add(box(0.55, 0.06, 0.06, [-0.5, 2.3, -0.3], [0, 0, 0.05]), LOOK.steel, GOES.last);
  add(box(0.16, 0.16, 0.16, [-0.43, 2.88, -0.3], [0.2, 0.5, 0.2]), LOOK.lamp, GOES.last);
  add(box(0.26, 0.04, 0.26, [-0.43, 3.0, -0.3], [0.1, 0.5, 0.1]), LOOK.steel, GOES.last);

  // A bent beam (a web between two flanges) sticking out of the pile.
  const beam: Point = [0.5, 0.7, 0.22];
  const lean: Point = [0.2, 0.7, 0.55];
  add(
    put(new BoxGeometry(1.5, 0.03, 0.2).toNonIndexed().translate(0, 0.0, 0), beam, lean),
    LOOK.steel,
    GOES.low,
  );
  add(
    put(new BoxGeometry(1.5, 0.2, 0.03).toNonIndexed().translate(0, 0.1, 0), beam, lean),
    LOOK.steel,
    GOES.low,
  );
  add(
    put(new BoxGeometry(1.5, 0.03, 0.2).toNonIndexed().translate(0, 0.2, 0), beam, lean),
    LOOK.steel,
    GOES.low,
  );

  // Scorched rubble round the foot.
  for (let n = 0; n < 9; n++) {
    const angle = (n / 9) * TWO_PI + rng() * 0.5;
    const radius = 0.75 + rng() * 0.45;
    const size = 0.14 + rng() * 0.16;
    add(
      box(
        size,
        size * (0.6 + rng() * 0.5),
        size * (0.8 + rng() * 0.6),
        [Math.cos(angle) * radius, size * 0.3, Math.sin(angle) * radius],
        [rng() * 1.5, rng() * 3, rng() * 1.5],
      ),
      n % 3 === 0 ? LOOK.patchwork : LOOK.scorch,
    );
  }

  // Dressing 1: crates, one on another, banded in hazard stripes, and a beacon on top.
  const crate: Point = [0.32, 0.5, -0.06];
  const turned: Point = [0, 0.45, 0.08];
  add(box(0.52, 0.42, 0.52, crate, turned), LOOK.painted, GOES.middle, 1);
  add(box(0.54, 0.1, 0.54, crate, turned), LOOK.hazard, GOES.middle, 1);
  add(box(0.34, 0.3, 0.34, [0.27, 0.86, -0.02], [0.1, 0.9, 0.05]), LOOK.patchwork, GOES.top, 1);
  add(box(0.14, 0.06, 0.14, [0.27, 1.04, -0.02], [0.1, 0.9, 0.05]), LOOK.beacon, GOES.top, 1);

  // Dressing 2: a barrel on end, another on its side, and a pipe laid across the top.
  add(drum(0.21, 0.62, [0.34, 0.52, -0.1], [0.05, 0, 0.1]), LOOK.painted, GOES.middle, 2);
  add(drum(0.225, 0.08, [0.34, 0.6, -0.1], [0.05, 0, 0.1]), LOOK.hazard, GOES.middle, 2);
  add(
    drum(0.2, 0.58, [-0.05, 0.3, 0.62], [0, 0.4, Math.PI / 2 - 0.1]),
    LOOK.patchwork,
    GOES.middle,
    2,
  );
  add(drum(0.06, 1.5, [0.05, 0.98, 0.04], [0, 0.8, 1.35], 8), LOOK.steel, GOES.top, 2);
  add(drum(0.1, 0.06, [0.62, 1.07, -0.28], [0, 0.8, 1.35], 8), LOOK.hazard, GOES.top, 2);

  // Dressing 3: a broken console with its screen still lit, and a beacon on the pile.
  const cabinet: Point = [0.3, 0.58, -0.04];
  const tipped: Point = [-0.15, 0.55, 0.12];
  add(
    put(new BoxGeometry(0.56, 0.72, 0.36).toNonIndexed(), cabinet, tipped),
    LOOK.painted,
    GOES.middle,
    3,
  );
  add(
    put(new BoxGeometry(0.58, 0.08, 0.38).toNonIndexed().translate(0, -0.3, 0), cabinet, tipped),
    LOOK.hazard,
    GOES.middle,
    3,
  );
  add(
    put(
      new BoxGeometry(0.44, 0.28, 0.03).toNonIndexed().translate(0, 0.14, 0.185),
      cabinet,
      tipped,
    ),
    LOOK.screen,
    GOES.middle,
    3,
  );
  add(box(0.4, 0.06, 0.3, [0.12, 0.92, 0.1], [0.3, 0.2, 0.4]), LOOK.patchwork, GOES.top, 3);
  add(box(0.14, 0.06, 0.14, [0.15, 0.97, 0.1], [0.3, 0.2, 0.4]), LOOK.beacon, GOES.top, 3);

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('The heap could not be put together');
  return merged;
}

/** One heap as the picture has it, for the tests and the debug hook. */
export interface DebrisShown {
  /** The heap's place in the run's list. */
  index: number;
  x: number;
  y: number;
  z: number;
  /** Strips it has left, as the view says. */
  left: number;
  /** The share of its strips left as the picture shows it, easing toward the real share. */
  share: number;
  /** 0 buried and 1 standing, in between while it rises or sinks. */
  presence: number;
  /** 1 as a strip lands, dying away. */
  flash: number;
  /** 1 while the cursor is on it. */
  aimed: number;
}

export interface DebrisRenderer {
  readonly object: Group;
  /** How many triangles one heap has. */
  readonly trianglesPerHeap: number;
  /**
   * Lets `dt` seconds pass and draws the heaps the view holds. `run` says which run this is: a new
   * run's heaps are simply there, where a heap uncovered at a dawn rises out of the ground.
   */
  update(dt: number, debris: Pick<DebrisView, 'nodes' | 'leftOf' | 'version'>, run: number): void;
  /** The heap the cursor is on, by its place in the list, or -1: it glows. */
  setAimed(index: number): void;
  /** The heaps on screen now (those not buried), for tests and the debug hook. */
  list(): DebrisShown[];
  dispose(): void;
}

export interface DebrisRendererOptions {
  /** The stage's material registry: the heaps are lit by the same sun, shadows and haze as the world. */
  registry: MaterialRegistry;
  /** The most heaps drawn at once; the network never lists more than `NET.maxDebris`. */
  capacity?: number;
}

/** What the picture keeps for one heap. */
interface Track {
  /** Which heap this is: a list that puts a different heap at the same name starts the track over. */
  x: number;
  z: number;
  harvests: number;
  left: number;
  share: number;
  presence: number;
  flash: number;
  aimed: number;
}

export function createDebrisRenderer({
  registry,
  capacity = NET.maxDebris,
}: DebrisRendererOptions): DebrisRenderer {
  const model = buildHeap();
  const geometry = new InstancedBufferGeometry();
  for (const name of ['position', 'normal', 'aPart', 'aCenter']) {
    const attribute = model.getAttribute(name);
    if (attribute) geometry.setAttribute(name, attribute);
  }
  const positions = new Float32Array(capacity * 3);
  const datas = new Float32Array(capacity * 4);
  const states = new Float32Array(capacity * 4);
  const pos = new InstancedBufferAttribute(positions, 3);
  const data = new InstancedBufferAttribute(datas, 4);
  const state = new InstancedBufferAttribute(states, 4);
  for (const attribute of [pos, data, state]) attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute('iPos', pos);
  geometry.setAttribute('iData', data);
  geometry.setAttribute('iState', state);
  geometry.instanceCount = 0;

  const glow = (hex: string, strength: number): Color => new Color(hex).multiplyScalar(strength);
  const material = registry.create({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uRust: { value: new Color('#80492a') },
      uRustDark: { value: new Color('#4a281a') },
      uPaint: { value: new Color('#2c6e69') },
      uPaintDark: { value: new Color('#1b4745') },
      uPrimer: { value: new Color('#6b7074') },
      uSteel: { value: new Color('#3b4550') },
      uSteelWorn: { value: new Color('#79858f') },
      uScorch: { value: new Color('#2a2724') },
      uEmber: { value: glow('#ff7a2a', 2.2) },
      uHazard: { value: new Color('#d9972d') },
      uBlack: { value: new Color('#17181a') },
      uLampGlow: { value: glow('#f2a43a', 2.6) },
      uBeaconGlow: { value: glow('#3ad1e0', 2.8) },
      uGlass: { value: new Color('#071a1f') },
      uScreenGlow: { value: glow('#3ad1e0', 1.1) },
    },
  });
  const depth = new ShaderMaterial({ vertexShader: DEPTH_VERTEX, fragmentShader: DEPTH_FRAGMENT });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'debris';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = depth;
  mesh.visible = false;
  const object = new Group();
  object.name = 'debris-field';
  object.add(mesh);

  const tracks = new Map<number, Track>();
  /** The heaps written into the buffers this frame, in order. */
  const indexes = new Int32Array(capacity);
  let shown = 0;
  let aimedIndex = -1;
  let lastAimed = -1;
  let lastRun = Number.NaN;
  let lastVersion = Number.NaN;
  let moving = true;

  const follow = (from: number, to: number, rate: number, dt: number): number => {
    const next = from + (to - from) * (1 - Math.exp(-rate * dt));
    return Math.abs(next - to) < ARRIVED ? to : next;
  };
  const approach = (from: number, to: number, seconds: number, dt: number): number =>
    from < to ? Math.min(to, from + dt / seconds) : Math.max(to, from - dt / seconds);

  return {
    object,
    trianglesPerHeap: model.getAttribute('position').count / 3,

    update(dt, debris, run) {
      const step = Math.min(Math.max(dt, 0), MAX_STEP);
      // Nothing changed and nothing is moving: the buffers are as they should be.
      if (
        !moving &&
        debris.version === lastVersion &&
        run === lastRun &&
        aimedIndex === lastAimed
      ) {
        return;
      }
      if (run !== lastRun) tracks.clear();
      lastRun = run;
      lastVersion = debris.version;
      lastAimed = aimedIndex;

      const nodes = debris.nodes;
      for (const index of tracks.keys()) if (index >= nodes.length) tracks.delete(index);

      moving = false;
      let written = 0;
      for (let i = 0; i < nodes.length && written < capacity; i++) {
        const node = nodes[i];
        if (!node) continue;
        const left = debris.leftOf(node.index);
        const share = node.harvests > 0 ? left / node.harvests : 0;
        let track = tracks.get(node.index);
        if (
          track &&
          (track.x !== node.x || track.z !== node.z || track.harvests !== node.harvests)
        ) {
          track = undefined;
        }
        if (!track) {
          // The first sight of a heap: it is simply there (or not), it does not come up out of the ground.
          track = {
            x: node.x,
            z: node.z,
            harvests: node.harvests,
            left,
            share,
            presence: left > 0 ? 1 : 0,
            flash: 0,
            aimed: 0,
          };
          tracks.set(node.index, track);
        } else {
          track.flash = Math.max(0, track.flash - step / FLASH_FADE);
          if (left < track.left) track.flash = 1;
          track.left = left;
          track.share = follow(track.share, share, STRIP_FOLLOW, step);
          track.presence =
            left > 0
              ? approach(track.presence, 1, RISE_SECONDS, step)
              : approach(track.presence, 0, SINK_SECONDS, step);
        }
        track.aimed = follow(
          track.aimed,
          node.index === aimedIndex && left > 0 ? 1 : 0,
          AIM_FOLLOW,
          step,
        );

        if (
          track.share !== share ||
          track.presence !== (left > 0 ? 1 : 0) ||
          track.flash > 0 ||
          track.aimed !== (node.index === aimedIndex && left > 0 ? 1 : 0)
        ) {
          moving = true;
        }
        // A heap that is not there (buried, or not uncovered yet) is not drawn.
        if (track.presence <= 0 && left <= 0) continue;

        positions[written * 3] = node.x;
        positions[written * 3 + 1] = node.y;
        positions[written * 3 + 2] = node.z;
        datas[written * 4] = node.yaw;
        datas[written * 4 + 1] = node.scale;
        datas[written * 4 + 2] = track.share;
        datas[written * 4 + 3] = track.presence;
        states[written * 4] = track.flash;
        states[written * 4 + 1] = track.aimed;
        states[written * 4 + 2] = 1 + (node.index % VARIANTS);
        states[written * 4 + 3] = (node.index * 0.618034) % 1;
        indexes[written] = node.index;
        written++;
      }

      shown = written;
      geometry.instanceCount = written;
      mesh.visible = written > 0;
      pos.needsUpdate = true;
      data.needsUpdate = true;
      state.needsUpdate = true;
    },

    setAimed(index) {
      aimedIndex = index;
    },

    list() {
      const out: DebrisShown[] = [];
      for (let i = 0; i < shown; i++) {
        const index = indexes[i] as number;
        const track = tracks.get(index);
        if (!track) continue;
        out.push({
          index,
          x: positions[i * 3] as number,
          y: positions[i * 3 + 1] as number,
          z: positions[i * 3 + 2] as number,
          left: track.left,
          share: track.share,
          presence: track.presence,
          flash: track.flash,
          aimed: track.aimed,
        });
      }
      return out;
    },

    dispose() {
      object.removeFromParent();
      object.clear();
      geometry.dispose();
      model.dispose();
      registry.release(material);
      depth.dispose();
      tracks.clear();
      shown = 0;
    },
  };
}
