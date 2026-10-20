import { describe, expect, it } from 'vitest';
import {
  BLOCK,
  CLEAR_RADIUS,
  DECK,
  SPAWN,
  WALL_HEIGHT,
  buildProvingGround,
  type ProvingGround,
} from '../../src/engine/proving-ground-layout';
import { overlapsSolid } from '../../src/shared/collision';
import { TICK_SECONDS } from '../../src/shared/fixed-step';
import {
  PLAYER,
  createPlayerState,
  horizontalSpeed,
  stepPlayer,
  type PlayerState,
} from '../../src/shared/movement';
import { input, run, seconds } from './helpers';

const EAST = -Math.PI / 2;
const WEST = Math.PI / 2;
const NORTH = 0;
const SOUTH = Math.PI;

const world: ProvingGround = buildProvingGround();

function playerAt(x: number, y: number, z: number): PlayerState {
  const player = createPlayerState(x, y, z);
  run(player, input(), 5, world);
  return player;
}

describe('proving ground layout', () => {
  it('builds the same cells every time', () => {
    const again = buildProvingGround();
    expect(again.cells.size).toBe(world.cells.size);
    expect(again.cells.size).toBeGreaterThan(1000);
    expect(again.isSolid(-14, 0, -6)).toBe(world.isSolid(-14, 0, -6));
  });

  it('has a floor inside the deck and nothing outside it', () => {
    expect(world.isSolid(0, -1, 0)).toBe(true);
    expect(world.isSolid(DECK.min, -1, DECK.min)).toBe(true);
    expect(world.isSolid(DECK.max, -1, DECK.max)).toBe(true);
    expect(world.isSolid(DECK.max + 1, -1, 0)).toBe(false);
    expect(world.isSolid(0, -1, DECK.min - 1)).toBe(false);
    expect(world.isSolid(0, -2, 0)).toBe(false);
  });

  it('closes the deck with a wall on all four sides', () => {
    for (let i = DECK.min; i <= DECK.max; i++) {
      for (let y = 0; y < WALL_HEIGHT; y++) {
        expect(world.isSolid(i, y, DECK.min)).toBe(true);
        expect(world.isSolid(i, y, DECK.max)).toBe(true);
        expect(world.isSolid(DECK.min, y, i)).toBe(true);
        expect(world.isSolid(DECK.max, y, i)).toBe(true);
      }
      expect(world.isSolid(i, WALL_HEIGHT, DECK.min)).toBe(false);
    }
  });

  it('starts the player on open floor', () => {
    const player = createPlayerState(SPAWN.x, SPAWN.y, SPAWN.z);
    expect(overlapsSolid(player, world)).toBe(false);
    run(player, input(), seconds(1), world);
    expect(player.onGround).toBe(true);
    expect(player.y).toBeCloseTo(SPAWN.y, 3);
  });

  it('keeps the middle clear for the benchmark to circle in', () => {
    for (let x = -CLEAR_RADIUS; x <= CLEAR_RADIUS; x++) {
      for (let z = -CLEAR_RADIUS; z <= CLEAR_RADIUS; z++) {
        for (let y = 0; y <= 12; y++) {
          expect(world.isSolid(x, y, z), `cell ${x}, ${y}, ${z}`).toBe(false);
        }
      }
    }
  });

  it('keeps every feature inside the wall', () => {
    let count = 0;
    world.cells.forEach((x, y, z, id) => {
      count++;
      if (id === BLOCK.wall) return;
      expect(x, `${x},${y},${z}`).toBeGreaterThan(DECK.min);
      expect(x, `${x},${y},${z}`).toBeLessThan(DECK.max);
      expect(z, `${x},${y},${z}`).toBeGreaterThan(DECK.min);
      expect(z, `${x},${y},${z}`).toBeLessThan(DECK.max);
      expect(y).toBeGreaterThanOrEqual(0);
    });
    expect(count).toBe(world.cells.size);
  });
});

