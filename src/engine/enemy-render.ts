import {
  BoxGeometry,
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector4,
  type BufferGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ENEMY_FLAG, type EnemyPose } from '../shared/enemy-state';
import { NET } from '../shared/net-config';
import { ATMOSPHERE_GLSL } from './glsl/atmosphere.glsl';
import { SHADOW_FRAGMENT_PARS, SHADOW_VERTEX_PARS } from './glsl/lighting.glsl';
import type { MaterialRegistry } from './materials';

/**
 * The machines that come for the Core, each kind drawn as one instanced mesh: a crawler is a low,
 * six-legged walker of dark steel with amber joints and a red eye, built from boxes in code (no
 * assets), the armored crawler is a heavier, plated one, the skimmer is a flat-hulled drone on four
 * spinning rotors that hovers, the breacher is a squat ram on four stout legs with a cell on its back
 * that swells and burns as it charges, and all the machines of a kind cost one draw call and one more
 * for their shadows. The legs, the jaws, the rotors, the lunge of a bite, the shudder of a charge and
 * the rise on arrival are all done in the vertex shader from a few numbers per machine, so a hundred of
 * them cost the CPU a handful of array writes a frame.
 *
 * The poses come from the network layer already smoothed (`EnemyMirror`); this only dresses them.
 * What it keeps per machine is what the picture needs and the host does not say: how far the legs
 * have walked, and the ease of the flash, the lunge and the rise.
 */

/** Radians of gait per block walked: a foot is down for about a block of the walk. */
const STRIDE = 5;
/** Blocks a second at which the legs are at their full swing; slower walks swing less. */
const FULL_GAIT_SPEED = 1.6;
const GAIT_FOLLOW = 10;
const ATTACK_FOLLOW = 14;
/**
 * Seconds a breacher charges before it goes off (`ENEMIES.breacher.blast.windup`, which a test holds
 * this to): its charge shows as a flag from the host, and the picture builds it up over this long.
 */
export const BREACHER_CHARGE_SECONDS = 1.2;
/** A hit lights the machine white-hot for as long as the flag is up, then the light dies away in this long. */
const FLASH_FADE = 0.25;
/** A machine arrives by rising out of the ground over this long. */
const RISE_SECONDS = 0.6;
/** A frame longer than this (a hidden tab, a breakpoint) is not time passing for the machines. */
const MAX_STEP = 0.1;
/** Machines differ in size by up to this much either way, from their id, so a crowd is not a stamp. */
const SIZE_SPREAD = 0.05;

/** Surface looks. They index the colors in the fragment shader. */
const LOOK = { shell: 0, plate: 1, amber: 2, eye: 3, blade: 4, emitter: 5 } as const;
/** How a vertex moves. */
const KIND = { body: 0, leg: 1, lowerLeg: 2, jaw: 3, rotor: 4, beam: 5, cell: 6 } as const;

const ANIMATION_GLSL = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iData;   // yaw, size, gait phase, gait amount (0 standing, 1 at full swing)
attribute vec4 iState;  // health, flash, attack, rise
attribute vec4 aPart;   // look, how it moves, tripod group, side (-1 left, 1 right)
attribute vec3 aHip;    // where a leg, a jaw or a rotor turns, in the model's own space

// What sets a kind's carriage apart. x: how far its body leans into a flight, y: how far it bobs,
// z: how far it lunges for a bite, w: how far its nose dips for one. A walker has only the lunge.
uniform vec4 uMotion;
// What a machine that charges does as it does, at full charge. x: how far its whole body shudders,
// y: how far the cell on its back swells (and how much its amber lights burn up), z: how far it
// crouches. The kinds that do not charge have none of it.
uniform vec4 uCharge;

vec3 rotX(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
}

vec3 rotY(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

vec3 rotZ(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z);
}

// Puts a vertex of the model where this machine's legs, jaws and body have it, in the world.
void poseVertex(vec3 p, vec3 n, out vec3 wp, out vec3 wn) {
  float how = aPart.y;
  float side = aPart.w;
  float gait = iData.w;
  float attack = iState.z;
  float rise = iState.w;

  if (how > 0.5 && how < 2.5) {
    // A tripod gait: three feet are in the air while the other three push the body on. A foot that
    // is lifting is also moving forward, and one that is down slides back under the body.
    float phase = iData.z + aPart.z * 3.14159265;
    float swing = sin(phase) * 0.36 * gait;
    float lift = max(0.0, cos(phase)) * 0.5 * gait;
    vec3 q = rotZ(p - aHip, side * lift);
    vec3 m = rotZ(n, side * lift);
    q = rotY(q, -side * swing);
    m = rotY(m, -side * swing);
    p = aHip + q;
    n = m;
  } else if (how > 2.5 && how < 3.5) {
    // The jaws hang a little open and gape for a bite.
    float open = 0.08 + 0.55 * attack;
    p = aHip + rotY(p - aHip, side * open);
    n = rotY(n, side * open);
  } else if (how > 3.5 && how < 4.5) {
    // A rotor turns about its hub, the pairs along a diagonal the opposite ways.
    float turn = (iData.z + aPart.z * 0.785398) * side;
    p = aHip + rotY(p - aHip, turn);
    n = rotY(n, turn);
  } else if (how > 4.5 && how < 5.5) {
    // The beam under a skimmer grows out of its emitter as a zap charges, and is gone between zaps.
    p.y = aHip.y + (p.y - aHip.y) * attack;
  } else if (how > 5.5) {
    // The cell on a breacher's back swells about its middle as the charge builds.
    p = aHip + (p - aHip) * (1.0 + uCharge.y * attack);
  }

  // A machine that flies leans into its flight, dips its nose to strike and bobs on its lift.
  float pitch = uMotion.x * gait + uMotion.w * attack;
  if (pitch != 0.0) {
    vec3 centre = vec3(0.0, 0.16, 0.0);
    p = centre + rotX(p - centre, pitch);
    n = rotX(n, pitch);
  }
  // A walker's body rocks with its stride; one that flies bobs, with a period that fits the wrap of the phase.
  p.y += 0.02 * gait * abs(sin(iData.z)) * step(uMotion.x, 0.0);
  p.y += uMotion.y * sin(iData.z * 0.09);
  p.z += uMotion.z * attack;
  p.y -= 0.05 * attack;
  // A machine that charges shudders with it, all of it, off the beat of its own phase, and sinks under the strain.
  p += vec3(sin(iData.z), sin(iData.z * 1.37 + 1.0), sin(iData.z * 1.91 + 2.0)) * (uCharge.x * attack);
  p.y -= uCharge.z * attack;
  p *= iData.y * mix(0.6, 1.0, rise);
  p.y -= (1.0 - rise) * 0.4;

  wp = rotY(p, iData.x) + iPos;
  wn = rotY(n, iData.x);
}
`;

const VERTEX = /* glsl */ `
${SHADOW_VERTEX_PARS}
${ANIMATION_GLSL}
varying vec3 vWorld;
varying vec3 vNormal;
varying float vViewDepth;
varying float vLook;
varying float vHealth;
varying float vFlash;
varying float vPhase;
varying float vAttack;

