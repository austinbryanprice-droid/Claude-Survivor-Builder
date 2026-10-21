import type { SurvivalEvent, SurvivalReading } from '../shared/survival-state';
import { formatClock } from './player-hud/format';
import type { HudClock } from './player-hud/player-hud';

/**
 * How the HUD shows the run: the day and night clock by the compass, the objective in the banner,
 * the line on the pause card and the message when the light changes. Plain data in and out, so it
 * runs under Vitest; `player-hud.ts` draws what these return.
 */

/** The clock turns urgent this many seconds before the light changes. */
export const CLOCK_SOON_SECONDS = 30;

const PLACE = 'The Ashbound Outpost';

function phaseName(reading: SurvivalReading): string {
  return `${reading.phase === 'day' ? 'Day' : 'Night'} ${reading.cycle}`;
}

/** The pill under the compass: which day or night, and how long until the light changes. */
export function clockForHud(reading: SurvivalReading): HudClock {
  const length = reading.into + reading.left;
  return {
    phase: reading.phase,
    label: phaseName(reading),
    time: formatClock(reading.left),
    progress: length > 0 ? Math.min(1, Math.max(0, reading.into / length)) : 0,
    soon: reading.left <= CLOCK_SOON_SECONDS,
  };
}

/** The banner at the top right: where the crew stands and what the hour asks of it. */
export function objectiveForRun(reading: SurvivalReading): { place: string; title: string } {
  return {
    place: PLACE,
    title: reading.phase === 'day' ? 'Build up before nightfall' : 'Hold the outpost until dawn',
  };
}

/** The line on the pause card, so a held clock is not a mystery. */
export function runLine(reading: SurvivalReading): string {
  const until = reading.phase === 'day' ? 'until nightfall' : 'until dawn';
  const line = `${phaseName(reading)} · ${formatClock(reading.left)} ${until}`;
  return reading.running ? line : `${line} · the clock waits while you are away`;
}

/** The message shown when the light changes. */
export function messageFor(event: SurvivalEvent): string {
  switch (event.k) {
    case 'nightfall':
      return `Night ${event.n} has fallen`;
    case 'dawn':
      return `Dawn breaks on day ${event.n + 1}`;
  }
}
