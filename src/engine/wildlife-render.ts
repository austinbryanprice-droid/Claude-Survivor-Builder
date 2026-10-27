import {
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector4,
  type BufferGeometry,
} from 'three';
import { NET } from '../shared/net-config';
import { WILD_FLAG, WILD_SPECIES, type WildPose } from '../shared/wildlife-state';
import {
  WILD_DEPTH_FRAGMENT,
  WILD_DEPTH_VERTEX,
  WILD_FRAGMENT,
  WILD_VERTEX,
} from './glsl/wildlife.glsl';
import type { MaterialRegistry } from './materials';
import { buildModel } from './wildlife-models';
import { LOOK_COUNT, triangleCount } from './wildlife-shapes';

/**
 * The creatures of the valley, each species drawn as one instanced mesh: a stag with antlers, a
 * hare, a mossy tortoise, a school of silver fish, a ray and a lantern jelly under the lake, a
 * flock of finches and a soaring kite, all built from smooth shapes in code (no assets). A species
 * costs one draw call (and one more for its shadows, if it throws any). The gaits, the lowering of
 * a head to graze, the flaps of the wings, the ripple of a ray and the pulse of a jelly are done in
 * the vertex shader from a few numbers per creature; the coats are painted in the fragment shader.
 *
 * The poses come from the network layer already smoothed (`EnemyMirror` carries the creatures too);
 * this only dresses them. What it keeps per creature is what the picture needs and the host does
 * not say: how far the legs have walked, and the ease of the alarm, the anger, the lunge and the rest.
 *
 * The creatures of the water are drawn after the lake's surface, which is see-through and lets nothing
 * behind it show once the water is deep: they are tinted by the depth they swim at instead, and fade
 * out where the surface turns to a mirror.
 */

/** A frame longer than this (a hidden tab, a breakpoint) is not time passing for the creatures. */
const MAX_STEP = 0.1;
/** Creatures differ in size by up to this much either way, from their id, so a herd is not a stamp. */
const SIZE_SPREAD = 0.06;
/** A creature arrives by growing out of nothing over this long. */
const APPEAR_SECONDS = 0.7;
/** A hit lights the creature up for as long as the flag is up, then the light dies away in this long. */
const FLASH_FADE = 0.25;
/** How quickly the smoothed parts of the picture follow what the host says, per second. */
const GAIT_FOLLOW = 8;
const ALARM_RISE = 9;
const ALARM_FALL = 2.5;
const ANGER_FOLLOW = 5;
const LUNGE_FOLLOW = 10;
const GRAZE_FOLLOW = 2.2;
const BANK_FOLLOW = 4;
const PITCH_FOLLOW = 4;
/** A creature standing still this slowly (blocks a second) is at rest, and puts its head down to graze. */
const STANDING = 0.15;
/** The renderOrder of the creatures of the water: after the lake's surface (10) and before the shot effects (12). */
const WATER_ORDER = 11;

/** One of a species' eight looks: a color, how glossy it is, how see-through, how much it glows, how much sun shines through it. */
interface LookSpec {
  readonly color: string;
  readonly gloss: number;
  readonly alpha?: number;
  readonly glow?: number;
  readonly thin?: number;
}

const look = (
  color: string,
  gloss = 0.3,
  more: Pick<LookSpec, 'alpha' | 'glow' | 'thin'> = {},
): LookSpec => ({ color, gloss, ...more });

type Vec4 = readonly [number, number, number, number];

