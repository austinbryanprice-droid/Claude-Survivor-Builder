/**
 * A camera placement: where it is and where it looks. Angles follow `look.ts`, in radians: yaw 0
 * looks toward -z and a positive yaw turns left, a positive pitch looks up.
 */
export interface CameraPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Vertical field of view in degrees, when the pose sets one. */
  fov?: number;
  /** A tilt of the picture about the line of sight, in radians (a cinematic's shake and dutch angles); level when absent. */
  roll?: number;
}

/** A path for the camera to fly. `sample(0)` is where it starts and `sample(1)` where it ends. */
export interface CameraRoute {
  sample(fraction: number, out: CameraPose): CameraPose;
}
