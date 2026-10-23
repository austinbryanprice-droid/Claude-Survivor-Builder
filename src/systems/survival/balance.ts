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
