import { describe, expect, it } from 'vitest';
import { REFUSAL } from '../../src/net/host-session';
import { MATERIAL, MATERIALS, SHAPE, packState } from '../../src/shared/blocks';
import { AIM_REFUSAL } from '../../src/shared/build-aim';
import {
  BUILD_KEYS,
  BuildPromptTracker,
  NAME_SECONDS,
  blockIcon,
  blockSlot,
  costText,
  refusalText,
  type BuildHudInput,
} from '../../src/ui/build-hud';
import { ICON_IDS, ICON_SPRITE } from '../../src/ui/player-hud/icons';

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const ALLOY = packState(SHAPE.cube, MATERIAL.alloy);

function hands(overrides: Partial<BuildHudInput> = {}): BuildHudInput {
  return {
    selected: 0,
    buildMode: false,
    piece: SCRAP,
    crosshair: 'none',
    refusal: null,
    ...overrides,
  };
}

describe('the hotbar blocks', () => {
  it('have one icon for each material, each different', () => {
    const icons = MATERIALS.map((m) => blockIcon(packState(SHAPE.cube, m.id)));
    expect(icons.every((icon) => icon !== null)).toBe(true);
    expect(new Set(icons).size).toBe(MATERIALS.length);
  });

  it('have no icon for a state the tables do not know', () => {
    expect(blockIcon(0)).toBeNull();
    expect(blockIcon(packState(SHAPE.cube, 200))).toBeNull();
  });

  it('sit on the cyan grid of placeable items', () => {
    expect(blockSlot(ALLOY)).toEqual({ icon: blockIcon(ALLOY), blueprint: true });
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
});

describe('the keys of Build Mode', () => {
  it('list the mouse buttons, the hotbar keys and the one that leaves', () => {
    const keys = BUILD_KEYS.flatMap((row) => row.keys);
    expect(keys).toEqual(expect.arrayContaining(['LMB', 'RMB', '1–8', 'B']));
    expect(BUILD_KEYS.every((row) => row.label.length > 0)).toBe(true);
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
