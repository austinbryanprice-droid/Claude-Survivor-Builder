import { describe, expect, it } from 'vitest';
import { TICK_SECONDS, createFixedStepper } from '../../src/shared/fixed-step';
import {
  MOVEMENT,
  createPlayerState,
  horizontalSpeed,
  jumpSpeed,
  stepPlayer,
  teleportPlayer,
  type PlayerState,
} from '../../src/shared/movement';
import { SparseCells } from '../../src/shared/solid';
import { flatWorld, input, run, seconds, standingAt } from './helpers';

const EAST = -Math.PI / 2;
const WEST = Math.PI / 2;
const SOUTH = Math.PI;

describe('standing and walking', () => {
  it('settles on the floor and stays put', () => {
    const world = flatWorld();
    const player = createPlayerState(0.5, 0.4, 0.5);
    run(player, input(), seconds(2), world);
    expect(player.onGround).toBe(true);
    expect(player.y).toBeCloseTo(0, 3);
    expect(horizontalSpeed(player)).toBe(0);
    expect(player.vy).toBe(0);
  });

  it('walks forward (toward -z at yaw 0) and reaches walking speed after a few ticks', () => {
    const world = flatWorld();
    const player = standingAt(world);
    const walk = input({ forward: 1 });
    run(player, walk, 4, world);
    expect(horizontalSpeed(player)).toBeLessThan(MOVEMENT.walkSpeed);
    run(player, walk, 1, world);
    expect(horizontalSpeed(player)).toBeCloseTo(MOVEMENT.walkSpeed, 9);
    run(player, walk, seconds(1) - 5, world);
    expect(player.z).toBeLessThan(0.5 - 4);
    expect(player.z).toBeGreaterThan(0.5 - 4.4);
    expect(player.x).toBeCloseTo(0.5, 6);
  });

  it('sprints faster than it walks', () => {
    const world = flatWorld();
    const player = standingAt(world);
    run(player, input({ forward: 1, sprint: true }), seconds(0.5), world);
    expect(horizontalSpeed(player)).toBeCloseTo(MOVEMENT.sprintSpeed, 9);
  });

  it('is no faster on a diagonal than in a straight line', () => {
    const world = flatWorld();
    const player = standingAt(world);
    run(player, input({ forward: 1, strafe: 1 }), seconds(0.5), world);
    expect(horizontalSpeed(player)).toBeCloseTo(MOVEMENT.walkSpeed, 9);
  });

  it('treats keys as relative to the view yaw', () => {
    const world = flatWorld();
    const cases: [number, number, number, 'x' | 'z', 1 | -1][] = [
      [0, 1, 0, 'z', -1],
      [SOUTH, 1, 0, 'z', 1],
      [EAST, 1, 0, 'x', 1],
      [WEST, 1, 0, 'x', -1],
      [0, 0, 1, 'x', 1],
      [0, 0, -1, 'x', -1],
      [0, -1, 0, 'z', 1],
    ];
    for (const [yaw, forward, strafe, axis, sign] of cases) {
      const player = standingAt(world, 0.5, 0.5);
      run(player, input({ yaw, forward, strafe }), seconds(0.3), world);
      const moved = axis === 'x' ? player.x - 0.5 : player.z - 0.5;
      const other = axis === 'x' ? player.z - 0.5 : player.x - 0.5;
      expect(Math.sign(moved)).toBe(sign);
      expect(Math.abs(other)).toBeLessThan(1e-6);
    }
  });

  it('stops quickly and cleanly when the keys are released', () => {
    const world = flatWorld();
    const player = standingAt(world);
    run(player, input({ forward: 1, sprint: true }), seconds(1), world);
    const before = player.z;
    run(player, input(), 7, world);
    expect(horizontalSpeed(player)).toBe(0);
    const slide = before - player.z;
    expect(slide).toBeGreaterThan(0.2);
    expect(slide).toBeLessThan(0.7);
  });

  it('slows from a sprint to a walk when sprint is released with the keys still held', () => {
    const world = flatWorld();
    const player = standingAt(world);
    run(player, input({ forward: 1, sprint: true }), seconds(0.5), world);
    run(player, input({ forward: 1 }), seconds(0.5), world);
    expect(horizontalSpeed(player)).toBeCloseTo(MOVEMENT.walkSpeed, 9);
  });

  it('stops against a wall but keeps the speed along it', () => {
    const world = flatWorld();
    world.fillBox(4, 0, -30, 4, 3, 30);
    const player = standingAt(world, 0.5, 0.5);
    run(player, input({ yaw: EAST, forward: 1, strafe: 1 }), seconds(2), world);
    expect(player.x + 0.3).toBeLessThan(4);
    expect(player.x + 0.3).toBeGreaterThan(3.99);
    expect(player.vx).toBe(0);
    expect(player.vz).toBeGreaterThan(2);
  });
});

