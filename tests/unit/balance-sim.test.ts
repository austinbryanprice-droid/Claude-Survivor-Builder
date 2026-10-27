import { describe, expect, it } from 'vitest';
import { MATERIAL, MATERIALS, MODULE, MODULES, materialTier } from '../../src/shared/blocks';
import { CREWS, POOL, RESEARCH, SIMULATION, TARGETS } from '../../src/systems/economy/balance';
import { needsResearch } from '../../src/systems/economy/build-rules';
import { Economy, evenStock } from '../../src/systems/economy/economy';
import { debrisField } from '../../src/systems/economy/field';
import { RESEARCH_ROWS, pointsForTier } from '../../src/systems/economy/research';
import {
  cellsOnNight,
  crews,
  formatReport,
  formatSweep,
  ladders,
  simulate,
  summarise,
  type BalanceReport,
} from '../../src/systems/economy/simulator';
import { flatWorld } from './helpers/nav-world';

/** Seeds the prices were tuned on, and seeds they were not: a table that only suits its own seeds is not balanced. */
const TUNED = [7, 20261020, 12345, 99, 31337];
const FRESH = [1, 2, 3, 424242, 0xc0ffee];

const { world, core } = flatWorld();
const NAMES = Object.keys(CREWS) as (keyof typeof CREWS)[];

function run(
  seed: number,
  name: keyof typeof CREWS,
  options: { terminal?: boolean; days?: number; stock?: Record<number, number> } = {},
): BalanceReport {
  return simulate({
    seed,
    nodes: debrisField(seed, world, core),
    core,
    crew: CREWS[name],
    name,
    ...options,
  });
}

const stepNamed = (name: string) =>
  ladders()
    .flatMap((ladder) => ladder.steps)
    .find((step) => step.name === name);

describe('the ladders the crew climbs', () => {
  it('give the turret the levels the module table has, in the materials it names', () => {
    const turret = MODULES.find((def) => def.id === MODULE.turret)!;
    const [climb] = ladders();
    expect(climb?.steps.map((step) => [step.name, step.material, step.amount])).toEqual(
      turret.raises.map((raise) => [raise.name, raise.cost.material, raise.cost.amount]),
    );
  });

  it('raise a section of wall through every material better than Scrap, at that many blocks of it', () => {
    const wall = ladders()[1]!;
    const better = MATERIALS.filter((material) => material.tier >= 2);
    expect(wall.steps.map((step) => step.material)).toEqual(better.map((material) => material.id));
    for (const step of wall.steps) {
      const material = MATERIALS.find((m) => m.id === step.material)!;
      expect(step.amount).toBe(SIMULATION.sectionBlocks * material.cost);
    }
  });

  it('cost more the better the material (SPEC section 9: upgrade costs rise with tier)', () => {
    const byTier = [...MATERIALS].sort((a, b) => a.tier - b.tier);
    byTier.slice(1).forEach((material, i) => {
      expect(material.cost, material.name).toBeGreaterThan(byTier[i]!.cost);
    });
    for (const ladder of ladders()) {
      ladder.steps.slice(1).forEach((step, i) => {
        const before = ladder.steps[i]!;
        expect(materialTier(step.material), step.name).toBeGreaterThan(
          materialTier(before.material),
        );
        expect(step.amount, step.name).toBeGreaterThanOrEqual(before.amount);
      });
    }
  });

  it('are shut to the crew until the research reaches the tier of the material that pays for them', () => {
    for (const ladder of ladders()) {
      for (const step of ladder.steps) {
        const tier = materialTier(step.material);
        const name = MATERIALS.find((material) => material.id === step.material)!.name;
        // A pool with plenty of everything, so that the research is the only thing in the way.
        const economy = new Economy(1, [], evenStock(POOL.cap));
        economy.research.set(pointsForTier(tier - 1));
        expect(economy.upgradeRefusal(step.from), step.name).toBe(needsResearch(name));
        economy.research.set(pointsForTier(tier));
        expect(economy.upgradeRefusal(step.from), step.name).toBeNull();
      }
    }
  });
});

