import type { CellState } from '../shared/block-world';
import {
  MATERIAL,
  MATERIALS,
  MODULE,
  SHAPE_KINDS,
  baseShape,
  isKnownState,
  materialOf,
  moduleOfShape,
  packState,
  pieceName,
  shapeKind,
  stateShape,
  type BlockKind,
} from '../shared/blocks';
import { AIM_REFUSAL } from '../shared/build-aim';
import { needsResearch, pieceCost } from '../systems/economy/build-rules';
import { TURRET, VITALS } from '../systems/survival/balance';
import type { PowerState } from '../systems/survival/power';
import type { HotbarSlot, HudInteract, HudPowerTag, HudPrompt } from './player-hud/player-hud';
import type { IconId } from './player-hud/icons';
import { lockText, type HudLock } from './research-hud';

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
  readonly kind: BlockKind;
  /** The module the module slot holds (`MODULE`), which the slot's icon follows. */
  readonly module: number;
  /** The piece the selected slot makes in that kind, or 0 when the slot holds no piece. */
  readonly piece: CellState;
  readonly crosshair: 'none' | 'place' | 'blocked' | 'blaster';
  /** Why a click would do nothing right now, as a code or as the host's words, or null. */
  readonly refusal: string | null;
  /** The pulse blaster is in hand. */
  readonly blaster: boolean;
  /** How many of the player's shots have hit a machine so far, and whether the latest felled it. */
  readonly hits: number;
  readonly kill: boolean;
  /** Strips left of the heap of debris the cursor is on and the player can reach, or 0 when it is on none. */
  readonly salvage: number;
  /** The material that heap gives, as a `MATERIAL` id; 0 when the cursor is on none. */
  readonly salvageGrade: number;
  /** The Research Terminal: 'aimed' when the cursor is on one the interact key would open, 'open' while its ladder is up, else 'none'. */
  readonly terminal: 'none' | 'aimed' | 'open';
  /** The piece the interact key would make of the block the cursor is on, one material up, or 0 when it offers none. */
  readonly upgrade: CellState;
  /** Why the host would refuse that upgrade (its words), or null when it would go. Meaningful when `upgrade` is not 0. */
  readonly upgradeRefusal: string | null;
  /** In Build Mode, what the turret or Power Node the cursor is on has of power; 'none' when it is on neither. */
  readonly power: PowerState;
  /** The module (`MODULE`) that `power` is the state of; 0 when `power` is 'none'. */
  readonly powerModule: number;
}

export interface BuildHudSource {
  hudState(): BuildHudInput;
}

