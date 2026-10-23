import { describe, expect, it } from 'vitest';
import { EnemyMirror } from '../../src/net/enemy-mirror';
import {
  ENEMY_FLAG,
  ENEMY_HEALTH_FULL,
  createEnemyState,
  type EnemyPose,
  type EnemyState,
} from '../../src/shared/enemy-state';
import { NET } from '../../src/shared/net-config';

function machine(id: number, x: number, z: number, extra: Partial<EnemyState> = {}): EnemyState {
  return { ...createEnemyState(), id, x, z, ...extra };
}

/** A copy, because the poses a mirror hands out are reused by its next call. */
function look(mirror: EnemyMirror, time: number): EnemyPose[] {
  return mirror.sample(time).map((pose) => ({ ...pose }));
}

function find(poses: readonly EnemyPose[], id: number): EnemyPose | undefined {
  return poses.find((pose) => pose.id === id);
}

describe('the enemy mirror', () => {
  it('has nothing to show before the first report', () => {
    const mirror = new EnemyMirror();
    expect(mirror.count).toBe(0);
    expect(mirror.sample(0)).toEqual([]);
    expect(mirror.sample(123_456)).toEqual([]);
  });

  it('draws a lone report where it was, before and after its time', () => {
    const mirror = new EnemyMirror();
    expect(mirror.push(1000, [machine(1, 5, -3, { yaw: 1, health: 128 })], 1)).toBe(true);
    expect(mirror.count).toBe(1);
    for (const time of [0, 999, 1000, 1500, 99_999]) {
      const [pose] = look(mirror, time);
      expect(pose).toMatchObject({ id: 1, x: 5, z: -3, yaw: 1, speed: 0 });
      expect(pose?.health).toBeCloseTo(128 / ENEMY_HEALTH_FULL, 9);
    }
  });

  it('glides between the two reports that bracket the time', () => {
    const mirror = new EnemyMirror();
    mirror.push(1000, [machine(1, 0, 0, { y: 2 })], 1);
    mirror.push(1100, [machine(1, 2, -1, { y: 3 })], 1);
    const [quarter] = look(mirror, 1025);
    expect(quarter?.x).toBeCloseTo(0.5, 9);
    expect(quarter?.z).toBeCloseTo(-0.25, 9);
    expect(quarter?.y).toBeCloseTo(2.25, 9);
    const [half] = look(mirror, 1050);
    expect(half?.x).toBeCloseTo(1, 9);
    // Blocks a second: (2, -1) in 100 ms is √5 blocks in 0.1 s.
    expect(half?.speed).toBeCloseTo(Math.sqrt(5) * 10, 6);
  });

  it('picks the pair of reports around the time out of a longer history', () => {
    const mirror = new EnemyMirror();
    for (let i = 0; i < 6; i++) mirror.push(1000 + i * 100, [machine(1, i * 2, 0)], 1);
    expect(look(mirror, 1250)[0]?.x).toBeCloseTo(5, 9);
    expect(look(mirror, 1400)[0]?.x).toBeCloseTo(8, 9);
    expect(look(mirror, 1010)[0]?.x).toBeCloseTo(0.2, 9);
  });

  it('turns the short way round', () => {
    const mirror = new EnemyMirror();
    mirror.push(0, [machine(1, 0, 0, { yaw: 3 })], 1);
    mirror.push(100, [machine(1, 0, 0, { yaw: -2.5 })], 1);
    const yaw = look(mirror, 50)[0]?.yaw as number;
    // From 3 to -2.5 the short way passes through π: the pose ends up at about -2.89, not at 0.25.
    expect(yaw).toBeCloseTo(3 + ((2 * Math.PI - 5.5) * 0.5 - 2 * Math.PI), 6);
    expect(Math.abs(yaw)).toBeGreaterThan(2.5);
  });

  it('carries a machine on the way it was going, but not for long', () => {
    const mirror = new EnemyMirror();
    mirror.push(0, [machine(1, 0, 0)], 1);
    mirror.push(100, [machine(1, 1, 0.5)], 1);
    expect(look(mirror, 150)[0]).toMatchObject({ x: 1.5, z: 0.75 });
    const limit = look(mirror, 100 + NET.extrapolateMs)[0] as EnemyPose;
    const later = look(mirror, 100 + NET.extrapolateMs + 10_000)[0] as EnemyPose;
    expect(later.x).toBeCloseTo(limit.x, 9);
    expect(later.z).toBeCloseTo(limit.z, 9);
    expect(limit.speed).toBeCloseTo(Math.hypot(1, 0.5) * 10, 6);
  });

  it('draws a machine that is new in the latest report where it stands, not gliding from nowhere', () => {
    const mirror = new EnemyMirror();
    mirror.push(0, [machine(1, 0, 0)], 1);
    mirror.push(100, [machine(1, 1, 0), machine(2, 30, 30)], 2);
    // Between the two reports the newcomer has no earlier place to glide from, so it is not drawn yet...
    expect(find(look(mirror, 50), 2)).toBeUndefined();
    expect(find(look(mirror, 50), 1)).toBeDefined();
    // ...and once the time is past the report that names it, it stands where the host put it.
    expect(find(look(mirror, 100), 2)).toMatchObject({ x: 30, z: 30, speed: 0 });
  });

  it('stops drawing a machine the newer report no longer names', () => {
    const mirror = new EnemyMirror();
    mirror.push(0, [machine(1, 0, 0), machine(2, 5, 5)], 2);
    mirror.push(100, [machine(1, 1, 0)], 1);
    expect(find(look(mirror, 50), 2)).toBeUndefined();
    expect(find(look(mirror, 150), 2)).toBeUndefined();
    expect(look(mirror, 50)).toHaveLength(1);
  });

  it('shows a jump as a jump: it stays where it was until the time has passed', () => {
    const mirror = new EnemyMirror();
    mirror.push(0, [machine(1, 0, 0)], 1);
    mirror.push(100, [machine(1, NET.snapDistance + 4, 0)], 1);
    const [during] = look(mirror, 50);
    expect(during).toMatchObject({ x: 0, z: 0, speed: 0 });
    const [after] = look(mirror, 100);
    expect(after?.x).toBeCloseTo(NET.snapDistance + 4, 9);
    // Nor does the jump carry on as a run once the time is past the newest report.
    const [past] = look(mirror, 200);
    expect(past?.x).toBeCloseTo(NET.snapDistance + 4, 9);
    expect(past?.speed).toBe(0);
  });

  it('shows the flags of whichever report is nearer in time', () => {
    const mirror = new EnemyMirror();
    mirror.push(0, [machine(1, 0, 0, { flags: ENEMY_FLAG.attack })], 1);
    mirror.push(100, [machine(1, 0, 0, { flags: ENEMY_FLAG.hurt })], 1);
    expect(look(mirror, 20)[0]?.flags).toBe(ENEMY_FLAG.attack);
    expect(look(mirror, 80)[0]?.flags).toBe(ENEMY_FLAG.hurt);
  });

  it('shows the Health of the newer report as a fraction of the full bar', () => {
    const mirror = new EnemyMirror();
    mirror.push(0, [machine(1, 0, 0, { health: 255 })], 1);
    mirror.push(100, [machine(1, 0, 0, { health: 51 })], 1);
    expect(look(mirror, 50)[0]?.health).toBeCloseTo(0.2, 9);
  });

  it('refuses a report that is no newer than the newest, and keeps what it has', () => {
    const mirror = new EnemyMirror();
    expect(mirror.push(100, [machine(1, 1, 1)], 1)).toBe(true);
    expect(mirror.push(100, [machine(1, 9, 9)], 1)).toBe(false);
    expect(mirror.push(40, [machine(1, 9, 9)], 1)).toBe(false);
    expect(mirror.push(Number.NaN, [machine(1, 9, 9)], 1)).toBe(false);
    expect(look(mirror, 100)[0]).toMatchObject({ x: 1, z: 1 });
    expect(mirror.push(101, [machine(1, 2, 2)], 1)).toBe(true);
  });

  it('remembers only the first `count` states, and copies them', () => {
    const mirror = new EnemyMirror();
    const states = [machine(1, 1, 0), machine(2, 2, 0), machine(3, 3, 0)];
    mirror.push(0, states, 2);
    expect(mirror.count).toBe(2);
    // The caller reuses its states for the next report; the mirror has its own.
    states[0]!.x = 99;
    states[1]!.id = 7;
    expect(look(mirror, 0).map((pose) => [pose.id, pose.x])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('lets the first word about a machine named twice in one report stand', () => {
    const mirror = new EnemyMirror();
    mirror.push(0, [machine(4, 1, 0), machine(4, 8, 0), machine(5, 2, 0)], 3);
    expect(mirror.count).toBe(2);
    expect(look(mirror, 0).map((pose) => [pose.id, pose.x])).toEqual([
      [4, 1],
      [5, 2],
    ]);
  });

  it('keeps no more than a short history, and plays the oldest of it standing', () => {
    const mirror = new EnemyMirror();
    const reports = NET.enemyHistory + 5;
    for (let i = 0; i < reports; i++) mirror.push(i * 100, [machine(1, i, 0)], 1);
    const oldestKept = reports - NET.enemyHistory;
    // Before the oldest report still kept there is nothing to go on: it stands where it was.
    expect(look(mirror, 0)[0]?.x).toBe(oldestKept);
    expect(look(mirror, (oldestKept + 0.5) * 100)[0]?.x).toBeCloseTo(oldestKept + 0.5, 9);
  });

  it('forgets everything on `clear`, and takes a report from any time afterwards', () => {
    const mirror = new EnemyMirror();
    mirror.push(5000, [machine(1, 1, 0)], 1);
    mirror.push(5100, [machine(1, 2, 0)], 1);
    mirror.clear();
    expect(mirror.count).toBe(0);
    expect(mirror.sample(5100)).toEqual([]);
    // A new world starts a new clock, which may be behind the old one.
    expect(mirror.push(10, [machine(9, 3, 3)], 1)).toBe(true);
    expect(look(mirror, 10)[0]).toMatchObject({ id: 9, x: 3 });
  });

  it('hands out the same poses again and again, so a frame allocates nothing', () => {
    const mirror = new EnemyMirror();
    mirror.push(0, [machine(1, 0, 0), machine(2, 4, 4)], 2);
    mirror.push(100, [machine(1, 1, 0), machine(2, 5, 4)], 2);
    const first = mirror.sample(50);
    const [a, b] = [first[0], first[1]];
    const second = mirror.sample(60);
    expect(second).toBe(first);
    expect(second[0]).toBe(a);
    expect(second[1]).toBe(b);
  });

  it('never carries a stale pose from a bigger crowd into a smaller one', () => {
    const mirror = new EnemyMirror();
    mirror.push(0, [machine(1, 0, 0), machine(2, 1, 1), machine(3, 2, 2)], 3);
    expect(mirror.sample(0)).toHaveLength(3);
    mirror.push(100, [machine(2, 1, 1)], 1);
    expect(look(mirror, 200).map((pose) => pose.id)).toEqual([2]);
  });

  it('does not take more machines than a packet can hold', () => {
    const mirror = new EnemyMirror();
    const crowd = Array.from({ length: NET.maxEnemies + 40 }, (_, i) => machine(i + 1, i, 0));
    mirror.push(0, crowd, crowd.length);
    expect(mirror.count).toBe(NET.maxEnemies);
  });
});
