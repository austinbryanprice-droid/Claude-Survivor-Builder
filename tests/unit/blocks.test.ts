import { describe, expect, it } from 'vitest';
import {
  MATERIAL,
  MATERIALS,
  MODULE,
  MODULES,
  MODULE_FACINGS,
  SHAPE,
  SHAPES,
  isCellState,
  isKnownState,
  materialOf,
  materialTier,
  moduleFacing,
  moduleOfShape,
  moduleShape,
  packState,
  pieceName,
  shapeKind,
  stateMaterial,
  stateShape,
  withMaterial,
} from '../../src/shared/blocks';

describe('cell states', () => {
  it('pack a shape into the low byte and a material into the high byte', () => {
    const state = packState(SHAPE.cube, MATERIAL.alloy);
    expect(state).toBe(0x0301);
    expect(stateShape(state)).toBe(SHAPE.cube);
    expect(stateMaterial(state)).toBe(MATERIAL.alloy);
  });

  it('round-trip every shape and material in the tables', () => {
    for (const shape of SHAPES) {
      // A module's high byte is its level, not a material, so only its own levels are known states.
      const levels = moduleOfShape(shape.id)?.levels;
      for (const material of MATERIALS) {
        const state = packState(shape.id, material.id);
        expect(stateShape(state)).toBe(shape.id);
        expect(stateMaterial(state)).toBe(material.id);
        expect(isKnownState(state)).toBe(levels === undefined || material.id <= levels);
      }
    }
  });

  it('upgrade in place by swapping the material and keeping the shape', () => {
    const scrap = packState(SHAPE.cube, MATERIAL.scrap);
    const upgraded = withMaterial(scrap, MATERIAL.composite);
    expect(stateShape(upgraded)).toBe(SHAPE.cube);
    expect(stateMaterial(upgraded)).toBe(MATERIAL.composite);
    expect(upgraded).not.toBe(scrap);
  });

  it('keep empty as 0 and refuse to call it a placeable piece', () => {
    expect(packState(SHAPE.empty, MATERIAL.none)).toBe(0);
    expect(isKnownState(0)).toBe(false);
  });

  it('refuse a shape or a material the tables do not define', () => {
    expect(isKnownState(packState(SHAPE.cube, MATERIAL.none))).toBe(false);
    expect(isKnownState(packState(SHAPE.empty, MATERIAL.scrap))).toBe(false);
    expect(isKnownState(packState(200, MATERIAL.scrap))).toBe(false);
    expect(isKnownState(packState(SHAPE.cube, 200))).toBe(false);
  });

  it('accept only whole numbers from 0 to 65535 as a cell value', () => {
    expect(isCellState(0)).toBe(true);
    expect(isCellState(65535)).toBe(true);
    expect(isCellState(65536)).toBe(false);
    expect(isCellState(-1)).toBe(false);
    expect(isCellState(1.5)).toBe(false);
    expect(isCellState(Number.NaN)).toBe(false);
    expect(isKnownState(65536)).toBe(false);
  });

  it('list the four tiers of the spec in order', () => {
    expect(MATERIALS.map((m) => m.tier)).toEqual([1, 2, 3, 4]);
    expect(MATERIALS.map((m) => m.name)).toEqual([
      'Scrap',
      'Reinforced Composite',
      'Advanced Alloy',
      'Energy-Infused',
    ]);
  });
});

describe('naming and pricing a piece', () => {
  it('finds the material of a state, or nothing for one the tables do not know', () => {
    expect(materialOf(packState(SHAPE.cube, MATERIAL.alloy))?.name).toBe('Advanced Alloy');
    expect(materialOf(packState(SHAPE.cube, 200))).toBeUndefined();
    expect(materialOf(0)).toBeUndefined();
  });

  it('call a piece by its material and shape, and an unknown state by nothing', () => {
    expect(pieceName(packState(SHAPE.cube, MATERIAL.scrap))).toBe('Scrap Block');
    expect(pieceName(packState(SHAPE.cube, MATERIAL.energy))).toBe('Energy-Infused Block');
    expect(pieceName(0)).toBe('');
    expect(pieceName(packState(200, MATERIAL.scrap))).toBe('');
  });

  it('tell the tier of a material, and the first tier for an id the tables do not know', () => {
    expect(MATERIALS.map((m) => materialTier(m.id))).toEqual([1, 2, 3, 4]);
    expect(materialTier(MATERIAL.none)).toBe(1);
    expect(materialTier(99)).toBe(1);
  });

  it('price every material at a whole number of units, never free', () => {
    for (const material of MATERIALS) {
      expect(Number.isInteger(material.cost)).toBe(true);
      expect(material.cost).toBeGreaterThan(0);
    }
  });
});

