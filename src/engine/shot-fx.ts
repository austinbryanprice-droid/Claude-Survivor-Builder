import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
} from 'three';
import { createRng } from '../shared/hash';
import type { Vec3 } from '../shared/look';

/**
 * The light of the pulse blaster: the flash at the muzzle, the bolt streaking to its mark, the
 * sparks where it lands and the burst of a machine felled. Everything glows (it is drawn additively
 * into the HDR target, above the bloom's threshold), nothing is lit or casts a shadow, and nothing
 * here is an asset: a bolt is a ribbon turned to face the camera, a spark a small square with a soft
 * round (or, for a flash, star-shaped) face.
 *
 * Each kind is one instanced mesh, so a firefight is two draw calls whatever it holds. What an
 * effect does while it lives is worked out in the vertex shader from the moment it was born and the
 * clock `update` advances, so the CPU writes a few numbers when something happens and nothing at all
 * while it plays out. The effects are kept in a ring: when more arrive than there is room for, the
 * oldest are overwritten.
 */

const BOLT_CAPACITY = 64;
const SPARK_CAPACITY = 768;

/** Blocks a second that the head of a bolt flies at. */
const BOLT_SPEED = 170;
/** How far behind the head the streak reaches, in blocks. */
const BOLT_TRAIL = 6;
/** Half the width of a bolt at the gun, in blocks; it swells with the distance so that a far bolt still shows. */
const BOLT_WIDTH = 0.045;
/** A bolt stays on screen at least this long, however near its mark: the shortest shots would last two frames. */
const BOLT_MIN_LIFE = 0.1;

/** How fast a spark falls faster, in blocks a second every second. */
const GRAVITY = 14;

/** Seconds of quiet after which the clock starts over, so that it never grows large enough to blur the shaders' sums. */
const CLOCK_RESET = 600;
/** The birth of a slot that holds nothing: so long ago that it has ended. */
const DEAD = -1e6;

/** What the effects are drawn in, apart from the color a shooter gives their own bolt. */
export const FX_COLOR = {
  /** The core of every bolt and spark: white with a breath of the color around it. */
  core: '#fff7ea',
  /** Sparks where a bolt strikes a machine. */
  hit: '#ffb347',
  /** The burst of a machine felled. */
  burst: '#ff8a2a',
} as const;

/** Ranges are [least, most]; each spark picks its own. Sizes are in blocks, speeds in blocks a second, lives in seconds. */
interface Spray {
  /** How strongly the sparks follow the way they are thrown, against how widely they scatter (`spread`). */
  readonly push: number;
  readonly spread: number;
  /** An upward lean, so that sparks leap before they fall. */
  readonly lift: number;
  readonly count: number;
  readonly speed: readonly [number, number];
  readonly life: readonly [number, number];
  readonly size: readonly [number, number];
}

const SPRAY = {
  /** A few sparks out of the muzzle, the way the bolt goes. */
  muzzle: {
    push: 1,
    spread: 0.5,
    lift: 0,
    count: 4,
    speed: [4, 9],
    life: [0.06, 0.14],
    size: [0.025, 0.04],
  },
  /** Sparks thrown back off what a bolt struck. */
  impact: {
    push: 1,
    spread: 0.9,
    lift: 0.35,
    count: 10,
    speed: [3, 9],
    life: [0.25, 0.55],
    size: [0.03, 0.06],
  },
  /** A machine coming apart: every way at once. */
  burst: {
    push: 0,
    spread: 1,
    lift: 0.5,
    count: 30,
    speed: [3, 11],
    life: [0.4, 0.8],
    size: [0.04, 0.09],
  },
} as const satisfies Record<string, Spray>;

/** The flash each effect opens with: how long it lasts and how large it swells, in blocks. */
const FLASH = {
  muzzle: { life: 0.08, size: 0.4 },
  impact: { life: 0.14, size: 0.55 },
  burst: { life: 0.22, size: 1.6 },
  burstCore: { life: 0.12, size: 0.9 },
} as const;

