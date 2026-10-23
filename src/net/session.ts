import type { BlockWorld } from '../shared/block-world';
import type { EnemyPose } from '../shared/enemy-state';
import type { Vec3 } from '../shared/look';
import type {
  BlockCommand,
  CloseInfo,
  EditRecord,
  PlayerId,
  PlayerInfo,
  PlayerSample,
  RemotePose,
  WorldEvent,
} from '../shared/protocol';
import type { ShotEvent } from '../shared/shot';
import type { SurvivalView, Unsubscribe } from '../shared/survival-state';
import type { VitalsView } from '../shared/vitals-state';

export type { Unsubscribe } from '../shared/survival-state';

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
  /**
   * False while a room is open but the matchmaking server has lost track of it, so nobody new
   * can find it (the players already inside are not affected). True in every other case. A
   * change is announced through `onPlayers`.
   */
  readonly roomOnline: boolean;
  readonly stats: Readonly<NetStats>;

  /**
   * The survival loop as this peer sees it: the day and night clock now, and what the host
   * announces. A guest reads a mirror of the host's last word; the host reads its own simulation.
   */
  readonly survival: SurvivalView;

  /**
   * The local player's Health and Energy: the host reads its own player from the simulation, and a
   * guest reads a mirror of what the host last told it.
   */
  readonly vitals: VitalsView;

  /** Asks the host to change the world. Fire and forget: the result arrives as an event or a rejection. */
  sendCommand(command: BlockCommand): void;

  /**
   * Fires the pulse blaster from the camera at `origin` along the unit vector `dir`. Fire and
   * forget: the host judges the shot against the machines as this screen drew them, and everyone,
   * the shooter included, hears what became of it through `onShot`.
   */
  fire(origin: Vec3, dir: Vec3): void;

  /**
   * Tells the session whether the local player is playing right now (the mouse is captured).
   * Alone in the world the survival clock is held while nobody is playing; in a room it runs as
   * long as anyone else is there. Guests ignore it: the host decides.
   */
  setLocalActive(active: boolean): void;

  onEvent(listener: (event: WorldEvent) => void): Unsubscribe;
  onRejected(listener: (rejection: Rejection) => void): Unsubscribe;
  /** The host decided a shot of the pulse blaster: anyone's, the local player's included. */
  onShot(listener: (shot: ShotEvent) => void): Unsubscribe;
  /** The room list changed (someone joined, left, or a ping moved). */
  onPlayers(listener: () => void): Unsubscribe;
  onPhase(listener: (phase: SessionPhase) => void): Unsubscribe;
  /** The host moved the local player: teleport there. Guests only. */
  onCorrection(listener: (correction: Correction) => void): Unsubscribe;

  /**
   * Tells the session where the local player is. Call it every frame or tick; the session sends
   * at its own rate (about 20 a second) and ignores the calls in between. Set `reset` for the
   * first sample after the player was moved on purpose (a respawn), so others draw a jump.
   */
  publishState(sample: PlayerSample): void;

  /**
   * Where to draw the other players right now. The array and the poses in it are reused: read
   * them before the next call.
   */
  sampleRemotes(): readonly RemotePose[];

  /**
   * Where to draw the machines that come for the Core right now. The array and the poses in it are
   * reused: read them before the next call.
   */
  sampleEnemies(): readonly EnemyPose[];

  /** Leaves the room, or closes it when hosting. Safe to call more than once. */
  close(): void;
}

/**
 * How the session reaches the game's world. The host (and solo play) only ever edits the world it
 * has; a guest also has to replace its world with the host's when it joins.
 */
export interface WorldBinding {
  /** The world being played right now. */
  current(): BlockWorld;
  /**
   * Replaces the world with one built from the host's terrain seed and the player-made blocks
   * (guests, once, after joining). Resolves when the new world is playable.
   */
  load(seed: number, edits: readonly EditRecord[]): Promise<void>;
}

/** A binding for a world that is never replaced. */
export function fixedWorld(world: BlockWorld): WorldBinding {
  return {
    current: () => world,
    load: () => Promise.reject(new Error('This world cannot be replaced.')),
  };
}
