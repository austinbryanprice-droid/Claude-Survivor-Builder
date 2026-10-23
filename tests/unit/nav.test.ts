import { describe, expect, it } from 'vitest';
import type { CellState } from '../../src/shared/block-world';
import { MATERIAL } from '../../src/shared/blocks';
import { ENEMIES } from '../../src/systems/survival/balance';
import {
  NAV_BLOCKED,
  NAV_CORE,
  NAV_OPEN,
  NAV_WALLED,
  NavGrid,
  type NavCell,
} from '../../src/systems/survival/nav';
import { ALLOY, SCRAP, flatWorld } from './helpers/nav-world';

/** The cell columns beside the Core's footprint (x from -3 to -1, z from -5 to -3 in a flat world). */
const EAST = 0;
const MIDDLE_Z = -4;

function gridOf(flat = flatWorld()): { flat: ReturnType<typeof flatWorld>; nav: NavGrid } {
  return { flat, nav: new NavGrid(flat.world, flat.core) };
}

/** The columns of the walk from a point to the Core, nearest first. */
function walkFrom(nav: NavGrid, x: number, z: number): number[] {
  const walk: number[] = [];
  let at = nav.indexAt(x, z);
  while (at >= 0) {
    walk.push(at);
    at = nav.nextOf(at);
  }
  return walk;
}

describe('the map the enemies walk', () => {
  it('has the Core as the goal and open ground round it', () => {
    const { flat, nav } = gridOf();
    const core = flat.core;
    expect(nav.stateAt(core.x, core.z)).toBe(NAV_CORE);
    expect(nav.costAt(core.x, core.z)).toBe(0);
    expect(nav.stateAt(EAST + 0.5, MIDDLE_Z + 0.5)).toBe(NAV_OPEN);
    expect(nav.side).toBe(Math.ceil(ENEMIES.navRadius) * 2 + 1);
  });

  it('measures the walk in blocks: straight steps count one, corners the root of two', () => {
    const { nav } = gridOf();
    // Beside the Core, then straight east.
    expect(nav.costAt(EAST + 0.5, MIDDLE_Z + 0.5)).toBeCloseTo(1, 6);
    expect(nav.costAt(EAST + 5.5, MIDDLE_Z + 0.5)).toBeCloseTo(6, 6);
    // Three east and three north of the first column that touches the Core's corner.
    expect(nav.costAt(EAST + 3.5, MIDDLE_Z + 3.5)).toBeGreaterThan(
      nav.costAt(EAST + 3.5, MIDDLE_Z + 0.5),
    );
    // Moving diagonally across open ground is the cheaper way.
    const diagonal = nav.costAt(EAST + 10.5, MIDDLE_Z + 10.5);
    const taxi = 10 + 10;
    expect(diagonal).toBeLessThan(taxi);
    expect(diagonal).toBeGreaterThan(Math.hypot(10, 10));
  });

  it('is never cheaper than the straight line, and a walk always ends at the Core', () => {
    const { flat, nav } = gridOf();
    for (const [x, z] of [
      [30.5, 20.5],
      [-40.5, 10.5],
      [5.5, -45.5],
      [-20.5, -30.5],
    ] as const) {
      expect(nav.costAt(x, z)).toBeGreaterThanOrEqual(
        Math.hypot(x - flat.core.x, z - flat.core.z) - 3,
      );
      const walk = walkFrom(nav, x, z);
      expect(nav.state[walk[walk.length - 1] as number]).toBe(NAV_CORE);
    }
  });

  it('is blocked at the edge of the valley, and off the map', () => {
    const flat = flatWorld({ half: 20 });
    const nav = new NavGrid(flat.world, flat.core);
    expect(nav.stateAt(25.5, 0.5)).toBe(NAV_BLOCKED);
    expect(nav.stateAt(19.8, 0.5)).toBe(NAV_BLOCKED);
    expect(nav.stateAt(10.5, 0.5)).toBe(NAV_OPEN);
    expect(nav.stateAt(500, 0)).toBe(NAV_BLOCKED);
    expect(nav.costAt(500, 0)).toBe(Infinity);
  });

  it('does not walk into deep water, and wades through shallow', () => {
    // The ground falls away to the east; the water stands at 7.
    const flat = flatWorld({
      height: (x) => (x < 12 ? 10 : Math.max(2, 10 - (x - 12) * 0.5)),
      waterLevel: 7,
    });
    const nav = new NavGrid(flat.world, flat.core);
    // The middle of column 14 is dry at 8.75, and 18 has the ground at 6.75: a quarter under, a wade.
    expect(nav.stateAt(14.5, 0.5)).toBe(NAV_OPEN);
    expect(nav.stateAt(18.5, 0.5)).toBe(NAV_OPEN);
    // 6.25 is three quarters of a block under the surface: too deep, and so is everything past it.
    expect(nav.stateAt(19.5, 0.5)).toBe(NAV_BLOCKED);
    expect(nav.stateAt(23.5, 0.5)).toBe(NAV_BLOCKED);
    expect(nav.costAt(30.5, 0.5)).toBe(Infinity);
    expect(Number.isFinite(nav.costAt(18.5, 0.5))).toBe(true);
  });
});

