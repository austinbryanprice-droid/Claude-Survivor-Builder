import { describe, expect, it } from 'vitest';
import { GRADE_TAP, KINDS, costOf, type Effect } from '../../src/shared/effect-sound';
import { ENEMY_KIND } from '../../src/shared/enemy-state';
import {
  effectForCoreHit,
  effectForFelled,
  effectForHurt,
  effectForMachine,
  effectsForBolt,
  effectsForSurvival,
  type BoltHeard,
  type FightPlaces,
  type MachineHeard,
} from '../../src/shared/fight-sound';
import { SHOT_FLAG } from '../../src/shared/shot';
import { NO_PLAYER } from '../../src/shared/protocol';
import type { SurvivalEvent } from '../../src/shared/survival-state';

const KINDS_OF_MACHINE = [
  ENEMY_KIND.crawler,
  ENEMY_KIND.armored,
  ENEMY_KIND.flyer,
  ENEMY_KIND.breacher,
] as const;

const voices = (effect: Effect | null | undefined): string[] =>
  (effect?.cues ?? []).map(({ cue }) => cue.voice);

/** A bolt that flew its whole range from a gun at (1, 12, 0) and struck nothing. */
function bolt(rest: Partial<BoltHeard> = {}): BoltHeard {
  return {
    by: 2,
    x: 1,
    y: 12,
    z: -40,
    flags: 0,
    from: { x: 1, y: 12, z: -1 },
    arrives: 0.2,
    enemy: 0,
    ...rest,
  };
}

const CELL = [4, 10, -6] as const;

describe('the gun let go', () => {
  it('is a zap and a kick, in the head for the player’s own and at the muzzle for anyone else’s', () => {
    const own = effectsForBolt(bolt({ by: 1 }), true, -1);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ kind: 'fire', key: 1 });
    expect(own[0]?.at).toBeUndefined();
    expect(voices(own[0])).toEqual(['zap', 'step']);
    const theirs = effectsForBolt(bolt(), false, -1);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ kind: 'shot', at: { x: 1, y: 12, z: -1 } });
    expect(voices(theirs[0])).toEqual(['zap', 'step']);
    // The zap falls through the sky: it begins high and ends low.
    const zap = theirs[0]?.cues[0]?.cue;
    expect(zap?.hz).toBeGreaterThan(2000);
    expect(zap?.to).toBeLessThan(500);
  });

  it('tells two players’ guns apart, so that both sound when they fire together', () => {
    const one = effectsForBolt(bolt({ by: 2 }), false, -1)[0];
    const other = effectsForBolt(bolt({ by: 3 }), false, -1)[0];
    expect(one?.key).not.toBe(other?.key);
    expect(effectsForBolt(bolt({ by: 1 }), true, -1)[0]?.key).not.toBe(one?.key);
  });

  it('is silent for a shooter whose gun cannot be found on this screen, unless it is the player’s own', () => {
    expect(effectsForBolt(bolt({ from: null }), false, -1)).toEqual([]);
    expect(effectsForBolt(bolt({ from: null, by: 1 }), true, -1)).toHaveLength(1);
  });

  it('is heavier and lower for a turret of a higher level, and its own source for each turret', () => {
    const light = effectsForBolt(bolt({ by: NO_PLAYER, turret: CELL, heft: 1 }), false, -1)[0];
    const heavy = effectsForBolt(bolt({ by: NO_PLAYER, turret: CELL, heft: 2 }), false, -1)[0];
    const zap = (effect: Effect | undefined) => effect?.cues[0]?.cue;
    const kick = (effect: Effect | undefined) => effect?.cues[1]?.cue;
    expect(zap(heavy)?.hz).toBeLessThan(zap(light)?.hz ?? 0);
    expect(zap(heavy)?.to).toBeLessThan(zap(light)?.to ?? 0);
    expect(zap(heavy)?.seconds).toBeGreaterThan(zap(light)?.seconds ?? 0);
    expect(kick(heavy)?.hz).toBeLessThan(kick(light)?.hz ?? 0);
    expect(kick(heavy)?.level).toBeGreaterThan(kick(light)?.level ?? 0);
    const elsewhere = effectsForBolt(
      bolt({ by: NO_PLAYER, turret: [CELL[0] + 2, CELL[1], CELL[2]], heft: 1 }),
      false,
      -1,
    )[0];
    expect(elsewhere?.key).not.toBe(light?.key);
    // A turret is not a player, whoever's number it is given.
    expect(light?.key).not.toBe(effectsForBolt(bolt({ by: 2 }), false, -1)[0]?.key);
  });

  it('sounds the same on every screen for the same bolt', () => {
    expect(effectsForBolt(bolt(), false, -1)).toEqual(effectsForBolt(bolt(), false, -1));
    expect(effectsForBolt(bolt({ flags: SHOT_FLAG.enemy, enemy: 4 }), false, 0)).toEqual(
      effectsForBolt(bolt({ flags: SHOT_FLAG.enemy, enemy: 4 }), false, 0),
    );
  });
});

