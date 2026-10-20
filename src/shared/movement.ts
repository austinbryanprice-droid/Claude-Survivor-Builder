import { createContacts, moveBody, type Body } from './collision';
import type { SolidQuery } from './solid';

/** The player's collision box and eye height, in blocks (1 block = 1 meter). */
export const PLAYER = {
  halfWidth: 0.3,
  height: 1.8,
  eyeHeight: 1.62,
} as const;

/** Every number that shapes how movement feels. Speeds are blocks per second. */
export interface MovementTuning {
  walkSpeed: number;
  sprintSpeed: number;
  /** How fast velocity closes on the speed the keys ask for, in blocks per second squared. */
  groundAccel: number;
  /** How fast the player stops when no key is held. */
  groundFriction: number;
  /** Steering in the air is weaker than on the ground, so a jump commits to a direction. */
  airAccel: number;
  airFriction: number;
  gravity: number;
  /** Height reached by a standing jump. One block can be climbed, two cannot. */
  jumpHeight: number;
  maxFallSpeed: number;
  /** How long after walking off an edge a jump still works. */
  coyoteTime: number;
  /** How long before landing a jump press is remembered. */
  jumpBufferTime: number;
}

export const MOVEMENT: MovementTuning = {
  walkSpeed: 4.4,
  sprintSpeed: 7.2,
  groundAccel: 55,
  groundFriction: 65,
  airAccel: 10,
  airFriction: 0,
  gravity: 30,
  jumpHeight: 1.25,
  maxFallSpeed: 55,
  coyoteTime: 0.1,
  jumpBufferTime: 0.12,
};

/** What the player is asking for during one tick. */
export interface PlayerInput {
  /** -1 (backward) to 1 (forward). */
  forward: number;
  /** -1 (left) to 1 (right). */
  strafe: number;
  /** Held, not edge-triggered: holding it jumps again on every landing. */
  jump: boolean;
  sprint: boolean;
  /** View yaw in radians (see look.ts); movement keys are relative to it. */
  yaw: number;
}

export function createPlayerInput(): PlayerInput {
  return { forward: 0, strafe: 0, jump: false, sprint: false, yaw: 0 };
}

export interface PlayerState extends Body {
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  /** Seconds since the feet left the ground; large after a jump so coyote time cannot add a second one. */
  airTime: number;
  /** Seconds left on a remembered jump press. */
  jumpBuffer: number;
  /** True for the tick in which a jump started. */
  jumped: boolean;
  /** Downward speed on the tick the player landed, otherwise 0. */
  landingSpeed: number;
}

export function createPlayerState(x = 0, y = 0, z = 0): PlayerState {
  return {
    x,
    y,
    z,
    halfWidth: PLAYER.halfWidth,
    height: PLAYER.height,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: false,
    airTime: 0,
    jumpBuffer: 0,
    jumped: false,
    landingSpeed: 0,
  };
}

/** Moves the player somewhere else and stops them; they settle onto whatever is below. */
export function teleportPlayer(state: PlayerState, x: number, y: number, z: number): void {
  state.x = x;
  state.y = y;
  state.z = z;
  state.vx = 0;
  state.vy = 0;
  state.vz = 0;
  state.onGround = false;
  state.airTime = 0;
  state.jumpBuffer = 0;
  state.jumped = false;
  state.landingSpeed = 0;
}

/** Launch speed that reaches the tuned jump height under the tuned gravity. */
export function jumpSpeed(tuning: MovementTuning = MOVEMENT): number {
  return Math.sqrt(2 * tuning.gravity * tuning.jumpHeight);
}

export function horizontalSpeed(state: PlayerState): number {
  return Math.sqrt(state.vx * state.vx + state.vz * state.vz);
}

const JUMPED_AIR_TIME = 1e3;
const contacts = createContacts();

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/** Moves the horizontal velocity toward a target by at most `maxDelta`, along the straight line between them. */
function approachHorizontal(
  state: PlayerState,
  targetX: number,
  targetZ: number,
  maxDelta: number,
) {
  const dx = targetX - state.vx;
  const dz = targetZ - state.vz;
  const distance = Math.sqrt(dx * dx + dz * dz);
  if (distance <= maxDelta) {
    state.vx = targetX;
    state.vz = targetZ;
  } else {
    const k = maxDelta / distance;
    state.vx += dx * k;
    state.vz += dz * k;
  }
}

/**
 * Advances one fixed tick of player movement. The caller owns `dt`, which must be the same every
 * tick: the result is then identical on every machine, and the host can replay it to check a client.
 */
export function stepPlayer(
  state: PlayerState,
  input: PlayerInput,
  dt: number,
  world: SolidQuery,
  tuning: MovementTuning = MOVEMENT,
): void {
  state.jumped = false;
  state.landingSpeed = 0;

  // Sideways: close on the velocity the keys ask for. Diagonals are not faster than straight lines.
  const forward = clampUnit(input.forward);
  const strafe = clampUnit(input.strafe);
  const asked = Math.sqrt(forward * forward + strafe * strafe);
  let targetX = 0;
  let targetZ = 0;
  if (asked > 0) {
    const scale = (input.sprint ? tuning.sprintSpeed : tuning.walkSpeed) / Math.max(1, asked);
    const sin = Math.sin(input.yaw);
    const cos = Math.cos(input.yaw);
    // Forward is (-sin, -cos) and right is (cos, -sin) in the x and z plane.
    targetX = (-sin * forward + cos * strafe) * scale;
    targetZ = (-cos * forward - sin * strafe) * scale;
  }
  const rate =
    asked > 0
      ? state.onGround
        ? tuning.groundAccel
        : tuning.airAccel
      : state.onGround
        ? tuning.groundFriction
        : tuning.airFriction;
  approachHorizontal(state, targetX, targetZ, rate * dt);

  // Jump: remember a press briefly, and allow it briefly after leaving an edge.
  state.airTime = state.onGround ? 0 : state.airTime + dt;
  state.jumpBuffer = input.jump ? tuning.jumpBufferTime : Math.max(0, state.jumpBuffer - dt);
  if (state.jumpBuffer > 0 && state.airTime <= tuning.coyoteTime && state.vy <= 0) {
    state.vy = jumpSpeed(tuning);
    state.jumpBuffer = 0;
    state.airTime = JUMPED_AIR_TIME;
    state.onGround = false;
    state.jumped = true;
  }

  // Gravity, integrated exactly for constant acceleration so jump height does not depend on dt.
  const startVy = state.vy;
  state.vy = Math.max(-tuning.maxFallSpeed, state.vy - tuning.gravity * dt);
  const dy = (startVy + state.vy) * 0.5 * dt;

  const wasOnGround = state.onGround;
  moveBody(state, state.vx * dt, dy, state.vz * dt, world, contacts);

  if (contacts.x) state.vx = 0;
  if (contacts.z) state.vz = 0;
  if (contacts.y) {
    if (dy < 0) {
      if (!wasOnGround) state.landingSpeed = -state.vy;
      state.onGround = true;
    } else {
      state.onGround = false;
    }
    state.vy = 0;
  } else {
    state.onGround = false;
  }
}
