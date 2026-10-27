/**
 * Where the intro's camera goes, worked out in the crash site's own terms rather than in the
 * valley's. The film is staged around the path the wreck took, so each shot says "forty meters
 * back along the furrow, twelve to its right, two above the ground" and means the same thing
 * wherever the site sits and whatever the hills do around it. Pure arithmetic: the director gives
 * it the ground and the camera and it hands back a pose.
 */
import type { CameraPose } from './camera-pose';
import { smoothstep01 } from './intro';

/** What the film needs to know about the valley, in meters (x east, z south, y up). */
export interface CrashSite {
  /** Height of the ground at a point. */
  groundAt(x: number, z: number): number;
  /** The middle of the crater, where the wreck came to rest. */
  readonly crater: { readonly x: number; readonly z: number; readonly radius: number };
  /** The furrow the wreck cut, as x, z pairs: the crater end first, the far end last. */
  readonly furrow: readonly (readonly [number, number])[];
  /** Where the player stands when the run begins, and which way they face. */
  readonly spawn: { readonly x: number; readonly z: number };
  /** The heart of the Core, the crystal that glows in the crater: where the film's light comes from once the wreck has opened. */
  readonly core: Point3;
}

/** The crash site's own axes: the origin is the crater, `forward` the way the wreck travelled and `right` to the right of that, seen from above. */
export interface CrashFrame {
  readonly site: CrashSite;
  readonly x: number;
  readonly z: number;
  /** Unit vector of the wreck's last run along the ground, toward the crater. */
  readonly fx: number;
  readonly fz: number;
  /** Unit vector to the right of it (x east, z south, so looking along `forward` the right hand is `(-fz, fx)`). */
  readonly rx: number;
  readonly rz: number;
}

export function createCrashFrame(site: CrashSite): CrashFrame {
  const first = site.furrow[0];
  const last = site.furrow[site.furrow.length - 1];
  if (!first || !last) throw new Error('The furrow has no points');
  const dx = first[0] - last[0];
  const dz = first[1] - last[1];
  const length = Math.hypot(dx, dz) || 1;
  const fx = dx / length;
  const fz = dz / length;
  return { site, x: site.crater.x, z: site.crater.z, fx, fz, rx: -fz, rz: fx };
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** The world point `f` meters forward, `r` to the right and `h` above the ground. */
export function placeInFrame(
  frame: CrashFrame,
  f: number,
  r: number,
  h: number,
  out: Point3,
): Point3 {
  out.x = frame.x + frame.fx * f + frame.rx * r;
  out.z = frame.z + frame.fz * f + frame.rz * r;
  out.y = frame.site.groundAt(out.x, out.z) + h;
  return out;
}

/** The frame's forward and right, back from a point in the valley: `[f, r]` of a world position. */
export function frameCoordinates(frame: CrashFrame, x: number, z: number): [number, number] {
  const dx = x - frame.x;
  const dz = z - frame.z;
  return [dx * frame.fx + dz * frame.fz, dx * frame.rx + dz * frame.rz];
}

/** One stop of a camera: at time `t` it is `at` and looks `look`, in the frame's terms. */
export interface CameraKey {
  /** Seconds into the shot. */
  readonly t: number;
  /** Forward, right, and height above the ground there. */
  readonly at: readonly [number, number, number];
  /** What it looks at, in the same terms. */
  readonly look: readonly [number, number, number];
  /** Vertical field of view in degrees. */
  readonly fov: number;
  /** A tilt of the picture, in degrees. */
  readonly roll?: number;
  /** How far the look point is pulled to the moving subject (the wreck): 0 not at all, 1 all the way. */
  readonly follow?: number;
}

const RADIANS = Math.PI / 180;

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (p2 - p0) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (3 * p1 - p0 - 3 * p2 + p3) * t3)
  );
}

/** Where along the keys `t` falls: the index of the segment's first key and how far through it. */
function locate(keys: readonly CameraKey[], t: number): [number, number] {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) throw new Error('A shot needs at least one key');
  if (t <= first.t) return [0, 0];
  if (t >= last.t) return [keys.length - 1, 0];
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i] as CameraKey;
    const b = keys[i + 1] as CameraKey;
    if (t <= b.t) return [i, (t - a.t) / Math.max(1e-6, b.t - a.t)];
  }
  return [keys.length - 1, 0];
}

/** The key at `i`, held at the ends so a spline through the first and last has neighbors. */
function keyAt(keys: readonly CameraKey[], i: number): CameraKey {
  return keys[Math.min(keys.length - 1, Math.max(0, i))] as CameraKey;
}

/** How a camera sits when a shot has sampled it, before the ground and the subject have a say. */
export interface TrackSample {
  at: [number, number, number];
  look: [number, number, number];
  fov: number;
  roll: number;
  follow: number;
}

export function createTrackSample(): TrackSample {
  return { at: [0, 0, 0], look: [0, 0, 0], fov: 60, roll: 0, follow: 0 };
}

/**
 * The camera between the keys at time `t`: positions, look points and lens go through the keys on
 * a smooth curve (a Catmull-Rom spline, so there is no stop at each key). Before the first key and
 * after the last it holds still.
 */
