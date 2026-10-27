import { describe, expect, it } from 'vitest';
import { bedSpawn } from '../../src/app/bed-spawn';
import { MODULE, moduleDef, moduleShape, packState } from '../../src/shared/blocks';
import { SparseCells } from '../../src/shared/solid';
import type { ModuleSite, ModuleSource } from '../../src/systems/survival/turrets';

const flat = (height: number) => ({ groundAt: () => height });

/** The module standing in a cell, as the world lists it: first level, facing one of four ways. */
function site(module: number, x: number, y: number, z: number, facing = 0): ModuleSite {
  return { x, y, z, state: packState(moduleShape(module, facing), 1) };
}

/** The world's walk over its modules, listing these. */
function listing(...sites: ModuleSite[]): ModuleSource {
  return (visit) => {
    for (const each of sites) visit(each);
  };
}

/** Cells that hold the Beds themselves, so a column a Bed stands in is not free. */
function cellsWith(...beds: ModuleSite[]): SparseCells {
  const cells = new SparseCells();
  for (const bed of beds) cells.set(bed.x, bed.y, bed.z, 1);
  return cells;
}

/** A wall of whole blocks, two high from the floor of the Bed's level, in the column of a cell. */
function wall(cells: SparseCells, x: number, y: number, z: number, height = 2): void {
  for (let i = 0; i < height; i++) cells.set(x, y + i, z, 1);
}

const BED = site(MODULE.bed, 10, 5, 20);
const AT = { x: 14, y: 5, z: 24 };
const TOP = moduleDef(MODULE.bed)!.body[4];

