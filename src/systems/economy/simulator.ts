import type { CellState } from '../../shared/block-world';
import {
  MATERIAL,
  MATERIALS,
  MODULE,
  SHAPE,
  materialTier,
  moduleDef,
  moduleShape,
  packState,
} from '../../shared/blocks';
import type { DebrisNode } from '../../shared/economy';
import { WAVES, bodyOf } from '../survival/balance';
import { kindsOnNight } from '../survival/waves';
import { CREWS, SIMULATION, TARGETS, type CrewProfile } from './balance';
import { pieceCost } from './build-rules';
import { Economy } from './economy';
import type { FieldCenter } from './field';
import { rowsReached } from './research';

/**
 * The balance simulator (Phase 5j): it plays the economy of a whole run with no screen and no
 * players, the real `Economy` (the heaps, the pool, the research) driven by a crew that is only a
 * few numbers, and says what came in against what it cost, a day at a time. The spec asks for
 * enough materials in a day for one or two meaningful upgrades, and for progress every two or
 * three nights (SPEC section 9); this is the way to check that against the tables instead of
 * guessing, and to see what a change to a price or a threshold does before anyone plays it.
 *
 * It is pure and without a clock, so a test can run it and a report can print it. Day 0 is the day
 * before the first night; day `n` is the day after night `n`, the one that begins with the dawn the
 * research is credited at and the next heaps are uncovered at.
 *
 * What the crew does, in short: it strips the heaps (the better materials first, the nearest first,
 * a share of what is there each day), puts up the Research Terminal as soon as it can pay, builds a
 * turret and a section of wall in Scrap each day, and spends what the pool holds on the next step of
 * anything it has built: a turret up its levels, a wall up the materials. A step is an upgrade.
 * It is a model, and it is kept plain on purpose: it shows what the tables allow, not what a player
 * would do, so the numbers it reports are for comparing one table with another and with the spec.
 */

/** The Basic Turret at `level`, and a block of `material`: the pieces the crew builds and raises. */
const turretAt = (level: number): CellState => packState(moduleShape(MODULE.turret, 0), level);
const blockOf = (material: number): CellState => packState(SHAPE.cube, material);

/** One step up a ladder: the piece before and after, how many of them a step raises, and what the whole step takes from the pool. */
export interface Step {
  readonly name: string;
  readonly from: CellState;
  readonly to: CellState;
  /** A turret is one piece; a section of wall is several blocks raised together. */
  readonly pieces: number;
  /** The material the step is paid in: its tier has to be researched. */
  readonly material: number;
  readonly amount: number;
}

function stepUp(name: string, from: CellState, to: CellState, pieces: number): Step {
  const price = pieceCost(to);
  if (!price) throw new Error(`the tables have no price for ${name}`);
  return { name, from, to, pieces, material: price.material, amount: price.amount * pieces };
}

/** Something the crew builds in Scrap and then raises a step at a time. */
export interface Ladder {
  readonly name: string;
  readonly steps: readonly Step[];
}

/**
 * The two ladders the crew climbs, read from the tables: a turret up its module's levels, and a
 * section of wall (`SIMULATION.sectionBlocks` blocks) up the materials that are better than Scrap.
 * Each step is priced by the economy's own `pieceCost` of the piece it makes, and the economy's own
 * rule (`upgradeRefusal`) decides when the crew may take it: the material's tier has to be researched.
 */
export function ladders(): readonly Ladder[] {
  const levels = moduleDef(MODULE.turret)?.raises ?? [];
  const byTier = [...MATERIALS].sort((a, b) => a.tier - b.tier);
  return [
    {
      name: 'turret',
      steps: levels.map((raise, i) => stepUp(raise.name, turretAt(i + 1), turretAt(i + 2), 1)),
    },
    {
      name: 'wall',
      steps: byTier
        .slice(1)
        .map((material, i) =>
          stepUp(
            `${material.name} wall`,
            blockOf(byTier[i]?.id ?? MATERIAL.scrap),
            blockOf(material.id),
            SIMULATION.sectionBlocks,
          ),
        ),
    },
  ];
}

