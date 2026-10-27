import { describe, expect, it } from 'vitest';
import { REFUSAL } from '../../src/net/host-session';
import {
  MATERIAL,
  MATERIALS,
  MODULE,
  SHAPE,
  SHAPE_KINDS,
  baseShape,
  moduleShape,
  packState,
  slabShape,
  wedgeShape,
} from '../../src/shared/blocks';
import { AIM_REFUSAL } from '../../src/shared/build-aim';
import { MODULE_SLOT } from '../../src/app/build-controller';
import {
  BLASTER_COST,
  BLASTER_NAME,
  BUILD_KEYS,
  BuildPromptTracker,
  INTERACT_KEY,
  MODULE_SLOT_INDEX,
  NAME_SECONDS,
  blockIcon,
  blockSlot,
  blockSlots,
  blockSlotsByKind,
  costText,
  interactPrompt,
  moduleSlot,
  refusalText,
  upgradePrompt,
  type BuildHudInput,
} from '../../src/ui/build-hud';
import {
  DEBRIS_IN_THE_WAY,
  FULLY_UPGRADED,
  NOTHING_TO_UPGRADE,
  needsResearch,
  notEnough,
} from '../../src/systems/economy/build-rules';
import { VITALS } from '../../src/systems/survival/balance';
import { ICON_IDS, ICON_SPRITE } from '../../src/ui/player-hud/icons';

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const ALLOY = packState(SHAPE.cube, MATERIAL.alloy);

