import { MATERIALS, MODULES, baseShape, packState } from '../shared/blocks';
import type { EconomyReading } from '../shared/economy';
import { RESEARCH } from '../systems/economy/balance';
import { RESEARCH_GROUPS, nextRow, pointsForTier } from '../systems/economy/research';
import { INTERACT_KEY, blockIcon, moduleIcon } from './build-hud';
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
 * The ladder: a row for each material the points open, from the one the crew starts with, and a row
 * for each group of modules (Power, which holds the Generator), in the order the points reach them,
 * each open (a Terminal has read the points that reach it), waiting (the crew has earned them and no
 * Terminal has read them) or shut (with how many points to go). The bar is the points earned toward
 * the next row.
 */
export function ladderForHud(reading: EconomyReading): HudLadder {
  const points = reading.research;
  const next = nextRow(points);
  const rows: { readonly at: number; readonly row: HudLadderRow }[] = [];
  const stand = (need: number): HudLadderRow['state'] =>
    reading.claimed >= need ? 'open' : points >= need ? 'waiting' : 'shut';
  const note = (state: HudLadderRow['state'], need: number): string =>
    state === 'open' ? 'Open' : state === 'waiting' ? 'Not read yet' : `${need - points} to go`;
  for (const material of MATERIALS) {
    const need = pointsForTier(material.tier);
    if (!Number.isFinite(need)) continue;
    const state = stand(need);
    rows.push({
      at: need,
      row: {
        icon: blockIcon(packState(baseShape('cube'), material.id)),
        name: material.name,
        need: need === 0 ? 'From the start' : pointsText(need),
        state,
        note: note(state, need),
      },
    });
  }
  for (const group of RESEARCH_GROUPS) {
    const state = stand(group.points);
    const names = group.modules.map((id) => MODULES.find((module) => module.id === id)?.name ?? '');
    rows.push({
      at: group.points,
      row: {
        icon: group.modules[0] === undefined ? null : moduleIcon(group.modules[0]),
        name: group.name,
        need: `${pointsText(group.points)} · ${names.filter(Boolean).join(', ')}`,
        state,
        note: note(state, group.points),
      },
    });
  }
  return {
    title: 'Research Terminal',
    points: String(points),
    caption: points === 1 ? 'point earned' : 'points earned',
    fraction: next ? clamp01(points / next.points) : 1,
    next: next ? `${next.points - points} to ${next.name}` : 'Ladder climbed',
    rows: rows.sort((a, b) => a.at - b.at).map(({ row }) => row),
    footer: `Each night survived earns ${RESEARCH.perNight}, and ${RESEARCH.cleanNight} more if the Core takes no damage`,
  };
}
