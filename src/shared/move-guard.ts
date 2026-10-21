import { NET } from './net-config';
import { MOVEMENT, PLAYER, jumpSpeed } from './movement';
import type { PlayerSample } from './protocol';
import { pointSolid, type SolidQuery } from './solid';

/**
 * The host's sanity check of a guest's own movement. Guests drive their own controller, so the
 * host does not replay their inputs; it only refuses what the controller could never do: moving
 * faster than top speed allows, climbing faster than a jump, or sitting inside a wall for good.
 * The limits are a bank of allowed movement that refills at top speed times a slack factor, so a
 * burst of delayed packets passes and a speed hack does not.
 */

export type MoveVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'speed' | 'climb' | 'fall' | 'inside-solid' };

const OK: MoveVerdict = { ok: true };
const EPSILON = 0.05;

export class MoveGuard {
  private x = 0;
  private y = 0;
  private z = 0;
  private lastAt = 0;
  private flat = 0;
  private up = 0;
  private down = 0;
  private insideSince: number | null = null;
  private readonly flatRate: number;
  private readonly upRate: number;
  private readonly downRate: number;

  constructor(tuning = MOVEMENT) {
    const slack = NET.move.speedSlack;
    this.flatRate = tuning.sprintSpeed * slack;
    this.upRate = jumpSpeed(tuning) * slack;
    this.downRate = tuning.maxFallSpeed * slack;
    this.refill(Infinity);
  }

  /** The last position that passed, which is where a failed check sends the player back to. */
  get position(): { readonly x: number; readonly y: number; readonly z: number } {
    return { x: this.x, y: this.y, z: this.z };
  }

  /** Believes this position from now on (a join, a respawn, or after a correction). */
  place(x: number, y: number, z: number, now: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.lastAt = now;
    this.insideSince = null;
    this.refill(Infinity);
  }

  /**
   * Takes the player back to the last accepted position after a failed check. The allowance is
   * not refilled: a guest that keeps ignoring corrections must not earn a fresh bank each time.
   */
  restore(now: number): void {
    this.lastAt = now;
    this.insideSince = null;
  }

  private refill(seconds: number): void {
    const cap = NET.move.burstSeconds;
    this.flat = Math.min(this.flatRate * cap, this.flat + this.flatRate * seconds);
    this.up = Math.min(this.upRate * cap, this.up + this.upRate * seconds);
    this.down = Math.min(this.downRate * cap, this.down + this.downRate * seconds);
  }

  /**
   * Checks a report that arrived at `now` (the host's clock, in milliseconds). On `ok` the
   * position is accepted; otherwise nothing changes and the caller moves the player back to
   * `position`.
   */
  check(sample: PlayerSample, now: number, solid: SolidQuery | null): MoveVerdict {
    const elapsed = Math.max(0, Math.min(5000, now - this.lastAt)) / 1000;
    this.lastAt = now;
    this.refill(elapsed);

    // A respawn after falling out of the world is the one jump the host believes.
    if (sample.reset && this.y < NET.move.resetBelowY) {
      this.x = sample.x;
      this.y = sample.y;
      this.z = sample.z;
      this.insideSince = null;
      this.refill(Infinity);
      return OK;
    }

    const dx = sample.x - this.x;
    const dz = sample.z - this.z;
    const dy = sample.y - this.y;
    const flat = Math.hypot(dx, dz);
    if (flat > this.flat + EPSILON) return { ok: false, reason: 'speed' };
    if (dy > this.up + EPSILON) return { ok: false, reason: 'climb' };
    if (-dy > this.down + EPSILON) return { ok: false, reason: 'fall' };

    if (solid) {
      // The middle of the body is inside a block; for a slab or a wedge that means inside the part it fills.
      const buried = pointSolid(solid, sample.x, sample.y + PLAYER.height / 2, sample.z);
      if (buried) {
        this.insideSince ??= now;
        if (now - this.insideSince >= NET.move.insideSolidMs) {
          return { ok: false, reason: 'inside-solid' };
        }
        // Still inside, but not for long: take the movement without moving the safe spot.
        this.flat -= flat;
        this.up -= Math.max(0, dy);
        this.down -= Math.max(0, -dy);
        return OK;
      }
      this.insideSince = null;
    }

    this.flat -= flat;
    this.up -= Math.max(0, dy);
    this.down -= Math.max(0, -dy);
    this.x = sample.x;
    this.y = sample.y;
    this.z = sample.z;
    return OK;
  }
}
