import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import { createShotEffects, type ShotSession } from '../../src/app/shot-effects';
import { FX_COLOR, type ShotFx } from '../../src/engine/shot-fx';
import { createEnemyPose, type EnemyPose } from '../../src/shared/enemy-state';
import { PLAYER } from '../../src/shared/movement';
import { colorForSlot } from '../../src/shared/player-colors';
import type { PlayerSample, RemotePose } from '../../src/shared/protocol';
import type { RayWorld } from '../../src/shared/raycast';
import { SHOT_FLAG, muzzleOf } from '../../src/shared/shot';
import { BLASTER } from '../../src/systems/survival/balance';

interface At {
  x: number;
  y: number;
  z: number;
}

/** A stand-in for the light: it remembers what it was asked to draw. */
function fakeFx() {
  const calls = {
    bolt: [] as { from: At; to: At; color: string }[],
    muzzle: [] as { at: At; dir: At; color: string }[],
    impact: [] as { at: At; dir: At; color: string }[],
    burst: [] as At[],
    update: [] as number[],
  };
  const fx: ShotFx = {
    object: new Group(),
    bolt: (from, to, color) => calls.bolt.push({ from: { ...from }, to: { ...to }, color }),
    muzzle: (at, dir, color) => calls.muzzle.push({ at: { ...at }, dir: { ...dir }, color }),
    impact: (at, dir, color) => calls.impact.push({ at: { ...at }, dir: { ...dir }, color }),
    burst: (at) => calls.burst.push({ ...at }),
    update: (dt) => calls.update.push(dt),
    live: () => ({ bolts: calls.bolt.length, sparks: 0 }),
    dispose: () => undefined,
  };
  return { fx, calls };
}

const FLOOR = 10;
/** Flat ground at 10, nothing built on it. */
const FLAT: RayWorld = {
  blocks: { getBlock: () => 0 },
  ground: { distance: (_x, y) => y - FLOOR },
};

const ME: PlayerSample = {
  x: 0,
  y: FLOOR,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  yaw: 0,
  pitch: 0,
  onGround: true,
  reset: false,
};

function crawler(id: number, x: number, z: number): EnemyPose {
  return { ...createEnemyPose(), id, x, y: FLOOR, z };
}

function remote(id: number, slot: number, x: number, z: number): RemotePose {
  return { id, slot, name: `P${id}`, x, y: FLOOR, z, yaw: 0, pitch: 0, speed: 0, onGround: true };
}

function setup(
  options: { enemies?: EnemyPose[]; remotes?: RemotePose[]; ground?: RayWorld | null } = {},
) {
  const { fx, calls } = fakeFx();
  const me = { ...ME };
  let present = true;
  const session: ShotSession = {
    localId: 1,
    players: [
      { id: 1, slot: 0, name: 'Me', isHost: true, pingMs: null },
      { id: 2, slot: 2, name: 'Them', isHost: false, pingMs: 30 },
    ],
    sampleRemotes: () => options.remotes ?? [],
    sampleEnemies: () => options.enemies ?? [],
  };
  const effects = createShotEffects({
    fx,
    session,
    rayWorld: () => (options.ground === undefined ? FLAT : options.ground),
    player: {
      read(out) {
        Object.assign(out, me);
        return present;
      },
    },
  });
  return {
    effects,
    calls,
    me,
    leave: () => {
      present = false;
    },
  };
}

/** Where the muzzle of a player standing at (x, FLOOR, z) and looking along the default view is. */
function gunAt(x: number, z: number): At {
  return muzzleOf(x, FLOOR + PLAYER.eyeHeight, z, 0, 0, { x: 0, y: 0, z: 0 });
}

const AHEAD = { x: 0, y: 0, z: -1 };
const EYE = { x: 0, y: FLOOR + PLAYER.eyeHeight, z: 0 };

/** The unit vector from the eyes to the middle of a machine standing `ahead` blocks away. */
function towardMachine(ahead: number): At {
  const dy = FLOOR + 0.5 - EYE.y;
  const length = Math.hypot(dy, ahead);
  return { x: 0, y: dy / length, z: -ahead / length };
}