function hands(overrides: Partial<BuildHudInput> = {}): BuildHudInput {
  return {
    selected: 0,
    buildMode: false,
    kind: 'cube',
    module: MODULE.terminal,
    piece: SCRAP,
    crosshair: 'none',
    refusal: null,
    blaster: false,
    hits: 0,
    kill: false,
    salvage: 0,
    salvageGrade: 0,
    terminal: 'none',
    upgrade: 0,
    upgradeRefusal: null,
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

describe('the module slot', () => {
  const TERMINAL = packState(moduleShape(MODULE.terminal, 2), 1);

  it('sits where the building hands put it', () => {
    expect(MODULE_SLOT_INDEX).toBe(MODULE_SLOT);
  });

  it('draws the module’s own icon, the same whichever way it faces, on the grid of placeable items', () => {
    expect(blockIcon(TERMINAL)).toBe('terminal');
    for (let facing = 0; facing < 4; facing++) {
      expect(blockIcon(packState(moduleShape(MODULE.terminal, facing), 1))).toBe('terminal');
    }
    expect(moduleSlot(MODULE.terminal)).toEqual({ icon: 'terminal', blueprint: true });
    expect(blockSlot(TERMINAL)).toEqual({ icon: 'terminal', blueprint: true });
  });

  it('gives the Basic Turret its own icon, the same whichever way it faces', () => {
    for (let facing = 0; facing < 4; facing++) {
      expect(blockIcon(packState(moduleShape(MODULE.turret, facing), 1))).toBe('turret');
    }
    expect(moduleSlot(MODULE.turret)).toEqual({ icon: 'turret', blueprint: true });
    expect(blockSlot(packState(moduleShape(MODULE.turret, 3), 1))).toEqual({
      icon: 'turret',
      blueprint: true,
    });
  });

  it('has no icon for a module the HUD has no picture of, or a level the module does not have', () => {
    expect(moduleSlot(99).icon).toBeNull();
    expect(blockIcon(packState(moduleShape(MODULE.terminal, 0), 9))).toBeNull();
    // The turret has two levels above the first, and the one icon serves all three.
    expect(blockIcon(packState(moduleShape(MODULE.turret, 0), 3))).toBe('turret');
    expect(blockIcon(packState(moduleShape(MODULE.turret, 0), 4))).toBeNull();
  });

  it('says what a module costs from the module table', () => {
    expect(costText(TERMINAL)).toBe('40 Scrap');
    expect(costText(packState(moduleShape(MODULE.terminal, 0), 9))).toBe('');
    expect(costText(packState(moduleShape(MODULE.turret, 1), 1))).toBe('25 Scrap');
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

  it('says what a heap of a better grade gives, and nothing more for Scrap', () => {
    expect(interactPrompt(3, MATERIAL.composite)).toEqual({
      key: INTERACT_KEY,
      label: 'Strip debris',
      detail: 'Reinforced Composite · 3 strips left',
    });
    expect(interactPrompt(1, MATERIAL.alloy)?.detail).toBe('Advanced Alloy · last strip');
    expect(interactPrompt(3, MATERIAL.scrap)?.detail).toBe('3 strips left');
    expect(interactPrompt(2, 99)?.detail).toBe('2 strips left');
  });

  it('is nothing when the cursor is on no heap', () => {
    expect(interactPrompt(0)).toBeNull();
    expect(interactPrompt(-1)).toBeNull();
    expect(interactPrompt(Number.NaN)).toBeNull();
  });

  it('is in the key list of Build Mode, and the key is the one the game listens for', () => {
    expect(INTERACT_KEY).toBe('E');
    expect(BUILD_KEYS).toContainEqual({ keys: ['E'], label: 'Strip debris, upgrade' });
  });
});

describe('the upgrade prompt under the crosshair', () => {
  const composite = packState(SHAPE.cube, MATERIAL.composite);

  it('names the key, the material the block becomes and what that costs', () => {
    expect(upgradePrompt(composite, null)).toEqual({
      key: INTERACT_KEY,
      label: 'Upgrade to Reinforced Composite',
      detail: `Cost ${costText(composite)}`,
    });
    expect(upgradePrompt(ALLOY, null)?.label).toBe('Upgrade to Advanced Alloy');
  });

  it('is the same for a slab or a wedge: the material is what changes', () => {
    const slab = packState(slabShape(false), MATERIAL.alloy);
    expect(upgradePrompt(slab, null)?.label).toBe('Upgrade to Advanced Alloy');
    expect(upgradePrompt(slab, null)?.detail).toBe(`Cost ${costText(slab)}`);
  });

  it('says why in red when the host would refuse, in the words the caption uses', () => {
    const short = upgradePrompt(composite, notEnough('Reinforced Composite'));
    expect(short).toMatchObject({
      label: 'Upgrade to Reinforced Composite',
      detail: 'Not enough Reinforced Composite',
      tone: 'warn',
    });
    expect(upgradePrompt(composite, 'a player is in the way')?.detail).toBe(
      'A player is in the way',
    );
  });

  it('tells a closed material as the lock does, in place of the host’s words', () => {
    const refusal = needsResearch('Reinforced Composite');
    const behind = { name: 'Reinforced Composite', have: 5, need: 20, terminal: false };
    expect(upgradePrompt(composite, refusal, behind)).toMatchObject({
      detail: 'Needs research · 5 of 20',
      tone: 'warn',
    });
    const unread = { ...behind, have: 25, terminal: true };
    expect(upgradePrompt(composite, refusal, unread)?.detail).toBe('Needs a Research Terminal');
    // Without a lock to read, the host's words stand.
    expect(upgradePrompt(composite, refusal)?.detail).toBe('Reinforced Composite needs research');
    // A lock on another material says nothing of this refusal.
    expect(upgradePrompt(composite, notEnough('Reinforced Composite'), behind)?.detail).toBe(
      'Not enough Reinforced Composite',
    );
  });

  it('names the module at its next level for a turret, and what that costs', () => {
    const auto = packState(moduleShape(MODULE.turret, 0), 2);
    const heavy = packState(moduleShape(MODULE.turret, 3), 3);
    expect(upgradePrompt(auto, null)).toEqual({
      key: INTERACT_KEY,
      label: 'Upgrade to Auto Turret',
      detail: `Cost ${costText(auto)}`,
    });
    expect(upgradePrompt(heavy, null)).toEqual({
      key: INTERACT_KEY,
      label: 'Upgrade to Heavy Turret',
      detail: `Cost ${costText(heavy)}`,
    });
    // Each step is paid in the better material, named as the cost.
    expect(costText(auto)).toMatch(/Reinforced Composite$/);
    expect(costText(heavy)).toMatch(/Advanced Alloy$/);
  });

  it('says why in red for a turret as for a block, and tells a closed material as the lock does', () => {
    const auto = packState(moduleShape(MODULE.turret, 0), 2);
    expect(upgradePrompt(auto, notEnough('Reinforced Composite'))).toMatchObject({
      label: 'Upgrade to Auto Turret',
      detail: 'Not enough Reinforced Composite',
      tone: 'warn',
    });
    const refusal = needsResearch('Reinforced Composite');
    const behind = { name: 'Reinforced Composite', have: 5, need: 20, terminal: false };
    expect(upgradePrompt(auto, refusal, behind)).toMatchObject({
      label: 'Upgrade to Auto Turret',
      detail: 'Needs research · 5 of 20',
      tone: 'warn',
    });
    expect(upgradePrompt(auto, refusal)?.detail).toBe('Reinforced Composite needs research');
  });

  it('is nothing for a module at a level it does not have', () => {
    expect(upgradePrompt(packState(moduleShape(MODULE.turret, 0), 9), null)).toBeNull();
  });

  it('is nothing for a state that names no material', () => {
    expect(upgradePrompt(0, null)).toBeNull();
  });

  it('has words for the two reasons only a key press can raise', () => {
    expect(refusalText(NOTHING_TO_UPGRADE)).toBe('Nothing to upgrade there');
    expect(refusalText(FULLY_UPGRADED)).toBe('Already fully upgraded');
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

  it('names a module and what it costs, as it names a block', () => {
    const tracker = new BuildPromptTracker();
    const terminal = packState(moduleShape(MODULE.terminal, 1), 1);
    expect(
      tracker.update(0.016, hands({ selected: MODULE_SLOT, buildMode: true, piece: terminal })),
    ).toEqual({
      title: 'Research Terminal',
      detail: 'Cost 40 Scrap',
      tone: 'info',
    });
    expect(
      tracker.update(
        0.016,
        hands({ selected: MODULE_SLOT, piece: terminal, refusal: 'unsupported' }),
      ),
    ).toEqual({
      title: 'Research Terminal',
      detail: 'Needs ground or a block to rest on',
      tone: 'warn',
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

describe('the caption of a material that is not researched', () => {
  const lock = { name: 'Reinforced Composite', have: 12, need: 20, terminal: false };
  const composite = packState(SHAPE.cube, MATERIAL.composite);
  const inHand = { selected: 1, piece: composite };

  it('says how many points the crew has and how many open it, in Build Mode', () => {
    const tracker = new BuildPromptTracker();
    expect(tracker.update(0.016, hands({ ...inHand, buildMode: true }), lock)).toEqual({
      title: 'Reinforced Composite Block',
      detail: 'Needs research · 12 of 20',
      tone: 'warn',
    });
  });

  it('says it for a moment after the slot is chosen outside Build Mode, and then goes quiet', () => {
    const tracker = new BuildPromptTracker();
    tracker.update(0.016, hands(), null);
    expect(tracker.update(0.016, hands(inHand), lock)).toMatchObject({
      detail: 'Needs research · 12 of 20',
      tone: 'warn',
    });
    expect(tracker.update(NAME_SECONDS, hands(inHand), lock)).toBeNull();
  });

  it('says it in place of the host’s words for the same thing', () => {
    const tracker = new BuildPromptTracker();
    const words = needsResearch('Reinforced Composite');
    expect(tracker.update(0.016, hands({ ...inHand, refusal: words }), lock)).toEqual({
      title: 'Reinforced Composite Block',
      detail: 'Needs research · 12 of 20',
      tone: 'warn',
    });
  });

  it('asks for a Terminal when the points earned are enough and nothing has read them', () => {
    const tracker = new BuildPromptTracker();
    const waiting = { ...lock, have: 24, terminal: true };
    expect(tracker.update(0.016, hands({ ...inHand, buildMode: true }), waiting)).toEqual({
      title: 'Reinforced Composite Block',
      detail: 'Needs a Research Terminal',
      tone: 'warn',
    });
    const words = needsResearch('Reinforced Composite');
    expect(tracker.update(0.016, hands({ ...inHand, refusal: words }), waiting)).toMatchObject({
      detail: 'Needs a Research Terminal',
    });
  });

  it('lets another reason speak first: out of reach is still out of reach', () => {
    const tracker = new BuildPromptTracker();
    expect(
      tracker.update(
        0.016,
        hands({ ...inHand, buildMode: true, refusal: AIM_REFUSAL.outOfReach }),
        lock,
      ),
    ).toMatchObject({ detail: 'Out of reach', tone: 'warn' });
  });

  it('is the ordinary caption once the material is open', () => {
    const tracker = new BuildPromptTracker();
    expect(tracker.update(0.016, hands({ ...inHand, buildMode: true }), null)).toEqual({
      title: 'Reinforced Composite Block',
      detail: 'Cost 1 Reinforced Composite',
      tone: 'info',
    });
  });

  it('says nothing of a lock to the blaster or an empty slot', () => {
    const tracker = new BuildPromptTracker();
    const blaster = hands({ selected: 4, piece: 0, blaster: true, buildMode: true });
    expect(tracker.update(0.016, blaster, lock)).toMatchObject({
      title: BLASTER_NAME,
      tone: 'info',
    });
    expect(tracker.update(0.016, hands({ piece: 0, buildMode: true }), lock)).toBeNull();
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
