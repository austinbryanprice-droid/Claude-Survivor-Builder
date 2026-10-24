import { describe, expect, it } from 'vitest';
import { CYCLE_SECONDS, DAY_SECONDS } from '../../src/shared/daycycle';
import {
  createReading,
  nightStart,
  type SurvivalEvent,
  type SurvivalReading,
} from '../../src/shared/survival-state';
import { createVitalsReading, isDown } from '../../src/shared/vitals-state';
import { RESPAWN, VITALS } from '../../src/systems/survival/balance';
import { SurvivalSim } from '../../src/systems/survival/sim';

function eventsOf(sim: SurvivalSim): SurvivalEvent[] {
  const out: SurvivalEvent[] = [];
  sim.drainEvents(out);
  return out;
}

function readRun(sim: SurvivalSim): SurvivalReading {
  return sim.read(createReading());
}

/** A run with these players in it, none of them down. */
function crew(...ids: number[]): SurvivalSim {
  const sim = new SurvivalSim();
  for (const id of ids) sim.addPlayer(id);
  return sim;
}

/** Lays a player down on the spot, as a blow that took the rest of their Health would. */
function fell(sim: SurvivalSim, id: number): void {
  sim.hurtPlayer(id, VITALS.maxHealth * 10);
}

describe('the crew’s respawn charges', () => {
  it('begin with the table’s number for every player who joins', () => {
    const sim = new SurvivalSim();
    expect(sim.respawns).toBe(0);
    sim.addPlayer(1);
    expect(sim.respawns).toBe(RESPAWN.startPerPlayer);
    sim.addPlayer(2);
    sim.addPlayer(3);
    expect(sim.respawns).toBe(3 * RESPAWN.startPerPlayer);
  });

  it('are the most the crew can hold: so many for each player in the run', () => {
    const sim = crew(1, 2);
    expect(sim.respawnMax).toBe(2 * RESPAWN.capPerPlayer);
    sim.addPlayer(3);
    expect(sim.respawnMax).toBe(3 * RESPAWN.capPerPlayer);
    expect(readRun(sim)).toMatchObject({ respawns: 3 * RESPAWN.startPerPlayer, respawnMax: 9 });
  });

  it('are not brought again by a player who is added twice, or who leaves and comes back', () => {
    const sim = crew(1);
    sim.addPlayer(1);
    expect(sim.respawns).toBe(RESPAWN.startPerPlayer);
    sim.removePlayer(1);
    sim.addPlayer(1);
    expect(sim.respawns).toBe(RESPAWN.startPerPlayer);
  });

  it('stay in the pool when a player leaves with them, and the dawn does not add to a pool that is over its cap', () => {
    const sim = crew(1, 2);
    sim.setRespawns(2 * RESPAWN.capPerPlayer);
    sim.removePlayer(2);
    expect(sim.respawns).toBe(2 * RESPAWN.capPerPlayer);
    expect(sim.respawnMax).toBe(2 * RESPAWN.capPerPlayer);
    sim.warp(CYCLE_SECONDS);
    expect(sim.respawns).toBe(2 * RESPAWN.capPerPlayer);
  });

  it('gain the table’s number for every player at each dawn, up to the cap', () => {
    const sim = crew(1, 2);
    sim.setRespawns(0);
    sim.warp(CYCLE_SECONDS);
    expect(sim.respawns).toBe(2 * RESPAWN.dawnPerPlayer);
    sim.warp(CYCLE_SECONDS);
    expect(sim.respawns).toBe(4 * RESPAWN.dawnPerPlayer);
    for (let day = 0; day < 6; day++) sim.warp(CYCLE_SECONDS);
    expect(sim.respawns).toBe(2 * RESPAWN.capPerPlayer);
  });

  it('are not given at nightfall or in the middle of the day', () => {
    const sim = crew(1);
    sim.setRespawns(0);
    sim.warp(DAY_SECONDS + 10);
    expect(sim.respawns).toBe(0);
    sim.warp(CYCLE_SECONDS - DAY_SECONDS - 20);
    expect(sim.respawns).toBe(0);
    sim.warp(15);
    expect(sim.respawns).toBe(RESPAWN.dawnPerPlayer);
  });

  it('can be set outright for tests, between none and what the crew can hold', () => {
    const sim = crew(1);
    sim.setRespawns(1);
    expect(sim.respawns).toBe(1);
    sim.setRespawns(99);
    expect(sim.respawns).toBe(RESPAWN.capPerPlayer);
    sim.setRespawns(-4);
    expect(sim.respawns).toBe(0);
    sim.setRespawns(2.9);
    expect(sim.respawns).toBe(2);
    sim.setRespawns(Number.NaN);
    expect(sim.respawns).toBe(2);
  });
});

