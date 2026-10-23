import { MATERIAL } from '../../shared/blocks';
import { ENEMY_KIND } from '../../shared/enemy-state';

/**
 * Every number that shapes the survival loop, in one table so it can be tuned and tested without
 * hunting through the code. The length of the day and the night is not here: it is
 * `DAY_SECONDS` and `NIGHT_SECONDS` in `shared/daycycle.ts`, because the sky reads it too
 * (8 minutes of day and 4 of night, see docs/decisions.md).
 */
export const SURVIVAL = {
  /**
   * A host whose page was blocked or throttled (a hidden tab) catches up by at most this much game
   * time in one go. A longer gap is lost, not replayed: nobody wants a night to fly by in the
   * second a tab comes back.
   */
  maxCatchUpSeconds: 2,

  /**
   * The Outpost Core, the station's reactor: the run ends when its health reaches 0. The numbers
   * are a first guess to be tuned once enemies hit it (docs/decisions.md, Phase 4b).
   */
  core: {
    maxHealth: 1000,
    /** Health the Core mends each second of daylight: a full repair takes half the day (four minutes). */
    mendPerSecond: 1000 / 240,
  },
} as const;

/**
 * What each player carries: Health and Energy (the hunger analog of the spec). The numbers are a
 * first guess to be tuned once enemies hurt and building costs something (docs/decisions.md,
 * Phase 4c). Rates are per second of the run, so they stop where the run's clock stops.
 */
export const VITALS = {
  maxHealth: 100,
  maxEnergy: 100,

  /** Health mends by itself, once nothing has hurt the player for `regenDelay` seconds and while some Energy is left. */
  regenDelay: 8,
  regenPerSecond: 1.5,

  energy: {
    /** What being alive costs: a full bar lasts about twenty minutes of standing about. */
    idlePerSecond: 0.08,
    /** What sprinting costs on top of that: about three minutes of running from a full bar. */
    sprintPerSecond: 0.5,
    /** What a fight costs on top of that, for `combatSeconds` after the player was last hurt. */
    combatPerSecond: 0.4,
    combatSeconds: 6,
    /** One block placed or broken. A held click repeats about six times a second, so heavy building costs about 1.5 a second. */
    perEdit: 0.25,
    /** One shot of the pulse blaster. */
    perShot: 0.6,
    /** Below this fraction of a full bar the player slows down, more the lower it gets... */
    lowAt: 0.25,
    /** ...to this fraction of their walking and sprinting speed, and of how fast their hands repeat, with none left. */
    emptySpeed: 0.65,
    emptyHands: 0.5,
  },

  /**
   * The Core's charge field: within this many blocks of the Core's walls it restores Energy, for as
   * long as the Core stands. It is how a crew that works at the base never runs dry, and why a long
   * trip away costs something.
   */
  chargeField: {
    radius: 8,
    perSecond: 2.5,
  },
} as const;

/**
 * The pulse blaster, the weapon every player starts with: a bolt that goes where the crosshair is
 * and hurts the first machine on its way. A first guess to be tuned by playing (docs/decisions.md,
 * Phase 4e). What a shot costs in Energy is `VITALS.energy.perShot`.
 */
export const BLASTER = {
  /** Points a hit takes off a machine: three shots fell a crawler. */
  damage: 10,
  /** Seconds between shots with Energy to spare; low Energy slows the hands, and so the blaster, as it slows a held click. */
  interval: 0.35,
  /** How far a bolt flies, in blocks. */
  range: 40,
  /** Shots the host lets a player bank, so two shots that were held up on the way both land. */
  burst: 2,
} as const;

/**
 * Going down and coming back. A player at no Health lies where they fell and the machines leave
 * them be, until the Core brings them back at the base, if the crew has a respawn charge to spend
 * (SPEC section 8: death is soft). The charges are shared: each player brings a few, each dawn
 * brings one more for every player, and a crew whose players are all down with none left has lost
 * the run. A first guess to be tuned by playing (docs/decisions.md, Phase 4g).
 */
export const RESPAWN = {
  /** Charges each player brings to the run, what each dawn adds for every player, and the most the crew holds for every player. */
  startPerPlayer: 2,
  dawnPerPlayer: 1,
  capPerPlayer: 3,
  /** Seconds a downed player lies where they fell before the Core brings them back. */
  delaySeconds: 6,
  /** The Energy a player comes back with, as a fraction of a full bar; Health comes back full. */
  energy: 0.5,
  /** Coming back leaves a player shaken: for this long their Energy drains faster and the blaster hits softer. */
  shaken: {
    seconds: 45,
    drainScale: 1.5,
    damageScale: 0.6,
  },
} as const;

/**
 * The machines that come for the Core. Every number is a first guess to be tuned by playing
 * (docs/decisions.md, Phase 4d); blocks have no health of their own until Phase 5, so the time an
 * enemy takes to break one stands in for it.
 */
