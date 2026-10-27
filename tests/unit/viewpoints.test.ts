import { describe, expect, it } from 'vitest';
import type { CameraPose } from '../../src/shared/camera-pose';
import { TIME_PRESETS } from '../../src/shared/daycycle';
import { lookDirection, wrapAngle } from '../../src/shared/look';
import {
  FLY_PATH,
  ROUTE_FOV,
  SHOTS,
  SPAWN_SHOT,
  TITLE_VIEWS,
  createFlyRoute,
  createTitleRoute,
  shotPose,
  yawFromBearing,
} from '../../src/world/terrain/viewpoints';
import { valley } from './helpers/valley';

const flat = (): number => 10;

function blank(): CameraPose {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
}

describe('compass bearings and yaw', () => {
  it('turns a compass bearing into the direction the view looks along', () => {
    const heading = { x: 0, y: 0, z: 0 };
    const along = (bearing: number): { x: number; z: number } => {
      lookDirection(yawFromBearing(bearing), 0, heading);
      return { x: heading.x, z: heading.z };
    };
    // North is -z and east is +x.
    expect(along(0).z).toBeCloseTo(-1, 9);
    expect(along(90).x).toBeCloseTo(1, 9);
    expect(along(180).z).toBeCloseTo(1, 9);
    expect(along(270).x).toBeCloseTo(-1, 9);
  });
});

describe('named viewpoints', () => {
  it('puts the camera at its eye height above the ground and aims it', () => {
    const lake = SHOTS.lake;
    expect(lake).toBeDefined();
    if (!lake) return;
    const pose = shotPose(lake, flat);
    expect(pose.x).toBe(lake.x);
    expect(pose.z).toBe(lake.z);
    expect(pose.y).toBeCloseTo(10 + lake.height, 9);
    expect(wrapAngle(pose.yaw)).toBeCloseTo(wrapAngle(yawFromBearing(lake.bearing)), 9);
    expect(pose.pitch).toBeCloseTo((lake.pitch * Math.PI) / 180, 9);
    expect(pose.fov).toBe(lake.fov);
  });

  it('leaves the field of view to the player when the viewpoint has none', () => {
    const pose = shotPose({ x: 0, z: 0, height: 2, bearing: 0, pitch: 0, note: 'plain' }, flat);
    expect(pose.fov).toBeUndefined();
  });

  it('has the spawn viewpoint, and a known time of day for every viewpoint that names one', () => {
    expect(SHOTS[SPAWN_SHOT]).toBeDefined();
    for (const [name, shot] of Object.entries(SHOTS)) {
      if (shot.time) expect(TIME_PRESETS[shot.time], name).toBeDefined();
    }
  });
});

describe('the benchmark route', () => {
  const route = createFlyRoute(flat);

  it('passes through every waypoint at the height asked for', () => {
    const pose = blank();
    FLY_PATH.forEach(([x, z, height, bearing], i) => {
      route.sample(i / (FLY_PATH.length - 1), pose);
      expect(pose.x, `waypoint ${i}`).toBeCloseTo(x, 6);
      expect(pose.z, `waypoint ${i}`).toBeCloseTo(z, 6);
      expect(pose.y, `waypoint ${i}`).toBeCloseTo(10 + height, 6);
      expect(wrapAngle(pose.yaw), `waypoint ${i}`).toBeCloseTo(
        wrapAngle(yawFromBearing(bearing)),
        6,
      );
    });
  });

  it('is a loop that starts and ends in the same place, and keeps one field of view', () => {
    const start = route.sample(0, blank());
    const end = route.sample(1, blank());
    expect(end.x).toBeCloseTo(start.x, 6);
    expect(end.y).toBeCloseTo(start.y, 6);
    expect(end.z).toBeCloseTo(start.z, 6);
    expect(start.fov).toBe(ROUTE_FOV);
    expect(route.sample(0.37, blank()).fov).toBe(ROUTE_FOV);
    // A fraction past the end wraps round to the start again.
    expect(route.sample(1.25, blank()).x).toBeCloseTo(route.sample(0.25, blank()).x, 9);
  });

  it('moves smoothly: no jumps in position and no half turns in the view', () => {
    const steps = 3000;
    let previous = route.sample(0, blank());
    for (let i = 1; i <= steps; i++) {
      const pose = route.sample(i / steps, blank());
      expect(
        Math.hypot(pose.x - previous.x, pose.y - previous.y, pose.z - previous.z),
      ).toBeLessThan(0.5);
      expect(Math.abs(wrapAngle(pose.yaw - previous.yaw))).toBeLessThan(0.05);
      previous = pose;
    }
  });

  it('never dips under the real ground, even where a hill rises between two waypoints', () => {
    const { grid } = valley();
    const real = createFlyRoute((x, z) => grid.groundAt(x, z));
    const pose = blank();
    for (let i = 0; i <= 3000; i++) {
      real.sample(i / 3000, pose);
      expect(grid.sample(pose.x, pose.y, pose.z), `at ${i / 3000}`).toBeGreaterThan(0.7);
    }
  });

  it('lifts the path over a hill that rises between two waypoints', () => {
    // A hill 8 meters tall right between two waypoints that fly 3 meters above the ground: the
    // plain spline would pass through its middle.
    const hill = (x: number, z: number): number =>
      8 * Math.exp(-((x - 14) ** 2 + (z - 2) ** 2) / 30);
    const lifted = createFlyRoute(hill);
    const pose = blank();
    let lowest = Infinity;
    for (let i = 0; i <= 1200; i++) {
      lifted.sample(i / 1200, pose);
      lowest = Math.min(lowest, pose.y - hill(pose.x, pose.z));
    }
    expect(lowest).toBeGreaterThan(1.1);
  });
});

