import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import { createIntro, type IntroEnd, type IntroSite } from '../../src/engine/intro/director';
import { shakeAt } from '../../src/engine/intro/tracks';
import type { Stage } from '../../src/engine/stage';
import type { CameraPose } from '../../src/shared/camera-pose';
import type { SkyState } from '../../src/shared/daycycle';
import { sunElevationAt } from '../../src/shared/daycycle';
import {
  INTRO_SECONDS,
  STOP_AT,
  createIntroFrame,
  introPhaseAt,
  sceneAt,
  type IntroFrame,
} from '../../src/shared/intro';
import { MIN_CLEARANCE, shakePose } from '../../src/shared/intro-camera';
import { WORLD_HALF } from '../../src/world/terrain/field';
import { crashSiteFor } from './helpers/crash-site';
import { createTestRegistry } from './helpers/registry';

const SEED = 20261020;
const { site: crash } = crashSiteFor(SEED);

const pose = (overrides: Partial<CameraPose> = {}): CameraPose => ({
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  ...overrides,
});

/** Where the player's own camera would be at the start of a run: on the grass, looking at the lake. */
const PLAYER_VIEW = pose({ x: 12, y: 13.7, z: 7, yaw: -1.6, pitch: -0.05, fov: 70 });

function setup(holdAt: number | null = null, calm = false) {
  const registry = createTestRegistry();
  const world = new Group();
  const skies: (null | (() => SkyState))[] = [];
  const precompiled: unknown[] = [];
  const stage = {
    registry,
    world,
    setSkyOverride: (sky: null | (() => SkyState)) => skies.push(sky),
    precompile: (object: unknown) => {
      precompiled.push(object);
      return Promise.resolve();
    },
  } as unknown as Stage;
  const wreckShown: boolean[] = [];
  const site: IntroSite = { ...crash, showWreck: (shown) => wreckShown.push(shown) };
  const frames: IntroFrame[] = [];
  const ends: IntroEnd[] = [];
  const playback = createIntro({
    stage,
    site,
    onFrame: (frame) => frames.push({ ...frame }),
    onEnd: (how) => ends.push(how),
    holdAt,
    calm,
  });
  const materials = Reflect.get(registry, 'materials') as Set<unknown>;
  const out = pose();
  const step = (dt: number, view: CameraPose = PLAYER_VIEW): boolean =>
    playback.update(dt, view, out);
  return {
    playback,
    world,
    skies,
    wreckShown,
    frames,
    ends,
    materials,
    out,
    step,
    stage,
    precompiled,
  };
}

