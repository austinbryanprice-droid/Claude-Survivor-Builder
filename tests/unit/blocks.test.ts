import { describe, expect, it } from 'vitest';
import {
  MATERIAL,
  MATERIALS,
  SHAPE,
  SHAPES,
  isCellState,
  isKnownState,
  packState,
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
      for (const material of MATERIALS) {
        const state = packState(shape.id, material.id);
        expect(stateShape(state)).toBe(shape.id);
        expect(stateMaterial(state)).toBe(material.id);
        expect(isKnownState(state)).toBe(true);
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
