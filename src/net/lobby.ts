import type { BlockWorld } from '../shared/block-world';
import { cleanName, defaultName, isToken } from '../shared/names';
import { closeInfo, type CloseInfo, type PlayerId } from '../shared/protocol';
import { normalizeRoomCode } from '../shared/room-code';
import type { SurvivalSim } from '../systems/survival/sim';
import { Emitter } from './emitter';
import { GuestSession } from './guest-session';
import { HostSession } from './host-session';
import { SessionHub } from './hub';
import { randomString } from './random';
import type { Scheduler } from './scheduler';
import type { RosterEntry, SessionPhase, Unsubscribe, WorldBinding } from './session';
import { NetError, type Transport } from './transport';

/**
 * Everything about being alone, hosting or visiting, in one place: which of those the player is
 * doing, the buttons that move between them, and why a room ended. The room panel only draws
 * `state` and calls these methods; the game talks to `hub` and never sees any of it change.
 *
 *   alone ── host ──▶ opening ──▶ hosting ── leave ──▶ alone
 *     │                  └─ broker unreachable ──▶ alone (with a notice)
 *     └─ join ──▶ joining ──▶ joined ── leave ──▶ alone
 *                   │            └─ host left or lost ──▶ ended ── playAlone ──▶ alone
 *                   └─ cancel, or refused ──▶ alone (a refusal comes with a notice)
 *
 * Leaving as a guest keeps the host's world as it was (there is nothing else to go back to until
 * saves arrive), so the player carries on alone in a copy of it.
 */

/** What the lobby needs from the game it lives in. */
export interface LobbyGame {
  /** The world being played right now. */
  world(): BlockWorld;
  /**
   * Builds the terrain for `seed`, empties the player's blocks and makes that the world being
   * played. Resolves with the new world once it is playable.
   */
  loadWorld(seed: number): Promise<BlockWorld>;
  /**
   * Where the player in this seat starts, standing on the ground. Given the place a player fell when
   * the Core brings them back, it may be the spot at a Bed near there instead of the seat's own.
   */
  spawnPoint(
    slot: number,
    near?: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number };
  /**
   * A new survival run to host: the clock at the start of day 1 (or wherever the page was told to
   * begin). Called each time the player is on their own again. Games that play without one leave
   * it out.
   */
  survival?(): SurvivalSim;
}

/** Browser storage as the lobby uses it. Reads and writes never throw, so private windows just forget. */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface LobbyOptions {
  scheduler: Scheduler;
  transport: Transport;
  game: LobbyGame;
  buildId: string;
  /** Floats in [0, 1), for making a token. */
  random: () => number;
  /**
   * Per tab (session storage). Keeps the player token, so a reloaded page takes its seat back
   * while a second tab of the same browser is a second player.
   */
  tabStore?: KeyValueStore;
  /** Per browser (local storage). Keeps the player's name. */
  nameStore?: KeyValueStore;
  /** A name asked for in the address, used for this page only. */
  nameOverride?: string | null;
}

export type LobbyStatus = 'alone' | 'opening' | 'hosting' | 'joining' | 'joined' | 'ended';

export interface LobbyState {
  readonly status: LobbyStatus;
  /** The room being hosted, joined or visited; null otherwise. */
  readonly code: string | null;
  /** Everyone in the room, in seat order; empty when there is no room. */
  readonly roster: readonly RosterEntry[];
  readonly localId: PlayerId;
  /** The name the next room will use (or the current one, when alone). */
  readonly name: string;
  /** While joining, how far the handshake has got. */
  readonly step: 'connecting' | 'loading' | null;
  /** Why the last attempt (hosting, joining, or typing a code) failed. Cleared by the next attempt. */
  readonly notice: CloseInfo | null;
  /** Why the room is gone; set exactly when `status` is `ended`. */
  readonly ended: CloseInfo | null;
  /** False while a hosted room is not reachable by newcomers (the matchmaking server lost it). */
  readonly roomOnline: boolean;
}

export const TOKEN_KEY = 'ashbound.token';
export const NAME_KEY = 'ashbound.name';

/** A new valley's seed is a whole number from 1 up to this. */
const NEW_SEED_RANGE = 2_000_000_000;

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_LENGTH = 24;

const NOT_A_CODE: CloseInfo = {
  reason: 'room-not-found',
  title: 'That is not a room code',
  detail:
    'A room code is five letters or digits, like K7M2Q. Pasting the whole invite link works too.',
};

