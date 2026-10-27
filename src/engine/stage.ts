import {
  Group,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Mesh,
  type Object3D,
} from 'three';
import { TIME_PRESETS, skyStateAt, skyStateForPhase, type SkyState } from '../shared/daycycle';
import { QUALITY_PRESETS, type QualityName, type QualitySettings } from '../shared/quality';
import { Atmosphere, type MistZones } from './atmosphere';
import { SunRig } from './lighting';
import { MaterialRegistry } from './materials';
import { AdaptiveScale, GpuTimer, MAX_INTERNAL_PIXELS, scaleForPixelBudget } from './perf';
import { Pipeline, type PipelineStats } from './pipeline';
import { createSky } from './sky';
import {
  bakeStructureTextures,
  bakeTextures,
  type BakeOptions,
  type BakedStructure,
  type BakedTextures,
  type StructureTextures,
} from './texture-bake';

/** Seconds the compressed day-night cycle takes when no fixed moment is chosen. */
const CLOCK_SECONDS = 120;
/** Animation time used when frames are frozen for screenshots. */
const FROZEN_TIME = 23.5;
/** The moment the game opens at: a low warm sun, the hero light of the references. */
export const DEFAULT_MOMENT = 'golden';

export interface StageOptions {
  canvas: HTMLCanvasElement;
  /** The preset to start with. */
  quality: QualityName;
  /** A forced internal render scale, which switches the adaptive governor off; null lets it work. */
  scale: number | null;
  /** Holds clouds, wind and water at one instant, so a screenshot repeats. */
  freeze: boolean;
  /** A moment from TIME_PRESETS to hold, or null to run the compressed day-night clock. */
  moment: string | null;
  /** Where the colored mist pockets sit; the world knows, the stage only draws them. */
  mist: MistZones;
}

/** Where the sky is in its day-night cycle, as a position in [0, 1). The game's clock supplies it. */
export type SkyDriver = () => number;

export type QualityListener = (quality: QualitySettings) => void;
export type RenderListener = (camera: PerspectiveCamera, dt: number) => void;

/**
 * Everything it takes to put a lit, atmospheric picture on one canvas: the renderer and its post
 * pipeline, the shared materials and textures, the sky, the sun and its shadows, the adaptive
 * resolution governor and the GPU timer. It knows nothing about what is in the world; the world
 * adds meshes to `world`, subscribes to quality changes and gets a callback before each draw.
 */
