import { lerp, noteHz } from './audio';
import type { CellState } from './block-world';
import { MODULE, moduleOfShape, shapeKind, stateMaterial, stateShape } from './blocks';
import type { HarvestEvent } from './economy';
import type { LiveCue, MusicCue } from './game-sound';
import { hash3, hash32, unitFloat } from './hash';
import type { VoiceName } from './intro-sound';
import type { Vec3 } from './look';
import { NO_PLAYER, type BlockSetEvent } from './protocol';

/**
 * What the things people do in the valley sound like, with nothing of the browser in it: where a
 * sound is heard from (how much quieter it is for the distance, which side it is on, how dull the
 * air makes it), how many may sound at once, and the sounds themselves (a block set down, a piece
 * raised, a module coming on, a click that was refused). They are all made of the film's voices, as
 * the valley's own sound is, and `engine/audio/live.ts` plays them. Every screen of a room works out
 * the same sound for the same word of the host, so the crew hears one base being built, each from
 * where they stand.
 */

// ------------------------------------------------------------------------------------------------
// Where a sound is.
// ------------------------------------------------------------------------------------------------

/** Where the listener's head is and which way the view faces, in the valley's own terms. */
export interface Listener {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Radians; 0 looks toward -z, as the camera does (`lookDirection`), and a turn to the left adds to it. */
  readonly yaw: number;
}

/**
 * Blocks beyond which a sound is not made at all. A block set down twice that far off is already
 * 10 decibels under the wind of a quiet morning (measured in the lab, not guessed), so nothing is
 * lost, and the budget is kept for what can be heard.
 */
export const EARSHOT = 48;

/** Decibels a sound loses on the way, by blocks away: none within arm's reach, then a fall that steepens toward the edge of earshot. */
const FALL: readonly (readonly [distance: number, drop: number])[] = [
  [0, 0],
  [3, 0],
  [8, -6],
  [16, -12.5],
  [32, -21],
  [48, -29],
];