const BLOCK_ICONS: Readonly<Record<BlockKind, Readonly<Record<number, IconId>>>> = {
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

/** The icon of each module, by its `MODULE` id: the picture is the same whatever its level or facing. */
const MODULE_ICONS: Readonly<Record<number, IconId>> = {
  [MODULE.terminal]: 'terminal',
  [MODULE.turret]: 'turret',
  [MODULE.generator]: 'generator',
  [MODULE.node]: 'node',
};

/**
 * The icon of a piece: its material's, drawn in its shape, or a module's own. Null for a state the
 * HUD has no picture of.
 */
export function blockIcon(piece: CellState): IconId | null {
  const module = moduleOfShape(stateShape(piece));
  if (module) return isKnownState(piece) ? (MODULE_ICONS[module.id] ?? null) : null;
  const material = materialOf(piece);
  const kind = shapeKind(stateShape(piece));
  return (material && kind && kind !== 'module' && BLOCK_ICONS[kind][material.id]) || null;
}

/** The icon of a module (a `MODULE` id), or null when the HUD has none. */
export function moduleIcon(module: number): IconId | null {
  return MODULE_ICONS[module] ?? null;
}

/** The hotbar slot that holds a piece: its icon on the cyan grid of placeable items. */
export function blockSlot(piece: CellState): HotbarSlot {
  return { icon: blockIcon(piece), blueprint: true };
}

/** The four block slots of the hotbar as they look while the block slots make this kind of shape. */
export function blockSlots(kind: BlockKind): readonly HotbarSlot[] {
  return MATERIALS.map((material) => blockSlot(packState(baseShape(kind), material.id)));
}

/** `blockSlots` for every kind, built once. */
export function blockSlotsByKind(): ReadonlyMap<BlockKind, readonly HotbarSlot[]> {
  return new Map(SHAPE_KINDS.map((kind) => [kind, blockSlots(kind)]));
}

/** The module slot as it looks while it holds this module: the module's icon on the cyan grid. */
export function moduleSlot(module: number): HotbarSlot {
  return { icon: moduleIcon(module), blueprint: true };
}

/** Where the module slot sits on the hotbar: after the block slots and the blaster (the building hands' `MODULE_SLOT` is the same number). */
export const MODULE_SLOT_INDEX = MATERIALS.length + 1;

/** What a piece costs, such as "1 Scrap" or "40 Scrap"; the number comes from the material and module tables. */
export function costText(piece: CellState): string {
  const cost = pieceCost(piece);
  return cost ? `${cost.amount} ${cost.name}` : '';
}

/** Why a click does nothing, in a short sentence. The world's and the aim's codes are listed; the host's words pass through. */
const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  reserved: 'The Outpost Core needs that room',
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

/** The key that strips a heap of debris, as its cap reads. */
export const INTERACT_KEY = 'E';

/**
 * What the cursor on a heap of debris tells the player: the key, what it does, and how many strips
 * the heap has left. A heap of anything but Scrap says what it gives, since it looks like the others.
 */
export function interactPrompt(strips: number, grade: number = MATERIAL.scrap): HudInteract | null {
  if (!(strips > 0)) return null;
  const left = strips === 1 ? 'last strip' : `${strips} strips left`;
  const material = grade === MATERIAL.scrap ? undefined : MATERIALS.find((m) => m.id === grade);
  return {
    key: INTERACT_KEY,
    label: 'Strip debris',
    detail: material ? `${material.name} · ${left}` : left,
  };
}

/** What an upgrade is called on the card: the better material for a block, the module at its next level (the Auto Turret) for a module. Empty for a state the tables do not know. */
function upgradeName(to: CellState): string {
  if (moduleOfShape(stateShape(to))) return pieceName(to);
  return materialOf(to)?.name ?? '';
}

/**
 * What the interact key would do for a piece the cursor is on that has a better self: the key, what
 * it would become (a block's better material, a module's next level) and what that costs, or, when
 * the host would refuse, why, in red. A material the crew has not researched says how many points it
 * has and how many open it (`lock`), in place of the host's words for the same thing. Null when `to`
 * names nothing the tables know.
 */
export function upgradePrompt(
  to: CellState,
  refusal: string | null,
  lock: HudLock | null = null,
): HudInteract | null {
  const name = upgradeName(to);
  if (!name) return null;
  const label = `Upgrade to ${name}`;
  if (refusal === null) return { key: INTERACT_KEY, label, detail: `Cost ${costText(to)}` };
  const closed = lock !== null && refusal === needsResearch(lock.name);
  return {
    key: INTERACT_KEY,
    label,
    detail: closed ? lockText(lock) : refusalText(refusal),
    tone: 'warn',
  };
}

/**
 * What the tag under the crosshair says of a turret or Power Node the cursor is on in Build Mode: whether it has
 * power and what that does for it. A turret works without power (it is a boost, never a need), and the words say so.
 * Null for a cell that holds neither, which has no state.
 */
export function powerTag(power: PowerState, module: number): HudPowerTag | null {
  if (power === 'none') return null;
  const turret = module === MODULE.turret;
  if (power === 'on') {
    return {
      state: 'on',
      label: 'Powered',
      detail: turret ? `Fires ${TURRET.poweredRate}× faster` : 'Passes power on',
    };
  }
  return {
    state: 'off',
    label: 'No power',
    detail: turret
      ? 'A Generator or Node in reach boosts it'
      : 'Needs a Generator or Node in reach',
  };
}

/** How long the name of a newly chosen piece stays up outside Build Mode, in seconds. */
export const NAME_SECONDS = 1.6;

/** What the caption calls the blaster, and what it says a shot takes. */
export const BLASTER_NAME = 'Pulse Blaster';
export const BLASTER_COST = `Uses ${VITALS.energy.perShot} Energy a shot`;

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
  { keys: [INTERACT_KEY], label: 'Strip debris, upgrade' },
  { keys: ['B'], label: 'Leave Build Mode' },
  { keys: ['Esc'], label: 'Free the mouse' },
];

/**
 * Works out the caption above the hotbar. It names what is in hand (a piece with its cost, or the
 * blaster with what a shot takes), in Build Mode and for a moment after the choice changes, and
 * shows why a click would do nothing, in red, for as long as the controller reports it. A piece of
 * a material the crew has not researched says how many points it has and how many open it (`lock`),
 * in place of the host's words for the same thing.
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
  update(dt: number, state: BuildHudInput, lock: HudLock | null = null): HudPrompt | null {
    if (state.selected !== this.lastSelected || state.piece !== this.lastPiece) {
      // The first look at the controller is not a change: the page just opened.
      if (this.lastSelected >= 0) this.nameLeft = NAME_SECONDS;
      this.lastSelected = state.selected;
      this.lastPiece = state.piece;
    } else {
      this.nameLeft = Math.max(0, this.nameLeft - dt);
    }

    const name = state.blaster ? BLASTER_NAME : pieceName(state.piece);
    const prompt = this.prompt;
    const closed = lock !== null && !state.blaster && name !== '';
    // The host's words for a closed material are the same news as the lock, which says it better.
    const refusal = closed && state.refusal === needsResearch(lock.name) ? null : state.refusal;
    if (refusal !== null) {
      prompt.title = name;
      prompt.detail = refusalText(refusal);
      prompt.tone = 'warn';
      return prompt;
    }
    if (closed && (state.buildMode || this.nameLeft > 0 || state.refusal !== null)) {
      prompt.title = name;
      prompt.detail = lockText(lock);
      prompt.tone = 'warn';
      return prompt;
    }
    if (name === '' || (!state.buildMode && this.nameLeft <= 0)) return null;
    prompt.title = name;
    prompt.detail = state.blaster ? BLASTER_COST : `Cost ${costText(state.piece)}`;
    prompt.tone = 'info';
    return prompt;
  }
}
