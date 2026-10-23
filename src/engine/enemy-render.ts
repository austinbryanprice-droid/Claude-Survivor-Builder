import {
  BoxGeometry,
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
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
 * The machines that come for the Core, drawn as one instanced mesh: a crawler is a low, six-legged
 * walker of dark steel with amber joints and a red eye, built from boxes in code (no assets), and
 * the whole crowd costs one draw call and one more for its shadows. The legs, the jaws, the lunge
 * of a bite and the rise out of the ground on arrival are all done in the vertex shader from a few
 * numbers per machine, so a hundred of them cost the CPU a handful of array writes a frame.
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
/** A hit lights the machine white-hot for as long as the flag is up, then the light dies away in this long. */
const FLASH_FADE = 0.25;
/** A machine arrives by rising out of the ground over this long. */
const RISE_SECONDS = 0.6;
/** A frame longer than this (a hidden tab, a breakpoint) is not time passing for the machines. */
const MAX_STEP = 0.1;
/** Machines differ in size by up to this much either way, from their id, so a crowd is not a stamp. */
const SIZE_SPREAD = 0.05;

/** Surface looks. They index the colors in the fragment shader. */
const LOOK = { shell: 0, plate: 1, amber: 2, eye: 3, blade: 4 } as const;
/** How a vertex moves. */
const KIND = { body: 0, leg: 1, lowerLeg: 2, jaw: 3 } as const;

const ANIMATION_GLSL = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iData;   // yaw, size, gait phase, gait amount (0 standing, 1 at full swing)
attribute vec4 iState;  // health, flash, attack, rise
attribute vec4 aPart;   // look, how it moves, tripod group, side (-1 left, 1 right)
attribute vec3 aHip;    // where a leg or a jaw turns, in the model's own space

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
  } else if (how > 2.5) {
    // The jaws hang a little open and gape for a bite.
    float open = 0.08 + 0.55 * attack;
    p = aHip + rotY(p - aHip, side * open);
    n = rotY(n, side * open);
  }

  p.y += 0.02 * gait * abs(sin(iData.z));
  p.z += 0.22 * attack;
  p.y -= 0.05 * attack;
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

varying vec3 vWorld;
varying vec3 vNormal;
varying float vViewDepth;
varying float vLook;
varying float vHealth;
varying float vFlash;
varying float vPhase;

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
    glow = uAmberGlow;
    finish = vec2(0.5, 0.3);
  } else if (look < 3.5) {
    base = uEye;
    glow = uEyeGlow;
    finish = vec2(0.8, 0.1);
  } else {
    base = uBlade;
    finish = vec2(0.7, 0.7);
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

  // Six legs, each a hip, an upper bar rising to the knee, a lower bar down to the foot.
  for (let row = 0; row < 3; row++) {
    const z = 0.3 - row * 0.3;
    const reach = (1 - row) * 0.3;
    for (const side of [-1, 1]) {
      const hip: Point = [side * 0.3, 0.42, z];
      const knee: Point = [side * 0.64, 0.68, z];
      const foot: Point = [side * 0.86, 0.03, z];
      // The legs on one side step together with the opposite side's neighbours: front-left, middle-right and back-left.
      const group = (row + (side > 0 ? 1 : 0)) % 2;
      const leg = (geometry: BufferGeometry, look: number, how: number): BufferGeometry =>
        piece(splay(geometry, hip, -side * reach), look, how, group, side, hip);
      parts.push(leg(block(0.12, 0.12, 0.12, hip), LOOK.amber, KIND.leg));
      parts.push(leg(bar(hip, knee, 0.075), LOOK.plate, KIND.leg));
      parts.push(leg(block(0.1, 0.1, 0.1, knee), LOOK.amber, KIND.leg));
      parts.push(leg(bar(knee, foot, 0.06), LOOK.shell, KIND.lowerLeg));
      parts.push(leg(block(0.1, 0.04, 0.12, [foot[0], 0.02, foot[2]]), LOOK.blade, KIND.lowerLeg));
    }
  }

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('The crawler could not be put together');
  return merged;
}