void main() {
  vec3 wp;
  vec3 wn;
  poseVertex(position, normal, wp, wn);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vViewDepth = -mv.z;
  vWorld = wp;
  vNormal = wn;
  vLook = aPart.x;
  vHealth = iState.x;
  vFlash = iState.y;
  vPhase = iData.z;
  vAttack = iState.z;
  writeShadowVaryings(wp, wn, vViewDepth);
}
`;

const FRAGMENT = /* glsl */ `
${SHADOW_FRAGMENT_PARS}
${ATMOSPHERE_GLSL}

uniform vec3 uShell;
uniform vec3 uPlate;
uniform vec3 uAmber;
uniform vec3 uAmberGlow;
uniform vec3 uEye;
uniform vec3 uEyeGlow;
uniform vec3 uBlade;
uniform vec3 uEmitter;
uniform vec3 uEmitterGlow;
uniform float uEmitterRest;
uniform vec4 uCharge;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vViewDepth;
varying float vLook;
varying float vHealth;
varying float vFlash;
varying float vPhase;
varying float vAttack;

// The base color, the light it gives off, and x: gloss, y: metalness of a look.
void surface(float look, out vec3 base, out vec3 glow, out vec2 finish) {
  glow = vec3(0.0);
  if (look < 0.5) {
    base = uShell;
    finish = vec2(0.45, 0.5);
  } else if (look < 1.5) {
    base = uPlate;
    finish = vec2(0.4, 0.6);
  } else if (look < 2.5) {
    base = uAmber;
    // A machine that charges has its amber burn up with it.
    glow = uAmberGlow * (1.0 + 3.0 * vAttack * step(0.001, uCharge.y));
    finish = vec2(0.5, 0.3);
  } else if (look < 3.5) {
    base = uEye;
    glow = uEyeGlow;
    finish = vec2(0.8, 0.1);
  } else if (look < 4.5) {
    base = uBlade;
    finish = vec2(0.7, 0.7);
  } else {
    // The emitter under a skimmer's belly, and the cell on a breacher's back, smoulder and burn as they charge.
    base = uEmitter;
    glow = uEmitterGlow * mix(uEmitterRest, 2.0, vAttack);
    finish = vec2(0.6, 0.2);
  }
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  float shadow = sunShadow(vViewDepth);
  float ndl = dot(N, uKeyDir);
  float diff = clamp((ndl + 0.08) / 1.08, 0.0, 1.0);

  vec3 base;
  vec3 glow;
  vec2 finish;
  surface(vLook, base, glow, finish);
  float gloss = finish.x;
  float metal = finish.y;
  vec3 albedo = base * (1.0 - 0.7 * metal);
  vec3 H = normalize(uKeyDir + V);
  float shine = pow(max(dot(N, H), 0.0), mix(6.0, 120.0, gloss)) * (0.2 + 0.8 * gloss) * step(0.0, ndl);
  vec3 specColor = mix(vec3(0.05), base, metal);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);

  // The lights breathe, and flicker as the machine fails.
  float t = uSkyParams.z;
  float weak = 1.0 - smoothstep(0.0, 0.45, vHealth);
  float flicker = 1.0 - weak * 0.7 * step(0.55, fract(sin(floor(t * 14.0) + vPhase * 7.0) * 437.58));
  glow *= (0.9 + 0.1 * sin(t * 6.0 + vPhase)) * flicker;

  vec3 lit = albedo * (uKeyColor * diff * shadow + ambientLight(N))
           + uKeyColor * specColor * shine * shadow
           + uAmbSky * rim * 0.2 * (0.4 + 0.6 * metal)
           + glow;
  lit += albedo * lampLight(vWorld, N);
  lit = mix(lit, vec3(1.0, 0.82, 0.64) * 1.5, vFlash * 0.75);
  lit = applyAtmosphere(lit, vWorld);
  gl_FragColor = vec4(lit, 1.0);
}
`;

const DEPTH_VERTEX = /* glsl */ `
${ANIMATION_GLSL}
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

