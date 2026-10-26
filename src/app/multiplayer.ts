import type { Object3D } from 'three';
import { createDebrisRenderer, type DebrisShown } from '../engine/debris-render';
import { createEnemyRenderer } from '../engine/enemy-render';
import type { MaterialRegistry } from '../engine/materials';
import { createRemotePlayers } from '../engine/remote-players';
import { createShotFx } from '../engine/shot-fx';
import { HostSession } from '../net/host-session';
import { Lobby, type LobbyGame, type LobbyState } from '../net/lobby';
import { PeerTransport } from '../net/peer-transport';
import { cryptoRandom } from '../net/random';
import { systemScheduler } from '../net/scheduler';
import type { NetStats, Rejection, SessionPhase, SessionRole } from '../net/session';
import { digestBlocks, type BlockDigest } from '../shared/block-digest';
import type { CellState } from '../shared/block-world';
import type { EnemyPose } from '../shared/enemy-state';
import { lookDirection, type Vec3 } from '../shared/look';
import { PLAYER } from '../shared/movement';
import {
  buildInviteLink,
  describeNetwork,
  withJoinParam,
  type NetFlags,
} from '../shared/net-flags';
import { createPlayerSample, type PlayerId, type PlayerSample } from '../shared/protocol';
import type { RayWorld } from '../shared/raycast';
import { createEconomyReading } from '../shared/economy';
import { createReading, type RestartKind, type SurvivalReading } from '../shared/survival-state';
import { createVitalsReading, type VitalsReading } from '../shared/vitals-state';
import { DEBRIS } from '../systems/economy/balance';
import { upgradeStep } from '../systems/economy/build-rules';
import { hitboxOf } from '../systems/survival/balance';
import { createRoomPanel } from '../ui/room-panel';
import { browserStore } from './browser-storage';
import { PlayerSync, type LocalPlayer } from './player-sync';
import { createShotEffects, type ShotLogEntry } from './shot-effects';

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
  /** What stops a bolt of the pulse blaster in the world being played now (its blocks, ground and Core), or null where there is none. */
  rayWorld(): RayWorld | null;
  /** The heap of debris the player's cursor is on, by its place in the run's list, or -1: the heap glows. */
  aimedDebris(): number;
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
    /** Which run this is: 1 for the first, one more each time the host starts over after a loss. */
    run: number;
    stats: NetStats;
  };
  /** The avatars on screen right now. */
  remotes(): { id: number; name: string; slot: number; x: number; y: number; z: number }[];
  /** The machines on screen right now, with Health as a fraction of the full bar. */
  enemies(): { id: number; kind: number; x: number; y: number; z: number; health: number }[];
  /** The latest shots of the pulse blaster drawn on this screen, anyone's, newest last, and the light playing now. */
  shots(): { shots: ShotLogEntry[]; live: { bolts: number; sparks: number } };
  /**
   * Fires the pulse blaster from the player's eyes along their view, as a click does, and draws the
   * bolt at once. The host's rules still apply (Energy, the rate of fire). The tests use it where a
   * click would need the mouse captured, and so would start the run.
   */
  fire(): void;
  /**
   * Fires the pulse blaster at the middle of the machine nearest the player, as this screen has it
   * (the guest's own mirror, the way a player aims at what they see), and returns that machine's id.
   * Returns null, and fires nothing, while there is no machine to aim at.
   */
  fireAtMachine(): number | null;
  /**
   * Sends this many crawlers in from the ring round the Core, and returns how many came (fewer when the
   * field is full or the ring is walled off). Only a host (or single-player) can; others return 0.
   */
  spawnCrawlers(count: number): number;
  /** Puts one crawler at a spot on open ground and returns its id, or null where there is no room. Only a host (or single-player) can. */
  spawnCrawlerAt(x: number, z: number): number | null;
  /** Removes every machine from the field. Only a host (or single-player) can. */
  clearEnemies(): void;
  /** Every heap of debris in the run's list and the strips each has left, as this screen has the list. */
  heaps(): {
    index: number;
    x: number;
    y: number;
    z: number;
    /** The way it lies (radians) and how big it is drawn (a multiple of its model). */
    yaw: number;
    scale: number;
    harvests: number;
    left: number;
    from: number;
    /** The material its strips give. */
    grade: number;
  }[];
  /** The heaps drawn now: how far up out of the ground each is, the share of its strips shown, the flash of a strip and the glow of the cursor. */
  heapsShown(): DebrisShown[];
  /** The crew's pool as this screen has it: the count of each material in tier order, the most it holds, the research points earned, the part of them a Research Terminal has read and the highest tier those have opened. */
  pool(): { stock: number[]; cap: number; research: number; claimed: number; tier: number };
  /**
   * Asks the host to strip the heap with this place in the list, as the interact key does but with
   * no aim and no pace of the hands (the host's rules still apply, reach included). Returns false,
   * and asks nothing, for a place with no heap.
   */
  harvest(index: number): boolean;
  /** Sets how much of a material (a `MATERIAL` id) the pool holds, within its ceiling. Only a host (or single-player) can. */
  setPool(material: number, amount: number): void;
  /**
   * Sets the research points the crew has earned and, unless `claim` is false, has a Terminal read
   * them, which opens the material tiers they reach (heaps of a newly opened grade rise at the next
   * dawn); with `claim` false the points wait for a Terminal to read them. Only a host (or
   * single-player) can.
   */
  setResearch(points: number, claim?: boolean): void;
  /** A fingerprint of every player-made block in the world being played. */
  blocks(): BlockDigest;
  block(x: number, y: number, z: number): CellState;
  place(x: number, y: number, z: number, state: CellState): void;
  breakBlock(x: number, y: number, z: number): void;
  /**
   * Asks the host to upgrade the block in a cell, as a press of E does: the command names the piece
   * this screen shows there made one material better. `shown` names another piece, for a test of the
   * host's refusal of a cell that is not what the player saw.
   */
  upgrade(x: number, y: number, z: number, shown?: CellState): void;
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
  /** Sets the crew's respawn charges outright (within what it can hold; `clock()` shows them). Only a host (or single-player) can. */
  setRespawns(count: number): void;
  /** Starts a lost run over, as the results card's buttons do (without asking for the mouse). Only a host (or single-player) can, and only once the run is over. */
  restart(kind: RestartKind): void;
  /** Refusals the host sent back, newest last. */
  rejections(): Rejection[];
  /** World events applied since the page loaded. */
  eventCount(): number;
}