describe('a bolt landing', () => {
  const hit = (kind: number, rest: Partial<BoltHeard> = {}): Effect | undefined =>
    effectsForBolt(bolt({ flags: SHOT_FLAG.enemy, enemy: 9, ...rest }), false, kind)[1];

  it('knocks on a machine where it is struck, when the bolt gets there, and is that machine’s own source', () => {
    const effect = hit(ENEMY_KIND.crawler, { x: 3, y: 10.5, z: -12, arrives: 0.3 });
    expect(effect).toMatchObject({ kind: 'hit', at: { x: 3, y: 10.5, z: -12 }, key: 9 });
    expect(Math.min(...(effect?.cues.map(({ after }) => after) ?? [0]))).toBeCloseTo(0.3, 9);
    expect(hit(ENEMY_KIND.crawler, { enemy: 10 })?.key).toBe(10);
  });

  it('is the player’s own strike for their bolt, which answers their hand, and anyone else’s hit for the others’', () => {
    const own = effectsForBolt(bolt({ by: 1, flags: SHOT_FLAG.enemy, enemy: 9 }), true, 0);
    expect(own.map((effect) => effect.kind)).toEqual(['fire', 'strike']);
    const theirs = effectsForBolt(bolt({ flags: SHOT_FLAG.enemy, enemy: 9 }), false, 0);
    expect(theirs.map((effect) => effect.kind)).toEqual(['shot', 'hit']);
    const world = effectsForBolt(bolt({ by: 1, flags: SHOT_FLAG.world }), true, -1);
    expect(world.map((effect) => effect.kind)).toEqual(['fire', 'spark']);
  });

  it('is told apart by the machine’s kind: a plate does not ring like a crawler, a flyer spits sparks', () => {
    const crawler = voices(hit(ENEMY_KIND.crawler));
    const armored = voices(hit(ENEMY_KIND.armored));
    const flyer = voices(hit(ENEMY_KIND.flyer));
    const breacher = voices(hit(ENEMY_KIND.breacher));
    expect(crawler).toEqual(['tick', 'crackle', 'step']);
    expect(armored).toEqual(['clang', 'tick', 'crackle']);
    expect(flyer.filter((voice) => voice === 'crackle')).toHaveLength(3);
    expect(breacher).toEqual(['step', 'clang', 'crackle']);
    // A machine it cannot name is taken for a crawler.
    expect(voices(hit(-1))).toEqual(crawler);
  });

  it('snaps in sparks where it strikes a block, the ground or the Core', () => {
    const effects = effectsForBolt(
      bolt({ flags: SHOT_FLAG.world, arrives: 0.12, y: 10 }),
      false,
      -1,
    );
    expect(effects.map((effect) => effect.kind)).toEqual(['shot', 'spark']);
    expect(effects[1]?.at).toEqual({ x: 1, y: 10, z: -40 });
    expect(voices(effects[1])).toEqual(['crackle', 'crackle', 'tick']);
    expect(Math.min(...(effects[1]?.cues.map(({ after }) => after) ?? [0]))).toBeCloseTo(0.12, 9);
  });

  it('lands nothing where the bolt flew its whole range', () => {
    expect(effectsForBolt(bolt(), false, -1).map((effect) => effect.kind)).toEqual(['shot']);
  });

  it('is heard from the end of a turret’s bolt as well as from its muzzle', () => {
    const effects = effectsForBolt(
      bolt({ by: NO_PLAYER, turret: CELL, heft: 1, flags: SHOT_FLAG.enemy, enemy: 7 }),
      false,
      ENEMY_KIND.armored,
    );
    expect(effects.map((effect) => effect.kind)).toEqual(['shot', 'hit']);
  });
});

