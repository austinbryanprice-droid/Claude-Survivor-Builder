import type { CameraPose, CameraRoute } from '../shared/camera-pose';
import type { Flags } from '../shared/flags';
import { TICK_SECONDS, createFixedStepper } from '../shared/fixed-step';
import { SampleWindow } from '../shared/frame-stats';
import type { CollisionWorld } from '../shared/ground';
import { angleDelta, clampPitch, wrapAngle, type LookState } from '../shared/look';
import {
  createPlayerInput,
  createPlayerState,
  horizontalSpeed,
  stepPlayer,
  teleportPlayer,
  type PlayerState,
} from '../shared/movement';
import type { QualityName } from '../shared/quality';
import type { Settings } from '../shared/settings';
import type { SweepExtras } from '../shared/sweep-report';
import { createAvatar } from './avatar';
import { PresetSweep, type SweepTarget } from './bench-sweep';
import { createCameraRig, type CameraRig, type RigFrame, type ViewPoint } from './camera-rig';
import { createInput, type Input } from './input';
import type { RenderListener, Stage } from './stage';

/** Radians of turn per pixel of mouse movement at sensitivity 1. */
const RADIANS_PER_PIXEL = 0.0022;
/** Falling this far below the lowest ground puts the player back at the start. */
const FALL_LIMIT = -10;
/** The feet start this far above the ground and settle onto it. */
const SPAWN_LIFT = 0.05;
/** Frame gaps longer than this are a hidden tab or a breakpoint, not a slow frame. */
const MAX_COUNTED_FRAME_MS = 1000;
const TIMING_WINDOW = 240;

export interface FrameTiming {
  /** Time between frames as the browser presents them, newest last. */
  readonly frameMs: SampleWindow;
  /** Time our own frame callback took, which excludes waiting for the GPU. */
  readonly cpuMs: SampleWindow;
  /** Simulation ticks run for the last frame. */
  ticks: number;
  drawCalls: number;
  triangles: number;
}

/** Where a player starts, and which way they face. */
export interface SpawnPoint {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
}

/** Facts about a built world that the benchmark report quotes. */
export type WorldInfo = Omit<SweepExtras, 'timerQueries'>;

/**
 * What the game needs from the world it is played in. The app builds one from a seed: the engine
 * moves a player through `collision`, flies the benchmark along `route`, and never learns what the
 * world is made of. A world draws itself by subscribing to the stage, and removes what it drew in
 * `dispose`.
 */
export interface GameWorld {
  readonly seed: number;
  /** Structures as cells and terrain as smooth ground. */
  readonly collision: CollisionWorld;
  readonly spawn: SpawnPoint;
  /** The benchmark's flythrough. */
  readonly route: CameraRoute;
  readonly info: WorldInfo;
  /** Height of the walkable ground at a spot. */
  groundAt(x: number, z: number): number;
  dispose(): void;
}

export interface GameOptions {
  stage: Stage;
  /** Edited live by the UI; the engine reads it every frame. */
  settings: Settings;
  flags: Flags;
  /** Presets the benchmark flies through, in order. */
  benchPresets: readonly QualityName[];
  buildId: string;
  /** Builds the world for a seed. Called once now, and again by `loadWorld`. */
  createWorld(seed: number): GameWorld;
  seed: number;
}

export interface Game {
  readonly stage: Stage;
  readonly input: Input;
  readonly settings: Settings;
  /** The world being played; replaced by `loadWorld`. */
  readonly world: GameWorld;
  readonly player: PlayerState;
  readonly look: LookState;
  readonly rig: CameraRig;
  /** The benchmark: one flight through the valley for each preset. */
  readonly sweep: PresetSweep;
  readonly timing: FrameTiming;
  /** The graphics adapter as the browser reports it. */
  readonly gpu: string;
  /** Called at the end of every rendered frame. */
  onFrame(listener: () => void): () => void;
  /** Called after every simulation tick (60 a second), once the player has moved. */
  onTick(listener: () => void): () => void;
  /** Called every frame with the camera placed, just before the stage draws. */
  onBeforeRender(listener: RenderListener): () => void;
  /** Called when the benchmark starts, advances to the next preset, finishes or is stopped. */
  onSweepChange(listener: () => void): () => void;
  /** What the benchmark report adds to the frame numbers: timers, terrain mesher, build times. */
  sweepExtras(): SweepExtras;
  /** Puts the player somewhere else and stops them; `yaw` turns the view too when given. */
  teleport(x: number, y: number, z: number, yaw?: number): void;
  /** Builds the world for another seed and puts the player at its start. */
  loadWorld(seed: number): void;
  /** Applies a graphics preset and remembers it in the settings. */
  setQuality(name: QualityName): void;
  /** Takes the camera off the player and holds it at a pose (screenshots); null gives it back. */
  setPhoto(pose: CameraPose | null): void;
  /** Draws a frame right now, with the camera where it is. Tests use it to read pixels. */
  renderNow(): void;
  start(): void;
  dispose(): void;
}

function readGpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const value = info
      ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return typeof value === 'string' && value ? value : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Wires the stage, a world, the player and the camera into one fixed-step game loop. */
export function createGame({
  stage,
  settings,
  flags,
  benchPresets,
  buildId,
  createWorld,
  seed,
}: GameOptions): Game {
  const { renderer, camera } = stage;
  const gpu = readGpuName(renderer.getContext());

  let world = createWorld(seed);
  // The player and the camera ask this, so a world swap needs no rewiring.
  const collision: CollisionWorld = {
    isSolid: (x, y, z) => world.collision.isSolid(x, y, z),
    boxesAt: (x, y, z) => world.collision.boxesAt?.(x, y, z) ?? null,
    get ground() {
      return world.collision.ground;
    },
  };

  const avatar = createAvatar(stage.registry);
  stage.world.add(avatar.object);

  const input = createInput(renderer.domElement);
  const rig = createCameraRig(camera, collision);
  const player = createPlayerState();
  const look: LookState = { yaw: 0, pitch: 0 };
  const previous: ViewPoint = { x: 0, y: 0, z: 0 };
  const stepper = createFixedStepper();

  const timing: FrameTiming = {
    frameMs: new SampleWindow(TIMING_WINDOW),
    cpuMs: new SampleWindow(TIMING_WINDOW),
    ticks: 0,
    drawCalls: 0,
    triangles: 0,
  };

  const frameListeners = new Set<() => void>();
  const tickListeners = new Set<() => void>();
  const sweepListeners = new Set<() => void>();
  let photo: CameraPose | null = null;
  let bodyYaw = 0;
  let lastTime: number | null = null;

  const teleport = (x: number, y: number, z: number, yaw?: number): void => {
    teleportPlayer(player, x, y, z);
    previous.x = x;
    previous.y = y;
    previous.z = z;
    if (yaw !== undefined) look.yaw = wrapAngle(yaw);
    stepper.reset();
  };

  const toSpawn = (): void => {
    const { spawn } = world;
    teleport(spawn.x, world.groundAt(spawn.x, spawn.z) + SPAWN_LIFT, spawn.z, spawn.yaw);
    look.pitch = spawn.pitch;
    bodyYaw = look.yaw;
  };
  toSpawn();

  /** Puts the camera at a pose, for the benchmark route and for photos. */
  const placeCamera = (pose: CameraPose): void => {
    camera.position.set(pose.x, pose.y, pose.z);
    camera.rotation.set(pose.pitch, pose.yaw, 0);
    const fov = pose.fov ?? settings.fov;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  };

  const routePose: CameraPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  /** The moment held before the sweep took over the sky, to put back when it ends. */
  let momentBeforeSweep: { name: string | null } | null = null;
  const sweepTarget: SweepTarget = {
    get quality() {
      return stage.quality;
    },
    stats: stage.stats,
    get gpuMs() {
      return stage.gpuMs;
    },
    get gpuSerial() {
      return stage.gpuSerial;
    },
    applyQuality: (name) => stage.applyQuality(name),
    setMoment: (name) => {
      momentBeforeSweep ??= { name: stage.moment };
      stage.setMoment(name);
    },
    setGovernor: (on) => stage.setGovernor(on),
    placeOnRoute: (seconds, routeSeconds) => {
      world.route.sample(seconds / routeSeconds, routePose);
      placeCamera(routePose);
    },
    endRoute: () => {
      // The next normal frame puts the camera back with the player.
      if (momentBeforeSweep) stage.setMoment(momentBeforeSweep.name);
      momentBeforeSweep = null;
    },
  };
  const sweep = new PresetSweep(
    sweepTarget,
    flags.benchSeconds,
    benchPresets,
    () => ({
      buildId,
      gpu,
      userAgent: navigator.userAgent,
      canvasWidth: stage.drawSize.width,
      canvasHeight: stage.drawSize.height,
      devicePixelRatio: window.devicePixelRatio || 1,
      drawCalls: stage.stats.value?.drawCalls ?? 0,
      triangles: stage.stats.value?.triangles ?? 0,
    }),
    () => sweepListeners.forEach((listener) => listener()),
  );

  const stopActions = input.onAction((action) => {
    if (action === 'toggleCamera' && !sweep.active) rig.toggle();
    if (action === 'cancel') sweep.cancel('Stopped with Esc.');
  });

  const lookDelta = { dx: 0, dy: 0 };
  const tickInput = createPlayerInput();
  const rigFrame: RigFrame = {
    dt: 0,
    alpha: 0,
    previous,
    current: player,
    look,
    settings,
    speed: 0,
  };
  const avatarPose = { x: 0, y: 0, z: 0, bodyYaw: 0, speed: 0, onGround: true, pitch: 0 };

  const applyMouseLook = (): void => {
    input.takeLook(lookDelta);
    if (sweep.active) return;
    const turn = RADIANS_PER_PIXEL * settings.mouseSensitivity;
    look.yaw = wrapAngle(look.yaw - lookDelta.dx * turn);
    look.pitch = clampPitch(look.pitch - lookDelta.dy * turn * (settings.invertY ? -1 : 1));
  };

  const tick = (): void => {
    previous.x = player.x;
    previous.y = player.y;
    previous.z = player.z;
    input.readKeys(tickInput);
    tickInput.yaw = look.yaw;
    stepPlayer(player, tickInput, TICK_SECONDS, collision);
    if (player.y < FALL_LIMIT) toSpawn();
    rig.onTick(player);
    tickListeners.forEach((listener) => listener());
  };

  const frame = (timeMs: number): void => {
    const cpuStart = performance.now();
    const frameMs = lastTime === null ? 0 : timeMs - lastTime;
    lastTime = timeMs;
    const dt = Math.min(frameMs / 1000, 0.25);
    const sweeping = sweep.active;

    let ticks = 0;
    applyMouseLook();
    if (sweeping) {
      // The benchmark flies the camera along its route and the player stands still.
      sweep.beforeFrame(frameMs);
      avatar.object.visible = false;
    } else {
      ticks = stepper.advance(frameMs / 1000);
      for (let i = 0; i < ticks; i++) tick();

      const alpha = stepper.alpha;
      const speed = horizontalSpeed(player);
      const ix = previous.x + (player.x - previous.x) * alpha;
      const iy = previous.y + (player.y - previous.y) * alpha;
      const iz = previous.z + (player.z - previous.z) * alpha;
      if (photo) {
        placeCamera(photo);
        avatar.object.visible = false;
      } else {
        rigFrame.dt = dt;
        rigFrame.alpha = alpha;
        rigFrame.speed = speed;
        rig.update(rigFrame);
        const showAvatar = rig.showAvatar;
        avatar.object.visible = showAvatar;
        if (showAvatar) {
          bodyYaw = wrapAngle(bodyYaw + angleDelta(bodyYaw, look.yaw) * (1 - Math.exp(-16 * dt)));
          avatarPose.x = ix;
          avatarPose.y = iy;
          avatarPose.z = iz;
          avatarPose.bodyYaw = bodyYaw;
          avatarPose.speed = speed;
          avatarPose.onGround = player.onGround;
          avatarPose.pitch = look.pitch;
          avatar.update(dt, avatarPose);
        } else {
          bodyYaw = look.yaw;
        }
      }
    }

    // The governor stays out of the benchmark: it would hide the cost of a preset.
    stage.render(dt, sweeping ? 0 : frameMs);

    const cpuMs = performance.now() - cpuStart;
    const drawn = stage.stats.value;
    timing.ticks = ticks;
    timing.drawCalls = drawn?.drawCalls ?? 0;
    timing.triangles = drawn?.triangles ?? 0;
    if (frameMs > 0 && frameMs < MAX_COUNTED_FRAME_MS) {
      timing.frameMs.push(frameMs);
      timing.cpuMs.push(cpuMs);
    }
    if (sweeping) sweep.afterFrame(frameMs, cpuMs);
    frameListeners.forEach((listener) => listener());
  };

  const game: Game = {
    stage,
    input,
    settings,
    get world() {
      return world;
    },
    player,
    look,
    rig,
    sweep,
    timing,
    gpu,
    onFrame(listener) {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    onTick(listener) {
      tickListeners.add(listener);
      return () => tickListeners.delete(listener);
    },
    onBeforeRender: (listener) => stage.onBeforeRender(listener),
    onSweepChange(listener) {
      sweepListeners.add(listener);
      return () => sweepListeners.delete(listener);
    },
    sweepExtras: () => ({ timerQueries: stage.gpuTimer.supported, ...world.info }),
    teleport,
    loadWorld(nextSeed) {
      world.dispose();
      world = createWorld(nextSeed);
      toSpawn();
    },
    setQuality(name) {
      settings.quality = name;
      stage.applyQuality(name);
    },
    setPhoto(pose) {
      photo = pose;
    },
    renderNow() {
      stage.render(0, 0);
    },
    start() {
      stage.start(frame);
      if (flags.bench) sweep.start();
    },
    dispose() {
      stopActions();
      sweep.dispose();
      input.dispose();
      avatar.dispose();
      world.dispose();
      frameListeners.clear();
      tickListeners.clear();
      sweepListeners.clear();
      stage.dispose();
    },
  };
  return game;
}