/** Marks every vertex of a piece with how it looks and moves, and where it turns. */
function piece(
  geometry: BufferGeometry,
  look: number,
  how: number = KIND.body,
  group = 0,
  side = 0,
  hip: Point = [0, 0, 0],
): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const part = new Float32Array(count * 4);
  const pivot = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    part.set([look, how, group, side], i * 4);
    pivot.set(hip, i * 3);
  }
  geometry.setAttribute('aPart', new BufferAttribute(part, 4));
  geometry.setAttribute('aHip', new BufferAttribute(pivot, 3));
  geometry.deleteAttribute('uv');
  return geometry;
}

/**
 * A box at a point. Every piece is unindexed, because a rounded box is and a merge takes all of its
 * pieces one way or the other.
 */
function block(w: number, h: number, d: number, at: Point, rounding = 0): BufferGeometry {
  const geometry =
    rounding > 0
      ? new RoundedBoxGeometry(w, h, d, 1, rounding)
      : new BoxGeometry(w, h, d).toNonIndexed();
  return geometry.translate(at[0], at[1], at[2]);
}

/** A bar from one point to another in the plane of the leg (x and y), `thickness` square. */
function bar(from: Point, to: Point, thickness: number): BufferGeometry {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return new BoxGeometry(Math.hypot(dx, dy), thickness, thickness)
    .toNonIndexed()
    .rotateZ(Math.atan2(dy, dx))
    .translate((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, from[2]);
}

/** Turns a leg about its hip, so the front legs reach forward and the back ones trail. */
function splay(geometry: BufferGeometry, hip: Point, angle: number): BufferGeometry {
  return geometry
    .translate(-hip[0], -hip[1], -hip[2])
    .rotateY(angle)
    .translate(...hip);
}

/** How the legs of a walker are put together, in the model's own space. */
interface LegSpec {
  /** Where each row of legs stands along the body, front to back: three rows for six legs, two for four. */
  readonly rows: readonly number[];
  readonly hip: Point;
  readonly knee: Point;
  readonly foot: Point;
  /** What the blocks at the hip and the knee are made of: amber lights on the walkers, plate on the ram. */
  readonly joint: number;
  /** How thick the hip block, the upper bar, the knee block and the lower bar are. */
  readonly hipBlock: number;
  readonly upper: number;
  readonly kneeBlock: number;
  readonly lower: number;
  /** The pad of the foot: width, height and depth. */
  readonly pad: Point;
}

/** A leg on each side of every row, each a hip, an upper bar rising to the knee, a lower bar down to the foot. */
function addLegs(parts: BufferGeometry[], spec: LegSpec): void {
  for (let row = 0; row < spec.rows.length; row++) {
    const z = spec.rows[row] as number;
    // The front legs reach forward and the back ones trail: 0.3 either way, whatever the number of rows.
    const reach = spec.rows.length > 1 ? (0.5 - row / (spec.rows.length - 1)) * 0.6 : 0;
    for (const side of [-1, 1]) {
      const hip: Point = [side * spec.hip[0], spec.hip[1], z];
      const knee: Point = [side * spec.knee[0], spec.knee[1], z];
      const foot: Point = [side * spec.foot[0], spec.foot[1], z];
      // The legs on one side step together with the opposite side's neighbours: front-left, middle-right and back-left.
      const group = (row + (side > 0 ? 1 : 0)) % 2;
      const leg = (geometry: BufferGeometry, look: number, how: number): BufferGeometry =>
        piece(splay(geometry, hip, -side * reach), look, how, group, side, hip);
      const h = spec.hipBlock;
      const k = spec.kneeBlock;
      parts.push(leg(block(h, h, h, hip), spec.joint, KIND.leg));
      parts.push(leg(bar(hip, knee, spec.upper), LOOK.plate, KIND.leg));
      parts.push(leg(block(k, k, k, knee), spec.joint, KIND.leg));
      parts.push(leg(bar(knee, foot, spec.lower), LOOK.shell, KIND.lowerLeg));
      parts.push(
        leg(
          block(spec.pad[0], spec.pad[1], spec.pad[2], [foot[0], 0.02, foot[2]]),
          LOOK.blade,
          KIND.lowerLeg,
        ),
      );
    }
  }
}

/** Welds the pieces of a model into one geometry. */
function weld(parts: BufferGeometry[], name: string): BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`The ${name} could not be put together`);
  return merged;
}

/**
 * The crawler in its own space: the ground under its middle is the origin and its face is +Z.
 * About 0.9 long and 0.7 across the hull, 1.7 across with the legs out, and 0.7 tall.
 */
