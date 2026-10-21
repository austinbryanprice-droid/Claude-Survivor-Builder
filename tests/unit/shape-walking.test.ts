import { describe, expect, it } from 'vitest';
import { SHAPE, slabShape, wedgeShape } from '../../src/shared/blocks';
import { overlapsSolid } from '../../src/shared/collision';
import { TICK_SECONDS } from '../../src/shared/fixed-step';
import {
  createPlayerState,
  stepPlayer,
  type PlayerInput,
  type PlayerState,
} from '../../src/shared/movement';
import { input, seconds, standingAt } from './helpers';
import { shapeFloor, type ShapeCells } from './helpers/shape-cells';

const PLUS_X = 0;
const EAST = -Math.PI / 2;
const WEST = Math.PI / 2;

/** Runs the player and counts the ticks it spent off the ground, which a walk should never do. */
function walk(
  player: PlayerState,
  playerInput: PlayerInput,
  ticks: number,
  world: ShapeCells,
): { airborne: number; peakStep: number } {
  let airborne = 0;
  let peakStep = 0;
  for (let i = 0; i < ticks; i++) {
    const before = player.y;
    stepPlayer(player, playerInput, TICK_SECONDS, world);
    if (!player.onGround) airborne++;
    peakStep = Math.max(peakStep, Math.abs(player.y - before));
    expect(overlapsSolid(player, world), `tick ${i}`).toBe(false);
  }
  return { airborne, peakStep };
}

/** A ramp of wedges one block wide at x = 2 that rises toward +x, then a platform one block high. */
function rampAndPlatform(): ShapeCells {
  const world = shapeFloor();
  for (let z = 0; z <= 4; z++) world.set(2, 0, z, wedgeShape(PLUS_X));
  world.fillShape(3, 0, 0, 8, 0, 4, SHAPE.cube);
  return world;
}

describe('walking on a ramp of wedges', () => {
  it('walks up to the platform without jumping or leaving the ground', () => {
    const world = rampAndPlatform();
    const player = standingAt(world, 0.5, 2.5);
    const { airborne, peakStep } = walk(
      player,
      input({ forward: 1, yaw: EAST }),
      seconds(1.2),
      world,
    );
    expect(player.onGround).toBe(true);
    expect(player.y).toBeCloseTo(1, 3);
    expect(player.x).toBeGreaterThan(4);
    expect(airborne).toBe(0);
    // A climb is a string of small steps, never a jump of half a block.
    expect(peakStep).toBeLessThan(0.15);
  });

  it('walks up at an angle, and sprints up', () => {
    for (const [yaw, sprint] of [
      [EAST + 0.3, false],
      [EAST - 0.3, false],
      [EAST, true],
    ] as const) {
      const world = rampAndPlatform();
      const player = standingAt(world, 0.5, 2.5);
      const { airborne } = walk(player, input({ forward: 1, yaw, sprint }), seconds(0.9), world);
      expect(player.y, `yaw ${yaw}, sprint ${sprint}`).toBeCloseTo(1, 3);
      expect(airborne, `yaw ${yaw}, sprint ${sprint}`).toBe(0);
    }
  });

  it('walks down again and keeps its feet on the ramp the whole way', () => {
    for (const sprint of [false, true]) {
      const world = rampAndPlatform();
      const player = standingAt(world, 6.5, 2.5, 1);
      expect(player.y).toBeCloseTo(1, 3);
      const { airborne, peakStep } = walk(
        player,
        input({ forward: 1, yaw: WEST, sprint }),
        seconds(1.2),
        world,
      );
      expect(player.y, `sprint ${sprint}`).toBeCloseTo(0, 3);
      expect(player.x).toBeLessThan(2);
      expect(airborne, `sprint ${sprint}`).toBe(0);
      // Sprinting down a slope that falls as fast as it runs drops 0.12 a tick, plus one step of the slope.
      expect(peakStep).toBeLessThan(sprint ? 0.2 : 0.15);
    }
  });

  it('stands still on the slope when no key is held', () => {
    const world = rampAndPlatform();
    const player = standingAt(world, 0.5, 2.5);
    walk(player, input({ forward: 1, yaw: EAST }), seconds(0.45), world);
    expect(player.x).toBeGreaterThan(2);
    expect(player.x).toBeLessThan(3);
    walk(player, input(), seconds(0.3), world);
    const rest = { x: player.x, y: player.y, z: player.z };
    const { airborne } = walk(player, input(), seconds(1), world);
    expect(airborne).toBe(0);
    expect(player.x).toBeCloseTo(rest.x, 6);
    expect(player.y).toBeCloseTo(rest.y, 6);
    expect(player.z).toBeCloseTo(rest.z, 6);
  });

  it('can still jump from the slope', () => {
    const world = rampAndPlatform();
    const player = standingAt(world, 0.5, 2.5);
    walk(player, input({ forward: 1, yaw: EAST }), seconds(0.45), world);
    const base = player.y;
    let peak = base;
    for (let i = 0; i < seconds(0.2); i++) {
      stepPlayer(player, input({ jump: true }), TICK_SECONDS, world);
      peak = Math.max(peak, player.y);
    }
    expect(peak - base).toBeGreaterThan(0.5);
  });
});

