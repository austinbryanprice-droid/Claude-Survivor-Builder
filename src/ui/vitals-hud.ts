import type { VitalsReading } from '../shared/vitals-state';
import { clamp01 } from './player-hud/format';
import type { HudStatus } from './player-hud/player-hud';

/**
 * How the HUD shows the player's own meters: the Health segments and the Energy bar in the corner,
 * the tone each bar turns when it runs low, and the round icons under them for what the Core's
 * charge field, low Energy and the shaking of a player who has just come back are doing to them.
 * Plain data in and out, so it runs under Vitest; `player-hud.ts` draws what this returns.
 */

/** Below this share of its bar the player's Health shows as low. */
export const HEALTH_LOW_BELOW = 0.25;

const CHARGING: HudStatus = { icon: 'core', label: 'Charging', tone: 'good' };
const LOW_ENERGY: HudStatus = { icon: 'bolt', label: 'Low energy', tone: 'bad' };
const NO_ENERGY: HudStatus = { icon: 'bolt', label: 'Out of energy', tone: 'bad' };
const SHAKEN: HudStatus = { icon: 'shield', label: 'Shaken', tone: 'bad' };

export interface VitalsForHud {
  /** 0 to 1. */
  readonly health: number;
  readonly healthTone: 'ok' | 'low';
  /** 0 to 1. */
  readonly energy: number;
  readonly energyTone: 'ok' | 'low' | 'empty';
  readonly statuses: readonly HudStatus[];
}

/** Where there is nothing to read yet (no run, or no word from the host): full bars and no icons. */
export const FULL_VITALS: VitalsForHud = {
  health: 1,
  healthTone: 'ok',
  energy: 1,
  energyTone: 'ok',
  statuses: [],
};

/**
 * What the corner draws for a player's meters. Energy is "low" exactly when it is slowing the
 * player (the simulation's own mark, carried in the reading's speed scale), so the icon never says
 * low while the legs and hands are still at full speed.
 */
export function vitalsForHud(reading: VitalsReading): VitalsForHud {
  if (reading.healthMax <= 0 || reading.energyMax <= 0) return FULL_VITALS;
  const health = clamp01(reading.health / reading.healthMax);
  const energy = clamp01(reading.energy / reading.energyMax);
  const energyTone = reading.energy <= 0 ? 'empty' : reading.speedScale < 1 ? 'low' : 'ok';
  const statuses: HudStatus[] = [];
  if (reading.charging) statuses.push(CHARGING);
  if (energyTone === 'empty') statuses.push(NO_ENERGY);
  else if (energyTone === 'low') statuses.push(LOW_ENERGY);
  if (reading.shaken > 0) statuses.push({ ...SHAKEN, seconds: reading.shaken });
  return {
    health,
    healthTone: health < HEALTH_LOW_BELOW ? 'low' : 'ok',
    energy,
    energyTone,
    statuses,
  };
}