function buildCrawler(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  // Hull, armor over it with a glowing spine, the engine behind and the head in front.
  parts.push(piece(block(0.64, 0.3, 0.9, [0, 0.44, 0], 0.07), LOOK.shell));
  parts.push(piece(block(0.5, 0.09, 0.62, [0, 0.63, -0.02]), LOOK.plate));
  parts.push(piece(block(0.08, 0.03, 0.5, [0, 0.69, -0.02]), LOOK.amber));
  parts.push(piece(block(0.46, 0.26, 0.36, [0, 0.45, -0.56]), LOOK.shell));
  parts.push(piece(block(0.3, 0.07, 0.04, [0, 0.47, -0.745]), LOOK.amber));
  parts.push(piece(block(0.44, 0.24, 0.3, [0, 0.4, 0.56], 0.06), LOOK.shell));
  parts.push(piece(block(0.46, 0.05, 0.2, [0, 0.53, 0.57]), LOOK.plate));
  parts.push(piece(block(0.28, 0.07, 0.04, [0, 0.44, 0.715]), LOOK.eye));
  for (const side of [-1, 1]) {
    parts.push(piece(block(0.05, 0.05, 0.05, [side * 0.2, 0.52, 0.66]), LOOK.amber));
    // The jaws turn about the front of the head.
    const hip: Point = [side * 0.12, 0.28, 0.68];
    parts.push(
      piece(block(0.07, 0.07, 0.28, [side * 0.12, 0.28, 0.82]), LOOK.blade, KIND.jaw, 0, side, hip),
    );
    parts.push(
      piece(block(0.05, 0.05, 0.12, [side * 0.09, 0.28, 0.98]), LOOK.blade, KIND.jaw, 0, side, hip),
    );
  }

  addLegs(parts, {
    rows: [0.3, 0, -0.3],
    hip: [0.3, 0.42, 0],
    knee: [0.64, 0.68, 0],
    foot: [0.86, 0.03, 0],
    joint: LOOK.amber,
    hipBlock: 0.12,
    upper: 0.075,
    kneeBlock: 0.1,
    lower: 0.06,
    pad: [0.1, 0.04, 0.12],
  });

  return weld(parts, 'crawler');
}

/**
 * The armored crawler in the same space: the crawler's build, bulked out. A deeper hull with a
 * second deck of plate over it and amber ribs across the top, plate along the flanks and over the
 * brow, a ram under the head, heavier jaws and thicker legs. About 1.0 long, 0.9 across the hull
 * and 0.9 tall; the picture draws it larger still.
 */
function buildArmored(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  // Hull, two decks of plate over it, flank plates, the engine behind and the head in front.
  parts.push(piece(block(0.78, 0.38, 1, [0, 0.46, 0], 0.08), LOOK.shell));
  parts.push(piece(block(0.72, 0.1, 0.86, [0, 0.72, -0.02], 0.03), LOOK.plate));
  parts.push(piece(block(0.5, 0.09, 0.5, [0, 0.81, -0.06]), LOOK.plate));
  for (const z of [-0.24, -0.06, 0.12]) {
    parts.push(piece(block(0.56, 0.03, 0.05, [0, 0.865, z]), LOOK.amber));
  }
  for (const side of [-1, 1]) {
    parts.push(piece(block(0.07, 0.3, 0.8, [side * 0.42, 0.52, 0]), LOOK.plate));
    parts.push(piece(block(0.05, 0.12, 0.68, [side * 0.42, 0.3, 0]), LOOK.shell));
  }
  parts.push(piece(block(0.56, 0.32, 0.4, [0, 0.46, -0.68], 0.05), LOOK.shell));
  parts.push(piece(block(0.4, 0.08, 0.04, [0, 0.5, -0.89]), LOOK.amber));
  parts.push(piece(block(0.56, 0.3, 0.34, [0, 0.42, 0.62], 0.06), LOOK.shell));
  parts.push(piece(block(0.62, 0.07, 0.28, [0, 0.6, 0.64]), LOOK.plate));
  parts.push(piece(block(0.5, 0.2, 0.08, [0, 0.28, 0.82]), LOOK.plate));
  parts.push(piece(block(0.4, 0.07, 0.04, [0, 0.46, 0.8]), LOOK.eye));
  for (const side of [-1, 1]) {
    parts.push(piece(block(0.07, 0.07, 0.04, [side * 0.24, 0.5, 0.8]), LOOK.eye));
    parts.push(piece(block(0.06, 0.06, 0.06, [side * 0.26, 0.64, 0.74]), LOOK.amber));
    const hip: Point = [side * 0.16, 0.24, 0.8];
    parts.push(
      piece(block(0.1, 0.09, 0.32, [side * 0.16, 0.24, 0.96]), LOOK.blade, KIND.jaw, 0, side, hip),
    );
    parts.push(
      piece(block(0.07, 0.07, 0.16, [side * 0.12, 0.24, 1.14]), LOOK.blade, KIND.jaw, 0, side, hip),
    );
  }

  addLegs(parts, {
    rows: [0.34, 0, -0.34],
    hip: [0.36, 0.44, 0],
    knee: [0.72, 0.72, 0],
    foot: [0.92, 0.03, 0],
    joint: LOOK.amber,
    hipBlock: 0.16,
    upper: 0.11,
    kneeBlock: 0.14,
    lower: 0.085,
    pad: [0.14, 0.05, 0.16],
  });

  return weld(parts, 'armored crawler');
}

/**
 * The skimmer in the same space: the underside of its hull is the origin and its face is +Z. A
 * saucer of dark steel with a deck of plate, a red eye strip across the nose, a fin behind and amber
 * rim lights; an emitter under the belly that smoulders and burns as a zap charges, with a beam that
 * grows out of it; and four rotor pods on arms, each with crossed blades that turn. About 0.65 wide and
 * 1.2 long over the hull, 1.4 across the rotors and 0.4 tall; the picture draws it larger.
 */
