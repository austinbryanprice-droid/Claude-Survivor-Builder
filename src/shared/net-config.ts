/**
 * Every number that shapes the multiplayer layer, in one table so it can be tuned (and tested)
 * without hunting through the code. Times are milliseconds, distances are blocks.
 */
export const NET = {
  /** Bumped whenever a message changes shape; a host and a guest on different versions refuse each other. */
  protocolVersion: 1,
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

  pingIntervalMs: 2000,
  /** The other side has gone quiet for this long, so the link is declared dead. */
  timeoutMs: 10_000,
  /** The host drops a link that has not said hello this long after opening. */
  helloTimeoutMs: 8000,
  /** A guest gives up on reaching the host after this long. */
  dialTimeoutMs: 20_000,
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
    /** Below this height a reset (the fall-out-of-the-world respawn) is believed. */
    resetBelowY: -20,
    /** Beyond this the position is nonsense and the report is dropped. */
    limit: 4000,
  },
} as const;