/** What sets a species apart in the picture: its model, how large it is drawn, how it moves and what its coat is like. */
interface Variant {
  /** The name of its mesh in the scene. */
  readonly name: string;
  readonly species: number;
  /** How large it is drawn against its model. */
  readonly scale: number;
  /** Radians of its cycle per block it moves, radians a second the cycle turns on its own, and extra ones when it is startled. */
  readonly stride: number;
  readonly beat: number;
  readonly burst: number;
  /** The speed (blocks a second) at which its limbs are at their full swing, and the least of the swing it always has. */
  readonly fullGait: number;
  readonly minGait: number;
  /** How far its body follows a slope or a climb, from 0 (it stays level) to 1, and how far its nose drops in a strike. */
  readonly tilt: number;
  readonly dive: number;
  /** The shader's `uLegs`, `uHead`, `uFlight` and `uSwim` (see `wildlife.glsl.ts`). */
  readonly legs: Vec4;
  readonly head: Vec4;
  readonly flight: Vec4;
  readonly swim: Vec4;
  /** Which coat the fragment shader paints, whether a share of the species wear the other one, and how pale the underside is. */
  readonly pattern: number;
  readonly twoCoats: boolean;
  readonly shade: number;
  /** What its eyes give off when it is angry. */
  readonly eyeGlow: string;
  /** It lives in the lake: drawn after the surface, tinted by its depth. */
  readonly water: boolean;
  /** See-through all over, so it does not hide what is behind it. */
  readonly glass: boolean;
  /** It throws a shadow. */
  readonly shadow: boolean;
  /** The eight looks, in the order of `LOOK`. */
  readonly looks: readonly LookSpec[];
}

