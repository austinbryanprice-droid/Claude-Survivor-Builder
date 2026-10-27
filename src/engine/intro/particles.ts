import {
  AdditiveBlending,
  BufferAttribute,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  type ShaderMaterial,
} from 'three';
import { ATMOSPHERE_GLSL } from '../glsl/atmosphere.glsl';
import type { MaterialRegistry } from '../materials';

/**
 * The film's fire, smoke, sparks and embers. Every particle is written once, before the film
 * plays, with when it is born, how long it lives and how it moves; the vertex shader works out where
 * it is and how it looks from the film's clock alone. So the picture at any second is the same
 * however the film got there, the CPU does nothing while it plays, and a field of thousands of
 * particles is one draw call.
 *
 * A particle is a square turned to face the camera. What is drawn on it depends on the field's kind:
 * `fire` and `ember` glow (they add light to what is behind them, into the HDR target above the
 * bloom's threshold), `spark` is a streak along the way it flies, `smoke` is a soft puff that
 * covers what is behind it, lit by the sky and the fire and dimmed by the haze like anything else.
 */

export type ParticleKind = 'fire' | 'smoke' | 'spark' | 'ember';

/** One particle. Distances are in meters, times in seconds of the film, colors linear. */
export interface ParticleSpec {
  /** Where it is born. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The film's clock when it is born, and how long it lives. */
  readonly birth: number;
  readonly life: number;
  /** How it is thrown, in meters a second. */
  readonly vx?: number;
  readonly vy?: number;
  readonly vz?: number;
  /** How quickly the throw dies away, per second (0 flies on at the same speed). */
  readonly drag?: number;
  /** Meters a second a second it is pulled down (negative lets it rise, like smoke). */
  readonly gravity?: number;
  /** Width of the square at birth and at death. */
  readonly size: number;
  readonly sizeEnd?: number;
  /** Color at birth and at death, and how strongly it shows at its brightest. */
  readonly color: readonly [number, number, number];
  readonly colorEnd?: readonly [number, number, number];
  readonly alpha?: number;
  /** A random number from 0 to 1 that makes this one different from its neighbors. */
  readonly seed: number;
  /** How far a spark's streak is stretched along its flight, as a multiple of its width; for a fire, how much taller than wide a flame stands. */
  readonly stretch?: number;
  /** The share of its life it takes to fade in, and the share it takes to fade out. */
  readonly fadeIn?: number;
  readonly fadeOut?: number;
  /** Turns of a puff of smoke, in radians a second. */
  readonly spin?: number;
}

export interface ParticleField {
  readonly object: Mesh;
  /** The number of particles written. */
  readonly count: number;
  add(spec: ParticleSpec): void;
  /** Sends what has been added to the graphics card. Call once, after the last `add`. */
  commit(): void;
  /** Sets the film's clock. */
  setTime(seconds: number): void;
  dispose(): void;
}

