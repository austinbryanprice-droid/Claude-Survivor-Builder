import type { CellState } from '../shared/block-world';
import { MATERIALS, moduleOfShape, stateShape } from '../shared/blocks';
import type { EconomyReading } from '../shared/economy';
import { pieceCost } from '../systems/economy/build-rules';
import {
  RESEARCH_ROWS,
  moduleLock,
  nextRow,
  researchLock,
  rowsReached,
} from '../systems/economy/research';
import { clamp01 } from './player-hud/format';
import type { HudResearch } from './player-hud/player-hud';

/**
 * How the HUD shows the crew's research (Phase 5c): the pill under the respawns, the padlock on a
 * hotbar slot whose material is not researched yet, the words under the piece in hand, and the
 * messages when points arrive and when they open a material. Points open a material only once a
 * Research Terminal has read them (5d2), so these words tell the earned points from the opened
 * ones, and say when the only thing missing is a Terminal. Plain data in and out, so it runs under
 * Vitest; `player-hud.ts` draws what these return. Every function reads the economy as a screen
 * has it, so a guest sees what the host does, a moment later.
 */

/** What the HUD says when the crew has earned points that reach a row of the ladder and no Terminal has read them. */
export const TERMINAL_NEEDED = 'Needs a Research Terminal';

/** How long the pill stays up after the points change, when Build Mode is not on, in seconds. */
export const RESEARCH_SECONDS = 10;

/** True when the points the crew has earned reach a row of the ladder that the points a Terminal has read do not: only a Terminal is missing. */
export function researchWaiting(points: number, claimed: number): boolean {
  return RESEARCH_ROWS.some((row) => row.points <= points && row.points > claimed);
}

/**
 * The pill: the points earned, how far they are from the next row of the ladder, and, when a row
 * they reach is shut for want of a Terminal, the words that say so. `claimed` is the part of the
 * points a Terminal has read; it defaults to all of them.
 */
export function researchForHud(points: number, gains = 0, claimed = points): HudResearch {
  const next = nextRow(points);
  const waiting = researchWaiting(points, claimed);
  const label = waiting ? 'Needs Terminal' : 'Research';
  if (!next) {
    return {
      points,
      fraction: 1,
      value: String(points),
      label,
      tone: waiting ? 'waiting' : 'full',
      gains,
    };
  }
  return {
    points,
    fraction: clamp01(points / next.points),
    value: `${points}/${next.points}`,
    label,
    tone: waiting ? 'waiting' : 'rising',
    gains,
  };
}

/**
 * Decides when the pill is on screen: always in Build Mode (where the materials are chosen), and for
 * `RESEARCH_SECONDS` after the points change. It counts the rises, so the pill can flash for each
 * one however it came on screen.
 */
export class ResearchPill {
  private last = -1;
  private left = 0;
  private gains = 0;

  /** Advances the timer by `dt` seconds and returns the pill to draw, or null for none. */
  update(dt: number, reading: EconomyReading, buildMode: boolean): HudResearch | null {
    if (reading.cap <= 0) {
      this.last = -1;
      this.left = 0;
      return null;
    }
    // The first look is not a change: the page just opened, or a guest has just heard the host.
    if (this.last >= 0 && reading.research !== this.last) {
      this.left = RESEARCH_SECONDS;
      if (reading.research > this.last) this.gains++;
    } else {
      this.left = Math.max(0, this.left - dt);
    }
    this.last = reading.research;
    return buildMode || this.left > 0
      ? researchForHud(reading.research, this.gains, reading.claimed)
      : null;
  }
}

const NO_MESSAGES: readonly string[] = [];

/**
 * Watches the crew's research and says what changed since it last looked: the points that arrived,
 * the rows a Terminal has opened, a material or a group of modules (at a dawn, or the moment one is
 * placed), and that points are waiting for a Terminal to read them. The first look, a screen that has
 * not heard the host yet and a run that starts over (the points fall) are not changes.
 */
export class ResearchWatcher {
  private points = -1;
  private claimed = 0;

  /** The messages for what changed, in the order to show them; none when nothing did. The array is not yours to keep. */
  update(reading: EconomyReading): readonly string[] {
    if (reading.cap <= 0) {
      this.points = -1;
      return NO_MESSAGES;
    }
    let messages = NO_MESSAGES;
    if (this.points >= 0) {
      const gained = reading.research - this.points;
      const said: string[] = [];
      if (gained > 0) said.push(`Research +${gained}`);
      for (const row of rowsReached(this.claimed, reading.claimed)) {
        said.push(`${row.name} unlocked`);
      }
      if (gained > 0 && researchWaiting(reading.research, reading.claimed)) {
        said.push(TERMINAL_NEEDED);
      }
      if (said.length > 0) messages = said;
    }
    this.points = reading.research;
    this.claimed = reading.claimed;
    return messages;
  }
}

/** Why the material of a piece is closed to the crew: its name, the points the crew has earned, the points that open it and whether a Terminal is all that is missing. */
export interface HudLock {
  readonly name: string;
  readonly have: number;
  readonly need: number;
  /** True when the points earned already reach `need`: no Terminal has read them yet. */
  readonly terminal: boolean;
}

/**
 * The lock on a piece, or null when it is open, the slot holds no piece or there is no pool to be locked
 * out of. A block is closed while its material is; a module's cell byte is its level, not a material, so
 * for one it is the material its level is paid in (a raise to the Auto Turret is closed while Reinforced
 * Composite is, and a Terminal or a Basic Turret, paid in Scrap, never is) and then the group of research
 * the module belongs to, which names the module (the Generator waits for Power).
 */
export function lockForPiece(piece: CellState, reading: EconomyReading): HudLock | null {
  if (reading.cap <= 0) return null;
  const cost = pieceCost(piece);
  const material = cost && MATERIALS.find((m) => m.id === cost.material);
  if (!material) return null;
  const lock = researchLock(material.id, reading.claimed);
  if (lock) {
    return {
      name: material.name,
      have: reading.research,
      need: lock.need,
      terminal: reading.research >= lock.need,
    };
  }
  const module = moduleOfShape(stateShape(piece));
  const closed = module && moduleLock(module.id, reading.claimed);
  if (!module || !closed) return null;
  return {
    name: module.name,
    have: reading.research,
    need: closed.need,
    terminal: reading.research >= closed.need,
  };
}

/** True when the material of a hotbar slot is closed to the crew, so the slot is drawn dim behind a padlock. */
export function slotLocked(material: number, reading: EconomyReading): boolean {
  return reading.cap > 0 && researchLock(material, reading.claimed) !== null;
}

/** True when the group of research a module (a `MODULE` id) belongs to is closed to the crew, so the module slot is drawn dim behind a padlock. */
export function moduleSlotLocked(module: number, reading: EconomyReading): boolean {
  return reading.cap > 0 && moduleLock(module, reading.claimed) !== null;
}

/** The words under a piece that is closed: how many points the crew has and how many open it, or that a Terminal has to read the points it has. */
export function lockText(lock: HudLock): string {
  return lock.terminal ? TERMINAL_NEEDED : `Needs research · ${lock.have} of ${lock.need}`;
}
