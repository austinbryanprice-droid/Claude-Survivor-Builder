import { describe, expect, it } from 'vitest';
import { MATERIAL } from '../../src/shared/blocks';
import { DAY_SECONDS, NIGHT_SECONDS } from '../../src/shared/daycycle';
import type { HarvestEvent } from '../../src/shared/economy';
import {
  createReading,
  readClock,
  type OverrunCause,
  type SurvivalEvent,
} from '../../src/shared/survival-state';
import { createVitalsReading, type VitalsReading } from '../../src/shared/vitals-state';
import {
  CLOCK_SOON_SECONDS,
  CORE_CRITICAL_BELOW,
  CORE_WORN_BELOW,
  chargesForHud,
  clockForHud,
  coreForHud,
  downForHud,
  harvestMessage,
  messageFor,
  objectiveForRun,
  resultsForHud,
  runLine,
} from '../../src/ui/run-hud';

function reading(elapsed: number, running = true) {
  const out = readClock(elapsed, createReading());
  out.running = running;
  return out;
}

/** A reading with a Core of `health` out of 1000, `over` once it has fallen. */
function withCore(elapsed: number, health: number, over = false) {
  const out = reading(elapsed, !over);
  out.coreHealth = health;
  out.coreMax = 1000;
  out.over = over;
  return out;
}

