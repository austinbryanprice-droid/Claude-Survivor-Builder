import type { CellState } from '../shared/block-world';
import { MATERIAL, materialOf, pieceName } from '../shared/blocks';
import { AIM_REFUSAL } from '../shared/build-aim';
import type { HotbarSlot, HudPrompt } from './player-hud/player-hud';
import type { IconId } from './player-hud/icons';

/**
 * How the HUD shows the building hands: the block icons of the hotbar, the words for why a click
 * would not work, the caption above the hotbar and the key legend of Build Mode. Everything here is
 * plain data in and out, so it runs under Vitest; `player-hud.ts` draws what these return.
 */

/** What the HUD needs to know about the building hands (the app's build controller provides it). */
export interface BuildHudInput {
  readonly selected: number;
  readonly buildMode: boolean;
  /** The piece the selected slot places, or 0 when the slot holds no block. */
  readonly piece: CellState;
  readonly crosshair: 'none' | 'place' | 'blocked';
  /** Why a click would do nothing right now, as a code or as the host's words, or null. */
  readonly refusal: string | null;
}

export interface BuildHudSource {
  /** The piece each hotbar slot places, from the first slot; 0 for a slot that holds no block. */
  readonly pieces: readonly CellState[];
  hudState(): BuildHudInput;
}

const BLOCK_ICONS: Readonly<Record<number, IconId>> = {
  [MATERIAL.scrap]: 'block-scrap',
  [MATERIAL.composite]: 'block-composite',
  [MATERIAL.alloy]: 'block-alloy',
  [MATERIAL.energy]: 'block-energy',
};

/** The icon of a piece, or null for a state the HUD has no picture of. */
export function blockIcon(piece: CellState): IconId | null {
  const material = materialOf(piece);
  return (material && BLOCK_ICONS[material.id]) || null;
}

/** The hotbar slot that holds a piece: its icon on the cyan grid of placeable items. */
export function blockSlot(piece: CellState): HotbarSlot {
  return { icon: blockIcon(piece), blueprint: true };
}

/** What a piece costs, such as "1 Scrap"; the number comes from the material table. */
export function costText(piece: CellState): string {
  const material = materialOf(piece);
  return material ? `${material.cost} ${material.name}` : '';
}

/** Why a click does nothing, in a short sentence. The world's and the aim's codes are listed; the host's words pass through. */
const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  occupied: 'Something is already there',
  buried: 'That spot is inside the ground',
  unsupported: 'Needs ground or a block to rest on',
  'out-of-bounds': 'Past the edge of the build area',
  'unknown-block': 'That piece is not available',
  empty: 'Nothing to break there',
  'not-ready': 'Still connecting',
  [AIM_REFUSAL.outOfReach]: 'Out of reach',
  [AIM_REFUSAL.inTheWay]: 'A player is in the way',
};

export function refusalText(code: string): string {
  const known = REFUSAL_TEXT[code];
  if (known) return known;
  return code.charAt(0).toUpperCase() + code.slice(1);
}

/** How long the name of a newly chosen piece stays up outside Build Mode, in seconds. */
export const NAME_SECONDS = 1.6;

/** One line of a key list: the keys and what they do. */
export interface KeyRow {
  readonly keys: readonly string[];
  readonly label: string;
}

/** The keys of Build Mode; the status panel lists them while the mode is on. */
export const BUILD_KEYS: readonly KeyRow[] = [
  { keys: ['LMB'], label: 'Break' },
  { keys: ['RMB'], label: 'Place' },
  { keys: ['1–8'], label: 'Choose a block' },
  { keys: ['Wheel'], label: 'Next block' },
  { keys: ['B'], label: 'Leave Build Mode' },
  { keys: ['Esc'], label: 'Free the mouse' },
];

/**
 * Works out the caption above the hotbar. It names the piece in hand with its cost, in Build Mode
 * and for a moment after the choice changes, and shows why a click would do nothing, in red, for
 * as long as the controller reports it.
 */
export class BuildPromptTracker {
  private lastSelected = -1;
  private lastPiece: CellState = 0;
  private nameLeft = 0;
  private readonly prompt: { title: string; detail: string; tone: 'info' | 'warn' } = {
    title: '',
    detail: '',
    tone: 'info',
  };

  /** Advances the timers by `dt` seconds and returns the caption to show, or null for none. The object is reused. */
  update(dt: number, state: BuildHudInput): HudPrompt | null {
    if (state.selected !== this.lastSelected || state.piece !== this.lastPiece) {
      // The first look at the controller is not a change: the page just opened.
      if (this.lastSelected >= 0) this.nameLeft = NAME_SECONDS;
      this.lastSelected = state.selected;
      this.lastPiece = state.piece;
    } else {
      this.nameLeft = Math.max(0, this.nameLeft - dt);
    }

    const name = pieceName(state.piece);
    const prompt = this.prompt;
    if (state.refusal !== null) {
      prompt.title = name;
      prompt.detail = refusalText(state.refusal);
      prompt.tone = 'warn';
      return prompt;
    }
    if (name === '' || (!state.buildMode && this.nameLeft <= 0)) return null;
    prompt.title = name;
    prompt.detail = `Cost ${costText(state.piece)}`;
    prompt.tone = 'info';
    return prompt;
  }
}
