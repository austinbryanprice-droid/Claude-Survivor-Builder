import {
  BoxGeometry,
  BufferAttribute,
  Color,
  LatheGeometry,
  Mesh,
  Vector2,
  type BufferGeometry,
  type ShaderMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ATMOSPHERE_GLSL } from '../glsl/atmosphere.glsl';
import { SHADOW_FRAGMENT_PARS, SHADOW_VERTEX_PARS } from '../glsl/lighting.glsl';
import type { MaterialRegistry } from '../materials';

/**
 * The piece of the station that falls: a reactor module, a fat steel drum with its front stove in
 * and its back torn open, crumpled in code (no model, no texture). Its surface is dark charred
 * steel with ribs; what makes it burn is `heat`, which lights the dome it flew in on, the cracks
 * across it and the torn mouth at its back, and which the film lets die away once it has stopped.
 */

/** The wreck's own length and radius, in meters; the film's camera and effects are sized by them. */
export const HULL_LENGTH = 9.2;
export const HULL_RADIUS = 2.5;

/** The outline of the drum, as [radius, distance along its axis]: the torn rear first, the stove-in nose last. */
const PROFILE: readonly (readonly [number, number])[] = [
  // The hollow of the torn mouth, from its middle out to its lip.
  [0, -3.5],
  [0.7, -3.66],
  [1.3, -4.05],
  [1.55, -4.4],
  [2.1, -4.3],
  [2.5, -3.85],
  [2.58, -3],
  [2.46, -1.7],
  [2.56, -0.2],
  [2.48, 1.2],
  [2.34, 2.5],
  [1.95, 3.5],
  [1.2, 4.2],
  [0.45, 4.55],
  [0, 4.62],
];

/** Where the bands that stiffen the drum stand along it, and how much they stand out, in meters. */
const RIBS: readonly number[] = [-3.1, -1.5, 0.1, 1.7, 3.1];
const RIB_HEIGHT = 0.17;
/** The profile is cut into steps no longer than this, so that a rib has a shape. */
const STEP = 0.1;

/** A cheap smooth noise from sines, which is all a crumpled hull needs. */
function wobble(x: number, y: number, z: number): number {
  return (
    Math.sin(x * 1.7 + Math.sin(y * 2.3) * 1.3) * 0.5 +
    Math.sin(y * 1.9 + Math.sin(z * 2.9) * 1.1) * 0.3 +
    Math.sin(z * 2.2 + Math.sin(x * 3.1) * 0.9) * 0.2
  );
}

/** How far the stiffening bands stand out of the drum at distance `z` along it. */
function ribAt(z: number): number {
  let out = 0;
  for (const rib of RIBS) {
    const away = Math.abs(z - rib);
    out = Math.max(out, RIB_HEIGHT * (1 - smoothstep(0.1, 0.26, away)));
  }
  return out;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The outline cut into short steps, with the bands put on the barrel of the drum. */
function outline(): Vector2[] {
  const points: Vector2[] = [];
  for (let i = 0; i + 1 < PROFILE.length; i++) {
    const [r0, z0] = PROFILE[i] as readonly [number, number];
    const [r1, z1] = PROFILE[i + 1] as readonly [number, number];
    const steps = Math.max(1, Math.ceil(Math.hypot(r1 - r0, z1 - z0) / STEP));
    for (let k = 0; k < steps; k++) {
      const u = k / steps;
      const z = z0 + (z1 - z0) * u;
      const barrel = z > -3.4 && z < 3.4;
      points.push(new Vector2(r0 + (r1 - r0) * u + (barrel ? ribAt(z) : 0), z));
    }
  }
  const [rEnd, zEnd] = PROFILE[PROFILE.length - 1] as readonly [number, number];
  points.push(new Vector2(rEnd, zEnd));
  return points;
}

/** A plate of the shell torn off and left standing: a thin box, `size` long on z, turned about so that it sticks out. */
function plate(
  size: readonly [number, number, number],
  at: readonly [number, number, number],
  turn: readonly [number, number, number],
  heat: number,
): BufferGeometry {
  const box = new BoxGeometry(size[0], size[1], size[2]);
  box.rotateX(turn[0]);
  box.rotateY(turn[1]);
  box.rotateZ(turn[2]);
  box.translate(at[0], at[1], at[2]);
  box.setAttribute(
    'aHeat',
    new BufferAttribute(new Float32Array(box.getAttribute('position').count).fill(heat), 1),
  );
  return box;
}

/** The pieces that make it a machine rather than a boulder: fins down its flanks and the spars of the shell where the back was torn off. */
function fittings(): BufferGeometry[] {
  const pieces: BufferGeometry[] = [];
  // Four fins along the barrel, swept back, one bent over where something struck it.
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + 0.4;
    const out = 2.85;
    const fin = plate([0.12, 1.1, 3.2], [0, 0, 0], [0, 0, i === 1 ? 0.5 : 0], 0.25);
    // Cut the outer edge short and slant it, so that it is a fin and not a slab.
    const corners = fin.getAttribute('position');
    for (let k = 0; k < corners.count; k++) {
      if (corners.getY(k) > 0) corners.setZ(k, corners.getZ(k) * 0.45 - 0.5);
    }
    fin.translate(0, out, 0.3 - (i === 2 ? 0.8 : 0));
    fin.rotateZ(angle);
    pieces.push(fin);
  }
  // Spars sticking out of the torn mouth, bent every way.
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2 + 0.3 * Math.sin(i * 7.1);
    const reach = 1.2 + 1.1 * (0.5 + 0.5 * Math.sin(i * 3.7));
    const spar = plate(
      [0.16, 0.34, reach],
      [0, 0, -reach / 2],
      [0.35 * Math.sin(i * 2.3), 0.4 * Math.cos(i * 5.1), 0],
      0.9,
    );
    spar.translate(0, 2.05, -4.2);
    spar.rotateZ(angle);
    pieces.push(spar);
  }
  return pieces;
}

