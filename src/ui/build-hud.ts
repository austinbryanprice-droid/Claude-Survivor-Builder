import type { CellState } from '../shared/block-world';
import {
  MATERIAL,
  MATERIALS,
  SHAPE_KINDS,
  baseShape,
  materialOf,
  packState,
  pieceName,
  shapeKind,
  stateShape,
  type ShapeKind,
} from '../shared/blocks';
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
  /** The kind of shape the block slots make: a block, a slab or a wedge. */
  readonly kind: ShapeKind;
  /** The piece the selected slot makes in that kind, or 0 when the slot holds no block. */
  readonly piece: CellState;
  readonly crosshair: 'none' | 'place' | 'blocked';
  /** Why a click would do nothing right now, as a code or as the host's words, or null. */
  readonly refusal: string | null;
}

export interface BuildHudSource {
  hudState(): BuildHudInput;
}

const BLOCK_ICONS: Readonly<Record<ShapeKind, Readonly<Record<number, IconId>>>> = {
  cube: {
    [MATERIAL.scrap]: 'block-scrap',
    [MATERIAL.composite]: 'block-composite',
    [MATERIAL.alloy]: 'block-alloy',
    [MATERIAL.energy]: 'block-energy',
  },
  slab: {
    [MATERIAL.scrap]: 'slab-scrap',
    [MATERIAL.composite]: 'slab-composite',
    [MATERIAL.alloy]: 'slab-alloy',
    [MATERIAL.energy]: 'slab-energy',
  },
  wedge: {
    [MATERIAL.scrap]: 'wedge-scrap',
    [MATERIAL.composite]: 'wedge-composite',
    [MATERIAL.alloy]: 'wedge-alloy',
    [MATERIAL.energy]: 'wedge-energy',
  },
};

/** The icon of a piece: its material's, drawn in its shape. Null for a state the HUD has no picture of. */
export function blockIcon(piece: CellState): IconId | null {
  const material = materialOf(piece);
  const kind = shapeKind(stateShape(piece));
  return (material && kind && BLOCK_ICONS[kind][material.id]) || null;
}

/** The hotbar slot that holds a piece: its icon on the cyan grid of placeable items. */
export function blockSlot(piece: CellState): HotbarSlot {
  return { icon: blockIcon(piece), blueprint: true };
}

/** The four block slots of the hotbar as they look while the block slots make this kind of shape. */
export function blockSlots(kind: ShapeKind): readonly HotbarSlot[] {
  return MATERIALS.map((material) => blockSlot(packState(baseShape(kind), material.id)));
}

/** `blockSlots` for every kind, built once. */
export function blockSlotsByKind(): ReadonlyMap<ShapeKind, readonly HotbarSlot[]> {
  return new Map(SHAPE_KINDS.map((kind) => [kind, blockSlots(kind)]));
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
  { keys: ['Q'], label: 'Block, slab or wedge' },
  { keys: ['R'], label: 'Turn it' },
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