/** The species the picture knows, indexed by `WILD_SPECIES`. */
const VARIANTS: readonly Variant[] = [
  {
    // The stag trots with opposite corners together; its head drops to the grass, rises to look and goes down for the antlers to strike.
    name: 'stags',
    species: WILD_SPECIES.stag,
    scale: 0.85,
    stride: 2.9,
    beat: 0,
    burst: 0,
    fullGait: 2,
    minGait: 0,
    tilt: 0.5,
    dive: 0,
    legs: [0.55, 0.8, 0.02, 0],
    head: [1.25, 0.2, 0.55, 0.3],
    flight: [0, 0, 0, 0],
    swim: [0, 0, 0, 0],
    pattern: 1,
    twoCoats: true,
    shade: 0.85,
    eyeGlow: '#ff3a1c',
    water: false,
    glass: false,
    shadow: true,
    looks: [
      look('#8b5a37', 0.22),
      look('#e0cfa8', 0.2),
      look('#d6c8a2', 0.3),
      look('#2b1d15', 0.45),
      look('#120a06', 0.9),
      look('#f1e5c8', 0.2),
      look('#8b5a37', 0.22),
      look('#74492b', 0.22),
    ],
  },
  {
    // The hare bounds: the forelegs reach, the hind legs push, the whole body leaves the ground.
    name: 'hares',
    species: WILD_SPECIES.hare,
    scale: 1,
    stride: 2.4,
    beat: 0,
    burst: 0,
    fullGait: 3,
    minGait: 0,
    tilt: 0.4,
    dive: 0,
    legs: [0.85, 0.8, 0.14, 1],
    head: [0.75, 0.25, 0, 0],
    flight: [0, 0, 0, 0],
    swim: [0, 0, 0, 0],
    pattern: 2,
    twoCoats: true,
    shade: 0.8,
    eyeGlow: '#ff3a1c',
    water: false,
    glass: false,
    shadow: true,
    looks: [
      look('#a28158', 0.15),
      look('#ece0c8', 0.12),
      look('#cfa58f', 0.15, { thin: 0.6 }),
      look('#2c2018', 0.35),
      look('#150c07', 0.9),
      look('#5e452d', 0.12),
      look('#a28158', 0.15),
      look('#bda27c', 0.15),
    ],
  },
  {
    // The mossback plods: short strides on stout legs, a nod of the head, and a bash with the whole front of it.
    name: 'mossbacks',
    species: WILD_SPECIES.mossback,
    scale: 1,
    stride: 5,
    beat: 0,
    burst: 0,
    fullGait: 1.2,
    minGait: 0,
    tilt: 0.4,
    dive: 0,
    legs: [0.35, 0, 0.012, 0],
    head: [0.55, 0.15, 0.5, 0.4],
    flight: [0, 0, 0, 0],
    swim: [0, 0, 0, 0],
    pattern: 3,
    twoCoats: true,
    shade: 0.4,
    eyeGlow: '#ff5a22',
    water: false,
    glass: false,
    shadow: true,
    looks: [
      look('#6c7457', 0.12),
      look('#e9dcc0', 0.25),
      look('#74623f', 0.2),
      look('#2c261c', 0.2),
      look('#150f06', 0.9),
      look('#55923a', 0.08),
      look('#8ff0c8', 0.3, { glow: 1.6 }),
      look('#80895f', 0.12),
    ],
  },
  {
    // A fish of the shoal swims by undulating from head to tail; it never stops moving its tail.
    name: 'shoals',
    species: WILD_SPECIES.shoal,
    scale: 1.4,
    stride: 9,
    beat: 8,
    burst: 12,
    fullGait: 3,
    minGait: 0.5,
    tilt: 1,
    dive: 0,
    legs: [0, 0, 0, 0],
    head: [0, 0, 0, 0],
    flight: [0, 0, 0, 0.5],
    swim: [0.045, 3.2, 0, 0],
    pattern: 4,
    twoCoats: true,
    shade: 0.9,
    eyeGlow: '#ff3a1c',
    water: true,
    glass: false,
    shadow: false,
    looks: [
      look('#7f9bab', 0.7),
      look('#e9f0f2', 0.5),
      look('#b8ccd4', 0.4, { alpha: 0.8, thin: 0.8 }),
      look('#22313a', 0.3),
      look('#0b0d12', 0.9),
      look('#c7f4ff', 0.8),
      look('#7f9bab', 0.7),
      look('#6e9a95', 0.7),
    ],
  },
  {
    // The ray glides, its wings rippling from the middle out; it banks into its turns and rears its tail up to sting.
    name: 'rays',
    species: WILD_SPECIES.ray,
    scale: 1,
    stride: 1.4,
    beat: 2.4,
    burst: 2,
    fullGait: 2,
    minGait: 0.7,
    tilt: 1,
    dive: 0,
    legs: [0, 0, 0, 0],
    head: [0, 0, 0, 0],
    flight: [0, 0, 0, 0.6],
    swim: [0.05, 2.4, 0.13, 0],
    pattern: 5,
    twoCoats: true,
    shade: 0.9,
    eyeGlow: '#ff5a22',
    water: true,
    glass: false,
    shadow: false,
    looks: [
      look('#4e606e', 0.4),
      look('#e0e7e5', 0.3),
      look('#7f94a2', 0.3),
      look('#1d282e', 0.3),
      look('#08090c', 0.9),
      look('#a8c0ca', 0.3),
      look('#4e606e', 0.4),
      look('#7b735a', 0.4),
    ],
  },
  {
    // The jelly pulses, a slow squeeze of the bell, and jets away when it is startled. See-through, with a lantern in it.
    name: 'jellies',
    species: WILD_SPECIES.jelly,
    scale: 1,
    stride: 0.8,
    beat: 2.6,
    burst: 5,
    fullGait: 1.5,
    minGait: 1,
    tilt: 0,
    dive: 0,
    legs: [0, 0, 0, 0],
    head: [0, 0, 0, 0],
    flight: [0, 0, 0, 0],
    swim: [0.05, 0, 0, 0.14],
    pattern: 6,
    twoCoats: true,
    shade: 0,
    eyeGlow: '#ff5a22',
    water: true,
    glass: true,
    shadow: false,
    looks: [
      look('#b8a2ff', 0.9, { alpha: 0.42, thin: 1 }),
      look('#f3c8ff', 0.6, { alpha: 0.75, thin: 0.8, glow: 0.25 }),
      look('#9bd2ff', 0.5, { alpha: 0.7, thin: 0.8 }),
      look('#6e55c8', 0.5, { alpha: 0.8 }),
      look('#ffffff', 0.9),
      look('#ffffff', 0.5, { alpha: 0.6 }),
      look('#78e6ff', 0.7, { alpha: 0.95, glow: 2.2 }),
      look('#ffa8d8', 0.9, { alpha: 0.42, thin: 1 }),
    ],
  },
  {
    // The finch beats its wings all the time and banks into its turns.
    name: 'finches',
    species: WILD_SPECIES.finch,
    scale: 1.3,
    stride: 0,
    beat: 38,
    burst: 12,
    fullGait: 4,
    minGait: 1,
    tilt: 1,
    dive: 0,
    legs: [0, 0, 0, 0],
    head: [0, 0, 0, 0],
    flight: [0.9, 0.12, 0.7, 0.55],
    swim: [0, 0, 0, 0],
    pattern: 7,
    twoCoats: false,
    shade: 0.85,
    eyeGlow: '#ff3a1c',
    water: false,
    glass: false,
    shadow: true,
    looks: [
      look('#8c7c55', 0.2),
      look('#e8dcaa', 0.2),
      look('#40372a', 0.2, { thin: 0.5 }),
      look('#4a392b', 0.3),
      look('#0e0905', 0.9),
      look('#efe6c6', 0.2),
      look('#8c7c55', 0.2),
      look('#d8472f', 0.25),
    ],
  },
  {
    // The kite soars on wings it beats slowly, and sweeps them back and drops its nose to dive.
    name: 'kites',
    species: WILD_SPECIES.kite,
    scale: 1,
    stride: 0,
    beat: 7,
    burst: 4,
    fullGait: 4,
    minGait: 1,
    tilt: 1,
    dive: 1.1,
    legs: [0, 0, 0, 0],
    head: [0, 0, 0, 0],
    flight: [0.3, 0.13, 1, 0.7],
    swim: [0, 0, 0, 0],
    pattern: 8,
    twoCoats: true,
    shade: 0.85,
    eyeGlow: '#ff3a1c',
    water: false,
    glass: false,
    shadow: true,
    looks: [
      look('#7d4b2d', 0.22),
      look('#dcc8a2', 0.2),
      look('#3d2d22', 0.25, { thin: 0.4 }),
      look('#241a14', 0.35),
      look('#e7b82a', 0.9),
      look('#d9d0bd', 0.2),
      look('#7d4b2d', 0.22),
      look('#9b6a46', 0.22),
    ],
  },
];