describe('a machine falling apart', () => {
  const at = { x: 5, y: 10.5, z: -9 };

  it('is heard from where it fell, after the time it takes the bolt to land', () => {
    const effect = effectForFelled(at, ENEMY_KIND.crawler, 0.25);
    expect(effect).toMatchObject({ kind: 'fell', at });
    expect(Math.min(...effect.cues.map(({ after }) => after))).toBeCloseTo(0.25, 9);
    // A word that comes after the landing is heard now, never before.
    const late = effectForFelled(at, ENEMY_KIND.crawler, -3);
    expect(Math.min(...late.cues.map(({ after }) => after))).toBe(0);
  });

  it('is a different fall for each kind, and heavier machines land lower and ring longer', () => {
    const falls = KINDS_OF_MACHINE.map((kind) => effectForFelled(at, kind, 0));
    const sounding = (effect: Effect) =>
      JSON.stringify(effect.cues.map(({ after, cue }) => [after, cue.voice, cue.level, cue.hz]));
    expect(new Set(falls.map(sounding)).size).toBe(4);
    const weight = (kind: number): number =>
      effectForFelled(at, kind, 0).cues.find(({ cue }) => cue.voice === 'thud')?.cue.hz ?? 0;
    expect(weight(ENEMY_KIND.breacher)).toBeLessThan(weight(ENEMY_KIND.armored));
    expect(weight(ENEMY_KIND.armored)).toBeLessThan(weight(ENEMY_KIND.crawler));
    const ring = (kind: number): number =>
      effectForFelled(at, kind, 0).cues.find(({ cue }) => cue.voice === 'clang')?.cue.seconds ?? 0;
    expect(ring(ENEMY_KIND.breacher)).toBeGreaterThan(ring(ENEMY_KIND.armored));
    expect(ring(ENEMY_KIND.armored)).toBeGreaterThan(ring(ENEMY_KIND.crawler));
    // A flyer falls out of the sky in a spray of sparks.
    expect(
      voices(effectForFelled(at, ENEMY_KIND.flyer, 0)).filter((v) => v === 'crackle'),
    ).toHaveLength(5);
  });

  it('takes a machine it cannot name for a crawler, and is the same sound on every screen', () => {
    expect(voices(effectForFelled(at, -1, 0))).toEqual(
      voices(effectForFelled(at, ENEMY_KIND.crawler, 0)),
    );
    expect(effectForFelled(at, ENEMY_KIND.armored, 0.1)).toEqual(
      effectForFelled(at, ENEMY_KIND.armored, 0.1),
    );
    expect(effectForFelled({ ...at, x: 6 }, ENEMY_KIND.armored, 0).key).not.toBe(
      effectForFelled(at, ENEMY_KIND.armored, 0).key,
    );
  });
});