describe('a simulated run', () => {
  it('plays out the same every time for the same seed and crew, and differently for another seed', () => {
    const first = run(7, 'reasonable');
    expect(run(7, 'reasonable')).toEqual(first);
    expect(run(12345, 'reasonable').rows).not.toEqual(first.rows);
  });

  it('has a row for the day before the first night and one for each dawn after', () => {
    const report = run(7, 'reasonable');
    expect(report.rows.map((row) => row.day)).toEqual(
      Array.from({ length: SIMULATION.days + 1 }, (_, day) => day),
    );
    expect(run(7, 'reasonable', { days: 3 }).rows).toHaveLength(4);
  });

  it('opens nothing before the first night: no points, Scrap only, and the first upgrades wait', () => {
    for (const name of NAMES) {
      const [first] = run(7, name).rows;
      expect(first?.points).toBe(0);
      expect(first?.tier).toBe(1);
      expect(first?.opened).toEqual([]);
      expect(first?.bought).toEqual([]);
      expect(Object.keys(first?.gathered ?? {})).toEqual([String(MATERIAL.scrap)]);
    }
  });

  it('opens each row of the research ladder on the night the points reach it', () => {
    for (const name of NAMES) {
      const pace = RESEARCH.perNight + (CREWS[name].clean ? RESEARCH.cleanNight : 0);
      const { summary, rows } = run(7, name);
      expect(summary.unlockNights, name).toEqual(
        RESEARCH_ROWS.map((row) => Math.ceil(row.points / pace)),
      );
      for (const row of rows) expect(row.points, `${name} day ${row.day}`).toBe(row.day * pace);
    }
  });

  it('takes no heap of a material before the research opens it, and buys no step before its tier', () => {
    for (const seed of TUNED) {
      for (const name of NAMES) {
        for (const row of run(seed, name).rows) {
          for (const material of [MATERIAL.composite, MATERIAL.alloy]) {
            if ((row.gathered[material] ?? 0) > 0) {
              expect(row.tier, `${name} ${seed} day ${row.day}`).toBeGreaterThanOrEqual(
                materialTier(material),
              );
            }
          }
          for (const bought of row.bought) {
            const step = stepNamed(bought)!;
            expect(row.tier, `${name} ${seed} day ${row.day}: ${bought}`).toBeGreaterThanOrEqual(
              materialTier(step.material),
            );
          }
        }
      }
    }
  });

  it('buys each step on the day the research opens its tier, from a pool that is full, and not a day before', () => {
    const steps = ladders().flatMap((ladder) => ladder.steps);
    for (const name of NAMES) {
      const { rows } = run(7, name, { stock: evenStock(POOL.cap) });
      for (const step of steps) {
        const opens = rows.find((row) => row.tier >= materialTier(step.material))?.day;
        const bought = rows.find((row) => row.bought.includes(step.name))?.day;
        expect(bought, `${name}: ${step.name}`).toBe(opens);
      }
    }
  });

  it('opens nothing when no Research Terminal ever stands, however many points the crew earns', () => {
    const { rows } = run(7, 'coordinated', { terminal: false });
    expect(rows.at(-1)!.points).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tier).toBe(1);
      expect(row.opened).toEqual([]);
      expect(row.bought).toEqual([]);
      expect(row.gathered[MATERIAL.composite] ?? 0).toBe(0);
      expect(row.gathered[MATERIAL.alloy] ?? 0).toBe(0);
    }
  });

  it('keeps the pool between nothing and its ceiling, and counts every upgrade as a step of a ladder', () => {
    for (const name of NAMES) {
      const { rows } = run(20261020, name);
      for (const row of rows) {
        for (const material of MATERIALS) {
          expect(row.stock[material.id], `${name} day ${row.day}`).toBeGreaterThanOrEqual(0);
          expect(row.stock[material.id], `${name} day ${row.day}`).toBeLessThanOrEqual(POOL.cap);
        }
      }
      // A piece on rung i has been raised i times, so the rungs account for every upgrade bought.
      const last = rows.at(-1)!;
      const raised = last.standing.reduce(
        (sum, rungs) => sum + rungs.reduce((total, count, rung) => total + rung * count, 0),
        0,
      );
      expect(raised).toBe(rows.reduce((sum, row) => sum + row.bought.length, 0));
    }
  });

  it('sees the cells the night’s special machines leave, in proportion to the share the crew fells', () => {
    expect(cellsOnNight(1, 1)).toBe(0);
    expect(cellsOnNight(4, 1)).toBeGreaterThan(0);
    expect(cellsOnNight(10, 1)).toBeGreaterThan(cellsOnNight(4, 1));
    expect(cellsOnNight(10, 0)).toBe(0);
    expect(cellsOnNight(10, 0.5)).toBe(Math.round(cellsOnNight(10, 1) / 2));
  });
});

