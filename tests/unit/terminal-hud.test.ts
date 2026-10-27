import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../../src/shared/blocks';
import { createEconomyReading, type EconomyReading } from '../../src/shared/economy';
import { RESEARCH } from '../../src/systems/economy/balance';
import { ICON_IDS } from '../../src/ui/player-hud/icons';
import { INTERACT_KEY } from '../../src/ui/build-hud';
import { ladderForHud, pointsText, terminalPrompt } from '../../src/ui/terminal-hud';

function reading(points: number, claimed = points): EconomyReading {
  return { ...createEconomyReading(), cap: 400, research: points, claimed };
}

describe('the words under the crosshair for a Terminal', () => {
  it('name the key, what it opens and how many points the crew has', () => {
    expect(terminalPrompt(reading(35))).toEqual({
      key: INTERACT_KEY,
      label: 'Research ladder',
      detail: '35 points',
    });
    expect(terminalPrompt(reading(1)).detail).toBe('1 point');
    expect(terminalPrompt(reading(0)).detail).toBe('0 points');
  });

  it('say nothing about points on a screen with no economy to read', () => {
    expect(terminalPrompt(createEconomyReading()).detail).toBe('');
  });

  it('count points the plain way', () => {
    expect(pointsText(1)).toBe('1 point');
    expect(pointsText(20)).toBe('20 points');
  });
});

describe('the research ladder', () => {
  const names = MATERIALS.map((material) => material.name);
  const [power, camp] = RESEARCH.groups;
  const powerAt = power?.points ?? 0;
  const campAt = camp?.points ?? 0;
  const [compositeAt = 0, alloyAt = 0, energyAt = 0] = RESEARCH.steps.map((step) => step.points);
  const noStates = (...states: string[]) => states;

  it('has a row for each material and each group of modules, in the order the points reach them, with an icon each', () => {
    const ladder = ladderForHud(reading(0));
    expect(ladder.rows.map((row) => row.name)).toEqual([
      names[0],
      power?.name,
      names[1],
      camp?.name,
      names[2],
      names[3],
    ]);
    expect(ladder.rows.every((row) => row.icon !== null && ICON_IDS.includes(row.icon))).toBe(true);
    expect(new Set(ladder.rows.map((row) => row.icon)).size).toBe(names.length + 2);
    // A group's icon is the picture of its first module.
    expect(ladder.rows[1]?.icon).toBe('generator');
    expect(ladder.rows[3]?.icon).toBe('storage');
  });

  it('says what opens each row from the ladder tables, and what a group holds', () => {
    const ladder = ladderForHud(reading(0));
    expect(ladder.rows[0]?.need).toBe('From the start');
    // The Node's name holds a no-break space, so a narrow row wraps after the comma and not inside it.
    expect(ladder.rows[1]?.need).toBe(`${pointsText(powerAt)} · Generator, Power\u00a0Node`);
    expect(ladder.rows[2]?.need).toBe(pointsText(compositeAt));
    expect(ladder.rows[3]?.need).toBe(`${pointsText(campAt)} · Storage`);
    expect(ladder.rows.slice(4).map((row) => row.need)).toEqual([
      pointsText(alloyAt),
      pointsText(energyAt),
    ]);
  });

  it('opens the starting material for a crew with no points and shuts the rest, with how far each is', () => {
    const ladder = ladderForHud(reading(0));
    expect(ladder.rows.map((row) => row.state)).toEqual(
      noStates('open', 'shut', 'shut', 'shut', 'shut', 'shut'),
    );
    expect(ladder.rows.map((row) => row.note)).toEqual([
      'Open',
      `${powerAt} to go`,
      `${compositeAt} to go`,
      `${campAt} to go`,
      `${alloyAt} to go`,
      `${energyAt} to go`,
    ]);
    expect(ladder.points).toBe('0');
    expect(ladder.caption).toBe('points earned');
    expect(ladder.fraction).toBe(0);
    expect(ladder.next).toBe(`${powerAt} to Power`);
  });

  it('opens the rows the points a Terminal has read reach, and counts the way to the next from the points earned', () => {
    const points = compositeAt + 5;
    const ladder = ladderForHud(reading(points));
    expect(ladder.rows.map((row) => row.state)).toEqual(
      noStates('open', 'open', 'open', 'shut', 'shut', 'shut'),
    );
    expect(ladder.rows[3]?.note).toBe(`${campAt - points} to go`);
    expect(ladder.next).toBe(`${campAt - points} to ${camp?.name}`);
    expect(ladder.fraction).toBeCloseTo(points / campAt, 6);
  });

  it('opens Power on its own, ahead of the first material beyond Scrap', () => {
    const ladder = ladderForHud(reading(powerAt));
    expect(ladder.rows.map((row) => row.state)).toEqual(
      noStates('open', 'open', 'shut', 'shut', 'shut', 'shut'),
    );
    expect(ladder.next).toBe(`${compositeAt - powerAt} to ${names[1]}`);
    expect(ladder.fraction).toBeCloseTo(powerAt / compositeAt, 6);
  });

  it('opens Camp between Composite and Alloy, with the next row Alloy', () => {
    const ladder = ladderForHud(reading(campAt));
    expect(ladder.rows.map((row) => row.state)).toEqual(
      noStates('open', 'open', 'open', 'open', 'shut', 'shut'),
    );
    expect(ladder.rows[3]?.note).toBe('Open');
    expect(ladder.next).toBe(`${alloyAt - campAt} to ${names[2]}`);
    expect(ladder.fraction).toBeCloseTo(campAt / alloyAt, 6);
  });

  it('marks a row the crew has earned and no Terminal has read as waiting, not open', () => {
    const ladder = ladderForHud(reading(powerAt, 0));
    expect(ladder.rows.map((row) => row.state)).toEqual(
      noStates('open', 'waiting', 'shut', 'shut', 'shut', 'shut'),
    );
    expect(ladder.rows[1]?.note).toBe('Not read yet');
    const more = ladderForHud(reading(compositeAt, powerAt));
    expect(more.rows.map((row) => row.state)).toEqual(
      noStates('open', 'open', 'waiting', 'shut', 'shut', 'shut'),
    );
    const camps = ladderForHud(reading(campAt, compositeAt));
    expect(camps.rows.map((row) => row.state)).toEqual(
      noStates('open', 'open', 'open', 'waiting', 'shut', 'shut'),
    );
  });

  it('shows the whole ladder climbed once the points pass the last row', () => {
    const last = RESEARCH.steps[RESEARCH.steps.length - 1]?.points ?? 0;
    const ladder = ladderForHud(reading(last + 7));
    expect(ladder.rows.every((row) => row.state === 'open')).toBe(true);
    expect(ladder.rows.every((row) => row.note === 'Open')).toBe(true);
    expect(ladder.fraction).toBe(1);
    expect(ladder.next).toBe('Ladder climbed');
  });

  it('tells how a night earns points from the table, and is the same for every reading', () => {
    const ladder = ladderForHud(reading(0));
    expect(ladder.title).toBe('Research Terminal');
    expect(ladder.footer).toContain(String(RESEARCH.perNight));
    expect(ladder.footer).toContain(String(RESEARCH.cleanNight));
    expect(ladderForHud(reading(40)).footer).toBe(ladder.footer);
  });

  it('says a single point in the singular', () => {
    expect(ladderForHud(reading(1)).caption).toBe('point earned');
  });
});
