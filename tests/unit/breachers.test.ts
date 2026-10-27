import { describe, expect, it } from 'vitest';
import { MATERIAL } from '../../src/shared/blocks';
import {
  ENEMY_FLAG,
  ENEMY_KIND,
  createEnemyState,
  type EnemyState,
} from '../../src/shared/enemy-state';
import {
  SIM_STEP_SECONDS,
  createReading,
  nightStart,
  type SurvivalEvent,
} from '../../src/shared/survival-state';
import { CORE_FOOTPRINT } from '../../src/world/outpost';
import { ENEMIES, SURVIVAL, VITALS } from '../../src/systems/survival/balance';
import { EnemySim, type Strikes, type Target } from '../../src/systems/survival/enemies';
import { NavGrid, type NavCell } from '../../src/systems/survival/nav';
import { SurvivalSim } from '../../src/systems/survival/sim';
import { flatWorld, type FlatOptions } from './helpers/nav-world';

const BREACHER = ENEMIES.breacher;
const BLAST = BREACHER.blast;
const BREACHING = ENEMY_KIND.breacher;
const GROUND = 10;

interface Blast {
  x: number;
  y: number;
  z: number;
  /** The number of steps taken when it went off. */
  tick: number;
}

/** The machines of a flat field, the targets they could go after, and everything the breachers do to the world. */
function field(options?: FlatOptions, seed = 7) {
  const flat = flatWorld(options);
  const nav = new NavGrid(flat.world, flat.core);
  const sim = new EnemySim(nav, { core: flat.core, seed });
  const core: number[] = [];
  const players: [number, number][] = [];
  const blasts: Blast[] = [];
  const felled: number[] = [];
  const targets: Target[] = [];
  const strikes: Strikes = {
    hurtPlayer(id, amount) {
      players.push([id, amount]);
      return amount;
    },
    hurtCore(amount) {
      core.push(amount);
      return false;
    },
  };
  let tick = 0;
  sim.onBlast = (x, y, z) => blasts.push({ x, y, z, tick });
  sim.onFelled = (kind) => felled.push(kind);
  const states = Array.from({ length: ENEMIES.maxAlive }, createEnemyState);
  const where = (): EnemyState[] => {
    const n = sim.write(states);
    return states.slice(0, n).map((state) => ({ ...state }));
  };
  const breaks: NavCell[] = [];
  return {
    flat,
    nav,
    sim,
    core,
    players,
    blasts,
    felled,
    targets,
    where,
    /** Plays this many seconds, calling `watch` with the machines after every step. */
    run(seconds: number, watch?: (machines: EnemyState[]) => void): void {
      const steps = Math.round(seconds / SIM_STEP_SECONDS);
      for (let i = 0; i < steps; i++) {
        sim.step(SIM_STEP_SECONDS, targets, targets.length, strikes);
        tick++;
        if (watch) watch(where());
      }
    },
    /** Plays until `done` says so (asked before every step), or `limit` seconds have passed; returns the seconds played. */
    until(done: () => boolean, limit = 40): number {
      let steps = 0;
      while (!done() && steps * SIM_STEP_SECONDS < limit) {
        sim.step(SIM_STEP_SECONDS, targets, targets.length, strikes);
        tick++;
        steps++;
      }
      return steps * SIM_STEP_SECONDS;
    },
    /** What the host does with the blocks the machines have broken: takes them out of the world and tells the map. Returns them. */
    drain(): NavCell[] {
      breaks.length = 0;
      sim.drainBreaks(breaks);
      const cells = breaks.map((cell) => ({ ...cell }));
      for (const cell of cells) {
        flat.remove(cell.x, cell.y, cell.z);
        sim.blockChanged(cell.x, cell.y, cell.z);
      }
      return cells;
    },
  };
}

type Field = ReturnType<typeof field>;

/** A wall of the crew's blocks: `height` rows from the ground, over a rectangle of cells. */
function wall(
  f: Field,
  from: { x: number; z: number },
  to: { x: number; z: number },
  height: number,
  base = GROUND,
): void {
  for (let x = from.x; x <= to.x; x++) {
    for (let z = from.z; z <= to.z; z++) {
      for (let y = base; y < base + height; y++) {
        f.flat.place(x, y, z);
        f.sim.blockChanged(x, y, z);
      }
    }
  }
}