export interface Multiplayer {
  readonly lobby: Lobby;
  readonly debug: MultiplayerDebug;
  /** The local player fired from the camera at `origin` along the unit vector `dir`: draws the bolt now, without waiting for the host. */
  predictShot(origin: Vec3, dir: Vec3): void;
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
  const debris = createDebrisRenderer({ registry: options.registry });
  options.scene.add(debris.object);
  const shotFx = createShotFx();
  options.scene.add(shotFx.object);
  const shots = createShotEffects({
    fx: shotFx,
    session: hub,
    rayWorld: options.rayWorld,
    player: options.player,
  });
  const stopShots = hub.onShot((shot) => shots.hear(shot));
  // A strip, anyone's, throws scrap off the heap it was taken from.
  const stopStrips = hub.economy.debris.onHarvest((event) => {
    const node = hub.economy.debris.nodes[event.node];
    if (node) shotFx.strip({ x: node.x, y: node.y + DEBRIS.lift, z: node.z });
  });

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
      run: hub.run,
      stats: { ...hub.stats },
    }),
    remotes: () => remotes.list(),
    enemies: () => enemies.list(),
    shots: () => shots.debug(),
    fire: () => {
      if (hub.phase !== 'open') return;
      const me = here();
      const origin = { x: me.x, y: me.y + PLAYER.eyeHeight, z: me.z };
      const dir = lookDirection(me.yaw, me.pitch, { x: 0, y: 0, z: 0 });
      shots.predict(origin, dir);
      hub.fire(origin, dir);
    },
    fireAtMachine: () => {
      if (hub.phase !== 'open') return null;
      const me = here();
      const origin = { x: me.x, y: me.y + PLAYER.eyeHeight, z: me.z };
      let nearest: EnemyPose | null = null;
      let least = Infinity;
      for (const machine of hub.sampleEnemies()) {
        const away = Math.hypot(machine.x - origin.x, machine.z - origin.z);
        if (away < least) {
          least = away;
          nearest = machine;
        }
      }
      if (!nearest) return null;
      const middle = nearest.y + (hitboxOf(nearest.kind)?.height ?? 1) / 2;
      const dx = nearest.x - origin.x;
      const dy = middle - origin.y;
      const dz = nearest.z - origin.z;
      const length = Math.hypot(dx, dy, dz) || 1;
      const dir = { x: dx / length, y: dy / length, z: dz / length };
      shots.predict(origin, dir);
      hub.fire(origin, dir);
      return nearest.id;
    },
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
    heaps: () =>
      hub.economy.debris.nodes.map((node) => ({
        index: node.index,
        x: node.x,
        y: node.y,
        z: node.z,
        yaw: node.yaw,
        scale: node.scale,
        harvests: node.harvests,
        left: hub.economy.debris.leftOf(node.index),
        from: node.from,
        grade: node.grade,
      })),
    heapsShown: () => debris.list(),
    pool: () => {
      const reading = hub.economy.read(createEconomyReading());
      return {
        stock: [...reading.stock],
        cap: reading.cap,
        research: reading.research,
        claimed: reading.claimed,
        tier: reading.tier,
      };
    },
    harvest: (index) => {
      const node = hub.economy.debris.nodes[index];
      if (!node) return false;
      hub.sendCommand({
        type: 'harvest',
        x: Math.floor(node.x),
        y: Math.floor(node.y),
        z: Math.floor(node.z),
      });
      return true;
    },
    setPool: (material, amount) => {
      const session = hub.current;
      if (session instanceof HostSession) session.survivalSim?.economy?.pool.set(material, amount);
    },
    setResearch: (points, claim = true) => {
      const session = hub.current;
      if (session instanceof HostSession) {
        session.survivalSim?.economy?.research.set(points, claim);
      }
    },
    blocks: () => digestBlocks(options.world.world()),
    block: (x, y, z) => options.world.world().getBlock(x, y, z),
    place: (x, y, z, state) => hub.sendCommand({ type: 'place', x, y, z, state }),
    breakBlock: (x, y, z) => hub.sendCommand({ type: 'break', x, y, z }),
    upgrade: (x, y, z, shown) => {
      const state = shown ?? upgradeStep(options.world.world().getBlock(x, y, z))?.to ?? 1;
      hub.sendCommand({ type: 'upgrade', x, y, z, state });
    },
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
    setRespawns: (count) => {
      const session = hub.current;
      if (session instanceof HostSession) session.survivalSim?.setRespawns(count);
    },
    restart: (kind) => hub.restartRun(kind),
    rejections: () => [...refusals],
    eventCount: () => events,
  };

  if (flags.join !== null) lobby.join(flags.join);
  syncAddress();

  return {
    lobby,
    debug,
    predictShot: (origin, dir) => shots.predict(origin, dir),
    update(dt) {
      sync.update(dt);
      remotes.update(dt, hub.sampleRemotes());
      enemies.update(dt, hub.sampleEnemies());
      debris.setAimed(options.aimedDebris());
      debris.update(dt, hub.economy.debris, hub.run);
      shots.update(dt);
    },
    dispose() {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('beforeunload', onBeforeUnload);
      stopAddress();
      stopPresence();
      stopRejected();
      stopEvents();
      stopShots();
      stopStrips();
      panel.dispose();
      sync.dispose();
      options.scene.remove(remotes.object);
      remotes.dispose();
      enemies.dispose();
      debris.dispose();
      shotFx.dispose();
      lobby.dispose();
    },
  };
}
