import { describe, expect, it } from 'vitest';
import { MOVEMENT, PLAYER } from '../../src/shared/movement';
import { createVitalsReading } from '../../src/shared/vitals-state';
import { BLASTER, RESPAWN, VITALS } from '../../src/systems/survival/balance';
import { PlayerVitals, handScaleFor, speedScaleFor } from '../../src/systems/survival/vitals';
import { CORE_FOOTPRINT, CORE_HEIGHT, outpostFor, type Outpost } from '../../src/world/outpost';

const STEP = 0.05;

/** Plays this many seconds in steps of the simulation's size. */
function play(vitals: PlayerVitals, seconds: number, core: Outpost | null = null): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) vitals.step(STEP, core);
}

const core = outpostFor(() => 10);

/** Puts a player `gap` blocks from the Core's wall, level with the middle of it, standing still. */
function standAt(vitals: PlayerVitals, gap: number): void {
  const feet = core.baseY + CORE_HEIGHT / 2 - PLAYER.height / 2;
  vitals.observe(core.x + CORE_FOOTPRINT / 2 + gap, feet, core.z, 0, true);
}

describe('what low Energy does to speed and hands', () => {
  it('does nothing until Energy is below the low mark', () => {
    for (const fraction of [1, 0.9, 0.5, VITALS.energy.lowAt]) {
      expect(speedScaleFor(fraction)).toBe(1);
      expect(handScaleFor(fraction)).toBe(1);
    }
  });

  it('slows to the empty values with nothing left, and never past them', () => {
    expect(speedScaleFor(0)).toBeCloseTo(VITALS.energy.emptySpeed, 10);
    expect(handScaleFor(0)).toBeCloseTo(VITALS.energy.emptyHands, 10);
    expect(speedScaleFor(-0.5)).toBeCloseTo(VITALS.energy.emptySpeed, 10);
    expect(handScaleFor(-0.5)).toBeCloseTo(VITALS.energy.emptyHands, 10);
  });

  it('slows steadily between the low mark and empty, with no jump at the mark', () => {
    let speed = 1;
    let hands = 1;
    for (let fraction = VITALS.energy.lowAt; fraction >= 0; fraction -= 0.01) {
      const nextSpeed = speedScaleFor(fraction);
      const nextHands = handScaleFor(fraction);
      expect(nextSpeed).toBeLessThanOrEqual(speed + 1e-12);
      expect(nextHands).toBeLessThanOrEqual(hands + 1e-12);
      expect(speed - nextSpeed).toBeLessThan(0.02);
      speed = nextSpeed;
      hands = nextHands;
    }
  });
});

