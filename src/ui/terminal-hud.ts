import { MATERIALS, baseShape, packState } from '../shared/blocks';
import type { EconomyReading } from '../shared/economy';
import { RESEARCH } from '../systems/economy/balance';
import { nextStep, pointsForTier, tierName } from '../systems/economy/research';
import { INTERACT_KEY, blockIcon } from './build-hud';
import { clamp01 } from './player-hud/format';
import type { HudInteract } from './player-hud/player-hud';
import type { HudLadder, HudLadderRow } from './player-hud/research-ladder';

/**
 * How the HUD shows a Research Terminal (Phase 5d2): the words under the crosshair when the cursor is
 * on one, and the ladder it opens with the interact key. Plain data in and out, so it runs under
 * Vitest; `player-hud/research-ladder.ts` draws what these return. The ladder reads the economy as a
 * screen has it, so a guest sees what the host does, a moment later.
 */

/** "1 point", "20 points". */
export function pointsText(points: number): string {
  return `${points} ${points === 1 ? 'point' : 'points'}`;
}

/** What the interact key would do for a Research Terminal the cursor is on: open its ladder, and say how many points the crew has. */
export function terminalPrompt(reading: EconomyReading): HudInteract {
  return {
    key: INTERACT_KEY,
    label: 'Research ladder',
    detail: reading.cap > 0 ? pointsText(reading.research) : '',
  };
}

/**
 * The ladder: a row for each material the points open, from the one the crew starts with, each
 * open (a Terminal has read the points that reach it), waiting (the crew has earned them and no
 * Terminal has read them) or shut (with how many points to go). The bar is the points earned toward
 * the next row.
 */
export function ladderForHud(reading: EconomyReading): HudLadder {
  const points = reading.research;
  const next = nextStep(points);
  const rows: HudLadderRow[] = [];
  for (const material of MATERIALS) {
    const need = pointsForTier(material.tier);
    if (!Number.isFinite(need)) continue;
    const state = reading.claimed >= need ? 'open' : points >= need ? 'waiting' : 'shut';
    rows.push({
      icon: blockIcon(packState(baseShape('cube'), material.id)),
      name: material.name,
      need: need === 0 ? 'From the start' : pointsText(need),
      state,
      note:
        state === 'open' ? 'Open' : state === 'waiting' ? 'Not read yet' : `${need - points} to go`,
    });
  }
  return {
    title: 'Research Terminal',
    points: String(points),
    caption: points === 1 ? 'point earned' : 'points earned',
    fraction: next ? clamp01(points / next.points) : 1,
    next: next ? `${next.points - points} to ${tierName(next.tier)}` : 'Ladder climbed',
    rows,
    footer: `Each night survived earns ${RESEARCH.perNight}, and ${RESEARCH.cleanNight} more if the Core takes no damage`,
  };
}