export interface WildlifeRenderer {
  readonly object: Group;
  /** How many triangles one creature of a species has (0 for a species the picture does not know). */
  trianglesOf(species: number): number;
  /** Draws the creatures at these poses, the first `NET.maxWildlife` of them. The poses are read, not kept. */
  update(dt: number, poses: readonly WildPose[]): void;
  /** The creatures on screen now, for tests and the debug hook. */
  list(): {
    id: number;
    kind: number;
    x: number;
    y: number;
    z: number;
    health: number;
    flags: number;
    yaw: number;
    speed: number;
  }[];
  dispose(): void;
}

export interface WildlifeRendererOptions {
  /** The stage's material registry: the creatures are lit by the same sun, shadows and haze as the world. */
  registry: MaterialRegistry;
  /** The height of the lake's surface, which the creatures of the water are tinted by. */
  waterLevel: number;
  /** The most creatures drawn at once; the network never reports more than `NET.maxWildlife`. */
  capacity?: number;
}

/** What the picture keeps for one creature. */
interface Track {
  /** How far its cycle has turned, in radians. */
  phase: number;
  gait: number;
  alarm: number;
  anger: number;
  lunge: number;
  graze: number;
  flash: number;
  appear: number;
  bank: number;
  pitch: number;
  /** Where it was last frame, for its turn and its climb. */
  yaw: number;
  y: number;
  seen: boolean;
}

