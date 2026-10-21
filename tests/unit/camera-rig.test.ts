import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createCameraRig, type RigFrame } from '../../src/engine/camera-rig';
import { buildProvingGround } from './helpers/proving-ground';
import { overlapsSolid } from '../../src/shared/collision';
import { createRng } from '../../src/shared/hash';
import { GROUND_SPHERES, MOVEMENT, PLAYER, createPlayerState } from '../../src/shared/movement';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { CollisionWorld } from '../../src/shared/ground';
import type { SparseCells } from '../../src/shared/solid';
import { flatWorld } from './helpers';
import { groundWorld, tiltedPlane } from './helpers/ground';
import { valley } from './helpers/valley';

const DT = 1 / 60;

function frame(overrides: Partial<RigFrame> = {}): RigFrame {
  const at = { x: 0.5, y: 0, z: 0.5 };
  return {
    dt: DT,
    alpha: 1,
    previous: at,
    current: at,
    look: { yaw: 0, pitch: 0 },
    settings: DEFAULT_SETTINGS,
    speed: 0,
    ...overrides,
  };
}

/** Runs the rig for `seconds` of rendered frames with the same inputs. */
function settle(rig: ReturnType<typeof createCameraRig>, f: RigFrame, seconds = 3): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) rig.update(f);
}

function setup(world: CollisionWorld = flatWorld()) {
  const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 500);
  const rig = createCameraRig(camera, world);
  return { camera, rig, world };
}

describe('first person', () => {
  it('puts the camera at the eyes and aims it where the player looks', () => {
    const { camera, rig } = setup();
    rig.update(frame({ look: { yaw: 0.7, pitch: -0.3 } }));
    expect(camera.position.x).toBeCloseTo(0.5, 9);
    expect(camera.position.y).toBeCloseTo(PLAYER.eyeHeight, 9);
    expect(camera.position.z).toBeCloseTo(0.5, 9);
    expect(camera.rotation.y).toBeCloseTo(0.7, 9);
    expect(camera.rotation.x).toBeCloseTo(-0.3, 9);
    expect(camera.rotation.order).toBe('YXZ');
    expect(rig.showAvatar).toBe(false);
  });

  it('looks toward -z at yaw 0, and a positive yaw turns it left', () => {
    const { camera, rig } = setup();
    const heading = new Vector3();
    rig.update(frame());
    camera.getWorldDirection(heading);
    expect(heading.x).toBeCloseTo(0, 9);
    expect(heading.z).toBeCloseTo(-1, 9);
    rig.update(frame({ look: { yaw: Math.PI / 2, pitch: 0 } }));
    camera.getWorldDirection(heading);
    expect(heading.x).toBeCloseTo(-1, 9);
    expect(heading.z).toBeCloseTo(0, 9);
  });

  it('draws the frame between the last two ticks', () => {
    const { camera, rig } = setup();
    rig.update(
      frame({
        previous: { x: 0, y: 0, z: 0 },
        current: { x: 1, y: 2, z: -3 },
        alpha: 0.25,
      }),
    );
    expect(camera.position.x).toBeCloseTo(0.25, 9);
    expect(camera.position.z).toBeCloseTo(-0.75, 9);
    expect(camera.position.y).toBeCloseTo(0.5 + PLAYER.eyeHeight, 9);
  });
});

describe('switching views', () => {
  it('toggles between first and third person', () => {
    const { rig } = setup();
    expect(rig.mode).toBe('first');
    rig.toggle();
    expect(rig.mode).toBe('third');
    rig.toggle();
    expect(rig.mode).toBe('first');
  });

  it('eases into third person rather than cutting', () => {
    const { rig } = setup();
    rig.toggle();
    rig.update(frame());
    expect(rig.blend).toBeGreaterThan(0);
    expect(rig.blend).toBeLessThan(0.5);
    settle(rig, frame(), 1);
    expect(rig.blend).toBe(1);
  });

  it('can switch at once', () => {
    const { rig } = setup();
    rig.setMode('third', true);
    expect(rig.blend).toBe(1);
    rig.setMode('first', true);
    expect(rig.blend).toBe(0);
  });
});

