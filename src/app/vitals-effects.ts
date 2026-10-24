import type { Game } from '../engine/game';
import { createVitalsReading, isDown, type VitalsView } from '../shared/vitals-state';

/** What low Energy slows besides the legs, and going down stops: the hands, which build and fight. */
export interface Hands {
  setHandScale(scale: number): void;
  /** A player who is down has no use of their hands: clicks do nothing. */
  setDown(down: boolean): void;
}

/**
 * Carries the player's meters into how they move and work. Once a frame it reads them (a host's
 * own from the simulation, a guest's from the mirror of what the host last said, which work the
 * slow-down out by the same rule) and hands the result to the legs and to the hands: low Energy
 * slows both, and a player at no Health lies still with idle hands until the Core brings them
 * back. Returns what stops it, which also puts the player back to full speed and on their feet.
 */
export function followVitals(
  game: Pick<Game, 'onFrame' | 'setSpeedScale' | 'setFrozen'>,
  hands: Hands,
  vitals: VitalsView,
): () => void {
  const reading = createVitalsReading();
  const stop = game.onFrame(() => {
    vitals.read(reading);
    const down = isDown(reading);
    game.setSpeedScale(reading.speedScale);
    game.setFrozen(down);
    hands.setHandScale(reading.handScale);
    hands.setDown(down);
  });
  return () => {
    stop();
    game.setSpeedScale(1);
    game.setFrozen(false);
    hands.setHandScale(1);
    hands.setDown(false);
  };
}
