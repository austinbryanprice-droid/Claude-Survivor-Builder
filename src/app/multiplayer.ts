import type { Object3D } from 'three';
import { createRemotePlayers } from '../engine/remote-players';
import { Lobby, type LobbyGame, type LobbyState } from '../net/lobby';
import { PeerTransport } from '../net/peer-transport';
import { cryptoRandom } from '../net/random';
import { systemScheduler } from '../net/scheduler';
import type { NetStats, Rejection, SessionPhase, SessionRole } from '../net/session';
import { digestBlocks, type BlockDigest } from '../shared/block-digest';
import type { CellState } from '../shared/block-world';
import {
  buildInviteLink,
  describeNetwork,
  withJoinParam,
  type NetFlags,
} from '../shared/net-flags';
import { createPlayerSample, type PlayerId, type PlayerSample } from '../shared/protocol';
import { createRoomPanel } from '../ui/room-panel';
import { browserStore } from './browser-storage';
import { PlayerSync, type LocalPlayer } from './player-sync';

/**
 * Multiplayer for the game page. It joins the pieces: the lobby (host, join, leave), the player's
 * movement going out and the host's corrections coming back, the other players' avatars, the
 * room panel, and the page's lifecycle (closing the page leaves the room). The game gives it
 * four narrow views of itself and calls `update` once per frame.
 */

export interface MultiplayerOptions {
  flags: NetFlags;
  buildId: string;
  /** The player the network reports and moves. */
  player: LocalPlayer;
  /** The world being played, its replacement when a room's world arrives, and where a seat starts. */
  world: LobbyGame;
  /** Height of the ground at a point, for the debug hook's "build next to me". */
  groundAt(x: number, z: number): number;
  /** The scene node the other players' avatars are added to. */
  scene: Object3D;
  /** The mouse capture: the panel shows its card while the mouse is free. */
  input: {
    readonly locked: boolean;
    onChange(listener: () => void): () => void;
    releaseLock(): void;
  };
}

/** What the browser tests (and a curious console) can read and do. Attached by the page only with `?debug=1`. */
export interface MultiplayerDebug {
  lobby(): LobbyState;
  session(): {
    role: SessionRole;
    phase: SessionPhase;
    localId: PlayerId;
    roomCode: string | null;
    stats: NetStats;
  };
  /** The avatars on screen right now. */
  remotes(): { id: number; name: string; slot: number; x: number; y: number; z: number }[];
  /** A fingerprint of every player-made block in the world being played. */
  blocks(): BlockDigest;
  block(x: number, y: number, z: number): CellState;
  place(x: number, y: number, z: number, state: CellState): void;
  breakBlock(x: number, y: number, z: number): void;
  /** Where the local player stands. */
  position(): { x: number; y: number; z: number };
  /**
   * Asks the host for a block `dx` and `dz` cells from the one the player stands in, resting on
   * the ground there and `up` cells above it. Returns the cell, so a test can break it later.
   */
  placeNear(
    dx: number,
    dz: number,
    state: CellState,
    up?: number,
  ): { x: number; y: number; z: number };
  /** Refusals the host sent back, newest last. */
  rejections(): Rejection[];
  /** World events applied since the page loaded. */
  eventCount(): number;
}

export interface Multiplayer {
  readonly lobby: Lobby;
  readonly debug: MultiplayerDebug;
  /** Call once per rendered frame. `dt` is the frame time in seconds. */
  update(dt: number): void;
  dispose(): void;
}

const REMEMBERED_REJECTIONS = 20;

export function createMultiplayer(options: MultiplayerOptions): Multiplayer {
  const { flags } = options;

  const transport = new PeerTransport({
    scheduler: systemScheduler,
    broker: flags.broker ?? undefined,
    iceServers: flags.iceServers ?? undefined,
  });
  const lobby = new Lobby({
    scheduler: systemScheduler,
    transport,
    game: options.world,
    buildId: options.buildId,
    random: cryptoRandom(),
    tabStore: browserStore(() => window.sessionStorage),
    nameStore: browserStore(() => window.localStorage),
    nameOverride: flags.name,
  });
  const hub = lobby.hub;

  const sync = new PlayerSync(hub, options.player);
  const remotes = createRemotePlayers();
  options.scene.add(remotes.object);

  const panel = createRoomPanel({
    lobby,
    inviteLink: (code) => buildInviteLink(window.location.href, code),
    isPlaying: () => options.input.locked,
    onPlayingChange: (listener) => options.input.onChange(listener),
    releaseMouse: () => options.input.releaseLock(),
    notes: [describeNetwork(flags), ...flags.warnings].filter((note): note is string => !!note),
  });
  document.body.append(panel.element);

  // The address says which room this page is in, so reloading goes back to it.
  const syncAddress = (): void => {
    const { status, code } = lobby.state;
    const want = status === 'joining' || status === 'joined' ? code : null;
    const next = withJoinParam(window.location.href, want);
    if (next === window.location.href) return;
    try {
      window.history.replaceState(window.history.state, '', next);
    } catch {
      // Some embedded pages forbid it; the room still works.
    }
  };
  const stopAddress = lobby.onChange(syncAddress);

  // Leaving the page leaves the room, and tells the others now instead of after a timeout.
  const onPageHide = (): void => lobby.dispose();
  // A page restored from the back/forward cache has lost its network; start it over.
  const onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) window.location.reload();
  };
  // A host closing the tab ends the session for everyone, so the browser asks first.
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    const { status, roster } = lobby.state;
    if (status === 'hosting' && roster.length > 1) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('beforeunload', onBeforeUnload);

  // For the browser tests.
  const refusals: Rejection[] = [];
  let events = 0;
  const stopRejected = hub.onRejected((rejection) => {
    refusals.push(rejection);
    if (refusals.length > REMEMBERED_REJECTIONS) refusals.shift();
  });
  const stopEvents = hub.onEvent(() => {
    events++;
  });

  const probe = createPlayerSample();
  const here = (): PlayerSample => {
    options.player.read(probe);
    return probe;
  };

  const debug: MultiplayerDebug = {
    lobby: () => lobby.state,
    session: () => ({
      role: hub.role,
      phase: hub.phase,
      localId: hub.localId,
      roomCode: hub.roomCode,
      stats: { ...hub.stats },
    }),
    remotes: () => remotes.list(),
    blocks: () => digestBlocks(options.world.world()),
    block: (x, y, z) => options.world.world().getBlock(x, y, z),
    place: (x, y, z, state) => hub.sendCommand({ type: 'place', x, y, z, state }),
    breakBlock: (x, y, z) => hub.sendCommand({ type: 'break', x, y, z }),
    position: () => {
      const { x, y, z } = here();
      return { x, y, z };
    },
    placeNear: (dx, dz, state, up = 0) => {
      const me = here();
      const x = Math.floor(me.x) + dx;
      const z = Math.floor(me.z) + dz;
      const y = Math.floor(options.groundAt(x + 0.5, z + 0.5)) + up;
      hub.sendCommand({ type: 'place', x, y, z, state });
      return { x, y, z };
    },
    rejections: () => [...refusals],
    eventCount: () => events,
  };

  if (flags.join !== null) lobby.join(flags.join);
  syncAddress();

  return {
    lobby,
    debug,
    update(dt) {
      sync.update(dt);
      remotes.update(dt, hub.sampleRemotes());
    },
    dispose() {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('beforeunload', onBeforeUnload);
      stopAddress();
      stopRejected();
      stopEvents();
      panel.dispose();
      sync.dispose();
      options.scene.remove(remotes.object);
      remotes.dispose();
      lobby.dispose();
    },
  };
}