describe('climbing and cliffs', () => {
  it('climbs a step the body can and treats a taller one as a cliff', () => {
    // A ledge one block up to the east of x = 10, and a cliff two blocks up past x = 30.
    const flat = flatWorld({ height: (x) => (x < 10 ? 10 : x < 30 ? 11 : 13) });
    const nav = new NavGrid(flat.world, flat.core);
    expect(Number.isFinite(nav.costAt(20.5, 0.5))).toBe(true);
    expect(nav.costAt(40.5, 0.5)).toBe(Infinity);
  });

  it('goes round a cliff by way of a ramp', () => {
    // A plateau two blocks up from x = 10 on, with a ramp up to it along z = 30 to 34.
    const ramp = (x: number): number => 10 + Math.min(2, Math.max(0, (x - 10) * 0.5));
    const withRamp = flatWorld({
      height: (x, z) => (x < 10 ? 10 : z >= 30 && z < 34 ? ramp(x) : 12),
    });
    const noRamp = flatWorld({ height: (x) => (x < 10 ? 10 : 12) });
    const open = new NavGrid(withRamp.world, withRamp.core);
    const sheer = new NavGrid(noRamp.world, noRamp.core);
    // With no ramp the plateau cannot be reached at all.
    expect(sheer.costAt(20.5, 0.5)).toBe(Infinity);
    // With one it can, by walking out to the ramp and back: much farther than the straight line.
    const walk = open.costAt(20.5, 0.5);
    expect(Number.isFinite(walk)).toBe(true);
    expect(walk).toBeGreaterThan(60);
    // The walk comes down off the plateau once, and by the ramp.
    const column = { x: 0, z: 0 };
    const crossings: number[] = [];
    let before = Infinity;
    for (const index of walkFrom(open, 20.5, 0.5)) {
      open.cellOf(index, column);
      if (before >= 10 && column.x < 10) crossings.push(column.z);
      before = column.x;
    }
    expect(crossings).toHaveLength(1);
    expect(crossings[0]).toBeGreaterThanOrEqual(30);
    expect(crossings[0]).toBeLessThan(34);
  });
});