function hostFailure(error: unknown): CloseInfo {
  if (error instanceof NetError) {
    if (error.kind === 'broker-unreachable') return closeInfo('broker-unreachable');
    if (error.kind === 'unsupported') return closeInfo('unsupported');
  }
  return {
    reason: 'error',
    title: 'Could not open a room',
    detail: 'Something went wrong while setting the room up. Try again in a moment.',
  };
}

export class Lobby {
  /** The one session the game holds on to; it forwards to whichever session is current. */
  readonly hub: SessionHub;
  readonly token: string;

  private readonly options: LobbyOptions;
  private readonly binding: WorldBinding;
  private readonly changes = new Emitter<void>();
  private readonly stops: Unsubscribe[] = [];
  private stopGuest: Unsubscribe[] = [];

  private solo: HostSession | null;
  private guest: GuestSession | null = null;
  private guestCode: string | null = null;
  private statusValue: LobbyStatus = 'alone';
  private noticeValue: CloseInfo | null = null;
  private endedValue: CloseInfo | null = null;
  private nameValue: string;
  private disposed = false;
  private snapshot: LobbyState;

  constructor(options: LobbyOptions) {
    this.options = options;
    this.token = this.loadToken();
    this.nameValue = cleanName(
      options.nameOverride ?? options.nameStore?.get(NAME_KEY),
      defaultName(this.token),
    );
    this.binding = {
      current: () => options.game.world(),
      load: async (seed, edits) => {
        const world = await options.game.loadWorld(seed);
        for (const edit of edits) world.setBlock(edit.x, edit.y, edit.z, edit.state);
      },
    };
    this.solo = this.makeSolo();
    this.hub = new SessionHub(this.solo);
    this.stops.push(
      this.hub.onPlayers(() => this.refresh()),
      this.hub.onPhase(() => this.refresh()),
    );
    this.snapshot = this.build();
  }

  get state(): LobbyState {
    return this.snapshot;
  }

  /** Calls `listener` after every change to `state`. */
  onChange(listener: () => void): Unsubscribe {
    return this.changes.on(listener);
  }

  // --------------------------------------------------------------------------------------------
  // What the player can do.
  // --------------------------------------------------------------------------------------------

  /** Opens a room in the world being played. */
  host(): void {
    const solo = this.solo;
    if (this.disposed || this.statusValue !== 'alone' || !solo) return;
    this.noticeValue = null;
    this.statusValue = 'opening';
    this.refresh();
    solo.openRoom(this.options.transport).then(
      () => {
        if (this.disposed || this.solo !== solo) {
          solo.closeRoom();
          return;
        }
        this.statusValue = 'hosting';
        this.refresh();
      },
      (error: unknown) => {
        if (this.disposed) return;
        this.statusValue = 'alone';
        this.noticeValue = hostFailure(error);
        this.refresh();
      },
    );
  }

  /** Joins the room with this code. Takes what a player types or pastes: any case, spaces, or a whole invite link. */
  join(input: string): void {
    if (this.disposed) return;
    if (this.statusValue !== 'alone' && this.statusValue !== 'ended') return;
    const code = normalizeRoomCode(input);
    if (!code) {
      this.noticeValue = NOT_A_CODE;
      this.refresh();
      return;
    }
    this.dropGuest();
    this.noticeValue = null;
    this.endedValue = null;
    const guest = new GuestSession({
      scheduler: this.options.scheduler,
      world: this.binding,
      transport: this.options.transport,
      name: this.nameValue,
      token: this.token,
      buildId: this.options.buildId,
    });
    this.guest = guest;
    this.guestCode = code;
    this.statusValue = 'joining';
    this.stopGuest = [guest.onPhase((phase) => this.onGuestPhase(guest, phase))];
    this.hub.swap(guest);
    guest.join(code);
    this.refresh();
  }

  /** Gives up on a join that has not finished. */
  cancel(): void {
    if (this.disposed || this.statusValue !== 'joining') return;
    const guest = this.guest;
    this.dropGuest();
    guest?.close();
    this.statusValue = 'alone';
    this.restoreSolo();
    this.refresh();
  }

  /** Closes the room being hosted, or leaves the room being visited. Either way the player is alone afterwards. */
  leave(): void {
    if (this.disposed) return;
    switch (this.statusValue) {
      case 'hosting':
        this.solo?.closeRoom();
        this.solo?.rename(this.nameValue);
        this.statusValue = 'alone';
        break;
      case 'joined': {
        const guest = this.guest;
        this.dropGuest();
        guest?.close();
        this.statusValue = 'alone';
        this.restoreSolo();
        break;
      }
      case 'joining':
        this.cancel();
        return;
      case 'ended':
        this.playAlone();
        return;
      default:
        return;
    }
    this.noticeValue = null;
    this.refresh();
  }

