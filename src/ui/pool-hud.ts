import type { EconomyReading } from '../shared/economy';

/**
 * How the HUD tells of the room in the crew's pool (Phase 5h1): whether a material's count on the
 * hotbar is at the most the pool holds, and a message when that most changes because a Storage was
 * built or lost. Plain data in and out, so it runs under Vitest; `player-hud.ts` draws what these
 * return. Everything reads the economy as a screen has it, so a guest sees what the host does, a
 * moment later.
 */

/** True when the pool holds as much of a material as it can, so the count on its hotbar slot turns amber. False where there is no pool. */
export function poolFull(stock: number, cap: number): boolean {
  return cap > 0 && stock >= cap;
}

const NO_MESSAGES: readonly string[] = [];

/**
 * Watches the most the pool holds of a material and says when it changes: a Storage raised it, or one
 * was lost and it fell. The first look, a screen that has not heard the host yet and a run that starts
 * over (the research points fall with the ceiling) are not changes.
 */
export class PoolWatcher {
  private cap = -1;
  private research = 0;

  /** The messages for what changed; none when nothing did. The array is not yours to keep. */
  update(reading: EconomyReading): readonly string[] {
    if (reading.cap <= 0) {
      this.cap = -1;
      return NO_MESSAGES;
    }
    let messages = NO_MESSAGES;
    if (this.cap > 0 && reading.cap !== this.cap && reading.research >= this.research) {
      messages = [
        reading.cap > this.cap
          ? `Storage built · the pool holds ${reading.cap} of each`
          : `A Storage is gone · the pool holds ${reading.cap} of each`,
      ];
    }
    this.cap = reading.cap;
    this.research = reading.research;
    return messages;
  }
}