describe('the stairs', () => {
  it('can be climbed by holding forward and jump, up to the lookout', () => {
    const player = playerAt(9.5, 0, -0.5);
    run(player, input({ forward: 1, jump: true, yaw: EAST }), seconds(6), world);
    run(player, input(), seconds(1), world);
    expect(player.y).toBeCloseTo(6, 3);
    expect(player.x).toBeGreaterThan(19.3);
    expect(player.onGround).toBe(true);
  });

  it('keeps a player on the lookout: the east rail is too tall to hop and stops a run off the edge', () => {
    const player = playerAt(20.5, 6, -0.5);
    const { peakY } = run(
      player,
      input({ forward: 1, sprint: true, jump: true, yaw: EAST }),
      seconds(5),
      world,
    );
    expect(player.x).toBeLessThan(22 - PLAYER.halfWidth + 1e-3);
    expect(player.y).toBeGreaterThanOrEqual(6 - 1e-3);
    expect(peakY).toBeLessThan(8);
  });

  it('is a wall to a player who never jumps', () => {
    const player = playerAt(9.5, 0, -0.5);
    run(player, input({ forward: 1, yaw: EAST }), seconds(4), world);
    expect(player.y).toBe(0);
    expect(player.x).toBeLessThan(13 - PLAYER.halfWidth + 1e-3);
  });

  it('lets the player walk off the lookout and land on the deck', () => {
    const player = playerAt(20.5, 6, -0.5);
    run(player, input({ forward: 1, yaw: WEST }), seconds(3), world);
    expect(player.y).toBeCloseTo(0, 3);
    expect(player.onGround).toBe(true);
    expect(player.x).toBeLessThan(12);
  });
});

describe('the jumping gaps', () => {
  /** Platforms along the north side, west to east, with the gap in blocks between each pair. */
  const platforms = [
    { from: -22, to: -21 },
    { from: -19, to: -18 },
    { from: -15, to: -14 },
    { from: -10, to: -9 },
    { from: -4, to: -1 },
  ];
  const Z = -21 + 0.5;
  const TOP = 1;

  /**
   * Runs east along `a` and presses jump once the player's center is `lead` blocks short of the
   * end, then reports whether the player landed on `b`.
   */
  function crossing(
    a: (typeof platforms)[number],
    b: (typeof platforms)[number],
    sprint: boolean,
    lead: number,
  ): boolean {
    const player = playerAt(a.from + 0.5, TOP, Z);
    const edge = a.to + 1;
    let airborne = false;
    for (let tick = 0; tick < 120; tick++) {
      const jump = !airborne && player.x >= edge - lead;
      stepPlayer(player, input({ forward: 1, sprint, jump, yaw: EAST }), TICK_SECONDS, world);
      if (!player.onGround) airborne = true;
      if (airborne && player.onGround) {
        return Math.abs(player.y - TOP) < 1e-3 && player.x > b.from - PLAYER.halfWidth;
      }
    }
    return false;
  }

  /** The best timing wins: tries a jump at each lead from a block early to just after the edge. */
  function canCross(a: (typeof platforms)[number], b: (typeof platforms)[number], sprint: boolean) {
    for (let lead = 1; lead >= -0.4; lead -= 0.05) {
      if (crossing(a, b, sprint, lead)) return true;
    }
    return false;
  }

  it('has gaps of one, two, three and four blocks', () => {
    const gaps = platforms.slice(1).map((p, i) => p.from - (platforms[i]?.to ?? 0) - 1);
    expect(gaps).toEqual([1, 2, 3, 4]);
  });

  it('can be crossed one after the other at a sprint', () => {
    for (let i = 0; i < platforms.length - 1; i++) {
      const a = platforms[i];
      const b = platforms[i + 1];
      if (!a || !b) throw new Error('missing platform');
      expect(canCross(a, b, true), `gap ${i + 1}`).toBe(true);
    }
  });

  it('can be crossed at a walk for the short gaps, but not the four-block one', () => {
    const [p0, p1, p2, p3, p4] = platforms;
    if (!p0 || !p1 || !p2 || !p3 || !p4) throw new Error('missing platform');
    expect(canCross(p0, p1, false)).toBe(true);
    expect(canCross(p1, p2, false)).toBe(true);
    expect(canCross(p3, p4, false)).toBe(false);
  });

  it('drops a player who walks off the edge onto the deck', () => {
    const player = playerAt(-21.5, TOP, Z);
    run(player, input({ forward: 1, yaw: EAST }), seconds(1.5), world);
    expect(player.y).toBeLessThan(TOP - 0.5);
  });
});