function buildSkimmer(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  // Hull, deck of plate with a spine of light, the nose with its eye and the tail with its fin.
  parts.push(piece(block(0.64, 0.2, 0.86, [0, 0.16, 0], 0.07), LOOK.shell));
  parts.push(piece(block(0.5, 0.07, 0.6, [0, 0.31, -0.04], 0.025), LOOK.plate));
  parts.push(piece(block(0.06, 0.025, 0.42, [0, 0.36, -0.04]), LOOK.amber));
  parts.push(piece(block(0.4, 0.14, 0.22, [0, 0.15, 0.48], 0.05), LOOK.shell));
  parts.push(piece(block(0.32, 0.05, 0.03, [0, 0.17, 0.595]), LOOK.eye));
  parts.push(piece(block(0.36, 0.14, 0.2, [0, 0.16, -0.5], 0.04), LOOK.shell));
  parts.push(piece(block(0.05, 0.16, 0.22, [0, 0.33, -0.5]), LOOK.plate));
  for (const side of [-1, 1]) {
    parts.push(piece(block(0.03, 0.04, 0.6, [side * 0.335, 0.16, 0]), LOOK.amber));
  }

  // The emitter, and the beam that grows out of it (a box that hangs from the lens and is shrunk to nothing between zaps).
  const lens: Point = [0, 0.02, 0.06];
  parts.push(piece(block(0.22, 0.06, 0.22, [0, 0.05, 0.06], 0.02), LOOK.plate));
  parts.push(piece(block(0.14, 0.03, 0.14, lens), LOOK.emitter));
  parts.push(
    piece(
      block(0.035, 1.9, 0.035, [lens[0], lens[1] - 0.95, lens[2]]),
      LOOK.emitter,
      KIND.beam,
      0,
      0,
      lens,
    ),
  );

  // Four rotor pods on arms. The rotors on a diagonal turn the same way, and the crosses are set a
  // little apart so that the four do not flash in step.
  for (const side of [-1, 1]) {
    for (const row of [-1, 1]) {
      const z = row * 0.34;
      const hub: Point = [side * 0.5, 0.325, z];
      parts.push(piece(block(0.2, 0.045, 0.06, [side * 0.41, 0.2, z]), LOOK.plate));
      parts.push(piece(block(0.14, 0.09, 0.14, [side * 0.5, 0.25, z], 0.03), LOOK.shell));
      parts.push(piece(block(0.05, 0.05, 0.05, hub), LOOK.amber));
      const group = row > 0 ? 1 : 0;
      const way = side * row;
      parts.push(piece(block(0.46, 0.014, 0.06, hub), LOOK.blade, KIND.rotor, group, way, hub));
      parts.push(piece(block(0.06, 0.014, 0.46, hub), LOOK.blade, KIND.rotor, group, way, hub));
    }
  }

  return weld(parts, 'skimmer');
}

/**
 * The breacher in the same space: a ram on four stout legs, the ground under its middle the origin
 * and its face +Z. A broad low hull with plate down its flanks, a blunt head with a ram plate across
 * its face (wings of plate back along its sides, a grille of amber bars under a red eye strip) and teeth at the
 * foot of it, an engine behind with two stacks, and on its back a cell: an orb in a cage, dull at rest, that
 * swells and burns white as it charges. About 1.0 across the head, 1.6 long and 1.0 tall; the picture draws it larger.
 */
function buildBreacher(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  // Hull, the deck of plate over it, plate down each flank with a strip of light, the engine behind.
  parts.push(piece(block(0.84, 0.34, 0.86, [0, 0.43, -0.04], 0.07), LOOK.shell));
  parts.push(piece(block(0.72, 0.09, 0.7, [0, 0.645, -0.1], 0.03), LOOK.plate));
  for (const side of [-1, 1]) {
    parts.push(piece(block(0.08, 0.34, 0.74, [side * 0.46, 0.43, -0.08]), LOOK.plate));
    parts.push(piece(block(0.03, 0.05, 0.5, [side * 0.515, 0.52, -0.08]), LOOK.amber));
    // Two stacks on the engine, capped with plate.
    parts.push(piece(block(0.1, 0.2, 0.1, [side * 0.2, 0.7, -0.5]), LOOK.shell));
    parts.push(piece(block(0.13, 0.03, 0.13, [side * 0.2, 0.815, -0.5]), LOOK.plate));
  }
  parts.push(piece(block(0.58, 0.28, 0.26, [0, 0.4, -0.6], 0.05), LOOK.shell));
  parts.push(piece(block(0.36, 0.06, 0.03, [0, 0.42, -0.735]), LOOK.amber));

  // The head, the brow over it and the ram plate across its face: a red eye strip over a grille of amber bars, and teeth below.
  parts.push(piece(block(0.72, 0.32, 0.28, [0, 0.42, 0.52], 0.06), LOOK.shell));
  parts.push(piece(block(0.78, 0.07, 0.3, [0, 0.62, 0.5]), LOOK.plate));
  parts.push(piece(block(0.84, 0.4, 0.1, [0, 0.4, 0.71], 0.02), LOOK.plate));
  for (const side of [-1, 1])
    parts.push(piece(block(0.09, 0.36, 0.3, [side * 0.465, 0.4, 0.6]), LOOK.plate));
  parts.push(piece(block(0.58, 0.05, 0.03, [0, 0.54, 0.775]), LOOK.eye));
  for (const x of [-0.27, -0.09, 0.09, 0.27]) {
    parts.push(piece(block(0.08, 0.2, 0.03, [x, 0.32, 0.775]), LOOK.amber));
  }
  for (const x of [-0.3, 0, 0.3]) {
    parts.push(piece(block(0.14, 0.1, 0.18, [x, 0.12, 0.85]), LOOK.blade));
  }

  // The cell on its back: an orb in a cage of four posts on a base of plate, with a frame over them. It swells about its
  // middle as the charge builds, until it strains the cage.
  const cell: Point = [0, 0.87, -0.12];
  parts.push(piece(block(0.42, 0.05, 0.42, [0, 0.715, -0.12]), LOOK.plate));
  for (const x of [-0.18, 0.18]) {
    for (const z of [-0.3, 0.06])
      parts.push(piece(block(0.045, 0.25, 0.045, [x, 0.85, z]), LOOK.shell));
  }
  for (const z of [-0.3, 0.06])
    parts.push(piece(block(0.42, 0.04, 0.05, [0, 0.99, z]), LOOK.plate));
  for (const x of [-0.18, 0.18])
    parts.push(piece(block(0.05, 0.04, 0.31, [x, 0.99, -0.12]), LOOK.plate));
  parts.push(
    piece(new IcosahedronGeometry(0.15, 1).translate(...cell), LOOK.emitter, KIND.cell, 0, 0, cell),
  );

  addLegs(parts, {
    rows: [0.28, -0.28],
    hip: [0.34, 0.36, 0],
    knee: [0.52, 0.5, 0],
    foot: [0.56, 0.03, 0],
    joint: LOOK.plate,
    hipBlock: 0.2,
    upper: 0.13,
    kneeBlock: 0.17,
    lower: 0.12,
    pad: [0.2, 0.05, 0.22],
  });

  return weld(parts, 'breacher');
}