const VERTEX = /* glsl */ `
attribute vec4 iOrigin;    // x, y, z, birth
attribute vec4 iVelocity;  // vx, vy, vz, life
attribute vec4 iMotion;    // drag, gravity, size at birth, size at death
attribute vec4 iColorA;    // color at birth, alpha
attribute vec4 iColorB;    // color at death, seed
attribute vec4 iExtra;     // stretch, fade in, fade out, spin

uniform float uTime;
uniform float uNearFade;

varying vec2 vCorner;
varying vec4 vColor;
varying float vAge;
varying float vSeed;
varying vec3 vWorld;
varying float vFlame;

void main() {
  float age = uTime - iOrigin.w;
  float life = iVelocity.w;
  float t = age / life;
  float alive = step(0.0, age) * step(t, 1.0);

  float drag = iMotion.x;
  float travel = drag > 0.001 ? (1.0 - exp(-drag * age)) / drag : age;
  vec3 center = iOrigin.xyz + iVelocity.xyz * travel;
  center.y -= 0.5 * iMotion.y * age * age;

  vec3 toCamera = cameraPosition - center;
  float dist = length(toCamera);

  float grow = smoothstep(0.0, 1.0, t);
  float size = mix(iMotion.z, iMotion.w, grow);

  vec2 corner = position.xy;
  vec4 mv = viewMatrix * vec4(center, 1.0);
  #if KIND == 2
    // A spark is a streak along the way it is going, as seen from here.
    vec3 velocity = iVelocity.xyz * exp(-drag * age);
    velocity.y -= iMotion.y * age;
    vec3 seen = (viewMatrix * vec4(velocity, 0.0)).xyz;
    float speed = length(seen.xy);
    vec2 axis = speed > 0.001 ? seen.xy / speed : vec2(1.0, 0.0);
    float width = max(size, dist * 0.0022);
    float reach = width * (1.0 + iExtra.x * min(speed * 0.06, 1.0));
    mv.xy += axis * corner.x * reach + vec2(-axis.y, axis.x) * corner.y * width;
  #else
    float width = max(size, dist * 0.0035);
    #if KIND == 0
      if (iExtra.x > 0.0) {
        // A flame stands up: its length runs along the world's up as seen from here, it sways a little, and its base is where it was born.
        vec2 upSeen = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xy;
        float upLength = length(upSeen);
        vec2 up = upLength > 0.001 ? upSeen / upLength : vec2(0.0, 1.0);
        up = normalize(up + vec2(-up.y, up.x) * sin(uTime * 3.1 + iColorB.w * 40.0) * 0.12);
        float tall = 1.0 + iExtra.x;
        mv.xy += (vec2(-up.y, up.x) * corner.x + up * corner.y * tall + up * tall) * width * 0.5;
      } else
    #endif
    {
      float turn = iColorB.w * 6.2831853 + age * iExtra.w;
      float c = cos(turn);
      float s = sin(turn);
      vec2 rotated = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
      mv.xy += rotated * width * 0.5;
    }
  #endif

  float fadeIn = iExtra.y > 0.0 ? smoothstep(0.0, iExtra.y, t) : 1.0;
  float fadeOut = iExtra.z > 0.0 ? 1.0 - smoothstep(1.0 - iExtra.z, 1.0, t) : 1.0;
  float near = smoothstep(0.4, uNearFade, dist);
  vColor = vec4(mix(iColorA.rgb, iColorB.rgb, smoothstep(0.0, 1.0, t)), iColorA.a * fadeIn * fadeOut * near);
  vCorner = corner;
  vAge = t;
  vSeed = iColorB.w;
  vWorld = center;
  vFlame = iExtra.x;
  gl_Position = alive > 0.5 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
${ATMOSPHERE_GLSL}

uniform float uTime;
uniform float uFog;

varying vec2 vCorner;
varying vec4 vColor;
varying float vAge;
varying float vSeed;
varying vec3 vWorld;
varying float vFlame;

float puffNoise(vec2 p) {
  return texture2D(uNoise, p).r * 0.6 + texture2D(uNoise, p * 2.3 + 0.37).g * 0.4;
}

void main() {
  float r = length(vCorner);
  #if KIND == 0
    // Fire: a ragged glowing blob with a hot middle that swirls a little as it burns, or, where a
    // flame is asked for, a tongue that narrows to its tip.
    float fr = r;
    if (vFlame > 0.0) {
      vec2 q = vCorner;
      q.x /= max(0.22, 1.0 - 0.8 * clamp(q.y * 0.5 + 0.5, 0.0, 1.0));
      q.y *= 0.92;
      fr = length(q);
    }
    if (fr >= 1.0) discard;
    float n = puffNoise(vCorner * 0.45 + vec2(vSeed * 7.0, vSeed * 3.0 + uTime * 0.35));
    float body = smoothstep(1.0, 0.1, fr + (n - 0.5) * 0.7);
    float core = pow(max(1.0 - fr, 0.0), 3.0);
    vec3 light = vColor.rgb * (body * 0.85 + core * 1.8) * vColor.a;
    gl_FragColor = vec4(light, 1.0);
  #elif KIND == 1
    // Smoke: a soft puff with a billowing edge, lit by the sky and the sun, warmed by the fire at its heart while it is young.
    if (r >= 1.0) discard;
    float n = puffNoise(vCorner * 0.5 + vec2(vSeed * 5.0, vSeed * 11.0));
    float body = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.9);
    vec3 lit = vColor.rgb * (uAmbSky * 0.9 + uKeyColor * 0.45 * (0.55 + 0.45 * (1.0 - r)));
    lit = mix(lit, applyAtmosphere(lit, vWorld), uFog);
    gl_FragColor = vec4(lit, body * vColor.a);
  #elif KIND == 2
    // A spark: a thin bright streak, brightest in the middle, with a white-hot core.
    float across = 1.0 - abs(vCorner.y);
    float along = 1.0 - abs(vCorner.x);
    float streak = pow(max(across, 0.0), 3.0) * pow(max(along, 0.0), 1.2);
    float hot = pow(max(across, 0.0), 8.0) * pow(max(along, 0.0), 2.0);
    vec3 light = (vColor.rgb * streak * 2.2 + vec3(1.0, 0.9, 0.7) * hot * 2.5) * vColor.a;
    gl_FragColor = vec4(light, 1.0);
  #else
    // An ember: a small round glow that flickers.
    if (r >= 1.0) discard;
    float flicker = 0.62 + 0.38 * sin(uTime * (4.0 + vSeed * 9.0) + vSeed * 40.0);
    float soft = pow(1.0 - r, 2.0);
    float hot = pow(1.0 - r, 7.0);
    vec3 light = (vColor.rgb * soft * 1.6 + vec3(1.0, 0.8, 0.5) * hot * 2.0) * vColor.a * flicker;
    gl_FragColor = vec4(light, 1.0);
  #endif
}
`;

