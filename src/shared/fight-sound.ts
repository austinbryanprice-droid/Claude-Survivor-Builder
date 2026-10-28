import { noteHz } from './audio';
import { GRADE_TAP, Score, vary, type Effect } from './effect-sound';
import { ENEMY_KIND } from './enemy-state';
import type { MusicCue } from './game-sound';
import { hash3 } from './hash';
import type { Vec3 } from './look';
import { SHOT_FLAG } from './shot';
import type { SurvivalEvent } from './survival-state';

/**
 * What the fight sounds like, with nothing of the browser in it: a gun let go and the bolt landing
 * on a machine or on the world, a machine falling apart, a machine winding up a bite and landing it,
 * the Core taking a blow, the player taking one, a player going down and coming back, a breacher
 * going off, the run lost. They are made of the same voices as the sounds of building (and one more,
 * the `zap` of a bolt), placed and held to the same budget by the same machinery (`effect-sound.ts`),
 * and each screen works out the same sound from the same word, so the crew hears one fight, each
 * from where they stand.
 *
 * The sounds follow what the screen draws: a bolt sounds when it is drawn, from the gun it is drawn
 * from and landing when it lands, so that the click that fired it and the flash that answers it are
 * not a network's length apart.
 */

// ------------------------------------------------------------------------------------------------
// The sounds of a bolt.
// ------------------------------------------------------------------------------------------------

/** A bolt as the screen drew it. `ShotLogEntry` (`app/shot-effects.ts`) is one. */
export interface BoltHeard {
  /** The player who fired it, or `NO_PLAYER` for a turret. */
  readonly by: number;
  /** Where it ended. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** `SHOT_FLAG` bits: what it struck, as the screen drew it. */
  readonly flags: number;
  /** The cell of the turret that fired it. */
  readonly turret?: readonly [x: number, y: number, z: number];
  /** How heavy the turret's bolt was drawn, against the blaster's at 1. */
  readonly heft?: number;
  /** The muzzle it was drawn from, or null where the shooter's gun could not be found. */
  readonly from: Vec3 | null;
  /** Seconds it takes to land. */
  readonly arrives: number;
  /** The machine it struck, or 0. */
  readonly enemy: number;
}

/** The cues of a list put off by `seconds`. */
function later(cues: readonly MusicCue[], seconds: number): MusicCue[] {
  return seconds === 0
    ? [...cues]
    : cues.map(({ after, cue }) => ({ after: after + seconds, cue }));
}

/** A gun let go: the fall of the bolt's tone and the kick under it, lower and longer for a heavier gun. */
function muzzle(heft: number, seed: number): MusicCue[] {
  const heavy = Math.max(0, Math.min(2, heft - 1));
  const score = new Score(seed);
  if (heft <= 1) {
    score
      .add(0, 'zap', -14, { hz: vary(2600, seed, 0.03), to: 330, seconds: 0.11 })
      .add(0, 'step', -22, { hz: 135 });
  } else {
    score
      .add(0, 'zap', -13 + 2 * heavy, {
        hz: vary(1900 - 400 * heavy, seed, 0.03),
        to: 240 - 80 * heavy,
        seconds: 0.14 + 0.06 * heavy,
      })
      .add(0, 'step', -18 + 5 * heavy, { hz: 105 - 25 * heavy });
  }
  return score.cues;
}

/** What a bolt sounds like where it strikes a machine of this kind: a knock of metal, and a plate that does not ring for the armored one. */
function struck(kind: number, seed: number): MusicCue[] {
  const score = new Score(seed);
  switch (kind) {
    case ENEMY_KIND.armored:
      score
        .add(0, 'clang', -15, { hz: vary(520, seed, 0.05), seconds: 0.38 })
        .add(0, 'tick', -12, { hz: 820 })
        .add(0.004, 'crackle', -7, { hz: vary(2000, seed + 1, 0.25) });
      break;
    case ENEMY_KIND.flyer:
      [0, 0.015, 0.03].forEach((after, i) => {
        score.add(after, 'crackle', -6 - i, { hz: vary(3100, seed + i, 0.2) });
      });
      score.add(0, 'zap', -16, { hz: 3200, to: 1100, seconds: 0.07 });
      break;
    case ENEMY_KIND.breacher:
      score
        .add(0, 'step', -12, { hz: 95 })
        .add(0, 'clang', -15, { hz: vary(210, seed, 0.05), seconds: 0.55 })
        .add(0.004, 'crackle', -7, { hz: vary(1700, seed + 1, 0.25) });
      break;
    default:
      score
        .add(0, 'tick', -8, { hz: vary(1100, seed, 0.06) })
        .add(0.004, 'crackle', -4, { hz: vary(2300, seed + 1, 0.25) })
        .add(0, 'step', -15, { hz: 190 });
  }
  return score.cues;
}