export interface EnemyRenderer {
  readonly object: Group;
  /** How many triangles one machine has. */
  readonly trianglesPerMachine: number;
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

export function createEnemyRenderer({
  registry,
  capacity = NET.maxEnemies,
}: EnemyRendererOptions): EnemyRenderer {
  const model = buildCrawler();
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

  const material = registry.create({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uShell: { value: new Color('#262d35') },
      uPlate: { value: new Color('#414b57') },
      uAmber: { value: new Color('#8a5518') },
      uAmberGlow: { value: new Color('#f2a43a').multiplyScalar(0.7) },
      uEye: { value: new Color('#1c0805') },
      uEyeGlow: { value: new Color('#ff4a26').multiplyScalar(2.6) },
      uBlade: { value: new Color('#9aa4af') },
    },
  });
  const depth = new ShaderMaterial({ vertexShader: DEPTH_VERTEX, fragmentShader: DEPTH_FRAGMENT });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'crawlers';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = depth;
  mesh.visible = false;
  const object = new Group();
  object.name = 'enemies';
  object.add(mesh);

  const tracks = new Map<number, Track>();
  const ids = new Int32Array(capacity);
  const kinds = new Uint8Array(capacity);
  let shown = 0;

  const follow = (from: number, to: number, rate: number, dt: number): number =>
    from + (to - from) * (1 - Math.exp(-rate * dt));

  return {
    object,
    trianglesPerMachine: model.getAttribute('position').count / 3,

    update(dt, poses) {
      const step = Math.min(Math.max(dt, 0), MAX_STEP);
      const n = Math.min(poses.length, capacity);
      for (const track of tracks.values()) track.seen = false;
      for (let i = 0; i < n; i++) {
        const pose = poses[i] as EnemyPose;
        let track = tracks.get(pose.id);
        if (!track) {
          // Each machine starts its stride at its own point, so a crowd does not step in time.
          const start = ((pose.id * 0.754877) % 1) * Math.PI * 2;
          track = { phase: start, gait: 0, attack: 0, flash: 0, rise: 0, seen: true };
          tracks.set(pose.id, track);
        }
        track.seen = true;
        track.phase = (track.phase + pose.speed * step * STRIDE) % (Math.PI * 200);
        track.gait = follow(
          track.gait,
          Math.min(1, pose.speed / FULL_GAIT_SPEED),
          GAIT_FOLLOW,
          step,
        );
        track.attack = follow(
          track.attack,
          pose.flags & ENEMY_FLAG.attack ? 1 : 0,
          ATTACK_FOLLOW,
          step,
        );
        track.flash =
          pose.flags & ENEMY_FLAG.hurt ? 1 : Math.max(0, track.flash - step / FLASH_FADE);
        track.rise = Math.min(1, track.rise + step / RISE_SECONDS);

        const size = 1 - SIZE_SPREAD + ((pose.id * 0.618034) % 1) * SIZE_SPREAD * 2;
        positions[i * 3] = pose.x;
        positions[i * 3 + 1] = pose.y;
        positions[i * 3 + 2] = pose.z;
        looks[i * 4] = pose.yaw;
        looks[i * 4 + 1] = size;
        looks[i * 4 + 2] = track.phase;
        looks[i * 4 + 3] = track.gait;
        states[i * 4] = pose.health;
        states[i * 4 + 1] = track.flash;
        states[i * 4 + 2] = track.attack;
        states[i * 4 + 3] = track.rise;
        ids[i] = pose.id;
        kinds[i] = pose.kind;
      }
      for (const [id, track] of tracks) if (!track.seen) tracks.delete(id);

      shown = n;
      geometry.instanceCount = n;
      mesh.visible = n > 0;
      if (n > 0) {
        pos.needsUpdate = true;
        data.needsUpdate = true;
        state.needsUpdate = true;
      }
    },

    list() {
      const out: ReturnType<EnemyRenderer['list']> = [];
      for (let i = 0; i < shown; i++) {
        out.push({
          id: ids[i] as number,
          kind: kinds[i] as number,
          x: positions[i * 3] as number,
          y: positions[i * 3 + 1] as number,
          z: positions[i * 3 + 2] as number,
          health: states[i * 4] as number,
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
