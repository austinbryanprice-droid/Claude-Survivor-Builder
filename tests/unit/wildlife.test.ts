import { describe, expect, it } from 'vitest';
import {
  createWildState,
  WILD_FLAG,
  WILD_SPECIES,
  WILD_SPECIES_COUNT,
} from '../../src/shared/wildlife-state';
import type { Target } from '../../src/systems/survival/enemies';
import { SPECIES, WILDLIFE, speciesOf, type Species } from '../../src/systems/wildlife/balance';
import { Threats, WildlifeSim, type WildStrikes } from '../../src/systems/wildlife/sim';
import { valleyNavigation } from '../../src/systems/survival/valley-nav';
import { createWorld } from '../../src/world/voxels/world';
import { flatWorld } from './helpers/nav-world';
import { TEST_SEED, terrain } from './helpers/valley';

const DT = 0.05;

/** Land at the given height for x up to 60, then a lake three blocks deep. */
function lake(land = 10) {
  return flatWorld({ height: (x) => (x > 60 ? 4 : land), waterLevel: 7 });
}

/** The player who strikes at nothing: the sim never wounds anyone until a player has hurt one of them. */
function recorder(): WildStrikes & { hits: [number, number][] } {
  const hits: [number, number][] = [];
  return {
    hits,
    hurtPlayer: (id, amount) => {
      hits.push([id, amount]);
      return amount;
    },
  };
}

function player(id: number, x: number, z: number, y = 10): Target {
  return { id, x, y, z };
}

interface Scene {
  targets?: Target[];
  threats?: Threats;
  strikes?: ReturnType<typeof recorder>;
}

/** Plays `seconds` of the valley in fixed steps. */
function play(sim: WildlifeSim, seconds: number, scene: Scene = {}): ReturnType<typeof recorder> {
  const strikes = scene.strikes ?? recorder();
  const targets = scene.targets ?? [];
  const threats = scene.threats ?? new Threats();
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    sim.step(DT, targets, targets.length, threats, strikes);
  }
  return strikes;
}

function whereIs(sim: WildlifeSim, id: number): { x: number; y: number; z: number } {
  let found = { x: NaN, y: NaN, z: NaN };
  sim.forEach((other, _species, x, y, z) => {
    if (other === id) found = { x, y, z };
  });
  return found;
}

function stateOf(sim: WildlifeSim, id: number) {
  const out = Array.from({ length: WILDLIFE.maxAlive }, createWildState);
  const count = sim.write(out);
  return out.slice(0, count).find((s) => s.id === id);
}

function newSim(world: ReturnType<typeof flatWorld>, populate = false, seed = 7): WildlifeSim {
  return new WildlifeSim(world.world, { core: world.core, seed, populate });
}

