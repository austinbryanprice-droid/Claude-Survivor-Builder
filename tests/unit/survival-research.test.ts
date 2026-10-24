import { describe, expect, it } from 'vitest';
import { MATERIAL } from '../../src/shared/blocks';
import { CYCLE_SECONDS, DAY_SECONDS } from '../../src/shared/daycycle';
import { nightStart } from '../../src/shared/survival-state';
import { DEBRIS, RESEARCH } from '../../src/systems/economy/balance';
import { RESEARCH_STEPS } from '../../src/systems/economy/research';
import { SurvivalSim, type SurvivalOptions } from '../../src/systems/survival/sim';
import { flatWorld } from './helpers/nav-world';

const CLEAN = RESEARCH.perNight + RESEARCH.cleanNight;

function run(options: Partial<SurvivalOptions> = {}): SurvivalSim {
  const flat = flatWorld();
  return new SurvivalSim({ core: flat.core, nav: flat.world, seed: 3, waves: false, ...options });
}

const points = (sim: SurvivalSim) => sim.economy!.research.points;
const tier = (sim: SurvivalSim) => sim.economy!.research.tier;

/** Plays one whole day and night from its first moment, wounding the Core once in the night if `hurt` is true. */
function playCycle(sim: SurvivalSim, hurt: boolean): void {
  sim.warp(DAY_SECONDS + 0.1);
  if (hurt) sim.hurtCore(1);
  sim.warp(CYCLE_SECONDS - DAY_SECONDS - 0.1);
}

/** The first heap of a grade that a dawn uncovers, or undefined where the field has none. */
function firstOf(sim: SurvivalSim, grade: number) {
  return sim.economy!.nodes.find((node) => node.grade === grade);
}

describe('the research of a run', () => {
  it('earns nothing by day or by night, and pays at the dawn that ends the night', () => {
    const sim = run();
    sim.warp(DAY_SECONDS + 5);
    expect(points(sim)).toBe(0);
    sim.warp(CYCLE_SECONDS - DAY_SECONDS - 5.05);
    expect(points(sim)).toBe(0);
    sim.warp(0.05);
    expect(points(sim)).toBe(CLEAN);
  });

  it('pays the night’s points once, and the next night’s at the next dawn', () => {
    const sim = run();
    playCycle(sim, false);
    expect(points(sim)).toBe(CLEAN);
    // A whole day passes without paying anything; the night after it pays at its dawn.
    sim.warp(DAY_SECONDS);
    expect(points(sim)).toBe(CLEAN);
    sim.warp(CYCLE_SECONDS - DAY_SECONDS);
    expect(points(sim)).toBe(2 * CLEAN);
  });

  it('pays the clean-night bonus only for a night the Core took no damage in', () => {
    const wounded = run();
    playCycle(wounded, true);
    expect(points(wounded)).toBe(RESEARCH.perNight);
    const clean = run();
    playCycle(clean, false);
    expect(points(clean)).toBe(CLEAN);
  });

  it('does not hold a wound taken by day against the night that follows', () => {
    const sim = run();
    sim.warp(10);
    sim.hurtCore(20);
    sim.warp(CYCLE_SECONDS - 10);
    expect(points(sim)).toBe(CLEAN);
  });

  it('forgets a wound at the next nightfall, so a bad night costs only itself', () => {
    const sim = run();
    playCycle(sim, true);
    playCycle(sim, false);
    expect(points(sim)).toBe(RESEARCH.perNight + CLEAN);
  });

  it('opens the tiers of the ladder at the dawns the points reach their rows', () => {
    const sim = run();
    const seen: number[] = [];
    for (let night = 1; night <= 9; night++) {
      playCycle(sim, false);
      seen.push(tier(sim));
    }
    // 12 a night: 24 after two (Composite at 20), 60 after five (Alloy at 55), 108 after nine (at 100).
    expect(seen).toEqual([1, 2, 2, 2, 3, 3, 3, 3, 4]);
  });

  it('does without research where the world gave the run no ground', () => {
    const sim = new SurvivalSim();
    expect(sim.economy).toBeNull();
    expect(() => sim.warp(CYCLE_SECONDS * 2)).not.toThrow();
  });
});

describe('a run that opens with research', () => {
  it('has the nights before a later start behind it: ten points a night, none of the bonus', () => {
    const sim = run({ startAt: nightStart(3) });
    expect(points(sim)).toBe(2 * RESEARCH.perNight);
    expect(tier(sim)).toBe(2);
    expect(run({ startAt: nightStart(2) }).economy!.research.points).toBe(RESEARCH.perNight);
  });

  it('takes the points it is given in place of those, and in place of none at a first start', () => {
    expect(points(run({ research: 55 }))).toBe(55);
    expect(tier(run({ research: 55 }))).toBe(3);
    expect(points(run({ research: 0 }))).toBe(0);
    expect(points(run({ startAt: nightStart(5), research: 7 }))).toBe(7);
    expect(points(run({ research: null }))).toBe(0);
  });

  it('keeps earning from the points it opened with', () => {
    const sim = run({ research: 50 });
    playCycle(sim, false);
    expect(points(sim)).toBe(50 + CLEAN);
    expect(tier(sim)).toBe(3);
  });

  it('uncovers the better heaps of the nights it has had, once the research opens their tier', () => {
    const composite = firstOf(run(), MATERIAL.composite)!;
    expect(composite.from).toBe(DEBRIS.grades[0]!.from);
    const open = run({
      startAt: nightStart(composite.from + 1),
      research: RESEARCH_STEPS[0]!.points,
    });
    expect(open.economy!.leftOf(composite.index)).toBe(composite.harvests);
    const shut = run({ startAt: nightStart(composite.from + 1), research: 0 });
    expect(shut.economy!.leftOf(composite.index)).toBe(0);
    // A scrap heap of the same night is up either way.
    const scrap = shut.economy!.nodes.find(
      (node) => node.from === composite.from && node.grade === MATERIAL.scrap,
    )!;
    expect(shut.economy!.leftOf(scrap.index)).toBe(scrap.harvests);
  });
});

describe('the heaps research waits on', () => {
  it('keeps Alloy down at its dawn for a crew that has been hurt every night, and brings it up a night later', () => {
    const sim = run();
    const alloy = firstOf(sim, MATERIAL.alloy)!;
    expect(alloy.from).toBe(DEBRIS.grades[1]!.from);
    for (let night = 1; night < alloy.from; night++) playCycle(sim, true);
    // Four wounded nights: 40 points, Composite is open and Alloy is not.
    expect(tier(sim)).toBe(2);
    playCycle(sim, true);
    // The fifth wounded night makes 50 points: still short of 55, so the Alloy heap waits.
    expect(points(sim)).toBe(5 * RESEARCH.perNight);
    expect(tier(sim)).toBe(2);
    expect(sim.economy!.leftOf(alloy.index)).toBe(0);
    playCycle(sim, true);
    expect(tier(sim)).toBe(3);
    expect(sim.economy!.leftOf(alloy.index)).toBe(alloy.harvests);
  });

  it('brings Alloy up at its own dawn for a crew that kept the Core whole', () => {
    const sim = run();
    const alloy = firstOf(sim, MATERIAL.alloy)!;
    for (let night = 1; night <= alloy.from; night++) playCycle(sim, false);
    expect(tier(sim)).toBe(3);
    expect(sim.economy!.leftOf(alloy.index)).toBe(alloy.harvests);
  });
});
