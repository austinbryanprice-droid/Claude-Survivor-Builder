import { TICK_SECONDS } from '../shared/fixed-step';
import type { LookState } from '../shared/look';
import type { PlayerInput } from '../shared/movement';
import type { CameraMode } from './camera-rig';

/**
 * The benchmark flythrough, as a function of how far through the run it is. It walks and then
 * sprints in circles in the open middle of the deck, switches to third person, hops, and ends
 * with a slow look around that sweeps the sky and the ground. Time is counted in simulation
 * ticks, never in wall-clock time, so a slow machine runs exactly the same route as a fast one.
 */

const WALK_TURN = 1.3;
const SPRINT_TURN = 1.8;
const LOOK_AROUND_TURN = 0.8;

/** Writes the input for one tick and updates the view angles. Returns the camera mode to be in. */
export function driveBenchTick(
  tick: number,
  totalTicks: number,
  input: PlayerInput,
  look: LookState,
): CameraMode {
  const progress = tick / totalTicks;
  const seconds = tick * TICK_SECONDS;
  input.forward = 0;
  input.strafe = 0;
  input.jump = false;
  input.sprint = false;

  let mode: CameraMode = 'first';
  if (progress < 0.25) {
    input.forward = 1;
    look.yaw += WALK_TURN * TICK_SECONDS;
    look.pitch = 0.12 * Math.sin(seconds * 0.8);
  } else if (progress < 0.5) {
    input.forward = 1;
    input.sprint = true;
    look.yaw += SPRINT_TURN * TICK_SECONDS;
    look.pitch = 0.15 * Math.sin(seconds * 0.8);
  } else if (progress < 0.8) {
    mode = 'third';
    input.forward = 1;
    input.sprint = true;
    input.jump = tick % 120 < 3;
    look.yaw += SPRINT_TURN * TICK_SECONDS;
    look.pitch = 0.15 * Math.sin(seconds * 0.8);
  } else {
    mode = progress < 0.9 ? 'third' : 'first';
    look.yaw += LOOK_AROUND_TURN * TICK_SECONDS;
    look.pitch = 0.5 * Math.sin(seconds * 1.1);
  }
  input.yaw = look.yaw;
  return mode;
}
