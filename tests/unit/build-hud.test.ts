import { describe, expect, it } from 'vitest';
import { REFUSAL } from '../../src/net/host-session';
import {
  MATERIAL,
  MATERIALS,
  SHAPE,
  SHAPE_KINDS,
  baseShape,
  packState,
  slabShape,
  wedgeShape,
} from '../../src/shared/blocks';
import { AIM_REFUSAL } from '../../src/shared/build-aim';
import {
  BLASTER_COST,
  BLASTER_NAME,
  BUILD_KEYS,
  BuildPromptTracker,
  INTERACT_KEY,
  NAME_SECONDS,
  blockIcon,
  blockSlot,
  blockSlots,
  blockSlotsByKind,
  costText,
  interactPrompt,
  refusalText,
  type BuildHudInput,
} from '../../src/ui/build-hud';
import { DEBRIS_IN_THE_WAY, notEnough } from '../../src/systems/economy/build-rules';
import { VITALS } from '../../src/systems/survival/balance';
import { ICON_IDS, ICON_SPRITE } from '../../src/ui/player-hud/icons';

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const ALLOY = packState(SHAPE.cube, MATERIAL.alloy);

function hands(overrides: Partial<BuildHudInput> = {}): BuildHudInput {
  return {
    selected: 0,
    buildMode: false,
    kind: 'cube',
    piece: SCRAP,
    crosshair: 'none',
    refusal: null,
    blaster: false,
    hits: 0,
    kill: false,
    salvage: 0,
    ...overrides,
  };
}

describe('the hotbar blocks', () => {
  it('have one icon for each material, each different', () => {
    const icons = MATERIALS.map((m) => blockIcon(packState(SHAPE.cube, m.id)));
    expect(icons.every((icon) => icon !== null)).toBe(true);
    expect(new Set(icons).size).toBe(MATERIALS.length);
  });

  it('are drawn in their shape, a different picture for each shape of each material', () => {
    const icons = SHAPE_KINDS.flatMap((kind) =>
      MATERIALS.map((m) => blockIcon(packState(baseShape(kind), m.id))),
    );
    expect(icons.every((icon) => icon !== null)).toBe(true);
    expect(new Set(icons).size).toBe(SHAPE_KINDS.length * MATERIALS.length);
  });

  it('look the same however a slab or a wedge is turned', () => {
    const scrap = (shape: number) => blockIcon(packState(shape, MATERIAL.scrap));
    expect(scrap(slabShape(true))).toBe(scrap(slabShape(false)));
    for (let turn = 0; turn < 8; turn++) {
      expect(scrap(wedgeShape(turn % 4, turn >= 4))).toBe(scrap(wedgeShape(0)));
    }
  });

  it('have no icon for a state the tables do not know', () => {
    expect(blockIcon(0)).toBeNull();
    expect(blockIcon(packState(SHAPE.cube, 200))).toBeNull();
  });

  it('sit on the cyan grid of placeable items', () => {
    expect(blockSlot(ALLOY)).toEqual({ icon: blockIcon(ALLOY), blueprint: true });
  });

  it('make a row of four block slots for each kind of shape, in the icons of that kind', () => {
    expect(blockSlots('cube').map((slot) => slot.icon)).toEqual(
      MATERIALS.map((m) => blockIcon(packState(SHAPE.cube, m.id))),
    );
    for (const kind of SHAPE_KINDS) {
      const row = blockSlots(kind);
      expect(row).toHaveLength(MATERIALS.length);
      expect(row.every((slot) => slot.blueprint === true)).toBe(true);
      expect(blockSlotsByKind().get(kind)).toEqual(row);
    }
    expect(blockSlots('slab').every((slot) => slot.icon?.startsWith('slab-'))).toBe(true);
    expect(blockSlots('wedge').every((slot) => slot.icon?.startsWith('wedge-'))).toBe(true);
  });

  it('say what a piece costs from the material table', () => {
    expect(costText(SCRAP)).toBe('1 Scrap');
    expect(costText(packState(SHAPE.cube, MATERIAL.energy))).toBe('1 Energy-Infused');
    expect(costText(0)).toBe('');
  });
});

describe('the icon sprite', () => {
  it('draws every icon id, and nothing the ids do not list', () => {
    const drawn = [...ICON_SPRITE.matchAll(/<symbol id="ph-i-([a-z-]+)"/g)].map((m) => m[1]);
    expect([...drawn].sort()).toEqual([...ICON_IDS].sort());
  });
});

describe('refusal words', () => {
  it('give every reason the world and the aim can give a sentence of its own', () => {
    const codes = [
      'reserved',
      'occupied',
      'buried',
      'unsupported',
      'out-of-bounds',
      'unknown-block',
      'empty',
      'not-ready',
      AIM_REFUSAL.outOfReach,
      AIM_REFUSAL.inTheWay,
    ];
    for (const code of codes) {
      const text = refusalText(code);
      expect(text, code).not.toBe(code);
      expect(text.length, code).toBeGreaterThan(8);
      expect(text.charAt(0), code).toBe(text.charAt(0).toUpperCase());
    }
  });

  it('show the host’s own words, capitalized', () => {
    for (const words of Object.values(REFUSAL)) {
      expect(refusalText(words)).toBe(words.charAt(0).toUpperCase() + words.slice(1));
    }
  });

  it('show the economy’s words, naming the material that is short', () => {
    expect(refusalText(DEBRIS_IN_THE_WAY)).toBe('Debris is in the way');
    for (const material of MATERIALS) {
      expect(refusalText(notEnough(material.name))).toBe(`Not enough ${material.name}`);
    }
  });
});