const KIND_CODE: Record<ParticleKind, number> = { fire: 0, smoke: 1, spark: 2, ember: 3 };

export interface ParticleFieldOptions {
  /** How much of the haze of the valley a smoke puff takes on, from 0 (none: it keeps its own color at any distance) to 1 (all of it). */
  readonly fog?: number;
}

export function createParticleField(
  registry: MaterialRegistry,
  kind: ParticleKind,
  capacity: number,
  options: ParticleFieldOptions = {},
): ParticleField {
  const origin = new Float32Array(capacity * 4);
  const velocity = new Float32Array(capacity * 4);
  const motion = new Float32Array(capacity * 4);
  const colorA = new Float32Array(capacity * 4);
  const colorB = new Float32Array(capacity * 4);
  const extra = new Float32Array(capacity * 4);
  const attributes = {
    iOrigin: new InstancedBufferAttribute(origin, 4),
    iVelocity: new InstancedBufferAttribute(velocity, 4),
    iMotion: new InstancedBufferAttribute(motion, 4),
    iColorA: new InstancedBufferAttribute(colorA, 4),
    iColorB: new InstancedBufferAttribute(colorB, 4),
    iExtra: new InstancedBufferAttribute(extra, 4),
  };

  const geometry = new InstancedBufferGeometry();
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const positions = new Float32Array(12);
  corners.forEach(([x, y], i) => positions.set([x as number, y as number, 0], i * 3));
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [name, attribute] of Object.entries(attributes)) {
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
  geometry.instanceCount = 0;

  const additive = kind !== 'smoke';
  const clock = { value: 0 };
  const material: ShaderMaterial = registry.createPlain({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: { KIND: String(KIND_CODE[kind]) },
    uniforms: { uTime: clock, uNearFade: { value: 6 }, uFog: { value: options.fog ?? 1 } },
    blending: additive ? AdditiveBlending : NormalBlending,
    transparent: true,
    depthWrite: false,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = `intro-${kind}`;
  mesh.frustumCulled = false;
  mesh.renderOrder = additive ? 6 : 5;

  let count = 0;

  return {
    object: mesh,
    get count() {
      return count;
    },
    add(spec) {
      if (count >= capacity) throw new Error(`The ${kind} field holds only ${capacity} particles`);
      const i = count++ * 4;
      origin[i] = spec.x;
      origin[i + 1] = spec.y;
      origin[i + 2] = spec.z;
      origin[i + 3] = spec.birth;
      velocity[i] = spec.vx ?? 0;
      velocity[i + 1] = spec.vy ?? 0;
      velocity[i + 2] = spec.vz ?? 0;
      velocity[i + 3] = Math.max(1e-3, spec.life);
      motion[i] = spec.drag ?? 0;
      motion[i + 1] = spec.gravity ?? 0;
      motion[i + 2] = spec.size;
      motion[i + 3] = spec.sizeEnd ?? spec.size;
      colorA[i] = spec.color[0];
      colorA[i + 1] = spec.color[1];
      colorA[i + 2] = spec.color[2];
      colorA[i + 3] = spec.alpha ?? 1;
      const end = spec.colorEnd ?? spec.color;
      colorB[i] = end[0];
      colorB[i + 1] = end[1];
      colorB[i + 2] = end[2];
      colorB[i + 3] = spec.seed;
      extra[i] = spec.stretch ?? 0;
      extra[i + 1] = spec.fadeIn ?? 0.1;
      extra[i + 2] = spec.fadeOut ?? 0.4;
      extra[i + 3] = spec.spin ?? 0;
    },
    commit() {
      geometry.instanceCount = count;
      for (const attribute of Object.values(attributes)) attribute.needsUpdate = true;
      mesh.visible = count > 0;
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
