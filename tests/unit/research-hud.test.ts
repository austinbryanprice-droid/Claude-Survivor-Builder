import { describe, expect, it } from 'vitest';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';
import { createEconomyReading, type EconomyReading } from '../../src/shared/economy';
import { RESEARCH_STEPS, tierAt } from '../../src/systems/economy/research';
import {
  RESEARCH_SECONDS,
  ResearchPill,
  ResearchWatcher,
  lockForPiece,
  lockText,
  researchForHud,
  slotLocked,
} from '../../src/ui/research-hud';

/** A reading of a run with a pool (a ceiling above 0) and this many research points. */
function reading(research: number, cap = 400): EconomyReading {
  const out = createEconomyReading();
  out.cap = cap;
  out.research = research;
  out.tier = tierAt(research);
  return out;
}

const COMPOSITE = packState(SHAPE.cube, MATERIAL.composite);
const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);

describe('the research pill', () => {
  it('shows the points and the next row of the ladder, with the points as a share of it', () => {
    expect(researchForHud(0)).toEqual({
      points: 0,
      fraction: 0,
      value: '0/20',
      tone: 'rising',
      gains: 0,
    });
    expect(researchForHud(12)).toMatchObject({ value: '12/20', fraction: 0.6 });
    expect(researchForHud(20)).toMatchObject({ value: '20/55', tone: 'rising' });
    expect(researchForHud(54).fraction).toBeCloseTo(54 / 55);
  });

  it('shows the points alone, full, once the whole ladder is climbed', () => {
    const top = RESEARCH_STEPS[RESEARCH_STEPS.length - 1]!.points;
    expect(researchForHud(top)).toEqual({
      points: top,
      fraction: 1,
      value: String(top),
      tone: 'full',
      gains: 0,
    });
    expect(researchForHud(top + 500).value).toBe(String(top + 500));
  });

  it('carries the count of rises it is given, so the pill can flash for each', () => {
    expect(researchForHud(12, 3).gains).toBe(3);
  });
});

describe('when the pill is on screen', () => {
  it('is there in Build Mode, and not otherwise', () => {
    const pill = new ResearchPill();
    expect(pill.update(0.016, reading(12), false)).toBeNull();
    expect(pill.update(0.016, reading(12), true)).toMatchObject({ points: 12, value: '12/20' });
    expect(pill.update(0.016, reading(12), false)).toBeNull();
  });

  it('comes up when the points change, and stays for a while', () => {
    const pill = new ResearchPill();
    pill.update(0.016, reading(0), false);
    expect(pill.update(0.016, reading(12), false)).toMatchObject({ points: 12 });
    expect(pill.update(RESEARCH_SECONDS - 1, reading(12), false)).not.toBeNull();
    expect(pill.update(2, reading(12), false)).toBeNull();
  });

  it('starts the time over for a change while it is up', () => {
    const pill = new ResearchPill();
    pill.update(0.016, reading(0), false);
    pill.update(0.016, reading(12), false);
    pill.update(RESEARCH_SECONDS - 1, reading(12), false);
    expect(pill.update(0.016, reading(24), false)).not.toBeNull();
    expect(pill.update(RESEARCH_SECONDS - 1, reading(24), false)).not.toBeNull();
  });

  it('does not count the first look, or a screen that has only just heard the host, as a change', () => {
    const pill = new ResearchPill();
    expect(pill.update(0.016, reading(30, 0), false)).toBeNull();
    expect(pill.update(0.016, reading(30), false)).toBeNull();
    const fresh = new ResearchPill();
    expect(fresh.update(0.016, reading(30), false)).toBeNull();
  });

  it('counts each rise, and not a fall, so the pill flashes for points earned', () => {
    const pill = new ResearchPill();
    pill.update(0.016, reading(0), true);
    expect(pill.update(0.016, reading(12), true)?.gains).toBe(1);
    expect(pill.update(0.016, reading(12), true)?.gains).toBe(1);
    expect(pill.update(0.016, reading(24), true)?.gains).toBe(2);
    // A new run: the points fall back, which is a change but not a gain.
    expect(pill.update(0.016, reading(0), true)?.gains).toBe(2);
  });

  it('is gone where there is no pool to be researching for', () => {
    const pill = new ResearchPill();
    expect(pill.update(0.016, reading(12, 0), true)).toBeNull();
  });
});

