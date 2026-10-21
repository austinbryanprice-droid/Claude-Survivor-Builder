import { describe, expect, it } from 'vitest';
import { TICK_SECONDS } from '../../src/shared/fixed-step';
import {
  MOVEMENT,
  createPlayerState,
  jumpSpeed,
  stepPlayer,
  type PlayerState,
} from '../../src/shared/movement';
import { SparseCells } from '../../src/shared/solid';
import { WALKABLE_NORMAL_Y } from '../../src/world/terrain/collision';
import { input, run, seconds } from './helpers';
import { groundWorld, tiltedPlane } from './helpers/ground';
import { valley } from './helpers/valley';

/** Yaw that walks toward -x (downhill on a tilted plane), then toward +x. */
const WEST = Math.PI / 2;
const EAST = -Math.PI / 2;

/** A player standing still on the plane at x = 0. */
function standingOnPlane(angle: number): {
  player: PlayerState;
  world: ReturnType<typeof groundWorld>;
} {
  const world = groundWorld(tiltedPlane(angle));
  const player = createPlayerState(0, 0.05, 0);
  run(player, input(), seconds(1), world);
  return { player, world };
}

/** Counts the ticks the player is airborne while the same input is held. */
function airborneTicks(
  player: PlayerState,
  world: ReturnType<typeof groundWorld>,
  yaw: number,
  ticks: number,
  tuning = MOVEMENT,
): number {
  let airborne = 0;
  const walk = input({ forward: 1, yaw });
  for (let i = 0; i < ticks; i++) {
    stepPlayer(player, walk, TICK_SECONDS, world, tuning);
    if (!player.onGround) airborne++;
  }
  return airborne;
}

describe('standing on smooth ground', () => {
  it('lands on flat ground and rests with the feet on the surface', () => {
    const world = groundWorld(tiltedPlane(0));
    const player = createPlayerState(0, 3, 0);
    run(player, input(), seconds(2), world);
    expect(player.onGround).toBe(true);
    expect(player.y).toBeCloseTo(0, 3);
    expect(player.vy).toBe(0);
  });

  it('rests on a gentle slope without sliding down it', () => {
    const { player } = standingOnPlane(0.4);
    const start = { x: player.x, y: player.y };
    run(player, input(), seconds(2), groundWorld(tiltedPlane(0.4)));
    expect(player.onGround).toBe(true);
    expect(Math.abs(player.x - start.x)).toBeLessThan(0.01);
    expect(Math.abs(player.y - start.y)).toBeLessThan(0.01);
  });

  it('cannot stand on a slope steeper than the walkable limit, and slides down it', () => {
    const steep = Math.acos(WALKABLE_NORMAL_Y - 0.05);
    const world = groundWorld(tiltedPlane(steep));
    const player = createPlayerState(0, 0.05, 0);
    run(player, input(), seconds(2), world);
    expect(player.onGround).toBe(false);
    expect(player.x).toBeLessThan(-0.5);
  });
});

describe('walking over smooth ground', () => {
  it('stays on the ground all the way down a slope', () => {
    const { player, world } = standingOnPlane(0.45);
    const airborne = airborneTicks(player, world, WEST, seconds(3));
    expect(player.x).toBeLessThan(-10);
    expect(airborne).toBe(0);
    expect(player.vy).toBe(0);
  });

  it('would be a string of small falls without the pull onto the ground', () => {
    const { player, world } = standingOnPlane(0.45);
    const airborne = airborneTicks(player, world, WEST, seconds(3), { ...MOVEMENT, groundSnap: 0 });
    expect(airborne).toBeGreaterThan(seconds(3) / 2);
  });

  it('walks up a slope at full speed and does not take off at the top', () => {
    const { player, world } = standingOnPlane(0.45);
    const airborne = airborneTicks(player, world, EAST, seconds(3));
    expect(player.x).toBeGreaterThan(10);
    expect(airborne).toBe(0);
    expect(Math.hypot(player.vx, player.vz)).toBeCloseTo(MOVEMENT.walkSpeed, 2);
  });

  it('does not climb a wall of ground that is too steep to stand on', () => {
    const steep = Math.acos(WALKABLE_NORMAL_Y - 0.1);
    const world = groundWorld(tiltedPlane(steep));
    const player = createPlayerState(-4, -4 * Math.tan(steep) + 0.05, 0);
    run(player, input(), seconds(1), world);
    const before = player.x;
    run(player, input({ forward: 1, yaw: EAST, sprint: true }), seconds(3), world);
    expect(player.x - before).toBeLessThan(3);
  });

  it('jumps as high from a slope as from flat ground', () => {
    const { player, world } = standingOnPlane(0.45);
    const start = player.y;
    const { peakY } = run(player, input({ jump: true }), seconds(1), world);
    expect(peakY - start).toBeGreaterThan(MOVEMENT.jumpHeight * 0.9);
    expect(peakY - start).toBeLessThan(MOVEMENT.jumpHeight * 1.1);
    expect(jumpSpeed()).toBeGreaterThan(0);
  });

  it('is stopped by the wall around the world', () => {
    const world = groundWorld(tiltedPlane(0), 10);
    const player = createPlayerState(0, 0.05, 0);
    run(player, input({ forward: 1, yaw: EAST, sprint: true }), seconds(4), world);
    expect(player.x).toBeCloseTo(10, 3);
    expect(player.vx).toBe(0);
  });
});