/** The colors of a kind: the shell and plate of the body, the amber of its joints and the eye, and the glow of each. */
interface Palette {
  readonly shell: string;
  readonly plate: string;
  readonly amber: string;
  readonly amberGlow: number;
  readonly eye: string;
  readonly eyeGlow: number;
  readonly blade: string;
  /**
   * The emitter under a skimmer's belly or the cell on a breacher's back, how brightly it glows at full charge
   * (a walker has none), and the share of that it glows at rest.
   */
  readonly emitter: string;
  readonly emitterGlow: number;
  readonly emitterRest: number;
}

/** What sets a kind of machine apart in the picture: its model, how large it is drawn, how it walks and what color it is. */
interface Variant {
  /** The name of its mesh in the scene. */
  readonly name: string;
  readonly build: () => BufferGeometry;
  /** How large it is drawn against its model. */
  readonly scale: number;
  /** Radians of gait per block walked, and the speed at which its legs are at full swing. */
  readonly stride: number;
  readonly fullGait: number;
  /** Radians a second its rotors turn, or 0 for a machine that walks (its stride follows its speed). */
  readonly spin: number;
  /**
   * Radians a second its phase turns at full charge, so that a machine that charges standing still
   * has a beat to shudder to; 0 for the kinds that do not charge.
   */
  readonly rattle: number;
  /**
   * Seconds its charge takes to build to full when the host says it has begun, or 0 for a kind whose
   * strike is a quick motion that follows the flag at once (a bite, a zap).
   */
  readonly chargeSeconds: number;
  /** How its body carries itself, as the shader's `uMotion`: lean into a flight, bob, lunge for a bite, dip of the nose for one. */
  readonly motion: readonly [number, number, number, number];
  /** What a charge does to it at full charge, as the shader's `uCharge`: shudder, swell of its cell, crouch. */
  readonly charge: readonly [number, number, number, number];
  readonly palette: Palette;
}

/** How a walker carries itself: it does not lean, bob or dip, and lunges a fifth of a body for a bite. */
const WALKER_MOTION = [0, 0, 0.22, 0] as const;
/** The kinds that bite or zap quickly have no charge to build. */
const NO_CHARGE = [0, 0, 0, 0] as const;

/** The kinds the picture knows, indexed by `ENEMY_KIND`. A kind it does not know is drawn as the first. */
const VARIANTS: readonly Variant[] = [
  {
    name: 'crawlers',
    build: buildCrawler,
    scale: 1,
    stride: STRIDE,
    fullGait: FULL_GAIT_SPEED,
    spin: 0,
    rattle: 0,
    chargeSeconds: 0,
    motion: WALKER_MOTION,
    charge: NO_CHARGE,
    palette: {
      shell: '#262d35',
      plate: '#414b57',
      amber: '#8a5518',
      amberGlow: 0.7,
      eye: '#1c0805',
      eyeGlow: 2.6,
      blade: '#9aa4af',
      emitter: '#201a14',
      emitterGlow: 0,
      emitterRest: 0.3,
    },
  },
  {
    // Heavier: it strides slower for the ground it covers, and its plate is a warmer, rustier steel so that it reads at dusk.
    name: 'armored',
    build: buildArmored,
    scale: 1.2,
    stride: 4,
    fullGait: 1.3,
    spin: 0,
    rattle: 0,
    chargeSeconds: 0,
    motion: WALKER_MOTION,
    charge: NO_CHARGE,
    palette: {
      shell: '#1f252c',
      plate: '#5b4838',
      amber: '#a3601a',
      amberGlow: 0.9,
      eye: '#1c0805',
      eyeGlow: 3.2,
      blade: '#b3a99a',
      emitter: '#201a14',
      emitterGlow: 0,
      emitterRest: 0.3,
    },
  },
  {
    // It hovers: its rotors turn all the time, it leans into a flight as far as its speed takes it and
    // dips its nose to strike. A cooler, bluer steel than the walkers' so that it reads against the sky.
    name: 'skimmers',
    build: buildSkimmer,
    scale: 1.25,
    stride: 0,
    fullGait: 3.6,
    spin: 34,
    rattle: 0,
    chargeSeconds: 0,
    motion: [0.3, 0.035, 0.1, 0.35],
    charge: NO_CHARGE,
    palette: {
      shell: '#2b3644',
      plate: '#53657a',
      amber: '#b97b22',
      amberGlow: 0.8,
      eye: '#1c0805',
      eyeGlow: 3,
      blade: '#b9c3cf',
      emitter: '#3a2c1c',
      emitterGlow: 2.4,
      emitterRest: 0.3,
    },
  },
  {
    // The ram: it walks slowly on short stout legs, does not lunge, and as it charges shudders, sinks
    // on its legs, swells the cell on its back and burns its amber up. Dark iron with plate of a
    // demolition yellow gone dull, so that it reads as a different trade from the others.
    name: 'breachers',
    build: buildBreacher,
    scale: 1.3,
    stride: 3.2,
    fullGait: 1.4,
    spin: 0,
    rattle: 70,
    chargeSeconds: BREACHER_CHARGE_SECONDS,
    motion: [0, 0, 0, 0],
    charge: [0.03, 0.3, 0.07, 0],
    palette: {
      shell: '#201e1c',
      plate: '#6e5b2e',
      amber: '#c4701a',
      amberGlow: 0.45,
      eye: '#1c0805',
      eyeGlow: 3.2,
      blade: '#a9a398',
      emitter: '#4a1a07',
      emitterGlow: 3.4,
      emitterRest: 0.04,
    },
  },
];