/** One species' mesh, and the buffers the creatures of that species are written into each frame. */
interface Batch {
  readonly variant: Variant;
  readonly model: BufferGeometry;
  readonly geometry: InstancedBufferGeometry;
  readonly material: ShaderMaterial;
  /** What its shadow is drawn with: the same pose as the body, so the shadow flaps and walks with it. */
  readonly depth: ShaderMaterial | null;
  readonly mesh: Mesh;
  readonly positions: Float32Array;
  readonly datas: Float32Array;
  readonly states: Float32Array;
  readonly moods: Float32Array;
  readonly pos: InstancedBufferAttribute;
  readonly data: InstancedBufferAttribute;
  readonly state: InstancedBufferAttribute;
  readonly mood: InstancedBufferAttribute;
  /** How many creatures of this species are drawn this frame. */
  count: number;
}

const vec4 = (v: Vec4): { value: Vector4 } => ({ value: new Vector4(...v) });

function createBatch(
  variant: Variant,
  registry: MaterialRegistry,
  capacity: number,
  waterLevel: number,
  clock: { value: number },
): Batch {
  const model = buildModel(variant.species);
  if (!model) throw new Error(`There is no model for the ${variant.name}`);
  const geometry = new InstancedBufferGeometry();
  for (const name of ['position', 'normal', 'aPart', 'aHip', 'aAux']) {
    const attribute = model.getAttribute(name);
    if (attribute) geometry.setAttribute(name, attribute);
  }
  geometry.setIndex(model.getIndex());
  const positions = new Float32Array(capacity * 4);
  const datas = new Float32Array(capacity * 4);
  const states = new Float32Array(capacity * 4);
  const moods = new Float32Array(capacity * 4);
  const pos = new InstancedBufferAttribute(positions, 4);
  const data = new InstancedBufferAttribute(datas, 4);
  const state = new InstancedBufferAttribute(states, 4);
  const mood = new InstancedBufferAttribute(moods, 4);
  for (const attribute of [pos, data, state, mood]) attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute('iPos', pos);
  geometry.setAttribute('iData', data);
  geometry.setAttribute('iState', state);
  geometry.setAttribute('iMood', mood);
  geometry.instanceCount = 0;

  // The body and its shadow carry themselves the same way, so they share the numbers.
  const motion = {
    uLegs: vec4(variant.legs),
    uHead: vec4(variant.head),
    uFlight: vec4(variant.flight),
    uSwim: vec4(variant.swim),
    uClock: clock,
  };
  const depth = variant.shadow
    ? new ShaderMaterial({
        vertexShader: WILD_DEPTH_VERTEX,
        fragmentShader: WILD_DEPTH_FRAGMENT,
        uniforms: { ...motion },
      })
    : null;

  const colors: Vector4[] = [];
  const finishes: Vector4[] = [];
  for (let i = 0; i < LOOK_COUNT; i++) {
    const spec = variant.looks[i] as LookSpec;
    const color = new Color(spec.color);
    colors.push(new Vector4(color.r, color.g, color.b, spec.gloss));
    finishes.push(new Vector4(spec.alpha ?? 1, spec.glow ?? 0, spec.thin ?? 0, 0));
  }
  const material = registry.create({
    vertexShader: WILD_VERTEX,
    fragmentShader: WILD_FRAGMENT,
    uniforms: {
      uLook: { value: colors },
      uFinish: { value: finishes },
      uTone: { value: new Vector4(variant.twoCoats ? 1 : 0, variant.shade, variant.pattern, 0) },
      uEyeGlow: { value: new Color(variant.eyeGlow).multiplyScalar(2.6) },
      uWater: { value: new Vector4(waterLevel, 0.55, variant.water ? 1 : 0, 0) },
      ...motion,
    },
    transparent: variant.water,
    depthWrite: !variant.glass,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = variant.name;
  mesh.frustumCulled = false;
  mesh.castShadow = variant.shadow;
  mesh.receiveShadow = true;
  if (depth) mesh.customDepthMaterial = depth;
  if (variant.water) mesh.renderOrder = WATER_ORDER;
  mesh.visible = false;
  return {
    variant,
    model,
    geometry,
    material,
    depth,
    mesh,
    positions,
    datas,
    states,
    moods,
    pos,
    data,
    state,
    mood,
    count: 0,
  };
}

export function createWildlifeRenderer({
  registry,
  waterLevel,
  capacity = NET.maxWildlife,
}: WildlifeRendererOptions): WildlifeRenderer {
  const clock = { value: 0 };
  const batches = VARIANTS.map((variant) =>
    createBatch(variant, registry, capacity, waterLevel, clock),
  );
  const object = new Group();
  object.name = 'wildlife';
  for (const batch of batches) object.add(batch.mesh);

  const tracks = new Map<number, Track>();
  // What the debug list reads: every creature drawn, in the order of the poses, whatever its species.
  const ids = new Int32Array(capacity);
  const kinds = new Uint8Array(capacity);
  const seenAt = new Float32Array(capacity * 4);
  const headingAt = new Float32Array(capacity * 2);
  const flagsAt = new Uint8Array(capacity);
  let shown = 0;

  const follow = (from: number, to: number, rate: number, dt: number): number =>
    from + (to - from) * (1 - Math.exp(-rate * dt));
  const clamp = (value: number, low: number, high: number): number =>
    Math.min(Math.max(value, low), high);

  return {
    object,

    trianglesOf(species) {
      const batch = batches[species];
      return batch ? triangleCount(batch.model) : 0;
    },

    update(dt, poses) {
      const step = Math.min(Math.max(dt, 0), MAX_STEP);
      clock.value = (clock.value + step) % 100000;
      const n = Math.min(poses.length, capacity);
      for (const track of tracks.values()) track.seen = false;
      for (const batch of batches) batch.count = 0;
      shown = 0;
      for (let i = 0; i < n; i++) {
        const pose = poses[i] as WildPose;
        const batch = batches[pose.kind];
        if (!batch) continue;
        const { variant } = batch;
        let track = tracks.get(pose.id);
        if (!track) {
          // Each creature starts its cycle at its own point, so a herd does not step in time.
          const start = ((pose.id * 0.754877) % 1) * Math.PI * 2;
          track = {
            phase: start,
            gait: 0,
            alarm: 0,
            anger: 0,
            lunge: 0,
            graze: 0,
            flash: 0,
            appear: 0,
            bank: 0,
            pitch: 0,
            yaw: pose.yaw,
            y: pose.y,
            seen: true,
          };
          tracks.set(pose.id, track);
        }
        track.seen = true;
        const seed = ((pose.id + 1) * 0.618034) % 1;
        const alarmed = (pose.flags & WILD_FLAG.alarmed) !== 0;
        const angry = (pose.flags & WILD_FLAG.angry) !== 0;
        const striking = (pose.flags & WILD_FLAG.strike) !== 0;

        track.alarm = follow(track.alarm, alarmed ? 1 : 0, alarmed ? ALARM_RISE : ALARM_FALL, step);
        track.anger = follow(track.anger, angry ? 1 : 0, ANGER_FOLLOW, step);
        track.lunge = follow(track.lunge, striking ? 1 : 0, LUNGE_FOLLOW, step);
        track.gait = follow(
          track.gait,
          clamp(pose.speed / variant.fullGait, variant.minGait, 1),
          GAIT_FOLLOW,
          step,
        );
        // The cycle turns as far as it walks, and on its own as well: wings beat, fins sway, a bell pulses.
        track.phase =
          (track.phase +
            (variant.beat + pose.speed * variant.stride + track.alarm * variant.burst) * step) %
          (Math.PI * 200);
        // A creature that is standing about, and not afraid of anything, puts its head down to graze now and then.
        const resting = pose.speed < STANDING && !alarmed && !angry;
        const grazing = Math.sin(clock.value * 0.45 + seed * 20) > 0.25;
        track.graze = follow(track.graze, resting && grazing ? 1 : 0, GRAZE_FOLLOW, step);
        track.flash =
          pose.flags & WILD_FLAG.hurt ? 1 : Math.max(0, track.flash - step / FLASH_FADE);
        track.appear = Math.min(1, track.appear + step / APPEAR_SECONDS);

        // It banks into a turn (a turn to the left is a rise in the heading) and tips with its climb.
        if (step > 0) {
          const turn = Math.atan2(Math.sin(pose.yaw - track.yaw), Math.cos(pose.yaw - track.yaw));
          track.bank = follow(track.bank, clamp((turn / step) * 0.5, -1, 1), BANK_FOLLOW, step);
          const climb = Math.atan2(pose.y - track.y, Math.max(pose.speed * step, 0.02));
          const level = clamp(climb, -0.8, 0.8) * variant.tilt;
          track.pitch = follow(track.pitch, level - variant.dive * track.lunge, PITCH_FOLLOW, step);
        }
        track.yaw = pose.yaw;
        track.y = pose.y;

        const size =
          (1 - SIZE_SPREAD + ((pose.id * 0.618034) % 1) * SIZE_SPREAD * 2) * variant.scale;
        const at = batch.count++;
        batch.positions[at * 4] = pose.x;
        batch.positions[at * 4 + 1] = pose.y;
        batch.positions[at * 4 + 2] = pose.z;
        batch.positions[at * 4 + 3] = seed;
        batch.datas[at * 4] = pose.yaw;
        batch.datas[at * 4 + 1] = size;
        batch.datas[at * 4 + 2] = track.phase;
        batch.datas[at * 4 + 3] = track.gait;
        batch.states[at * 4] = track.flash;
        batch.states[at * 4 + 1] = track.appear * track.appear * (3 - 2 * track.appear);
        batch.states[at * 4 + 2] = track.bank;
        batch.states[at * 4 + 3] = track.pitch;
        batch.moods[at * 4] = track.alarm;
        batch.moods[at * 4 + 1] = track.anger;
        batch.moods[at * 4 + 2] = track.lunge;
        batch.moods[at * 4 + 3] = track.graze;
        ids[shown] = pose.id;
        kinds[shown] = pose.kind;
        seenAt[shown * 4] = pose.x;
        seenAt[shown * 4 + 1] = pose.y;
        seenAt[shown * 4 + 2] = pose.z;
        seenAt[shown * 4 + 3] = pose.health;
        flagsAt[shown] = pose.flags;
        headingAt[shown * 2] = pose.yaw;
        headingAt[shown * 2 + 1] = pose.speed;
        shown++;
      }
      for (const [id, track] of tracks) if (!track.seen) tracks.delete(id);

      for (const batch of batches) {
        batch.geometry.instanceCount = batch.count;
        batch.mesh.visible = batch.count > 0;
        if (batch.count > 0) {
          batch.pos.needsUpdate = true;
          batch.data.needsUpdate = true;
          batch.state.needsUpdate = true;
          batch.mood.needsUpdate = true;
        }
      }
    },

    list() {
      const out: ReturnType<WildlifeRenderer['list']> = [];
      for (let i = 0; i < shown; i++) {
        out.push({
          id: ids[i] as number,
          kind: kinds[i] as number,
          x: seenAt[i * 4] as number,
          y: seenAt[i * 4 + 1] as number,
          z: seenAt[i * 4 + 2] as number,
          health: seenAt[i * 4 + 3] as number,
          flags: flagsAt[i] as number,
          yaw: headingAt[i * 2] as number,
          speed: headingAt[i * 2 + 1] as number,
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
        batch.depth?.dispose();
      }
      tracks.clear();
      shown = 0;
    },
  };
}