describe('the spawn a Bed gives', () => {
  it('puts the player on the ground in front of the nearest Bed, one cell out from it', () => {
    const spot = bedSpawn(listing(BED), flat(5), cellsWith(BED), AT);
    // A Bed that faces 0 looks toward +x: its front is the cell at x 11.
    expect(spot).toEqual({ x: 11.5, y: expect.closeTo(5.05, 6), z: 20.5 });
  });

  it('puts the player in front of it whichever way it faces', () => {
    const ahead = [
      [11.5, 20.5],
      [10.5, 21.5],
      [9.5, 20.5],
      [10.5, 19.5],
    ] as const;
    for (let facing = 0; facing < 4; facing++) {
      const bed = site(MODULE.bed, 10, 5, 20, facing);
      const spot = bedSpawn(listing(bed), flat(5), cellsWith(bed), AT);
      expect(spot, `facing ${facing}`).toMatchObject({
        x: ahead[facing]![0],
        z: ahead[facing]![1],
      });
    }
  });

  it('stands on the smooth ground there, not on a cell edge', () => {
    const spot = bedSpawn(listing(BED), flat(5.4), cellsWith(BED), AT);
    expect(spot?.y).toBeCloseTo(5.45, 6);
  });

  it('is the Bed nearest to where the player fell, and follows them from Bed to Bed', () => {
    const far = site(MODULE.bed, 40, 5, 20);
    const here = listing(far, BED);
    const cells = cellsWith(BED, far);
    expect(bedSpawn(here, flat(5), cells, { x: 12, y: 5, z: 20 })).toMatchObject({ x: 11.5 });
    expect(bedSpawn(here, flat(5), cells, { x: 38, y: 5, z: 20 })).toMatchObject({ x: 41.5 });
    // There is no limit to how far a Bed may be.
    expect(bedSpawn(here, flat(5), cells, { x: -400, y: 5, z: -300 })).toMatchObject({ x: 11.5 });
  });

  it('counts height too: a Bed four floors up is further than one four blocks along', () => {
    const upstairs = site(MODULE.bed, 10, 9, 20);
    const beside = site(MODULE.bed, 14, 5, 20);
    const cells = cellsWith(upstairs, beside);
    cells.set(10, 8, 20, 1);
    // Straight under the upper Bed, which is nearer by the ground but not through the floor.
    const spot = bedSpawn(listing(upstairs, beside), flat(5), cells, { x: 10.5, y: 5, z: 20.5 });
    expect(spot).toMatchObject({ x: 15.5, z: 20.5 });
    expect(spot!.y).toBeCloseTo(5.05, 6);
  });

  it('settles a tie by the cells, so the walk of the world in no order gives one answer', () => {
    const west = site(MODULE.bed, 6, 5, 20);
    const east = site(MODULE.bed, 14, 5, 20);
    const cells = cellsWith(west, east);
    const middle = { x: 10.5, y: 5.5, z: 20.5 };
    const one = bedSpawn(listing(west, east), flat(5), cells, middle);
    const other = bedSpawn(listing(east, west), flat(5), cells, middle);
    expect(one).toEqual(other);
    expect(one).toMatchObject({ x: 7.5 });
  });

  it('is nothing where no Bed stands, and no other module is a Bed', () => {
    const cells = new SparseCells();
    expect(bedSpawn(listing(), flat(5), cells, AT)).toBeNull();
    const others = [MODULE.terminal, MODULE.turret, MODULE.generator, MODULE.node, MODULE.storage];
    const sites = others.map((module, i) => site(module, 10 + i * 3, 5, 20));
    expect(bedSpawn(listing(...sites), flat(5), cells, AT)).toBeNull();
  });

  describe('where the front is no place to stand', () => {
    it('goes to the side when a wall stands in front', () => {
      const cells = cellsWith(BED);
      wall(cells, 11, 5, 20);
      const spot = bedSpawn(listing(BED), flat(5), cells, AT);
      expect(spot).toMatchObject({ x: 10.5, z: 21.5 });
      expect(spot!.y).toBeCloseTo(5.05, 6);
    });

    it('goes to the other side, then behind, as each is walled in', () => {
      const cells = cellsWith(BED);
      wall(cells, 11, 5, 20);
      wall(cells, 10, 5, 21);
      expect(bedSpawn(listing(BED), flat(5), cells, AT)).toMatchObject({ x: 10.5, z: 19.5 });
      wall(cells, 10, 5, 19);
      expect(bedSpawn(listing(BED), flat(5), cells, AT)).toMatchObject({ x: 9.5, z: 20.5 });
    });

    it('does not put the player on top of a wall by the Bed', () => {
      const cells = cellsWith(BED);
      for (const [x, z] of [
        [11, 20],
        [10, 21],
        [10, 19],
      ] as const) {
        wall(cells, x, 5, z, 3);
      }
      const spot = bedSpawn(listing(BED), flat(5), cells, AT);
      expect(spot).toMatchObject({ x: 9.5, z: 20.5 });
      expect(spot!.y).toBeCloseTo(5.05, 6);
    });

    it('stands the player on the Bed when it is walled in on every side', () => {
      const cells = cellsWith(BED);
      for (const [x, z] of [
        [11, 20],
        [10, 21],
        [9, 20],
        [10, 19],
      ] as const) {
        wall(cells, x, 5, z);
      }
      const spot = bedSpawn(listing(BED), flat(5), cells, AT);
      expect(spot).toMatchObject({ x: 10.5, z: 20.5 });
      expect(spot!.y).toBeCloseTo(5 + TOP + 0.05, 6);
    });

    it('passes a Bed with no room above it, walled in or roofed over, for the next nearest', () => {
      const shut = site(MODULE.bed, 12, 5, 20);
      const open = site(MODULE.bed, 30, 5, 20);
      const cells = cellsWith(shut, open);
      for (const [x, z] of [
        [13, 20],
        [12, 21],
        [11, 20],
        [12, 19],
      ] as const) {
        wall(cells, x, 5, z);
      }
      // A roof two cells over the Bed leaves no room for a body on it.
      cells.set(12, 7, 20, 1);
      const spot = bedSpawn(listing(shut, open), flat(5), cells, { x: 12.5, y: 5, z: 22 });
      expect(spot).toMatchObject({ x: 31.5, z: 20.5 });
    });

    it('is nothing when the only Bed has no room at all, and the base’s seat is for the caller to use', () => {
      const cells = cellsWith(BED);
      for (const [x, z] of [
        [11, 20],
        [10, 21],
        [9, 20],
        [10, 19],
      ] as const) {
        wall(cells, x, 5, z);
      }
      cells.set(10, 6, 20, 1);
      expect(bedSpawn(listing(BED), flat(5), cells, AT)).toBeNull();
    });

    it('is nothing when the ground has swallowed the Bed and the sides are shut', () => {
      const cells = cellsWith(BED);
      for (const [x, z] of [
        [11, 20],
        [10, 21],
        [9, 20],
        [10, 19],
      ] as const) {
        wall(cells, x, 5, z, 4);
      }
      // The ground reaches over the Bed's top, so there is no cot to stand on.
      expect(bedSpawn(listing(BED), flat(5.8), cells, AT)).toBeNull();
    });
  });

  describe('where the ground is not level', () => {
    it('stands on a slope that rises from the Bed as far as a step', () => {
      const slope = { groundAt: (x: number) => 5 + (x - 10) * 0.5 };
      const spot = bedSpawn(listing(BED), slope, cellsWith(BED), AT);
      expect(spot).toMatchObject({ x: 11.5, z: 20.5 });
      expect(spot!.y).toBeCloseTo(5 + 0.75 + 0.05, 6);
    });

    it('goes round to the side when the ground in front rises a block or more', () => {
      const steep = { groundAt: (x: number) => 5 + (x - 10) * 1.2 };
      const spot = bedSpawn(listing(BED), steep, cellsWith(BED), AT);
      expect(spot).toMatchObject({ x: 10.5, z: 21.5 });
    });

    it('stands on ground that falls away from the Bed, but not on the ground under a floor', () => {
      const down = { groundAt: (x: number) => 5 - (x - 10) * 0.5 };
      expect(bedSpawn(listing(BED), down, cellsWith(BED), AT)).toMatchObject({ x: 11.5 });
      // A Bed on a floor a block thick over open ground three blocks down: the floor is the place to stand.
      const up = site(MODULE.bed, 10, 8, 20);
      const cells = cellsWith(up);
      for (const [x, z] of [
        [10, 20],
        [10, 21],
        [9, 20],
        [10, 19],
      ] as const) {
        cells.set(x, 7, z, 1);
      }
      const spot = bedSpawn(listing(up), flat(5), cells, AT);
      // The way ahead is open air under the floor's edge, which is no place to stand; the next is the floor.
      expect(spot).toMatchObject({ x: 10.5, z: 21.5 });
      expect(spot!.y).toBeCloseTo(8.05, 6);
    });
  });
});