describe('walls and chewing', () => {
  it('is blocked by a block on the ground, and open above head height', () => {
    const { flat, nav } = gridOf();
    flat.place(8, 10, 0);
    nav.cellChanged(8, 10, 0);
    expect(nav.stateAt(8.5, 0.5)).toBe(NAV_WALLED);
    // A roof two blocks up is no wall: a body walks under it.
    flat.place(9, 12, 0);
    nav.cellChanged(9, 12, 0);
    expect(nav.stateAt(9.5, 0.5)).toBe(NAV_OPEN);
    // Taking the block away opens the column again.
    flat.remove(8, 10, 0);
    nav.cellChanged(8, 10, 0);
    expect(nav.stateAt(8.5, 0.5)).toBe(NAV_OPEN);
  });

  it('reads a column again at once and the routes within a refresh', () => {
    const { flat, nav } = gridOf();
    const before = nav.costAt(8.5, 0.5);
    flat.place(4, 10, 0);
    nav.cellChanged(4, 10, 0);
    expect(nav.stale).toBe(true);
    // Not yet: the field still describes the old ground.
    nav.advance(ENEMIES.navRefreshSeconds / 2);
    expect(nav.stale).toBe(true);
    nav.advance(ENEMIES.navRefreshSeconds);
    expect(nav.stale).toBe(false);
    expect(nav.costAt(8.5, 0.5)).toBeGreaterThanOrEqual(before);
    // A cell far above the ground changes nothing.
    nav.cellChanged(4, 40, 0);
    expect(nav.stale).toBe(false);
  });

  it('goes round a short wall and chews through a long one', () => {
    // Chewing a scrap block is worth this many blocks of walking.
    const chew = (ENEMIES.crawler.gnawSeconds[MATERIAL.scrap] as number) * ENEMIES.crawler.speed;
    // A wall of five blocks across the way east: the walk round it costs about three extra steps.
    const short = gridOf();
    for (let z = MIDDLE_Z - 2; z <= MIDDLE_Z + 2; z++) {
      short.flat.place(8, 10, z);
      short.nav.cellChanged(8, 10, z);
    }
    short.nav.solve();
    const roundShort = walkFrom(short.nav, 14.5, MIDDLE_Z + 0.5);
    expect(roundShort.every((i) => short.nav.state[i] !== NAV_WALLED)).toBe(true);
    const bare = gridOf().nav.costAt(14.5, MIDDLE_Z + 0.5);
    expect(short.nav.costAt(14.5, MIDDLE_Z + 0.5) - bare).toBeGreaterThan(0);
    expect(short.nav.costAt(14.5, MIDDLE_Z + 0.5) - bare).toBeLessThan(chew);

    // A wall of forty-one: chewing one block costs far less than walking round, and that is the price.
    const long = gridOf();
    for (let z = MIDDLE_Z - 20; z <= MIDDLE_Z + 20; z++) {
      long.flat.place(8, 10, z);
      long.nav.cellChanged(8, 10, z);
    }
    long.nav.solve();
    const through = walkFrom(long.nav, 14.5, MIDDLE_Z + 0.5);
    expect(through.filter((i) => long.nav.state[i] === NAV_WALLED)).toHaveLength(1);
    expect(long.nav.costAt(14.5, MIDDLE_Z + 0.5) - bare).toBeCloseTo(chew, 4);
  });

  it('still reaches a Core that is walled in on every side', () => {
    const { flat, nav } = gridOf();
    // A ring of blocks two steps off the footprint.
    for (let x = -5; x <= 1; x++) {
      for (let z = -7; z <= -1; z++) {
        if (x > -5 && x < 1 && z > -7 && z < -1) continue;
        flat.place(x, 10, z);
        nav.cellChanged(x, 10, z);
      }
    }
    nav.solve();
    const start = nav.indexAt(20.5, MIDDLE_Z + 0.5);
    expect(Number.isFinite(nav.costOf(start))).toBe(true);
    const walls = walkFrom(nav, 20.5, MIDDLE_Z + 0.5).filter((i) => nav.state[i] === NAV_WALLED);
    expect(walls).toHaveLength(1);
    const cell: NavCell = { x: 0, y: 0, z: 0 };
    expect(nav.wallCell(walls[0] as number, cell)).toBe(true);
    expect(cell.y).toBe(10);
  });

  it('goes round to a softer wall when the near one is tougher', () => {
    // A ring of scrap round the Core, except that its north row is made of `north`.
    const ring = (north: CellState): { nav: NavGrid; block(cell: NavCell): CellState } => {
      const { flat, nav } = gridOf();
      for (let x = -5; x <= 1; x++) {
        for (let z = -7; z <= -1; z++) {
          if (x > -5 && x < 1 && z > -7 && z < -1) continue;
          flat.place(x, 10, z, z === -7 ? north : SCRAP);
          nav.cellChanged(x, 10, z);
        }
      }
      nav.solve();
      return { nav, block: (cell) => flat.world.blockAt(cell.x, cell.y, cell.z) };
    };
    // The block the walk from far to the north chews through to get into the ring.
    const gate = (walled: ReturnType<typeof ring>): NavCell => {
      const { nav } = walled;
      const walls = walkFrom(nav, -1.5, -30.5).filter((i) => nav.state[i] === NAV_WALLED);
      expect(walls).toHaveLength(1);
      const cell: NavCell = { x: 0, y: 0, z: 0 };
      expect(nav.wallCell(walls[0] as number, cell)).toBe(true);
      return cell;
    };
    // All scrap: straight in through the north row, the nearest.
    expect(gate(ring(SCRAP)).z).toBe(-7);
    // Alloy there is ten blocks of walking dearer to chew than scrap, and the way round to a
    // side of scrap is shorter than that: the walk goes round.
    const round = ring(ALLOY);
    const through = gate(round);
    expect(through.z).not.toBe(-7);
    expect(round.block(through)).toBe(SCRAP);
  });

  it('prices a wall by the blocks in the body, and a block above it counts too', () => {
    const { flat, nav } = gridOf();
    flat.place(8, 10, 0);
    nav.cellChanged(8, 10, 0);
    nav.solve();
    const oneBlock = nav.costAt(9.5, 0.5);
    // A two-high wall is two blocks to chew only where the body is two cells tall: ground at 10.0 makes it one.
    flat.place(8, 11, 0);
    nav.cellChanged(8, 11, 0);
    nav.solve();
    expect(nav.costAt(9.5, 0.5)).toBe(oneBlock);
  });

  it('chews cells where the body is, lowest first', () => {
    // Ground at 10.5 puts a body across two rows of cells.
    const flat = flatWorld({ height: () => 10.5 });
    const nav = new NavGrid(flat.world, flat.core);
    flat.place(8, 11, 0);
    flat.place(8, 10, 0);
    nav.cellChanged(8, 10, 0);
    nav.cellChanged(8, 11, 0);
    const cell: NavCell = { x: 0, y: 0, z: 0 };
    const index = nav.indexAt(8.5, 0.5);
    expect(nav.wallCell(index, cell)).toBe(true);
    expect(cell).toEqual({ x: 8, y: 10, z: 0 });
    flat.remove(8, 10, 0);
    nav.cellChanged(8, 10, 0);
    expect(nav.wallCell(index, cell)).toBe(true);
    expect(cell).toEqual({ x: 8, y: 11, z: 0 });
    flat.remove(8, 11, 0);
    nav.cellChanged(8, 11, 0);
    expect(nav.wallCell(index, cell)).toBe(false);
  });

  it('knows how long a block takes by its material', () => {
    const { flat, nav } = gridOf();
    flat.place(8, 10, 0, SCRAP);
    flat.place(8, 10, 2, ALLOY);
    expect(nav.gnawSeconds(8, 10, 0)).toBe(ENEMIES.crawler.gnawSeconds[1]);
    expect(nav.gnawSeconds(8, 10, 2)).toBe(ENEMIES.crawler.gnawSeconds[3]);
    // The Core's own cells hold no block: the default applies.
    expect(nav.gnawSeconds(-2, 10, -4)).toBe(ENEMIES.crawler.gnawDefault);
  });
});