const BOLT_VERTEX = /* glsl */ `
attribute vec3 iFrom;
attribute vec3 iTo;
attribute vec4 iBolt;   // birth, blocks flown a second, length of the streak, half width
attribute vec3 iColor;

uniform float uTime;

varying vec2 vUv;       // x: 0 at the tail, 1 at the head; y: -1 to 1 across
varying vec3 vColor;
varying float vFade;

void main() {
  vec3 span = iTo - iFrom;
  float len = length(span);
  vec3 dir = span / max(len, 0.0001);
  float flown = (uTime - iBolt.x) * iBolt.y;
  float head = clamp(flown, 0.0, len);
  float tail = clamp(flown - iBolt.z, 0.0, len);
  float alive = step(0.0, flown) * step(flown, len + iBolt.z);

  vec3 center = iFrom + dir * mix(tail, head, position.x);
  vec3 toCamera = cameraPosition - center;
  vec3 across = cross(dir, toCamera);
  float acrossLength = length(across);
  across = acrossLength > 0.0001 ? across / acrossLength : vec3(0.0, 1.0, 0.0);
  float width = iBolt.w * (1.0 + length(toCamera) * 0.03) * mix(0.4, 1.0, position.x);
  vec3 wp = center + across * position.y * width;

  vUv = position.xy;
  vColor = iColor;
  // The streak shortens as the tail catches up with the head, and dims as it does.
  vFade = 1.0 - 0.85 * clamp((flown - len) / iBolt.z, 0.0, 1.0);
  gl_Position = alive > 0.5 ? projectionMatrix * viewMatrix * vec4(wp, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const BOLT_FRAGMENT = /* glsl */ `
uniform vec3 uCore;

varying vec2 vUv;
varying vec3 vColor;
varying float vFade;

void main() {
  float across = 1.0 - abs(vUv.y);
  float core = pow(across, 5.0);
  float halo = pow(across, 1.6);
  // Brightest at the head, dying away along the streak.
  float along = pow(vUv.x, 1.4);
  vec3 light = vColor * halo * 2.4 + uCore * core * 5.0;
  gl_FragColor = vec4(light * along * vFade, 1.0);
}
`;

const SPARK_VERTEX = /* glsl */ `
attribute vec4 iOrigin;    // where it began, and how much gravity pulls it (0 for a flash)
attribute vec3 iVelocity;
attribute vec4 iLife;      // birth, how long it lasts, size, 1 for a flash and 0 for a spark
attribute vec3 iColor;

uniform float uTime;
uniform float uGravity;

varying vec2 vCorner;
varying vec3 vColor;
varying float vFade;
varying float vFlash;