describe('the keys of Build Mode', () => {
  it('list the mouse buttons, the hotbar keys and the one that leaves', () => {
    const keys = BUILD_KEYS.flatMap((row) => row.keys);
    expect(keys).toEqual(expect.arrayContaining(['LMB', 'RMB', '1–8', 'B']));
    // The shape key and the turn key are listed.
    expect(keys).toEqual(expect.arrayContaining(['Q', 'R']));
    expect(BUILD_KEYS.every((row) => row.label.length > 0)).toBe(true);
  });
});

describe('the prompt under the crosshair', () => {
  it('names the key, what it does and how many strips the heap has left', () => {
    expect(interactPrompt(3)).toEqual({
      key: INTERACT_KEY,
      label: 'Strip debris',
      detail: '3 strips left',
    });
    expect(interactPrompt(2)?.detail).toBe('2 strips left');
    expect(interactPrompt(1)?.detail).toBe('last strip');
  });

  it('is nothing when the cursor is on no heap', () => {
    expect(interactPrompt(0)).toBeNull();
    expect(interactPrompt(-1)).toBeNull();
    expect(interactPrompt(Number.NaN)).toBeNull();
  });

  it('is in the key list of Build Mode, and the key is the one the game listens for', () => {
    expect(INTERACT_KEY).toBe('E');
    expect(BUILD_KEYS).toContainEqual({ keys: ['E'], label: 'Strip debris' });
  });
});

describe('the caption above the hotbar', () => {
  it('stays away from a page that has just opened', () => {
    expect(new BuildPromptTracker().update(0.016, hands())).toBeNull();
  });

  it('names the piece in hand and its cost in Build Mode', () => {
    const tracker = new BuildPromptTracker();
    expect(tracker.update(0.016, hands({ buildMode: true }))).toEqual({
      title: 'Scrap Block',
      detail: 'Cost 1 Scrap',
      tone: 'info',
    });
  });

  it('names a newly chosen piece for a moment outside Build Mode', () => {
    const tracker = new BuildPromptTracker();
    tracker.update(0.016, hands());
    expect(tracker.update(0.016, hands({ selected: 2, piece: ALLOY }))).toMatchObject({
      title: 'Advanced Alloy Block',
      tone: 'info',
    });
    expect(tracker.update(NAME_SECONDS / 2, hands({ selected: 2, piece: ALLOY }))).not.toBeNull();
    expect(tracker.update(NAME_SECONDS, hands({ selected: 2, piece: ALLOY }))).toBeNull();
  });

  it('names the shape, and shows the name again when the shape changes', () => {
    const tracker = new BuildPromptTracker();
    tracker.update(0.016, hands());
    expect(tracker.update(NAME_SECONDS, hands())).toBeNull();
    const slab = packState(SHAPE.slab, MATERIAL.scrap);
    expect(tracker.update(0.016, hands({ kind: 'slab', piece: slab }))).toMatchObject({
      title: 'Scrap Slab',
      detail: 'Cost 1 Scrap',
    });
    const wedge = packState(SHAPE.wedge, MATERIAL.alloy);
    expect(tracker.update(0.016, hands({ kind: 'wedge', piece: wedge }))).toMatchObject({
      title: 'Advanced Alloy Wedge',
    });
  });

  it('shows why a click would do nothing, in warning tone, whatever the mode', () => {
    const tracker = new BuildPromptTracker();
    const prompt = tracker.update(0.016, hands({ refusal: AIM_REFUSAL.outOfReach }));
    expect(prompt).toEqual({ title: 'Scrap Block', detail: 'Out of reach', tone: 'warn' });
    // Back to normal the moment the controller stops reporting it.
    expect(tracker.update(0.016, hands())).toBeNull();
  });

  it('shows the reason alone when the slot holds no block', () => {
    const tracker = new BuildPromptTracker();
    expect(tracker.update(0.016, hands({ piece: 0, buildMode: true }))).toBeNull();
    expect(tracker.update(0.016, hands({ piece: 0, refusal: 'empty' }))).toEqual({
      title: '',
      detail: 'Nothing to break there',
      tone: 'warn',
    });
  });
});

describe('the caption of the pulse blaster', () => {
  const blaster = { selected: 4, piece: 0, blaster: true, crosshair: 'blaster' as const };

  it('names it, and says what a shot takes from the Energy bar', () => {
    const tracker = new BuildPromptTracker();
    expect(tracker.update(0.016, hands({ ...blaster, buildMode: true }))).toEqual({
      title: BLASTER_NAME,
      detail: BLASTER_COST,
      tone: 'info',
    });
    expect(BLASTER_NAME).toBe('Pulse Blaster');
    expect(BLASTER_COST).toContain(String(VITALS.energy.perShot));
    expect(BLASTER_COST).toContain('Energy');
  });

  it('names it for a moment after it is chosen, outside Build Mode', () => {
    const tracker = new BuildPromptTracker();
    tracker.update(0.016, hands());
    expect(tracker.update(0.016, hands(blaster))).toMatchObject({ title: BLASTER_NAME });
    expect(tracker.update(NAME_SECONDS / 2, hands(blaster))).not.toBeNull();
    expect(tracker.update(NAME_SECONDS, hands(blaster))).toBeNull();
  });

  it('puts a refusal under its name, in warning tone', () => {
    const tracker = new BuildPromptTracker();
    expect(tracker.update(0.016, hands({ ...blaster, refusal: 'not-ready' }))).toEqual({
      title: BLASTER_NAME,
      detail: 'Still connecting',
      tone: 'warn',
    });
  });

  it('has an icon of its own on the hotbar', () => {
    expect(ICON_IDS).toContain('blaster');
  });
});