describe('the messages about research', () => {
  it('say nothing at the first look, whatever the points', () => {
    const watcher = new ResearchWatcher();
    expect(watcher.update(reading(55))).toEqual([]);
    expect(watcher.update(reading(55))).toEqual([]);
  });

  it('tell the points that arrived', () => {
    const watcher = new ResearchWatcher();
    watcher.update(reading(0));
    expect(watcher.update(reading(12))).toEqual(['Research +12']);
    expect(watcher.update(reading(12))).toEqual([]);
  });

  it('tell each material the points opened, after the points', () => {
    const watcher = new ResearchWatcher();
    watcher.update(reading(12));
    expect(watcher.update(reading(24))).toEqual(['Research +12', 'Reinforced Composite unlocked']);
    expect(watcher.update(reading(36))).toEqual(['Research +12']);
    expect(watcher.update(reading(60))).toEqual(['Research +24', 'Advanced Alloy unlocked']);
  });

  it('tell every tier a jump opened, in the order of the ladder', () => {
    const watcher = new ResearchWatcher();
    watcher.update(reading(0));
    expect(watcher.update(reading(120))).toEqual([
      'Research +120',
      'Reinforced Composite unlocked',
      'Advanced Alloy unlocked',
      'Energy-Infused unlocked',
    ]);
  });

  it('say nothing when a new run takes the points back, and start from the new run’s points', () => {
    const watcher = new ResearchWatcher();
    watcher.update(reading(60));
    expect(watcher.update(reading(0))).toEqual([]);
    expect(watcher.update(reading(12))).toEqual(['Research +12']);
    expect(watcher.update(reading(24))).toEqual(['Research +12', 'Reinforced Composite unlocked']);
  });

  it('say nothing while there is no pool, and treat the first word of the host as a first look', () => {
    const watcher = new ResearchWatcher();
    watcher.update(reading(0, 0));
    expect(watcher.update(reading(30))).toEqual([]);
    expect(watcher.update(reading(40))).toEqual(['Research +10']);
    watcher.update(reading(0, 0));
    expect(watcher.update(reading(5))).toEqual([]);
  });
});

describe('the lock on a piece', () => {
  it('names the material and says how far the crew is from opening it', () => {
    expect(lockForPiece(COMPOSITE, reading(12))).toEqual({
      name: 'Reinforced Composite',
      have: 12,
      need: 20,
    });
    expect(lockForPiece(packState(SHAPE.wedge, MATERIAL.alloy), reading(30))).toEqual({
      name: 'Advanced Alloy',
      have: 30,
      need: 55,
    });
  });

  it('is nothing for a material the crew has researched, Scrap, an empty slot or a run with no pool', () => {
    expect(lockForPiece(COMPOSITE, reading(20))).toBeNull();
    expect(lockForPiece(SCRAP, reading(0))).toBeNull();
    expect(lockForPiece(0, reading(0))).toBeNull();
    expect(lockForPiece(COMPOSITE, reading(0, 0))).toBeNull();
  });

  it('says the points the crew has and the points that open it', () => {
    expect(lockText({ name: 'Reinforced Composite', have: 12, need: 20 })).toBe(
      'Needs research · 12 of 20',
    );
  });

  it('closes a hotbar slot while its material is above the crew’s tier', () => {
    expect(slotLocked(MATERIAL.scrap, reading(0))).toBe(false);
    expect(slotLocked(MATERIAL.composite, reading(19))).toBe(true);
    expect(slotLocked(MATERIAL.composite, reading(20))).toBe(false);
    expect(slotLocked(MATERIAL.alloy, reading(54))).toBe(true);
    expect(slotLocked(MATERIAL.energy, reading(99))).toBe(true);
    expect(slotLocked(MATERIAL.energy, reading(100))).toBe(false);
    expect(slotLocked(MATERIAL.energy, reading(0, 0))).toBe(false);
  });
});
