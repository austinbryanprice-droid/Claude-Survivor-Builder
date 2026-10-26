import { MATERIALS } from '../shared/blocks';
import type { HarvestEvent } from '../shared/economy';
import { nightsSurvived, type SurvivalEvent, type SurvivalReading } from '../shared/survival-state';
import { isDown, type VitalsReading } from '../shared/vitals-state';
import { clamp01, formatClock } from './player-hud/format';
import type { HudCharges, HudClock, HudCore, HudDown } from './player-hud/player-hud';

/**
 * How the HUD shows the run: the day and night clock by the compass, the Outpost Core's gauge
 * under it, the objective in the banner, the line on the pause card, the results of a lost run and
 * the message when the light changes or the Core falls. Plain data in and out, so it runs under
 * Vitest; `player-hud.ts` and the results card draw what these return.
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
 * A run that ended with the whole crew down leaves the Core as it stood.
 */
export function coreForHud(reading: SurvivalReading): HudCore | null {
  if (reading.coreMax <= 0) return null;
  const hurt = reading.coreHealth < reading.coreMax;
  if (reading.phase === 'day' && !hurt) return null;
  const fraction = clamp01(reading.coreHealth / reading.coreMax);
  const tone =
    reading.coreHealth <= 0
      ? 'fallen'
      : fraction < CORE_CRITICAL_BELOW
        ? 'critical'
        : fraction < CORE_WORN_BELOW
          ? 'worn'
          : 'sound';
  return { fraction, value: String(reading.coreHealth), tone };
}

/**
 * The crew's respawn charges, as pips under the Core's gauge: quiet while the crew holds all it
 * can in the daytime, and on screen at night, whenever one has been spent, and once the run is
 * over. Null where the run has no crew to count.
 */
export function chargesForHud(reading: SurvivalReading): HudCharges | null {
  if (reading.respawnMax <= 0) return null;
  const full = reading.respawns >= reading.respawnMax;
  if (reading.phase === 'day' && full && !reading.over) return null;
  const count = Math.max(0, reading.respawns);
  return {
    count,
    max: reading.respawnMax,
    tone: count === 0 ? 'empty' : count === 1 ? 'low' : 'ok',
  };
}

/**
 * What the screen of a player who is down says: how long until the Core brings them back, or why
 * they wait, or that the run is over. Null for a player who is up (or where there are no meters).
 */
export function downForHud(vitals: VitalsReading, run: SurvivalReading | null): HudDown | null {
  if (!isDown(vitals)) return null;
  if (run?.over) {
    return {
      title: 'Outpost overrun',
      detail:
        run.overWhy === 'crew'
          ? 'Every player is down and the crew has no respawns left'
          : 'The Outpost Core has fallen',
      seconds: null,
    };
  }
  if (vitals.returnIn > 0) {
    return {
      title: 'You are down',
      detail: 'The Core brings you back in',
      seconds: vitals.returnIn,
    };
  }
  return {
    title: 'You are down',
    detail: 'The crew is out of respawns. The dawn brings more',
    seconds: null,
  };
}

/** What the results card of a lost run shows. */
export interface HudResults {
  /** Nights the crew held out. */
  readonly nights: number;
  /** How the run ended, in a sentence. */
  readonly cause: string;
  /** What the run came to, as the card lists it. */
  readonly stats: readonly { readonly label: string; readonly value: string }[];
}

/**
 * The results of a run that is over: how long the crew held out, how it ended and what it did
 * meanwhile. Null while the run goes on. `research` is the points the crew earned, from the
 * economy, or null where the screen has no economy to ask (the line is then left out).
 */
export function resultsForHud(
  reading: SurvivalReading,
  research: number | null = null,
): HudResults | null {
  if (!reading.over) return null;
  const on = phaseName(reading);
  return {
    nights: nightsSurvived(reading.cycle),
    cause:
      reading.overWhy === 'crew'
        ? `Every player was down on ${on} and the crew had no respawns left.`
        : `The Outpost Core fell on ${on}.`,
    stats: [
      { label: 'Time held', value: formatClock(reading.elapsed) },
      { label: 'Machines destroyed', value: String(reading.felled) },
      { label: 'Blocks placed', value: String(reading.placed) },
      { label: 'Upgrades completed', value: String(reading.upgraded) },
      { label: 'Materials gathered', value: String(reading.gathered) },
      ...(research === null ? [] : [{ label: 'Research earned', value: String(research) }]),
      { label: 'Respawns used', value: String(reading.revived) },
    ],
  };
}

/**
 * The message for a strip the player at this screen made: what went into the pool, and why it was
 * less than the heap offered or why that heap is gone, when it is.
 */
export function harvestMessage(event: HarvestEvent): string {
  const name = MATERIALS.find((material) => material.id === event.material)?.name ?? 'materials';
  const gained = `+${event.gained} ${name}`;
  if (event.full) return `${gained} · the pool is full`;
  return event.left <= 0 ? `${gained} · that heap is stripped bare` : gained;
}

/** The banner at the top right: where the crew stands and what the hour asks of it. */
export function objectiveForRun(reading: SurvivalReading): { place: string; title: string } {
  if (reading.over) {
    return {
      place: PLACE,
      title: reading.overWhy === 'crew' ? 'The whole crew is down' : 'The Outpost Core has fallen',
    };
  }
  return {
    place: PLACE,
    title: reading.phase === 'day' ? 'Build up before nightfall' : 'Hold the outpost until dawn',
  };
}

/** The line on the pause card, so a held clock is not a mystery. A lost run has the results card instead. */
export function runLine(reading: SurvivalReading): string {
  const until = reading.phase === 'day' ? 'until nightfall' : 'until dawn';
  const line = `${phaseName(reading)} · ${formatClock(reading.left)} ${until}`;
  return reading.running ? line : `${line} · the clock waits while you are away`;
}

/**
 * How a message names a player: the id of whoever it speaks of in, the name the room knows them
 * by, or null for the player at this screen, who is spoken to as "you".
 */
export type Namer = (id: number) => string | null;

const NO_NAMES: Namer = () => 'A crewmate';

function charges(count: number): string {
  return `${count} ${count === 1 ? 'respawn' : 'respawns'} left`;
}

/** The message shown when the light changes, a wave is coming, a player goes down or comes back, or the run ends. */
export function messageFor(event: SurvivalEvent, nameOf: Namer = NO_NAMES): string {
  switch (event.k) {
    case 'nightfall':
      return `Night ${event.n} has fallen`;
    case 'wave':
      return `Wave ${event.i} of ${event.of}: ${event.c} ${event.c === 1 ? 'machine' : 'machines'} in ten seconds`;
    case 'dawn':
      return `Dawn breaks on day ${event.n + 1}`;
    case 'overrun':
      return event.why === 'crew' ? 'The whole crew is down' : 'The Outpost Core has fallen';
    case 'down': {
      const name = nameOf(event.p);
      return name === null ? 'You are down' : `${name} is down`;
    }
    case 'back': {
      const name = nameOf(event.p);
      const left = charges(event.c);
      return name === null
        ? `The Core brought you back, shaken · ${left}`
        : `${name} is back, shaken · ${left}`;
    }
  }
}
