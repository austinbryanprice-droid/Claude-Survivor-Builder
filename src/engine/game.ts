import { Vector3 } from 'three';
import type { Flags } from '../shared/flags';
import { TICK_SECONDS, createFixedStepper } from '../shared/fixed-step';
import { SampleWindow } from '../shared/frame-stats';
import { angleDelta, clampPitch, wrapAngle, type LookState } from '../shared/look';
import {
  createPlayerInput,
  createPlayerState,
  horizontalSpeed,
  stepPlayer,
  teleportPlayer,
  type PlayerInput,
  type PlayerState,
} from '../shared/movement';
import type { Settings } from '../shared/settings';
import { createAvatar } from './avatar';
import { createBenchmark, type Benchmark } from './bench';
import { createCameraRig, type CameraRig, type RigFrame, type ViewPoint } from './camera-rig';
import { createEnvironment } from './environment';
import { createInput, type Input } from './input';
import { createProvingGroundView } from './proving-ground';
import { SPAWN, buildProvingGround, type ProvingGround } from './proving-ground-layout';
import { createStage, type Stage } from './stage';

/** Radians of turn per pixel of mouse movement at sensitivity 1. */
const RADIANS_PER_PIXEL = 0.0022;
/** Falling this far below the deck puts the player back at the start. */
const FALL_LIMIT = -30;
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

export interface GameOptions {
  canvas: HTMLCanvasElement;
  /** Edited live by the UI; the engine reads it every frame. */
  settings: Settings;
  flags: Flags;
  buildId: string;
}

export interface Game {
  readonly stage: Stage;
  readonly input: Input;
  readonly settings: Settings;
  readonly world: ProvingGround;
  readonly player: PlayerState;
  readonly look: LookState;
  readonly rig: CameraRig;
  readonly bench: Benchmark;
  readonly timing: FrameTiming;
  /** The graphics adapter as the browser reports it. */
  readonly gpu: string;
  /** Called at the end of every rendered frame. */
  onFrame(listener: () => void): () => void;
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

function setNeutral(input: PlayerInput, yaw: number): void {
  input.forward = 0;
  input.strafe = 0;
  input.jump = false;
  input.sprint = false;
  input.yaw = yaw;
}

/** Wires the stage, the test scene, the player and the camera into one fixed-step game loop. */
export function createGame({ canvas, settings, flags, buildId }: GameOptions): Game {
  const stage = createStage(canvas);
  const { renderer, scene, camera } = stage;
  const gpu = readGpuName(renderer.getContext());
  const environment = createEnvironment(renderer, scene);

  const world = buildProvingGround();
  const view = createProvingGroundView(
    world,
    Math.min(8, renderer.capabilities.getMaxAnisotropy()),
  );
  scene.add(view.object);
  const avatar = createAvatar();
  scene.add(avatar.object);

  const input = createInput(canvas);
  const rig = createCameraRig(camera, world);
  const player = createPlayerState(SPAWN.x, SPAWN.y, SPAWN.z);
  const look: LookState = { yaw: SPAWN.yaw, pitch: 0 };
  const previous: ViewPoint = { x: player.x, y: player.y, z: player.z };
  const stepper = createFixedStepper();

  const timing: FrameTiming = {
    frameMs: new SampleWindow(TIMING_WINDOW),
    cpuMs: new SampleWindow(TIMING_WINDOW),
    ticks: 0,
    drawCalls: 0,
    triangles: 0,
  };

  const bench = createBenchmark(flags.benchSeconds, {
    prepare() {
      teleportPlayer(player, SPAWN.x, SPAWN.y, SPAWN.z);
      previous.x = player.x;
      previous.y = player.y;
      previous.z = player.z;
      look.yaw = SPAWN.yaw;
      look.pitch = 0;
      rig.setMode('first', true);
      stepper.reset();
    },
    describe: () => ({
      buildId,
      gpu,
      userAgent: navigator.userAgent,
      canvasWidth: renderer.domElement.width,
      canvasHeight: renderer.domElement.height,
      devicePixelRatio: window.devicePixelRatio,
      drawCalls: timing.drawCalls,
      triangles: timing.triangles,
    }),
  });

  const stopActions = input.onAction((action) => {
    if (action === 'toggleCamera' && !bench.takesOver) rig.toggle();
    if (action === 'cancel') bench.cancel('Stopped with Esc.');
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
  const shadowFocus = new Vector3();
  const frameListeners = new Set<() => void>();
  let bodyYaw = look.yaw;
  let lastTime: number | null = null;

  const applyMouseLook = (): void => {
    input.takeLook(lookDelta);
    if (bench.takesOver) return;
    const turn = RADIANS_PER_PIXEL * settings.mouseSensitivity;
    look.yaw = wrapAngle(look.yaw - lookDelta.dx * turn);
    look.pitch = clampPitch(look.pitch - lookDelta.dy * turn * (settings.invertY ? -1 : 1));
  };

  const tick = (): void => {
    previous.x = player.x;
    previous.y = player.y;
    previous.z = player.z;
    if (bench.takesOver) {
      setNeutral(tickInput, look.yaw);
      bench.driveTick(tickInput, look, rig);
    } else {
      input.readKeys(tickInput);
      tickInput.yaw = look.yaw;
    }
    stepPlayer(player, tickInput, TICK_SECONDS, world);
    if (player.y < FALL_LIMIT) {
      teleportPlayer(player, SPAWN.x, SPAWN.y, SPAWN.z);
      previous.x = player.x;
      previous.y = player.y;
      previous.z = player.z;
    }
    rig.onTick(player);
  };

  const frame = (timeMs: number): void => {
    const cpuStart = performance.now();
    const frameMs = lastTime === null ? 0 : timeMs - lastTime;
    lastTime = timeMs;
    const dt = Math.min(frameMs / 1000, 0.25);

    applyMouseLook();
    const ticks = stepper.advance(frameMs / 1000);
    for (let i = 0; i < ticks; i++) tick();

    const alpha = stepper.alpha;
    const speed = horizontalSpeed(player);
    rigFrame.dt = dt;
    rigFrame.alpha = alpha;
    rigFrame.speed = speed;
    rig.update(rigFrame);

    const ix = previous.x + (player.x - previous.x) * alpha;
    const iy = previous.y + (player.y - previous.y) * alpha;
    const iz = previous.z + (player.z - previous.z) * alpha;
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
    shadowFocus.set(ix, iy + 1, iz);
    environment.update(camera, shadowFocus);
    stage.render();

    const cpuMs = performance.now() - cpuStart;
    timing.ticks = ticks;
    timing.drawCalls = renderer.info.render.calls;
    timing.triangles = renderer.info.render.triangles;
    if (frameMs > 0 && frameMs < MAX_COUNTED_FRAME_MS) {
      timing.frameMs.push(frameMs);
      timing.cpuMs.push(cpuMs);
      bench.recordFrame(frameMs, cpuMs);
    }
    frameListeners.forEach((listener) => listener());
  };

  return {
    stage,
    input,
    settings,
    world,
    player,
    look,
    rig,
    bench,
    timing,
    gpu,
    onFrame(listener) {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    start() {
      stage.start(frame);
      if (flags.bench) bench.start();
    },
    dispose() {
      stopActions();
      bench.dispose();
      input.dispose();
      avatar.dispose();
      view.dispose();
      environment.dispose();
      frameListeners.clear();
      stage.dispose();
    },
  };
}