export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(70, 16 / 9, 0.12, 3200);
  /** Parent of everything the world draws. */
  readonly world = new Group();
  readonly textures: BakedTextures;
  readonly atmosphere: Atmosphere;
  readonly registry: MaterialRegistry;
  readonly sun: SunRig;
  readonly pipeline: Pipeline;
  readonly gpuTimer: GpuTimer;
  /** Size and counts of the latest frame, all passes included. */
  readonly stats: { value: PipelineStats | null } = { value: null };

  quality: QualitySettings;
  sky: SkyState;
  /** Seconds of animation time (clouds, wind, water). */
  animTime = 0;
  /** GPU milliseconds of the latest finished frame, when the browser can time it. */
  gpuMs: number | null = null;
  /** Counts finished GPU measurements, so a reader can tell a new one from the last. */
  gpuSerial = 0;

  private governor: AdaptiveScale | null = null;
  private governorOn = true;
  private readonly forcedScale: number | null;
  private readonly frozen: boolean;
  private momentName: string | null;
  private fixedMoment: { elevation: number; bearing: number } | null;
  private skyDirty = true;
  private clockTime = 0;
  private skyDriver: SkyDriver | null = null;
  private skyOverride: (() => SkyState) | null = null;
  private drivenPhase = Number.NaN;
  private canvasWidth = 2;
  private canvasHeight = 2;
  private announced = false;
  private readonly observer: ResizeObserver;
  private readonly qualityListeners = new Set<QualityListener>();
  private readonly renderListeners = new Set<RenderListener>();
  private readonly skyMesh: Mesh;
  private readonly bakeOptions: BakeOptions;
  private structureTiles: BakedStructure | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: StageOptions,
  ) {
    this.camera.layers.enable(1);
    const renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      depth: false,
      stencil: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(1);
    this.renderer = renderer;

    const quality = QUALITY_PRESETS[options.quality];
    this.quality = quality;
    this.forcedScale = options.scale;
    this.frozen = options.freeze;
    this.fixedMoment = options.moment === null ? null : (TIME_PRESETS[options.moment] ?? null);
    this.momentName = this.fixedMoment ? options.moment : null;
    this.sky = this.computeSky();

    this.bakeOptions = {
      groundSize: quality.name === 'low' ? 256 : 512,
      anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
    };
    this.textures = bakeTextures(renderer, this.bakeOptions);
    this.atmosphere = new Atmosphere(this.textures.noise, options.mist);
    const shadowParams = { value: new Vector3(1, 60, 90) };
    this.registry = new MaterialRegistry(this.atmosphere.uniforms, shadowParams);

    this.skyMesh = createSky(this.registry).mesh;
    this.scene.add(this.skyMesh, this.world);

    this.sun = new SunRig(this.world, renderer, shadowParams);
    this.gpuTimer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
    this.pipeline = new Pipeline(renderer);

    this.applyQuality(quality.name);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  /** True once the block tiles have been baked. */
  get structureReady(): boolean {
    return this.structureTiles !== null;
  }

  /**
   * The block tiles, baked the first time they are asked for: a page that never draws a block pays
   * nothing for them. Call it early (when a player enters Build Mode, or a world with blocks
   * loads) so that the bake does not land on the frame of the first block.
   */
  get structure(): StructureTextures {
    this.structureTiles ??= bakeStructureTextures(this.renderer, this.bakeOptions);
    return this.structureTiles;
  }

  /**
   * Compiles the programs that drawing `object` will need, so its first frame does not stall on the
   * driver. Resolves when they are ready; where the browser compiles in parallel the frame loop
   * keeps running meanwhile.
   */
  precompile(object: Object3D): Promise<void> {
    return this.pipeline.precompile(object, this.scene, this.camera);
  }

  /** Switches the preset: shadows, post, materials, and whatever the world subscribed with `onQuality`. */
  applyQuality(name: QualityName): void {
    const q = QUALITY_PRESETS[name];
    this.quality = q;
    this.sun.configure(q);
    this.registry.setSwitches({ richSky: q.richClouds, mist: q.mist, detailBump: q.detailNormals });
    this.pipeline.setQuality(q);
    this.governor = this.makeGovernor();
    this.fitRenderScale();
    this.qualityListeners.forEach((listener) => listener(q));
  }

  /** Calls `listener` whenever the preset changes. It is not called for the preset already set. */
  onQuality(listener: QualityListener): () => void {
    this.qualityListeners.add(listener);
    return () => this.qualityListeners.delete(listener);
  }

  /** Calls `listener` once per frame after the camera is placed and before anything is drawn. */
  onBeforeRender(listener: RenderListener): () => void {
    this.renderListeners.add(listener);
    return () => this.renderListeners.delete(listener);
  }

  private makeGovernor(): AdaptiveScale | null {
    const q = this.quality;
    return q.adaptiveScale && this.forcedScale === null && this.governorOn
      ? new AdaptiveScale(q.renderScale, q.minRenderScale, q.renderScale)
      : null;
  }

  /** Turns the adaptive resolution governor on or off (the benchmark measures without it). */
  setGovernor(on: boolean): void {
    this.governorOn = on;
    this.governor = this.makeGovernor();
    this.fitRenderScale();
  }

  /** The render scale the governor has settled on, or the preset's own when it is off. */
  get renderScale(): number {
    return this.pipeline.renderScale;
  }

  /** Picks a named moment from TIME_PRESETS, or null to run the clock. Unknown names are ignored. */
  setMoment(name: string | null): void {
    if (name !== null && !(name in TIME_PRESETS)) return;
    this.momentName = name;
    this.fixedMoment = name === null ? null : (TIME_PRESETS[name] ?? null);
    this.skyDirty = true;
  }

  /** The held moment's name, or null while the clock runs. */
  get moment(): string | null {
    return this.momentName;
  }

  /**
   * Lets the game's own clock say where the sky is whenever no moment is held. Without a driver
   * the sky runs the compressed demo clock instead. Pass null to take the driver away.
   */
  setSkyDriver(driver: SkyDriver | null): void {
    this.skyDriver = driver;
    this.drivenPhase = Number.NaN;
    this.skyDirty = true;
  }

  /**
   * Takes the sky away from the held moment and the clock for a while, as the intro does to run a
   * night through in a few seconds: `sky` is asked once a frame and what it returns is drawn. Null
   * gives the sky back to whatever held it before.
   */
  setSkyOverride(sky: (() => SkyState) | null): void {
    this.skyOverride = sky;
    this.skyDirty = true;
  }

  /**
   * Whether the sky has moved since it was last worked out, without anyone asking: an override
   * moves every frame, the demo clock too, the game's clock only when it has, and a held moment never.
   */
  private skyMoves(): boolean {
    if (this.skyOverride !== null) return true;
    if (this.fixedMoment !== null) return false;
    return this.skyDriver === null || this.skyDriver() !== this.drivenPhase;
  }

  private computeSky(): SkyState {
    if (this.skyOverride) return this.skyOverride();
    if (this.fixedMoment) return skyStateAt(this.fixedMoment.elevation, this.fixedMoment.bearing);
    if (this.skyDriver) {
      this.drivenPhase = this.skyDriver();
      return skyStateForPhase(this.drivenPhase);
    }
    return skyStateForPhase((this.clockTime / CLOCK_SECONDS) % 1);
  }

  /** The canvas size in drawing-buffer pixels. */
  get drawSize(): { width: number; height: number } {
    return { width: this.canvasWidth, height: this.canvasHeight };
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.canvasWidth && h === this.canvasHeight) return;
    this.canvasWidth = w;
    this.canvasHeight = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.resize(w, h);
    this.fitRenderScale();
  }

  /** Applies the preset's scale, a forced `?scale=`, and the pixel budget for large canvases. */
  private fitRenderScale(): void {
    const q = this.quality;
    const preferred = this.forcedScale ?? this.governor?.scale ?? q.renderScale;
    const capped = scaleForPixelBudget(
      this.canvasWidth,
      this.canvasHeight,
      MAX_INTERNAL_PIXELS[q.name],
      preferred,
    );
    this.pipeline.setRenderScale(capped);
  }

  /**
   * Advances the sky and the animation by `dt` seconds and draws one frame with the camera as it
   * is. `frameMs` is how long the previous frame took to present, for the resolution governor;
   * pass 0 to leave the governor out of it.
   */
  render(dt: number, frameMs: number): void {
    if (this.frozen) {
      this.animTime = FROZEN_TIME;
    } else {
      this.animTime += dt;
      if (this.fixedMoment === null) this.clockTime += dt;
    }
    if (this.skyDirty || this.skyMoves()) {
      this.sky = this.computeSky();
      this.skyDirty = false;
    }

    this.camera.updateMatrixWorld();
    if (this.governor && frameMs > 0 && this.governor.update(frameMs)) this.fitRenderScale();

    this.atmosphere.update(this.sky, this.camera, this.animTime);
    this.sun.update(this.atmosphere.uniforms.uKeyDir.value, this.camera);
    this.renderListeners.forEach((listener) => listener(this.camera, dt));

    this.gpuTimer.begin();
    this.pipeline.render(
      this.scene,
      this.camera,
      { sky: this.sky, timeSeconds: this.animTime },
      this.stats,
    );
    this.gpuTimer.end();
    for (const ms of this.gpuTimer.collect()) {
      this.gpuMs = ms;
      this.gpuSerial++;
    }

    if (!this.announced) {
      this.announced = true;
      // Tests wait for this to know a frame has been drawn.
      document.documentElement.dataset.ready = 'true';
    }
  }

  /** Calls `onFrame` with the display timestamp (ms) once per frame. */
  start(onFrame: (timeMs: number) => void): void {
    this.renderer.setAnimationLoop(onFrame);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.qualityListeners.clear();
    this.renderListeners.clear();
    this.skyMesh.geometry.dispose();
    this.sun.dispose();
    this.pipeline.dispose();
    this.registry.dispose();
    this.textures.dispose();
    this.structureTiles?.dispose();
    this.renderer.dispose();
  }
}

export function createStage(options: StageOptions): Stage {
  return new Stage(options.canvas, options);
}