describe('the title screen route', () => {
  const route = createTitleRoute(flat);

  it('runs from the first view to the second', () => {
    const [first, second] = TITLE_VIEWS.map((view) => shotPose(view, flat));
    const start = route.sample(0, blank());
    const end = route.sample(1, blank());
    expect(first && start.x).toBeCloseTo(first?.x ?? NaN, 9);
    expect(first && start.y).toBeCloseTo(first?.y ?? NaN, 9);
    expect(first && start.fov).toBeCloseTo(first?.fov ?? NaN, 9);
    expect(second && end.x).toBeCloseTo(second?.x ?? NaN, 9);
    expect(second && end.z).toBeCloseTo(second?.z ?? NaN, 9);
    expect(second && wrapAngle(end.yaw)).toBeCloseTo(wrapAngle(second?.yaw ?? NaN), 9);
    expect(end.roll).toBe(0);
  });

  it('is a steady glide with the sun ahead: no jumps, and the view turns the short way', () => {
    let previous = route.sample(0, blank());
    for (let i = 1; i <= 200; i++) {
      const pose = route.sample(i / 200, blank());
      expect(
        Math.hypot(pose.x - previous.x, pose.y - previous.y, pose.z - previous.z),
      ).toBeLessThan(0.5);
      expect(Math.abs(wrapAngle(pose.yaw - previous.yaw))).toBeLessThan(0.01);
      previous = pose;
    }
  });

  it('writes the whole pose each time, so a pose left over from another camera cannot show through', () => {
    const dirty: CameraPose = { x: 9, y: 9, z: 9, yaw: 9, pitch: 9, fov: 9, roll: 3 };
    const clean = route.sample(0.4, blank());
    route.sample(0.4, dirty);
    expect(dirty).toEqual({ ...clean, roll: 0 });
  });

  it('keeps high above the real ground and the water all the way along', () => {
    const { grid } = valley();
    const real = createTitleRoute((x, z) => grid.groundAt(x, z));
    const pose = blank();
    for (let i = 0; i <= 200; i++) {
      real.sample(i / 200, pose);
      expect(pose.y - grid.groundAt(pose.x, pose.z), `at ${i / 200}`).toBeGreaterThan(6 - 1e-6);
    }
  });

  it('lifts the path over a hill that rises between its two views', () => {
    const [from, to] = TITLE_VIEWS;
    const midX = ((from?.x ?? 0) + (to?.x ?? 0)) / 2;
    const midZ = ((from?.z ?? 0) + (to?.z ?? 0)) / 2;
    const hill = (x: number, z: number): number =>
      30 * Math.exp(-((x - midX) ** 2 + (z - midZ) ** 2) / 40);
    const lifted = createTitleRoute(hill);
    const pose = blank();
    let lowest = Infinity;
    for (let i = 0; i <= 400; i++) {
      lifted.sample(i / 400, pose);
      lowest = Math.min(lowest, pose.y - hill(pose.x, pose.z));
    }
    expect(lowest).toBeGreaterThan(5.9);
  });

  it('keeps clear of the named shots: the views are not photographed from, so they hold no trees back', () => {
    for (const view of TITLE_VIEWS) {
      expect(Object.values(SHOTS).some((shot) => shot.x === view.x && shot.z === view.z)).toBe(
        false,
      );
    }
  });
});