export function sampleTrack(keys: readonly CameraKey[], t: number, out: TrackSample): TrackSample {
  const [i, u] = locate(keys, t);
  const k0 = keyAt(keys, i - 1);
  const k1 = keyAt(keys, i);
  const k2 = keyAt(keys, i + 1);
  const k3 = keyAt(keys, i + 2);
  for (let axis = 0; axis < 3; axis++) {
    out.at[axis] = catmull(
      k0.at[axis] as number,
      k1.at[axis] as number,
      k2.at[axis] as number,
      k3.at[axis] as number,
      u,
    );
    out.look[axis] = catmull(
      k0.look[axis] as number,
      k1.look[axis] as number,
      k2.look[axis] as number,
      k3.look[axis] as number,
      u,
    );
  }
  out.fov = catmull(k0.fov, k1.fov, k2.fov, k3.fov, u);
  out.roll = catmull(k0.roll ?? 0, k1.roll ?? 0, k2.roll ?? 0, k3.roll ?? 0, u);
  out.follow = catmull(k0.follow ?? 0, k1.follow ?? 0, k2.follow ?? 0, k3.follow ?? 0, u);
  return out;
}

/** The camera never comes closer to the ground than this, whatever a key asks for. */
export const MIN_CLEARANCE = 0.45;

/**
 * Turns a sampled camera into a pose: the position and the look point put into the valley, the
 * look point pulled toward `subject` as far as `follow` says, and the picture aimed.
 */
export function aimTrack(
  frame: CrashFrame,
  sample: TrackSample,
  subject: Point3 | null,
  scratch: { eye: Point3; target: Point3 },
  out: CameraPose,
): CameraPose {
  const { eye, target } = scratch;
  placeInFrame(frame, sample.at[0], sample.at[1], Math.max(MIN_CLEARANCE, sample.at[2]), eye);
  placeInFrame(frame, sample.look[0], sample.look[1], sample.look[2], target);
  if (subject && sample.follow > 0) {
    const w = Math.min(1, Math.max(0, sample.follow));
    target.x += (subject.x - target.x) * w;
    target.y += (subject.y - target.y) * w;
    target.z += (subject.z - target.z) * w;
  }
  return aimAt(eye, target, sample.fov, sample.roll * RADIANS, out);
}

/** A pose at `eye` that looks at `target`. */
export function aimAt(
  eye: Point3,
  target: Point3,
  fov: number,
  roll: number,
  out: CameraPose,
): CameraPose {
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dz = target.z - eye.z;
  out.x = eye.x;
  out.y = eye.y;
  out.z = eye.z;
  out.yaw = Math.atan2(-dx, -dz);
  out.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  out.fov = fov;
  out.roll = roll;
  return out;
}

/** The turn from angle `from` to angle `to` the short way round, in radians. */
export function turnBetween(from: number, to: number): number {
  let turn = (to - from) % (Math.PI * 2);
  if (turn > Math.PI) turn -= Math.PI * 2;
  if (turn < -Math.PI) turn += Math.PI * 2;
  return turn;
}

/**
 * Flies `pose` the fraction `share` of the way to `target`, which at 1 puts it exactly there. The
 * turn goes the short way round, and the ease is the caller's.
 */
export function blendPose(pose: CameraPose, target: CameraPose, share: number): void {
  const w = share < 0 ? 0 : share > 1 ? 1 : share;
  pose.x += (target.x - pose.x) * w;
  pose.y += (target.y - pose.y) * w;
  pose.z += (target.z - pose.z) * w;
  pose.yaw += turnBetween(pose.yaw, target.yaw) * w;
  pose.pitch += (target.pitch - pose.pitch) * w;
  const fov = pose.fov ?? target.fov ?? 60;
  pose.fov = fov + ((target.fov ?? fov) - fov) * w;
  pose.roll = (pose.roll ?? 0) * (1 - w);
}

/**
 * A hand-held shake: a pose displaced by `amount` meters and tilted by up to `amount` degrees,
 * from a few sines that do not line up, so it never settles into a rhythm. `seconds` is any
 * steadily running clock.
 */
export function shakePose(pose: CameraPose, seconds: number, amount: number): void {
  if (amount <= 0) return;
  const a =
    Math.sin(seconds * 37.1) * 0.5 +
    Math.sin(seconds * 23.7 + 1.3) * 0.3 +
    Math.sin(seconds * 61.9 + 2.1) * 0.2;
  const b =
    Math.sin(seconds * 31.3 + 0.7) * 0.5 +
    Math.sin(seconds * 19.1 + 2.9) * 0.3 +
    Math.sin(seconds * 53.3 + 4.2) * 0.2;
  const c = Math.sin(seconds * 29.7 + 3.1) * 0.6 + Math.sin(seconds * 47.3 + 0.3) * 0.4;
  pose.x += a * amount * 0.5;
  pose.y += b * amount * 0.5;
  pose.z += c * amount * 0.5;
  pose.yaw += a * amount * 0.012;
  pose.pitch += b * amount * 0.012;
  pose.roll = (pose.roll ?? 0) + c * amount * 0.02;
}

/** Eases a value on a smooth rise from `from` to `to` over `[start, end]` seconds. */
export function rampBetween(
  time: number,
  start: number,
  end: number,
  from: number,
  to: number,
): number {
  return from + (to - from) * smoothstep01((time - start) / Math.max(1e-6, end - start));
}
