import type { Game } from '../engine/game';
import { createVitalsReading, type VitalsView } from '../shared/vitals-state';

/** What low Energy slows besides the legs: the hands, which build and (later) fight. */
export interface Hands {
  setHandScale(scale: number): void;
}

/**
 * Carries the player's Energy into how they move and work. Once a frame it reads their meters (a
 * host's own from the simulation, a guest's from the mirror of what the host last said, which
 * work the slow-down out by the same rule) and hands the result to the legs and to the hands.
 * Returns what stops it, which also puts the player back to full speed.
 */
export function followVitals(
  game: Pick<Game, 'onFrame' | 'setSpeedScale'>,
  hands: Hands,
  vitals: VitalsView,
): () => void {
  const reading = createVitalsReading();
  const stop = game.onFrame(() => {
    vitals.read(reading);
    game.setSpeedScale(reading.speedScale);
    hands.setHandScale(reading.handScale);
  });
  return () => {
    stop();
    game.setSpeedScale(1);
    hands.setHandScale(1);
  };
}