describe('the player’s own shot, drawn at the click', () => {
  it('flies from the gun to the end of its range when nothing is in the way', () => {
    const { effects, calls } = setup();
    effects.predict(EYE, AHEAD);
    expect(calls.bolt).toHaveLength(1);
    const bolt = calls.bolt[0] as (typeof calls.bolt)[number];
    const gun = gunAt(0, 0);
    expect(bolt.from).toEqual(gun);
    expect(bolt.to.z).toBeCloseTo(EYE.z - BLASTER.range, 6);
    expect(bolt.to.y).toBeCloseTo(EYE.y, 6);
    expect(calls.muzzle).toHaveLength(1);
    expect(calls.muzzle[0]?.at).toEqual(gun);
    // It struck nothing, so it leaves no sparks.
    expect(calls.impact).toHaveLength(0);
    expect(effects.debug().shots).toEqual([
      expect.objectContaining({ by: 1, flags: 0, predicted: true }),
    ]);
  });

  it('is drawn in the color of the player’s seat', () => {
    const { effects, calls } = setup();
    effects.predict(EYE, AHEAD);
    expect(calls.bolt[0]?.color).toBe(colorForSlot(0).hex);
    expect(calls.muzzle[0]?.color).toBe(colorForSlot(0).hex);
  });

  it('stops at the ground and throws sparks back the way it came', () => {
    const { effects, calls } = setup();
    // Aimed straight down from the eyes: the ground is 1.62 below.
    effects.predict(EYE, { x: 0, y: -1, z: 0 });
    const bolt = calls.bolt[0] as (typeof calls.bolt)[number];
    expect(bolt.to.y).toBeCloseTo(FLOOR, 1);
    expect(calls.impact).toHaveLength(1);
    expect(calls.impact[0]?.color).toBe(colorForSlot(0).hex);
    // The sparks come back along the bolt: from where it ended toward the gun.
    const gun = gunAt(0, 0);
    const length = Math.hypot(0 - gun.x, FLOOR - gun.y, 0 - gun.z);
    const way = calls.impact[0]?.dir as At;
    expect(way.x).toBeCloseTo((0 - gun.x) / length, 4);
    expect(way.y).toBeCloseTo((FLOOR - gun.y) / length, 4);
    expect(way.z).toBeCloseTo((0 - gun.z) / length, 4);
    expect(effects.debug().shots[0]?.flags).toBe(SHOT_FLAG.world);
  });

  it('stops at a machine it would hit, as that machine is drawn, in the amber of a strike', () => {
    const { effects, calls } = setup({ enemies: [crawler(5, 0, -10)] });
    effects.predict(EYE, towardMachine(10));
    const bolt = calls.bolt[0] as (typeof calls.bolt)[number];
    // The front of the machine's box: ten blocks out, less half its width.
    expect(bolt.to.z).toBeCloseTo(-9.4, 4);
    expect(bolt.to.y).toBeGreaterThan(FLOOR);
    expect(bolt.to.y).toBeLessThan(FLOOR + 1);
    expect(calls.impact).toHaveLength(1);
    expect(calls.impact[0]?.color).toBe(FX_COLOR.hit);
    expect(effects.debug().shots[0]?.flags).toBe(SHOT_FLAG.enemy);
    // The host has not spoken: nothing falls apart yet.
    expect(calls.burst).toHaveLength(0);
  });

  it('is drawn from the player’s own pose, so the gun is where the suit holds it', () => {
    const { effects, calls, me } = setup();
    me.x = 6;
    me.z = -3;
    me.yaw = Math.PI / 2;
    effects.predict({ x: 6, y: EYE.y, z: -3 }, { x: -1, y: 0, z: 0 });
    const gun = muzzleOf(6, EYE.y, -3, Math.PI / 2, 0, { x: 0, y: 0, z: 0 });
    expect(calls.bolt[0]?.from).toEqual(gun);
  });

  it('draws only where it ends when the player’s pose cannot be read', () => {
    const { effects, calls, leave } = setup({ enemies: [crawler(5, 0, -10)] });
    leave();
    effects.predict(EYE, towardMachine(10));
    expect(calls.bolt).toHaveLength(0);
    expect(calls.muzzle).toHaveLength(0);
    expect(calls.impact).toHaveLength(1);
  });

  it('flies in a world that has no ground or blocks to stop it', () => {
    const { effects, calls } = setup({ ground: null });
    effects.predict(EYE, { x: 0, y: -1, z: 0 });
    expect(calls.bolt[0]?.to.y).toBeCloseTo(EYE.y - BLASTER.range, 6);
    expect(calls.impact).toHaveLength(0);
  });
});

