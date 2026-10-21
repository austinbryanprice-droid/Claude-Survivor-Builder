import { describe, expect, it } from 'vitest';
import { seatSpawn } from '../../src/app/seat-spawn';
import { SparseCells } from '../../src/shared/solid';

const flat = (height: number) => ({
  spawn: { x: 10.5, z: -4.5, yaw: 0 },
  groundAt: () => height,
});

describe('seat spawn', () => {
  it('puts seat 0 on the spawn point and the others in a row beside it', () => {
    const world = flat(7.25);
    const none = new SparseCells();
    const seats = [0, 1, 2, 3].map((slot) => seatSpawn(world, none, slot));
    expect(seats[0]).toMatchObject({ x: 10.5, z: -4.5 });
    // Facing -Z (yaw 0) the right hand is +X.
    expect(seats.map((s) => s.x)).toEqual([10.5, 12.3, 8.7, 14.1].map((x) => expect.closeTo(x, 6)));
    expect(new Set(seats.map((s) => s.z))).toEqual(new Set([-4.5]));
    for (const seat of seats) expect(seat.y).toBeCloseTo(7.3, 6);
  });

  it('follows the way the spawn faces', () => {
    const world = { ...flat(0), spawn: { x: 0, z: 0, yaw: Math.PI / 2 } };
    const seat = seatSpawn(world, new SparseCells(), 1);
    // Yaw π/2 looks toward -X, so the right hand points toward -Z.
    expect(seat.x).toBeCloseTo(0, 6);
    expect(seat.z).toBeCloseTo(-1.8, 6);
  });

  it('stands on a smooth ground height, not on a cell edge', () => {
    const seat = seatSpawn(flat(3.4), new SparseCells(), 0);
    expect(seat.y).toBeCloseTo(3.45, 6);
  });

  it('climbs above blocks built on the spot, so nobody starts inside a wall', () => {
    const world = flat(5.5);
    const cells = new SparseCells();
    // A three-high pillar on the cell seat 0 stands in.
    for (const y of [5, 6, 7]) cells.set(10, y, -5, 1);
    const seat = seatSpawn(world, cells, 0);
    expect(seat.y).toBeCloseTo(8.05, 6);
    // The next seat over is not in the way.
    expect(seatSpawn(world, cells, 1).y).toBeCloseTo(5.55, 6);
  });

  it('needs head room too: a ceiling just above the feet counts', () => {
    const cells = new SparseCells();
    // Floating roof two cells over the ground cell.
    cells.set(10, 7, -5, 1);
    const seat = seatSpawn(flat(5.5), cells, 0);
    expect(seat.y).toBeGreaterThan(8);
  });

  it('gives an unknown seat the spawn point', () => {
    expect(seatSpawn(flat(1), new SparseCells(), 9)).toMatchObject({ x: 10.5, z: -4.5 });
  });
});
