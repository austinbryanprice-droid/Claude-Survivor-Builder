import { angleDelta, wrapAngle } from './look';
import { NET } from './net-config';
import type { PlayerSample } from './protocol';

/**
 * A short history of one remote player's samples, read back a little in the past so the drawn
 * motion is smooth even though the samples arrive in lumps. All times are on one timeline
 * (the sender's clock, or the host's), in milliseconds.
 */

interface Stamped {
  t: number;
  s: PlayerSample;
}

/** Where to draw the player; the same fields as `RemotePose` minus the identity. */
export interface PoseOut {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
  onGround: boolean;
}

export function createPoseOut(): PoseOut {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, onGround: true };
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

function copySample(sample: PlayerSample): PlayerSample {
  return { ...sample };
}

export class RemoteTrack {
  private readonly samples: Stamped[] = [];

  get length(): number {
    return this.samples.length;
  }

  /** Time of the newest sample, or -Infinity when the track is empty. */
  get newestTime(): number {
    const last = this.samples[this.samples.length - 1];
    return last ? last.t : -Infinity;
  }

  /** Adds a sample. Returns false when it is a duplicate or older than everything kept. */
  push(t: number, sample: PlayerSample): boolean {
    const list = this.samples;
    const first = list[0];
    if (first && t < first.t && list.length >= NET.trackLength) return false;
    let at = list.length;
    while (at > 0 && (list[at - 1] as Stamped).t > t) at--;
    const before = list[at - 1];
    if (before && Math.abs(before.t - t) < 0.5) return false;
    list.splice(at, 0, { t, s: copySample(sample) });
    if (list.length > NET.trackLength) list.shift();
    return true;
  }

  clear(): void {
    this.samples.length = 0;
  }

  /** Writes the pose at `time` into `out`. False when there are no samples at all. */
  sample(time: number, out: PoseOut): boolean {
    const list = this.samples;
    const newest = list[list.length - 1];
    const oldest = list[0];
    if (!newest || !oldest) return false;

    if (time <= oldest.t) {
      this.hold(oldest.s, out);
      return true;
    }
    if (time >= newest.t) {
      this.extrapolate(newest.s, Math.min(time - newest.t, NET.extrapolateMs), out);
      return true;
    }

    let i = list.length - 2;
    while (i > 0 && (list[i] as Stamped).t > time) i--;
    const a = list[i] as Stamped;
    const b = list[i + 1] as Stamped;
    const hop = Math.hypot(b.s.x - a.s.x, b.s.y - a.s.y, b.s.z - a.s.z);
    if (b.s.reset || hop > NET.snapDistance) {
      this.hold(a.s, out);
      return true;
    }
    const u = (time - a.t) / (b.t - a.t);
    out.x = lerp(a.s.x, b.s.x, u);
    out.y = lerp(a.s.y, b.s.y, u);
    out.z = lerp(a.s.z, b.s.z, u);
    out.yaw = wrapAngle(a.s.yaw + angleDelta(a.s.yaw, b.s.yaw) * u);
    out.pitch = lerp(a.s.pitch, b.s.pitch, u);
    out.speed = Math.hypot(lerp(a.s.vx, b.s.vx, u), lerp(a.s.vz, b.s.vz, u));
    out.onGround = u < 0.5 ? a.s.onGround : b.s.onGround;
    return true;
  }

  private hold(s: PlayerSample, out: PoseOut): void {
    out.x = s.x;
    out.y = s.y;
    out.z = s.z;
    out.yaw = s.yaw;
    out.pitch = s.pitch;
    out.speed = Math.hypot(s.vx, s.vz);
    out.onGround = s.onGround;
  }

  /** Carries the newest sample forward on its velocity; a player standing on the ground keeps their height. */
  private extrapolate(s: PlayerSample, ahead: number, out: PoseOut): void {
    const seconds = ahead / 1000;
    out.x = s.x + s.vx * seconds;
    out.z = s.z + s.vz * seconds;
    out.y = s.onGround ? s.y : s.y + s.vy * seconds;
    out.yaw = s.yaw;
    out.pitch = s.pitch;
    out.speed = Math.hypot(s.vx, s.vz);
    out.onGround = s.onGround;
  }
}