  /** Carries on alone after a room ended, or dismisses the notice about a failed attempt. */
  playAlone(): void {
    if (this.disposed) return;
    if (this.statusValue === 'ended') {
      this.dropGuest();
      this.endedValue = null;
      this.statusValue = 'alone';
      this.restoreSolo();
    } else if (this.statusValue !== 'alone') {
      return;
    }
    this.noticeValue = null;
    this.refresh();
  }

  /** Sets the name the next room will use, and saves it. A room already open keeps the name it was joined with. */
  setName(raw: string): void {
    if (this.disposed) return;
    const name = cleanName(raw, defaultName(this.token));
    if (name === this.nameValue) return;
    this.nameValue = name;
    this.options.nameStore?.set(NAME_KEY, name);
    if (this.statusValue === 'alone') this.solo?.rename(name);
    this.refresh();
  }

  /** Ends whatever is running: the room is closed (guests are told) or left. Used when the page goes away. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const guest = this.guest;
    this.dropGuest();
    guest?.close();
    this.solo?.close();
    for (const stop of this.stops) stop();
    this.stops.length = 0;
    this.changes.clear();
  }

  // --------------------------------------------------------------------------------------------
  // Inside.
  // --------------------------------------------------------------------------------------------

  private loadToken(): string {
    const store = this.options.tabStore;
    const saved = store?.get(TOKEN_KEY);
    if (isToken(saved)) return saved;
    const fresh = randomString(this.options.random, TOKEN_ALPHABET, TOKEN_LENGTH);
    store?.set(TOKEN_KEY, fresh);
    return fresh;
  }

  private makeSolo(): HostSession {
    const { game, random } = this.options;
    const survival = game.survival?.bind(game);
    return new HostSession({
      scheduler: this.options.scheduler,
      world: this.binding,
      name: this.nameValue,
      token: this.token,
      spawnFor: (slot, near) => game.spawnPoint(slot, near),
      survival: survival?.(),
      // A lost run starts over from a new simulation, built once the world has been rebuilt for it.
      newRun: survival,
      nextSeed: () => 1 + Math.floor(random() * NEW_SEED_RANGE),
    });
  }

  /** Points the hub back at a single-player session (the old one if it is still running). */
  private restoreSolo(): void {
    if (!this.solo || this.solo.phase === 'closed') this.solo = this.makeSolo();
    this.solo.rename(this.nameValue);
    this.hub.swap(this.solo);
  }

  private dropGuest(): void {
    for (const stop of this.stopGuest) stop();
    this.stopGuest = [];
    this.guest = null;
    this.guestCode = null;
  }

  private onGuestPhase(guest: GuestSession, phase: SessionPhase): void {
    if (guest !== this.guest) return;
    if (phase === 'open') {
      // In for real: the player's own session has nothing left to do.
      this.solo?.close();
      this.solo = null;
      this.statusValue = 'joined';
    } else if (phase === 'closed') {
      const info = guest.closed ?? closeInfo('error');
      if (this.statusValue === 'joining') {
        // Never got in: back to the world as it was.
        this.dropGuest();
        this.noticeValue = info;
        this.statusValue = 'alone';
        this.restoreSolo();
      } else if (this.statusValue === 'joined') {
        // The room is gone. Stay on the closed session until the player chooses what to do.
        this.endedValue = info;
        this.statusValue = 'ended';
      }
    }
    this.refresh();
  }

  private build(): LobbyState {
    const session = this.hub.current;
    const status = this.statusValue;
    const inRoom = status === 'hosting' || status === 'joined';
    return {
      status,
      code:
        status === 'hosting'
          ? session.roomCode
          : status === 'joining' || status === 'joined'
            ? this.guestCode
            : null,
      roster: inRoom ? session.players : [],
      localId: session.localId,
      name: this.nameValue,
      step: status === 'joining' ? (session.phase === 'loading' ? 'loading' : 'connecting') : null,
      notice: this.noticeValue,
      ended: status === 'ended' ? this.endedValue : null,
      roomOnline: session.roomOnline,
    };
  }

  private refresh(): void {
    if (this.disposed) return;
    this.snapshot = this.build();
    this.changes.emit();
  }
}
