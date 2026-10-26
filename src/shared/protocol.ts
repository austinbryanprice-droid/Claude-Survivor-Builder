import type { CellState } from './block-world';
import type { OverrunCause, SurvivalEvent } from './survival-state';

export type { CellState } from './block-world';

/**
 * The multiplayer message shapes, shared by the host, the guests and the tests. Pure types and
 * constants: the codec that turns them into bytes is `wire.ts`.
 */

/** Handed out by the host. 0 is "nobody" (the world itself); the host's own player is always 1. */
export type PlayerId = number;
export const NO_PLAYER: PlayerId = 0;
export const HOST_PLAYER_ID: PlayerId = 1;

/** What a player asks the host to do to the world. The host validates it and answers with events. */
export type BlockCommand =
  | {
      readonly type: 'place';
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly state: CellState;
    }
  | { readonly type: 'break'; readonly x: number; readonly y: number; readonly z: number }
  /** Strip the heap of debris whose middle is in this cell (Phase 5a); it changes the pool and the heap, not a block. */
  | { readonly type: 'harvest'; readonly x: number; readonly y: number; readonly z: number }
  /**
   * Upgrade the piece in this cell in place (Phase 5e). `state` is the piece the player was shown
   * it would become, which the host checks against the one it works out itself, so a block that was
   * upgraded, broken or rebuilt since the player looked is turned away and nothing is paid twice.
   */
  | {
      readonly type: 'upgrade';
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly state: CellState;
    };

/** What happened to the world. State based and idempotent: place, break (state 0) and upgrade are all `set`. */
export interface BlockSetEvent {
  readonly type: 'set';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly state: CellState;
  /** Who caused it, or NO_PLAYER. */
  readonly by: PlayerId;
}

/** Every event every peer applies, in the order the host sent them. */
export type WorldEvent = BlockSetEvent;

/** One cell of the player-made structure, as it travels in a snapshot. */
export interface EditRecord {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly state: CellState;
}

/** Who is in the room. */
export interface PlayerInfo {
  readonly id: PlayerId;
  /** 0 to 3: stable for the life of the player; picks the colour and the spawn spot. */
  readonly slot: number;
  readonly name: string;
  readonly isHost: boolean;
}

/** A player's movement state, as the owner's controller reports it. */
export interface PlayerSample {
  /** Feet position, in blocks. */
  x: number;
  y: number;
  z: number;
  /** Velocity, in blocks per second. */
  vx: number;
  vy: number;
  vz: number;
  /** View angles, in radians (see look.ts). */
  yaw: number;
  pitch: number;
  onGround: boolean;
  /** True on the first sample after the player was moved on purpose (a respawn): drawn as a jump, not a glide. */
  reset: boolean;
}

export function createPlayerSample(): PlayerSample {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, reset: false };
}

/** Where to draw another player right now. */
export interface RemotePose {
  id: PlayerId;
  slot: number;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Horizontal speed in blocks per second, for the walk cycle. */
  speed: number;
  onGround: boolean;
}

// ----------------------------------------------------------------------------------------------
// Control frames: JSON on the ordered channel.
// ----------------------------------------------------------------------------------------------

export interface PlayerWire {
  readonly id: PlayerId;
  readonly slot: number;
  readonly name: string;
}

export type DenyReason = 'full' | 'version' | 'closed';

/** Guest to host. */
export type GuestFrame =
  | {
      readonly t: 'hello';
      readonly v: number;
      readonly build: string;
      /** Random, kept by the browser: lets the host give the same player back to a guest that returns. */
      readonly token: string;
      readonly name: string;
    }
  | { readonly t: 'cmd'; readonly id: number; readonly c: BlockCommand }
  /**
   * A shot of the pulse blaster: where the camera is (`o`) and the unit vector it looks along
   * (`d`), and the moment of the host's clock, in milliseconds, that the machines on this screen
   * were drawn at (`at`), so the host can judge the shot against them. The host answers everyone
   * with an `sh` frame.
   */
  | {
      readonly t: 'fire';
      readonly o: readonly [x: number, y: number, z: number];
      readonly d: readonly [x: number, y: number, z: number];
      readonly at: number;
    }
  /** `rtt` is the round trip this guest measured last time, so the host can show everyone's ping. */
  | { readonly t: 'ping'; readonly n: number; readonly rtt: number }
  | { readonly t: 'bye' };