export const ENEMIES = {
  /** The most enemies alive at once, however they were spawned. The wire carries this many and no more. */
  maxAlive: 100,

  /** Enemies come in from a ring this many blocks from the middle of the Core, give or take `spawnJitter`. */
  spawnRadius: 46,
  spawnJitter: 4,
  /** How far from the Core the enemies know the way across, in blocks. The ring they spawn on lies well inside. */
  navRadius: 64,
  /** Ground more than this far under the water is not walked into. */
  wadeDepth: 0.5,
  /** After a block changes, the routes are worked out again at most this often. */
  navRefreshSeconds: 0.25,
  /** An enemy looks this many steps down its route for a spot it can walk to in a straight line. */
  lookAhead: 8,
  /** A hit lights the enemy for this long. */
  hurtFlashSeconds: 0.18,
  /** An enemy that has picked a player to chase keeps on until the player is this many times farther than the pull. */
  aggroKeep: 1.3,
  /** An enemy chews a wall from this far from it, middle to face. */
  gnawReach: 0.75,
  /** Chewing that stops (nobody is at the wall any more) wears off at this fraction of a block a second. */
  gnawRecoverPerSecond: 0.2,

  /** The first machine: a small six-legged drone that walks the ground, bites whatever is near and chews through walls. */
  crawler: {
    health: 30,
    /** Blocks a second on level ground; a player walks at 4.4 and sprints faster. */
    speed: 2.6,
    /** Radians a second it can turn. */
    turnRate: 8,
    /** How wide and how tall its body is, for walls and for crowding. */
    radius: 0.45,
    height: 0.9,
    /**
     * How big a target it is for a bolt: a box standing on its feet, a little more than its body
     * (the legs count), so a shot that looks true is one.
     */
    hitbox: { halfWidth: 0.6, height: 1 },
    /** The highest step it climbs, in blocks. Anything taller is a wall. */
    step: 1,
    /** Points a bite takes off a player and off the Core, how long it winds up and how often it begins one. */
    bite: { player: 6, core: 5, windup: 0.4, interval: 1 },
    /**
     * How close it must be to bite, from its middle to the middle of a player or to the side of the
     * Core; and how far above or below it a player can be and still be bitten.
     */
    reach: { player: 1.4, core: 0.95, height: 1.5 },
    /** Players this close pull it off its way to the Core. */
    aggro: 7,
    /** Seconds one crawler takes to chew through one block, by material: tougher blocks hold longer. */
    gnawSeconds: {
      [MATERIAL.scrap]: 2,
      [MATERIAL.composite]: 3.5,
      [MATERIAL.alloy]: 6,
      [MATERIAL.energy]: 9,
    } as Readonly<Record<number, number>>,
    /** What a block of a material this table does not know takes to chew. */
    gnawDefault: 2,
  },
} as const;

/**
 * The waves that come on each night. The counts follow the notes of the spec for the first four
 * nights (6, 8, 10, then 12 drones and one armored) and add two a night after that, with a few
 * more of the tougher kinds as the nights go on; from the third night the machines are a little
 * tougher, and from the fifth each night's are 8 percent tougher than the last night's. Every
 * number is a first guess to be tuned by playing (docs/decisions.md, Phase 4f) and later by the
 * balance simulator of Phase 5.
 */
export const WAVES = {
  /** Machines on each of the first nights, the specials included. */
  totals: [6, 8, 10, 13],
  /** Machines a night adds after the last of those. */
  perNightAfter: 2,

  /**
   * The special kinds, which take their places among the night's total. A kind comes from the
   * night `from` with one machine, and one more every `every` nights.
   */
  specials: [
    { kind: 'armored', from: 4, every: 3 },
    { kind: 'flyer', from: 5, every: 4 },
    { kind: 'breacher', from: 9, every: 4 },
  ] as const,

  /**
   * What each kind is until Phase 5 gives the new ones bodies of their own: every one of them
   * walks, is drawn and fights as a crawler, and has this many times a crawler's Health.
   */
  kinds: {
    crawler: { health: 1 },
    armored: { health: 2 },
    flyer: { health: 1 },
    breacher: { health: 1 },
  },

  /** How much tougher the machines are: from the night `toughFrom` by `tough`, and from `growsFrom` that much again for each night. */
  health: { toughFrom: 3, tough: 1.1, growsFrom: 5, grows: 1.08 },

  /** A night's machines come in waves of about this many, and in no more than `maxWaves`. */
  perWave: 6,
  maxWaves: 6,

  /** Seconds after nightfall, and seconds between machines, for the waves of a night. */
  timing: {
    /** The first wave comes out of the ground this long after nightfall. */
    firstAt: 14,
    /** The last wave comes at the latest this long after nightfall: the walk to the Core takes it about twenty seconds. */
    lastAt: 170,
    /** Two waves of a night are at most this far apart. */
    maxGap: 70,
    /** The crew is told this long before a wave comes. */
    warning: 10,
    /** One machine of a wave comes out of the ground this long after the one before it. */
    release: 0.4,
  },

  /** A wave comes from one side: half the width, in radians, of the arc of the ring that it keeps to. */
  arc: Math.PI / 5,
} as const;

/** The target a machine of this kind is for a bolt, or undefined for a kind this table does not know. */
export function hitboxOf(
  kind: number,
): { readonly halfWidth: number; readonly height: number } | undefined {
  return kind === ENEMY_KIND.crawler ? ENEMIES.crawler.hitbox : undefined;
}