/** How far a point is from the Core's walls, sideways, in blocks. */
function awayFromCore(f: Field, x: number, z: number): number {
  const core = f.flat.core;
  const dx = Math.max(core.cellX - x, 0, x - (core.cellX + CORE_FOOTPRINT));
  const dz = Math.max(core.cellZ - z, 0, z - (core.cellZ + CORE_FOOTPRINT));
  return Math.hypot(dx, dz);
}

/** True when the middle of a cell is within a blast's reach of its middle. */
function reaches(at: Blast, cell: NavCell): boolean {
  return Math.hypot(cell.x + 0.5 - at.x, cell.y + 0.5 - at.y, cell.z + 0.5 - at.z) <= BLAST.radius;
}

const key = (cell: NavCell): string => `${cell.x},${cell.y},${cell.z}`;

/** A wall across the way from the west, 55 cells long: the crawlers’ map goes through it, not round. */
function longWall(f: Field, thick = 1): { x: number; z: number } {
  const core = f.flat.core;
  const x = core.cellX - 12;
  wall(f, { x, z: core.cellZ - 30 }, { x: x + thick - 1, z: core.cellZ + 24 }, 4);
  return { x, z: Math.floor(core.z) };
}

describe('the breacher’s way', () => {
  it('is the crawlers’ route to the Core, at its own pace, with no notice taken of the crew', () => {
    const f = field();
    const core = f.flat.core;
    f.sim.spawnAt(core.cellX - 20.5, core.z, 1, BREACHING);
    // A player two blocks off its path a few blocks on, near enough to pull a crawler off its way.
    f.targets.push({ id: 3, x: core.cellX - 16, y: GROUND, z: core.z + 2.5 });
    const start = (f.where()[0] as EnemyState).x;
    let before = start;
    let steady = true;
    f.run(2, ([machine]) => {
      const m = machine as EnemyState;
      if (m.x < before) steady = false;
      before = m.x;
    });
    expect(steady).toBe(true);
    // Two seconds at its speed, give or take what it lost turning to its route.
    expect(before - start).toBeGreaterThan(BREACHER.speed * 2 * 0.9);
    expect(before - start).toBeLessThanOrEqual(BREACHER.speed * 2 + 1e-6);
    const [machine] = f.where();
    expect(Math.abs((machine as EnemyState).z - core.z)).toBeLessThan(0.3);

    // It goes on to the Core and goes off there, once, and nobody was bitten on the way.
    const seconds = f.until(() => f.sim.count === 0) + 2;
    expect(f.blasts).toHaveLength(1);
    expect(f.players).toEqual([]);
    expect(f.core).toEqual([BLAST.core]);
    // It walked from 20.5 blocks off to within 1.4 of the Core's wall, then stood to charge.
    const expected = (20.5 - BREACHER.reach.core) / BREACHER.speed + BLAST.windup;
    expect(Math.abs(seconds - expected)).toBeLessThan(0.5);
  });

  it('goes off at the Core’s wall and nowhere else, taking the Core’s health and leaving nothing behind', () => {
    const f = field();
    const core = f.flat.core;
    f.sim.spawnAt(core.cellX - 10.5, core.z + 0.2, 1, BREACHING);
    f.until(() => f.sim.count === 0);
    expect(f.sim.count).toBe(0);
    expect(f.blasts).toHaveLength(1);
    const at = f.blasts[0] as Blast;
    expect(awayFromCore(f, at.x, at.z)).toBeLessThanOrEqual(BLAST.coreReach);
    // Half its height over the ground, a little ahead of where it stood.
    expect(at.y).toBeCloseTo(GROUND + BREACHER.height / 2, 6);
    expect(f.core).toEqual([BLAST.core]);
    // It was not felled: no drop was asked for, and nothing it did counts as a kill.
    expect(f.felled).toEqual([]);
    expect(f.drain()).toEqual([]);
  });

  it('walks round a short wall rather than blast it, when the map says that is cheaper', () => {
    const f = field();
    const core = f.flat.core;
    // Three cells across its way, four high: a few blocks to go round, far more to chew.
    wall(
      f,
      { x: core.cellX - 8, z: Math.floor(core.z) - 1 },
      { x: core.cellX - 8, z: Math.floor(core.z) + 1 },
      4,
    );
    f.sim.spawnAt(core.cellX - 16.5, core.z, 1, BREACHING);
    let charged = 0;
    let wallBlasted = false;
    f.until(() => {
      const [machine] = f.where();
      if (machine && (machine.flags & ENEMY_FLAG.attack) !== 0) {
        charged++;
        // It may stand to charge only at the Core.
        if (awayFromCore(f, machine.x, machine.z) > BREACHER.reach.core) wallBlasted = true;
      }
      return f.sim.count === 0;
    });
    expect(wallBlasted).toBe(false);
    expect(charged).toBeGreaterThan(0);
    // It went off at the Core, and the wall is as it was.
    expect(f.core).toEqual([BLAST.core]);
    expect(f.drain().filter((cell) => cell.x === core.cellX - 8)).toEqual([]);
  });
});

