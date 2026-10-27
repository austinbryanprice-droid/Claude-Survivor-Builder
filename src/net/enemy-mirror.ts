import {
  ENEMY_HEALTH_FULL,
  createEnemyPose,
  createEnemyState,
  type EnemyPose,
  type EnemyState,
} from '../shared/enemy-state';
import { angleDelta, wrapAngle } from '../shared/look';
import { NET } from '../shared/net-config';

/**
 * A short history of where the machines were, read back a little in the past so the drawn motion
 * is smooth even though the host reports ten times a second. Each report holds every machine at
 * one moment; a machine is drawn between the two reports that bracket the draw time. All times are
 * on one timeline (the host's clock), in milliseconds.
 *
 * A guest fills it from the host's packets. The host fills it from its own simulation after every
 * step, so the host's screen and a guest's go through the same code. The valley's wildlife is
 * reported the same way and has a mirror of its own (the record of a creature is a machine's, its
 * species in `kind`), which holds `NET.maxWildlife` instead of `NET.maxEnemies`.
 */

interface Snapshot {
  time: number;
  count: number;
  readonly states: EnemyState[];
  /** Where each machine's state is in `states`, by id. */
  readonly index: Map<number, number>;
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

export class EnemyMirror {
  /** @param capacity The most entries a report holds: the packet's cap. */
  constructor(private readonly capacity: number = NET.maxEnemies) {}

  /** Oldest first. */
  private readonly history: Snapshot[] = [];
  private readonly spare: Snapshot[] = [];
  private readonly poses: EnemyPose[] = [];
  private readonly slots: EnemyPose[] = [];

  /** How many machines the newest report holds. */
  get count(): number {
    const newest = this.history[this.history.length - 1];
    return newest ? newest.count : 0;
  }

  /**
   * Remembers the first `count` of `states` as the machines were at `time`. Returns false (and
   * remembers nothing) for a report that is no newer than the newest one kept. The states are
   * copied, so the caller may reuse them.
   */
  push(time: number, states: readonly EnemyState[], count: number): boolean {
    const newest = this.history[this.history.length - 1];
    if (newest && !(time > newest.time)) return false;
    const snapshot = this.take();
    snapshot.time = time;
    snapshot.count = 0;
    snapshot.index.clear();
    const n = Math.min(count, states.length, this.capacity);
    for (let i = 0; i < n; i++) {
      const state = states[i] as EnemyState;
      // A machine named twice is the host's mistake; the first word stands.
      if (snapshot.index.has(state.id)) continue;
      const slot = (snapshot.states[snapshot.count] ??= createEnemyState());
      slot.id = state.id;
      slot.kind = state.kind;
      slot.x = state.x;
      slot.y = state.y;
      slot.z = state.z;
      slot.yaw = state.yaw;
      slot.health = state.health;
      slot.flags = state.flags;
      snapshot.index.set(state.id, snapshot.count);
      snapshot.count++;
    }
    this.history.push(snapshot);
    return true;
  }

  /** Forgets everything, for a world that has been replaced. */
  clear(): void {
    for (const snapshot of this.history) this.spare.push(snapshot);
    this.history.length = 0;
    this.poses.length = 0;
  }

  /**
   * Where to draw the machines at `time`. The array and the poses in it are reused: read them
   * before the next call. A machine is drawn from the second report that names it, so one that has
   * just arrived does not glide in from nowhere; one that is gone from the newer report is gone.
   */
  sample(time: number): readonly EnemyPose[] {
    this.poses.length = 0;
    const history = this.history;
    const last = history.length - 1;
    if (last < 0) return this.poses;
    const newest = history[last] as Snapshot;
    if (time >= newest.time) {
      this.extrapolate(newest, history[last - 1], time);
      return this.poses;
    }
    const oldest = history[0] as Snapshot;
    if (time <= oldest.time) {
      this.hold(oldest);
      return this.poses;
    }
    let i = last - 1;
    while (i > 0 && (history[i] as Snapshot).time > time) i--;
    this.between(history[i] as Snapshot, history[i + 1] as Snapshot, time);
    return this.poses;
  }

  private between(a: Snapshot, b: Snapshot, time: number): void {
    const span = b.time - a.time;
    const u = (time - a.time) / span;
    for (let n = 0; n < b.count; n++) {
      const to = b.states[n] as EnemyState;
      const at = a.index.get(to.id);
      if (at === undefined) continue;
      const from = a.states[at] as EnemyState;
      const pose = this.slot();
      pose.id = to.id;
      pose.kind = to.kind;
      pose.health = to.health / ENEMY_HEALTH_FULL;
      pose.flags = u < 0.5 ? from.flags : to.flags;
      const hop = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      if (hop > NET.snapDistance) {
        // A jump, not a walk: show it where it was until the time has passed.
        this.place(pose, from, 0);
        continue;
      }
      pose.x = lerp(from.x, to.x, u);
      pose.y = lerp(from.y, to.y, u);
      pose.z = lerp(from.z, to.z, u);
      pose.yaw = wrapAngle(from.yaw + angleDelta(from.yaw, to.yaw) * u);
      pose.speed = (Math.hypot(to.x - from.x, to.z - from.z) / span) * 1000;
    }
  }

  /** Before the oldest report there is nothing to go on: show it as it was, standing. */
  private hold(snapshot: Snapshot): void {
    for (let n = 0; n < snapshot.count; n++) {
      const state = snapshot.states[n] as EnemyState;
      const pose = this.slot();
      this.place(pose, state, 0);
      pose.health = state.health / ENEMY_HEALTH_FULL;
    }
  }

  /** Past the newest report, carry each machine on the way it was going for a little while. */
  private extrapolate(newest: Snapshot, before: Snapshot | undefined, time: number): void {
    const ahead = Math.min(time - newest.time, NET.extrapolateMs);
    const span = before ? newest.time - before.time : 0;
    for (let n = 0; n < newest.count; n++) {
      const state = newest.states[n] as EnemyState;
      const pose = this.slot();
      this.place(pose, state, 0);
      pose.health = state.health / ENEMY_HEALTH_FULL;
      const at = before ? before.index.get(state.id) : undefined;
      if (!before || at === undefined || !(span > 0)) continue;
      const from = before.states[at] as EnemyState;
      const vx = (state.x - from.x) / span;
      const vz = (state.z - from.z) / span;
      if (Math.hypot(state.x - from.x, state.y - from.y, state.z - from.z) > NET.snapDistance) {
        continue;
      }
      pose.x = state.x + vx * ahead;
      pose.z = state.z + vz * ahead;
      pose.y = state.y + ((state.y - from.y) / span) * ahead;
      pose.speed = Math.hypot(vx, vz) * 1000;
    }
  }

  private place(pose: EnemyPose, state: EnemyState, speed: number): void {
    pose.id = state.id;
    pose.kind = state.kind;
    pose.x = state.x;
    pose.y = state.y;
    pose.z = state.z;
    pose.yaw = state.yaw;
    pose.speed = speed;
    pose.flags = state.flags;
  }

  private slot(): EnemyPose {
    const pose = (this.slots[this.poses.length] ??= createEnemyPose());
    this.poses.push(pose);
    return pose;
  }

  private take(): Snapshot {
    if (this.history.length >= NET.enemyHistory) {
      const oldest = this.history.shift() as Snapshot;
      this.spare.push(oldest);
    }
    return this.spare.pop() ?? { time: 0, count: 0, states: [], index: new Map() };
  }
}
