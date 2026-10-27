/* eslint-disable no-console -- printing is what this file is for */
import { describe, it } from 'vitest';
import type { CrewProfile } from '../../src/systems/economy/balance';
import { debrisField } from '../../src/systems/economy/field';
import { crews, formatReport, formatSweep, simulate } from '../../src/systems/economy/simulator';
import { flatWorld } from '../unit/helpers/nav-world';

/** The seed whose days are printed in full, and the seeds the pacing is read across. */
const SHOWN = 7;
const SWEEP = [7, 20261020, 12345, 99, 31337, 1, 2, 3];

describe('the balance report', () => {
  it('prints what came in against what it cost, a day at a time, and the pacing across seeds', () => {
    const { world, core } = flatWorld();
    const play = (seed: number, name: string, crew: CrewProfile) =>
      simulate({ seed, nodes: debrisField(seed, world, core), core, crew, name });

    for (const { name, crew } of crews()) console.log(`${formatReport(play(SHOWN, name, crew))}\n`);
    console.log(
      formatSweep(SWEEP.flatMap((seed) => crews().map(({ name, crew }) => play(seed, name, crew)))),
    );
  });
});