describe('modules', () => {
  it('number their shapes from 32, four facings to a module, and never reuse an id', () => {
    // These are the values the first release of modules shipped; saves and the wire carry them.
    expect(SHAPE.module).toBe(32);
    expect(MODULE.terminal).toBe(1);
    expect(MODULE.turret).toBe(2);
    expect(MODULE_FACINGS).toBe(4);
    expect([0, 1, 2, 3].map((facing) => moduleShape(MODULE.terminal, facing))).toEqual([
      32, 33, 34, 35,
    ]);
    expect([0, 1, 2, 3].map((facing) => moduleShape(MODULE.turret, facing))).toEqual([
      36, 37, 38, 39,
    ]);
    const ids = MODULES.flatMap((def) =>
      Array.from({ length: MODULE_FACINGS }, (_, facing) => moduleShape(def.id, facing)),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => SHAPES.some((shape) => shape.id === id))).toBe(true);
  });

  it('name the module and the way it faces from the shape id', () => {
    for (let facing = 0; facing < MODULE_FACINGS; facing++) {
      const shape = moduleShape(MODULE.terminal, facing);
      expect(moduleOfShape(shape)?.id).toBe(MODULE.terminal);
      expect(moduleFacing(shape)).toBe(facing);
      expect(shapeKind(shape)).toBe('module');
    }
    // Any whole number of quarter turns, forward or back, names one of the four.
    expect(moduleShape(MODULE.terminal, -1)).toBe(moduleShape(MODULE.terminal, 3));
    expect(moduleShape(MODULE.terminal, 6)).toBe(moduleShape(MODULE.terminal, 2));
  });

  it('are not found in a shape that is not a module', () => {
    for (const shape of [0, SHAPE.cube, SHAPE.slab, SHAPE.slab + 1, SHAPE.wedge + 7, 40, 255]) {
      expect(moduleOfShape(shape), `shape ${shape}`).toBeUndefined();
      expect(moduleFacing(shape), `shape ${shape}`).toBe(-1);
    }
  });

  it('keep their level in the material byte, and know only the levels they have', () => {
    const terminal = moduleShape(MODULE.terminal, 1);
    expect(packState(terminal, 1)).toBe(0x0121);
    expect(isKnownState(packState(terminal, 1))).toBe(true);
    const levels = MODULES.find((def) => def.id === MODULE.terminal)?.levels ?? 0;
    expect(isKnownState(packState(terminal, levels + 1))).toBe(false);
    expect(isKnownState(packState(terminal, 0))).toBe(false);
    expect(isKnownState(packState(terminal, 200))).toBe(false);
    // The facings after the last module are not shapes.
    expect(isKnownState(packState(SHAPE.module + MODULES.length * MODULE_FACINGS, 1))).toBe(false);
  });

  it('are called by their own name whichever way they face', () => {
    for (let facing = 0; facing < MODULE_FACINGS; facing++) {
      expect(pieceName(packState(moduleShape(MODULE.terminal, facing), 1))).toBe(
        'Research Terminal',
      );
      expect(pieceName(packState(moduleShape(MODULE.turret, facing), 1))).toBe('Basic Turret');
    }
    expect(pieceName(packState(moduleShape(MODULE.terminal, 0), 9))).toBe('');
  });

  it('are priced in whole units of a material, never free', () => {
    for (const def of MODULES) {
      expect(Number.isInteger(def.cost.amount), def.name).toBe(true);
      expect(def.cost.amount, def.name).toBeGreaterThan(0);
      expect(
        MATERIALS.some((material) => material.id === def.cost.material),
        def.name,
      ).toBe(true);
    }
    const terminal = MODULES.find((def) => def.id === MODULE.terminal);
    expect(terminal?.cost).toEqual({ material: MATERIAL.scrap, amount: 40 });
    const turret = MODULES.find((def) => def.id === MODULE.turret);
    expect(turret?.cost).toEqual({ material: MATERIAL.scrap, amount: 25 });
  });

  it('have a body inside their cell that stands on its floor', () => {
    for (const def of MODULES) {
      const [x0, y0, z0, x1, y1, z1] = def.body;
      expect(
        [x0, y0, z0].every((v) => v >= 0),
        def.name,
      ).toBe(true);
      expect(
        [x1, y1, z1].every((v) => v <= 1),
        def.name,
      ).toBe(true);
      expect(x1 > x0 && y1 > y0 && z1 > z0, def.name).toBe(true);
      expect(y0, def.name).toBe(0);
    }
  });
});