describe('terrain and cells together', () => {
  it('is stopped by a block on the ground, and climbs it with a jump', () => {
    const cells = new SparseCells();
    cells.fillBox(4, 0, -3, 9, 0, 3);
    const world = groundWorld(tiltedPlane(0), 1000, cells);
    const player = createPlayerState(0, 0.05, 0);
    run(player, input(), seconds(0.5), world);

    run(player, input({ forward: 1, yaw: EAST }), seconds(2), world);
    expect(player.x).toBeCloseTo(4 - player.halfWidth, 2);
    expect(player.y).toBeCloseTo(0, 3);

    // One hop from the face of the block, then walk on and settle on top of it.
    run(player, input({ forward: 1, yaw: EAST, jump: true }), seconds(0.2), world);
    run(player, input({ forward: 1, yaw: EAST }), seconds(0.4), world);
    expect(player.x).toBeGreaterThan(4.3);
    expect(player.y).toBeCloseTo(1, 3);
    expect(player.onGround).toBe(true);
  });

  it('stands on a block built over a slope, and lands on the slope when it is gone', () => {
    const cells = new SparseCells();
    cells.set(0, 2, 0);
    const world = groundWorld(tiltedPlane(0.3), 1000, cells);
    const player = createPlayerState(0.5, 4, 0.5);
    run(player, input(), seconds(2), world);
    expect(player.y).toBeCloseTo(3, 3);
    expect(player.onGround).toBe(true);

    cells.set(0, 2, 0, 0);
    run(player, input(), seconds(2), world);
    expect(player.onGround).toBe(true);
    expect(player.y).toBeLessThan(1);
  });
});

describe('walking the real valley', () => {
  it('drops from above the spawn onto the ground and stays there', () => {
    const { grid } = valley();
    const world = groundWorld(grid, 95);
    const player = createPlayerState(12, grid.groundAt(12, 7) + 4, 7);
    run(player, input(), seconds(3), world);
    expect(player.onGround).toBe(true);
    expect(Math.abs(player.y - grid.groundAt(12, 7))).toBeLessThan(0.25);
  });

  it('follows the ground from the lake shore to the crash site, never sinking into it', () => {
    const { grid } = valley();
    const world = groundWorld(grid, 95);
    const from = { x: 12, z: 7 };
    const to = { x: -2, z: -4 };
    const player = createPlayerState(from.x, grid.groundAt(from.x, from.z) + 0.05, from.z);
    run(player, input(), seconds(1), world);
    const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
    const walk = input({ forward: 1, yaw, sprint: true });
    let lowest = Infinity;
    let airborne = 0;
    for (let i = 0; i < seconds(2.4); i++) {
      stepPlayer(player, walk, TICK_SECONDS, world);
      lowest = Math.min(lowest, player.y - grid.groundAt(player.x, player.z));
      if (!player.onGround) airborne++;
    }
    expect(Math.hypot(player.x - from.x, player.z - from.z)).toBeGreaterThan(14);
    expect(lowest).toBeGreaterThan(-0.35);
    expect(airborne).toBeLessThan(seconds(0.4));
  });
});
