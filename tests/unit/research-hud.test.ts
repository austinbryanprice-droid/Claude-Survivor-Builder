import { describe, expect, it } from 'vitest';
import { MATERIAL, MODULE, SHAPE, moduleShape, packState } from '../../src/shared/blocks';
import { createEconomyReading, type EconomyReading } from '../../src/shared/economy';
import { RESEARCH_STEPS, tierAt } from '../../src/systems/economy/research';
import {
  RESEARCH_SECONDS,
  ResearchPill,
  ResearchWatcher,
  TERMINAL_NEEDED,
  lockForPiece,
  lockText,
  moduleSlotLocked,
  researchForHud,
  researchWaiting,
  slotLocked,
} from '../../src/ui/research-hud';

/**
 * A reading of a run with a pool (a ceiling above 0), this many research points earned and, unless
 * said otherwise, all of them read by a Terminal.
 */
function reading(research: number, cap = 400, claimed = research): EconomyReading {
  const out = createEconomyReading();
  out.cap = cap;
  out.research = research;
  out.claimed = claimed;
  out.tier = tierAt(claimed);
  return out;
}

const COMPOSITE = packState(SHAPE.cube, MATERIAL.composite);
const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);

describe('the research pill', () => {
  it('shows the points and the next row of the ladder, with the points as a share of it', () => {
    expect(researchForHud(0)).toEqual({
      points: 0,
      fraction: 0,
      value: '0/10',
      label: 'Research',
      tone: 'rising',
      gains: 0,
    });
    expect(researchForHud(12)).toMatchObject({ value: '12/20', fraction: 0.6 });
    expect(researchForHud(20)).toMatchObject({ value: '20/40', tone: 'rising' });
    expect(researchForHud(40)).toMatchObject({ value: '40/55', tone: 'rising' });
    expect(researchForHud(54).fraction).toBeCloseTo(54 / 55);
  });

  it('counts toward the Power group first, which opens before the first material does', () => {
    expect(researchForHud(0)).toMatchObject({ value: '0/10', fraction: 0 });
    expect(researchForHud(9)).toMatchObject({ value: '9/10', fraction: 0.9 });
    expect(researchForHud(10)).toMatchObject({ value: '10/20', fraction: 0.5 });
  });

  it('shows the points alone, full, once the whole ladder is climbed', () => {
    const top = RESEARCH_STEPS[RESEARCH_STEPS.length - 1]!.points;
    expect(researchForHud(top)).toEqual({
      points: top,
      fraction: 1,
      value: String(top),
      label: 'Research',
      tone: 'full',
      gains: 0,
    });
    expect(researchForHud(top + 500).value).toBe(String(top + 500));
  });

  it('carries the count of rises it is given, so the pill can flash for each', () => {
    expect(researchForHud(12, 3).gains).toBe(3);
  });

  it('says a Terminal is needed while the points reach a row that nothing has read', () => {
    expect(researchForHud(24, 0, 0)).toEqual({
      points: 24,
      fraction: 24 / 40,
      value: '24/40',
      label: 'Needs Terminal',
      tone: 'waiting',
      gains: 0,
    });
    // Points that reach no row yet are not waiting for anything, read or not.
    expect(researchForHud(9, 0, 0)).toMatchObject({ label: 'Research', tone: 'rising' });
    // The first row is a group of modules, and it waits for a Terminal as a material does.
    expect(researchForHud(12, 0, 0)).toMatchObject({ label: 'Needs Terminal', tone: 'waiting' });
    // Read points are not waiting, and neither are those that reach no row the read ones have not.
    expect(researchForHud(24, 0, 20)).toMatchObject({ label: 'Research', tone: 'rising' });
    expect(researchForHud(24, 0, 24)).toMatchObject({ label: 'Research', tone: 'rising' });
  });

  it('keeps saying it once the whole ladder is reached and nothing has read it', () => {
    const top = RESEARCH_STEPS[RESEARCH_STEPS.length - 1]!.points;
    expect(researchForHud(top, 0, 0)).toMatchObject({
      fraction: 1,
      value: String(top),
      label: 'Needs Terminal',
      tone: 'waiting',
    });
  });

  it('tells waiting points from open ones by the rows they reach', () => {
    expect(researchWaiting(9, 0)).toBe(false);
    expect(researchWaiting(10, 0)).toBe(true);
    expect(researchWaiting(19, 10)).toBe(false);
    expect(researchWaiting(20, 10)).toBe(true);
    expect(researchWaiting(20, 20)).toBe(false);
    expect(researchWaiting(39, 20)).toBe(false);
    expect(researchWaiting(40, 20)).toBe(true);
    expect(researchWaiting(54, 40)).toBe(false);
    expect(researchWaiting(55, 40)).toBe(true);
    expect(researchWaiting(0, 0)).toBe(false);
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

  it('shows points that wait for a Terminal as waiting, and comes up when a Terminal reads them', () => {
    const pill = new ResearchPill();
    pill.update(0.016, reading(12, 400, 0), false);
    expect(pill.update(0.016, reading(24, 400, 0), false)).toMatchObject({
      points: 24,
      tone: 'waiting',
      label: 'Needs Terminal',
    });
    // The reading changes only in what has been read: the pill is a change, but not a gain.
    expect(pill.update(RESEARCH_SECONDS, reading(24, 400, 24), true)).toMatchObject({
      points: 24,
      tone: 'rising',
      label: 'Research',
      gains: 1,
    });
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
    expect(watcher.update(reading(9))).toEqual(['Research +9']);
    expect(watcher.update(reading(9))).toEqual([]);
  });

  it('tell the group of modules the points opened, as they tell a material', () => {
    const watcher = new ResearchWatcher();
    watcher.update(reading(0));
    expect(watcher.update(reading(12))).toEqual(['Research +12', 'Power unlocked']);
    expect(watcher.update(reading(12))).toEqual([]);
  });

  it('tell each material the points opened, after the points', () => {
    const watcher = new ResearchWatcher();
    watcher.update(reading(12));
    expect(watcher.update(reading(24))).toEqual(['Research +12', 'Reinforced Composite unlocked']);
    expect(watcher.update(reading(36))).toEqual(['Research +12']);
    expect(watcher.update(reading(40))).toEqual(['Research +4', 'Camp unlocked']);
    expect(watcher.update(reading(60))).toEqual(['Research +20', 'Advanced Alloy unlocked']);
  });

  it('tell every row a jump opened, in the order of the ladder', () => {
    const watcher = new ResearchWatcher();
    watcher.update(reading(0));
    expect(watcher.update(reading(120))).toEqual([
      'Research +120',
      'Power unlocked',
      'Reinforced Composite unlocked',
      'Camp unlocked',
      'Advanced Alloy unlocked',
      'Energy-Infused unlocked',
    ]);
  });

  it('say nothing when a new run takes the points back, and start from the new run’s points', () => {
    const watcher = new ResearchWatcher();
    watcher.update(reading(60));
    expect(watcher.update(reading(0))).toEqual([]);
    expect(watcher.update(reading(9))).toEqual(['Research +9']);
    expect(watcher.update(reading(24))).toEqual([
      'Research +15',
      'Power unlocked',
      'Reinforced Composite unlocked',
    ]);
  });

  it('tell that points are waiting when they reach a row and no Terminal has read them', () => {
    const watcher = new ResearchWatcher();
    watcher.update(reading(12, 400, 0));
    expect(watcher.update(reading(24, 400, 0))).toEqual(['Research +12', TERMINAL_NEEDED]);
    // Nothing new, nothing said; the next dawn reminds the crew.
    expect(watcher.update(reading(24, 400, 0))).toEqual([]);
    expect(watcher.update(reading(36, 400, 0))).toEqual(['Research +12', TERMINAL_NEEDED]);
  });

  it('do not ask for a Terminal for points that reach no row, or that one has read', () => {
    const watcher = new ResearchWatcher();
    watcher.update(reading(0, 400, 0));
    expect(watcher.update(reading(9, 400, 0))).toEqual(['Research +9']);
    expect(watcher.update(reading(24, 400, 24))).toEqual([
      'Research +15',
      'Power unlocked',
      'Reinforced Composite unlocked',
    ]);
  });

  it('tell the materials a Terminal opens the moment it reads, with no new points', () => {
    const watcher = new ResearchWatcher();
    watcher.update(reading(60, 400, 0));
    expect(watcher.update(reading(60, 400, 60))).toEqual([
      'Power unlocked',
      'Reinforced Composite unlocked',
      'Camp unlocked',
      'Advanced Alloy unlocked',
    ]);
    expect(watcher.update(reading(60, 400, 60))).toEqual([]);
  });

  it('say nothing while there is no pool, and treat the first word of the host as a first look', () => {
    const watcher = new ResearchWatcher();
    watcher.update(reading(0, 0));
    expect(watcher.update(reading(30))).toEqual([]);
    expect(watcher.update(reading(39))).toEqual(['Research +9']);
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
      terminal: false,
    });
    expect(lockForPiece(packState(SHAPE.wedge, MATERIAL.alloy), reading(30))).toEqual({
      name: 'Advanced Alloy',
      have: 30,
      need: 55,
      terminal: false,
    });
  });

  it('says only a Terminal is missing when the points earned reach the row and nothing has read them', () => {
    expect(lockForPiece(COMPOSITE, reading(24, 400, 0))).toEqual({
      name: 'Reinforced Composite',
      have: 24,
      need: 20,
      terminal: true,
    });
    // Alloy is further away than the points: the crew has to earn them first.
    expect(lockForPiece(packState(SHAPE.cube, MATERIAL.alloy), reading(24, 400, 0))).toMatchObject({
      have: 24,
      need: 55,
      terminal: false,
    });
    // Read points open it.
    expect(lockForPiece(COMPOSITE, reading(24, 400, 24))).toBeNull();
  });

  it('is nothing for a material the crew has researched, Scrap, an empty slot or a run with no pool', () => {
    expect(lockForPiece(COMPOSITE, reading(20))).toBeNull();
    expect(lockForPiece(SCRAP, reading(0))).toBeNull();
    expect(lockForPiece(0, reading(0))).toBeNull();
    expect(lockForPiece(COMPOSITE, reading(0, 0))).toBeNull();
  });

  it('follows the material that pays for a turret’s level, not the byte of its cell', () => {
    const turret = (level: number) => packState(moduleShape(MODULE.turret, 0), level);
    // The Basic Turret is paid in Scrap, the Auto Turret in Composite and the Heavy Turret in Alloy.
    expect(lockForPiece(turret(1), reading(0))).toBeNull();
    expect(lockForPiece(turret(2), reading(12))).toEqual({
      name: 'Reinforced Composite',
      have: 12,
      need: 20,
      terminal: false,
    });
    expect(lockForPiece(turret(3), reading(30))).toEqual({
      name: 'Advanced Alloy',
      have: 30,
      need: 55,
      terminal: false,
    });
    expect(lockForPiece(turret(2), reading(24, 400, 0))).toMatchObject({ terminal: true });
    expect(lockForPiece(turret(2), reading(20))).toBeNull();
    expect(lockForPiece(turret(3), reading(0, 0))).toBeNull();
    // The Terminal is paid in Scrap, so it is never closed.
    expect(lockForPiece(packState(moduleShape(MODULE.terminal, 0), 1), reading(0))).toBeNull();
  });

  it('names the module, not its price, for a module that waits on a group of research', () => {
    const generator = packState(moduleShape(MODULE.generator, 0), 1);
    // The Generator is paid in Scrap, so only its group can hold it back.
    expect(lockForPiece(generator, reading(0))).toEqual({
      name: 'Generator',
      have: 0,
      need: 10,
      terminal: false,
    });
    expect(lockForPiece(generator, reading(9))).toMatchObject({
      have: 9,
      need: 10,
      terminal: false,
    });
    expect(lockForPiece(generator, reading(12, 400, 0))).toEqual({
      name: 'Generator',
      have: 12,
      need: 10,
      terminal: true,
    });
    expect(lockForPiece(generator, reading(12, 400, 9))).toMatchObject({ terminal: true });
    expect(lockForPiece(generator, reading(10))).toBeNull();
    expect(lockForPiece(generator, reading(0, 0))).toBeNull();
    expect(lockText({ name: 'Generator', have: 4, need: 10, terminal: false })).toBe(
      'Needs research · 4 of 10',
    );
  });

  it('says the points the crew has and the points that open it', () => {
    expect(lockText({ name: 'Reinforced Composite', have: 12, need: 20, terminal: false })).toBe(
      'Needs research · 12 of 20',
    );
  });

  it('asks for a Terminal when the points earned are enough and nothing has read them', () => {
    expect(lockText({ name: 'Reinforced Composite', have: 24, need: 20, terminal: true })).toBe(
      TERMINAL_NEEDED,
    );
    expect(TERMINAL_NEEDED).toBe('Needs a Research Terminal');
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

  it('closes the module slot while the module in it waits on research no Terminal has read', () => {
    expect(moduleSlotLocked(MODULE.generator, reading(9))).toBe(true);
    expect(moduleSlotLocked(MODULE.generator, reading(10))).toBe(false);
    expect(moduleSlotLocked(MODULE.generator, reading(12, 400, 9))).toBe(true);
    expect(moduleSlotLocked(MODULE.generator, reading(0, 0))).toBe(false);
    // The Terminal and the Basic Turret are not in a group, so nothing holds them back.
    expect(moduleSlotLocked(MODULE.terminal, reading(0))).toBe(false);
    expect(moduleSlotLocked(MODULE.turret, reading(0))).toBe(false);
    expect(moduleSlotLocked(99, reading(0))).toBe(false);
  });

  it('keeps a slot closed while the points that would open it have not been read', () => {
    expect(slotLocked(MATERIAL.composite, reading(24, 400, 0))).toBe(true);
    expect(slotLocked(MATERIAL.composite, reading(24, 400, 24))).toBe(false);
    expect(slotLocked(MATERIAL.composite, reading(24, 400, 19))).toBe(true);
  });
});
