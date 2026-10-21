import { createContacts, moveBody, snapToFloor, type Body } from './collision';
import type { CollisionWorld } from './ground';

/** The player's collision box and eye height, in blocks (1 block = 1 meter). */
export const PLAYER = {
  halfWidth: 0.3,
  height: 1.8,
  eyeHeight: 1.62,
} as const;

/**
 * The body as smooth ground sees it: spheres as wide as the collision box, stacked from the feet
 * to the head. The lowest sits one radius up, so it rests on the surface when the feet do.
 */
export const GROUND_SPHERES = {
  radius: PLAYER.halfWidth,
  heights: [PLAYER.halfWidth, 0.9, 1.5] as readonly number[],
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
  /**
   * How far a body that stood on the terrain, or on cells, is pulled down to keep standing on it.
   * Without it, walking down a slope (or down a roof of wedges) would be a string of tiny falls,
   * with air steering and no friction.
   */
  groundSnap: number;
  /**
   * How high a ledge of cells a grounded body walks up without jumping: a slab (half a block) and
   * every step of a wedge's slope, but not a whole block.
   */
  stepHeight: number;
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
  groundSnap: 0.4,
  stepHeight: 0.6,
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
  world: CollisionWorld,
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

  // A body on the ground walks up a ledge of cells; one in the air has to jump onto it.
  const wasOnGround = state.onGround;
  moveBody(
    state,
    state.vx * dt,
    dy,
    state.vz * dt,
    world,
    contacts,
    wasOnGround ? tuning.stepHeight : 0,
  );

  if (contacts.x) state.vx = 0;
  if (contacts.z) state.vz = 0;

  // The speed the body met the floor at, read before any contact takes it away.
  const fallSpeed = -state.vy;
  let supported = contacts.y && dy < 0;
  if (contacts.y) state.vy = 0;

  // A body that is still rising (a jump that just started, or one skimming a slope) is not
  // standing on anything, and is not pulled down to it.
  const rising = state.vy > 0;
  // Walking down a roof of wedges or a flight of slabs: the floor falls away faster than gravity
  // pulls, so a body that stood on cells a moment ago comes down to the next one. This runs even
  // when the body was resting on a cell at the start of the tick (`supported`), because the sideways
  // move that followed may have carried it past the edge of that cell.
  if (wasOnGround && !rising && snapToFloor(state, tuning.groundSnap, world)) supported = true;

  // Smooth ground pushes the body out of slopes and rock.
  const ground = world.ground;
  if (ground) {
    const touching = ground.pushOut(state, GROUND_SPHERES.radius, GROUND_SPHERES.heights);
    if (!rising) {
      if (touching) supported = true;
      else if (!supported && wasOnGround) {
        supported = ground.snapDown(
          state,
          GROUND_SPHERES.radius,
          PLAYER.halfWidth,
          tuning.groundSnap,
        );
      }
    }
  }

  if (supported) {
    if (!wasOnGround) state.landingSpeed = fallSpeed;
    state.onGround = true;
    state.vy = 0;
  } else {
    state.onGround = false;
  }
}