describe('the doorways', () => {
  function walkWest(z: number, from = -8.5): PlayerState {
    const player = playerAt(from, 0, z);
    run(player, input({ forward: 1, yaw: WEST }), seconds(3), world);
    return player;
  }

  it('lets a player through the one-wide, two-high door', () => {
    expect(walkWest(0.5).x).toBeLessThan(-16);
  });

  it('lets a player through the three-by-three door', () => {
    expect(walkWest(-2.5).x).toBeLessThan(-16);
  });

  it('stops a player at the one-high slot, even jumping', () => {
    const player = playerAt(-8.5, 0, 3.5);
    run(player, input({ forward: 1, jump: true, yaw: WEST }), seconds(3), world);
    expect(player.x).toBeGreaterThan(-13 + PLAYER.halfWidth - 1e-3);
  });

  it('stops a player at the solid wall beside the doors', () => {
    const player = walkWest(5.5);
    expect(player.x).toBeCloseTo(-13 + PLAYER.halfWidth, 3);
  });
});

describe('the tunnels', () => {
  function walkSouth(x: number): PlayerState {
    const player = playerAt(x, 0, 9.5);
    run(player, input({ forward: 1, yaw: SOUTH }), seconds(4), world);
    return player;
  }

  it('lets a player walk through the two-high tunnel', () => {
    const player = walkSouth(0.5);
    expect(player.z).toBeGreaterThan(21);
    expect(player.x).toBeCloseTo(0.5, 3);
  });

  it('keeps a player out of the one-high tunnel', () => {
    const player = walkSouth(5.5);
    expect(player.z).toBeCloseTo(14 - PLAYER.halfWidth, 3);
  });

  it('is open at both ends, so a player can come back out', () => {
    const player = playerAt(0.5, 0, 20.5);
    run(player, input({ forward: 1, yaw: NORTH }), seconds(3), world);
    expect(player.z).toBeLessThan(13);
  });
});

describe('the landmarks', () => {
  it('has a tower ten blocks tall with a cap above it', () => {
    expect(world.isSolid(16, 9, -17)).toBe(true);
    expect(world.isSolid(16, 10, -17)).toBe(true);
    expect(world.isSolid(16, 11, -17)).toBe(true);
    expect(world.cells.get(16, 11, -17)).toBe(BLOCK.towerCap);
    expect(world.isSolid(16, 12, -17)).toBe(false);
  });

  it('has a stepped pyramid that is climbable, one block at a time, up to its peak', () => {
    const player = playerAt(11.5, 0, 17.5);
    const { peakY } = run(player, input({ forward: 1, jump: true, yaw: EAST }), seconds(8), world);
    expect(peakY).toBeGreaterThanOrEqual(4 - 1e-3);
  });

  it('scatters slalom pillars that can be walked around', () => {
    let pillars = 0;
    world.cells.forEach((_x, _y, _z, id) => {
      if (id === BLOCK.pillar) pillars++;
    });
    expect(pillars).toBeGreaterThan(20);
    // Walking straight through the field in the open lane along its eastern edge never stops.
    const player = playerAt(-12.5, 0, 9.5);
    run(player, input({ forward: 1, yaw: SOUTH }), seconds(2), world);
    expect(horizontalSpeed(player)).toBeGreaterThan(3);
  });
});