/** Host to guest. */
export type HostFrame =
  | {
      readonly t: 'welcome';
      readonly v: number;
      readonly id: PlayerId;
      readonly slot: number;
      readonly hostId: PlayerId;
      readonly seed: number;
      /** The host's event counter when the snapshot was taken. */
      readonly seq: number;
      /** The host's clock, for the first guess at the clock offset. */
      readonly hostTime: number;
      /** Where this guest starts (or, for a returning guest, where it left off). */
      readonly spawn: { readonly x: number; readonly y: number; readonly z: number };
      readonly epoch: number;
      /** Which run the room is in: 1 for the first, one more each time the host starts over. */
      readonly run: number;
      readonly players: readonly PlayerWire[];
      /** How many `snap` frames follow. */
      readonly parts: number;
      readonly edits: number;
    }
  | { readonly t: 'deny'; readonly reason: DenyReason }
  /** One slice of the edit list: a base64 blob of packed records (see wire.ts). */
  | { readonly t: 'snap'; readonly i: number; readonly b: string }
  | { readonly t: 'join'; readonly p: PlayerWire }
  | { readonly t: 'leave'; readonly id: PlayerId; readonly why: 'left' | 'timeout' | 'closed' }
  | { readonly t: 'ev'; readonly s: number; readonly e: WorldEvent }
  /** The command with this id was refused. */
  | { readonly t: 'rej'; readonly id: number; readonly r: string }
  /** The host moved this guest (a movement check failed): jump to the spot and use the new epoch. */
  | {
      readonly t: 'fix';
      readonly epoch: number;
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }
  | { readonly t: 'pong'; readonly n: number }
  /**
   * Where the run stands: the host's step count (20 a second), whether the clock is running, the
   * Outpost Core's health and full health in whole points, whether the run has ended and why, the
   * crew's respawn charges and the most it can hold, and what the run has come to (machines felled,
   * blocks placed, charges spent, materials gathered, pieces upgraded), which the results screen shows once the run is over. Sent about
   * twice a second while the clock runs, whenever it stops or starts, within a fifth of a second of
   * the Core's health changing, whenever an event is announced, and to every newcomer, so a guest
   * can show the time, the Core and the charges and move the sky between frames.
   */
  | {
      readonly t: 'sv';
      readonly tick: number;
      readonly run: boolean;
      readonly core: readonly [health: number, max: number];
      readonly over: boolean;
      /** What ended the run; present once it has ended. */
      readonly why?: OverrunCause;
      readonly rc: readonly [charges: number, max: number];
      readonly st: readonly [
        felled: number,
        placed: number,
        revived: number,
        gathered: number,
        upgraded: number,
      ];
    }
  /**
   * The host started the run over (Retry or New Run): build the valley for `seed` with nothing on
   * it, forget the old run, and stand at `spawn` under the new `epoch`. `n` counts the runs (1 is
   * the first, so the first restart says 2); `seq` is the host's event counter, so anything still
   * in flight from the old run is not applied.
   */
  | {
      readonly t: 'run';
      readonly n: number;
      readonly seed: number;
      readonly seq: number;
      readonly spawn: { readonly x: number; readonly y: number; readonly z: number };
      readonly epoch: number;
    }
  /** Something the survival loop announces as it happens (nightfall, a wave, dawn, a player down or back, the run ending). */
  | { readonly t: 'se'; readonly e: SurvivalEvent }
  /**
   * What the crew's shared pool holds: the count of each material in tier order (`pl`), the most
   * it holds of any one (`cap`), the research points the crew has earned (`rp`) and the part of
   * them a Research Terminal has read (`cl`, never more than `rp`; the tiers they open are worked
   * out from `cl` by the same table on every peer). Sent within a fifth of a second of a change and
   * to every newcomer.
   */
  | {
      readonly t: 'ec';
      readonly pl: readonly number[];
      readonly cap: number;
      readonly rp: number;
      readonly cl: number;
    }
  /**
   * The run's heaps of debris, all of them, in list order (the index is the name of a heap):
   * `[x, y, z, yaw, scale, harvests, grade, from, left]`, where `left` is how many strips it has
   * now (0 for one that is gone or not uncovered yet). Sent to every newcomer, at each dawn (which
   * uncovers some) and when a run starts over.
   */
  | { readonly t: 'nl'; readonly n: readonly (readonly number[])[] }
  /** Player `p` stripped heap `i`: `g` went into the pool as material `m` (less than offered when `f` says the pool was full) and `l` strips are left. */
  | {
      readonly t: 'hd';
      readonly p: PlayerId;
      readonly i: number;
      readonly m: number;
      readonly g: number;
      readonly l: number;
      readonly f: boolean;
    }
  /**
   * This guest's own Health and Energy in whole points (`[points, full]`), whether it stands in
   * the Core's charge field, the whole seconds until the Core brings it back if it is down (`rt`;
   * 0 for a guest that is up, or down and waiting for the dawn) and the seconds it stays shaken
   * after coming back (`sk`). Each guest hears only its own, within a quarter of a second of a
   * change and once to every newcomer; nobody else's meters are drawn.
   */
  | {
      readonly t: 'vt';
      readonly hp: readonly [points: number, max: number];
      readonly en: readonly [points: number, max: number];
      readonly chg: boolean;
      readonly rt: number;
      readonly sk: number;
    }
  /**
   * A shot the host decided, sent to everyone, the shooter included: who fired (`p`), where the bolt
   * ended (`e`), `SHOT_FLAG` bits for what became of it (`f`) and the machine it struck, or 0 (`h`).
   * A turret's shot names the cell the turret stands in (`c`) and no player (`p` is `NO_PLAYER`).
   */
  | {
      readonly t: 'sh';
      readonly p: PlayerId;
      readonly c?: readonly [x: number, y: number, z: number];
      readonly e: readonly [x: number, y: number, z: number];
      readonly f: number;
      readonly h: number;
    }
  /** Every guest's ping, so the room list can show them. */
  | { readonly t: 'pings'; readonly p: readonly (readonly [PlayerId, number])[] }
  | { readonly t: 'bye'; readonly why: 'closed' };

