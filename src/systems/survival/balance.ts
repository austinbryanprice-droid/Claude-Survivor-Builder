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

/** The target a machine of this kind is for a bolt, or undefined for a kind this table does not know. */
export function hitboxOf(
  kind: number,
): { readonly halfWidth: number; readonly height: number } | undefined {
  return kind === ENEMY_KIND.crawler ? ENEMIES.crawler.hitbox : undefined;
}
