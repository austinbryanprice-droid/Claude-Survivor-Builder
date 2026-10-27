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

/** What a turret does at one of its levels. */
export interface TurretLevel {
  /** How far it sees, in blocks, from the pivot of its head to the middle of a machine's body. */
  readonly range: number;
  /** Points a hit takes off a machine. */
  readonly damage: number;
  /** Seconds between its shots. */
  readonly interval: number;
  /** How heavy its bolt is drawn, against a player's blaster at 1: the bolt's width and its light. */
  readonly heft: number;
}

/**
 * The turrets, the crew's own guns (Phase 5f): each one that stands shoots the nearest machine it has
 * a clear line to, with no one at the trigger and no Energy spent. A first guess to be tuned by
 * playing (docs/decisions.md, Phase 5f) and by the balance simulator of 5j. The basic turret does a
 * little over a third of what the blaster does; the Auto Turret (Tier 2) does two thirds of it and
 * the Heavy Turret (Tier 3) a good deal more, from farther away (5f2).
 */
export const TURRET = {
  /** Where on a machine it aims, as a fraction of the height of the box a bolt is judged against. */
  aimHeight: 0.5,
  /** The machines a turret tries for in one step, nearest first, before it gives the step up: the ones behind a wall are not shot. */
  tries: 3,
  /**
   * What a turret does at each level, from the first. A level this table does not have is the last one
   * it has. The level is the material byte of its cell, and the names and prices of the steps are in
   * the module table (`MODULES`). That is 10, 20 and 40 points a second, against the blaster's 28.6.
   */
  levels: [
    { range: 18, damage: 5, interval: 0.5, heft: 1 },
    { range: 20, damage: 5, interval: 0.25, heft: 1 },
    { range: 26, damage: 24, interval: 0.6, heft: 2 },
  ] as readonly TurretLevel[],
  /**
   * How many times faster a turret shoots while it has power (Phase 5g2): the wait between its shots is
   * its level's `interval` divided by this. Power is a boost and never a requirement, so a turret with
   * none shoots as it did before there was any.
   */
  poweredRate: 1.5,
} as const;

/**
 * Power (Phase 5g, SPEC section 9): a module that gives something off gives it by radius, to whatever is
 * within reach of the middle of its cell, with no wiring and nothing to run. A first guess to be tuned
 * by playing (docs/decisions.md, Phase 5g) and by the balance simulator of 5j.
 */