export interface EnemyRenderer {
  readonly object: Group;
  /** How many triangles one crawler has. */
  readonly trianglesPerMachine: number;
  /** How many triangles one machine of a kind has (the crawler's, for a kind the picture does not know). */
  trianglesOf(kind: number): number;
  /** Draws the machines at these poses, the first `NET.maxEnemies` of them. The poses are read, not kept. */
  update(dt: number, poses: readonly EnemyPose[]): void;
  /** The machines on screen now, for tests and the debug hook. */
  list(): { id: number; kind: number; x: number; y: number; z: number; health: number }[];
  dispose(): void;
}

export interface EnemyRendererOptions {
  /** The stage's material registry: the machines are lit by the same sun, shadows and haze as the world. */
  registry: MaterialRegistry;
  /** The most machines drawn at once; the network never reports more than `NET.maxEnemies`. */
  capacity?: number;
}

/** What the picture keeps for one machine. */
interface Track {
  /** How far the legs have walked, in radians of gait. */
  phase: number;
  gait: number;
  attack: number;
  flash: number;
  rise: number;
  seen: boolean;
}

/** One kind's mesh, and the buffers the machines of that kind are written into each frame. */
interface Batch {
  readonly variant: Variant;
  readonly model: BufferGeometry;
  readonly geometry: InstancedBufferGeometry;
  readonly material: ShaderMaterial;
  /** What its shadow is drawn with: the same pose as the body, so the shadow turns and leans with it. */
  readonly depth: ShaderMaterial;
  readonly mesh: Mesh;
  readonly positions: Float32Array;
  readonly looks: Float32Array;
  readonly states: Float32Array;
  readonly pos: InstancedBufferAttribute;
  readonly data: InstancedBufferAttribute;
  readonly state: InstancedBufferAttribute;
  /** How many machines of this kind are drawn this frame. */
  count: number;
}