describe('third person in the open', () => {
  it('sits behind and to the right of the player and shows the body', () => {
    const { camera, rig } = setup();
    rig.setMode('third', true);
    settle(rig, frame({ look: { yaw: 0, pitch: 0 } }), 1);
    // Yaw 0 looks toward -z, so "behind" is +z and "right" is +x.
    expect(camera.position.z).toBeGreaterThan(0.5 + 3);
    expect(camera.position.x).toBeGreaterThan(0.5 + 0.4);
    expect(rig.boomLength).toBeCloseTo(3.4, 6);
    expect(rig.showAvatar).toBe(true);
  });

  it('follows the view angle around the player', () => {
    const { camera, rig } = setup();
    rig.setMode('third', true);
    settle(rig, frame({ look: { yaw: Math.PI / 2, pitch: 0 } }), 1);
    // Facing -x now, so the camera is on the +x side of the player.
    expect(camera.position.x).toBeGreaterThan(0.5 + 3);
  });

  it('looks over the player: pitching up lowers the camera and pitching down raises it', () => {
    const level = setup();
    level.rig.setMode('third', true);
    settle(level.rig, frame(), 1);
    const up = setup();
    up.rig.setMode('third', true);
    settle(up.rig, frame({ look: { yaw: 0, pitch: 0.8 } }), 1);
    const down = setup();
    down.rig.setMode('third', true);
    settle(down.rig, frame({ look: { yaw: 0, pitch: -0.8 } }), 1);
    expect(up.camera.position.y).toBeLessThan(level.camera.position.y);
    expect(down.camera.position.y).toBeGreaterThan(level.camera.position.y);
  });
});

describe('third person near walls', () => {
  function wallBehind(): SparseCells {
    const world = flatWorld();
    // A tall wall one block behind the player (the player looks toward -z, so behind is +z).
    world.fillBox(-8, 0, 2, 8, 6, 2);
    return world;
  }

  it('pulls the camera in front of the wall and hides the body when it gets close', () => {
    const { camera, rig } = setup(wallBehind());
    rig.setMode('third', true);
    settle(
      rig,
      frame({ previous: { x: 0.5, y: 0, z: 1.2 }, current: { x: 0.5, y: 0, z: 1.2 } }),
      1,
    );
    expect(rig.boomLength).toBeLessThan(0.9);
    expect(camera.position.z).toBeLessThan(2 - 0.2 + 1e-6);
    expect(rig.showAvatar).toBe(false);
  });

  it('snaps in at once but eases back out when the wall goes away', () => {
    const world = wallBehind();
    const { rig } = setup(world);
    rig.setMode('third', true);
    const at = { x: 0.5, y: 0, z: 1.2 };
    settle(rig, frame({ previous: at, current: at }), 1);
    const near = rig.boomLength;
    expect(near).toBeLessThan(1);
    world.clearBox(-8, 0, 2, 8, 6, 2);
    rig.update(frame({ previous: at, current: at }));
    expect(rig.boomLength).toBeGreaterThan(near);
    expect(rig.boomLength).toBeLessThan(near + 0.3);
    settle(rig, frame({ previous: at, current: at }), 3);
    expect(rig.boomLength).toBeCloseTo(3.4, 2);
  });

  it('never puts the camera inside a block, anywhere on the proving ground', () => {
    const world = buildProvingGround();
    const rng = createRng(31);
    const { camera, rig } = setup(world);
    rig.setMode('third', true);
    let checked = 0;
    for (let i = 0; i < 4000; i++) {
      const x = -23.6 + rng() * 47.2;
      const z = -23.6 + rng() * 47.2;
      const player = createPlayerState(x, 0, z);
      if (overlapsSolid(player, world)) continue;
      const look = { yaw: rng() * Math.PI * 2, pitch: (rng() - 0.5) * 2.4 };
      const at = { x, y: 0, z };
      // One long frame, so the boom's ease-out is irrelevant and the full probe runs.
      rig.update(frame({ dt: 1, previous: at, current: at, look }));
      const cube = {
        x: camera.position.x,
        y: camera.position.y - 0.2,
        z: camera.position.z,
        halfWidth: 0.2,
        height: 0.4,
      };
      expect(
        overlapsSolid(cube, world),
        `player ${x.toFixed(2)}, ${z.toFixed(2)} yaw ${look.yaw}`,
      ).toBe(false);
      checked++;
    }
    expect(checked).toBeGreaterThan(2500);
  });
});