/** The loss in decibels (zero or less) of a sound that comes from `distance` blocks away. */
export function dropFor(distance: number): number {
  let last = FALL[0] as readonly [number, number];
  for (const point of FALL) {
    if (distance <= point[0]) {
      const span = point[0] - last[0];
      return span > 0 ? lerp(last[1], point[1], (distance - last[0]) / span) : point[1];
    }
    last = point;
  }
  return last[1];
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smooth(value: number): number {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
}

/** How a placed sound is shaped besides the loss of loudness. */
export const SPOT = {
  /** The widest a sound is placed (1 is all in one ear, which is tiring on headphones and loses the other side's detail). */
  pan: 0.85,
  /** Within this many blocks a sound is drawn toward the middle, so that something at the player's feet is not in one ear. */
  close: 3,
  /** The air takes the highs off a far sound, and the head off one behind: the shares of a full muffling they come to. */
  muffle: { from: 8, to: 48, far: 0.8, behind: 0.3 },
  /** More of a far sound goes to the room, as the echo of the valley is most of what is left of it. */
  room: 0.3,
} as const;

/** How a sound reaches the ears from where it was made. */
export interface Heard {
  /** Decibels to add (zero or less). */
  drop: number;
  /** -1 is hard left and 1 hard right. */
  pan: number;
  /** 0 clear to 1 as dull as a sound gets. */
  muffle: number;
  /** More of it to the reverb, 0 to 1. */
  room: number;
}

export function createHeard(): Heard {
  return { drop: 0, pan: 0, muffle: 0, room: 0 };
}

/**
 * How a sound made at (x, y, z) reaches `listener`, written into `out`. False where it is beyond
 * earshot (or the listener is nowhere), in which case `out` is not touched. A sound that `carries`
 * twice as far as a knock does (a great blast) is heard from twice as far: its loss, dullness and
 * room are those of half the distance, while the side it comes from is where it really is.
 */
export function hearAt(
  listener: Listener,
  x: number,
  y: number,
  z: number,
  out: Heard,
  carries = 1,
): boolean {
  const dx = x - listener.x;
  const dy = y - listener.y;
  const dz = z - listener.z;
  const there = Math.hypot(dx, dy, dz);
  const distance = there / carries;
  if (!(distance <= EARSHOT)) return false;
  const flat = Math.hypot(dx, dz);
  let pan = 0;
  let behind = 0;
  if (flat > 1e-6) {
    const { yaw } = listener;
    // The view's right-hand side is (cos yaw, 0, -sin yaw) and its front is (-sin yaw, 0, -cos yaw).
    const right = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / flat;
    const ahead = (-dx * Math.sin(yaw) - dz * Math.cos(yaw)) / flat;
    pan = right * SPOT.pan * smooth(flat / SPOT.close);
    behind = ahead < 0 ? -ahead : 0;
  }
  const { from, to, far, behind: shadow } = SPOT.muffle;
  out.drop = dropFor(distance);
  out.pan = pan;
  out.muffle = clamp01(
    far * smooth((distance - from) / (to - from)) + shadow * behind * smooth(there / SPOT.close),
  );
  out.room = SPOT.room * smooth(distance / EARSHOT);
  return true;
}

/** A cue this quiet (decibels) cannot be heard under anything else, and is not started. */
const AUDIBLE = -60;

/** A pan of exactly nothing skips the panner, and the sound would then be 3 decibels louder than the same sound a hair to one side. */
const NOT_QUITE_CENTRE = 1e-6;

/**
 * The cues of an effect as they sound from where the listener is: quieter, between the speakers,
 * duller and roomier the farther they are. A cue that would not be heard is left out.
 */
export function placeCues(cues: readonly MusicCue[], heard: Heard): MusicCue[] {
  const out: MusicCue[] = [];
  for (const { after, cue } of cues) {
    const level = cue.level + heard.drop;
    if (level < AUDIBLE) continue;
    out.push({
      after,
      cue: {
        ...cue,
        level,
        pan: heard.pan === 0 ? NOT_QUITE_CENTRE : heard.pan,
        muffle: Math.max(cue.muffle ?? 0, heard.muffle),
        room: (cue.room ?? 0) + heard.room,
      },
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// How many may sound.
// ------------------------------------------------------------------------------------------------

/** What the governor needs to know about a kind of effect. */
export interface KindRule {
  /** 0 for detail the ear will not miss, up to 4 for what must always be heard. */
  readonly priority: number;
  /** Seconds between two of this kind from the same source. */
  readonly gap: number;
  /** Seconds the effect keeps its voices busy, which is what the budget counts. */
  readonly life: number;
}

/** The kinds of effect, with the rules the governor holds them to. */
export const KINDS = {
  /** A block set down or broken is what a builder does most, so it is the first to be dropped in a crowd of sounds. */
  place: { priority: 1, gap: 0.045, life: 0.45 },
  break: { priority: 1, gap: 0.045, life: 0.45 },
  /** A piece raised in place, and a module set down or taken apart: rarer, and worth hearing. */
  raise: { priority: 2, gap: 0.12, life: 1.2 },
  module: { priority: 2, gap: 0.12, life: 0.9 },
  /** A module that has come on or gone dark. */
  power: { priority: 2, gap: 0.2, life: 0.9 },
  /** The click that was turned away: heard even in a busy hour, because it answers the player's own hand. */
  refuse: { priority: 3, gap: 0.2, life: 0.3 },
  /** A heap stripped. */
  harvest: { priority: 1, gap: 0.07, life: 0.4 },
  /** The fight (`fight-sound.ts`). The player's own gun let go and their bolt landing on a machine answer their hand, so they are heard in a crowd; anyone else's and a turret's are not as sure of it. */
  fire: { priority: 3, gap: 0.05, life: 0.3 },
  strike: { priority: 3, gap: 0.05, life: 0.3 },
  shot: { priority: 2, gap: 0.05, life: 0.3 },
  hit: { priority: 2, gap: 0.05, life: 0.3 },
  spark: { priority: 1, gap: 0.05, life: 0.2 },
  /** A machine felled is what the fight is for, so it is among the last to be turned away. */
  fell: { priority: 3, gap: 0.08, life: 0.8 },
  /** A machine winding up a bite or a zap, the blow landing, and a breacher charging. */
  windup: { priority: 2, gap: 0.2, life: 0.5 },
  bite: { priority: 2, gap: 0.15, life: 0.4 },
  charge: { priority: 3, gap: 1, life: 1.4 },
  /** A machine coming out of the ground: a detail the ear will not miss. */
  rise: { priority: 0, gap: 0.25, life: 0.8 },
  /** Cells of material a felled machine leaves in the pool. */
  drop: { priority: 1, gap: 0.1, life: 0.4 },
  /** What happens to a breacher's blast, to the Core and to the crew. A swarm at the Core is a drumming of blows, so the Core's are held to a few a second. */
  blast: { priority: 4, gap: 0.3, life: 2.5 },
  core: { priority: 3, gap: 0.3, life: 0.8 },
  hurt: { priority: 4, gap: 0.12, life: 0.4 },
  down: { priority: 4, gap: 0.5, life: 2.5 },
  back: { priority: 4, gap: 0.5, life: 1.8 },
  overrun: { priority: 4, gap: 5, life: 4 },
} as const satisfies Record<string, KindRule>;

export type EffectKind = keyof typeof KINDS;

/** Blocks within which a sound is near, and the highest priority nearness lifts a sound to. */
export const NEAR = 8;
const NEAR_PRIORITY = 3;

/** The sounds alive at once the effects may use, and the share of that each priority may fill before it is turned away. */
export const BUDGET = {
  voices: 28,
  /** What the most important effects may use beyond the budget. */
  reserve: 4,
  share: [0.5, 0.65, 0.8, 1, 1],
} as const;

/** What a voice costs the budget: a snap of noise or a tick is a thirtieth of the work of a held note. */
const WEIGHT: Readonly<Partial<Record<VoiceName, number>>> = {
  crackle: 0.2,
  tick: 0.4,
  blip: 0.4,
  step: 0.7,
  zap: 0.6,
};

/** What a list of cues costs the budget. */
export function costOf(cues: readonly MusicCue[]): number {
  let cost = 0;
  for (const { cue } of cues) cost += WEIGHT[cue.voice] ?? 1;
  return cost;
}

const KIND_NAMES = Object.keys(KINDS) as EffectKind[];
const KIND_SLOTS = 1 << 24;

/**
 * Decides which effects may sound: not more of a kind than its gap allows from the same source, and
 * not more at once than the budget holds, the least important being turned away first. Time is the
 * audio clock's, in seconds. A source is anything a number tells apart (a cell, a turret).
 */
export class Governor {
  private readonly busy: { until: number; cost: number }[] = [];
  private readonly last = new Map<number, number>();

  constructor(private readonly budget: number = BUDGET.voices) {}

  /** How many sources it is keeping track of: old ones are let go, so this stays small however long the game runs. */
  get remembered(): number {
    return this.last.size;
  }

  /** The cost of the effects still sounding at `now`. */
  load(now: number): number {
    let load = 0;
    for (const { until, cost } of this.busy) if (until > now) load += cost;
    return load;
  }

  /**
   * Whether an effect of `kind` costing `cost` may start at `now`; if so it is counted. A sound that
   * is `near` the listener matters more than the same sound far off: it is held one step higher than
   * its kind is, up to the sounds that answer the player's hand.
   */
  admit(kind: EffectKind, cost: number, now: number, key = 0, near = false): boolean {
    const rule: KindRule = KINDS[kind];
    const slot = KIND_NAMES.indexOf(kind) * KIND_SLOTS + ((key >>> 0) % KIND_SLOTS);
    const before = this.last.get(slot);
    if (before !== undefined && now - before < rule.gap) return false;

    let kept = 0;
    let load = 0;
    for (const entry of this.busy) {
      if (entry.until <= now) continue;
      this.busy[kept++] = entry;
      load += entry.cost;
    }
    this.busy.length = kept;
    const priority = near && rule.priority < NEAR_PRIORITY ? rule.priority + 1 : rule.priority;
    const share = BUDGET.share[Math.min(priority, BUDGET.share.length - 1)] as number;
    const room = this.budget * share + (priority >= 4 ? BUDGET.reserve : 0);
    if (load + cost > room) return false;

    this.busy.push({ until: now + rule.life, cost });
    this.last.set(slot, now);
    if (this.last.size > 512) {
      // Anything older than the longest gap is as good as new.
      for (const [entry, at] of this.last) if (now - at > 5) this.last.delete(entry);
    }
    return true;
  }
}

// ------------------------------------------------------------------------------------------------
// The effects.
// ------------------------------------------------------------------------------------------------

/** One thing to hear: what kind it is, where it happens, and the sounds it is made of. */
export interface Effect {
  readonly kind: EffectKind;
  /** Where in the valley, in blocks; absent for a sound in the player's head (a click that was refused). */
  readonly at?: Vec3;
  /** Tells two sources of one kind apart for the governor, a cell or a turret; 0 where there is one source. */
  readonly key?: number;
  /** How many times as far as a knock it is heard from: 1 unless it is a great sound (a breacher going off). */
  readonly carries?: number;
  readonly cues: readonly MusicCue[];
}

/**
 * The levels below were not guessed from how loud a voice is called: each effect was drawn to samples
 * on its own and set against the quietest hour of the valley (a morning: the wind and the Core's hum),
 * reading how far it stands over that in each octave band. Every effect stands 12.5 to 21 decibels
 * over the morning in its strongest octave between 180 Hz and 5.6 kHz, and all but the top grade's
 * ring of a heap have something 5.7 to 17 decibels over it between 355 Hz and 2.8 kHz as well, so
 * that it is heard on a laptop's speakers, which have nothing to give below 200 Hz. The voices
 * differ a great deal in how much a nominal level says (a crackle at -3 is quieter than a knock at
 * -20), which is why the numbers look uneven.
 */

/** A list of cues written one at a time, each with a seed of its own so that no two noises in it are the same part of the noise. */
export class Score {
  readonly cues: MusicCue[] = [];

  constructor(private readonly seed: number) {}

  add(after: number, voice: VoiceName, level: number, rest: Partial<LiveCue> = {}): this {
    this.cues.push({
      after,
      cue: { voice, level, seed: hash32(this.seed + this.cues.length * 0x9e3779b1), ...rest },
    });
    return this;
  }
}

/** A pitch moved a little either way by a seed, so that a wall of blocks is not one note. */
export function vary(hz: number, seed: number, spread: number): number {
  return hz * (1 + (unitFloat(hash32(seed ^ 0x76617279)) * 2 - 1) * spread);
}

/** The middle of a cell, where a sound that comes from it is placed. */
function middleOf(x: number, y: number, z: number): Vec3 {
  return { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
}

/** How many materials there are to tell apart: Scrap, Composite, Alloy and Energy-Infused. */
const TIERS = 4;

function tierOf(state: CellState): number {
  return Math.min(TIERS, Math.max(1, stateMaterial(state)));
}

/** A lighter piece rings higher: the pitch of the knock by the kind of piece. */
const LIFT = { cube: 1, wedge: 1.08, slab: 1.16 } as const;

/** A block set in place: a knock with a body to it, a woody tick and a snap of scrap on it, and above Scrap the tap of the material in their place (a glassy note at the top). */
function blockPlaced(state: CellState, seed: number): MusicCue[] {
  const tier = tierOf(state);
  const kind = shapeKind(stateShape(state));
  const lift = kind === 'wedge' || kind === 'slab' ? LIFT[kind] : LIFT.cube;
  const score = new Score(seed);
  score.add(0, 'step', -20, { hz: vary((140 + 30 * tier) * lift, seed, 0.05) });
  if (tier === 1) {
    score.add(0.004, 'tick', -15, { hz: vary(560, seed + 1, 0.06) });
    score.add(0.004, 'crackle', -6, { hz: vary(1500, seed + 2, 0.25) });
  } else {
    score.add(0.008, 'tick', -20 + 1.5 * tier, { hz: vary(700 + 350 * tier, seed + 1, 0.04) });
  }
  if (tier === TIERS) score.add(0.02, 'pluck', -30, { hz: noteHz('G6'), seconds: 0.3 });
  return score.cues;
}

/** A block broken: a snap of debris, the collapse under it, and for a better material the ring of its pieces; a machine's bite adds the earth. */
function blockBroken(state: CellState, gnawed: boolean, seed: number): MusicCue[] {
  const tier = tierOf(state);
  const score = new Score(seed);
  [0, 0.02, 0.045, 0.085].forEach((after, i) => {
    score.add(after, 'crackle', -3 - 2 * i, { hz: vary(1900, seed + i, 0.5) });
  });
  score.add(0, 'thud', -22, { hz: 150 - 8 * tier });
  if (tier >= 2) score.add(0.03, 'tick', -17, { hz: 700 + 350 * tier });
  if (gnawed) score.add(0, 'rumble', -27, { seconds: 0.35 });
  return score.cues;
}

/**
 * The chime a piece makes when it is raised, by the level it reaches: open fifths and octaves of the
 * music's D, so that it sits in the major of the day and the minor of the night alike. A higher
 * level has more notes.
 */
const CHIMES: readonly (readonly string[])[] = [
  ['D5'],
  ['D5', 'A5'],
  ['D5', 'A5', 'D6'],
  ['A4', 'D5', 'A5', 'D6'],
];

/** A piece raised in place: a motor's whirr and the chime of the level it reaches. */
function raised(level: number, seed: number, heavy: boolean): MusicCue[] {
  const score = new Score(seed);
  if (heavy) score.add(0, 'step', -17, { hz: vary(120, seed, 0.04) });
  score.add(0, 'servo', heavy ? -11 : -13, { hz: 200, to: heavy ? 450 : 520, seconds: 0.16 });
  const notes = CHIMES[Math.min(CHIMES.length, Math.max(1, level)) - 1] as readonly string[];
  notes.forEach((note, i) => {
    score.add(0.11 + 0.075 * i, 'pluck', -18, { hz: noteHz(note), seconds: 0.7 });
  });
  return score.cues;
}

/** A module set down: a heavy knock, and what it is (a terminal's boot chirps, a turret's barrel locking, a generator's winding up). */
function modulePlaced(module: number, seed: number): MusicCue[] {
  const score = new Score(seed);
  switch (module) {
    case MODULE.terminal:
      score.add(0, 'step', -16, { hz: 150 });
      [1000, 1250, 1500].forEach((hz, i) => score.add(0.1 + 0.07 * i, 'blip', -18, { hz }));
      break;
    case MODULE.turret:
      score.add(0, 'step', -15, { hz: 120 });
      score.add(0.05, 'servo', -11, { hz: 130, to: 300, seconds: 0.3 });
      score.add(0.3, 'tick', -12, { hz: 1100 });
      break;
    case MODULE.generator:
      score.add(0, 'step', -14, { hz: 100 });
      score.add(0.05, 'whoom', -25, { hz: 70 });
      score.add(0.1, 'servo', -8, { hz: 110, to: 380, seconds: 0.6 });
      break;
    case MODULE.node:
      score.add(0, 'step', -18, { hz: 170 });
      score.add(0.08, 'blip', -17, { hz: 1700 });
      score.add(0.16, 'blip', -19, { hz: 2200 });
      break;
    case MODULE.storage:
      score.add(0, 'step', -14, { hz: 110 });
      score.add(0.02, 'tick', -11, { hz: 650 });
      score.add(0.12, 'step', -20, { hz: 190 });
      break;
    case MODULE.bed:
      score.add(0, 'step', -18, { hz: 130 });
      score.add(0.02, 'steam', -12, { hz: 1800, seconds: 0.35 });
      break;
    case MODULE.light:
      score.add(0, 'step', -20, { hz: 200 });
      score.add(0.03, 'tick', -14, { hz: 2400 });
      score.add(0.1, 'blip', -21, { hz: 1900 });
      break;
    default:
      score.add(0, 'step', -16, { hz: 150 });
  }
  return score.cues;
}

/** A module taken apart: the collapse, a snap of what was inside it and the motor running down. */
function moduleBroken(gnawed: boolean, seed: number): MusicCue[] {
  const score = new Score(seed);
  score.add(0, 'thud', -20, { hz: 110 });
  [0.01, 0.04, 0.07].forEach((after, i) => {
    score.add(after, 'crackle', -5 - 2 * i, { hz: vary(2200, seed + i, 0.4) });
  });
  score.add(0.02, 'servo', -13, { hz: 400, to: 90, seconds: 0.3 });
  if (gnawed) score.add(0, 'rumble', -27, { seconds: 0.35 });
  return score.cues;
}

/**
 * What a change to a cell sounds like, from the host's event and what the cell held before it: a
 * block or a module set down, one raised in place, one broken (by a player, or gnawed through by
 * the machines, which adds the earth). Null for a change that makes no sound.
 */
export function effectForEdit(event: BlockSetEvent, previous: CellState): Effect | null {
  const { x, y, z, state } = event;
  if (state === previous) return null;
  const seed = hash3(0x65646974, x, y, z) ^ state;
  const at = middleOf(x, y, z);
  const gnawed = event.by === NO_PLAYER;
  // What was done to the cell tells one source from another: a module broken just after it was set down is not a repeat.
  const key = (what: number): number => hash3(what, x, y, z);
  if (state === 0) {
    const module = moduleOfShape(stateShape(previous));
    return module
      ? { kind: 'module', at, key: key(0x62726b6d), cues: moduleBroken(gnawed, seed) }
      : { kind: 'break', at, key: key(0x62726b62), cues: blockBroken(previous, gnawed, seed) };
  }
  const module = moduleOfShape(stateShape(state));
  if (previous === 0) {
    return module
      ? { kind: 'module', at, key: key(0x706c616d), cues: modulePlaced(module.id, seed) }
      : { kind: 'place', at, key: key(0x706c6162), cues: blockPlaced(state, seed) };
  }
  // One piece in place of another: the same piece at a better level.
  return {
    kind: 'raise',
    at,
    key: key(0x72616973),
    cues: raised(stateMaterial(state), seed, module !== undefined),
  };
}

/** A module that already stood and has come on or gone dark. */
export interface PowerFlip {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly on: boolean;
}

/**
 * What the modules that changed their power sound like: a winding up and a ready chirp for one that
 * comes on, a winding down for one that goes dark. Of all that changed together (a Generator placed
 * lights a whole base) only the nearest of each is heard, so that a base does not start a chorus.
 */
export function effectsForPower(flips: readonly PowerFlip[], listener: Listener | null): Effect[] {
  let on: PowerFlip | null = null;
  let off: PowerFlip | null = null;
  let onAway = Number.POSITIVE_INFINITY;
  let offAway = Number.POSITIVE_INFINITY;
  for (const flip of flips) {
    const away = listener
      ? Math.hypot(flip.x + 0.5 - listener.x, flip.y + 0.5 - listener.y, flip.z + 0.5 - listener.z)
      : 0;
    if (flip.on) {
      if (away < onAway) {
        on = flip;
        onAway = away;
      }
    } else if (away < offAway) {
      off = flip;
      offAway = away;
    }
  }
  const out: Effect[] = [];
  if (on) {
    const seed = hash3(0x706f776e, on.x, on.y, on.z);
    const score = new Score(seed)
      .add(0, 'servo', -6, { hz: 160, to: 520, seconds: 0.4 })
      .add(0.38, 'blip', -12, { hz: 1320 });
    out.push({ kind: 'power', at: middleOf(on.x, on.y, on.z), key: 1, cues: score.cues });
  }
  if (off) {
    const seed = hash3(0x706f7766, off.x, off.y, off.z);
    const score = new Score(seed).add(0, 'servo', -7, { hz: 480, to: 140, seconds: 0.45 });
    out.push({ kind: 'power', at: middleOf(off.x, off.y, off.z), key: 2, cues: score.cues });
  }
  return out;
}

/** The click that was turned away: two dull knocks, the second lower, and a tick on the first, in the player's head. */
export function effectForRefusal(): Effect {
  const score = new Score(0x72656675)
    .add(0, 'step', -20, { hz: 170 })
    .add(0.07, 'step', -22, { hz: 130 })
    .add(0, 'tick', -8, { hz: 700 });
  return { kind: 'refuse', cues: score.cues };
}

/** The pitch of the tap that tells a heap's material: a better grade rings higher. */
export const GRADE_TAP = [1800, 2200, 2700, 3300] as const;

/**
 * A heap stripped: the snap of scrap coming away, a ring of the grade it gave, and when the heap is
 * gone its fall. A pool with no room left answers with a dull knock where the ring would be.
 */
export function effectForHarvest(event: HarvestEvent, at: Vec3): Effect {
  const seed = hash3(0x68617276, event.node, event.left, event.material);
  const score = new Score(seed);
  [0, 0.025, 0.06].forEach((after, i) => {
    score.add(after, 'crackle', -5 - i, { hz: vary(2400, seed + i, 0.4) });
  });
  score.add(0.03, 'step', -23, { hz: 200 });
  if (event.full) {
    score.add(0.1, 'step', -22, { hz: 130 });
  } else {
    const grade = Math.min(GRADE_TAP.length, Math.max(1, event.material));
    score.add(0.1, 'tick', -17, { hz: GRADE_TAP[grade - 1] as number });
  }
  if (event.left === 0) {
    score.add(0.1, 'thud', -22, { hz: 130 });
    score.add(0.1, 'rumble', -30, { seconds: 0.25 });
  }
  return { kind: 'harvest', at, key: event.node, cues: score.cues };
}
