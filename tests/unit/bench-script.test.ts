import { describe, expect, it } from 'vitest';
import { driveBenchTick } from '../../src/engine/bench-script';
import type { CameraMode } from '../../src/engine/camera-rig';
import { CLEAR_RADIUS, SPAWN, buildProvingGround } from '../../src/engine/proving-ground-layout';
import { TICK_RATE, TICK_SECONDS } from '../../src/shared/fixed-step';
import type { LookState } from '../../src/shared/look';
import {
  createPlayerInput,
  createPlayerState,
  horizontalSpeed,
  stepPlayer,
} from '../../src/shared/movement';

interface Flight {
  modes: CameraMode[];
  jumps: boolean[];
  maxDistance: number;
  pathLength: number;
  airTicks: number;
  stalledTicks: number;
  final: { x: number; y: number; z: number; yaw: number };
}

/** Plays the whole benchmark route on the real proving ground, one tick at a time. */
function fly(totalTicks: number): Flight {
  const world = buildProvingGround();
  const player = createPlayerState(SPAWN.x, SPAWN.y, SPAWN.z);
  const look: LookState = { yaw: SPAWN.yaw, pitch: 0 };
  const input = createPlayerInput();
  const flight: Flight = {
    modes: [],
    jumps: [],
    maxDistance: 0,
    pathLength: 0,
    airTicks: 0,
    stalledTicks: 0,
    final: { x: 0, y: 0, z: 0, yaw: 0 },
  };
  for (let tick = 0; tick < totalTicks; tick++) {
    flight.modes.push(driveBenchTick(tick, totalTicks, input, look));
    flight.jumps.push(input.jump);
    const x = player.x;
    const z = player.z;
    stepPlayer(player, input, TICK_SECONDS, world);
    flight.pathLength += Math.hypot(player.x - x, player.z - z);
    flight.maxDistance = Math.max(
      flight.maxDistance,
      Math.hypot(player.x - SPAWN.x, player.z - SPAWN.z),
    );
    if (!player.onGround) flight.airTicks++;
    if (input.forward !== 0 && horizontalSpeed(player) < 1) flight.stalledTicks++;
  }
  flight.final = { x: player.x, y: player.y, z: player.z, yaw: look.yaw };
  return flight;
}

const FULL_RUN = 30 * TICK_RATE;

describe('benchmark flythrough', () => {
  it('stays inside the open middle of the deck for the whole run', () => {
    const flight = fly(FULL_RUN);
    expect(flight.maxDistance).toBeLessThan(CLEAR_RADIUS - 1);
  });

  it('covers real ground without ever being stopped by a block', () => {
    const flight = fly(FULL_RUN);
    // 20 s of walking and sprinting in circles is at least 100 blocks of travel.
    expect(flight.pathLength).toBeGreaterThan(100);
    expect(flight.stalledTicks).toBeLessThanOrEqual(10);
  });

  it('is exactly the same route every time', () => {
    expect(fly(FULL_RUN).final).toEqual(fly(FULL_RUN).final);
  });

  it('is the same shape at any length: first person, third person, then first person again', () => {
    for (const seconds of [3, 10, 30, 120]) {
      const total = seconds * TICK_RATE;
      const { modes } = fly(total);
      expect(modes[0]).toBe('first');
      expect(modes[Math.floor(total * 0.4)]).toBe('first');
      expect(modes[Math.floor(total * 0.6)]).toBe('third');
      expect(modes[Math.floor(total * 0.85)]).toBe('third');
      expect(modes[total - 1]).toBe('first');
    }
  });

  it('hops only in the third-person sprint', () => {
    const total = FULL_RUN;
    const { jumps } = fly(total);
    const hops = jumps.flatMap((jump, tick) => (jump ? [tick] : []));
    expect(hops.length).toBeGreaterThan(0);
    for (const tick of hops) {
      expect(tick).toBeGreaterThanOrEqual(total * 0.5);
      expect(tick).toBeLessThan(total * 0.8);
    }
  });

  it('leaves the ground when it hops and lands again', () => {
    const flight = fly(FULL_RUN);
    expect(flight.airTicks).toBeGreaterThan(30);
    expect(flight.final.y).toBeCloseTo(0, 3);
  });

  it('keeps the view angles in step with the input', () => {
    const input = createPlayerInput();
    const look: LookState = { yaw: 0, pitch: 0 };
    for (let tick = 0; tick < 500; tick++) {
      driveBenchTick(tick, FULL_RUN, input, look);
      expect(input.yaw).toBe(look.yaw);
      expect(Math.abs(look.pitch)).toBeLessThanOrEqual(0.5);
    }
  });
});