describe('the species table', () => {
  it('has one row for every species, in the order of the numbers that travel', () => {
    expect(SPECIES).toHaveLength(WILD_SPECIES_COUNT);
    for (const [name, number] of Object.entries(WILD_SPECIES)) {
      expect(speciesOf(number)?.name).toBe(name);
    }
    expect(speciesOf(WILD_SPECIES_COUNT)).toBeUndefined();
    expect(speciesOf(-1)).toBeUndefined();
  });

  it('spreads the species over the three realms', () => {
    const realms = new Set(SPECIES.map((s) => s.realm));
    expect([...realms].sort()).toEqual(['air', 'land', 'water']);
    for (const realm of realms) {
      expect(SPECIES.filter((s) => s.realm === realm).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('lets only the defiant species hit back, and mildly', () => {
    const defiant = SPECIES.filter((s) => s.retaliation).map((s) => s.name);
    expect(defiant).toEqual(['stag', 'mossback', 'ray', 'kite']);
    for (const species of SPECIES) {
      const blow = species.retaliation;
      if (!blow) continue;
      // A crawler bites for 6 a second; nothing here comes close to a fast, hard blow.
      expect(blow.player).toBeLessThanOrEqual(10);
      expect(blow.interval).toBeGreaterThanOrEqual(1.5);
      expect(blow.windup).toBeGreaterThanOrEqual(0.4);
      expect(blow.strikes * blow.player).toBeLessThan(40);
      expect(blow.calm).toBeGreaterThan(blow.interval);
    }
  });

  it('fits the population under the cap', () => {
    const most = SPECIES.reduce((sum, s) => sum + s.herds * s.size[1], 0);
    expect(most).toBeLessThanOrEqual(WILDLIFE.maxAlive);
    // The blaster takes 10 points a shot: a bird or a fish is one shot, a hare two, and nothing needs more than a dozen.
    for (const species of SPECIES) {
      expect(species.health).toBeGreaterThan(0);
      expect(species.health).toBeLessThanOrEqual(120);
    }
  });

  it('gives every species what it needs to live where its realm says', () => {
    for (const s of SPECIES as readonly Species[]) {
      if (s.realm === 'water') {
        expect(s.depth).toBeGreaterThan(0);
        expect(s.level).toBeDefined();
        // Its body hangs under the surface and clear of the bed.
        expect((s.level as readonly number[])[1]! + s.hitbox.height).toBeLessThanOrEqual(s.depth!);
      }
      if (s.realm === 'air') expect(s.orbit).toBeGreaterThan(0);
      if (s.realm === 'land') expect(s.above).toBeDefined();
    }
  });
});

describe('the valley they are put in', () => {
  const valley = terrain();
  const voxels = createWorld(TEST_SEED, valley);
  const world = valleyNavigation({ terrain: valley, voxels });
  const core = voxels.outpost as NonNullable<typeof voxels.outpost>;

  it('holds the herds of every species, within the cap, all of them where their kind lives', () => {
    const sim = new WildlifeSim(world, { core, seed: TEST_SEED });
    expect(sim.count).toBeGreaterThan(30);
    expect(sim.count).toBeLessThanOrEqual(WILDLIFE.maxAlive);
    for (let species = 0; species < WILD_SPECIES_COUNT; species++) {
      const body = SPECIES[species] as Species;
      expect(sim.countOf(species), body.name).toBeGreaterThanOrEqual(body.herds * body.size[0]);
      expect(sim.countOf(species), body.name).toBeLessThanOrEqual(body.herds * body.size[1]);
    }
    sim.forEach((_id, species, x, y, z) => {
      const body = SPECIES[species] as Species;
      const ground = world.surfaceAt(x, z);
      // They come in a bunch round a spot that suits them; the bunch is a few blocks wide.
      expect(Math.hypot(x - core.x, z - core.z), body.name).toBeGreaterThan(WILDLIFE.avoid - 4);
      if (body.realm === 'land') {
        expect(y).toBeCloseTo(ground, 5);
        expect(ground - world.waterLevel).toBeGreaterThanOrEqual(WILDLIFE.shore);
      } else if (body.realm === 'water') {
        expect(world.waterLevel - ground).toBeGreaterThanOrEqual(body.depth!);
        expect(y + body.hitbox.height, body.name).toBeLessThan(world.waterLevel);
        expect(y, body.name).toBeGreaterThan(ground);
      } else {
        expect(y - ground, body.name).toBeGreaterThanOrEqual(body.level![0] - 0.01);
      }
    });
  });

  it('is the same valley for the same seed, and a different one for another', () => {
    const a = new WildlifeSim(world, { core, seed: 11 });
    const b = new WildlifeSim(world, { core, seed: 11 });
    const c = new WildlifeSim(world, { core, seed: 12 });
    const read = (sim: WildlifeSim) => {
      const out = Array.from({ length: WILDLIFE.maxAlive }, createWildState);
      const n = sim.write(out);
      return JSON.stringify(out.slice(0, n));
    };
    expect(read(a)).toBe(read(b));
    expect(read(c)).not.toBe(read(a));
    play(a, 30);
    play(b, 30);
    expect(read(a)).toBe(read(b));
  });

  it('roams for a long time without any creature leaving the kind of place it lives in', () => {
    const sim = new WildlifeSim(world, { core, seed: TEST_SEED });
    for (let minute = 0; minute < 3; minute++) {
      play(sim, 60);
      sim.forEach((_id, species, x, y, z) => {
        const body = SPECIES[species] as Species;
        const ground = world.surfaceAt(x, z);
        expect(Math.abs(x)).toBeLessThanOrEqual(world.half);
        expect(Math.abs(z)).toBeLessThanOrEqual(world.half);
        if (body.realm === 'land') {
          expect(ground - world.waterLevel, `${body.name} at ${x},${z}`).toBeGreaterThanOrEqual(
            WILDLIFE.shore - 0.01,
          );
          expect(y).toBeCloseTo(ground, 3);
        } else if (body.realm === 'water') {
          expect(world.waterLevel - ground, `${body.name} at ${x},${z}`).toBeGreaterThanOrEqual(
            (body.depth as number) - 0.01,
          );
          expect(y + body.hitbox.height).toBeLessThan(world.waterLevel + 0.01);
        } else {
          expect(y - ground).toBeGreaterThan(1);
        }
      });
    }
  });

  it('keeps clear of the Core and the clearing round it', () => {
    const sim = new WildlifeSim(world, { core, seed: TEST_SEED });
    let nearest = Infinity;
    for (let t = 0; t < 120; t += 1) {
      play(sim, 1);
      sim.forEach((_id, _species, x, _y, z) => {
        nearest = Math.min(nearest, Math.hypot(x - core.x, z - core.z));
      });
    }
    expect(nearest).toBeGreaterThan(WILDLIFE.avoid * 0.6);
  });
});

describe('going about the day', () => {
  it('moves a grazing herd about, at a walk, and never faster than its species walks', () => {
    const w = lake();
    const sim = newSim(w);
    const first = sim.spawnHerd(WILD_SPECIES.stag, -50, 40, 3);
    expect(first).toBeGreaterThan(0);
    expect(sim.count).toBe(3);
    const start = whereIs(sim, first);
    let farthest = 0;
    let fastest = 0;
    const out = Array.from({ length: WILDLIFE.maxAlive }, createWildState);
    const before = new Map<number, { x: number; z: number }>();
    for (let t = 0; t < 90; t += DT) {
      play(sim, DT);
      const n = sim.write(out);
      for (let i = 0; i < n; i++) {
        const s = out[i]!;
        const was = before.get(s.id);
        if (was) fastest = Math.max(fastest, Math.hypot(s.x - was.x, s.z - was.z) / DT);
        before.set(s.id, { x: s.x, z: s.z });
      }
      const now = whereIs(sim, first);
      farthest = Math.max(farthest, Math.hypot(now.x - start.x, now.z - start.z));
    }
    expect(farthest).toBeGreaterThan(3);
    // At a walk, or the hurry of one that fell behind, and the little the crowd pushes a step.
    expect(fastest).toBeLessThanOrEqual(
      (SPECIES[WILD_SPECIES.stag] as Species).walk * WILDLIFE.hurry + (2 * WILDLIFE.crowdMax) / DT,
    );
  });

  it('keeps a herd together: the members stay within a few spreads of one another', () => {
    const w = lake();
    const sim = newSim(w);
    sim.spawnHerd(WILD_SPECIES.hare, -40, 30, 3);
    const body = SPECIES[WILD_SPECIES.hare] as Species;
    for (let k = 0; k < 6; k++) {
      play(sim, 20);
      const at: { x: number; z: number }[] = [];
      sim.forEach((_id, _species, x, _y, z) => at.push({ x, z }));
      for (const a of at) {
        for (const b of at) {
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(
            body.spread * 2 * WILDLIFE.strayAt + 4,
          );
        }
      }
    }
  });

  it('never goes into the water, or over a cliff', () => {
    const w = flatWorld({
      height: (x, z) => (x > 20 ? 4 : z > 60 ? 13 : 10),
      waterLevel: 7,
    });
    const sim = newSim(w);
    const ids = [
      sim.spawnAt(WILD_SPECIES.hare, 18, 40),
      sim.spawnAt(WILD_SPECIES.stag, 15, 58),
      sim.spawnAt(WILD_SPECIES.mossback, 10, 40),
    ];
    // A threat to the east and to the north drives them toward the water and the cliff.
    const threats = new Threats();
    for (let t = 0; t < 40; t += DT) {
      threats.clear();
      sim.forEach((_id, _species, x, _y, z) => {
        if (_species !== WILD_SPECIES.mossback) threats.add(x - 3, z - 3);
      });
      play(sim, DT, { threats });
      for (const id of ids) {
        const at = whereIs(sim, id);
        expect(at.x).toBeLessThanOrEqual(20.05);
        // The cliff is three blocks high at z = 60: nothing steps up it or off it.
        if (id === ids[1]) expect(at.z).toBeLessThanOrEqual(60.1);
      }
    }
  });

  it('is stopped by a wall the crew built, and steps out of a cell a block was just built in', () => {
    const w = lake();
    for (let x = -90; x <= 10; x++) {
      for (let y = 10; y < 13; y++) w.place(x, y, 36);
    }
    const sim = newSim(w);
    const id = sim.spawnAt(WILD_SPECIES.stag, -40, 40);
    const threats = new Threats();
    // Something frightening sits to the south of the stag, which flees north into the wall.
    for (let t = 0; t < 15; t += DT) {
      threats.clear();
      threats.add(-40, 48);
      play(sim, DT, { threats });
      expect(whereIs(sim, id).z).toBeGreaterThan(36.9);
    }
    // And a block built on top of a creature does not trap it.
    const trapped = sim.spawnAt(WILD_SPECIES.hare, 0, 70);
    const at = whereIs(sim, trapped);
    w.place(Math.floor(at.x), 10, Math.floor(at.z));
    const t2 = new Threats();
    t2.add(at.x, at.z + 6);
    play(sim, 2, { threats: t2 });
    const moved = whereIs(sim, trapped);
    expect(Math.hypot(moved.x - at.x, moved.z - at.z)).toBeGreaterThan(1);
  });
});

describe('fear', () => {
  it('startles a shy creature that a player comes too near, and leaves a bold one alone', () => {
    const w = lake();
    const sim = newSim(w);
    const hare = sim.spawnAt(WILD_SPECIES.hare, 40, 40);
    const moss = sim.spawnAt(WILD_SPECIES.mossback, -40, 40);
    const targets = [player(1, 40, 44), player(2, -40, 43)];
    const strikes = recorder();
    play(sim, 0.5, { targets, strikes });
    expect(stateOf(sim, hare)!.flags & WILD_FLAG.alarmed).toBeTruthy();
    expect(stateOf(sim, moss)!.flags & WILD_FLAG.alarmed).toBeFalsy();
    play(sim, 4, { targets, strikes });
    expect(Math.hypot(whereIs(sim, hare).x - 40, whereIs(sim, hare).z - 44)).toBeGreaterThan(14);
    // It goes about its business at a walk, wherever the player is.
    expect(Math.hypot(whereIs(sim, moss).x + 40, whereIs(sim, moss).z - 40)).toBeLessThan(5);
    expect(strikes.hits).toEqual([]);
  });

  it('runs from the machines that come, but a kite takes no notice of them', () => {
    const w = lake();
    const sim = newSim(w);
    const stag = sim.spawnAt(WILD_SPECIES.stag, 40, 40);
    const kite = sim.spawnAt(WILD_SPECIES.kite, -40, 40);
    const threats = new Threats();
    threats.add(40, 50);
    threats.add(-40, 44);
    const strikes = recorder();
    play(sim, 0.5, { threats, strikes });
    expect(stateOf(sim, stag)!.flags & WILD_FLAG.alarmed).toBeTruthy();
    play(sim, 2.5, { threats, strikes });
    expect(whereIs(sim, stag).z).toBeLessThan(40 - 3);
    expect(stateOf(sim, kite)!.flags & WILD_FLAG.alarmed).toBeFalsy();
    expect(strikes.hits).toEqual([]);
  });

  it('takes the whole herd with it when one is startled', () => {
    const w = lake();
    const sim = newSim(w);
    const first = sim.spawnHerd(WILD_SPECIES.shoal, 80, 0, 6);
    expect(sim.count).toBe(6);
    const threats = new Threats();
    const at = whereIs(sim, first);
    threats.add(at.x - 3, at.z);
    play(sim, 0.2, { threats });
    const out = Array.from({ length: WILDLIFE.maxAlive }, createWildState);
    const n = sim.write(out);
    expect(n).toBe(6);
    // The nearest one was startled by the player's step; the rest go with it.
    sim.step(DT, [player(1, at.x - 2, at.z, 9)], 1, new Threats(), recorder());
    const m = sim.write(out);
    expect(out.slice(0, m).every((s) => (s.flags & WILD_FLAG.alarmed) !== 0)).toBe(true);
  });
});

describe('being hit', () => {
  it('turns a defiant creature on the player who hurt it, for a few mild blows, and then lets it go', () => {
    const w = lake();
    const sim = newSim(w);
    const stag = sim.spawnAt(WILD_SPECIES.stag, 40, 40);
    const body = SPECIES[WILD_SPECIES.stag] as Species;
    const blow = body.retaliation!;
    const targets = [player(1, 40, 46)];
    expect(sim.hurt(stag, 10, 1, 40, 46)).toBe(false);
    const state = stateOf(sim, stag)!;
    expect(state.flags & WILD_FLAG.angry).toBeTruthy();
    expect(state.flags & WILD_FLAG.hurt).toBeTruthy();
    expect(state.health).toBe(Math.round((50 / 60) * 255));
    const strikes = recorder();
    // It is on the player within a second and a half, and the first blow lands after its wind-up.
    play(sim, 1.2, { targets, strikes });
    expect(strikes.hits).toEqual([]);
    expect(Math.hypot(whereIs(sim, stag).x - 40, whereIs(sim, stag).z - 46)).toBeLessThanOrEqual(
      blow.reach,
    );
    let sawWindup = false;
    for (let t = 0; t < 14; t += DT) {
      play(sim, DT, { targets, strikes });
      if (stateOf(sim, stag)!.flags & WILD_FLAG.strike) sawWindup = true;
    }
    expect(sawWindup).toBe(true);
    expect(strikes.hits).toHaveLength(blow.strikes);
    for (const [id, amount] of strikes.hits) {
      expect(id).toBe(1);
      expect(amount).toBe(blow.player);
    }
    // Having had its say it calms down, and a player who stays put is not hit again.
    expect(sim.moodOf(stag)!.anger).toBe(0);
    play(sim, 30, { targets, strikes });
    expect(strikes.hits).toHaveLength(blow.strikes);
  });

  it('spaces the blows by the species interval', () => {
    const w = lake();
    const sim = newSim(w);
    const moss = sim.spawnAt(WILD_SPECIES.mossback, 40, 40);
    const blow = (SPECIES[WILD_SPECIES.mossback] as Species).retaliation!;
    sim.hurt(moss, 10, 1, 40, 41);
    const times: number[] = [];
    const targets = [player(1, 40, 41.5)];
    let landed = 0;
    const strikes: WildStrikes = {
      hurtPlayer: () => {
        times.push(landed);
        return 1;
      },
    };
    for (let t = 0; t < 12; t += DT) {
      landed = t;
      sim.step(DT, targets, 1, new Threats(), strikes);
    }
    expect(times.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(blow.interval - 0.1);
    }
    expect(times[0]!).toBeGreaterThanOrEqual(blow.windup - 0.1);
  });

  it('forgets a player who gets away, or who it cannot reach', () => {
    const w = lake();
    for (let x = -90; x <= 20; x++) {
      for (let y = 10; y < 13; y++) w.place(x, y, 50);
    }
    const sim = newSim(w);
    const far = sim.spawnAt(WILD_SPECIES.stag, 0, 0);
    const walled = sim.spawnAt(WILD_SPECIES.stag, 0, 44);
    sim.hurt(far, 10, 1, 0, 60);
    sim.hurt(walled, 10, 1, 0, 60);
    const strikes = recorder();
    // One player is beyond the stag's patience; the other is behind a wall it cannot get over.
    play(sim, 6, { targets: [player(1, 0, 70)], strikes });
    expect(sim.moodOf(far)!.anger).toBe(0);
    expect(sim.moodOf(walled)!.anger).toBe(0);
    expect(strikes.hits).toEqual([]);
  });

  it('sends a skittish creature running from the player who hurt it, and it never strikes back', () => {
    const w = lake();
    const sim = newSim(w);
    const hare = sim.spawnAt(WILD_SPECIES.hare, 40, 40);
    const targets = [player(1, 40, 41)];
    sim.hurt(hare, 10, 1, 40, 41);
    expect(sim.moodOf(hare)!.anger).toBe(0);
    expect(sim.moodOf(hare)!.fright).toBe((SPECIES[WILD_SPECIES.hare] as Species).fright);
    const strikes = play(sim, 6, { targets });
    expect(strikes.hits).toEqual([]);
    const at = whereIs(sim, hare);
    expect(Math.hypot(at.x - 40, at.z - 41)).toBeGreaterThan(WILDLIFE.attackerRadius - 3);
    // Once its fright is over it settles, and a player who stands still next to it is not struck.
    play(sim, 20, { targets: [player(1, at.x, at.z + 3)], strikes });
    expect(strikes.hits).toEqual([]);
  });

  it('startles the rest of a herd when one is hit, defiant or not', () => {
    const w = lake();
    const sim = newSim(w);
    const first = sim.spawnHerd(WILD_SPECIES.stag, 40, 40, 3);
    sim.hurt(first, 10, 1, 40, 60);
    const out = Array.from({ length: WILDLIFE.maxAlive }, createWildState);
    const n = sim.write(out);
    const flags = out.slice(0, n).map((s) => s.flags);
    expect(flags.filter((f) => (f & WILD_FLAG.angry) !== 0)).toHaveLength(1);
    expect(flags.filter((f) => (f & WILD_FLAG.alarmed) !== 0)).toHaveLength(2);
  });

  it('fells a creature with enough blows, tells the survival simulation, and leaves nothing behind', () => {
    const w = lake();
    const sim = newSim(w);
    const hare = sim.spawnAt(WILD_SPECIES.hare, 40, 40);
    const felled: number[] = [];
    sim.onFelled = (species) => felled.push(species);
    expect(sim.hurt(hare, 10, 1, 40, 41)).toBe(false);
    expect(sim.has(hare)).toBe(true);
    expect(sim.hurt(hare, 10, 1, 40, 41)).toBe(true);
    expect(sim.has(hare)).toBe(false);
    expect(sim.count).toBe(0);
    expect(sim.herdCount).toBe(0);
    expect(felled).toEqual([WILD_SPECIES.hare]);
    // A blow at a creature that is not there does nothing, and neither does one that does no harm.
    expect(sim.hurt(hare, 10, 1, 0, 0)).toBe(false);
    const other = sim.spawnAt(WILD_SPECIES.hare, 40, 40);
    expect(sim.hurt(other, 0, 1, 0, 0)).toBe(false);
    expect(sim.hurt(other, -5, 1, 0, 0)).toBe(false);
  });

  it('brings a thinned-out herd back, away from the players, after a while', () => {
    const w = lake();
    const sim = new WildlifeSim(w.world, { core: w.core, seed: 3 });
    const stags = (SPECIES[WILD_SPECIES.stag] as Species).herds;
    const ids: number[] = [];
    sim.forEach((id, species) => {
      if (species === WILD_SPECIES.stag) ids.push(id);
    });
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) sim.hurt(id, 1000, 1, 0, 0);
    expect(sim.countOf(WILD_SPECIES.stag)).toBe(0);
    const targets = [player(1, 0, 0)];
    // Nothing returns before the top-up is due...
    play(sim, WILDLIFE.topUpSeconds - 2, { targets });
    expect(sim.countOf(WILD_SPECIES.stag)).toBe(0);
    // ...and then a herd at a time, one per pass, until the valley has its stags again.
    play(sim, WILDLIFE.topUpSeconds * stags + 2, { targets });
    expect(sim.countOf(WILD_SPECIES.stag)).toBeGreaterThan(0);
    const body = SPECIES[WILD_SPECIES.stag] as Species;
    sim.forEach((_id, species, x, _y, z) => {
      if (species !== WILD_SPECIES.stag) return;
      expect(Math.hypot(x - 0, z - 0)).toBeGreaterThan(WILDLIFE.unseen * 0.5);
    });
    expect(sim.countOf(WILD_SPECIES.stag)).toBeLessThanOrEqual(body.herds * body.size[1]);
  });
});

describe('the sea and the air', () => {
  it('keeps the swimmers under the surface and off the shore, and the fliers over the ground', () => {
    const w = flatWorld({
      height: (x) => (x > 60 ? 4 : 10 + Math.max(0, -x) * 0.05),
      waterLevel: 7,
    });
    const sim = newSim(w);
    const shoal = sim.spawnHerd(WILD_SPECIES.shoal, 80, 0, 6);
    const ray = sim.spawnAt(WILD_SPECIES.ray, 85, 5);
    const finch = sim.spawnHerd(WILD_SPECIES.finch, -30, 30, 5);
    const kite = sim.spawnAt(WILD_SPECIES.kite, -50, 20);
    expect([shoal, ray, finch, kite].every((id) => id > 0)).toBe(true);
    for (let t = 0; t < 120; t += DT) {
      play(sim, DT);
      sim.forEach((_id, species, x, y, z) => {
        const body = SPECIES[species] as Species;
        const ground = w.world.surfaceAt(x, z);
        if (body.realm === 'water') {
          expect(x, body.name).toBeGreaterThan(60);
          expect(y + body.hitbox.height, body.name).toBeLessThanOrEqual(7.001);
          expect(y, body.name).toBeGreaterThanOrEqual(ground);
        } else if (body.realm === 'air') {
          expect(y - Math.max(ground, 7), body.name).toBeGreaterThan(2);
        }
      });
    }
    // The flock stays a flock: it is still near its middle, and the kite is still circling its own.
    const middle = { x: 0, z: 0 };
    expect(sim.herdOf(finch, middle)).toBe(true);
    const bird = whereIs(sim, finch);
    expect(Math.hypot(bird.x - middle.x, bird.z - middle.z)).toBeLessThan(
      (SPECIES[WILD_SPECIES.finch] as Species).spread * WILDLIFE.strayAt + 5,
    );
  });

  it('lets a swimmer that is startled dart off, but not out of the lake', () => {
    const w = lake();
    const sim = newSim(w);
    const fish = sim.spawnAt(WILD_SPECIES.shoal, 64, 0);
    const threats = new Threats();
    threats.add(70, 0);
    play(sim, 4, { targets: [player(1, 59, 0)], threats });
    const at = whereIs(sim, fish);
    expect(at.x).toBeGreaterThan(60);
    expect(stateOf(sim, fish)).toBeDefined();
  });

  it('brings a kite down to the player it is angry with, and strikes at the height of their chest', () => {
    const w = lake();
    const sim = newSim(w);
    const kite = sim.spawnAt(WILD_SPECIES.kite, 0, 60);
    const body = SPECIES[WILD_SPECIES.kite] as Species;
    expect(whereIs(sim, kite).y - 10).toBeGreaterThanOrEqual(body.level![0] - 0.01);
    sim.hurt(kite, 10, 1, 8, 60);
    const strikes = recorder();
    const targets = [player(1, 8, 60)];
    let lowest = Infinity;
    for (let t = 0; t < 10; t += DT) {
      play(sim, DT, { targets, strikes });
      lowest = Math.min(lowest, whereIs(sim, kite).y);
    }
    expect(strikes.hits.length).toBeGreaterThan(0);
    expect(lowest).toBeLessThan(10 + 1.5);
    // It goes back up when it is done.
    play(sim, 20, { targets, strikes });
    expect(whereIs(sim, kite).y - 10).toBeGreaterThanOrEqual(body.level![0] - 1);
  });

  it('lets a ray sting a player at the water edge, and only that player', () => {
    // The shore is a step above the water, as it is in the valley.
    const w = lake(7.5);
    const sim = newSim(w);
    const ray = sim.spawnAt(WILD_SPECIES.ray, 66, 0);
    const bystander = player(2, 10, 30, 7.5);
    const attacker = player(1, 59.5, 0, 7.5);
    sim.hurt(ray, 10, 1, 59.5, 0);
    const strikes = recorder();
    play(sim, 10, { targets: [attacker, bystander], strikes });
    expect(strikes.hits.length).toBeGreaterThan(0);
    expect(strikes.hits.every(([id]) => id === 1)).toBe(true);
  });
});

describe('what goes on the wire', () => {
  it('writes the species, the health as a part of the full bar, and the flags', () => {
    const w = lake();
    const sim = newSim(w);
    const stag = sim.spawnAt(WILD_SPECIES.stag, 40, 40);
    sim.hurt(stag, 30, 1, 40, 41);
    const state = stateOf(sim, stag)!;
    expect(state.kind).toBe(WILD_SPECIES.stag);
    expect(state.health).toBe(128);
    expect(state.flags).toBe(WILD_FLAG.hurt | WILD_FLAG.angry);
    play(sim, 1);
    expect(stateOf(sim, stag)!.flags & WILD_FLAG.hurt).toBe(0);
  });

  it('numbers every creature apart, and stops at the cap', () => {
    const w = lake();
    const sim = newSim(w);
    const ids = new Set<number>();
    for (let i = 0; i < WILDLIFE.maxAlive; i++) {
      const id = sim.spawnAt(WILD_SPECIES.hare, -80 + (i % 16) * 2, -60 + Math.floor(i / 16) * 2);
      expect(id).toBeGreaterThan(0);
      ids.add(id);
    }
    expect(ids.size).toBe(WILDLIFE.maxAlive);
    expect(sim.spawnAt(WILD_SPECIES.hare, 60, 60)).toBe(0);
    expect(sim.count).toBe(WILDLIFE.maxAlive);
    sim.clear();
    expect(sim.count).toBe(0);
    expect(sim.herdCount).toBe(0);
  });

  it('refuses a spot a creature cannot stand on: a stag in the lake, a fish on the shore', () => {
    const w = lake();
    const sim = newSim(w);
    expect(sim.spawnAt(WILD_SPECIES.stag, 80, 0)).toBe(0);
    expect(sim.spawnAt(WILD_SPECIES.shoal, 0, 0)).toBe(0);
    expect(sim.spawnAt(WILD_SPECIES.stag, 0, 40)).toBeGreaterThan(0);
    expect(sim.spawnAt(WILD_SPECIES.shoal, 80, 0)).toBeGreaterThan(0);
    expect(sim.spawnAt(99, 0, 40)).toBe(0);
  });
});

describe('never starting a fight', () => {
  it('wounds nobody who has not hurt a creature, whatever species is beside them', () => {
    const w = lake();
    const sim = newSim(w);
    for (let species = 0; species < WILD_SPECIES_COUNT; species++) {
      const body = SPECIES[species] as Species;
      const x = body.realm === 'water' ? 80 : -30;
      const z = species * 6 - 20;
      expect(sim.spawnHerd(species, x, z, 2), body.name).toBeGreaterThan(0);
    }
    // Two players walk through the middle of them for two minutes.
    const strikes = recorder();
    for (let t = 0; t < 120; t += DT) {
      const targets = [
        player(1, -30 + Math.sin(t) * 6, (t % 40) - 20),
        player(2, 59 + Math.sin(t) * 0.5, (t % 30) - 15),
      ];
      sim.step(DT, targets, 2, new Threats(), strikes);
    }
    expect(strikes.hits).toEqual([]);
  });
});