describe('jumping', () => {
  it('rises the tuned height and comes back down', () => {
    const world = flatWorld();
    const player = standingAt(world);
    stepPlayer(player, input({ jump: true }), TICK_SECONDS, world);
    expect(player.jumped).toBe(true);
    expect(player.onGround).toBe(false);
    let peak = player.y;
    let ticks = 1;
    while (!player.onGround && ticks < 200) {
      stepPlayer(player, input(), TICK_SECONDS, world);
      peak = Math.max(peak, player.y);
      ticks++;
    }
    expect(peak).toBeGreaterThan(MOVEMENT.jumpHeight - 0.03);
    expect(peak).toBeLessThanOrEqual(MOVEMENT.jumpHeight + 1e-9);
    // Up and down take about 2 * v / g seconds.
    const expected = (2 * jumpSpeed()) / MOVEMENT.gravity / TICK_SECONDS;
    expect(Math.abs(ticks - expected)).toBeLessThanOrEqual(2);
    expect(player.y).toBeCloseTo(0, 3);
  });

  it('reaches the same height whatever the tick length', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 120, 1 / 240]) {
      const world = flatWorld();
      const player = standingAt(world);
      let peak = 0;
      stepPlayer(player, input({ jump: true }), dt, world);
      for (let i = 0; i < 4 / dt && !player.onGround; i++) {
        stepPlayer(player, input(), dt, world);
        peak = Math.max(peak, player.y);
      }
      expect(Math.abs(peak - MOVEMENT.jumpHeight)).toBeLessThan(0.08);
    }
  });

  it('climbs a one-block ledge but not a two-block one', () => {
    const climb = flatWorld();
    climb.fillBox(3, 0, -4, 40, 0, 4);
    const player = standingAt(climb, 0.5, 0.5);
    run(player, input({ yaw: EAST, forward: 1, jump: true }), seconds(3), climb);
    run(player, input(), seconds(1), climb);
    expect(player.x).toBeGreaterThan(3.5);
    expect(player.y).toBeCloseTo(1, 3);
    expect(player.onGround).toBe(true);

    const wall = flatWorld();
    wall.fillBox(3, 0, -4, 40, 1, 4);
    const blocked = standingAt(wall, 0.5, 0.5);
    const { peakY } = run(blocked, input({ yaw: EAST, forward: 1, jump: true }), seconds(4), wall);
    expect(blocked.x + 0.3).toBeLessThan(3);
    expect(peakY).toBeLessThan(MOVEMENT.jumpHeight + 1e-9);
  });

  it('bonks its head on a low ceiling and falls back', () => {
    const world = flatWorld();
    world.fillBox(-2, 2, -2, 2, 2, 2);
    const player = standingAt(world);
    const { peakY } = run(player, input({ jump: true }), seconds(1), world);
    expect(peakY).toBeLessThan(2 - 1.8 + 1e-9);
    expect(player.y).toBeLessThan(0.21);
  });

  it('keeps hopping while jump is held and jumps once per press otherwise', () => {
    const world = flatWorld();
    const held = standingAt(world);
    let jumps = 0;
    for (let i = 0; i < seconds(3); i++) {
      stepPlayer(held, input({ jump: true }), TICK_SECONDS, world);
      if (held.jumped) jumps++;
    }
    expect(jumps).toBeGreaterThanOrEqual(4);

    const tapped = standingAt(world);
    let taps = 0;
    for (let i = 0; i < seconds(3); i++) {
      stepPlayer(tapped, input({ jump: i === 0 }), TICK_SECONDS, world);
      if (tapped.jumped) taps++;
    }
    expect(taps).toBe(1);
  });

  it('does not allow a second jump in the air', () => {
    const world = flatWorld();
    const player = standingAt(world);
    stepPlayer(player, input({ jump: true }), TICK_SECONDS, world);
    let extra = 0;
    for (let i = 0; i < 30; i++) {
      stepPlayer(player, input({ jump: i % 2 === 0 }), TICK_SECONDS, world);
      if (player.jumped && !player.onGround) extra++;
      if (player.onGround) break;
    }
    expect(extra).toBe(0);
  });

  it('forgives a jump pressed just after running off an edge, but not long after', () => {
    const edge = new SparseCells();
    edge.fillBox(-30, -1, -30, -1, -1, 30);
    const walkOff = (lateTicks: number): boolean => {
      const player = createPlayerState(-3.5, 0, 0.5);
      run(player, input(), 5, edge);
      const walk = input({ yaw: EAST, forward: 1 });
      let guard = 0;
      while (player.onGround && guard++ < 300) stepPlayer(player, walk, TICK_SECONDS, edge);
      for (let i = 0; i < lateTicks; i++) stepPlayer(player, walk, TICK_SECONDS, edge);
      stepPlayer(player, input({ yaw: EAST, forward: 1, jump: true }), TICK_SECONDS, edge);
      return player.jumped;
    };
    expect(walkOff(0)).toBe(true);
    expect(walkOff(3)).toBe(true);
    expect(walkOff(9)).toBe(false);
  });

  it('remembers a jump pressed just before landing', () => {
    const world = flatWorld();
    const attempt = (bufferTime: number): boolean => {
      const player = createPlayerState(0.5, 0.5, 0.5);
      const tuning = { ...MOVEMENT, jumpBufferTime: bufferTime };
      let jumped = false;
      for (let i = 0; i < 30; i++) {
        stepPlayer(player, input({ jump: i === 6 }), TICK_SECONDS, world, tuning);
        jumped ||= player.jumped;
      }
      return jumped;
    };
    expect(attempt(MOVEMENT.jumpBufferTime)).toBe(true);
    expect(attempt(0)).toBe(false);
  });

  it('commits to a jump: it steers slowly in the air', () => {
    const world = flatWorld();
    const player = standingAt(world);
    run(player, input({ forward: 1, sprint: true }), seconds(0.5), world);
    stepPlayer(player, input({ forward: 1, sprint: true, jump: true }), TICK_SECONDS, world);
    const before = player.vz;
    run(player, input({ forward: -1 }), seconds(0.3), world);
    const change = player.vz - before;
    expect(change).toBeCloseTo(MOVEMENT.airAccel * 0.3, 1);
    expect(player.vz).toBeLessThan(0);
  });

  it('carries the distance the tuning promises on a standing, walking and sprinting jump', () => {
    const jumpDistance = (sprint: boolean): number => {
      const world = flatWorld();
      const player = standingAt(world, 0.5, 0.5);
      const go = input({ yaw: EAST, forward: 1, sprint });
      run(player, go, seconds(0.5), world);
      const takeoff = player.x;
      stepPlayer(player, { ...go, jump: true }, TICK_SECONDS, world);
      let guard = 0;
      while (!player.onGround && guard++ < 200) stepPlayer(player, go, TICK_SECONDS, world);
      return player.x - takeoff;
    };
    expect(jumpDistance(false)).toBeGreaterThan(2.2);
    expect(jumpDistance(false)).toBeLessThan(2.8);
    expect(jumpDistance(true)).toBeGreaterThan(3.8);
    expect(jumpDistance(true)).toBeLessThan(4.5);
  });
});