describe('the pacing the spec asks for (SPEC section 9)', () => {
  const seeds = [...TUNED, ...FRESH];

  it('gives a crew that is reasonably efficient one or two upgrades a day, on every seed', () => {
    for (const name of NAMES) {
      for (const seed of seeds) {
        const { summary } = run(seed, name);
        expect(summary.meanUpgrades, `${name} ${seed}`).toBeGreaterThanOrEqual(
          TARGETS.upgradesPerDay.min,
        );
        expect(summary.meanUpgrades, `${name} ${seed}`).toBeLessThanOrEqual(
          TARGETS.upgradesPerDay.max,
        );
      }
    }
  });

  it('opens something new every two or three nights on average, and never leaves a crew waiting longer than four', () => {
    for (const name of NAMES) {
      const { summary } = run(7, name);
      expect(summary.meanGap, name).toBeGreaterThanOrEqual(TARGETS.nightsPerUnlock.min);
      expect(summary.meanGap, name).toBeLessThanOrEqual(TARGETS.nightsPerUnlock.max);
      // The last row of the ladder is the long wait (docs/decisions.md, Phase 5j): it is held where the spec's ladder puts it.
      expect(summary.longestGap, name).toBeLessThanOrEqual(4);
    }
  });

  it('reads a run the same way from its rows as the run did', () => {
    const { rows, summary } = run(99, 'reasonable');
    expect(summarise(rows)).toEqual(summary);
  });
});

describe('the report', () => {
  it('plays the crews of the table, by name', () => {
    expect(crews().map((entry) => entry.name)).toEqual(NAMES);
    expect(crews().map((entry) => entry.crew)).toEqual(NAMES.map((name) => CREWS[name]));
  });

  it('names the crew and the seed, has a line for each day, and says what it is held to', () => {
    const report = run(7, 'coordinated');
    const lines = formatReport(report).split('\n');
    expect(lines[0]).toContain('coordinated');
    expect(lines[0]).toContain('seed 7');
    expect(lines).toHaveLength(2 + report.rows.length + 2);
    const text = lines.join('\n');
    expect(text).toContain(`target ${TARGETS.upgradesPerDay.min} to ${TARGETS.upgradesPerDay.max}`);
    expect(text).toContain(
      `target ${TARGETS.nightsPerUnlock.min} to ${TARGETS.nightsPerUnlock.max}`,
    );
  });

  it('sets runs side by side: a line for each run and one for each crew over all of its runs', () => {
    const reports = [7, 99].flatMap((seed) => NAMES.map((name) => run(seed, name)));
    const lines = formatSweep(reports).split('\n');
    expect(lines).toHaveLength(2 + reports.length + NAMES.length);
    for (const name of NAMES) {
      expect(lines.filter((line) => line.startsWith(name))).toHaveLength(3);
      expect(lines.filter((line) => line.startsWith(name)).at(-1)).toContain('all seeds');
    }
    expect(lines[0]).toContain(String(reports.length));
  });
});