describe('a player on the host', () => {
  it('starts with full Health and Energy and nothing slowing them', () => {
    const vitals = new PlayerVitals();
    expect(vitals.health).toBe(VITALS.maxHealth);
    expect(vitals.energy).toBe(VITALS.maxEnergy);
    expect(vitals.charging).toBe(false);
    expect(vitals.read(createVitalsReading())).toEqual({
      health: VITALS.maxHealth,
      healthMax: VITALS.maxHealth,
      energy: VITALS.maxEnergy,
      energyMax: VITALS.maxEnergy,
      speedScale: 1,
      handScale: 1,
      charging: false,
      returnIn: 0,
      shaken: 0,
    });
  });

  it('reads whole points, and zero only when a bar is truly empty', () => {
    const vitals = new PlayerVitals();
    vitals.hurt(0.4);
    expect(vitals.health).toBe(VITALS.maxHealth);
    vitals.hurt(99);
    expect(vitals.health).toBe(1);
    // Six tenths of a point are left, then one tenth: still a point on the bar until it is truly gone.
    vitals.hurt(0.5);
    expect(vitals.health).toBe(1);
    vitals.hurt(0.5);
    expect(vitals.health).toBe(0);
  });

  describe('wounds', () => {
    it('takes the points and says how many it took', () => {
      const vitals = new PlayerVitals();
      expect(vitals.hurt(30)).toBe(30);
      expect(vitals.health).toBe(70);
    });

    it('cannot take more than is left, and nothing from the fallen', () => {
      const vitals = new PlayerVitals();
      vitals.hurt(60);
      expect(vitals.hurt(100)).toBe(40);
      expect(vitals.health).toBe(0);
      expect(vitals.hurt(10)).toBe(0);
      expect(vitals.health).toBe(0);
    });

    it('ignores a blow that is not a positive number', () => {
      const vitals = new PlayerVitals();
      for (const blow of [0, -5, Number.NaN, Number.NEGATIVE_INFINITY]) {
        expect(vitals.hurt(blow)).toBe(0);
      }
      expect(vitals.health).toBe(VITALS.maxHealth);
    });
  });

  describe('mending', () => {
    it('waits for the quiet to pass before Health comes back', () => {
      const vitals = new PlayerVitals();
      vitals.hurt(50);
      play(vitals, VITALS.regenDelay - 0.5);
      expect(vitals.health).toBe(50);
    });

    it('then mends at its own pace, up to full and no further', () => {
      const vitals = new PlayerVitals();
      vitals.hurt(50);
      play(vitals, VITALS.regenDelay + 10);
      // Ten seconds of mending, give or take the step that crosses the delay.
      expect(vitals.health).toBeGreaterThanOrEqual(50 + VITALS.regenPerSecond * 9.8);
      expect(vitals.health).toBeLessThanOrEqual(50 + VITALS.regenPerSecond * 10.2 + 1);
      play(vitals, 120);
      expect(vitals.health).toBe(VITALS.maxHealth);
    });

    it('starts the wait again with every wound', () => {
      const vitals = new PlayerVitals();
      vitals.hurt(50);
      play(vitals, VITALS.regenDelay - 1);
      vitals.hurt(10);
      play(vitals, VITALS.regenDelay - 1);
      expect(vitals.health).toBe(40);
    });

    it('does not happen with no Energy left', () => {
      const vitals = new PlayerVitals();
      vitals.set({ energy: 0 });
      vitals.hurt(50);
      play(vitals, 60);
      expect(vitals.health).toBe(50);
      vitals.set({ energy: 20 });
      play(vitals, 20);
      expect(vitals.health).toBeGreaterThan(50);
    });

    it('does not bring back the fallen', () => {
      const vitals = new PlayerVitals();
      vitals.hurt(500);
      play(vitals, 60);
      expect(vitals.health).toBe(0);
    });
  });

  describe('Energy', () => {
    it('drains slowly just for being alive', () => {
      const vitals = new PlayerVitals();
      play(vitals, 100);
      expect(vitals.energy).toBeGreaterThanOrEqual(
        VITALS.maxEnergy - VITALS.energy.idlePerSecond * 100 - 1,
      );
      expect(vitals.energy).toBeLessThan(VITALS.maxEnergy);
    });

    it('drains faster while sprinting on the ground', () => {
      const walker = new PlayerVitals();
      const sprinter = new PlayerVitals();
      walker.observe(0, 0, 0, MOVEMENT.walkSpeed, true);
      sprinter.observe(0, 0, 0, MOVEMENT.sprintSpeed, true);
      play(walker, 10);
      play(sprinter, 10);
      const sprinting = VITALS.energy.idlePerSecond + VITALS.energy.sprintPerSecond;
      expect(sprinter.energy).toBeLessThanOrEqual(
        Math.ceil(VITALS.maxEnergy - sprinting * 10 + 0.5),
      );
      expect(sprinter.energy).toBeGreaterThanOrEqual(Math.floor(VITALS.maxEnergy - sprinting * 10));
      expect(walker.energy).toBeGreaterThan(sprinter.energy + 3);
    });

    it('does not count a jump or a fall as sprinting, nor a player the host has not seen yet', () => {
      const jumper = new PlayerVitals();
      jumper.observe(0, 5, 0, MOVEMENT.sprintSpeed, false);
      const unseen = new PlayerVitals();
      play(jumper, 10);
      play(unseen, 10);
      expect(jumper.energy).toBe(unseen.energy);
    });

    it('counts walking at the slowed pace as walking, not as sprinting', () => {
      const vitals = new PlayerVitals();
      vitals.set({ energy: 10 });
      vitals.observe(0, 0, 0, MOVEMENT.walkSpeed * speedScaleFor(0.1), true);
      play(vitals, 10);
      // Only the idle drain: 0.8 of a point in ten seconds.
      expect(vitals.energy).toBeGreaterThanOrEqual(9);
    });

    it('drains faster for a few seconds after a wound, then goes back to the slow drain', () => {
      const wounded = new PlayerVitals();
      const calm = new PlayerVitals();
      wounded.hurt(1);
      play(wounded, VITALS.energy.combatSeconds);
      play(calm, VITALS.energy.combatSeconds);
      const cost = VITALS.energy.combatPerSecond * VITALS.energy.combatSeconds;
      expect(calm.energy - wounded.energy).toBeGreaterThanOrEqual(Math.floor(cost) - 1);
      expect(calm.energy - wounded.energy).toBeLessThanOrEqual(Math.ceil(cost) + 1);
      const gap = calm.energy - wounded.energy;
      play(wounded, 60);
      play(calm, 60);
      expect(Math.abs(calm.energy - wounded.energy - gap)).toBeLessThanOrEqual(1);
    });

    it('is spent on what the player does, down to nothing and no further', () => {
      const vitals = new PlayerVitals();
      vitals.spend(30);
      expect(vitals.energy).toBe(70);
      vitals.spend(1000);
      expect(vitals.energy).toBe(0);
    });

    it('ignores a cost that is not a positive number', () => {
      const vitals = new PlayerVitals();
      for (const cost of [0, -5, Number.NaN]) vitals.spend(cost);
      expect(vitals.energy).toBe(VITALS.maxEnergy);
    });

    it('slows the player and their hands once it is low', () => {
      const vitals = new PlayerVitals();
      vitals.set({ energy: 0 });
      const reading = vitals.read(createVitalsReading());
      expect(reading.speedScale).toBeCloseTo(VITALS.energy.emptySpeed, 10);
      expect(reading.handScale).toBeCloseTo(VITALS.energy.emptyHands, 10);
      vitals.set({ energy: 60 });
      expect(vitals.read(createVitalsReading()).speedScale).toBe(1);
    });
  });

  describe("the Core's charge field", () => {
    it('restores Energy to a player inside it, and says so', () => {
      const vitals = new PlayerVitals();
      vitals.set({ energy: 10 });
      standAt(vitals, VITALS.chargeField.radius - 3);
      play(vitals, 4, core);
      expect(vitals.charging).toBe(true);
      expect(vitals.energy).toBeGreaterThan(10 + VITALS.chargeField.perSecond * 4 - 2);
    });

    it('stops at the edge of the field and not before it', () => {
      const inside = new PlayerVitals();
      const outside = new PlayerVitals();
      inside.set({ energy: 10 });
      outside.set({ energy: 10 });
      standAt(inside, VITALS.chargeField.radius - 0.01);
      standAt(outside, VITALS.chargeField.radius + 0.5);
      play(inside, 2, core);
      play(outside, 2, core);
      expect(inside.charging).toBe(true);
      expect(outside.charging).toBe(false);
      expect(inside.energy).toBeGreaterThan(10);
      expect(outside.energy).toBeLessThanOrEqual(10);
    });

    it('never fills a bar past full', () => {
      const vitals = new PlayerVitals();
      standAt(vitals, 1);
      play(vitals, 30, core);
      expect(vitals.energy).toBe(VITALS.maxEnergy);
      expect(vitals.charging).toBe(true);
    });

    it('is not there where there is no Core, or before the host has seen the player', () => {
      const away = new PlayerVitals();
      away.set({ energy: 10 });
      standAt(away, 1);
      play(away, 4, null);
      expect(away.charging).toBe(false);
      expect(away.energy).toBeLessThanOrEqual(10);

      const unseen = new PlayerVitals();
      unseen.set({ energy: 10 });
      play(unseen, 4, core);
      expect(unseen.charging).toBe(false);
    });

    it('lets the player leave it and drain again', () => {
      const vitals = new PlayerVitals();
      vitals.set({ energy: 50 });
      standAt(vitals, 2);
      play(vitals, 1, core);
      expect(vitals.charging).toBe(true);
      standAt(vitals, 30);
      play(vitals, 1, core);
      expect(vitals.charging).toBe(false);
    });
  });

  describe('setting the meters outright', () => {
    it('keeps them between nothing and full, and leaves the one it is not told about', () => {
      const vitals = new PlayerVitals();
      vitals.set({ health: 500, energy: -3 });
      expect(vitals.health).toBe(VITALS.maxHealth);
      expect(vitals.energy).toBe(0);
      vitals.set({ health: 40 });
      expect(vitals.health).toBe(40);
      expect(vitals.energy).toBe(0);
    });
  });
  describe('going down', () => {
    it('counts the seconds a player has lain down from the blow that felled them, and is -1 while they are up', () => {
      const vitals = new PlayerVitals();
      expect(vitals.downSeconds).toBe(-1);
      vitals.hurt(60);
      expect(vitals.downSeconds).toBe(-1);
      vitals.hurt(40);
      expect(vitals.alive).toBe(false);
      expect(vitals.downSeconds).toBe(0);
      play(vitals, 2.5);
      expect(vitals.downSeconds).toBeCloseTo(2.5, 6);
    });

    it('lets nothing else change while they lie there: no draining, no mending, no field', () => {
      const vitals = new PlayerVitals();
      vitals.set({ energy: 40 });
      vitals.hurt(100);
      standAt(vitals, 1);
      play(vitals, 30, core);
      expect(vitals.health).toBe(0);
      expect(vitals.energy).toBe(40);
      expect(vitals.charging).toBe(false);
    });

    it('is set by hand too: Health put to nothing lays a player down, and any Health stands them up', () => {
      const vitals = new PlayerVitals();
      vitals.set({ health: 0 });
      expect(vitals.downSeconds).toBe(0);
      play(vitals, 1);
      vitals.set({ health: 0 });
      expect(vitals.downSeconds).toBeCloseTo(1, 6);
      vitals.set({ health: 25 });
      expect(vitals.downSeconds).toBe(-1);
      expect(vitals.alive).toBe(true);
    });
  });

  describe('coming back', () => {
    function fallen(): PlayerVitals {
      const vitals = new PlayerVitals();
      vitals.hurt(500);
      play(vitals, 3);
      return vitals;
    }

    it('brings Health back full and a part of the Energy bar, with the blaster ready', () => {
      const vitals = fallen();
      vitals.set({ energy: 3 });
      vitals.revive();
      expect(vitals.alive).toBe(true);
      expect(vitals.health).toBe(VITALS.maxHealth);
      expect(vitals.energy).toBe(VITALS.maxEnergy * RESPAWN.energy);
      expect(vitals.downSeconds).toBe(-1);
      for (let i = 0; i < BLASTER.burst; i++) expect(vitals.takeShot()).toBe(true);
    });

    it('leaves them shaken for the table’s seconds, counted down in whole seconds', () => {
      const vitals = fallen();
      expect(vitals.shaken).toBe(0);
      vitals.revive();
      expect(vitals.shaken).toBe(RESPAWN.shaken.seconds);
      play(vitals, 0.5);
      expect(vitals.shaken).toBe(RESPAWN.shaken.seconds);
      play(vitals, 0.55);
      expect(vitals.shaken).toBe(RESPAWN.shaken.seconds - 1);
      play(vitals, RESPAWN.shaken.seconds);
      expect(vitals.shaken).toBe(0);
      expect(vitals.read(createVitalsReading()).shaken).toBe(0);
    });

    it('reads the seconds left in their meters', () => {
      const vitals = fallen();
      vitals.revive();
      play(vitals, 10);
      expect(vitals.read(createVitalsReading()).shaken).toBe(RESPAWN.shaken.seconds - 10);
      expect(vitals.read(createVitalsReading()).returnIn).toBe(0);
    });

    it('drains Energy faster while shaken, and at the usual rate after', () => {
      /** Sprints for this long from a full bar and says how much it cost. */
      const cost = (vitals: PlayerVitals, seconds: number): number => {
        vitals.set({ energy: VITALS.maxEnergy });
        vitals.observe(0, 0, 0, MOVEMENT.sprintSpeed, true);
        play(vitals, seconds);
        return VITALS.maxEnergy - vitals.energy;
      };
      const rate = VITALS.energy.idlePerSecond + VITALS.energy.sprintPerSecond;

      const shaken = fallen();
      shaken.revive();
      const steady = new PlayerVitals();
      const lostShaken = cost(shaken, 10);
      const lostSteady = cost(steady, 10);
      expect(lostShaken).toBeGreaterThanOrEqual(Math.floor(rate * RESPAWN.shaken.drainScale * 10));
      expect(lostSteady).toBeLessThanOrEqual(Math.ceil(rate * 10));
      expect(lostShaken).toBeGreaterThan(lostSteady + 2);

      // Once the spell is over the same sprint costs what it does for anyone.
      play(shaken, RESPAWN.shaken.seconds);
      expect(shaken.shaken).toBe(0);
      expect(cost(shaken, 10)).toBe(lostSteady);
    });

    it('hits softer while shaken, and at full strength after', () => {
      const vitals = fallen();
      expect(vitals.damageScale).toBe(1);
      vitals.revive();
      expect(vitals.damageScale).toBe(RESPAWN.shaken.damageScale);
      play(vitals, RESPAWN.shaken.seconds + 1);
      expect(vitals.damageScale).toBe(1);
    });

    it('forgets being shaken when they go down again, and reads none while they lie there', () => {
      const vitals = fallen();
      vitals.revive();
      play(vitals, 5);
      expect(vitals.shaken).toBe(RESPAWN.shaken.seconds - 5);
      vitals.hurt(500);
      expect(vitals.shaken).toBe(0);
      expect(vitals.damageScale).toBe(1);
      expect(vitals.read(createVitalsReading()).shaken).toBe(0);

      // Put on its feet by hand and laid down by hand, it is the same.
      const another = fallen();
      another.revive();
      another.set({ health: 0 });
      expect(another.shaken).toBe(0);
    });

    it('can be shaken again by going down again', () => {
      const vitals = fallen();
      vitals.revive();
      play(vitals, RESPAWN.shaken.seconds + 1);
      vitals.hurt(500);
      play(vitals, 3);
      vitals.revive();
      expect(vitals.shaken).toBe(RESPAWN.shaken.seconds);
    });
  });
});
