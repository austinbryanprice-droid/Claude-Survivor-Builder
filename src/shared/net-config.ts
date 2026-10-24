/**
 * Every number that shapes the multiplayer layer, in one table so it can be tuned (and tested)
 * without hunting through the code. Times are milliseconds, distances are blocks.
 */
export const NET = {
  /** Bumped whenever a message changes shape; a host and a guest on different versions refuse each other. */
  protocolVersion: 9,
  maxPlayers: 4,

  /** The local player's state is sent about this often (about 20 Hz). */
  stateIntervalMs: 50,
  /** The host sends everyone's state on to the guests at most this often. */
  relayIntervalMs: 50,
  /** Other players are drawn this far behind their newest sample, so two samples usually bracket the draw time. */
  interpDelayMs: 100,
  /** A pose is carried forward on its velocity for at most this long when samples run late. */
  extrapolateMs: 250,
  /** A hop of more than this between two samples with no reset flag is drawn as a teleport, not a glide. */
  snapDistance: 6,
  /** How many samples a remote player's track keeps. */
  trackLength: 32,

  /** The host tells guests where the survival clock stands at least this often while it runs. */
  survivalIntervalMs: 500,
  /** ...and within this long of the Core's health changing, so a fight at the base shows as it happens. */
  coreIntervalMs: 200,
  /** A guest hears of a change to its own Health or Energy within this long (and not more often). */
  vitalsIntervalMs: 250,
  /** The host sends where every machine is this often (10 Hz), as one packet. */
  enemyIntervalMs: 100,
  /** With no machines to report it still says so this often, so a guest that lost the news does not keep drawing ghosts. */
  enemyKeepAliveMs: 1000,
  /** A guest draws the machines this far behind the newest packet, so two packets usually bracket the draw time. */
  enemyDelayMs: 150,
  /** The host draws them this far behind its own newest step, which it takes every `relayIntervalMs`. */
  enemyHostDelayMs: 70,
  /** The most machines one packet carries: more than a night will ever field. */
  maxEnemies: 128,
  /**
   * How many reports of the machines the mirror keeps: a guest's at ten a second, the host's at
   * twenty. The host's is also what it rewinds to when it decides a shot, so it holds at least
   * `maxRewindMs` of history.
   */
  enemyHistory: 12,
  /**
   * A shot is judged against the machines as they were on the shooter's screen, which is the
   * shooter's draw delay plus the trip to the host behind the host's present. No further back than
   * this: a shooter with a worse connection than that aims a little behind.
   */
  maxRewindMs: 500,
  /**
   * A shot starts where the shooter's camera is, which in third person is behind them and which the
   * host's idea of where they stand trails. A shot claimed from farther than this from the shooter's
   * eyes starts from the eyes.
   */
  shotOriginSlack: 6,

  pingIntervalMs: 2000,
  /**
   * A session tick that runs this much later than due means the page itself was blocked, and the
   * silence during the stall is not held against the other side. A background tab's timer, which
   * a browser slows to one tick a second, is late by less than this and is not a stall.
   */
  stallMs: 2000,
  /** The other side has gone quiet for this long, so the link is declared dead. */
  timeoutMs: 10_000,
  /** The host drops a link that has not said hello this long after opening. */
  helloTimeoutMs: 8000,
  /** A guest gives up on reaching the host after this long. */
  dialTimeoutMs: 20_000,
  /** Registering with the matchmaking server (the broker) gives up after this long. */
  brokerTimeoutMs: 10_000,
  /** A direct connection to the host that has not opened this long after the broker answered is given up on. */
  connectTimeoutMs: 15_000,
  /** The host keeps at most this many half-open connections from players still connecting. */
  pendingLinksMax: 16,
  /** A fast-lane packet is dropped, not queued, when the channel already holds this many unsent messages. */
  fastBacklogMax: 4,
  /** A guest gives up waiting for the host's answer after this long. */
  welcomeTimeoutMs: 15_000,
  /** A guest waits this long for the fast channel before it rides on the ordered one. */
  fastChannelWaitMs: 6000,
  /** A room code that the broker says is taken is replaced, up to this many times. */
  codeRetries: 8,
  /** How many departed guests the host remembers, by token, for a return to the same seat. */
  departedKept: 16,

  roomCodeLength: 5,
  maxNameLength: 16,
  /** Longest control frame accepted from the other side, in UTF-16 units. */
  maxFrameLength: 20_000,

  /** A block can be placed or broken this far from the player's eyes... */
  editReach: 6,
  /** ...plus this much, because the host's idea of where the player is trails by a fraction of a second. */
  editReachSlack: 3,
  /** Edits per second a guest may sustain, and the burst it may spend at once. */
  editRatePerSecond: 12,
  editBurst: 24,

  /** Edits per snapshot frame, which keeps each frame well under every browser's message limit. */
  snapshotEditsPerFrame: 1000,
  /** A snapshot larger than this is refused. */
  maxSnapshotEdits: 400_000,

  /** Movement checks (the host's sanity check of a guest's own movement). */
  move: {
    /** Allowed speed as a multiple of the fastest speed the controller can reach. */
    speedSlack: 1.35,
    /** How much unspent movement may be banked, in seconds of top speed, so a burst of delayed packets passes. */
    burstSeconds: 1.5,
    /** A guest whose body centre sits inside a solid block for this long is moved back. */
    insideSolidMs: 600,
    /**
     * A reset (the fall-out-of-the-world respawn) is believed when the last accepted position was
     * below this height. No ground in any valley is lower than about 2, and the game puts a player
     * back at the start once they fall below -10, but the report before that can be a few blocks
     * higher, so this sits just under the lowest ground.
     */
    resetBelowY: -1,
    /** Beyond this the position is nonsense and the report is dropped. */
    limit: 4000,
  },
} as const;