describe('what a machine does', () => {
  const machine = (what: MachineHeard['what'], kind: number, id = 5): MachineHeard => ({
    what,
    id,
    kind,
    x: 10,
    y: 12,
    z: -20,
  });

  it('rises out of the ground with a faint rumble that nobody is made to hear', () => {
    for (const kind of KINDS_OF_MACHINE) {
      const effect = effectForMachine(machine('rose', kind));
      expect(effect).toMatchObject({ kind: 'rise', key: 5 });
      expect(voices(effect)).toEqual(['rumble']);
    }
    expect(KINDS.rise.priority).toBe(0);
  });

  it('is heard from the middle of its body, not from the ground it stands on', () => {
    for (const kind of KINDS_OF_MACHINE) {
      const effect = effectForMachine(machine('bit', kind));
      if (!effect) continue;
      expect(effect.at?.x).toBe(10);
      expect(effect.at?.z).toBe(-20);
      expect(effect.at?.y).toBeGreaterThan(12);
      expect(effect.at?.y).toBeLessThan(13);
    }
  });

  it('winds up a bite with a motor, and a breacher charges with a motor and a rising shriek', () => {
    expect(effectForMachine(machine('windup', ENEMY_KIND.crawler))).toMatchObject({
      kind: 'windup',
    });
    expect(voices(effectForMachine(machine('windup', ENEMY_KIND.crawler)))).toEqual([
      'servo',
      'step',
    ]);
    expect(voices(effectForMachine(machine('windup', ENEMY_KIND.armored)))).toEqual([
      'servo',
      'step',
    ]);
    expect(voices(effectForMachine(machine('windup', ENEMY_KIND.flyer)))).toEqual(['servo']);
    const charge = effectForMachine(machine('windup', ENEMY_KIND.breacher));
    expect(charge).toMatchObject({ kind: 'charge', key: 5 });
    expect(voices(charge)).toEqual(['servo', 'riser']);
    // The charge lasts as long as the breacher's does.
    expect(charge?.cues[0]?.cue.seconds).toBeGreaterThan(1);
    // The flyer winds up higher than the crawler, the armored lower.
    const pitch = (kind: number) => effectForMachine(machine('windup', kind))?.cues[0]?.cue.hz ?? 0;
    expect(pitch(ENEMY_KIND.flyer)).toBeGreaterThan(pitch(ENEMY_KIND.crawler));
    expect(pitch(ENEMY_KIND.armored)).toBeLessThan(pitch(ENEMY_KIND.crawler));
  });

  it('lands a bite by its kind, and a breacher does not bite: it goes off, and the host says so', () => {
    expect(voices(effectForMachine(machine('bit', ENEMY_KIND.crawler)))).toEqual([
      'step',
      'crackle',
      'crackle',
      'tick',
    ]);
    expect(voices(effectForMachine(machine('bit', ENEMY_KIND.armored)))).toEqual([
      'thud',
      'clang',
      'crackle',
    ]);
    const zap = effectForMachine(machine('bit', ENEMY_KIND.flyer));
    expect(voices(zap)[0]).toBe('zap');
    expect(zap?.cues[0]?.cue.to).toBeLessThan(zap?.cues[0]?.cue.hz ?? 0);
    expect(effectForMachine(machine('bit', ENEMY_KIND.breacher))).toBeNull();
    for (const kind of [ENEMY_KIND.crawler, ENEMY_KIND.armored, ENEMY_KIND.flyer]) {
      expect(effectForMachine(machine('bit', kind))?.kind).toBe('bite');
    }
  });

  it('keeps each machine its own source, and sounds the same on every screen', () => {
    expect(effectForMachine(machine('bit', 0, 5))?.key).toBe(5);
    expect(effectForMachine(machine('bit', 0, 6))?.key).toBe(6);
    expect(effectForMachine(machine('bit', 0, 5))).toEqual(effectForMachine(machine('bit', 0, 5)));
    // But two machines of one kind are not one voice: their noises differ.
    expect(effectForMachine(machine('bit', 0, 5))?.cues[1]?.cue.seed).not.toBe(
      effectForMachine(machine('bit', 0, 6))?.cues[1]?.cue.seed,
    );
  });
});

describe('the Core and the player taking blows', () => {
  it('rings the Core from its middle, and shakes the earth under a great blow only', () => {
    const at = { x: 0, y: 12, z: 0 };
    const small = effectForCoreHit(at, 8);
    const great = effectForCoreHit(at, 40);
    expect(small).toMatchObject({ kind: 'core', at });
    expect(voices(small)).not.toContain('boom');
    expect(voices(great)).toContain('boom');
    expect(voices(great)).toEqual(expect.arrayContaining(voices(small)));
    expect(voices(effectForCoreHit(at, 29))).not.toContain('boom');
    expect(voices(effectForCoreHit(at, 30))).toContain('boom');
  });

  it('thumps in the player’s head, harder for a blow that takes a fifth of their health or more', () => {
    const small = effectForHurt(6);
    const great = effectForHurt(24);
    expect(small.kind).toBe('hurt');
    expect(small.at).toBeUndefined();
    expect(voices(small)).toEqual(['thud', 'crackle']);
    expect(voices(great)).toEqual(['thud', 'crackle', 'rumble']);
    expect(great.cues[0]?.cue.level).toBeGreaterThan(small.cues[0]?.cue.level ?? 0);
  });
});