describe('walking on slabs', () => {
  it('climbs a staircase of half blocks without jumping', () => {
    const world = shapeFloor();
    // Up half a block at a time: a slab, a cube, a cube with a slab on it, two cubes, two with a slab.
    world.fillShape(2, 0, 0, 2, 0, 4, slabShape(false));
    world.fillShape(3, 0, 0, 3, 0, 4, SHAPE.cube);
    world.fillShape(4, 0, 0, 4, 0, 4, SHAPE.cube);
    world.fillShape(4, 1, 0, 4, 1, 4, slabShape(false));
    world.fillShape(5, 0, 0, 11, 1, 4, SHAPE.cube);
    world.fillShape(6, 2, 0, 11, 2, 4, slabShape(false));
    const player = standingAt(world, 0.5, 2.5);
    const { airborne } = walk(player, input({ forward: 1, yaw: EAST }), seconds(1.8), world);
    expect(player.y).toBeCloseTo(2.5, 3);
    expect(player.x).toBeGreaterThan(6);
    expect(airborne).toBe(0);
  });

  it('is stopped by a whole block, which takes a jump', () => {
    const world = shapeFloor();
    world.fillShape(2, 0, 0, 8, 0, 4, SHAPE.cube);
    const player = standingAt(world, 0.5, 2.5);
    walk(player, input({ forward: 1, yaw: EAST }), seconds(1), world);
    expect(player.x).toBeCloseTo(2 - 0.3, 3);
    expect(player.y).toBeCloseTo(0, 6);

    // Held jump and forward: up and onto it, where it stays once the keys are let go.
    walk(player, input({ forward: 1, yaw: EAST, jump: true }), seconds(0.4), world);
    walk(player, input(), seconds(0.8), world);
    expect(player.onGround).toBe(true);
    expect(player.y).toBeCloseTo(1, 3);
    expect(player.x).toBeGreaterThan(2);
  });

  it('does not step up in the air', () => {
    const world = shapeFloor();
    // A 0.5 high ledge a body can only walk onto from the ground.
    world.fillShape(2, 0, 0, 2, 0, 4, slabShape(false));
    const player = createPlayerState(1.4, 0.2, 2.5);
    player.vx = 4;
    player.onGround = false;
    player.airTime = 1e3;
    stepPlayer(player, input({ forward: 1, yaw: EAST }), TICK_SECONDS, world);
    // Still short of the slab and still above the floor: it had no step to take.
    expect(player.onGround).toBe(false);
    expect(player.y).toBeLessThan(0.2);
    expect(player.y).toBeGreaterThan(0);
  });
});

describe('walking under a roof', () => {
  it('stops where an upside-down wedge brings its slope down to head height', () => {
    const world = shapeFloor();
    for (let z = 0; z <= 4; z++) world.set(2, 1, z, wedgeShape(PLUS_X, true));
    const player = standingAt(world, 0.5, 2.5);
    walk(player, input({ forward: 1, yaw: EAST }), seconds(1), world);
    expect(player.x).toBeCloseTo(2 + 3 / 16 - 0.3, 2);
    expect(player.y).toBeCloseTo(0, 6);
  });

  it('walks under a roof of slabs at a high enough ceiling', () => {
    const world = shapeFloor();
    world.fillShape(2, 2, 0, 6, 2, 4, slabShape(true));
    const player = standingAt(world, 0.5, 2.5);
    walk(player, input({ forward: 1, yaw: EAST }), seconds(1.5), world);
    expect(player.x).toBeGreaterThan(6);
    expect(player.y).toBeCloseTo(0, 6);
  });
});