// ----------------------------------------------------------------------------------------------
// Why a session ended, and what to tell the player.
// ----------------------------------------------------------------------------------------------

export type CloseReason =
  | 'left'
  | 'host-left'
  | 'host-lost'
  | 'kicked'
  | 'room-full'
  | 'room-not-found'
  | 'version-mismatch'
  | 'broker-unreachable'
  | 'timed-out'
  | 'unsupported'
  | 'error';

export interface CloseInfo {
  readonly reason: CloseReason;
  readonly title: string;
  readonly detail: string;
}

const CLOSE_TEXT: Record<CloseReason, { title: string; detail: string }> = {
  left: { title: 'You left the room', detail: '' },
  'host-left': {
    title: 'The host left the game',
    detail:
      'The session has ended for everyone. This version has no host migration: to keep playing, ask the host to start a new room and share the new code.',
  },
  'host-lost': {
    title: 'Lost the connection to the host',
    detail:
      "The host's browser stopped answering. They may have closed the tab, lost their connection or let the tab sleep, and the session cannot continue without them. Ask them for a new room code when they are back.",
  },
  kicked: {
    title: 'You were removed from the room',
    detail: 'The host removed you from the session.',
  },
  'room-full': {
    title: 'That room is full',
    detail: 'A room holds up to four players. Ask the host to make space, or start your own room.',
  },
  'room-not-found': {
    title: 'No room with that code',
    detail:
      'Check the code with the host. Codes are five letters or digits, and a room closes as soon as its host leaves.',
  },
  'version-mismatch': {
    title: 'Different game versions',
    detail:
      'The host runs another build of the game. Reload this page to get the latest one, and ask the host to do the same.',
  },
  'broker-unreachable': {
    title: 'Could not reach the matchmaking server',
    detail:
      'Rooms are set up through a small public server (PeerJS) that this network could not reach. Try again in a minute, or from another network.',
  },
  'timed-out': {
    title: 'Could not connect to the host',
    detail:
      'The host did not answer in time. Strict firewalls and some mobile networks block direct connections between players. Try again, or let the other player host.',
  },
  unsupported: {
    title: 'This browser cannot play together',
    detail:
      'Multiplayer needs WebRTC, which this browser does not offer. Try a current Chrome, Edge or Firefox.',
  },
  error: {
    title: 'The connection failed',
    detail: 'Something went wrong with the connection. Try joining again.',
  },
};

export function closeInfo(reason: CloseReason): CloseInfo {
  return { reason, ...CLOSE_TEXT[reason] };
}

/** Reasons that mean the player was in a room and lost it, as opposed to never getting in. */
export function wasInRoom(reason: CloseReason): boolean {
  return reason === 'host-left' || reason === 'host-lost' || reason === 'kicked';
}