export const POWER = {
  /**
   * The Generator's charge field: a player within `radius` blocks of the middle of its cell, measured to
   * the middle of their body, gets `perSecond` Energy back for as long as it stands. It is a smaller,
   * slower copy of the Core's field (`VITALS.chargeField`: 8 blocks and 2.5 a second), so a crew that
   * works out at a wall or a turret does not have to walk home to recover. It more than pays for a run
   * (0.5 a second for sprinting on top of the idle drain) and for a slow build, but not for a held
   * click at full pace (six edits a second cost 1.5). It does not stack with another field: a player
   * gets the best one they stand in.
   */
  generator: {
    radius: 6,
    perSecond: 1,
  },
  /**
   * The Power Node (5g2): a relay. A Node that has power, from a Generator or from another Node, carries it
   * `radius` blocks on, to the turrets and Nodes within that reach of the middle of its cell, who then have
   * it too. It gives no Energy to a player: only a Generator and the Core do that. A Generator carries
   * power as far as it charges (its `radius` above), middle of cell to middle of cell.
   */
  node: {
    radius: 8,
  },
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

/** What a kind of machine is: its body, its bite, how much of a hit it takes and what it leaves behind. */
export interface EnemyBody {
  /** Points of Health at the start, before the night makes it tougher. */
  readonly health: number;
  /** Blocks a second on level ground. */
  readonly speed: number;
  /** Radians a second it can turn. */
  readonly turnRate: number;
  /** How wide and how tall its body is, for walls and for crowding. */
  readonly radius: number;
  readonly height: number;
  /** How big a target it is for a bolt: a box standing on its feet. */
  readonly hitbox: { readonly halfWidth: number; readonly height: number };
  /** The highest step it climbs, in blocks. */
  readonly step: number;
  /** Points a bite takes off a player and off the Core, how long it winds up and how often it begins one. */
  readonly bite: {
    readonly player: number;
    readonly core: number;
    readonly windup: number;
    readonly interval: number;
  };
  /** How close it must be to bite a player or the Core, and how far above or below it a player can be and still be bitten. */
  readonly reach: {
    readonly player: number;
    readonly core: number;
    readonly height: number;
  };
  /** Players this close pull it off its way to the Core. */
  readonly aggro: number;
  /** Seconds it takes to chew through one block, by material, and for a material the table does not know. */
  readonly gnawSeconds: Readonly<Record<number, number>>;
  readonly gnawDefault: number;
  /** The share of a hit's points it takes: 1 for plain steel, less for plating. */
  readonly takes: number;
  /** What the crew finds in the pool when it fells one (Tier 4 cells drop only from special machines), or null. */
  readonly drop: { readonly material: number; readonly amount: number } | null;
}

/** Seconds one machine of the crawler's kind takes to chew through one block, by material: tougher blocks hold longer. */
const GNAW_SECONDS: Readonly<Record<number, number>> = {
  [MATERIAL.scrap]: 2,
  [MATERIAL.composite]: 3.5,
  [MATERIAL.alloy]: 6,
  [MATERIAL.energy]: 9,
};

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
    gnawSeconds: GNAW_SECONDS,
    /** What a block of a material this table does not know takes to chew. */
    gnawDefault: 2,
    /** Plain steel: a hit takes all of its points off, and a felled crawler leaves nothing. */
    takes: 1,
    drop: null,
  },

  /**
   * The armored crawler (Phase 5i1): the crawler's bigger, slower cousin, plated so that every hit
   * takes only `takes` of its points off. It walks the same map and chews the same walls, bites a
   * little harder and does not turn on a coin. The crew that fells one finds Tier 4 cells in its pool.
   * A first guess to be tuned by playing (docs/decisions.md, Phase 5i1) and by the balance simulator
   * of 5j: with a night's tougher steel it takes about fourteen shots of the blaster to fell.
   */
  armored: {
    health: 75,
    speed: 2,
    turnRate: 6,
    radius: 0.5,
    height: 1.1,
    hitbox: { halfWidth: 0.75, height: 1.25 },
    step: 1,
    bite: { player: 9, core: 8, windup: 0.5, interval: 1.2 },
    reach: { player: 1.6, core: 1, height: 1.5 },
    aggro: 6,
    gnawSeconds: GNAW_SECONDS,
    gnawDefault: 2,
    takes: 0.6,
    drop: { material: MATERIAL.energy, amount: 3 },
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
   * The body each kind of the plan has (`ENEMY_KIND`), and how many times that body's Health it has.
   * The armored crawler has its own body (5i1); the flyer and the breacher walk, are drawn and fight
   * as crawlers until 5i2 and 5i3 give them theirs.
   */
  kinds: {
    crawler: { body: ENEMY_KIND.crawler, health: 1 },
    armored: { body: ENEMY_KIND.armored, health: 1 },
    flyer: { body: ENEMY_KIND.crawler, health: 1 },
    breacher: { body: ENEMY_KIND.crawler, health: 1 },
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

/** The body of a kind of machine, or undefined for a kind this table does not know. */
export function bodyOf(kind: number): EnemyBody | undefined {
  switch (kind) {
    case ENEMY_KIND.crawler:
      return ENEMIES.crawler;
    case ENEMY_KIND.armored:
      return ENEMIES.armored;
    default:
      return undefined;
  }
}

/** The target a machine of this kind is for a bolt, or undefined for a kind this table does not know. */
export function hitboxOf(
  kind: number,
): { readonly halfWidth: number; readonly height: number } | undefined {
  return bodyOf(kind)?.hitbox;
}
