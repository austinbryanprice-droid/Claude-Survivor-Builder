import type {
  BlockCommand,
  CloseInfo,
  PlayerId,
  PlayerInfo,
  PlayerSample,
  RemotePose,
  WorldEvent,
} from '../shared/protocol';

export type Unsubscribe = () => void;

/**
 * `solo` is a host with nobody else in the room (single-player and tests), `host` has opened a
 * room, and `guest` joined someone else's. All three go through the same command path.
 */
export type SessionRole = 'solo' | 'host' | 'guest';

/**
 * `connecting` is dialling and handshaking, `loading` is receiving and building the host's world,
 * `open` is playing, `closed` is over for good (see `GameSession.closed` for why).
 */
export type SessionPhase = 'connecting' | 'loading' | 'open' | 'closed';

/** One row of the room list. */
export interface RosterEntry extends PlayerInfo {
  /** Round trip to the host in milliseconds; null until measured (and for the host itself). */
  readonly pingMs: number | null;
}

/** A command the host refused, with a short reason fit to show the player. */
export interface Rejection {
  readonly command: BlockCommand;
  readonly reason: string;
}

/** The host moved this player (a movement check failed). */
export interface Correction {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Counters for the debug overlay and the tests. */
export interface NetStats {
  /** This player's own round trip to the host; null for the host and solo play. */
  rttMs: number | null;
  /** State packets dropped because a newer one had already arrived. */
  staleDropped: number;
  /** Times the host moved a guest back (host) or moved this player back (guest). */
  corrections: number;
  /** Commands refused (host) or refusals received (guest). */
  rejections: number;
  /** Malformed frames ignored. */
  badFrames: number;
}

/**
 * What the rest of the game sees of the network. Input code calls `sendCommand`; the session
 * validates it on the host, and every peer, the host and the sender included, gets the same
 * `WorldEvent`s in the same order. The session applies each event to the world itself
 * (`BlockWorld.setBlock`) before it tells `onEvent` listeners, so listeners only react: remesh
 * dirty chunks, play a sound, spawn particles.
 */
export interface GameSession {
  readonly role: SessionRole;
  readonly phase: SessionPhase;
  readonly localId: PlayerId;
  /** The room code to share, or null when there is no room (solo play). */
  readonly roomCode: string | null;
  /** Everyone in the room, the local player included, in slot order. */
  readonly players: readonly RosterEntry[];
  /** Why the session ended, once `phase` is `closed`. */
  readonly closed: CloseInfo | null;
  readonly stats: Readonly<NetStats>;

  /** Asks the host to change the world. Fire and forget: the result arrives as an event or a rejection. */
  sendCommand(command: BlockCommand): void;

  onEvent(listener: (event: WorldEvent) => void): Unsubscribe;
  onRejected(listener: (rejection: Rejection) => void): Unsubscribe;
  /** The room list changed (someone joined, left, or a ping moved). */
  onPlayers(listener: () => void): Unsubscribe;
  onPhase(listener: (phase: SessionPhase) => void): Unsubscribe;
  /** The host moved the local player: teleport there. Guests only. */
  onCorrection(listener: (correction: Correction) => void): Unsubscribe;

  /**
   * Tells the session where the local player is. Call it every frame or tick; the session sends
   * at its own rate (about 20 a second) and ignores the calls in between.
   */
  publishState(sample: PlayerSample, nowMs: number): void;

  /**
   * Where to draw the other players at `nowMs` (a `performance.now()` value). The array and the
   * poses in it are reused: read them before the next call.
   */
  sampleRemotes(nowMs: number): readonly RemotePose[];

  /** Leaves the room, or closes it when hosting. Safe to call more than once. */
  close(): void;
}