function buildGeometry(): BufferGeometry {
  const lathe = new LatheGeometry(outline(), 26);
  // A lathe turns about the y axis: put the axis on z, the way the wreck flies.
  lathe.rotateX(Math.PI / 2);
  const position = lathe.getAttribute('position');
  const heat = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    let z = position.getZ(i);
    // Crumple it: dents all over, deeper at the nose, where it hit the air first, and flatter on the underside.
    const nose = Math.max(0, (z - 1.2) / 3.4);
    const dent = wobble(x, y, z) * (0.05 + 0.22 * nose);
    const radial = Math.hypot(x, y) || 1;
    const push = dent - (y < -1.4 ? (y + 1.4) * 0.22 : 0);
    // The nose is stove in on one side.
    z -= 0.75 * Math.exp(-((x - 0.55) ** 2 + (y + 0.35) ** 2) / 1.1) * Math.max(0, (z - 3.2) / 1.4);
    position.setXYZ(i, x + (x / radial) * push, y + (y / radial) * push, z);
    // Hot at the nose and round the torn mouth, cooler along the sides.
    const mouth = Math.max(0, (-z - 3.2) / 1.2);
    heat[i] = Math.min(1, 0.22 + nose * 0.5 + mouth * 0.95);
  }
  lathe.setAttribute('aHeat', new BufferAttribute(heat, 1));
  lathe.deleteAttribute('uv');
  const merged = mergeGeometries([lathe, ...fittings().map(stripUv)]);
  lathe.dispose();
  if (!merged) throw new Error('The wreck could not be put together');
  merged.computeVertexNormals();
  return merged;
}

/** Plates carry no texture coordinates, so they merge with the drum, which has none either. */
function stripUv(geometry: BufferGeometry): BufferGeometry {
  geometry.deleteAttribute('uv');
  return geometry;
}

const VERTEX = /* glsl */ `
${SHADOW_VERTEX_PARS}
attribute float aHeat;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vHeat;
varying float vViewDepth;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vWorld = world.xyz;
  vNormal = n;
  vLocal = position;
  vHeat = aHeat;
  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;
  vViewDepth = -mv.z;
  writeShadowVaryings(world.xyz, n, vViewDepth);
}
`;