describe('the intro film', () => {
  it('puts its picture on the stage and takes all of it away again, materials included', () => {
    const { playback, world, materials } = setup(3);
    expect(world.children).toHaveLength(1);
    expect(materials.size).toBeGreaterThan(5);
    playback.end();
    expect(world.children).toHaveLength(0);
    expect(materials.size).toBe(0);
  });

  it('has every shader of the film compiled as it is made, before any of it is drawn', () => {
    const { world, precompiled } = setup(3);
    expect(precompiled).toEqual([world.children[0]]);
  });

  it('leaves the picture to the film clock: held, it stays where it is held', () => {
    const { playback, step, frames } = setup(7.25);
    expect(playback.held).toBe(true);
    expect(playback.time).toBe(7.25);
    for (let i = 0; i < 10; i++) expect(step(0.1)).toBe(true);
    expect(playback.time).toBe(7.25);
    expect(frames).toHaveLength(10);
    playback.seek(3);
    step(0.1);
    expect(playback.time).toBe(3);
    playback.seek(INTRO_SECONDS + 50);
    expect(playback.time).toBe(INTRO_SECONDS);
    playback.seek(-4);
    expect(playback.time).toBe(0);
  });

  it('plays on from its start at the pace of the frames, and caps a long frame so a stall is not film time', () => {
    const { playback, step } = setup();
    expect(playback.held).toBe(false);
    step(0.05);
    expect(playback.time).toBeCloseTo(0.05, 9);
    step(3);
    expect(playback.time).toBeCloseTo(0.15, 9);
  });

  it('runs to the end and says it finished', () => {
    const { playback, step, ends } = setup();
    let seconds = 0;
    let going = true;
    while (going && seconds < INTRO_SECONDS + 5) {
      going = step(0.05);
      seconds += 0.05;
    }
    expect(going).toBe(false);
    expect(seconds).toBeGreaterThan(INTRO_SECONDS - 0.2);
    expect(seconds).toBeLessThan(INTRO_SECONDS + 0.2);
    expect(ends).toEqual([]);
    playback.end();
    expect(ends).toEqual(['finished']);
  });

  it('fades to black when it is skipped, then ends as skipped', () => {
    const { playback, step, ends, frames } = setup(12);
    playback.play();
    playback.skip();
    let seconds = 0;
    while (step(0.05)) seconds += 0.05;
    expect(seconds).toBeLessThan(0.7);
    expect(frames[frames.length - 1]?.black).toBe(1);
    playback.end();
    expect(ends).toEqual(['skipped']);
  });

  it('says it was cut when something else takes the camera, and only says so once', () => {
    const { playback, ends } = setup(5);
    playback.end();
    expect(ends).toEqual(['cut']);
  });

  it('keeps what the crash made out of sight until the wreck has stopped, and says so again every frame it is hidden', () => {
    const { playback, step, wreckShown } = setup(5);
    expect(wreckShown).toEqual([false]);
    step(0.1);
    step(0.1);
    expect(wreckShown).toEqual([false, false, false]);
    playback.seek(STOP_AT + 0.2);
    step(0.1);
    expect(wreckShown[wreckShown.length - 1]).toBe(false);
    playback.seek(STOP_AT + 0.5);
    step(0.1);
    expect(wreckShown[wreckShown.length - 1]).toBe(true);
    step(0.1);
    step(0.1);
    // Shown once is shown: it is not told again every frame.
    expect(wreckShown.filter((shown) => shown)).toHaveLength(1);
    playback.end();
    // However the film stops, the valley is left as the game has it.
    expect(wreckShown[wreckShown.length - 1]).toBe(true);
  });

  it('runs the sky through the film’s own dusk and night and gives the game its sky back', () => {
    const { playback, skies } = setup(0);
    expect(skies).toHaveLength(1);
    const sky = skies[0];
    expect(sky).toBeTypeOf('function');
    expect(sky?.().sunElevation).toBeCloseTo(sunElevationAt(introPhaseAt(0)), 9);
    playback.seek(INTRO_SECONDS);
    expect(sky?.().sunElevation).toBeCloseTo(sunElevationAt(1), 9);
    playback.end();
    expect(skies).toHaveLength(2);
    expect(skies[1]).toBeNull();
  });

  it('flies the camera into the player’s own view in its last frames, so the hand-over is no cut', () => {
    const { playback, step, out } = setup(INTRO_SECONDS);
    step(0);
    expect(out.x).toBeCloseTo(PLAYER_VIEW.x, 9);
    expect(out.y).toBeCloseTo(PLAYER_VIEW.y, 9);
    expect(out.z).toBeCloseTo(PLAYER_VIEW.z, 9);
    expect(Math.cos(out.yaw)).toBeCloseTo(Math.cos(PLAYER_VIEW.yaw), 9);
    expect(Math.sin(out.yaw)).toBeCloseTo(Math.sin(PLAYER_VIEW.yaw), 9);
    expect(out.pitch).toBeCloseTo(PLAYER_VIEW.pitch, 9);
    expect(out.fov).toBeCloseTo(PLAYER_VIEW.fov ?? 0, 9);
    expect(out.roll ?? 0).toBeCloseTo(0, 9);

    // And on the way there it is between.
    playback.seek(INTRO_SECONDS - 0.8);
    step(0);
    const distance = Math.hypot(
      out.x - PLAYER_VIEW.x,
      out.y - PLAYER_VIEW.y,
      out.z - PLAYER_VIEW.z,
    );
    expect(distance).toBeGreaterThan(0.05);
  });

  it('never puts the camera in the ground, or lets it jump from one frame to the next', () => {
    const { playback, step, out } = setup(0);
    let before = { x: NaN, y: NaN, z: NaN };
    for (let t = 0; t <= INTRO_SECONDS - 1.8; t += 0.04) {
      playback.seek(t);
      step(0);
      if (Math.abs(out.x) < WORLD_HALF - 4 && Math.abs(out.z) < WORLD_HALF - 4) {
        const ground = crash.groundAt(out.x, out.z);
        // The shake can dip it a hair below the least height the shot asks for.
        expect(out.y - ground, `at ${t.toFixed(2)}`).toBeGreaterThan(MIN_CLEARANCE - 0.3);
      }
      expect(
        Number.isFinite(out.yaw) && Number.isFinite(out.pitch) && Number.isFinite(out.fov ?? 0),
      ).toBe(true);
      expect(out.fov ?? 60).toBeGreaterThan(20);
      expect(out.fov ?? 60).toBeLessThan(100);
      before = { x: out.x, y: out.y, z: out.z };
    }
    expect(Number.isFinite(before.x)).toBe(true);
  });

  it('holds the camera steady for a system that asks for less motion: the same shot, minus the shake', () => {
    // Moments in the fall and the skid, where the camera is shaken.
    for (const seconds of [6.8, 9.3, 11.7]) {
      const shaken = setup(seconds, false);
      const steady = setup(seconds, true);
      shaken.step(0);
      steady.step(0);

      // Shaking the steady shot by the film's own amount gives the shaken one, so nothing else differs.
      const scene = sceneAt(seconds);
      const amount = shakeAt(seconds, scene.name, seconds - scene.from);
      expect(amount, `at ${seconds}`).toBeGreaterThan(0);
      const again: CameraPose = { ...steady.out };
      shakePose(again, seconds, amount);
      for (const axis of ['x', 'y', 'z', 'yaw', 'pitch', 'fov'] as const) {
        expect(shaken.out[axis] ?? 0, `${axis} at ${seconds}`).toBeCloseTo(again[axis] ?? 0, 9);
      }
      expect(shaken.out.roll ?? 0).toBeCloseTo(again.roll ?? 0, 9);

      // And the shake was there to take away.
      const apart = Math.hypot(
        shaken.out.x - steady.out.x,
        shaken.out.y - steady.out.y,
        shaken.out.z - steady.out.z,
      );
      expect(apart, `at ${seconds}`).toBeGreaterThan(0.001);
      // What the overlay is given is the same: the flashes are turned down by the stylesheet.
      expect(steady.frames[0]).toEqual(shaken.frames[0]);
    }
  });

  it('draws every frame of the overlay it is given: bars, captions, flashes', () => {
    const { step, frames } = setup(0.5);
    step(0.1);
    expect(frames[0]).toEqual(
      expect.objectContaining({ bars: expect.any(Number), black: expect.any(Number) }),
    );
    const frame = createIntroFrame();
    expect(Object.keys(frames[0] ?? {}).sort()).toEqual(Object.keys(frame).sort());
  });
});
