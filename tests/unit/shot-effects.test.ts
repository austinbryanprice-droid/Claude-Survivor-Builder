import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createShotEffects,
  type FelledEntry,
  type ShotEffects,
  type ShotLogEntry,
  type ShotSession,
} from '../../src/app/shot-effects';
import { FX_COLOR, type ShotFx } from '../../src/engine/shot-fx';
import { createEnemyPose, type EnemyPose } from '../../src/shared/enemy-state';
import { WILD_SPECIES, createWildPose, type WildPose } from '../../src/shared/wildlife-state';
import { PLAYER } from '../../src/shared/movement';
import { colorForSlot } from '../../src/shared/player-colors';
import type { PlayerSample, RemotePose } from '../../src/shared/protocol';
import type { RayWorld } from '../../src/shared/raycast';
import { SHOT_FLAG, muzzleOf } from '../../src/shared/shot';
import { TURRET_GUN, turretMuzzle } from '../../src/shared/turret';
import { BLASTER } from '../../src/systems/survival/balance';
import { turretLevel } from '../../src/systems/survival/turrets';
import { wildHitboxOf } from '../../src/systems/wildlife/balance';

interface At {
  x: number;
  y: number;
  z: number;
}

/** How fast the stand-in's bolts fly, in blocks a second. */
const FLIGHT_SPEED = 100;

/** How long the stand-in's bolt takes to fly from where it began to where it ended. */
function flightOf(bolt: { from: At; to: At }): number {
  return (
    Math.hypot(bolt.to.x - bolt.from.x, bolt.to.y - bolt.from.y, bolt.to.z - bolt.from.z) /
    FLIGHT_SPEED
  );
}

