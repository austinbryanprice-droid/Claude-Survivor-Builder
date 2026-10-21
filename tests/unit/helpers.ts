import { TICK_SECONDS } from '../../src/shared/fixed-step';
import {
  createPlayerInput,
  createPlayerState,
  stepPlayer,
  type MovementTuning,
  type PlayerInput,
  type PlayerState,
} from '../../src/shared/movement';
import type { CollisionWorld } from '../../src/shared/ground';
import { SparseCells } from '../../src/shared/solid';

/** A big flat floor whose top surface is at y = 0. */
export function flatWorld(): SparseCells {
  const world = new SparseCells();
  world.fillBox(-64, -1, -64, 63, -1, 63);
  return world;
}

export function input(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return { ...createPlayerInput(), ...overrides };
}

/** A player standing on the floor at the center of cell (x, z), already settled. */
export function standingAt(world: CollisionWorld, x = 0.5, z = 0.5, y = 0): PlayerState {
  const state = createPlayerState(x, y, z);
  run(state, input(), 5, world);
  return state;
}

/** Runs `ticks` fixed ticks of the same input. Returns the highest feet position reached. */
export function run(
  state: PlayerState,
  playerInput: PlayerInput,
  ticks: number,
  world: CollisionWorld,
  tuning?: MovementTuning,
): { peakY: number } {
  let peakY = state.y;
  for (let i = 0; i < ticks; i++) {
    stepPlayer(state, playerInput, TICK_SECONDS, world, tuning);
    peakY = Math.max(peakY, state.y);
  }
  return { peakY };
}

export function seconds(value: number): number {
  return Math.round(value / TICK_SECONDS);
}