describe('a player who goes down', () => {
  it('is announced once, with the day or night they fell in', () => {
    const sim = new SurvivalSim({ startAt: nightStart(2) });
    sim.addPlayer(5);
    eventsOf(sim);
    fell(sim, 5);
    sim.warp(0.1);
    expect(eventsOf(sim)).toEqual([{ k: 'down', n: 2, p: 5 }]);
    sim.warp(1);
    expect(eventsOf(sim)).toEqual([]);
  });

  it('lies down until the Core brings them back: no hands, and the machines leave them be', () => {
    const sim = crew(1, 2);
    expect(sim.isDown(1)).toBe(false);
    fell(sim, 1);
    sim.warp(0.1);
    expect(sim.isDown(1)).toBe(true);
    expect(sim.isDown(2)).toBe(false);
    expect(sim.isDown(9)).toBe(false);
  });

  it('is down in the meters too, with the seconds left to wait', () => {
    const sim = crew(1);
    fell(sim, 1);
    sim.warp(0.1);
    const meters = sim.readVitals(1, createVitalsReading())!;
    expect(isDown(meters)).toBe(true);
    expect(meters.returnIn).toBe(RESPAWN.delaySeconds);
    expect(meters.shaken).toBe(0);
  });

  it('says how long the wait is from the moment they fall, before the next step has run', () => {
    const sim = crew(1, 2);
    sim.setRespawns(1);
    fell(sim, 1);
    expect(sim.readVitals(1, createVitalsReading())!.returnIn).toBe(RESPAWN.delaySeconds);
    sim.warp(0.1);
    // One charge, and the first to fall has it: the second is told at once that it waits for the dawn.
    fell(sim, 2);
    expect(sim.readVitals(2, createVitalsReading())!.returnIn).toBe(0);
    expect(sim.readVitals(1, createVitalsReading())!.returnIn).toBe(RESPAWN.delaySeconds);
  });

  it('counts the wait down in whole seconds, never showing 0 until they are back', () => {
    const sim = crew(1);
    fell(sim, 1);
    const seen: number[] = [];
    for (let i = 0; i < RESPAWN.delaySeconds * 20 - 2; i++) {
      sim.warp(0.05);
      seen.push(sim.readVitals(1, createVitalsReading())!.returnIn);
    }
    expect(Math.min(...seen)).toBe(1);
    expect(Math.max(...seen)).toBe(RESPAWN.delaySeconds);
    expect(seen).toEqual([...seen].sort((a, b) => b - a));
  });
});