describe('what the host’s words sound like', () => {
  const places: FightPlaces = {
    localId: 1,
    placeOf: (id) => (id === 2 ? { x: 20, y: 11, z: -4 } : null),
    core: { x: 0, y: 12, z: 0 },
  };
  const elsewhere: FightPlaces = { ...places, core: null };

  it('has the player hear their own fall in their head, and the others’ from where they fell', () => {
    const own = effectsForSurvival({ k: 'down', n: 1, p: 1 }, places);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ kind: 'down', key: 1 });
    expect(own[0]?.at).toBeUndefined();
    expect(voices(own[0])).toEqual(['whoom', 'zap', 'thud']);
    const theirs = effectsForSurvival({ k: 'down', n: 1, p: 2 }, places);
    expect(theirs[0]).toMatchObject({ kind: 'down', key: 2, at: { x: 20, y: 11, z: -4 } });
    expect(voices(theirs[0])).toEqual(['thud', 'servo']);
    // Someone who cannot be found on this screen cannot be heard to fall.
    expect(effectsForSurvival({ k: 'down', n: 1, p: 9 }, places)).toEqual([]);
  });

  it('brings a player back with a rising chord: in their head if it is them, at the Core if not', () => {
    const own = effectsForSurvival({ k: 'back', n: 1, p: 1, c: 2 }, places);
    expect(own[0]).toMatchObject({ kind: 'back', key: 1 });
    expect(own[0]?.at).toBeUndefined();
    expect(voices(own[0])).toEqual(['pluck', 'pluck', 'pluck', 'whoom']);
    const hz =
      own[0]?.cues.filter(({ cue }) => cue.voice === 'pluck').map(({ cue }) => cue.hz ?? 0) ?? [];
    expect([...hz].sort((a, b) => a - b)).toEqual(hz);
    const theirs = effectsForSurvival({ k: 'back', n: 1, p: 2, c: 2 }, places);
    expect(theirs[0]?.at).toEqual({ x: 0, y: 12, z: 0 });
    expect(effectsForSurvival({ k: 'back', n: 1, p: 2, c: 2 }, elsewhere)).toEqual([]);
    // Your own return needs no Core to be found.
    expect(effectsForSurvival({ k: 'back', n: 1, p: 1, c: 2 }, elsewhere)).toHaveLength(1);
  });

  it('loses the run with a groan falling to the floor, in the head, whatever ended it', () => {
    for (const why of ['core', 'crew'] as const) {
      const effects = effectsForSurvival({ k: 'overrun', n: 3, why }, places);
      expect(effects).toHaveLength(1);
      expect(effects[0]).toMatchObject({ kind: 'overrun' });
      expect(effects[0]?.at).toBeUndefined();
      const groan = effects[0]?.cues.find(({ cue }) => cue.voice === 'groan')?.cue;
      expect(groan?.to).toBeLessThan(groan?.hz ?? 0);
      expect(groan?.seconds).toBeGreaterThan(3);
    }
  });

  it('sets a breacher off where it went off, and lets it be heard twice as far off as a knock', () => {
    const word: SurvivalEvent = { k: 'blast', n: 2, x: 30, y: 11, z: -8 };
    const [blast] = effectsForSurvival(word, places);
    expect(blast).toMatchObject({ kind: 'blast', at: { x: 30, y: 11, z: -8 }, carries: 2 });
    expect(voices(blast)).toEqual(expect.arrayContaining(['boom', 'thud', 'rumble', 'clang']));
    expect(voices(blast).filter((voice) => voice === 'crackle')).toHaveLength(6);
    expect(effectsForSurvival(word, places)).toEqual(effectsForSurvival(word, places));
  });

  it('taps the pool as a felled machine pays into it, higher for a better material', () => {
    const tap = (m: number, c = 3) =>
      effectsForSurvival({ k: 'drop', n: 1, m, c }, places)[0]?.cues[0]?.cue.hz ?? 0;
    expect(tap(1)).toBe(GRADE_TAP[0]);
    expect(tap(2)).toBe(GRADE_TAP[1]);
    expect(tap(3)).toBe(GRADE_TAP[2]);
    expect(tap(4)).toBe(GRADE_TAP[3]);
    // A material the table does not know is the best it does.
    expect(tap(9)).toBe(GRADE_TAP[3]);
    expect(tap(0)).toBe(GRADE_TAP[0]);
    const best = effectsForSurvival({ k: 'drop', n: 1, m: 4, c: 1 }, places)[0];
    expect(voices(best)).toEqual(['tick', 'pluck']);
    expect(voices(effectsForSurvival({ k: 'drop', n: 1, m: 2, c: 1 }, places)[0])).toEqual([
      'tick',
    ]);
  });

  it('leaves the valley’s own words (night, wave, dawn) to the sound of the valley', () => {
    expect(effectsForSurvival({ k: 'nightfall', n: 1 }, places)).toEqual([]);
    expect(effectsForSurvival({ k: 'wave', n: 1, i: 1, of: 3, c: 6 }, places)).toEqual([]);
    expect(effectsForSurvival({ k: 'dawn', n: 1 }, places)).toEqual([]);
  });
});

