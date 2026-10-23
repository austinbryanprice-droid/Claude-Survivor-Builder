import type { Object3D } from 'three';
import { createEnemyRenderer } from '../engine/enemy-render';
import type { MaterialRegistry } from '../engine/materials';
import { createRemotePlayers } from '../engine/remote-players';
import { HostSession } from '../net/host-session';
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
import { createReading, type SurvivalReading } from '../shared/survival-state';
import { createVitalsReading, type VitalsReading } from '../shared/vitals-state';
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
  /** The scene node the other players' avatars are added to, and the materials they are lit with. */
  scene: Object3D;
  registry: MaterialRegistry;
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
  /** The machines on screen right now, with Health as a fraction of the full bar. */
  enemies(): { id: number; kind: number; x: number; y: number; z: number; health: number }[];
  /**
   * Sends this many crawlers in from the ring round the Core, and returns how many came (fewer when the
   * field is full or the ring is walled off). Only a host (or single-player) can; others return 0.
   */
  spawnCrawlers(count: number): number;
  /** Puts one crawler at a spot on open ground and returns its id, or null where there is no room. Only a host (or single-player) can. */
  spawnCrawlerAt(x: number, z: number): number | null;
  /** Removes every machine from the field. Only a host (or single-player) can. */
  clearEnemies(): void;
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
  /** The run as the screen sees it: which day or night, the time left, whether the clock runs, and the Core's health. */
  clock(): SurvivalReading;
  /** Jumps the run's clock ahead by this many seconds. Only a host (or single-player) can; others ignore it. */
  warp(seconds: number): void;
  /** Wounds the Outpost Core by this many points (the readings of `clock()` show its health). Only a host (or single-player) can. */
  hurtCore(amount: number): void;
  /** The local player's Health and Energy as the screen has them (a host's from the simulation, a guest's from what the host last said). */
  vitals(): VitalsReading;
  /**
   * Wounds a player by this many points, the local player by default, and returns the points it
   * took. Only a host (or single-player) can; others return 0.
   */
  hurtPlayer(amount: number, id?: PlayerId): number;
  /** Sets a player's Health and Energy outright, the local player by default. Only a host (or single-player) can. */
  setVitals(values: { health?: number; energy?: number }, id?: PlayerId): void;
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
  const remotes = createRemotePlayers({ registry: options.registry });
  options.scene.add(remotes.object);
  const enemies = createEnemyRenderer({ registry: options.registry });
  options.scene.add(enemies.object);

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

  // The run waits for the player: alone in the world, its clock runs only while the mouse is captured.
  const syncPresence = (): void => hub.setLocalActive(options.input.locked);
  const stopPresence = options.input.onChange(syncPresence);
  syncPresence();

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
    enemies: () => enemies.list(),
    spawnCrawlers: (count) => {
      const session = hub.current;
      return session instanceof HostSession ? (session.survivalSim?.enemies?.spawn(count) ?? 0) : 0;
    },
    spawnCrawlerAt: (x, z) => {
      const session = hub.current;
      return session instanceof HostSession
        ? (session.survivalSim?.enemies?.spawnAt(x, z) ?? null)
        : null;
    },
    clearEnemies: () => {
      const session = hub.current;
      if (session instanceof HostSession) session.survivalSim?.enemies?.clear();
    },
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
    clock: () => ({ ...hub.survival.read(createReading()) }),
    warp: (seconds) => {
      const session = hub.current;
      if (session instanceof HostSession) session.survivalSim?.warp(seconds);
    },
    hurtCore: (amount) => {
      const session = hub.current;
      if (session instanceof HostSession) session.survivalSim?.hurtCore(amount);
    },
    vitals: () => ({ ...hub.vitals.read(createVitalsReading()) }),
    hurtPlayer: (amount, id = hub.localId) => {
      const session = hub.current;
      return session instanceof HostSession
        ? (session.survivalSim?.hurtPlayer(id, amount) ?? 0)
        : 0;
    },
    setVitals: (values, id = hub.localId) => {
      const session = hub.current;
      if (session instanceof HostSession) session.survivalSim?.playerVitals(id)?.set(values);
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
      enemies.update(dt, hub.sampleEnemies());
    },
    dispose() {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('beforeunload', onBeforeUnload);
      stopAddress();
      stopPresence();
      stopRejected();
      stopEvents();
      panel.dispose();
      sync.dispose();
      options.scene.remove(remotes.object);
      remotes.dispose();
      enemies.dispose();
      lobby.dispose();
    },
  };
}