describe('falling', () => {
  it('stops accelerating at the terminal speed', () => {
    const air = new SparseCells();
    const player = createPlayerState(0.5, 100, 0.5);
    run(player, input(), seconds(3), air);
    expect(player.vy).toBe(-MOVEMENT.maxFallSpeed);
  });

  it('reports the landing speed once, on the tick of the landing', () => {
    const world = flatWorld();
    const player = createPlayerState(0.5, 5, 0.5);
    const reports: number[] = [];
    for (let i = 0; i < seconds(2); i++) {
      stepPlayer(player, input(), TICK_SECONDS, world);
      if (player.landingSpeed > 0) reports.push(player.landingSpeed);
    }
    expect(reports).toHaveLength(1);
    expect(reports[0]).toBeGreaterThan(Math.sqrt(2 * MOVEMENT.gravity * 5) - 0.7);
    expect(reports[0]).toBeLessThan(Math.sqrt(2 * MOVEMENT.gravity * 5) + 0.7);
  });

  it('can be moved elsewhere and starts from rest', () => {
    const world = flatWorld();
    const player = standingAt(world);
    run(player, input({ forward: 1 }), seconds(0.5), world);
    teleportPlayer(player, 10.5, 3, -4.5);
    expect([player.x, player.y, player.z, player.vx, player.vy, player.vz]).toEqual([
      10.5, 3, -4.5, 0, 0, 0,
    ]);
    run(player, input(), seconds(1), world);
    expect(player.y).toBeCloseTo(0, 3);
  });
});