describe('third person near terrain', () => {
  /** How far a point is from the plane the ground tilts about, for ground that rises toward +x. */
  const gap = (angle: number, p: { x: number; y: number; z: number }): number =>
    p.x * -Math.sin(angle) + p.y * Math.cos(angle);

  it('stays above flat ground when the view looks up and the boom would go through it', () => {
    const { camera, rig } = setup(groundWorld(tiltedPlane(0)));
    rig.setMode('third', true);
    const at = { x: 0, y: 0, z: 0 };
    settle(rig, frame({ previous: at, current: at, look: { yaw: 0, pitch: 0.9 } }), 2);
    expect(rig.boomLength).toBeLessThan(3.4);
    expect(camera.position.y).toBeGreaterThanOrEqual(0.32 - 1e-6);
  });

  it('keeps clear of a hillside behind the player', () => {
    const angle = 0.6;
    const { camera, rig } = setup(groundWorld(tiltedPlane(angle)));
    rig.setMode('third', true);
    // Yaw pi/2 faces -x, so the camera sits on the uphill side, behind the player.
    const at = { x: 0, y: 0, z: 0 };
    settle(rig, frame({ previous: at, current: at, look: { yaw: Math.PI / 2, pitch: 0 } }), 2);
    expect(gap(angle, camera.position)).toBeGreaterThanOrEqual(0.32 - 1e-6);
    expect(rig.boomLength).toBeLessThan(3.4);
  });

  it('is not pulled in where there is nothing in the way', () => {
    const { rig } = setup(groundWorld(tiltedPlane(0)));
    rig.setMode('third', true);
    const at = { x: 0, y: 3, z: 0 };
    settle(rig, frame({ previous: at, current: at, look: { yaw: 0, pitch: -0.2 } }), 2);
    expect(rig.boomLength).toBeCloseTo(3.4, 2);
  });

  it('never puts the camera inside the real terrain', () => {
    const { grid } = valley();
    const world = groundWorld(grid, 95);
    const rng = createRng(77);
    const { camera, rig } = setup(world);
    rig.setMode('third', true);
    let checked = 0;
    for (let i = 0; i < 900; i++) {
      const x = (rng() - 0.5) * 180;
      const z = (rng() - 0.5) * 180;
      const at = { x, y: grid.groundAt(x, z), z };
      // The player cannot stand inside rock, so a spot that puts the body in it is not a case.
      if (GROUND_SPHERES.heights.some((h) => grid.sample(x, at.y + h, z) < GROUND_SPHERES.radius)) {
        continue;
      }
      const look = { yaw: rng() * Math.PI * 2, pitch: (rng() - 0.5) * 2.4 };
      rig.update(frame({ dt: 1, previous: at, current: at, look }));
      const { x: cx, y: cy, z: cz } = camera.position;
      expect(
        grid.sample(cx, cy, cz),
        `player ${x.toFixed(1)}, ${z.toFixed(1)} yaw ${look.yaw}`,
      ).toBeGreaterThan(0.2);
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
  });
});

describe('feel details', () => {
  it('widens the field of view at a sprint and returns it at rest', () => {
    const { camera, rig } = setup();
    settle(rig, frame({ speed: 0 }), 1);
    expect(camera.fov).toBeCloseTo(DEFAULT_SETTINGS.fov, 6);
    settle(rig, frame({ speed: MOVEMENT.sprintSpeed }), 2);
    expect(camera.fov).toBeCloseTo(DEFAULT_SETTINGS.fov + 6, 1);
    settle(rig, frame({ speed: 0 }), 2);
    expect(camera.fov).toBeCloseTo(DEFAULT_SETTINGS.fov, 1);
  });

  it('does not widen the view just for walking', () => {
    const { camera, rig } = setup();
    settle(rig, frame({ speed: MOVEMENT.walkSpeed }), 2);
    expect(camera.fov).toBeCloseTo(DEFAULT_SETTINGS.fov, 3);
  });

  it('uses the field of view from the settings', () => {
    const { camera, rig } = setup();
    settle(rig, frame({ settings: { ...DEFAULT_SETTINGS, fov: 95 } }), 1);
    expect(camera.fov).toBeCloseTo(95, 6);
  });

  it('dips the eye after a hard landing and recovers', () => {
    const { camera, rig } = setup();
    rig.update(frame());
    const rest = camera.position.y;
    const landed = createPlayerState(0.5, 0, 0.5);
    landed.landingSpeed = 14;
    rig.onTick(landed);
    rig.update(frame());
    expect(camera.position.y).toBeLessThan(rest - 0.05);
    expect(camera.position.y).toBeGreaterThan(rest - 0.13);
    settle(rig, frame(), 1);
    expect(camera.position.y).toBeCloseTo(rest, 3);
  });

  it('ignores gentle landings', () => {
    const { camera, rig } = setup();
    rig.update(frame());
    const rest = camera.position.y;
    const landed = createPlayerState(0.5, 0, 0.5);
    landed.landingSpeed = 2;
    rig.onTick(landed);
    rig.update(frame());
    expect(camera.position.y).toBeCloseTo(rest, 9);
  });
});
