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

  it('has a row for each material, in tier order, with the icon of its block', () => {
    const ladder = ladderForHud(reading(0));
    expect(ladder.rows.map((row) => row.name)).toEqual(names);
    expect(ladder.rows.every((row) => row.icon !== null && ICON_IDS.includes(row.icon))).toBe(true);
    expect(new Set(ladder.rows.map((row) => row.icon)).size).toBe(names.length);
  });

  it('says what opens each row from the ladder table', () => {
    const ladder = ladderForHud(reading(0));
    expect(ladder.rows[0]?.need).toBe('From the start');
    expect(ladder.rows.slice(1).map((row) => row.need)).toEqual(
      RESEARCH.steps.map((step) => pointsText(step.points)),
    );
  });

  it('opens the starting material for a crew with no points and shuts the rest, with how far each is', () => {
    const ladder = ladderForHud(reading(0));
    expect(ladder.rows.map((row) => row.state)).toEqual(['open', 'shut', 'shut', 'shut']);
    expect(ladder.rows.map((row) => row.note)).toEqual([
      'Open',
      `${RESEARCH.steps[0]?.points} to go`,
      `${RESEARCH.steps[1]?.points} to go`,
      `${RESEARCH.steps[2]?.points} to go`,
    ]);
    expect(ladder.points).toBe('0');
    expect(ladder.caption).toBe('points earned');
    expect(ladder.fraction).toBe(0);
    expect(ladder.next).toBe(`${RESEARCH.steps[0]?.points} to ${names[1]}`);
  });

  it('opens the rows the points a Terminal has read reach, and counts the way to the next from the points earned', () => {
    const first = RESEARCH.steps[0]?.points ?? 0;
    const second = RESEARCH.steps[1]?.points ?? 0;
    const ladder = ladderForHud(reading(first + 5));
    expect(ladder.rows.map((row) => row.state)).toEqual(['open', 'open', 'shut', 'shut']);
    expect(ladder.rows[2]?.note).toBe(`${second - first - 5} to go`);
    expect(ladder.next).toBe(`${second - first - 5} to ${names[2]}`);
    expect(ladder.fraction).toBeCloseTo((first + 5) / second, 6);
  });

  it('marks a row the crew has earned and no Terminal has read as waiting, not open', () => {
    const first = RESEARCH.steps[0]?.points ?? 0;
    const ladder = ladderForHud(reading(first, 0));
    expect(ladder.rows.map((row) => row.state)).toEqual(['open', 'waiting', 'shut', 'shut']);
    expect(ladder.rows[1]?.note).toBe('Not read yet');
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