function createBatch(variant: Variant, registry: MaterialRegistry, capacity: number): Batch {
  const model = variant.build();
  const geometry = new InstancedBufferGeometry();
  for (const name of ['position', 'normal', 'aPart', 'aHip']) {
    const attribute = model.getAttribute(name);
    if (attribute) geometry.setAttribute(name, attribute);
  }
  const positions = new Float32Array(capacity * 3);
  const looks = new Float32Array(capacity * 4);
  const states = new Float32Array(capacity * 4);
  const pos = new InstancedBufferAttribute(positions, 3);
  const data = new InstancedBufferAttribute(looks, 4);
  const state = new InstancedBufferAttribute(states, 4);
  for (const attribute of [pos, data, state]) attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute('iPos', pos);
  geometry.setAttribute('iData', data);
  geometry.setAttribute('iState', state);
  geometry.instanceCount = 0;

  const { palette } = variant;
  // The body and its shadow carry themselves the same way, so they share the numbers.
  const motion = { value: new Vector4(...variant.motion) };
  const charge = { value: new Vector4(...variant.charge) };
  const depth = new ShaderMaterial({
    vertexShader: DEPTH_VERTEX,
    fragmentShader: DEPTH_FRAGMENT,
    uniforms: { uMotion: motion, uCharge: charge },
  });
  const material = registry.create({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uShell: { value: new Color(palette.shell) },
      uPlate: { value: new Color(palette.plate) },
      uAmber: { value: new Color(palette.amber) },
      uAmberGlow: { value: new Color('#f2a43a').multiplyScalar(palette.amberGlow) },
      uEye: { value: new Color(palette.eye) },
      uEyeGlow: { value: new Color('#ff4a26').multiplyScalar(palette.eyeGlow) },
      uBlade: { value: new Color(palette.blade) },
      uEmitter: { value: new Color(palette.emitter) },
      uEmitterGlow: { value: new Color('#ffc27a').multiplyScalar(palette.emitterGlow) },
      uEmitterRest: { value: palette.emitterRest },
      uMotion: motion,
      uCharge: charge,
    },
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = variant.name;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = depth;
  mesh.visible = false;
  return {
    variant,
    model,
    geometry,
    material,
    depth,
    mesh,
    positions,
    looks,
    states,
    pos,
    data,
    state,
    count: 0,
  };
}

export function createEnemyRenderer({
  registry,
  capacity = NET.maxEnemies,
}: EnemyRendererOptions): EnemyRenderer {
  const batches = VARIANTS.map((variant) => createBatch(variant, registry, capacity));
  const crawlers = batches[0] as Batch;
  const object = new Group();
  object.name = 'enemies';
  for (const batch of batches) object.add(batch.mesh);

  const tracks = new Map<number, Track>();
  // What the debug list reads: every machine drawn, in the order of the poses, whatever its kind.
  const ids = new Int32Array(capacity);
  const kinds = new Uint8Array(capacity);
  const seenAt = new Float32Array(capacity * 4);
  let shown = 0;

  const follow = (from: number, to: number, rate: number, dt: number): number =>
    from + (to - from) * (1 - Math.exp(-rate * dt));
  const triangles = (batch: Batch): number => batch.model.getAttribute('position').count / 3;

  return {
    object,
    trianglesPerMachine: triangles(crawlers),

    trianglesOf(kind) {
      return triangles(batches[kind] ?? crawlers);
    },

    update(dt, poses) {
      const step = Math.min(Math.max(dt, 0), MAX_STEP);
      const n = Math.min(poses.length, capacity);
      for (const track of tracks.values()) track.seen = false;
      for (const batch of batches) batch.count = 0;
      for (let i = 0; i < n; i++) {
        const pose = poses[i] as EnemyPose;
        const batch = batches[pose.kind] ?? crawlers;
        const { variant } = batch;
        let track = tracks.get(pose.id);
        if (!track) {
          // Each machine starts its stride at its own point, so a crowd does not step in time.
          const start = ((pose.id * 0.754877) % 1) * Math.PI * 2;
          track = { phase: start, gait: 0, attack: 0, flash: 0, rise: 0, seen: true };
          tracks.set(pose.id, track);
        }
        track.seen = true;
        const attacking = (pose.flags & ENEMY_FLAG.attack) !== 0;
        // A bite or a zap follows the flag at once; a charge builds up over its own time once it begins.
        track.attack =
          variant.chargeSeconds > 0
            ? attacking
              ? Math.min(1, track.attack + step / variant.chargeSeconds)
              : 0
            : follow(track.attack, attacking ? 1 : 0, ATTACK_FOLLOW, step);
        // A walker's legs turn as far as it walks; a skimmer's rotors turn all the time; a machine
        // that charges has a beat of its own to shudder to, which runs faster as the charge builds.
        const turning =
          (variant.spin > 0 ? variant.spin : pose.speed * variant.stride) +
          variant.rattle * track.attack;
        track.phase = (track.phase + turning * step) % (Math.PI * 200);
        track.gait = follow(
          track.gait,
          Math.min(1, pose.speed / variant.fullGait),
          GAIT_FOLLOW,
          step,
        );
        track.flash =
          pose.flags & ENEMY_FLAG.hurt ? 1 : Math.max(0, track.flash - step / FLASH_FADE);
        track.rise = Math.min(1, track.rise + step / RISE_SECONDS);

        const size =
          (1 - SIZE_SPREAD + ((pose.id * 0.618034) % 1) * SIZE_SPREAD * 2) * variant.scale;
        const at = batch.count++;
        batch.positions[at * 3] = pose.x;
        batch.positions[at * 3 + 1] = pose.y;
        batch.positions[at * 3 + 2] = pose.z;
        batch.looks[at * 4] = pose.yaw;
        batch.looks[at * 4 + 1] = size;
        batch.looks[at * 4 + 2] = track.phase;
        batch.looks[at * 4 + 3] = track.gait;
        batch.states[at * 4] = pose.health;
        batch.states[at * 4 + 1] = track.flash;
        batch.states[at * 4 + 2] = track.attack;
        batch.states[at * 4 + 3] = track.rise;
        ids[i] = pose.id;
        kinds[i] = pose.kind;
        seenAt[i * 4] = pose.x;
        seenAt[i * 4 + 1] = pose.y;
        seenAt[i * 4 + 2] = pose.z;
        seenAt[i * 4 + 3] = pose.health;
      }
      for (const [id, track] of tracks) if (!track.seen) tracks.delete(id);

      shown = n;
      for (const batch of batches) {
        batch.geometry.instanceCount = batch.count;
        batch.mesh.visible = batch.count > 0;
        if (batch.count > 0) {
          batch.pos.needsUpdate = true;
          batch.data.needsUpdate = true;
          batch.state.needsUpdate = true;
        }
      }
    },

    list() {
      const out: ReturnType<EnemyRenderer['list']> = [];
      for (let i = 0; i < shown; i++) {
        out.push({
          id: ids[i] as number,
          kind: kinds[i] as number,
          x: seenAt[i * 4] as number,
          y: seenAt[i * 4 + 1] as number,
          z: seenAt[i * 4 + 2] as number,
          health: seenAt[i * 4 + 3] as number,
        });
      }
      return out;
    },

    dispose() {
      object.removeFromParent();
      object.clear();
      for (const batch of batches) {
        batch.geometry.dispose();
        batch.model.dispose();
        registry.release(batch.material);
        batch.depth.dispose();
      }
      tracks.clear();
      shown = 0;
    },
  };
}