describe('the breacher’s charge', () => {
  it('is a stop at the wall its route runs into, for the whole of its windup, with the attack flag up', () => {
    const f = field();
    const core = f.flat.core;
    const { x: wx } = longWall(f);
    f.sim.spawnAt(wx - 8.5, core.z, 1, BREACHING);
    const frames: EnemyState[] = [];
    f.until(() => {
      const [machine] = f.where();
      if (machine && (machine.flags & ENEMY_FLAG.attack) !== 0) frames.push(machine);
      return f.sim.count === 0;
    });
    // It charged for its windup, not a step less or more, standing where it began.
    expect(frames).toHaveLength(Math.round(BLAST.windup / SIM_STEP_SECONDS));
    for (const frame of frames) {
      expect(frame.x).toBeCloseTo((frames[0] as EnemyState).x, 6);
      expect(frame.z).toBeCloseTo((frames[0] as EnemyState).z, 6);
    }
    // Close to the wall, not against the Core, and facing it.
    const first = frames[0] as EnemyState;
    expect(wx - first.x).toBeGreaterThan(0);
    expect(wx - first.x).toBeLessThanOrEqual(ENEMIES.gnawReach + 0.1);
    expect(Math.abs(first.yaw - Math.PI / 2)).toBeLessThan(0.3);
    expect(f.blasts).toHaveLength(1);
    expect(f.core).toEqual([]);
  });

  it('breaks the blocks within its radius of the blast, the lot of them at once, and no others', () => {
    const f = field();
    const core = f.flat.core;
    const { x: wx } = longWall(f, 5);
    const all: NavCell[] = [];
    for (let x = wx; x < wx + 5; x++) {
      for (let z = core.cellZ - 30; z <= core.cellZ + 24; z++) {
        for (let y = GROUND; y < GROUND + 4; y++) all.push({ x, y, z });
      }
    }
    f.sim.spawnAt(wx - 8.5, core.z, 1, BREACHING);
    // Nothing is chewed while it walks, or while it charges; the blow breaks the lot in one step.
    const during: NavCell[] = [];
    f.until(() => {
      if (f.blasts.length > 0) return true;
      during.push(...f.drain());
      return false;
    });
    expect(during).toEqual([]);
    expect(f.blasts).toHaveLength(1);
    const at = f.blasts[0] as Blast;
    expect(f.sim.count).toBe(0);
    const broken = f.drain();
    const gone = new Set(broken.map(key));
    expect(gone.size).toBe(broken.length);
    const expected = all.filter((cell) => reaches(at, cell)).map(key);
    expect([...gone].sort()).toEqual([...expected].sort());
    // A hole through the foot of the wall, two blocks deep: the middle of the blast stands in the first column.
    expect(broken.length).toBeGreaterThan(8);
    const columns = new Set(broken.map((cell) => cell.x));
    expect([...columns].sort((a, b) => a - b)).toEqual([wx, wx + 1]);
    // The rest of the wall stands, and the Core was out of reach.
    expect(f.core).toEqual([]);
    expect(all.length - broken.length).toBeGreaterThan(900);
  });

  it('wounds the players whose chests are within its reach, whoever they are, and no others', () => {
    const f = field();
    const core = f.flat.core;
    // It is a short walk to the Core; the blast will be at the wall of the Core, about half a block in.
    f.sim.spawnAt(core.cellX - 2.5, core.z, 1, BREACHING);
    const west = core.cellX - 1;
    f.targets.push(
      { id: 1, x: west, y: GROUND, z: core.z },
      { id: 2, x: west - 1.5, y: GROUND, z: core.z + 1 },
      { id: 3, x: west - 4.5, y: GROUND, z: core.z },
      // Right over it, but on a tower four blocks up: out of reach of a blast at the ground.
      { id: 4, x: west, y: GROUND + 4, z: core.z },
    );
    f.until(() => f.blasts.length > 0);
    const hurt = new Map(f.players);
    expect([...hurt.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(f.players).toEqual([
      [1, BLAST.player],
      [2, BLAST.player],
    ]);
    // The Core took its share too: the blast was at its wall.
    expect(f.core).toEqual([BLAST.core]);
  });

  it('goes off more than once in a step when more than one is ready, and each is spent', () => {
    const f = field();
    const core = f.flat.core;
    f.sim.spawnAt(core.cellX - 3.5, core.z - 0.8, 1, BREACHING);
    f.sim.spawnAt(core.cellX - 3.5, core.z + 0.8, 1, BREACHING);
    f.until(() => f.sim.count === 0);
    expect(f.blasts).toHaveLength(2);
    // They were ready in the same step: the list of the spent is one the step empties.
    expect((f.blasts[0] as Blast).tick).toBe((f.blasts[1] as Blast).tick);
    expect(f.core).toEqual([BLAST.core, BLAST.core]);
    // Nothing goes off twice.
    f.run(3);
    expect(f.blasts).toHaveLength(2);
  });

  it('spares the Core’s own cells and breaks the ring of the crew’s that stands round them', () => {
    const f = field();
    const core = f.flat.core;
    const ring: NavCell[] = [];
    for (let x = core.cellX - 1; x <= core.cellX + CORE_FOOTPRINT; x++) {
      for (let z = core.cellZ - 1; z <= core.cellZ + CORE_FOOTPRINT; z++) {
        const inside =
          x >= core.cellX &&
          x < core.cellX + CORE_FOOTPRINT &&
          z >= core.cellZ &&
          z < core.cellZ + CORE_FOOTPRINT;
        if (inside) continue;
        for (let y = GROUND; y < GROUND + 3; y++) ring.push({ x, y, z });
      }
    }
    for (const cell of ring) {
      f.flat.place(cell.x, cell.y, cell.z);
      f.sim.blockChanged(cell.x, cell.y, cell.z);
    }
    // A block of the crew's in a cell of the Core itself, as the host's block store may hold for its blocks.
    const own = { x: core.cellX, y: GROUND, z: core.cellZ + 1 };
    f.flat.place(own.x, own.y, own.z);
    f.sim.spawnAt(core.cellX - 9.5, core.z, 1, BREACHING);
    f.until(() => f.blasts.length > 0);
    const at = f.blasts[0] as Blast;
    const broken = f.drain();
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.map(key)).not.toContain(key(own));
    const crews = new Set(ring.map(key));
    for (const cell of broken) {
      expect(reaches(at, cell)).toBe(true);
      expect(crews.has(key(cell))).toBe(true);
    }
    // Every block of the ring within its reach went, and the cell of the Core's within its reach stayed.
    expect(reaches(at, own)).toBe(true);
    expect(broken.map(key).sort()).toEqual(
      ring
        .filter((cell) => reaches(at, cell))
        .map(key)
        .sort(),
    );
    // The wall was in the way, so it stood at the ring on the west side, and the Core felt the blast.
    expect(f.core).toEqual([BLAST.core]);
  });
});

describe('felling a breacher', () => {
  it('during its charge stops the blast: no blocks break, nobody is wounded, and the kind is told', () => {
    const f = field();
    const core = f.flat.core;
    const { x: wx } = longWall(f);
    const id = f.sim.spawnAt(wx - 8.5, core.z, 1, BREACHING) as number;
    f.targets.push({ id: 5, x: wx - 1, y: GROUND, z: core.z });
    f.until(() => ((f.where()[0] as EnemyState).flags & ENEMY_FLAG.attack) !== 0);
    f.run(0.5);
    expect(f.sim.has(id)).toBe(true);
    expect(f.sim.hurt(id, BREACHER.health * 10)).toBe(true);
    expect(f.felled).toEqual([BREACHING]);
    f.run(4);
    expect(f.blasts).toEqual([]);
    expect(f.drain()).toEqual([]);
    expect(f.players).toEqual([]);
    expect(f.core).toEqual([]);
    expect(f.sim.count).toBe(0);
  });

  it('takes its ninety points of blows to fell on the first night, and not a point less', () => {
    const f = field();
    const core = f.flat.core;
    const id = f.sim.spawnAt(core.cellX - 20.5, core.z, 1, BREACHING) as number;
    expect(f.sim.hurt(id, BREACHER.health - 0.1)).toBe(false);
    expect(f.felled).toEqual([]);
    expect(f.sim.hurt(id, 0.2)).toBe(true);
    expect(f.felled).toEqual([BREACHING]);
  });

  it('is no help to a breacher that has begun to charge: the blast goes off over a wall that is gone', () => {
    const f = field();
    const core = f.flat.core;
    const { x: wx } = longWall(f);
    f.sim.spawnAt(wx - 8.5, core.z, 1, BREACHING);
    f.until(() => ((f.where()[0] as EnemyState).flags & ENEMY_FLAG.attack) !== 0);
    // The crew takes the wall down in front of it while it charges.
    for (let z = core.cellZ - 30; z <= core.cellZ + 24; z++) {
      for (let y = GROUND; y < GROUND + 4; y++) {
        f.flat.remove(wx, y, z);
        f.sim.blockChanged(wx, y, z);
      }
    }
    f.until(() => f.sim.count === 0);
    expect(f.blasts).toHaveLength(1);
    expect(f.drain()).toEqual([]);
    expect(f.core).toEqual([]);
  });
});

describe('the breacher in a run', () => {
  const PLAYER = 2;

  function run() {
    const flat = flatWorld({ height: () => GROUND });
    const sim = new SurvivalSim({
      core: flat.core,
      nav: flat.world,
      seed: 9,
      startAt: nightStart(1),
      waves: false,
      ray: {
        blocks: { getBlock: (x, y, z) => flat.cells.get(x, y, z) },
        ground: { distance: (_x, y) => y - GROUND },
      },
    });
    sim.addPlayer(PLAYER);
    const machines = sim.enemies!;
    const events = (): SurvivalEvent[] => {
      const out: SurvivalEvent[] = [];
      sim.drainEvents(out);
      return out;
    };
    return { flat, sim, machines, economy: sim.economy!, events };
  }

  it('tells the screens where it went off, to a tenth of a block, and wounds the Core by the blast', () => {
    const { flat, sim, machines, economy, events } = run();
    machines.spawnAt(flat.core.cellX - 3.5, flat.core.z, 1, BREACHING);
    expect(sim.coreHealth).toBe(SURVIVAL.core.maxHealth);
    sim.warp(6);
    expect(machines.count).toBe(0);
    expect(sim.coreHealth).toBe(SURVIVAL.core.maxHealth - BLAST.core);
    const told = events();
    expect(told).toHaveLength(1);
    const [blast] = told as [Extract<SurvivalEvent, { k: 'blast' }>];
    expect(blast).toEqual({
      k: 'blast',
      n: 1,
      x: Math.round(blast.x * 10) / 10,
      y: GROUND + BREACHER.height / 2,
      z: Math.round(blast.z * 10) / 10,
    });
    expect(Math.abs(blast.x - (flat.core.cellX - 0.5))).toBeLessThan(1.5);
    // It was not felled, so it leaves nothing in the pool and is not counted among the felled.
    expect(economy.pool.amount(MATERIAL.energy)).toBe(0);
    expect(sim.felled).toBe(0);
    expect(sim.read(createReading()).felled).toBe(0);
  });

  it('wounds the players beside it and gives the blocks to the host to break', () => {
    const { flat, sim, machines } = run();
    const core = flat.core;
    // A wall of the crew’s blocks across the way, and a player standing at the foot of it.
    for (let z = Math.floor(core.z) - 20; z <= Math.floor(core.z) + 20; z++) {
      for (let y = GROUND; y < GROUND + 3; y++) flat.place(core.cellX - 6, y, z);
    }
    for (let z = Math.floor(core.z) - 20; z <= Math.floor(core.z) + 20; z++) {
      for (let y = GROUND; y < GROUND + 3; y++) sim.blockChanged(core.cellX - 6, y, z);
    }
    machines.spawnAt(core.cellX - 12.5, core.z, 1, BREACHING);
    sim.observe(PLAYER, core.cellX - 4.5, GROUND, core.z, 0, true);
    const health = sim.playerVitals(PLAYER)!.health;
    const broken: NavCell[] = [];
    for (let i = 0; i < 400 && broken.length === 0; i++) {
      sim.warp(0.05);
      sim.drainBreaks(broken);
    }
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((cell) => cell.x >= core.cellX - 7 && cell.x <= core.cellX - 5)).toBe(true);
    // The player stood within a few blocks of the blast: 35 points gone, give or take what mended.
    expect(sim.playerVitals(PLAYER)!.health).toBeLessThanOrEqual(health - BLAST.player + 3);
    expect(sim.playerVitals(PLAYER)!.health).toBeGreaterThan(health - BLAST.player - 1);
    expect(VITALS.maxHealth).toBeGreaterThan(BLAST.player);
  });
});