describe('every sound of the fight', () => {
  const at = { x: 1, y: 2, z: 3 };
  const places: FightPlaces = { localId: 1, placeOf: () => at, core: at };
  const everything = (): Effect[] => {
    const out: Effect[] = [];
    for (const kind of [-1, ...KINDS_OF_MACHINE]) {
      out.push(...effectsForBolt(bolt({ flags: SHOT_FLAG.enemy, enemy: 3 }), false, kind));
      out.push(...effectsForBolt(bolt({ flags: SHOT_FLAG.enemy, enemy: 3, by: 1 }), true, kind));
      out.push(effectForFelled(at, kind, 0));
      for (const what of ['rose', 'windup', 'bit'] as const) {
        const effect = effectForMachine({ what, id: 4, kind, ...at });
        if (effect) out.push(effect);
      }
    }
    out.push(
      ...effectsForBolt(bolt({ flags: SHOT_FLAG.world }), false, -1),
      ...effectsForBolt(bolt({ by: NO_PLAYER, turret: CELL, heft: 2 }), false, -1),
      effectForCoreHit(at, 5),
      effectForCoreHit(at, 50),
      effectForHurt(4),
      effectForHurt(40),
    );
    const words: SurvivalEvent[] = [
      { k: 'down', n: 1, p: 1 },
      { k: 'down', n: 1, p: 2 },
      { k: 'back', n: 1, p: 1, c: 1 },
      { k: 'back', n: 1, p: 2, c: 1 },
      { k: 'overrun', n: 1, why: 'core' },
      { k: 'blast', n: 1, ...at },
      { k: 'drop', n: 1, m: 1, c: 1 },
      { k: 'drop', n: 1, m: 4, c: 1 },
    ];
    for (const word of words) out.push(...effectsForSurvival(word, places));
    return out;
  };

  it('has a rule in the governor’s table, and is quieter than a voice at full level', () => {
    const all = everything();
    expect(all.length).toBeGreaterThan(40);
    for (const effect of all) {
      expect(Object.keys(KINDS)).toContain(effect.kind);
      expect(effect.cues.length).toBeGreaterThan(0);
      for (const { after, cue } of effect.cues) {
        expect(cue.level).toBeLessThan(0);
        expect(cue.level).toBeGreaterThan(-50);
        expect(after).toBeGreaterThanOrEqual(0);
        expect(after).toBeLessThan(1);
        expect(Number.isInteger(cue.seed)).toBe(true);
        expect(cue.hz === undefined || cue.hz > 0).toBe(true);
        expect(cue.seconds === undefined || cue.seconds > 0).toBe(true);
        expect(cue.to === undefined || cue.to > 0).toBe(true);
      }
    }
  });

  it('never asks the budget for more than a fifth of it at once', () => {
    for (const effect of everything()) expect(costOf(effect.cues)).toBeLessThan(6);
  });

  it('keeps what must always be heard in the top priority, what answers the player’s hand and ends a machine just under it, and the detail below the rest', () => {
    for (const kind of ['hurt', 'down', 'back', 'overrun', 'blast'] as const) {
      expect(KINDS[kind].priority).toBe(4);
    }
    for (const kind of ['fire', 'strike', 'fell', 'core', 'charge'] as const) {
      expect(KINDS[kind].priority).toBe(3);
    }
    // Anyone else’s gun and hit, and a machine’s bite, are less sure of it than the player’s own.
    expect(KINDS.shot.priority).toBeLessThan(KINDS.fire.priority);
    expect(KINDS.hit.priority).toBeLessThan(KINDS.strike.priority);
    expect(KINDS.hit.priority).toBeGreaterThan(KINDS.spark.priority);
    expect(KINDS.bite.priority).toBe(KINDS.hit.priority);
    expect(KINDS.rise.priority).toBe(0);
  });
});