/** A bolt landing on a block, the ground or the Core: a snap of sparks. */
function sparked(seed: number): MusicCue[] {
  return new Score(seed)
    .add(0, 'crackle', -1, { hz: vary(2000, seed, 0.3) })
    .add(0.012, 'crackle', -3, { hz: vary(2500, seed + 1, 0.3) })
    .add(0, 'tick', -10, { hz: 1500 }).cues;
}

/** Where to hear a bolt from, as a point of the valley. */
function pointOf(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * What a bolt sounds like: the gun let go, from the gun (in the head for the local player's own),
 * and the bolt landing, from where it lands, when it lands. `own` is whether the local player
 * fired it, and `kind` the kind of machine it struck (`ENEMY_KIND`), or -1 where there is none or
 * the screen cannot tell. The machine falling apart is `effectForFelled`.
 */
export function effectsForBolt(bolt: BoltHeard, own: boolean, kind: number): Effect[] {
  const out: Effect[] = [];
  const turret = bolt.turret;
  const seed = turret
    ? hash3(0x74757272, turret[0], turret[1], turret[2])
    : hash3(0x626f6c74, bolt.by, Math.floor(bolt.x * 4), Math.floor(bolt.z * 4));
  // A source is a player or a turret, so that two guns firing together both sound.
  const source = turret ? seed : own ? 1 : 0x10000 + bolt.by;
  if (own || bolt.from) {
    out.push({
      kind: own ? 'fire' : 'shot',
      ...(own || !bolt.from ? {} : { at: pointOf(bolt.from) }),
      key: source,
      cues: muzzle(turret ? (bolt.heft ?? 1) : 1, seed),
    });
  }
  const at = { x: bolt.x, y: bolt.y, z: bolt.z };
  if (bolt.flags & SHOT_FLAG.enemy) {
    out.push({
      kind: own ? 'strike' : 'hit',
      at,
      key: bolt.enemy,
      cues: later(struck(kind, seed ^ 0x68697421), bolt.arrives),
    });
  } else if (bolt.flags & SHOT_FLAG.world) {
    out.push({
      kind: 'spark',
      at,
      key: hash3(0x73706b, Math.floor(bolt.x), Math.floor(bolt.y), Math.floor(bolt.z)),
      cues: later(sparked(seed ^ 0x73706172), bolt.arrives),
    });
  }
  return out;
}

/**
 * A machine falling apart `after` seconds from now, at `at`: the snaps of what held it together, its
 * weight landing and what is left of it ringing down. A heavier machine lands lower and rings longer,
 * a flyer comes down in a spray of sparks.
 */
export function effectForFelled(at: Vec3, kind: number, after: number): Effect {
  const seed = hash3(0x66656c6c, Math.floor(at.x * 4), Math.floor(at.y * 4), Math.floor(at.z * 4));
  const score = new Score(seed);
  const snaps = (hz: number, count: number, first: number, step: number): void => {
    for (let i = 0; i < count; i++) {
      score.add(i * step, 'crackle', first - 2 * (i % 4), { hz: vary(hz, seed + i, 0.4) });
    }
  };
  switch (kind) {
    case ENEMY_KIND.armored:
      snaps(1900, 4, -4, 0.025);
      score
        .add(0, 'thud', -9, { hz: 78 })
        .add(0.02, 'clang', -8, { hz: 170, seconds: 0.8 })
        .add(0.03, 'zap', -15, { hz: 700, to: 60, seconds: 0.5 });
      break;
    case ENEMY_KIND.flyer:
      snaps(3200, 5, -3, 0.02);
      score
        .add(0, 'zap', -12, { hz: 2600, to: 180, seconds: 0.4 })
        .add(0.1, 'thud', -20, { hz: 150 });
      break;
    case ENEMY_KIND.breacher:
      snaps(1600, 3, -4, 0.03);
      score
        .add(0, 'thud', -6, { hz: 66 })
        .add(0.02, 'rumble', -16, { seconds: 0.6 })
        .add(0.03, 'clang', -7, { hz: 130, seconds: 1.1 });
      break;
    default:
      snaps(2600, 4, -3, 0.025);
      score
        .add(0, 'thud', -13, { hz: 120 })
        .add(0.02, 'clang', -13, { hz: 330, seconds: 0.5 })
        .add(0.03, 'zap', -16, { hz: 1100, to: 90, seconds: 0.35 });
  }
  return { kind: 'fell', at: pointOf(at), key: seed, cues: later(score.cues, Math.max(0, after)) };
}

// ------------------------------------------------------------------------------------------------
// The machines.
// ------------------------------------------------------------------------------------------------

/** What a machine did that can be heard: it came out of the ground, began to wind up a blow or charge, or landed the blow. */
export type MachineMoment = 'rose' | 'windup' | 'bit';

/** A machine and what it did, as `MachineEdges` reports it. */
export interface MachineHeard {
  readonly what: MachineMoment;
  readonly id: number;
  /** `ENEMY_KIND`. */
  readonly kind: number;
  /** Where it is, on the ground under it. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** How high above the ground the middle of a body is, by kind (a flyer's position is the underside of its hull). */
const BODY_LIFT: Readonly<Record<number, number>> = {
  [ENEMY_KIND.crawler]: 0.5,
  [ENEMY_KIND.armored]: 0.55,
  [ENEMY_KIND.flyer]: 0.3,
  [ENEMY_KIND.breacher]: 0.65,
};

/** The sound of a machine's moment, from the machine; null for none (a breacher does not bite: it goes off, and the host says so). */
export function effectForMachine(machine: MachineHeard): Effect | null {
  const { what, id, kind } = machine;
  const seed = hash3(0x6d616368, id, kind, what === 'rose' ? 1 : what === 'windup' ? 2 : 3);
  const score = new Score(seed);
  const at = { x: machine.x, y: machine.y + (BODY_LIFT[kind] ?? 0.5), z: machine.z };
  if (what === 'rose') {
    score.add(0, 'rumble', -20, { seconds: 0.7 });
    return { kind: 'rise', at, key: id, cues: score.cues };
  }
  if (what === 'windup') {
    switch (kind) {
      case ENEMY_KIND.armored:
        score
          .add(0, 'servo', -6, { hz: 220, to: 420, seconds: 0.3 })
          .add(0, 'step', -13, { hz: 115 });
        break;
      case ENEMY_KIND.flyer:
        score.add(0, 'servo', -10, { hz: 700, to: 2100, seconds: 0.33 });
        break;
      case ENEMY_KIND.breacher:
        score
          .add(0, 'servo', -5, { hz: 90, to: 430, seconds: 1.1 })
          .add(0, 'riser', -4, { hz: 280, to: 2800, seconds: 1.2 });
        return { kind: 'charge', at, key: id, cues: score.cues };
      default:
        score
          .add(0, 'servo', -12, { hz: 230, to: 470, seconds: 0.25 })
          .add(0, 'step', -16, { hz: 175 });
    }
    return { kind: 'windup', at, key: id, cues: score.cues };
  }
  switch (kind) {
    case ENEMY_KIND.armored:
      score
        .add(0, 'thud', -12, { hz: 100 })
        .add(0, 'clang', -17, { hz: 260, seconds: 0.35 })
        .add(0.004, 'crackle', -9, { hz: vary(2100, seed, 0.25) });
      break;
    case ENEMY_KIND.flyer:
      score.add(0, 'zap', -14, { hz: 3300, to: 380, seconds: 0.1 });
      [0, 0.012, 0.028].forEach((after, i) => {
        score.add(after, 'crackle', -7 - i, { hz: vary(3300, seed + i, 0.2) });
      });
      break;
    case ENEMY_KIND.breacher:
      return null;
    default:
      score
        .add(0, 'step', -13, { hz: 165 })
        .add(0, 'crackle', -8, { hz: vary(2600, seed, 0.25) })
        .add(0.02, 'crackle', -10, { hz: vary(2600, seed + 1, 0.25) })
        .add(0, 'tick', -19, { hz: 1350 });
  }
  return { kind: 'bite', at, key: id, cues: score.cues };
}

// ------------------------------------------------------------------------------------------------
// What happens to the Core and to the crew.
// ------------------------------------------------------------------------------------------------

/** The Core taking a blow of `amount` points, from where it stands: a deep thud, the plate ringing and sparks, and under a great blow the earth shaking. */
export function effectForCoreHit(at: Vec3, amount: number): Effect {
  const score = new Score(0x636f7265)
    .add(0, 'thud', -7, { hz: 62 })
    .add(0.01, 'clang', -11, { hz: 150, seconds: 0.9 })
    .add(0, 'crackle', -6, { hz: 2100 })
    .add(0.025, 'crackle', -8, { hz: 2400 });
  if (amount >= 30) score.add(0, 'boom', -12, { seconds: 1 });
  return { kind: 'core', at: pointOf(at), cues: score.cues };
}

/** The player taking a blow of `amount` points, in their head: a dull body blow and a snap, and a great blow shakes the ground as well. */
export function effectForHurt(amount: number): Effect {
  const great = amount >= 20;
  const score = new Score(0x68757274)
    .add(0, 'thud', great ? -3 : -7, { hz: 82 })
    .add(0, 'crackle', -7, { hz: 1300 });
  if (great) score.add(0, 'rumble', -18, { seconds: 0.4 });
  return { kind: 'hurt', cues: score.cues };
}

/** Where the screen can find things that the host's words name. */
export interface FightPlaces {
  /** The local player's id. */
  readonly localId: number;
  /** Where player `id` is right now, or null where they cannot be found. */
  readonly placeOf: (id: number) => Vec3 | null;
  /** The middle of the Core, or null where there is none. */
  readonly core: Vec3 | null;
}

/**
 * The sounds of the host's words that are not the valley's own (those are `cuesForEvent`): a player
 * going down (in your head if it is you, where they fell if not), the Core bringing one back (a
 * rising chord, at the Core for the others), the run lost, a breacher going off (heard from twice as
 * far as a knock is) and the cells a felled machine leaves in the pool.
 */
export function effectsForSurvival(event: SurvivalEvent, places: FightPlaces): Effect[] {
  switch (event.k) {
    case 'down': {
      const own = event.p === places.localId;
      const where = own ? null : places.placeOf(event.p);
      if (!own && !where) return [];
      const score = new Score(hash3(0x646f776e, event.p, event.n, 0));
      if (own) {
        score
          .add(0, 'whoom', -10, { hz: 50 })
          .add(0, 'zap', -15, { hz: 520, to: 55, seconds: 0.9 })
          .add(0.12, 'thud', -12, { hz: 68 });
      } else {
        score
          .add(0, 'thud', -8, { hz: 92 })
          .add(0.02, 'servo', -13, { hz: 420, to: 90, seconds: 0.4 });
      }
      return [{ kind: 'down', ...(where ? { at: where } : {}), key: event.p, cues: score.cues }];
    }
    case 'back': {
      const own = event.p === places.localId;
      const where = own ? null : places.core;
      if (!own && !where) return [];
      const score = new Score(hash3(0x6261636b, event.p, event.n, 0));
      ['D5', 'A5', 'D6'].forEach((note, i) => {
        score.add(0.09 * i, 'pluck', -17, { hz: noteHz(note), seconds: 0.8 });
      });
      score.add(0, 'whoom', -16, { hz: 73 });
      return [{ kind: 'back', ...(where ? { at: where } : {}), key: event.p, cues: score.cues }];
    }
    case 'overrun': {
      const score = new Score(hash3(0x6f766572, event.n, 0, 0))
        .add(0, 'groan', -9, { hz: 110, to: 46, seconds: 3.2 })
        .add(0.1, 'boom', -13, { seconds: 3 })
        .add(0.4, 'whoom', -11, { hz: 40 });
      return [{ kind: 'overrun', cues: score.cues }];
    }
    case 'blast': {
      const seed = hash3(0x626c7374, Math.floor(event.x), Math.floor(event.y), Math.floor(event.z));
      const score = new Score(seed)
        .add(0, 'boom', -7, { seconds: 2.4 })
        .add(0, 'thud', -8, { hz: 55 })
        .add(0.05, 'rumble', -16, { seconds: 1 })
        .add(0.03, 'clang', -15, { hz: 120, seconds: 1.5 });
      for (let i = 0; i < 6; i++) {
        score.add(0.015 * i, 'crackle', -5 - (i % 3), { hz: vary(1500, seed + i, 0.5) });
      }
      return [
        {
          kind: 'blast',
          at: { x: event.x, y: event.y, z: event.z },
          key: seed,
          carries: 2,
          cues: score.cues,
        },
      ];
    }
    case 'drop': {
      const tier = Math.min(GRADE_TAP.length, Math.max(1, event.m));
      const score = new Score(hash3(0x64726f70, event.m, event.n, event.c)).add(0, 'tick', -20, {
        hz: GRADE_TAP[tier - 1] as number,
      });
      if (tier === GRADE_TAP.length)
        score.add(0.04, 'pluck', -27, { hz: noteHz('G6'), seconds: 0.25 });
      return [{ kind: 'drop', cues: score.cues }];
    }
    default:
      return [];
  }
}
