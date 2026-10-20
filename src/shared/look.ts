/**
 * View angles in radians. Yaw 0 looks toward -Z and a positive yaw turns left (counterclockwise
 * seen from above); pitch 0 is level and a positive pitch looks up. These match three.js, whose
 * cameras look down -Z with Y up.
 */
export interface LookState {
  yaw: number;
  pitch: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Straight up and down are excluded so the view never flips over the pole. */
export const PITCH_LIMIT = Math.PI / 2 - 0.01;

const TAU = Math.PI * 2;

export function clampPitch(pitch: number): number {
  return Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch));
}

/** Wraps an angle into (-π, π]. */
export function wrapAngle(angle: number): number {
  const wrapped = angle - TAU * Math.floor((angle + Math.PI) / TAU);
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/** The signed turn from one angle to another that takes the short way round, in (-π, π]. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** The unit vector the view points along. */
export function lookDirection(yaw: number, pitch: number, out: Vec3): Vec3 {
  const flat = Math.cos(pitch);
  out.x = -Math.sin(yaw) * flat;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * flat;
  return out;
}

/** The horizontal unit vector to the right of the view. */
export function rightVector(yaw: number, out: Vec3): Vec3 {
  out.x = Math.cos(yaw);
  out.y = 0;
  out.z = -Math.sin(yaw);
  return out;
}