void main() {
  float age = uTime - iLife.x;
  float t = age / iLife.y;
  float alive = step(0.0, age) * step(t, 1.0);
  float flash = iLife.w;
  float pull = uGravity * iOrigin.w;

  vec3 center = iOrigin.xyz + iVelocity * age;
  center.y -= 0.5 * pull * age * age;
  // A flash hangs in front of whatever it lit, so that the wall it struck does not cut it in half.
  center += normalize(cameraPosition - center) * 0.15 * flash;

  // A spark is a streak along the way it is going; a flash is a round star.
  vec3 velocity = iVelocity;
  velocity.y -= pull * age;
  vec3 seen = (viewMatrix * vec4(velocity, 0.0)).xyz;
  float speed = length(seen.xy);
  vec2 axis = speed > 0.001 ? seen.xy / speed : vec2(1.0, 0.0);
  float stretch = 1.0 + (1.0 - flash) * min(speed * 0.05, 3.0);
  // Flashes swell quickly and then hold; sparks cool and shrink.
  float size = iLife.z * mix(1.0 - 0.7 * t, 0.35 + 0.65 * sqrt(clamp(t * 4.0, 0.0, 1.0)), flash);

  vec2 corner = position.xy;
  vec4 mv = viewMatrix * vec4(center, 1.0);
  mv.xy += (axis * corner.x * stretch + vec2(-axis.y, axis.x) * corner.y) * size;

  vCorner = corner;
  vColor = iColor;
  vFlash = flash;
  vFade = pow(max(1.0 - t, 0.0), mix(1.5, 2.0, flash));
  gl_Position = alive > 0.5 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const SPARK_FRAGMENT = /* glsl */ `
uniform vec3 uCore;

varying vec2 vCorner;
varying vec3 vColor;
varying float vFade;
varying float vFlash;

void main() {
  float r = length(vCorner);
  if (r >= 1.0) discard;
  float soft = pow(1.0 - r, 2.0);
  float hot = pow(1.0 - r, 6.0);
  // A flash has four points of light, a spark has none.
  float armX = pow(max(0.0, 1.0 - abs(vCorner.y) * 6.0), 2.0) * (1.0 - abs(vCorner.x));
  float armY = pow(max(0.0, 1.0 - abs(vCorner.x) * 6.0), 2.0) * (1.0 - abs(vCorner.y));
  float star = (armX + armY) * vFlash;
  vec3 light = vColor * soft * 2.0 + uCore * (hot * 4.0 + star * 2.5);
  gl_FragColor = vec4(light * vFade, 1.0);
}
`;

export interface ShotFx {
  readonly object: Group;
  /** A bolt from `from` to `to`, in the color of whoever fired it. It flies from the one to the other and fades. */
  bolt(from: Vec3, to: Vec3, color: string): void;
  /** The flash at a muzzle at `at`, with a few sparks thrown along `dir`, the way the bolt leaves. */
  muzzle(at: Vec3, dir: Vec3, color: string): void;
  /** A bolt landing at `at`, flying along `dir`: a flash and sparks thrown back the way it came. */
  impact(at: Vec3, dir: Vec3, color: string): void;
  /** A machine falling apart at `at`. */
  burst(at: Vec3): void;
  /** Lets `dt` seconds pass for the effects that are playing. */
  update(dt: number): void;
  /** How many bolts and sparks (flashes included) are playing now, for tests and the debug hook. */
  live(): { bolts: number; sparks: number };
  dispose(): void;
}

export interface ShotFxOptions {
  /** Seeds the scatter of the sparks, so that a test sees the same ones every time. */
  seed?: number;
}

type Triple = readonly [number, number, number];

export function createShotFx({ seed = 0x5107 }: ShotFxOptions = {}): ShotFx {
  const random = createRng(seed);
  const clock = { value: 0 };
  let time = 0;

  // The bolts.
  const boltFrom = new Float32Array(BOLT_CAPACITY * 3);
  const boltTo = new Float32Array(BOLT_CAPACITY * 3);
  const boltInfo = new Float32Array(BOLT_CAPACITY * 4);
  const boltColor = new Float32Array(BOLT_CAPACITY * 3);
  /** When each bolt ends, in the clock's time. The shader works this out itself; the CPU needs it to know what is playing. */
  const boltEnd = new Float32Array(BOLT_CAPACITY).fill(DEAD);
  for (let i = 0; i < BOLT_CAPACITY; i++) boltInfo[i * 4] = DEAD;

  const boltAttributes = {
    iFrom: new InstancedBufferAttribute(boltFrom, 3),
    iTo: new InstancedBufferAttribute(boltTo, 3),
    iBolt: new InstancedBufferAttribute(boltInfo, 4),
    iColor: new InstancedBufferAttribute(boltColor, 3),
  };

  // The sparks and flashes.
  const sparkOrigin = new Float32Array(SPARK_CAPACITY * 4);
  const sparkVelocity = new Float32Array(SPARK_CAPACITY * 3);
  const sparkLife = new Float32Array(SPARK_CAPACITY * 4);
  const sparkColor = new Float32Array(SPARK_CAPACITY * 3);
  const sparkEnd = new Float32Array(SPARK_CAPACITY).fill(DEAD);
  for (let i = 0; i < SPARK_CAPACITY; i++) {
    sparkLife[i * 4] = DEAD;
    sparkLife[i * 4 + 1] = 1;
  }

  const sparkAttributes = {
    iOrigin: new InstancedBufferAttribute(sparkOrigin, 4),
    iVelocity: new InstancedBufferAttribute(sparkVelocity, 3),
    iLife: new InstancedBufferAttribute(sparkLife, 4),
    iColor: new InstancedBufferAttribute(sparkColor, 3),
  };

  const dress = (
    corners: readonly (readonly [number, number])[],
    attributes: Record<string, InstancedBufferAttribute>,
  ): InstancedBufferGeometry => {
    const geometry = new InstancedBufferGeometry();
    const positions = new Float32Array(corners.length * 3);
    corners.forEach(([x, y], i) => positions.set([x, y, 0], i * 3));
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    for (const [name, attribute] of Object.entries(attributes)) {
      attribute.setUsage(DynamicDrawUsage);
      geometry.setAttribute(name, attribute);
    }
    geometry.instanceCount = 0;
    return geometry;
  };
  const boltGeometry = dress(
    [
      [0, -1],
      [1, -1],
      [1, 1],
      [0, 1],
    ],
    boltAttributes,
  );
  const sparkGeometry = dress(
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ],
    sparkAttributes,
  );

  const glowing = (vertexShader: string, fragmentShader: string): ShaderMaterial =>
    new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: clock,
        uGravity: { value: GRAVITY },
        uCore: { value: new Color(FX_COLOR.core) },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
  const boltMaterial = glowing(BOLT_VERTEX, BOLT_FRAGMENT);
  const sparkMaterial = glowing(SPARK_VERTEX, SPARK_FRAGMENT);

  // The meshes are always in the scene, drawing nothing when nothing plays, so the first shot of a
  // session does not wait on the graphics driver to build their programs.
  const bolts = new Mesh(boltGeometry, boltMaterial);
  bolts.name = 'shot-bolts';
  const sparks = new Mesh(sparkGeometry, sparkMaterial);
  sparks.name = 'shot-sparks';
  for (const mesh of [bolts, sparks]) {
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
  }
  const object = new Group();
  object.name = 'shot-fx';
  object.add(bolts, sparks);

  let nextBolt = 0;
  let nextSpark = 0;
  /** How many slots have ever been written, up to the capacity: the rest are still empty. */
  let boltsWritten = 0;
  let sparksWritten = 0;
  let boltsUntil = 0;
  let sparksUntil = 0;
  let boltsChanged = false;
  let sparksChanged = false;

  const tint = new Color();
  const rgb = (color: string): Triple => {
    tint.set(color);
    return [tint.r, tint.g, tint.b];
  };

  const unit = (x: number, y: number, z: number, out: [number, number, number]): void => {
    const length = Math.hypot(x, y, z) || 1;
    out[0] = x / length;
    out[1] = y / length;
    out[2] = z / length;
  };
  const sphere = (out: [number, number, number]): void => {
    const z = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - z * z);
    out[0] = ring * Math.cos(angle);
    out[1] = z;
    out[2] = ring * Math.sin(angle);
  };

  const spark = (
    at: Vec3,
    velocity: Triple,
    life: number,
    size: number,
    flash: boolean,
    color: Triple,
  ): void => {
    const i = nextSpark;
    nextSpark = (nextSpark + 1) % SPARK_CAPACITY;
    sparksWritten = Math.min(SPARK_CAPACITY, sparksWritten + 1);
    sparkOrigin.set([at.x, at.y, at.z, flash ? 0 : 1], i * 4);
    sparkVelocity.set(velocity, i * 3);
    sparkLife.set([time, life, size, flash ? 1 : 0], i * 4);
    sparkColor.set(color, i * 3);
    sparkEnd[i] = time + life;
    sparksUntil = Math.max(sparksUntil, time + life);
    sparksChanged = true;
  };

  const direction: [number, number, number] = [0, 0, 0];
  const scatter: [number, number, number] = [0, 0, 0];
  const between = ([least, most]: readonly [number, number]): number =>
    least + random() * (most - least);

  /** Throws `look.count` sparks from `at`, mostly the way `along` points, taking the colors in turn. */
  const spray = (at: Vec3, along: Triple, look: Spray, colors: readonly Triple[]): void => {
    for (let n = 0; n < look.count; n++) {
      sphere(scatter);
      unit(
        along[0] * look.push + scatter[0] * look.spread,
        along[1] * look.push + scatter[1] * look.spread + look.lift,
        along[2] * look.push + scatter[2] * look.spread,
        direction,
      );
      const fast = between(look.speed);
      spark(
        at,
        [direction[0] * fast, direction[1] * fast, direction[2] * fast],
        between(look.life),
        between(look.size),
        false,
        colors[n % colors.length] as Triple,
      );
    }
  };

  const still: Triple = [0, 0, 0];
  const white = rgb(FX_COLOR.core);

  return {
    object,

    bolt(from, to, color) {
      const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      if (!Number.isFinite(length) || length <= 0.01) return;
      const travel = length + BOLT_TRAIL;
      const life = Math.max(BOLT_MIN_LIFE, travel / BOLT_SPEED);
      const i = nextBolt;
      nextBolt = (nextBolt + 1) % BOLT_CAPACITY;
      boltsWritten = Math.min(BOLT_CAPACITY, boltsWritten + 1);
      boltFrom.set([from.x, from.y, from.z], i * 3);
      boltTo.set([to.x, to.y, to.z], i * 3);
      boltInfo.set([time, travel / life, BOLT_TRAIL, BOLT_WIDTH], i * 4);
      boltColor.set(rgb(color), i * 3);
      boltEnd[i] = time + life;
      boltsUntil = Math.max(boltsUntil, time + life);
      boltsChanged = true;
    },

    muzzle(at, dir, color) {
      const c = rgb(color);
      spark(at, still, FLASH.muzzle.life, FLASH.muzzle.size, true, c);
      spray(at, [dir.x, dir.y, dir.z], SPRAY.muzzle, [c]);
    },

    impact(at, dir, color) {
      const c = rgb(color);
      spark(at, still, FLASH.impact.life, FLASH.impact.size, true, c);
      spray(at, [-dir.x, -dir.y, -dir.z], SPRAY.impact, [c, c, white]);
    },

    burst(at) {
      const orange = rgb(FX_COLOR.burst);
      const amber = rgb(FX_COLOR.hit);
      spark(at, still, FLASH.burst.life, FLASH.burst.size, true, orange);
      spark(at, still, FLASH.burstCore.life, FLASH.burstCore.size, true, white);
      spray(at, still, SPRAY.burst, [orange, amber, orange]);
    },

    update(dt) {
      time += Math.max(0, dt);
      clock.value = time;

      if (boltsChanged) {
        for (const attribute of Object.values(boltAttributes)) attribute.needsUpdate = true;
        boltsChanged = false;
      }
      if (sparksChanged) {
        for (const attribute of Object.values(sparkAttributes)) attribute.needsUpdate = true;
        sparksChanged = false;
      }
      boltGeometry.instanceCount = time < boltsUntil ? boltsWritten : 0;
      sparkGeometry.instanceCount = time < sparksUntil ? sparksWritten : 0;

      // Once everything has played out and a long quiet has passed, the clock starts over.
      if (time > CLOCK_RESET && time >= boltsUntil && time >= sparksUntil) {
        time = 0;
        clock.value = 0;
        boltsUntil = 0;
        sparksUntil = 0;
        boltEnd.fill(DEAD);
        sparkEnd.fill(DEAD);
        for (let i = 0; i < BOLT_CAPACITY; i++) boltInfo[i * 4] = DEAD;
        for (let i = 0; i < SPARK_CAPACITY; i++) sparkLife[i * 4] = DEAD;
        boltAttributes.iBolt.needsUpdate = true;
        sparkAttributes.iLife.needsUpdate = true;
      }
    },

    live() {
      let playingBolts = 0;
      for (let i = 0; i < BOLT_CAPACITY; i++) if (time < (boltEnd[i] as number)) playingBolts++;
      let playingSparks = 0;
      for (let i = 0; i < SPARK_CAPACITY; i++) if (time < (sparkEnd[i] as number)) playingSparks++;
      return { bolts: playingBolts, sparks: playingSparks };
    },

    dispose() {
      object.removeFromParent();
      object.clear();
      boltGeometry.dispose();
      sparkGeometry.dispose();
      boltMaterial.dispose();
      sparkMaterial.dispose();
    },
  };
}