describe('the Core bringing a player back', () => {
  it('does it after the table’s delay, for one charge, and says so', () => {
    const sim = crew(1);
    eventsOf(sim);
    fell(sim, 1);
    sim.warp(RESPAWN.delaySeconds - 0.5);
    expect(sim.isDown(1)).toBe(true);
    expect(sim.respawns).toBe(RESPAWN.startPerPlayer);
    sim.warp(0.6);
    expect(sim.isDown(1)).toBe(false);
    expect(sim.respawns).toBe(RESPAWN.startPerPlayer - 1);
    expect(eventsOf(sim)).toEqual([
      { k: 'down', n: 1, p: 1 },
      { k: 'back', n: 1, p: 1, c: RESPAWN.startPerPlayer - 1 },
    ]);
  });

  it('counts the charges it spends, for the results screen', () => {
    const sim = crew(1, 2);
    expect(sim.revived).toBe(0);
    fell(sim, 1);
    sim.warp(RESPAWN.delaySeconds + 0.5);
    expect(sim.revived).toBe(1);
    fell(sim, 2);
    fell(sim, 1);
    sim.warp(RESPAWN.delaySeconds + 0.5);
    expect(sim.revived).toBe(3);
    // A charge the dawn adds is not one spent.
    sim.warp(CYCLE_SECONDS);
    expect(sim.revived).toBe(3);
    expect(readRun(sim).revived).toBe(3);
  });

  it('puts them back on their feet with full Health, part of the Energy bar and the shaking', () => {
    const sim = crew(1);
    sim.playerVitals(1)?.set({ energy: 3 });
    fell(sim, 1);
    sim.warp(RESPAWN.delaySeconds + 0.5);
    const meters = sim.readVitals(1, createVitalsReading())!;
    expect(meters).toMatchObject({
      health: VITALS.maxHealth,
      energy: VITALS.maxEnergy * RESPAWN.energy,
      returnIn: 0,
    });
    expect(meters.shaken).toBeGreaterThan(RESPAWN.shaken.seconds - 2);
    expect(meters.shaken).toBeLessThanOrEqual(RESPAWN.shaken.seconds);
    expect(isDown(meters)).toBe(false);
  });

  it('lets them go down again, and spends another charge', () => {
    const sim = crew(1);
    for (let life = 1; life <= RESPAWN.startPerPlayer; life++) {
      fell(sim, 1);
      sim.warp(RESPAWN.delaySeconds + 0.5);
      expect(sim.isDown(1)).toBe(false);
      expect(sim.respawns).toBe(RESPAWN.startPerPlayer - life);
    }
  });

  it('brings the players back in the order they fell, one charge each', () => {
    const sim = crew(1, 2, 3);
    eventsOf(sim);
    fell(sim, 3);
    sim.warp(1);
    fell(sim, 1);
    sim.warp(RESPAWN.delaySeconds - 0.5);
    // The first to fall is back; the second still has a second to wait.
    expect(sim.isDown(3)).toBe(false);
    expect(sim.isDown(1)).toBe(true);
    sim.warp(1.5);
    expect(sim.isDown(1)).toBe(false);
    const backs = eventsOf(sim).filter((event) => event.k === 'back');
    expect(backs.map((event) => event.p)).toEqual([3, 1]);
    expect(sim.respawns).toBe(3 * RESPAWN.startPerPlayer - 2);
  });

  it('makes a player who is last in the queue wait for a charge the others spent', () => {
    const sim = crew(1, 2);
    sim.setRespawns(1);
    fell(sim, 1);
    fell(sim, 2);
    sim.warp(0.2);
    expect(sim.readVitals(1, createVitalsReading())!.returnIn).toBeGreaterThan(0);
    // One charge for two players: the second is told nothing counts down for them.
    expect(sim.readVitals(2, createVitalsReading())!.returnIn).toBe(0);
    sim.warp(RESPAWN.delaySeconds + 0.5);
    expect(sim.isDown(1)).toBe(false);
    expect(sim.isDown(2)).toBe(true);
    expect(sim.respawns).toBe(0);
    expect(readRun(sim).over).toBe(false);
  });

  it('brings the one who waited back at dawn, at once, when the dawn gives a charge', () => {
    const sim = crew(1, 2);
    sim.setRespawns(0);
    fell(sim, 2);
    sim.warp(CYCLE_SECONDS - 1);
    expect(sim.isDown(2)).toBe(true);
    eventsOf(sim);
    sim.warp(2);
    expect(sim.isDown(2)).toBe(false);
    const events = eventsOf(sim);
    expect(events.map((event) => event.k)).toEqual(['dawn', 'back']);
    expect(events[1]).toMatchObject({ p: 2, c: 1 });
  });

  it('forgets a player who left while they were down, and carries on with the next', () => {
    const sim = crew(1, 2);
    fell(sim, 1);
    sim.warp(1);
    fell(sim, 2);
    sim.removePlayer(1);
    sim.warp(RESPAWN.delaySeconds + 1);
    expect(sim.isDown(2)).toBe(false);
    expect(eventsOf(sim).filter((event) => event.k === 'back')).toEqual([
      { k: 'back', n: 1, p: 2, c: 2 * RESPAWN.startPerPlayer - 1 },
    ]);
  });

  it('does not wait for a player whose Health was put back by hand', () => {
    const sim = crew(1);
    fell(sim, 1);
    sim.warp(1);
    sim.playerVitals(1)?.set({ health: 50 });
    sim.warp(RESPAWN.delaySeconds + 1);
    expect(sim.respawns).toBe(RESPAWN.startPerPlayer);
    expect(sim.readVitals(1, createVitalsReading())!.health).toBeGreaterThanOrEqual(50);
  });

  it('keeps the clock running while a player is down, and the other players’ meters going', () => {
    const sim = crew(1, 2);
    fell(sim, 1);
    const before = sim.tick;
    sim.warp(1);
    expect(sim.tick).toBe(before + 20);
    sim.playerVitals(2)?.set({ energy: 50 });
    sim.warp(30);
    expect(sim.readVitals(2, createVitalsReading())!.energy).toBeLessThan(50);
  });
});