describe('doorways', () => {
  it('walks through a doorway one block wide and two high', () => {
    const world = flatWorld();
    world.fillBox(5, 0, -6, 5, 3, 6);
    world.clearBox(5, 0, 0, 5, 1, 0);
    const player = standingAt(world, 1.5, 0.5);
    run(player, input({ yaw: EAST, forward: 1 }), seconds(2), world);
    expect(player.x).toBeGreaterThan(8);
  });

  it('cannot get through a slot one block high', () => {
    const world = flatWorld();
    world.fillBox(5, 0, -6, 5, 3, 6);
    world.clearBox(5, 0, 0, 5, 0, 0);
    const player = standingAt(world, 1.5, 0.5);
    run(player, input({ yaw: EAST, forward: 1 }), seconds(2), world);
    expect(player.x + 0.3).toBeLessThan(5);
  });
});

describe('frame pacing', () => {
  function script(tick: number) {
    return input({
      forward: tick % 200 < 150 ? 1 : 0,
      strafe: tick % 90 < 20 ? 1 : 0,
      sprint: tick > 120,
      jump: tick % 75 < 3,
      yaw: tick * 0.011,
    });
  }

  function simulate(frameSeconds: (frame: number) => number): PlayerState {
    const world = flatWorld();
    world.fillBox(6, 0, -9, 6, 2, 9);
    world.fillBox(-6, 0, -9, -6, 0, 9);
    const player = createPlayerState(0.5, 0, 0.5);
    const stepper = createFixedStepper();
    let tick = 0;
    for (let frame = 0; tick < 900; frame++) {
      const ticks = stepper.advance(frameSeconds(frame));
      for (let i = 0; i < ticks && tick < 900; i++, tick++) {
        stepPlayer(player, script(tick), TICK_SECONDS, world);
      }
    }
    return player;
  }

  it('lands on exactly the same state at 30, 60, 75, 144 and 240 frames per second, steady or jittery', () => {
    const reference = simulate(() => 1 / 60);
    expect(horizontalSpeed(reference)).toBeGreaterThan(1);
    const patterns: ((frame: number) => number)[] = [
      () => 1 / 30,
      () => 1 / 75,
      () => 1 / 144,
      () => 1 / 240,
      (frame) => (frame % 2 === 0 ? 0.009 : 0.0237),
      (frame) => 0.004 + ((frame * 7919) % 31) / 1000,
    ];
    for (const pattern of patterns) expect(simulate(pattern)).toEqual(reference);
  });
});
