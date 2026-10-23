import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '../../src/shared/movement';
import { SIM_HZ } from '../../src/shared/survival-state';
import { createVitalsReading } from '../../src/shared/vitals-state';
import { VITALS } from '../../src/systems/survival/balance';
import { SurvivalSim } from '../../src/systems/survival/sim';
import { CORE_FOOTPRINT, CORE_HEIGHT, outpostFor } from '../../src/world/outpost';

const core = outpostFor(() => 10);

/** Plays this many seconds a second at a time (a call to `advance` plays at most two). */
function run(sim: SurvivalSim, seconds: number): void {
  for (let i = 0; i < seconds; i++) sim.advance(1);
}

describe('the players in the survival simulation', () => {
  it('keeps the meters of the players it was told about, full to begin with', () => {
    const sim = new SurvivalSim();
    sim.addPlayer(0);
    sim.addPlayer(3);
    expect(sim.readVitals(0, createVitalsReading())).toMatchObject({
      health: VITALS.maxHealth,
      energy: VITALS.maxEnergy,
    });
    expect(sim.readVitals(3, createVitalsReading())).not.toBeNull();
  });

  it('knows nothing of a player it was not told about', () => {
    const sim = new SurvivalSim();
    const out = createVitalsReading();
    expect(sim.readVitals(9, out)).toBeNull();
    expect(sim.playerVitals(9)).toBeUndefined();
    expect(sim.hurtPlayer(9, 10)).toBe(0);
    // These are no-ops, not errors.
    sim.spendEnergy(9, 10);
    sim.playerBuilt(9);
    sim.observe(9, 0, 0, 0, 0, true);
    sim.removePlayer(9);
  });

  it('leaves a player who is added again as they were', () => {
    const sim = new SurvivalSim();
    sim.addPlayer(1);
    sim.hurtPlayer(1, 30);
    sim.addPlayer(1);
    expect(sim.readVitals(1, createVitalsReading())?.health).toBe(70);
  });

  it('forgets a player who leaves', () => {
    const sim = new SurvivalSim();
    sim.addPlayer(1);
    sim.removePlayer(1);
    expect(sim.readVitals(1, createVitalsReading())).toBeNull();
  });

  it('wounds one player and not the others', () => {
    const sim = new SurvivalSim();
    sim.addPlayer(1);
    sim.addPlayer(2);
    expect(sim.hurtPlayer(2, 25)).toBe(25);
    const out = createVitalsReading();
    expect(sim.readVitals(1, out)?.health).toBe(100);
    expect(sim.readVitals(2, out)?.health).toBe(75);
  });

  it('charges a block placed or broken to the player who did it', () => {
    const sim = new SurvivalSim();
    sim.addPlayer(1);
    sim.addPlayer(2);
    for (let i = 0; i < 40; i++) sim.playerBuilt(1);
    const out = createVitalsReading();
    expect(sim.readVitals(1, out)?.energy).toBe(VITALS.maxEnergy - 40 * VITALS.energy.perEdit);
    expect(sim.readVitals(2, out)?.energy).toBe(VITALS.maxEnergy);
  });

  it('plays the meters with the clock, a step at a time', () => {
    const sim = new SurvivalSim();
    sim.addPlayer(1);
    sim.hurtPlayer(1, 40);
    run(sim, VITALS.regenDelay + 20);
    const out = createVitalsReading();
    // Twenty seconds of mending after the wait.
    expect(sim.readVitals(1, out)?.health).toBeGreaterThan(60 + VITALS.regenPerSecond * 19);
    expect(sim.readVitals(1, out)?.energy).toBeLessThan(VITALS.maxEnergy);
  });

  it('plays the same however the time is cut up', () => {
    const whole = new SurvivalSim();
    const cut = new SurvivalSim();
    for (const sim of [whole, cut]) {
      sim.addPlayer(1);
      sim.hurtPlayer(1, 40);
    }
    run(whole, 30);
    for (let i = 0; i < 30 * SIM_HZ; i++) cut.advance(1 / SIM_HZ);
    const a = whole.readVitals(1, createVitalsReading());
    const b = cut.readVitals(1, createVitalsReading());
    expect(a).toEqual(b);
  });

  it('holds the meters wherever it holds the clock', () => {
    const sim = new SurvivalSim();
    sim.addPlayer(1);
    sim.hurtPlayer(1, 40);
    // Nothing advances it (a lone player's menu, a hidden tab): nothing mends and nothing drains.
    const out = createVitalsReading();
    expect(sim.readVitals(1, out)).toMatchObject({ health: 60, energy: 100 });
  });

  it('takes every step on the way when it warps', () => {
    const sim = new SurvivalSim();
    sim.addPlayer(1);
    sim.hurtPlayer(1, 90);
    sim.warp(VITALS.regenDelay + 10);
    const out = createVitalsReading();
    expect(sim.readVitals(1, out)?.health).toBeGreaterThan(10 + VITALS.regenPerSecond * 9);
  });

  it('counts a player sprinting by what the host last saw of them', () => {
    const sim = new SurvivalSim();
    sim.addPlayer(1);
    sim.addPlayer(2);
    sim.observe(1, 0, 0, 0, MOVEMENT.sprintSpeed, true);
    sim.observe(2, 0, 0, 0, MOVEMENT.walkSpeed, true);
    run(sim, 20);
    const out = createVitalsReading();
    const sprinter = sim.readVitals(1, out)?.energy ?? 0;
    const walker = sim.readVitals(2, out)?.energy ?? 0;
    expect(walker).toBeGreaterThan(sprinter);
  });

  it('charges a player at the Core only when it was told where the Core is', () => {
    const feet = core.baseY + CORE_HEIGHT / 2 - 0.9;
    const near = (sim: SurvivalSim): void => {
      sim.addPlayer(1);
      sim.playerVitals(1)?.set({ energy: 20 });
      sim.observe(1, core.x + CORE_FOOTPRINT / 2 + 2, feet, core.z, 0, true);
      run(sim, 2);
    };
    const withCore = new SurvivalSim({ core });
    const without = new SurvivalSim();
    near(withCore);
    near(without);
    const out = createVitalsReading();
    expect(withCore.readVitals(1, out)).toMatchObject({ charging: true });
    expect(withCore.readVitals(1, out)?.energy).toBeGreaterThan(20);
    expect(without.readVitals(1, out)).toMatchObject({ charging: false });
    expect(without.readVitals(1, out)?.energy).toBeLessThanOrEqual(20);
  });

  it('stops playing the meters once the Core has fallen', () => {
    const sim = new SurvivalSim();
    sim.addPlayer(1);
    sim.hurtPlayer(1, 40);
    sim.hurtCore(100000);
    expect(sim.over).toBe(true);
    run(sim, 60);
    sim.warp(60);
    expect(sim.readVitals(1, createVitalsReading())).toMatchObject({ health: 60, energy: 100 });
  });
});