describe('the run ending when the whole crew is down', () => {
  it('happens at once when the last player falls with no charge left', () => {
    const sim = crew(1);
    sim.setRespawns(0);
    eventsOf(sim);
    fell(sim, 1);
    sim.warp(0.1);
    expect(sim.over).toBe(true);
    expect(sim.overWhy).toBe('crew');
    expect(eventsOf(sim)).toEqual([
      { k: 'down', n: 1, p: 1 },
      { k: 'overrun', n: 1, why: 'crew' },
    ]);
    expect(readRun(sim)).toMatchObject({ over: true, overWhy: 'crew', running: false });
  });

  it('waits for the last player of a crew, and not for one who is still up', () => {
    const sim = crew(1, 2);
    sim.setRespawns(0);
    fell(sim, 1);
    sim.warp(RESPAWN.delaySeconds * 3);
    expect(sim.over).toBe(false);
    fell(sim, 2);
    sim.warp(0.1);
    expect(sim.over).toBe(true);
    expect(sim.overWhy).toBe('crew');
  });

  it('does not happen while a charge is left, even with everyone down', () => {
    const sim = crew(1, 2);
    sim.setRespawns(1);
    fell(sim, 1);
    fell(sim, 2);
    sim.warp(1);
    expect(sim.over).toBe(false);
  });

  it('happens when the last charge is spent and the player it brought back goes down again', () => {
    const sim = crew(1);
    sim.setRespawns(1);
    fell(sim, 1);
    sim.warp(RESPAWN.delaySeconds + 0.5);
    expect(sim.over).toBe(false);
    expect(sim.respawns).toBe(0);
    fell(sim, 1);
    sim.warp(0.1);
    expect(sim.over).toBe(true);
    expect(sim.overWhy).toBe('crew');
  });

  it('stops the clock where it ended, and announces once', () => {
    const sim = crew(1);
    sim.setRespawns(0);
    fell(sim, 1);
    sim.warp(0.1);
    eventsOf(sim);
    const tick = sim.tick;
    sim.warp(5);
    sim.warp(CYCLE_SECONDS);
    expect(sim.tick).toBe(tick);
    expect(eventsOf(sim)).toEqual([]);
    expect(sim.hurtCore(500)).toBe(false);
  });

  it('is the Core’s fall when that happens first, and the run reports that instead', () => {
    const sim = crew(1);
    sim.setRespawns(0);
    expect(sim.hurtCore(100000)).toBe(true);
    expect(sim.overWhy).toBe('core');
    fell(sim, 1);
    sim.warp(1);
    expect(sim.overWhy).toBe('core');
    expect(eventsOf(sim)).toEqual([{ k: 'overrun', n: 1, why: 'core' }]);
  });

  it('leaves the Core standing', () => {
    const sim = crew(1);
    sim.setRespawns(0);
    fell(sim, 1);
    sim.warp(0.1);
    expect(sim.coreHealth).toBeGreaterThan(0);
    expect(readRun(sim).coreHealth).toBe(readRun(sim).coreMax);
  });

  it('does not end a run with nobody in it', () => {
    const sim = new SurvivalSim();
    sim.warp(5);
    expect(sim.over).toBe(false);
  });
});