/** What one day of a run came to. */
export interface DayRow {
  /** 0 is the day before the first night. */
  readonly day: number;
  /** The research the crew has earned by the end of the day, and the material tier the Terminal has read. */
  readonly points: number;
  readonly tier: number;
  /** The rows of the research ladder this day's dawn opened, by name. */
  readonly opened: readonly string[];
  /** What the crew stripped from the heaps, and the cells the dead specials left, by material id. */
  readonly gathered: Readonly<Record<number, number>>;
  /** Heaps the crew passed by because the pool was full of what they give. */
  readonly leftAtCap: number;
  /** The upgrades bought, by name, and the Scrap the new Terminal, turrets and walls cost. */
  readonly bought: readonly string[];
  readonly built: number;
  /** How many turrets and wall sections stand on each rung of their ladder (`ladders()` order). */
  readonly standing: readonly (readonly number[])[];
  /** The pool at the end of the day, by material id. */
  readonly stock: Readonly<Record<number, number>>;
}

/** What a whole run says about the pacing. */
export interface Summary {
  /** The nights whose dawn opened a row of the ladder, in order. */
  readonly unlockNights: readonly number[];
  /** The nights from one unlock to the next, and their mean and longest. */
  readonly gaps: readonly number[];
  readonly meanGap: number;
  readonly longestGap: number;
  /**
   * Upgrades bought a day over the days from the first on which a better material came in to the
   * last, in order; their mean, fewest and most; and the mean of the first, middle and last third.
   */
  readonly upgrades: readonly number[];
  readonly meanUpgrades: number;
  readonly fewestUpgrades: number;
  readonly mostUpgrades: number;
  readonly thirds: readonly [number, number, number];
}

export interface BalanceReport {
  readonly crew: string;
  readonly seed: number;
  readonly rows: readonly DayRow[];
  readonly summary: Summary;
}

export interface SimulationOptions {
  readonly seed: number;
  /** The run's field of heaps (`debrisField`), and the middle of the Core the crew works round. */
  readonly nodes: readonly DebrisNode[];
  readonly core: FieldCenter;
  readonly crew: CrewProfile;
  /** Days to play; the table's by default. */
  readonly days?: number;
  /** The name the report gives the crew. */
  readonly name?: string;
  /** False for a crew that never builds the Research Terminal, so that nothing is ever researched. */
  readonly terminal?: boolean;
  /** What the pool opens with, by material id: the table's start by default. */
  readonly stock?: Readonly<Record<number, number>>;
}

const TERMINAL = packState(moduleShape(MODULE.terminal, 0), 1);

/** The Energy-Infused cells a night's special machines leave when the crew fells the share `felled` of them. */
export function cellsOnNight(night: number, felled: number): number {
  let cells = 0;
  for (const kind of kindsOnNight(night)) {
    const drop = bodyOf(WAVES.kinds[kind].body)?.drop;
    if (drop && drop.material === MATERIAL.energy) cells += drop.amount;
  }
  return Math.round(cells * felled);
}