/** A stand-in for the light: it remembers what it was asked to draw. */
function fakeFx() {
  const calls = {
    bolt: [] as { from: At; to: At; color: string }[],
    muzzle: [] as { at: At; dir: At; color: string }[],
    impact: [] as { at: At; dir: At; color: string; delay: number | undefined }[],
    burst: [] as { at: At; delay: number | undefined }[],
    puff: [] as { at: At; delay: number | undefined }[],
    update: [] as number[],
    /** How heavy each bolt and each muzzle flash was asked to be drawn, in the order of `bolt` and `muzzle`. */
    boltHeft: [] as (number | undefined)[],
    muzzleHeft: [] as (number | undefined)[],
  };
  const fx: ShotFx = {
    object: new Group(),
    bolt: (from, to, color, heft) => {
      calls.bolt.push({ from: { ...from }, to: { ...to }, color });
      calls.boltHeft.push(heft);
      return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / FLIGHT_SPEED;
    },
    muzzle: (at, dir, color, heft) => {
      calls.muzzle.push({ at: { ...at }, dir: { ...dir }, color });
      calls.muzzleHeft.push(heft);
    },
    impact: (at, dir, color, delay) =>
      calls.impact.push({ at: { ...at }, dir: { ...dir }, color, delay }),
    burst: (at, delay) => calls.burst.push({ at: { ...at }, delay }),
    puff: (at, delay) => calls.puff.push({ at: { ...at }, delay }),
    blast: () => undefined,
    strip: () => undefined,
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

function stag(id: number, x: number, z: number): WildPose {
  return { ...createWildPose(), id, kind: WILD_SPECIES.stag, x, y: FLOOR, z };
}

function remote(id: number, slot: number, x: number, z: number): RemotePose {
  return { id, slot, name: `P${id}`, x, y: FLOOR, z, yaw: 0, pitch: 0, speed: 0, onGround: true };
}

function setup(
  options: {
    enemies?: EnemyPose[];
    wildlife?: WildPose[];
    remotes?: RemotePose[];
    ground?: RayWorld | null;
    aimTurret?: (x: number, y: number, z: number, tx: number, ty: number, tz: number) => void;
    levelOfTurret?: (x: number, y: number, z: number) => number;
  } = {},
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
    sampleWildlife: () => options.wildlife ?? [],
  };
  const effects = createShotEffects({
    fx,
    session,
    rayWorld: () => (options.ground === undefined ? FLAT : options.ground),
    ...(options.aimTurret ? { aimTurret: options.aimTurret } : {}),
    ...(options.levelOfTurret ? { levelOfTurret: options.levelOfTurret } : {}),
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
    // The sparks wait for the bolt to get there.
    const flight = flightOf(bolt);
    expect(calls.impact[0]?.delay).toBeCloseTo(flight, 6);
    expect(flight).toBeGreaterThan(0.05);
    // The host has not spoken: nothing falls apart yet.
    expect(calls.burst).toHaveLength(0);
  });

  it('stops at a creature it would hit, as that creature is drawn, in the cream of a knock', () => {
    const { effects, calls } = setup({ wildlife: [stag(5, 0, -10)] });
    effects.predict(EYE, towardMachine(10));
    const bolt = calls.bolt[0] as (typeof calls.bolt)[number];
    // The front of the stag's box: ten blocks out, less half its width.
    expect(bolt.to.z).toBeCloseTo(-(10 - (wildHitboxOf(WILD_SPECIES.stag)?.halfWidth ?? 0)), 4);
    expect(calls.impact).toHaveLength(1);
    expect(calls.impact[0]?.color).toBe(FX_COLOR.wild);
    expect(effects.debug().shots[0]?.flags).toBe(SHOT_FLAG.wild);
    expect(calls.impact[0]?.delay).toBeCloseTo(flightOf(bolt), 6);
    // Nothing falls until the host says so.
    expect(calls.burst).toHaveLength(0);
    expect(calls.puff).toHaveLength(0);
  });

  it('is taken by whichever of a creature and a machine is nearer, and by neither past a wall or the range', () => {
    const near = setup({ wildlife: [stag(5, 0, -6)], enemies: [crawler(7, 0, -10)] });
    near.effects.predict(EYE, towardMachine(10));
    expect(near.effects.debug().shots[0]?.flags).toBe(SHOT_FLAG.wild);
    const far = setup({ wildlife: [stag(5, 0, -13.5)], enemies: [crawler(7, 0, -10)] });
    far.effects.predict(EYE, towardMachine(10));
    expect(far.effects.debug().shots[0]?.flags).toBe(SHOT_FLAG.enemy);
    expect(far.calls.impact[0]?.color).toBe(FX_COLOR.hit);
    // A creature behind a wall the bolt struck first is not hit.
    const wall: RayWorld = {
      blocks: { getBlock: (_x, y, z) => (z === -5 && y >= FLOOR && y < FLOOR + 3 ? 1 : 0) },
      ground: { distance: (_x, y) => y - FLOOR },
    };
    const behind = setup({ wildlife: [stag(5, 0, -10)], ground: wall });
    behind.effects.predict(EYE, towardMachine(10));
    expect(behind.effects.debug().shots[0]?.flags).toBe(SHOT_FLAG.world);
    expect(behind.calls.impact[0]?.color).not.toBe(FX_COLOR.wild);
    // And one beyond the range is out of reach.
    const out = setup({ wildlife: [stag(5, 0, -BLASTER.range - 5)] });
    out.effects.predict(EYE, AHEAD);
    expect(out.effects.debug().shots[0]?.flags).toBe(0);
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
    expect(calls.burst.map((burst) => burst.at)).toEqual([{ x: 1, y: 11, z: -9 }]);
    expect(effects.debug().shots.map((shot) => shot.predicted)).toEqual([false, false]);
  });

  it('is a puff of dust and not a burst of fire when it is a creature that falls', () => {
    const { effects, calls } = setup();
    effects.hear({ by: 1, x: 1, y: 11, z: -9, flags: SHOT_FLAG.wild, enemy: 5 });
    expect(calls.puff).toHaveLength(0);
    effects.hear({ by: 1, x: 1, y: 11, z: -9, flags: SHOT_FLAG.wild | SHOT_FLAG.kill, enemy: 5 });
    expect(calls.bolt).toHaveLength(0);
    expect(calls.burst).toHaveLength(0);
    expect(calls.puff.map((puff) => puff.at)).toEqual([{ x: 1, y: 11, z: -9 }]);
  });

  it('waits for the bolt that is still on its way before it falls apart', () => {
    const { effects, calls } = setup({ enemies: [crawler(5, 0, -10)] });
    effects.predict(EYE, towardMachine(10));
    const flight = flightOf(calls.bolt[0] as (typeof calls.bolt)[number]);
    // The host answers a frame later, with the bolt not yet there.
    effects.update(0.02);
    effects.hear({
      by: 1,
      x: 0,
      y: 10.5,
      z: -9.4,
      flags: SHOT_FLAG.enemy | SHOT_FLAG.kill,
      enemy: 5,
    });
    expect(calls.burst).toHaveLength(1);
    expect(calls.burst[0]?.delay).toBeCloseTo(flight - 0.02, 6);
  });

  it('falls apart at once when the word comes after the bolt has landed', () => {
    const { effects, calls } = setup({ enemies: [crawler(5, 0, -10)] });
    effects.predict(EYE, towardMachine(10));
    effects.update(0.3);
    effects.hear({
      by: 1,
      x: 0,
      y: 10.5,
      z: -9.4,
      flags: SHOT_FLAG.enemy | SHOT_FLAG.kill,
      enemy: 5,
    });
    expect(calls.burst[0]?.delay).toBe(0);
  });

  it('does not make a stale landing hold a machine up', () => {
    const { effects, calls } = setup();
    // The only bolt on record is at the end of its range, 40 blocks off, and a long way back.
    effects.predict(EYE, AHEAD);
    effects.hear({
      by: 1,
      x: 0,
      y: 10.5,
      z: -9.4,
      flags: SHOT_FLAG.enemy | SHOT_FLAG.kill,
      enemy: 5,
    });
    expect(calls.burst[0]?.delay as number).toBeLessThanOrEqual(0.5);
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

  it('land when the bolt does: the sparks and the burst wait for its flight', () => {
    const { effects, calls } = setup({ remotes: [SEEN] });
    effects.hear({ by: 2, x: 4, y: 11, z: -22, flags: SHOT_FLAG.enemy | SHOT_FLAG.kill, enemy: 9 });
    const bolt = calls.bolt[0] as (typeof calls.bolt)[number];
    const flight = flightOf(bolt);
    expect(calls.impact[0]?.delay).toBeCloseTo(flight, 6);
    expect(calls.burst[0]?.delay).toBeCloseTo(flight, 6);
  });

  it('throw amber sparks off a machine they hit and burst it when it falls', () => {
    const { effects, calls } = setup({ remotes: [SEEN] });
    effects.hear({ by: 2, x: 4, y: 11, z: -12, flags: SHOT_FLAG.enemy, enemy: 9 });
    expect(calls.impact).toHaveLength(1);
    expect(calls.impact[0]?.color).toBe(FX_COLOR.hit);
    expect(calls.burst).toHaveLength(0);
    effects.hear({ by: 2, x: 4, y: 11, z: -12, flags: SHOT_FLAG.enemy | SHOT_FLAG.kill, enemy: 9 });
    expect(calls.impact).toHaveLength(2);
    expect(calls.burst.map((burst) => burst.at)).toEqual([{ x: 4, y: 11, z: -12 }]);
  });

  it('throw a puff of cream off a creature they hit and let it fall in a cloud of dust', () => {
    const { effects, calls } = setup({ remotes: [SEEN] });
    effects.hear({ by: 2, x: 4, y: 11, z: -12, flags: SHOT_FLAG.wild, enemy: 9 });
    expect(calls.impact).toHaveLength(1);
    expect(calls.impact[0]?.color).toBe(FX_COLOR.wild);
    expect(calls.puff).toHaveLength(0);
    effects.hear({ by: 2, x: 4, y: 11, z: -12, flags: SHOT_FLAG.wild | SHOT_FLAG.kill, enemy: 9 });
    expect(calls.impact).toHaveLength(2);
    expect(calls.burst).toHaveLength(0);
    const flight = flightOf(calls.bolt[1] as (typeof calls.bolt)[number]);
    expect(calls.puff).toEqual([{ at: { x: 4, y: 11, z: -12 }, delay: expect.closeTo(flight, 6) }]);
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
    // With no bolt to wait for, they show at once.
    expect(calls.impact[0]?.delay).toBe(0);
    expect(calls.burst[0]?.delay).toBe(0);
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

describe('a turret’s shot, drawn when the host reports it', () => {
  const CELL = [4, FLOOR, -6] as const;
  /** A bolt that ends on a machine 9 blocks west of the turret, level with its chest. */
  const END = { x: -4.5, y: FLOOR + 0.5, z: -5.5 };

  it('flies from the muzzle of the turret, worked out from its cell and the end of the bolt, in amber', () => {
    const { effects, calls } = setup();
    effects.hear({ by: 0, ...END, flags: 0, enemy: 0, turret: CELL });
    const muzzle = turretMuzzle(...CELL, END.x, END.y, END.z, { x: 0, y: 0, z: 0 });
    expect(calls.bolt).toEqual([{ from: muzzle, to: END, color: FX_COLOR.turret }]);
    expect(calls.muzzle).toHaveLength(1);
    expect(calls.muzzle[0]?.at).toEqual(muzzle);
    expect(calls.muzzle[0]?.color).toBe(FX_COLOR.turret);
    // The muzzle is the gun's reach from the head's pivot, toward the target.
    expect(
      Math.hypot(muzzle.x - 4.5, muzzle.y - (FLOOR + TURRET_GUN.pivot), muzzle.z + 5.5),
    ).toBeCloseTo(TURRET_GUN.reach, 6);
    expect(calls.muzzle[0]?.dir.x).toBeCloseTo(-1, 1);
    expect(calls.impact).toHaveLength(0);
    expect(effects.debug().shots[0]).toMatchObject({ by: 0, predicted: false, turret: CELL });
  });

  it('needs no player: it is drawn whether or not the local player can be read', () => {
    const { effects, calls, leave } = setup();
    leave();
    effects.hear({ by: 0, ...END, flags: 0, enemy: 0, turret: CELL });
    expect(calls.bolt).toHaveLength(1);
  });

  it('throws amber sparks off a machine, and bursts it when it falls, as the bolt lands', () => {
    const { effects, calls } = setup();
    effects.hear({ by: 0, ...END, flags: SHOT_FLAG.enemy, enemy: 9, turret: CELL });
    expect(calls.impact).toHaveLength(1);
    expect(calls.impact[0]?.color).toBe(FX_COLOR.hit);
    expect(calls.burst).toHaveLength(0);
    effects.hear({
      by: 0,
      ...END,
      flags: SHOT_FLAG.enemy | SHOT_FLAG.kill,
      enemy: 9,
      turret: CELL,
    });
    const bolt = calls.bolt[1] as (typeof calls.bolt)[number];
    expect(calls.burst).toHaveLength(1);
    expect(calls.burst[0]?.at).toEqual(END);
    expect(calls.burst[0]?.delay).toBeCloseTo(flightOf(bolt), 6);
  });

  it('throws sparks in amber off a block or the ground that stopped it', () => {
    const { effects, calls } = setup();
    effects.hear({ by: 0, ...END, flags: SHOT_FLAG.world, enemy: 0, turret: CELL });
    expect(calls.impact[0]?.color).toBe(FX_COLOR.turret);
  });

  it('turns the head of the turret toward the end of the bolt', () => {
    const turned: number[][] = [];
    const { effects } = setup({ aimTurret: (...args) => turned.push(args) });
    effects.hear({ by: 0, ...END, flags: 0, enemy: 0, turret: CELL });
    expect(turned).toEqual([[...CELL, END.x, END.y, END.z]]);
  });

  it('does not turn a head for a player’s shot', () => {
    const turned: number[][] = [];
    const { effects } = setup({
      remotes: [remote(2, 2, 4, 0)],
      aimTurret: (...args) => turned.push(args),
    });
    effects.hear({ by: 2, x: 4, y: 11.62, z: -25, flags: 0, enemy: 0 });
    expect(turned).toEqual([]);
  });

  it('draws the bolt as heavy as the gun of the turret’s level, which this screen reads from the cell', () => {
    const OTHER = [CELL[0] + 2, FLOOR, CELL[2]] as const;
    const asked: number[][] = [];
    const { effects, calls } = setup({
      levelOfTurret: (...cell) => {
        asked.push(cell);
        return cell[0] === CELL[0] ? 3 : 1;
      },
    });
    effects.hear({ by: 0, ...END, flags: 0, enemy: 0, turret: CELL });
    effects.hear({ by: 0, ...END, flags: 0, enemy: 0, turret: OTHER });
    expect(asked).toEqual([[...CELL], [...OTHER]]);
    expect(turretLevel(3).heft).toBeGreaterThan(turretLevel(1).heft);
    expect(calls.boltHeft).toEqual([turretLevel(3).heft, turretLevel(1).heft]);
    // The flash at the muzzle is as heavy as the bolt that leaves it, and the record of the shot says how heavy.
    expect(calls.muzzleHeft).toEqual(calls.boltHeft);
    expect(effects.debug().shots.map((shot) => shot.heft)).toEqual(calls.boltHeft);
  });

  it('draws a turret it cannot read the level of as the first, and a player’s shot as a player’s', () => {
    const unread = setup({ levelOfTurret: () => 0 });
    unread.effects.hear({ by: 0, ...END, flags: 0, enemy: 0, turret: CELL });
    const unasked = setup();
    unasked.effects.hear({ by: 0, ...END, flags: 0, enemy: 0, turret: CELL });
    const player = setup({ remotes: [remote(2, 2, 4, 0)], levelOfTurret: () => 3 });
    player.effects.hear({ by: 2, x: 4, y: 11.62, z: -25, flags: 0, enemy: 0 });
    expect(unread.calls.boltHeft).toEqual([turretLevel(1).heft]);
    expect(unasked.calls.boltHeft).toEqual([turretLevel(1).heft]);
    expect(player.calls.boltHeft).toEqual([1]);
    expect(player.calls.muzzleHeft).toEqual([1]);
    expect(player.effects.debug().shots[0]).not.toHaveProperty('heft');
  });
});

describe('what the shots tell the sound', () => {
  const CELL = [4, FLOOR, -6] as const;
  const END = { x: -4.5, y: FLOOR + 0.5, z: -5.5 };

  /** Listens to both observers, keeping what they were told. */
  function listen(effects: ShotEffects) {
    const drawn: ShotLogEntry[] = [];
    const felled: FelledEntry[] = [];
    const stops = [
      effects.onDrawn((shot) => drawn.push(shot)),
      effects.onFelled((end) => felled.push(end)),
    ];
    return { drawn, felled, stops };
  }

  it('tells of the player’s own click at once: from the gun, how long it flies, and the machine it struck', () => {
    const { effects, calls } = setup({ enemies: [crawler(5, 0, -10)] });
    const { drawn, felled } = listen(effects);
    effects.predict(EYE, towardMachine(10));
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({
      by: 1,
      flags: SHOT_FLAG.enemy,
      enemy: 5,
      predicted: true,
      from: gunAt(0, 0),
    });
    expect(drawn[0]?.arrives).toBeCloseTo(
      flightOf(calls.bolt[0] as (typeof calls.bolt)[number]),
      6,
    );
    expect(felled).toEqual([]);
  });

  it('names no machine for a click that struck the ground, and none for one that struck nothing', () => {
    const { effects } = setup();
    const { drawn } = listen(effects);
    effects.predict(EYE, { x: 0, y: -1, z: 0 });
    effects.predict(EYE, AHEAD);
    expect(drawn.map((shot) => [shot.flags, shot.enemy])).toEqual([
      [SHOT_FLAG.world, 0],
      [0, 0],
    ]);
  });

  it('tells nothing of the host’s word on the player’s own click, except where a machine falls apart', () => {
    const { effects } = setup({ enemies: [crawler(5, 0, -10)] });
    const { drawn, felled } = listen(effects);
    effects.predict(EYE, towardMachine(10));
    drawn.length = 0;
    effects.hear({ by: 1, x: 0, y: 10.5, z: -9.4, flags: SHOT_FLAG.enemy, enemy: 5 });
    expect(drawn).toEqual([]);
    expect(felled).toEqual([]);
    effects.update(0.02);
    effects.hear({
      by: 1,
      x: 0,
      y: 10.5,
      z: -9.4,
      flags: SHOT_FLAG.enemy | SHOT_FLAG.kill,
      enemy: 5,
    });
    expect(drawn).toEqual([]);
    expect(felled).toHaveLength(1);
    expect(felled[0]).toMatchObject({ x: 0, y: 10.5, z: -9.4, enemy: 5 });
    // It falls when the bolt that felled it lands, which is a little after the word.
    expect(felled[0]?.after).toBeGreaterThan(0);
    expect(felled[0]?.after).toBeLessThanOrEqual(0.5);
  });

  it('tells of another player’s shot when it is drawn: from their gun, with the time it takes to land', () => {
    const { effects, calls } = setup({ remotes: [remote(2, 2, 4, 0)] });
    const { drawn, felled } = listen(effects);
    effects.hear({ by: 2, x: 4, y: 11, z: -22, flags: SHOT_FLAG.enemy | SHOT_FLAG.kill, enemy: 9 });
    const flight = flightOf(calls.bolt[0] as (typeof calls.bolt)[number]);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({
      by: 2,
      enemy: 9,
      predicted: false,
      from: gunAt(4, 0),
      x: 4,
      y: 11,
      z: -22,
    });
    expect(drawn[0]?.arrives).toBeCloseTo(flight, 6);
    expect(felled).toHaveLength(1);
    expect(felled[0]).toMatchObject({ x: 4, y: 11, z: -22, enemy: 9 });
    expect(felled[0]?.after).toBeCloseTo(flight, 6);
  });

  it('still tells of a shot whose shooter is not on this screen, with no gun and no time to land', () => {
    const { effects } = setup();
    const { drawn, felled } = listen(effects);
    effects.hear({ by: 2, x: 4, y: 10, z: -12, flags: SHOT_FLAG.enemy | SHOT_FLAG.kill, enemy: 9 });
    expect(drawn[0]).toMatchObject({ from: null, arrives: 0, enemy: 9 });
    expect(felled[0]).toMatchObject({ after: 0, enemy: 9 });
  });

  it('tells of a click whose pose cannot be read as having no gun to fire from', () => {
    const { effects, leave } = setup({ enemies: [crawler(5, 0, -10)] });
    const { drawn } = listen(effects);
    leave();
    effects.predict(EYE, towardMachine(10));
    expect(drawn[0]).toMatchObject({ from: null, arrives: 0, enemy: 5 });
  });

  it('tells of a turret’s shot with its cell, the weight of its gun and where the muzzle is', () => {
    const { effects, calls } = setup({ levelOfTurret: () => 3 });
    const { drawn, felled } = listen(effects);
    effects.hear({
      by: 0,
      ...END,
      flags: SHOT_FLAG.enemy | SHOT_FLAG.kill,
      enemy: 9,
      turret: CELL,
    });
    const flight = flightOf(calls.bolt[0] as (typeof calls.bolt)[number]);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({
      by: 0,
      turret: CELL,
      heft: turretLevel(3).heft,
      enemy: 9,
      from: turretMuzzle(...CELL, END.x, END.y, END.z, { x: 0, y: 0, z: 0 }),
    });
    expect(drawn[0]?.arrives).toBeCloseTo(flight, 6);
    expect(felled[0]).toMatchObject({ ...END, enemy: 9 });
    expect(felled[0]?.after).toBeCloseTo(flight, 6);
  });

  it('tells of a machine’s end only when one falls, and of a bolt as many times as it is drawn', () => {
    const { effects } = setup({ remotes: [remote(2, 2, 4, 0)] });
    const { drawn, felled } = listen(effects);
    effects.hear({ by: 2, x: 4, y: 11, z: -12, flags: SHOT_FLAG.enemy, enemy: 9 });
    effects.hear({ by: 2, x: 4, y: 11, z: -12, flags: SHOT_FLAG.world, enemy: 0 });
    expect(drawn).toHaveLength(2);
    expect(felled).toEqual([]);
  });

  it('tells of a bolt that struck a creature as that, and never of a creature as a machine that fell', () => {
    const { effects } = setup({ wildlife: [stag(5, 0, -10)], remotes: [remote(2, 2, 4, 0)] });
    const { drawn, felled } = listen(effects);
    // The player's own click, as this screen sees the stag.
    effects.predict(EYE, towardMachine(10));
    // The host's word that it fell draws no second bolt and tells nothing of a machine's end.
    effects.hear({
      by: 1,
      x: 0,
      y: 10.5,
      z: -9.4,
      flags: SHOT_FLAG.wild | SHOT_FLAG.kill,
      enemy: 5,
    });
    // Another player's bolt on a creature, which falls: a creature's id is not a machine's.
    effects.hear({ by: 2, x: 4, y: 11, z: -12, flags: SHOT_FLAG.wild | SHOT_FLAG.kill, enemy: 9 });
    expect(drawn.map((shot) => [shot.flags, shot.enemy, shot.predicted])).toEqual([
      [SHOT_FLAG.wild, 5, true],
      [SHOT_FLAG.wild | SHOT_FLAG.kill, 9, false],
    ]);
    expect(felled).toEqual([]);
  });

  it('stops telling when a listener lets go, and keeps telling the others', () => {
    const { effects } = setup({ remotes: [remote(2, 2, 4, 0)] });
    const first = listen(effects);
    const second = listen(effects);
    effects.hear({ by: 2, x: 4, y: 11, z: -22, flags: SHOT_FLAG.enemy | SHOT_FLAG.kill, enemy: 9 });
    for (const stop of first.stops) stop();
    effects.hear({ by: 2, x: 4, y: 11, z: -22, flags: SHOT_FLAG.enemy | SHOT_FLAG.kill, enemy: 9 });
    expect([first.drawn.length, first.felled.length]).toEqual([1, 1]);
    expect([second.drawn.length, second.felled.length]).toEqual([2, 2]);
  });

  it('records the same things in the log that it tells', () => {
    const { effects } = setup({ remotes: [remote(2, 2, 4, 0)] });
    const { drawn } = listen(effects);
    effects.hear({ by: 2, x: 4, y: 11, z: -22, flags: SHOT_FLAG.enemy, enemy: 9 });
    expect(effects.debug().shots).toEqual(drawn);
  });
});
