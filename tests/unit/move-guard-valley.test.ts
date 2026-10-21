import { describe, expect, it } from 'vitest';
import { TICK_SECONDS } from '../../src/shared/fixed-step';
import { MoveGuard } from '../../src/shared/move-guard';
import {
  createPlayerInput,
  createPlayerState,
  stepPlayer,
  type PlayerState,
} from '../../src/shared/movement';
import { createPlayerSample, type PlayerSample } from '../../src/shared/protocol';
import { createTerrainGround } from '../../src/world/terrain/collision';
import { CRASH, LAKE, WORLD_HALF } from '../../src/world/terrain/field';
import { SHOTS } from '../../src/world/terrain/viewpoints';
import { valley } from './helpers/valley';

/**
 * The host's movement check against the real controller on the real valley. The check was tuned
 * on flat test floors; the game page now moves players over smooth terrain (slopes that lift the
 * body, a snap down to keep it on the ground, rock it slides along), and a check that refuses
 * honest play there would pull players back at random. These runs sprint and jump over hills, down
 * into the lake and along the edge wall, report every third tick like the session does, and expect
 * the host to accept every report, even when they arrive late in bursts.
 */

const REPORT_EVERY_TICKS = 3;

interface Leg {
  readonly label: string;
  readonly x: number;
  readonly z: number;
}

interface Run {
  /** How many reports the host refused. */
  refused: { at: number; reason: string; x: number; y: number; z: number }[];
  reports: number;
  /** The fastest climb the controller made, in blocks per second. */
  maxClimb: number;
  maxSpeed: number;
  distance: number;
}

function summit(): Leg {
  const { grid } = valley();
  let best = { x: 0, z: 0, h: -Infinity };
  for (let x = -WORLD_HALF + 6; x <= WORLD_HALF - 6; x += 3) {
    for (let z = -WORLD_HALF + 6; z <= WORLD_HALF - 6; z += 3) {
      const h = grid.groundAt(x, z);
      if (h > best.h) best = { x, z, h };
    }
  }
  return { label: 'the highest ground', x: best.x, z: best.z };
}

/**
 * Walks a scripted player through `legs`, sprinting at each in turn and jumping now and then,
 * for at most `legSeconds` each. `burst` holds reports back and delivers them together, the way a
 * stalled connection does.
 */
function play(legs: readonly Leg[], legSeconds: number, burst: number): Run {
  const { grid } = valley();
  const world = { isSolid: () => false, ground: createTerrainGround(grid, WORLD_HALF - 1) };
  const start = SHOTS.lake!;
  const player: PlayerState = createPlayerState(
    start.x,
    grid.groundAt(start.x, start.z) + 0.05,
    start.z,
  );
  const keys = createPlayerInput();
  const guard = new MoveGuard();
  guard.place(player.x, player.y, player.z, 0);

  const run: Run = { refused: [], reports: 0, maxClimb: 0, maxSpeed: 0, distance: 0 };
  const held: PlayerSample[] = [];
  let tick = 0;

  const deliver = (): void => {
    const now = tick * TICK_SECONDS * 1000;
    for (const sample of held.splice(0)) {
      run.reports++;
      const verdict = guard.check(sample, now, null);
      if (!verdict.ok) {
        run.refused.push({
          at: now,
          reason: verdict.reason,
          x: sample.x,
          y: sample.y,
          z: sample.z,
        });
        guard.restore(now);
      }
    }
  };

  for (const leg of legs) {
    const ticks = Math.round(legSeconds / TICK_SECONDS);
    for (let i = 0; i < ticks; i++, tick++) {
      const dx = leg.x - player.x;
      const dz = leg.z - player.z;
      if (Math.hypot(dx, dz) < 1.5) break;
      keys.yaw = Math.atan2(-dx, -dz);
      keys.forward = 1;
      keys.sprint = true;
      // Hop now and then; held for a few ticks, like a real key press.
      keys.jump = tick % 70 < 4;
      const before = { x: player.x, y: player.y, z: player.z };
      stepPlayer(player, keys, TICK_SECONDS, world);
      const moved = Math.hypot(player.x - before.x, player.z - before.z);
      run.distance += moved;
      run.maxSpeed = Math.max(run.maxSpeed, moved / TICK_SECONDS);
      run.maxClimb = Math.max(run.maxClimb, (player.y - before.y) / TICK_SECONDS);

      if (tick % REPORT_EVERY_TICKS === 0) {
        const sample = createPlayerSample();
        sample.x = player.x;
        sample.y = player.y;
        sample.z = player.z;
        sample.vx = player.vx;
        sample.vy = player.vy;
        sample.vz = player.vz;
        sample.yaw = keys.yaw;
        sample.onGround = player.onGround;
        held.push(sample);
        if (held.length >= burst) deliver();
      }
    }
  }
  tick += REPORT_EVERY_TICKS;
  deliver();
  return run;
}

const TOUR: readonly Leg[] = [
  { label: 'the crash site', x: CRASH.x, z: CRASH.z },
  { label: 'the middle of the lake', x: LAKE.x, z: LAKE.z },
  summit(),
  { label: 'the far corner', x: WORLD_HALF - 3, z: WORLD_HALF - 3 },
  { label: 'the western edge', x: -WORLD_HALF + 2, z: 0 },
  { label: 'back to the start', x: SHOTS.lake!.x, z: SHOTS.lake!.z },
];

describe('the movement check on the real valley', () => {
  it('accepts every report of an honest tour, sprinting and hopping over hills, lake floor and edge', () => {
    const run = play(TOUR, 45, 1);
    expect(run.refused).toEqual([]);
    // The tour really went somewhere and really climbed: this is not a test of standing still.
    expect(run.distance).toBeGreaterThan(400);
    expect(run.maxSpeed).toBeGreaterThan(6.5);
    expect(run.maxClimb).toBeGreaterThan(3);
    expect(run.reports).toBeGreaterThan(300);
  });

  it('still accepts them when a stalled connection delivers them in bursts', () => {
    for (const burst of [4, 9, 20]) {
      const run = play(TOUR, 45, burst);
      expect(run.refused, `bursts of ${burst} reports`).toEqual([]);
    }
  });

  it('accepts a long fall from the summit', () => {
    const { x, z } = summit();
    const { grid } = valley();
    const world = { isSolid: () => false, ground: createTerrainGround(grid, WORLD_HALF - 1) };
    const player = createPlayerState(x, grid.groundAt(x, z) + 60, z);
    const keys = createPlayerInput();
    const guard = new MoveGuard();
    guard.place(player.x, player.y, player.z, 0);
    let tick = 0;
    let refused = 0;
    let landed = false;
    for (; tick < 600 && !landed; tick++) {
      stepPlayer(player, keys, TICK_SECONDS, world);
      landed = player.onGround;
      if (tick % REPORT_EVERY_TICKS === 0) {
        const sample = createPlayerSample();
        sample.x = player.x;
        sample.y = player.y;
        sample.z = player.z;
        sample.vy = player.vy;
        sample.onGround = player.onGround;
        if (!guard.check(sample, tick * TICK_SECONDS * 1000, null).ok) refused++;
      }
    }
    expect(landed).toBe(true);
    expect(refused).toBe(0);
  });
});