const FRAGMENT = /* glsl */ `
${SHADOW_FRAGMENT_PARS}
${ATMOSPHERE_GLSL}

uniform vec3 uColor;
// How hot the wreck is, from 0 (cold iron) to 1 (white at the nose), and the film's clock for its flicker.
uniform float uHeat;
uniform float uHullTime;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vHeat;
varying float vViewDepth;

float valueNoise(vec3 p) {
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

vec3 cellPoint(vec3 cell) {
  return vec3(hash13s(cell), hash13s(cell + 17.31), hash13s(cell + 41.77));
}

// How far a point is from the nearest seam between the cells of a 3D Voronoi pattern: the joints of a shell of broken plates.
float seamDistance(vec3 p) {
  vec3 base = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      for (int z = -1; z <= 1; z++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 delta = g + cellPoint(base + g) - f;
        float d = dot(delta, delta);
        if (d < d1) {
          d2 = d1;
          d1 = d;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
  }
  return sqrt(d2) - sqrt(d1);
}

// From dull red through orange to a yellow-white, as a surface gets hotter.
vec3 heatRamp(float h) {
  vec3 red = vec3(0.9, 0.12, 0.02);
  vec3 orange = vec3(1.0, 0.42, 0.07);
  vec3 white = vec3(1.0, 0.82, 0.5);
  vec3 c = mix(red, orange, smoothstep(0.15, 0.55, h));
  c = mix(c, white, smoothstep(0.55, 1.0, h));
  return c * (0.2 + 3.4 * h * h);
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  float shadow = sunShadow(vViewDepth);
  float diff = clamp((dot(N, uKeyDir) + 0.08) / 1.08, 0.0, 1.0);

  // The plating: rings round the drum with panels between them, rivets along the joints, and soot
  // dragged back from the nose in long streaks.
  float turn = atan(vLocal.y, vLocal.x) * 1.5915494 + 0.5;
  float ringAt = fract(vLocal.z / 1.55 + 0.35);
  float ring = smoothstep(0.0, 0.05, abs(ringAt - 0.5));
  float across = 0.5 - abs(fract(turn * 10.0) - 0.5);
  float panel = smoothstep(0.0, 0.03, across);
  float rivet = (1.0 - smoothstep(0.1, 0.17, length(vec2(fract(turn * 40.0) - 0.5, (ringAt - 0.5) * 6.0)))) * (1.0 - ring);
  float scorch = valueNoise(vLocal * 1.9);
  float soot = valueNoise(vec3(vLocal.xy * 0.8, vLocal.z * 0.2));
  float plating = mix(0.4, 1.0, ring * panel);

  // Where the fall has sprung the plates, in patches: dark joints that show what burns inside.
  float seam = seamDistance(vLocal * 0.85 + 4.7);
  float sprung = smoothstep(0.58, 0.72, valueNoise(vLocal * 0.42 + 9.0));
  float joint = (1.0 - smoothstep(0.0, 0.2, seam)) * sprung;
  float crack = (1.0 - smoothstep(0.0, 0.05, seam)) * sprung;

  vec3 albedo = uColor * plating * (0.65 + 0.45 * scorch) * (0.55 + 0.6 * soot) * (1.0 - 0.6 * joint) + vec3(0.07, 0.065, 0.06) * rivet;
  vec3 H = normalize(uKeyDir + V);
  float shine = pow(max(dot(N, H), 0.0), 36.0) * 0.35 * step(0.0, dot(N, uKeyDir));
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);

  // How hot: the nose and the torn mouth most, dying away as the wreck cools.
  float flicker = 0.9 + 0.1 * sin(uHullTime * 9.0 + vLocal.z * 2.0);
  float mottle = 0.7 + 0.55 * valueNoise(vLocal * 2.4 + vec3(0.0, 0.0, uHullTime * 0.15));
  float skin = clamp(vHeat * uHeat * flicker * mottle, 0.0, 1.0);
  vec3 sheen = heatRamp(skin) * skin * skin * 0.5;
  vec3 seams = heatRamp(0.3 + 0.7 * skin) * crack * smoothstep(0.2, 0.55, skin) * (0.3 + 0.7 * uHeat);
  vec3 glow = sheen + seams;

  vec3 lit = albedo * (uKeyColor * diff * shadow + ambientLight(N)) + uKeyColor * shine * shadow + uAmbSky * rim * 0.12 + glow;
  lit = applyAtmosphere(lit, vWorld);
  gl_FragColor = vec4(lit, 1.0);
}
`;

export interface Hull {
  readonly mesh: Mesh;
  /** How hot the wreck is, from 0 to 1. */
  setHeat(heat: number): void;
  /** Sets the film's clock, for the flicker of its fire. */
  setTime(seconds: number): void;
  dispose(): void;
}

export function createHull(registry: MaterialRegistry): Hull {
  const geometry = buildGeometry();
  const heat = { value: 1 };
  const clock = { value: 0 };
  const material: ShaderMaterial = registry.create({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uColor: { value: new Color('#2c2927') },
      uHeat: heat,
      uHullTime: clock,
    },
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'intro-hull';
  mesh.frustumCulled = false;
  return {
    mesh,
    setHeat(next) {
      heat.value = next;
    },
    setTime(seconds) {
      clock.value = seconds;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      registry.release(material);
    },
  };
}
