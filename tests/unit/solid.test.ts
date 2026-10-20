import { describe, expect, it } from 'vitest';
import { SparseCells, cellInRange, cellKey } from '../../src/shared/solid';

describe('cellKey', () => {
  it('gives every cell in range its own key', () => {
    const seen = new Set<number>();
    for (let x = -3; x <= 3; x++) {
      for (let y = -3; y <= 3; y++) {
        for (let z = -3; z <= 3; z++) seen.add(cellKey(x, y, z));
      }
    }
    expect(seen.size).toBe(7 * 7 * 7);
    expect(cellKey(-2048, -512, -2048)).toBe(0);
    expect(Number.isSafeInteger(cellKey(2047, 511, 2047))).toBe(true);
  });

  it('knows which cells are in range', () => {
    expect(cellInRange(0, 0, 0)).toBe(true);
    expect(cellInRange(2048, 0, 0)).toBe(false);
    expect(cellInRange(0, -513, 0)).toBe(false);
  });
});

describe('SparseCells', () => {
  it('stores ids and answers solid queries, including for negative coordinates', () => {
    const cells = new SparseCells();
    cells.set(-5, -1, 7, 3);
    expect(cells.isSolid(-5, -1, 7)).toBe(true);
    expect(cells.get(-5, -1, 7)).toBe(3);
    expect(cells.isSolid(-5, 0, 7)).toBe(false);
    expect(cells.get(0, 0, 0)).toBe(0);
    expect(cells.size).toBe(1);
  });

  it('clears a cell by setting id 0 and fills boxes in any corner order', () => {
    const cells = new SparseCells();
    cells.fillBox(2, 1, 0, 0, 0, 1);
    expect(cells.size).toBe(3 * 2 * 2);
    cells.clearBox(0, 0, 0, 0, 0, 1);
    expect(cells.size).toBe(3 * 2 * 2 - 2);
    expect(cells.isSolid(0, 0, 0)).toBe(false);
    expect(cells.isSolid(1, 0, 0)).toBe(true);
  });

  it('reads back every cell it holds', () => {
    const cells = new SparseCells();
    cells.set(-12, -1, 30, 2);
    cells.set(40, 9, -7, 5);
    const seen: number[][] = [];
    cells.forEach((x, y, z, id) => seen.push([x, y, z, id]));
    expect(seen).toEqual([
      [-12, -1, 30, 2],
      [40, 9, -7, 5],
    ]);
  });

  it('treats cells outside the packable range as empty and refuses to store them', () => {
    const cells = new SparseCells();
    expect(cells.isSolid(5000, 0, 0)).toBe(false);
    expect(cells.get(0, 9999, 0)).toBe(0);
    expect(() => cells.set(5000, 0, 0)).toThrow(RangeError);
  });
});