/** Plays a run's economy and returns what came in against what it cost, a day at a time. */
export function simulate(options: SimulationOptions): BalanceReport {
  const { seed, nodes, core, crew } = options;
  const days = options.days ?? SIMULATION.days;
  const economy = new Economy(seed, nodes, options.stock);
  const climbs = ladders();
  // What the crew puts up in Scrap each day, and the ladder each piece starts on.
  const pieces = [
    { want: 'turrets', state: turretAt(1), count: 1, ladder: 0 },
    {
      want: 'sections',
      state: blockOf(MATERIAL.scrap),
      count: SIMULATION.sectionBlocks,
      ladder: 1,
    },
  ] as const;
  // Pieces standing on each rung of each ladder; the first rung is a piece just built in Scrap.
  const standing = climbs.map((ladder) => new Array<number>(ladder.steps.length + 1).fill(0));
  // The better materials first, since Scrap is plentiful, and the nearest heaps first within a material.
  const order = [...nodes]
    .sort(
      (a, b) =>
        materialTier(b.grade) - materialTier(a.grade) ||
        Math.hypot(a.x - core.x, a.z - core.z) - Math.hypot(b.x - core.x, b.z - core.z) ||
        a.index - b.index,
    )
    .map((node) => node.index);

  let terminal = false;
  let bought: string[] = [];
  let built = 0;
  const toBuild = { turrets: 0, sections: 0 };

  /** The crew pays for `count` of a piece, all or none, at the economy's own price. */
  const buy = (state: CellState, count: number): boolean => {
    const price = pieceCost(state);
    if (!price || economy.pool.amount(price.material) < price.amount * count) return false;
    for (let piece = 0; piece < count; piece++) economy.pay(state);
    return true;
  };

  /** The Terminal goes up as soon as the pool can pay for it: nothing opens without one. */
  const buildTerminal = (): void => {
    if (terminal || options.terminal === false || !buy(TERMINAL, 1)) return;
    economy.placed(TERMINAL);
    terminal = true;
    built += pieceCost(TERMINAL)?.amount ?? 0;
  };

  /** The day's new turrets and sections of wall, in Scrap, as far as the pool pays for them. */
  const build = (): void => {
    for (const piece of pieces) {
      const rungs = standing[piece.ladder] as number[];
      while (toBuild[piece.want] > 0 && buy(piece.state, piece.count)) {
        rungs[0] = (rungs[0] ?? 0) + 1;
        toBuild[piece.want]--;
        built += (pieceCost(piece.state)?.amount ?? 0) * piece.count;
      }
    }
  };

  /**
   * The upgrades: while the pool can pay for one, the crew takes the next step of anything it has
   * built, a turret first and then a wall, the steps of a ladder low to high, and goes round again.
   */
  const upgrade = (): void => {
    for (let again = true; again;) {
      again = false;
      for (const [l, ladder] of climbs.entries()) {
        const rungs = standing[l] as number[];
        for (const [i, step] of ladder.steps.entries()) {
          if ((rungs[i] ?? 0) === 0) continue;
          if (economy.upgradeRefusal(step.from) !== null || !buy(step.to, step.pieces)) continue;
          rungs[i] = (rungs[i] ?? 0) - 1;
          rungs[i + 1] = (rungs[i + 1] ?? 0) + 1;
          bought.push(step.name);
          again = true;
        }
      }
    }
  };

  const spend = (): void => {
    buildTerminal();
    if (terminal) build();
    upgrade();
  };

  const rows: DayRow[] = [];
  for (let day = 0; day <= days; day++) {
    const gathered: Record<number, number> = {};
    const opened: string[] = [];
    if (day > 0) {
      // The dawn after night `day`, in the host's order: the points, what a Terminal reads, the heaps.
      const before = economy.research.claimed;
      economy.research.credit(day, crew.clean);
      if (terminal) economy.research.claim();
      for (const row of rowsReached(before, economy.research.claimed)) opened.push(row.name);
      economy.dawn(day);
      const cells = cellsOnNight(day, crew.specialsFelled);
      if (cells > 0) gathered[MATERIAL.energy] = economy.pool.add(MATERIAL.energy, cells);
    }

    bought = [];
    built = 0;
    Object.assign(toBuild, day === 0 ? SIMULATION.firstDay : SIMULATION.perDay);
    // The strips the crew means to take: a share of what the heaps that give something the pool has room for hold.
    let strips = 0;
    for (const index of order) {
      const grade = nodes[index]?.grade ?? MATERIAL.scrap;
      if (economy.pool.room(grade) > 0) strips += economy.leftOf(index);
    }
    const quota = Math.ceil(crew.efficiency * strips);
    let taken = 0;
    let leftAtCap = 0;
    for (const index of order) {
      while (taken < quota && economy.leftOf(index) > 0) {
        let result = economy.harvest(index, 0);
        if (!result.ok && result.reason === 'full') {
          spend();
          result = economy.harvest(index, 0);
        }
        if (!result.ok) {
          leftAtCap++;
          break;
        }
        const { material, gained } = result.event;
        gathered[material] = (gathered[material] ?? 0) + gained;
        taken++;
        buildTerminal();
      }
    }
    spend();

    const stock: Record<number, number> = {};
    for (const material of MATERIALS) stock[material.id] = economy.pool.amount(material.id);
    rows.push({
      day,
      points: economy.research.points,
      tier: economy.research.tier,
      opened,
      gathered,
      leftAtCap,
      bought: [...bought],
      built,
      standing: standing.map((rungs) => [...rungs]),
      stock,
    });
  }
  return { crew: options.name ?? 'crew', seed, rows, summary: summarise(rows) };
}

const mean = (values: readonly number[]): number =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

/** Reads the pacing off a run's days. */
export function summarise(rows: readonly DayRow[]): Summary {
  const unlockNights = rows.filter((row) => row.opened.length > 0).map((row) => row.day);
  const gaps = unlockNights.slice(1).map((night, i) => night - (unlockNights[i] as number));
  const better = (row: DayRow): boolean =>
    MATERIALS.some((material) => material.tier >= 2 && (row.gathered[material.id] ?? 0) > 0);
  const first = rows.find(better)?.day ?? rows.length;
  const upgrades = rows.filter((row) => row.day >= first).map((row) => row.bought.length);
  const third = Math.max(1, Math.floor(upgrades.length / 3));
  return {
    unlockNights,
    gaps,
    meanGap: mean(gaps),
    longestGap: Math.max(0, ...gaps),
    upgrades,
    meanUpgrades: mean(upgrades),
    fewestUpgrades: upgrades.length > 0 ? Math.min(...upgrades) : 0,
    mostUpgrades: Math.max(0, ...upgrades),
    thirds: [
      mean(upgrades.slice(0, third)),
      mean(upgrades.slice(third, 2 * third)),
      mean(upgrades.slice(2 * third)),
    ],
  };
}