describe('what the host adds to the player’s own shot', () => {
  it('is the end of a machine and nothing else', () => {
    const { effects, calls } = setup();
    effects.hear({ by: 1, x: 1, y: 11, z: -9, flags: SHOT_FLAG.enemy, enemy: 5 });
    expect(calls.bolt).toHaveLength(0);
    expect(calls.muzzle).toHaveLength(0);
    expect(calls.impact).toHaveLength(0);
    expect(calls.burst).toHaveLength(0);

    effects.hear({ by: 1, x: 1, y: 11, z: -9, flags: SHOT_FLAG.enemy | SHOT_FLAG.kill, enemy: 5 });
    expect(calls.bolt).toHaveLength(0);
    expect(calls.burst).toEqual([{ x: 1, y: 11, z: -9 }]);
    expect(effects.debug().shots.map((shot) => shot.predicted)).toEqual([false, false]);
  });
});

describe('other players’ shots, drawn when the host reports them', () => {
  const SEEN = remote(2, 2, 4, 0);

  it('fly from their gun as it is drawn here to the place the host says', () => {
    const { effects, calls } = setup({ remotes: [SEEN] });
    effects.hear({ by: 2, x: 4, y: 11.62, z: -25, flags: 0, enemy: 0 });
    const gun = gunAt(4, 0);
    expect(calls.bolt).toEqual([
      { from: gun, to: { x: 4, y: 11.62, z: -25 }, color: colorForSlot(2).hex },
    ]);
    expect(calls.muzzle[0]?.at).toEqual(gun);
    // The muzzle flash points along the bolt.
    expect(calls.muzzle[0]?.dir.z).toBeCloseTo(-1, 1);
    expect(calls.impact).toHaveLength(0);
    expect(effects.debug().shots[0]).toMatchObject({ by: 2, predicted: false });
  });

  it('throw amber sparks off a machine they hit and burst it when it falls', () => {
    const { effects, calls } = setup({ remotes: [SEEN] });
    effects.hear({ by: 2, x: 4, y: 11, z: -12, flags: SHOT_FLAG.enemy, enemy: 9 });
    expect(calls.impact).toHaveLength(1);
    expect(calls.impact[0]?.color).toBe(FX_COLOR.hit);
    expect(calls.burst).toHaveLength(0);
    effects.hear({ by: 2, x: 4, y: 11, z: -12, flags: SHOT_FLAG.enemy | SHOT_FLAG.kill, enemy: 9 });
    expect(calls.impact).toHaveLength(2);
    expect(calls.burst).toEqual([{ x: 4, y: 11, z: -12 }]);
  });

  it('throw sparks in the shooter’s color off a block or the ground', () => {
    const { effects, calls } = setup({ remotes: [SEEN] });
    effects.hear({ by: 2, x: 4, y: 10, z: -12, flags: SHOT_FLAG.world, enemy: 0 });
    expect(calls.impact[0]?.color).toBe(colorForSlot(2).hex);
    // Back the way the bolt came: toward the gun, so up and toward +z.
    expect(calls.impact[0]?.dir.z).toBeLessThan(0);
  });

  it('still show where they landed when the shooter is not to be found on this screen', () => {
    const { effects, calls } = setup();
    effects.hear({ by: 2, x: 4, y: 10, z: -12, flags: SHOT_FLAG.enemy | SHOT_FLAG.kill, enemy: 9 });
    expect(calls.bolt).toHaveLength(0);
    expect(calls.muzzle).toHaveLength(0);
    expect(calls.impact).toHaveLength(1);
    expect(calls.burst).toHaveLength(1);
  });

  it('use the first seat’s color for a shooter nobody knows', () => {
    const { effects, calls } = setup({ remotes: [remote(7, 3, 0, 0)] });
    effects.hear({ by: 7, x: 0, y: 11.62, z: -25, flags: 0, enemy: 0 });
    expect(calls.bolt[0]?.color).toBe(colorForSlot(0).hex);
  });
});

describe('the record of shots', () => {
  it('keeps the latest two dozen, newest last', () => {
    const { effects } = setup();
    for (let i = 0; i < 30; i++) effects.hear({ by: 1, x: i, y: 0, z: 0, flags: 0, enemy: 0 });
    const shots = effects.debug().shots;
    expect(shots).toHaveLength(24);
    expect(shots[0]?.x).toBe(6);
    expect(shots[23]?.x).toBe(29);
  });

  it('passes the frame time on to the light', () => {
    const { effects, calls } = setup();
    effects.update(0.016);
    effects.update(0.02);
    expect(calls.update).toEqual([0.016, 0.02]);
  });
});
