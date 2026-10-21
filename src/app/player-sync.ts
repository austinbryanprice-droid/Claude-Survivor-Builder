import type { GameSession, Unsubscribe } from '../net/session';
import { createPlayerSample, type PlayerSample } from '../shared/protocol';

/** The game's own player, as the network sees it. */
export interface LocalPlayer {
  /** Fills `out` with where the player is and how it moves; false while there is no player to report. */
  read(out: PlayerSample): boolean;
  /** Moves the player on purpose: the host put it back, or it respawned. */
  teleport(x: number, y: number, z: number): void;
}

/** Nothing walks, jumps or falls this far in one report, so a move longer than this was a teleport. */
const JUMP_BASE_METERS = 3;
/** Faster than the terminal fall speed (55 m/s), so real motion never counts as a jump. */
const JUMP_SPEED = 60;

/**
 * Carries the local player to the session and the host's corrections back to the player. Call
 * `update` once per frame; the session decides how often to actually send.
 */
export class PlayerSync {
  private readonly sample = createPlayerSample();
  private readonly stop: Unsubscribe;
  private hasLast = false;
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private pendingReset = true;

  constructor(
    private readonly session: Pick<GameSession, 'publishState' | 'onCorrection'>,
    private readonly player: LocalPlayer,
  ) {
    this.stop = session.onCorrection((correction) => {
      player.teleport(correction.x, correction.y, correction.z);
      this.pendingReset = true;
    });
  }

  update(dt: number): void {
    const s = this.sample;
    s.reset = false;
    if (!this.player.read(s)) return;
    if (this.hasLast) {
      const dx = s.x - this.lastX;
      const dy = s.y - this.lastY;
      const dz = s.z - this.lastZ;
      const limit = JUMP_BASE_METERS + JUMP_SPEED * Math.max(0, dt);
      if (dx * dx + dy * dy + dz * dz > limit * limit) s.reset = true;
    }
    if (this.pendingReset) {
      s.reset = true;
      this.pendingReset = false;
    }
    this.lastX = s.x;
    this.lastY = s.y;
    this.lastZ = s.z;
    this.hasLast = true;
    this.session.publishState(s);
  }

  dispose(): void {
    this.stop();
  }
}