describe('finding the way', () => {
  it('aims at a spot well down the route in open ground', () => {
    const { nav } = gridOf();
    const out = { x: 0, z: 0 };
    expect(nav.aim(30.5, MIDDLE_Z + 0.5, ENEMIES.lookAhead, out)).toBe(true);
    // Straight along the row, as far as it looks.
    expect(out.z).toBeCloseTo(MIDDLE_Z + 0.5, 6);
    expect(30.5 - out.x).toBeCloseTo(ENEMIES.lookAhead, 6);
  });

  it('does not aim through a wall, or off a point with no way', () => {
    const { flat, nav } = gridOf();
    for (let z = MIDDLE_Z - 3; z <= MIDDLE_Z + 3; z++) {
      flat.place(10, 10, z);
      nav.cellChanged(10, 10, z);
    }
    nav.solve();
    const out = { x: 0, z: 0 };
    expect(nav.aim(14.5, MIDDLE_Z + 0.5, ENEMIES.lookAhead, out)).toBe(true);
    expect(nav.lineClear(14.5, MIDDLE_Z + 0.5, out.x, out.z)).toBe(true);
    expect(nav.aim(500, 0, ENEMIES.lookAhead, out)).toBe(false);
  });

  it('checks a straight line against walls, with room for a body', () => {
    const { flat, nav } = gridOf();
    expect(nav.lineClear(20.5, 0.5, 6.5, 0.5)).toBe(true);
    flat.place(10, 10, 0);
    nav.cellChanged(10, 10, 0);
    expect(nav.lineClear(20.5, 0.5, 6.5, 0.5)).toBe(false);
    // Along the wall's column one cell over passes, but brushing past its corner does not.
    expect(nav.lineClear(20.5, 2.5, 6.5, 2.5)).toBe(true);
    expect(nav.lineClear(20.5, 1.1, 6.5, 1.1)).toBe(false);
    expect(nav.lineClear(20.5, 1.6, 6.5, 1.6)).toBe(true);
  });

  it('gives the ground height between column middles', () => {
    const flat = flatWorld({ height: (x) => 10 + x * 0.1 });
    const nav = new NavGrid(flat.world, flat.core);
    expect(nav.heightAt(20.5, 0.5)).toBeCloseTo(12.05, 3);
    expect(nav.heightAt(21, 0.5)).toBeCloseTo(12.1, 3);
  });
});