/** The crews the simulator plays, by name: the table's. */
export function crews(): readonly { readonly name: string; readonly crew: CrewProfile }[] {
  return Object.entries(CREWS).map(([name, crew]) => ({ name, crew }));
}

/** A report as plain text: one line a day, then what the run says about the pacing. */
export function formatReport(report: BalanceReport): string {
  const pad = (value: string | number, width: number): string => String(value).padStart(width);
  const lines = [`Balance report: ${report.crew}, seed ${report.seed}`];
  lines.push(
    'day  pts tier  gathered S C A E  cap  built  turrets  walls    pool S C A E   upgrades bought',
  );
  for (const row of report.rows) {
    const gathered = MATERIALS.map((m) => pad(row.gathered[m.id] ?? 0, 4)).join('');
    const stock = MATERIALS.map((m) => pad(row.stock[m.id] ?? 0, 4)).join('');
    const [turrets = [], walls = []] = row.standing;
    const bought = row.bought.length > 0 ? row.bought.join(', ') : '-';
    const opened = row.opened.length > 0 ? `  [opens ${row.opened.join(', ')}]` : '';
    lines.push(
      `${pad(row.day, 3)} ${pad(row.points, 4)} ${pad(row.tier, 4)}  ${gathered}  ${pad(row.leftAtCap, 3)} ${pad(row.built, 5)}  ${turrets.join('/').padEnd(7)}  ${walls.join('/').padEnd(8)} ${stock}   ${pad(row.bought.length, 2)}: ${bought}${opened}`,
    );
  }
  const { summary } = report;
  const gap = TARGETS.nightsPerUnlock;
  const perDay = TARGETS.upgradesPerDay;
  lines.push(
    `unlocks on nights ${summary.unlockNights.join(', ')}; nights between ${summary.gaps.join(', ')}, mean ${summary.meanGap.toFixed(2)}, longest ${summary.longestGap} (target ${gap.min} to ${gap.max})`,
    `upgrades a day over ${summary.upgrades.length} days: ${summary.upgrades.join(' ')}; mean ${summary.meanUpgrades.toFixed(2)} (target ${perDay.min} to ${perDay.max}), first, middle and last third ${summary.thirds.map((value) => value.toFixed(2)).join(' ')}`,
  );
  return lines.join('\n');
}

/**
 * The pacing of several runs side by side, a line for each run and a line for each crew over all of
 * its runs: the way to see whether a table suits every seed or only the one it was tuned on.
 */
export function formatSweep(reports: readonly BalanceReport[]): string {
  const gap = TARGETS.nightsPerUnlock;
  const perDay = TARGETS.upgradesPerDay;
  const line = (crew: string, seed: string, summary: Summary): string =>
    [
      crew.padEnd(12),
      seed.padStart(9),
      summary.meanUpgrades.toFixed(2).padStart(15),
      String(summary.fewestUpgrades).padStart(7),
      String(summary.mostUpgrades).padStart(5),
      summary.meanGap.toFixed(2).padStart(14),
      String(summary.longestGap).padStart(8),
    ].join(' ');
  const lines = [
    `Pacing over ${reports.length} runs (target ${perDay.min} to ${perDay.max} upgrades a day, an unlock every ${gap.min} to ${gap.max} nights)`,
    'crew              seed  upgrades/day mean  fewest  most  unlock gap mean  longest',
  ];
  for (const crew of new Set(reports.map((report) => report.crew))) {
    const runs = reports.filter((report) => report.crew === crew);
    for (const run of runs) lines.push(line(crew, String(run.seed), run.summary));
    const all = runs.map((run) => run.summary);
    lines.push(
      line(crew, 'all seeds', {
        ...(all[0] as Summary),
        meanUpgrades: mean(all.map((summary) => summary.meanUpgrades)),
        fewestUpgrades: Math.min(...all.map((summary) => summary.fewestUpgrades)),
        mostUpgrades: Math.max(...all.map((summary) => summary.mostUpgrades)),
        meanGap: mean(all.map((summary) => summary.meanGap)),
        longestGap: Math.max(...all.map((summary) => summary.longestGap)),
      }),
    );
  }
  return lines.join('\n');
}
