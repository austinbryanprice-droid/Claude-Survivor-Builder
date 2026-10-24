import { nightsSurvived, type SurvivalEvent, type SurvivalReading } from '../shared/survival-state';
import { clamp01, formatClock } from './player-hud/format';
import type { HudClock, HudCore } from './player-hud/player-hud';

/**
 * How the HUD shows the run: the day and night clock by the compass, the Outpost Core's gauge
 * under it, the objective in the banner, the line on the pause card and the message when the light
 * changes or the Core falls. Plain data in and out, so it runs under Vitest; `player-hud.ts` draws
 * what these return.
 */

/** The clock turns urgent this many seconds before the light changes. */
export const CLOCK_SOON_SECONDS = 30;

/** Below this share of its health the Core's gauge turns amber, and below the second it turns red. */
export const CORE_WORN_BELOW = 0.5;
export const CORE_CRITICAL_BELOW = 0.25;

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
    soon: !reading.over && reading.left <= CLOCK_SOON_SECONDS,
  };
}

/**
 * The Core's gauge: quiet while it is whole in the daytime, and on screen whenever it matters,
 * which is all night, whenever it is hurt, and once it has fallen. Null where the run has no Core.
 */
export function coreForHud(reading: SurvivalReading): HudCore | null {
  if (reading.coreMax <= 0) return null;
  const hurt = reading.coreHealth < reading.coreMax;
  if (reading.phase === 'day' && !hurt && !reading.over) return null;
  const fraction = clamp01(reading.coreHealth / reading.coreMax);
  const tone =
    reading.over || reading.coreHealth <= 0
      ? 'fallen'
      : fraction < CORE_CRITICAL_BELOW
        ? 'critical'
        : fraction < CORE_WORN_BELOW
          ? 'worn'
          : 'sound';
  return { fraction, value: String(reading.coreHealth), tone };
}

/** The banner at the top right: where the crew stands and what the hour asks of it. */
export function objectiveForRun(reading: SurvivalReading): { place: string; title: string } {
  if (reading.over) return { place: PLACE, title: 'The Outpost Core has fallen' };
  return {
    place: PLACE,
    title: reading.phase === 'day' ? 'Build up before nightfall' : 'Hold the outpost until dawn',
  };
}

/** The line on the pause card, so a held clock is not a mystery. */
export function runLine(reading: SurvivalReading): string {
  if (reading.over) {
    const nights = nightsSurvived(reading.cycle);
    return `Outpost Overrun on ${phaseName(reading)} · ${nights} ${nights === 1 ? 'night' : 'nights'} survived`;
  }
  const until = reading.phase === 'day' ? 'until nightfall' : 'until dawn';
  const line = `${phaseName(reading)} · ${formatClock(reading.left)} ${until}`;
  return reading.running ? line : `${line} · the clock waits while you are away`;
}

/** The message shown when the light changes, a wave is coming or the Core falls. */
export function messageFor(event: SurvivalEvent): string {
  switch (event.k) {
    case 'nightfall':
      return `Night ${event.n} has fallen`;
    case 'wave':
      return `Wave ${event.i} of ${event.of}: ${event.c} ${event.c === 1 ? 'machine' : 'machines'} in ten seconds`;
    case 'dawn':
      return `Dawn breaks on day ${event.n + 1}`;
    case 'overrun':
      return 'The Outpost Core has fallen';
  }
}