describe('the clock by the compass', () => {
  it('shows the day, its number and the time until nightfall', () => {
    expect(clockForHud(reading(0))).toEqual({
      phase: 'day',
      label: 'Day 1',
      time: '8:00',
      progress: 0,
      soon: false,
    });
    const midday = clockForHud(reading(DAY_SECONDS / 2 + 12));
    expect(midday).toMatchObject({ label: 'Day 1', time: '3:48', soon: false });
    expect(midday.progress).toBeCloseTo(0.525, 3);
  });

  it('shows the night, its number and the time until dawn', () => {
    const night = clockForHud(reading(DAY_SECONDS + 60));
    expect(night).toMatchObject({ phase: 'night', label: 'Night 1', time: '3:00' });
    expect(night.progress).toBeCloseTo(60 / NIGHT_SECONDS, 6);
    expect(clockForHud(reading(720 + DAY_SECONDS + 1))).toMatchObject({ label: 'Night 2' });
    expect(clockForHud(reading(720))).toMatchObject({ phase: 'day', label: 'Day 2' });
  });

  it('turns urgent for the last half minute of the day and of the night', () => {
    expect(CLOCK_SOON_SECONDS).toBe(30);
    expect(clockForHud(reading(DAY_SECONDS - 31)).soon).toBe(false);
    expect(clockForHud(reading(DAY_SECONDS - 30)).soon).toBe(true);
    expect(clockForHud(reading(DAY_SECONDS - 1))).toMatchObject({ soon: true, time: '0:01' });
    expect(clockForHud(reading(DAY_SECONDS + 100)).soon).toBe(false);
    expect(clockForHud(reading(720 - 20)).soon).toBe(true);
  });

  it('keeps the progress within its bar', () => {
    for (let t = 0; t < 1500; t += 7.3) {
      const { progress } = clockForHud(reading(t));
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });
});

describe('what the HUD says about the run', () => {
  it('asks for building by day and for holding out at night', () => {
    expect(objectiveForRun(reading(10))).toEqual({
      place: 'The Ashbound Outpost',
      title: 'Build up before nightfall',
    });
    expect(objectiveForRun(reading(DAY_SECONDS + 10)).title).toBe('Hold the outpost until dawn');
  });

  it('puts the time on the pause card and says when the clock is waiting', () => {
    expect(runLine(reading(0))).toBe('Day 1 · 8:00 until nightfall');
    expect(runLine(reading(DAY_SECONDS + 5))).toBe('Night 1 · 3:55 until dawn');
    expect(runLine(reading(100, false))).toBe(
      'Day 1 · 6:20 until nightfall · the clock waits while you are away',
    );
  });

  it('announces the change of light', () => {
    expect(messageFor({ k: 'nightfall', n: 3 })).toBe('Night 3 has fallen');
    expect(messageFor({ k: 'dawn', n: 3 })).toBe('Dawn breaks on day 4');
  });

  it('warns of a wave with its place in the night and its size', () => {
    expect(messageFor({ k: 'wave', n: 2, i: 1, of: 2, c: 4 })).toBe(
      'Wave 1 of 2: 4 machines in ten seconds',
    );
    expect(messageFor({ k: 'wave', n: 9, i: 4, of: 4, c: 6 })).toBe(
      'Wave 4 of 4: 6 machines in ten seconds',
    );
    expect(messageFor({ k: 'wave', n: 1, i: 1, of: 1, c: 1 })).toBe(
      'Wave 1 of 1: 1 machine in ten seconds',
    );
  });
});

describe("the Outpost Core's gauge", () => {
  it('stays out of the way by day while the Core is whole', () => {
    expect(coreForHud(withCore(10, 1000))).toBeNull();
  });

  it('is on screen all night, even whole', () => {
    expect(coreForHud(withCore(DAY_SECONDS + 10, 1000))).toEqual({
      fraction: 1,
      value: '1000',
      tone: 'sound',
    });
  });

  it('comes up by day as soon as the Core is hurt, and shows what is left', () => {
    expect(coreForHud(withCore(10, 999))).toEqual({
      fraction: 0.999,
      value: '999',
      tone: 'sound',
    });
  });

  it('turns amber below half and red below a quarter', () => {
    expect(CORE_WORN_BELOW).toBe(0.5);
    expect(CORE_CRITICAL_BELOW).toBe(0.25);
    const tone = (health: number) => coreForHud(withCore(DAY_SECONDS + 5, health))?.tone;
    expect(tone(900)).toBe('sound');
    expect(tone(500)).toBe('sound');
    expect(tone(499)).toBe('worn');
    expect(tone(250)).toBe('worn');
    expect(tone(249)).toBe('critical');
    expect(tone(1)).toBe('critical');
  });

  it('goes grey and stays up once the Core has fallen, by day or by night', () => {
    expect(coreForHud(withCore(10, 0, true))).toEqual({ fraction: 0, value: '0', tone: 'fallen' });
    expect(coreForHud(withCore(DAY_SECONDS + 10, 0, true))?.tone).toBe('fallen');
  });

  it('is absent where the run has no Core to show', () => {
    expect(coreForHud(reading(DAY_SECONDS + 10))).toBeNull();
  });

  it('keeps its bar inside its frame whatever the numbers say', () => {
    const over = withCore(DAY_SECONDS + 5, 1500);
    expect(coreForHud(over)?.fraction).toBe(1);
    const under = withCore(DAY_SECONDS + 5, -20);
    expect(coreForHud(under)?.fraction).toBe(0);
  });
});

describe('what the HUD says when the Core falls', () => {
  it('stops breathing the clock and says the Core has fallen', () => {
    const fallen = withCore(DAY_SECONDS - 10, 0, true);
    expect(clockForHud(fallen).soon).toBe(false);
    expect(objectiveForRun(fallen).title).toBe('The Outpost Core has fallen');
  });

  it('announces the fall', () => {
    expect(messageFor({ k: 'overrun', n: 3, why: 'core' })).toBe('The Outpost Core has fallen');
  });
});

/** A run `elapsed` seconds in, with the crew holding `respawns` of the `max` it can, and over for `why` when given. */
function withCrew(elapsed: number, respawns: number, max: number, why: OverrunCause | null = null) {
  const out = reading(elapsed, why === null);
  out.coreHealth = 1000;
  out.coreMax = 1000;
  out.respawns = respawns;
  out.respawnMax = max;
  out.over = why !== null;
  out.overWhy = why;
  return out;
}

/** A player's meters as the host would report them. */
function meters(health: number, returnIn = 0): VitalsReading {
  return { ...createVitalsReading(), health, healthMax: 100, energy: 80, energyMax: 100, returnIn };
}

describe('the crew’s respawn charges on the HUD', () => {
  it('is quiet by day while the crew holds all it can', () => {
    expect(chargesForHud(withCrew(100, 6, 6))).toBeNull();
  });

  it('shows at night, whatever the crew holds', () => {
    expect(chargesForHud(withCrew(DAY_SECONDS + 10, 6, 6))).toEqual({
      count: 6,
      max: 6,
      tone: 'ok',
    });
  });

  it('shows by day as soon as one has been spent, and grows back to quiet', () => {
    expect(chargesForHud(withCrew(100, 5, 6))).toEqual({ count: 5, max: 6, tone: 'ok' });
    expect(chargesForHud(withCrew(100, 2, 3))).toEqual({ count: 2, max: 3, tone: 'ok' });
  });

  it('turns amber at the last charge and red with none', () => {
    expect(chargesForHud(withCrew(DAY_SECONDS + 10, 2, 6))?.tone).toBe('ok');
    expect(chargesForHud(withCrew(DAY_SECONDS + 10, 1, 6))?.tone).toBe('low');
    expect(chargesForHud(withCrew(DAY_SECONDS + 10, 0, 6))?.tone).toBe('empty');
  });

  it('stays on screen once the run is over', () => {
    expect(chargesForHud(withCrew(100, 3, 3, 'crew'))?.count).toBe(3);
    expect(chargesForHud(withCrew(100, 0, 3, 'crew'))?.tone).toBe('empty');
  });

  it('is hidden where the run has no crew to count', () => {
    expect(chargesForHud(withCrew(DAY_SECONDS + 10, 0, 0))).toBeNull();
    expect(chargesForHud(reading(DAY_SECONDS + 10))).toBeNull();
  });
});

describe('the screen of a player who is down', () => {
  it('says nothing to a player who is up, or where there are no meters', () => {
    expect(downForHud(meters(100), withCrew(10, 2, 3))).toBeNull();
    expect(downForHud(meters(1), null)).toBeNull();
    expect(downForHud(createVitalsReading(), null)).toBeNull();
  });

  it('counts down the Core’s return in whole seconds', () => {
    expect(downForHud(meters(0, 6), withCrew(10, 2, 3))).toEqual({
      title: 'You are down',
      detail: 'The Core brings you back in',
      seconds: 6,
    });
    expect(downForHud(meters(0, 1), withCrew(10, 1, 3))?.seconds).toBe(1);
  });

  it('says the dawn brings more when the crew has no charge for them', () => {
    const waiting = downForHud(meters(0, 0), withCrew(10, 0, 3));
    expect(waiting).toMatchObject({ title: 'You are down', seconds: null });
    expect(waiting?.detail).toMatch(/dawn/);
  });

  it('tells a player who is down when the run ends, and why', () => {
    expect(downForHud(meters(0), withCrew(10, 0, 3, 'crew'))).toEqual({
      title: 'Outpost overrun',
      detail: 'Every player is down and the crew has no respawns left',
      seconds: null,
    });
    expect(downForHud(meters(0), withCrew(10, 1, 3, 'core'))).toMatchObject({
      title: 'Outpost overrun',
      detail: 'The Outpost Core has fallen',
    });
  });
});

describe('what the HUD says when the whole crew goes down', () => {
  it('puts it in the banner, and says the Core stands', () => {
    const wiped = withCrew(DAY_SECONDS + 30, 0, 3, 'crew');
    expect(objectiveForRun(wiped).title).toBe('The whole crew is down');
    expect(objectiveForRun(withCore(DAY_SECONDS + 30, 0, true)).title).toBe(
      'The Outpost Core has fallen',
    );
  });

  it('draws the Core’s gauge as it is: whole and sound, not fallen', () => {
    expect(coreForHud(withCrew(DAY_SECONDS + 30, 0, 3, 'crew'))).toMatchObject({
      fraction: 1,
      value: '1000',
      tone: 'sound',
    });
    // By day, with the Core whole, there is nothing to draw.
    expect(coreForHud(withCrew(100, 0, 3, 'crew'))).toBeNull();
  });
});

describe('the results of a lost run', () => {
  it('are nothing while the run goes on', () => {
    expect(resultsForHud(reading(100))).toBeNull();
    expect(resultsForHud(withCore(DAY_SECONDS + 5, 400))).toBeNull();
    expect(resultsForHud(withCrew(DAY_SECONDS + 5, 0, 3))).toBeNull();
  });

  it('count the nights that ended in a dawn and say where the Core fell', () => {
    expect(resultsForHud(withCore(DAY_SECONDS + 30, 0, true))).toMatchObject({
      nights: 0,
      cause: 'The Outpost Core fell on Night 1.',
    });
    expect(resultsForHud(withCore(720 + DAY_SECONDS + 30, 0, true))).toMatchObject({
      nights: 1,
      cause: 'The Outpost Core fell on Night 2.',
    });
    expect(resultsForHud(withCore(2 * 720 + 100, 0, true))).toMatchObject({
      nights: 2,
      cause: 'The Outpost Core fell on Day 3.',
    });
  });

  it('say when the whole crew went down with no charge left', () => {
    expect(resultsForHud(withCrew(720 + DAY_SECONDS + 30, 0, 3, 'crew'))).toMatchObject({
      nights: 1,
      cause: 'Every player was down on Night 2 and the crew had no respawns left.',
    });
  });

  it('list what the crew did, in the order the card shows it', () => {
    const lost = withCore(720 + DAY_SECONDS + 90, 0, true);
    lost.felled = 31;
    lost.placed = 212;
    lost.upgraded = 17;
    lost.gathered = 460;
    lost.revived = 3;
    expect(resultsForHud(lost)?.stats).toEqual([
      { label: 'Time held', value: '21:30' },
      { label: 'Machines destroyed', value: '31' },
      { label: 'Blocks placed', value: '212' },
      { label: 'Upgrades completed', value: '17' },
      { label: 'Materials gathered', value: '460' },
      { label: 'Respawns used', value: '3' },
    ]);
  });

  it('add the research the crew earned after the materials, when the screen has an economy to ask', () => {
    const lost = withCore(720 + DAY_SECONDS + 90, 0, true);
    lost.gathered = 460;
    const labels = (research: number | null) =>
      resultsForHud(lost, research)?.stats.map((stat) => stat.label);
    expect(labels(null)).not.toContain('Research earned');
    expect(labels(55)).toEqual([
      'Time held',
      'Machines destroyed',
      'Blocks placed',
      'Upgrades completed',
      'Materials gathered',
      'Research earned',
      'Respawns used',
    ]);
    expect(resultsForHud(lost, 55)?.stats).toContainEqual({
      label: 'Research earned',
      value: '55',
    });
    expect(resultsForHud(lost, 0)?.stats).toContainEqual({ label: 'Research earned', value: '0' });
  });

  it('show a crew that did nothing as zeros, not as gaps', () => {
    const stats = resultsForHud(withCore(DAY_SECONDS + 30, 0, true))?.stats ?? [];
    expect(stats.map((stat) => stat.value)).toEqual(['8:30', '0', '0', '0', '0', '0']);
  });
});

describe('the messages about a player going down and coming back', () => {
  const names: Record<number, string> = { 2: 'Ada', 3: 'Bo' };
  const nameOf = (id: number): string | null => (id === 1 ? null : (names[id] ?? 'Someone'));

  it('speak to the player at this screen as “you”', () => {
    expect(messageFor({ k: 'down', n: 1, p: 1 }, nameOf)).toBe('You are down');
    expect(messageFor({ k: 'back', n: 1, p: 1, c: 3 }, nameOf)).toBe(
      'The Core brought you back, shaken · 3 respawns left',
    );
  });

  it('name anyone else as the room does', () => {
    expect(messageFor({ k: 'down', n: 1, p: 2 }, nameOf)).toBe('Ada is down');
    expect(messageFor({ k: 'back', n: 4, p: 3, c: 1 }, nameOf)).toBe(
      'Bo is back, shaken · 1 respawn left',
    );
    expect(messageFor({ k: 'back', n: 4, p: 3, c: 0 }, nameOf)).toBe(
      'Bo is back, shaken · 0 respawns left',
    );
  });

  it('call a player nobody named a crewmate', () => {
    expect(messageFor({ k: 'down', n: 1, p: 9 })).toBe('A crewmate is down');
  });

  it('say which way the run ended', () => {
    expect(messageFor({ k: 'overrun', n: 3, why: 'crew' })).toBe('The whole crew is down');
    expect(messageFor({ k: 'overrun', n: 3, why: 'core' })).toBe('The Outpost Core has fallen');
  });

  it('say what a felled machine left in the pool, in the material’s own name', () => {
    expect(messageFor({ k: 'drop', n: 4, m: MATERIAL.energy, c: 3 })).toBe(
      'A machine left 3 Energy-Infused in the pool',
    );
    expect(messageFor({ k: 'drop', n: 7, m: MATERIAL.alloy, c: 1 })).toBe(
      'A machine left 1 Advanced Alloy in the pool',
    );
  });

  it('have words for every kind of event that is read', () => {
    const events: SurvivalEvent[] = [
      { k: 'nightfall', n: 1 },
      { k: 'wave', n: 1, i: 1, of: 2, c: 6 },
      { k: 'dawn', n: 1 },
      { k: 'overrun', n: 1, why: 'core' },
      { k: 'down', n: 1, p: 2 },
      { k: 'back', n: 1, p: 2, c: 1 },
      { k: 'drop', n: 4, m: MATERIAL.energy, c: 3 },
    ];
    for (const event of events) expect(messageFor(event, nameOf)?.length).toBeGreaterThan(5);
  });

  it('say nothing of a breacher going off: that is seen, not read', () => {
    expect(messageFor({ k: 'blast', n: 9, x: 4.5, y: 12.6, z: -7.2 }, nameOf)).toBeNull();
  });
});

describe('the message about a strip', () => {
  const strip = (extra: Partial<HarvestEvent> = {}): HarvestEvent => ({
    by: 1,
    node: 4,
    material: MATERIAL.scrap,
    gained: 10,
    left: 2,
    full: false,
    ...extra,
  });

  it('says what went into the pool, in the material’s own name', () => {
    expect(harvestMessage(strip())).toBe('+10 Scrap');
    expect(harvestMessage(strip({ material: MATERIAL.composite, gained: 7 }))).toBe(
      '+7 Reinforced Composite',
    );
  });

  it('says when that was the last of the heap', () => {
    expect(harvestMessage(strip({ left: 0 }))).toBe('+10 Scrap · that heap is stripped bare');
  });

  it('says when the pool could take only part of it, which matters more than the heap being bare', () => {
    expect(harvestMessage(strip({ gained: 4, full: true }))).toBe('+4 Scrap · the pool is full');
    expect(harvestMessage(strip({ gained: 4, full: true, left: 0 }))).toBe(
      '+4 Scrap · the pool is full',
    );
  });

  it('does not make up a name for a material the table does not know', () => {
    expect(harvestMessage(strip({ material: 99 }))).toBe('+10 materials');
  });
});
