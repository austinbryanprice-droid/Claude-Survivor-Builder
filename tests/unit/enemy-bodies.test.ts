import { describe, expect, it } from 'vitest';
import { MATERIAL, MATERIALS } from '../../src/shared/blocks';
import { ENEMY_KIND, ENEMY_KIND_COUNT } from '../../src/shared/enemy-state';
import {
  ENEMIES,
  SURVIVAL,
  VITALS,
  WAVES,
  bodyOf,
  hitboxOf,
} from '../../src/systems/survival/balance';

describe('the bodies of the machines', () => {
  it('are one for each kind the wire admits, and none for a kind it does not', () => {
    expect(Object.values(ENEMY_KIND).sort()).toEqual([...Array(ENEMY_KIND_COUNT).keys()]);
    for (let kind = 0; kind < ENEMY_KIND_COUNT; kind++) expect(bodyOf(kind)).toBeDefined();
    for (const kind of [ENEMY_KIND_COUNT, 7, 255, -1, 0.5, NaN])
      expect(bodyOf(kind)).toBeUndefined();
    expect(bodyOf(ENEMY_KIND.crawler)).toBe(ENEMIES.crawler);
    expect(bodyOf(ENEMY_KIND.armored)).toBe(ENEMIES.armored);
    expect(bodyOf(ENEMY_KIND.flyer)).toBe(ENEMIES.flyer);
    expect(bodyOf(ENEMY_KIND.breacher)).toBe(ENEMIES.breacher);
  });

  it('give the targets a bolt is aimed at, and none for a kind with no body', () => {
    expect(hitboxOf(ENEMY_KIND.crawler)).toEqual(ENEMIES.crawler.hitbox);
    expect(hitboxOf(ENEMY_KIND.armored)).toEqual(ENEMIES.armored.hitbox);
    expect(hitboxOf(ENEMY_KIND.flyer)).toEqual(ENEMIES.flyer.hitbox);
    expect(hitboxOf(ENEMY_KIND.breacher)).toEqual(ENEMIES.breacher.hitbox);
    expect(hitboxOf(ENEMY_KIND_COUNT)).toBeUndefined();
    expect(hitboxOf(-1)).toBeUndefined();
    // A target the body stands in, with its legs counted: wider and taller than the body itself.
    for (const kind of Object.values(ENEMY_KIND)) {
      const body = bodyOf(kind)!;
      expect(body.hitbox.halfWidth).toBeGreaterThan(body.radius);
      expect(body.hitbox.height).toBeGreaterThan(body.height);
    }
  });

  it('make the armored crawler the crawler’s heavier cousin', () => {
    const { crawler, armored } = ENEMIES;
    expect(armored.health).toBeGreaterThan(crawler.health);
    expect(armored.speed).toBeLessThan(crawler.speed);
    expect(armored.turnRate).toBeLessThan(crawler.turnRate);
    expect(armored.radius).toBeGreaterThan(crawler.radius);
    expect(armored.bite.player).toBeGreaterThan(crawler.bite.player);
    expect(armored.bite.core).toBeGreaterThan(crawler.bite.core);
    // Plated: a hit takes only a part of its points off. Plain steel takes all of them.
    expect(crawler.takes).toBe(1);
    expect(armored.takes).toBeGreaterThan(0);
    expect(armored.takes).toBeLessThan(1);
    // It is slower than a player on foot, or no one could get away from it.
    expect(armored.speed).toBeLessThan(4.4);
    // It still climbs what a crawler climbs: the same map serves both.
    expect(armored.step).toBe(crawler.step);
  });

  it('make the skimmer small, quick and fragile, and the only one that flies', () => {
    const { crawler, armored, flyer } = ENEMIES;
    expect(flyer.health).toBeLessThan(crawler.health);
    expect(flyer.speed).toBeGreaterThan(crawler.speed);
    // Quick, but a player who runs can still get away from it, as from the others.
    expect(flyer.speed).toBeLessThan(4.4);
    expect(flyer.turnRate).toBeGreaterThan(crawler.turnRate);
    expect(flyer.bite.player).toBeLessThan(armored.bite.player);
    expect(flyer.takes).toBe(1);
    // Nothing but the skimmer flies, and it has a hover and a reach that go together: from its hull a
    // player standing on the ground it hovers over is within the reach of its zap.
    expect(Object.values(ENEMY_KIND).filter((kind) => bodyOf(kind)?.flies)).toEqual([
      ENEMY_KIND.flyer,
    ]);
    const { hover, climb, lookAhead, scan } = flyer.flies;
    expect(flyer.reach.height).toBeGreaterThan(hover);
    // It sees a wall in time to rise: the look-ahead takes it at least a quarter of a second, and it
    // climbs faster than it flies along.
    expect(lookAhead / flyer.speed).toBeGreaterThan(0.25);
    expect(climb).toBeGreaterThan(flyer.speed);
    // It looks higher than any tower a crew builds, and has more than a body's height of air to hover in.
    expect(scan).toBeGreaterThanOrEqual(16);
    expect(hover).toBeGreaterThan(flyer.height);
  });

  it('make the breacher slow and heavy, with no bite, and the only one that goes off', () => {
    const { crawler, armored, breacher } = ENEMIES;
    expect(breacher.health).toBeGreaterThan(armored.health);
    expect(breacher.takes).toBe(1);
    expect(breacher.speed).toBeLessThan(crawler.speed);
    expect(breacher.turnRate).toBeLessThan(crawler.turnRate);
    expect(breacher.radius).toBeGreaterThan(armored.radius);
    // It bites nobody, aims at nobody and chases nobody: the blast is all it does.
    expect(breacher.bite).toEqual({ player: 0, core: 0, windup: 0, interval: 0 });
    expect(breacher.reach.player).toBe(0);
    expect(breacher.aggro).toBe(0);
    // It still climbs what a crawler climbs: the same map serves both.
    expect(breacher.step).toBe(crawler.step);
    // Nothing else goes off, and a goer-off has a charge long enough to see, to shoot at and to run from.
    expect(Object.values(ENEMY_KIND).filter((kind) => bodyOf(kind)?.blast)).toEqual([
      ENEMY_KIND.breacher,
    ]);
    const { windup, ahead, radius, playerRadius, player, core, coreReach } = breacher.blast;
    expect(windup).toBeGreaterThanOrEqual(1);
    expect(ahead).toBeLessThan(breacher.reach.core);
    // The blocks it breaks are within the reach of the people it wounds: the blast is felt where it breaks.
    expect(playerRadius).toBeGreaterThan(radius);
    expect(coreReach).toBeGreaterThan(0);
    // One blast never fells a player at full Health or the Core at full health, and it hurts the Core more.
    expect(player).toBeGreaterThan(0);
    expect(player).toBeLessThan(VITALS.maxHealth);
    expect(core).toBeGreaterThan(player);
    expect(core).toBeLessThan(SURVIVAL.core.maxHealth);
  });

  it('leave Tier 4 cells only for the special machines', () => {
    expect(ENEMIES.crawler.drop).toBeNull();
    expect(ENEMIES.armored.drop).toEqual({ material: MATERIAL.energy, amount: expect.any(Number) });
    expect(ENEMIES.armored.drop!.amount).toBeGreaterThan(0);
    expect(Number.isInteger(ENEMIES.armored.drop!.amount)).toBe(true);
    // The skimmer leaves less than the armored crawler: it is the lighter machine.
    expect(ENEMIES.flyer.drop).toEqual({ material: MATERIAL.energy, amount: expect.any(Number) });
    expect(Number.isInteger(ENEMIES.flyer.drop!.amount)).toBe(true);
    expect(ENEMIES.flyer.drop!.amount).toBeGreaterThan(0);
    expect(ENEMIES.flyer.drop!.amount).toBeLessThan(ENEMIES.armored.drop!.amount);
    // The breacher leaves the most of any: felling it before it goes off is the whole reward.
    expect(ENEMIES.breacher.drop).toEqual({
      material: MATERIAL.energy,
      amount: expect.any(Number),
    });
    expect(Number.isInteger(ENEMIES.breacher.drop!.amount)).toBe(true);
    expect(ENEMIES.breacher.drop!.amount).toBeGreaterThan(ENEMIES.armored.drop!.amount);
    for (const kind of Object.values(ENEMY_KIND)) {
      const drop = bodyOf(kind)!.drop;
      if (drop) expect(MATERIALS.map((material) => material.id)).toContain(drop.material);
    }
  });

  it('chew tougher blocks for longer, and know every block they can meet', () => {
    for (const kind of Object.values(ENEMY_KIND)) {
      const { gnawSeconds, gnawDefault } = bodyOf(kind)!;
      const times = MATERIALS.map((material) => gnawSeconds[material.id]);
      expect(times.every((seconds) => typeof seconds === 'number' && seconds > 0)).toBe(true);
      expect(times).toEqual([...times].sort((a, b) => (a as number) - (b as number)));
      expect(gnawDefault).toBeGreaterThan(0);
    }
  });
});

describe('the bodies the waves send', () => {
  it('are named for every kind a night can hold', () => {
    const named = new Set(Object.keys(WAVES.kinds));
    expect(named.has('crawler')).toBe(true);
    for (const special of WAVES.specials) expect(named.has(special.kind)).toBe(true);
  });

  it('are bodies the table knows, and not the health of a machine of nothing', () => {
    for (const { body, health } of Object.values(WAVES.kinds)) {
      expect(bodyOf(body)).toBeDefined();
      expect(health).toBeGreaterThan(0);
    }
  });

  it('give every kind of the plan a body of its own', () => {
    expect(WAVES.kinds.crawler.body).toBe(ENEMY_KIND.crawler);
    expect(WAVES.kinds.armored.body).toBe(ENEMY_KIND.armored);
    expect(WAVES.kinds.flyer.body).toBe(ENEMY_KIND.flyer);
    expect(WAVES.kinds.breacher.body).toBe(ENEMY_KIND.breacher);
  });
});
