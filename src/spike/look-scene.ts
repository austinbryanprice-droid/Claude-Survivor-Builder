import { Group, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { Atmosphere } from '../engine/atmosphere';
import { SunRig } from '../engine/lighting';
import { MaterialRegistry } from '../engine/materials';
import { AdaptiveScale, MAX_INTERNAL_PIXELS, scaleForPixelBudget } from '../engine/perf';
import { Pipeline, type PipelineStats } from '../engine/pipeline';
import { createSky } from '../engine/sky';
import { bakeTextures, type BakedTextures } from '../engine/texture-bake';
import { TIME_PRESETS, skyStateAt, skyStateForPhase, type SkyState } from '../shared/daycycle';
import { QUALITY_PRESETS, type QualityName, type QualitySettings } from '../shared/quality';
import { BackdropRenderer } from '../world/render/backdrop-render';
import { bakeFoliageTextures, type FoliageTextures } from '../world/render/foliage-textures';
import { bakeGroundMaps, TerrainRenderer } from '../world/render/terrain-render';
import { VegetationRenderer } from '../world/render/vegetation-render';
import { WaterRenderer } from '../world/render/water-render';
import { GrassField, createScatterGround, scatterTrees } from '../world/scatter';
import {
  CRASH,
  LAKE,
  WATER_LEVEL,
  WORLD_HALF,
  createTerrainField,
  type TerrainField,
} from '../world/terrain/field';
import { bakeGrid, type SdfGrid } from '../world/terrain/grid';
import { CameraPath, LookController } from './controls';
import type { LookParams } from './params';
import { DEFAULT_SHOT, SHOTS, type ShotPose } from './shots';

/** Seconds the compressed day-night cycle takes when `?clock` is on. */
const CLOCK_SECONDS = 120;
/** Animation time used when frames are frozen for screenshots. */
const FROZEN_TIME = 23.5;

export interface BuildTimings {
  readonly textureMs: number;
  readonly fieldMs: number;
  readonly gridMs: number;
  readonly meshMs: number;
  readonly scatterMs: number;
  readonly totalMs: number;
}

/**
 * The throwaway scene of the look spike: the whole valley, lit and graded, wired from the
 * engine and world modules. Everything it owns is created in the constructor so a quality or
 * time change is only a few setter calls.
 */
export class LookScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 16 / 9, 0.12, 3200);
  readonly world = new Group();
  readonly textures: BakedTextures;
  readonly field: TerrainField;
  readonly grid: SdfGrid;
  readonly atmosphere: Atmosphere;
  readonly registry: MaterialRegistry;
  readonly sun: SunRig;
  readonly pipeline: Pipeline;
  readonly terrain: TerrainRenderer;
  readonly water: WaterRenderer | null;
  readonly backdrop: BackdropRenderer;
  readonly vegetation: VegetationRenderer;
  readonly foliage: FoliageTextures;
  readonly controller: LookController;
  readonly timings: BuildTimings;
  readonly stats: { value: PipelineStats | null } = { value: null };

  quality: QualitySettings;
  sky: SkyState;
  /** True when something changed that needs a redraw while frames are frozen. */
  dirty = true;
  /** Seconds of animation time (clouds, wind, water). */
  animTime = 0;
  /** Named shot the camera sits at, or null in free movement. */
  shot: string | null = null;

  private governor: AdaptiveScale | null = null;
  private forcedScale: number | null;
  private fixedMoment: { elevation: number; bearing: number } | null;
  private clockTime = 0;
  private path: CameraPath | null = null;
  private pathTime = 0;
  private canvasWidth = 2;
  private canvasHeight = 2;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly params: LookParams,
  ) {
    const t0 = performance.now();
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

    const quality = QUALITY_PRESETS[params.quality];
    this.quality = quality;
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const tTex = performance.now();
    this.textures = bakeTextures(renderer, {
      groundSize: quality.name === 'low' ? 256 : 512,
      anisotropy,
    });
    const textureMs = performance.now() - tTex;

    const tField = performance.now();
    this.field = createTerrainField(params.seed);
    const fieldMs = performance.now() - tField;
    const tGrid = performance.now();
    this.grid = bakeGrid(this.field);
    const gridMs = performance.now() - tGrid;
    const maps = bakeGroundMaps(this.field, this.grid);

    this.atmosphere = new Atmosphere(this.textures.noise, {
      lake: { x: LAKE.x, z: LAKE.z, radius: 46, top: WATER_LEVEL + 5.5 },
      crash: { x: CRASH.x, z: CRASH.z, radius: CRASH.radius * 1.5, top: CRASH.floor + 4 },
    });
    const shadowParams = { value: new Vector3(1, 60, 90) };
    this.registry = new MaterialRegistry(this.atmosphere.uniforms, shadowParams);

    const sky = createSky(this.registry);
    this.scene.add(sky.mesh);
    this.scene.add(this.world);

    this.terrain = new TerrainRenderer(this.world, this.grid, maps, this.textures, this.registry);
    const meshMs = this.terrain.stats.meshMs;
    this.backdrop = new BackdropRenderer(this.world, this.field, this.registry);
    this.water = maps.lake
      ? new WaterRenderer(this.world, maps.lake, this.textures, this.registry)
      : null;

    const tScatter = performance.now();
    this.foliage = bakeFoliageTextures(params.seed, anisotropy);
    const ground = createScatterGround(this.grid, { data: maps.splatData, size: maps.splatSize });
    const trees = scatterTrees(
      params.seed,
      ground,
      Object.values(SHOTS).map((pose) => ({ x: pose.x, z: pose.z, radius: pose.clear ?? 4.5 })),
    );
    const grass = new GrassField(params.seed, ground, trees);
    this.vegetation = new VegetationRenderer(
      this.world,
      trees,
      grass,
      this.foliage,
      this.textures,
      maps,
      this.registry,
    );
    const scatterMs = performance.now() - tScatter;

    this.sun = new SunRig(this.world, renderer, shadowParams);
    this.pipeline = new Pipeline(renderer);
    this.pipeline.beforeScene = (camera) =>
      this.water?.renderReflection(
        renderer,
        this.scene,
        camera,
        this.pipeline.width,
        this.pipeline.height,
      );
    this.forcedScale = params.scale;

    this.fixedMoment = params.clock ? null : (TIME_PRESETS[params.time ?? 'golden'] ?? null);
    this.sky = this.computeSky();
    this.controller = new LookController(canvas, this.grid, WORLD_HALF);

    this.timings = {
      textureMs,
      fieldMs,
      gridMs,
      meshMs,
      scatterMs,
      totalMs: performance.now() - t0,
    };

    this.applyQuality(quality.name);
    this.setShot(params.shot && params.shot in SHOTS ? params.shot : DEFAULT_SHOT);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Switches the preset: shadows, post, materials and view distance. */
  applyQuality(name: QualityName): void {
    const q = QUALITY_PRESETS[name];
    this.quality = q;
    this.sun.configure(q);
    this.registry.setSwitches({ richSky: q.richClouds, mist: q.mist, detailBump: q.detailNormals });
    this.terrain.setViewDistance(q.viewChunks * 16 + 64);
    this.water?.setMode(q.water, q.reflectionScale);
    this.vegetation.setQuality(q);
    this.pipeline.setQuality(q);
    this.governor =
      q.adaptiveScale && this.forcedScale === null
        ? new AdaptiveScale(q.renderScale, q.minRenderScale, q.renderScale)
        : null;
    this.fitRenderScale();
    this.dirty = true;
  }

  /** Puts the camera at a named shot (and the shot's own moment unless the URL chose one). */
  setShot(name: string): void {
    const pose: ShotPose | undefined = SHOTS[name];
    if (!pose) return;
    this.shot = name;
    this.path = null;
    this.controller.place(pose);
    this.camera.fov = pose.fov ?? 60;
    this.camera.updateProjectionMatrix();
    if (!this.params.time && !this.params.clock) this.setMoment(pose.time ?? 'golden');
    this.dirty = true;
  }

  /** Picks a named moment from TIME_PRESETS, or null to run the clock. */
  setMoment(name: string | null): void {
    this.fixedMoment = name ? (TIME_PRESETS[name] ?? null) : null;
    this.dirty = true;
  }

  /** Starts (or stops) the looping benchmark path. */
  followPath(seconds: number | null): void {
    this.path = seconds === null ? null : new CameraPath(this.grid, seconds);
    this.pathTime = 0;
    this.dirty = true;
  }

  get moving(): boolean {
    return this.path !== null || this.controller.active;
  }

  private computeSky(): SkyState {
    if (this.fixedMoment) return skyStateAt(this.fixedMoment.elevation, this.fixedMoment.bearing);
    return skyStateForPhase((this.clockTime / CLOCK_SECONDS) % 1);
  }

  resize(): void {
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
    this.dirty = true;
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

  /** Advances time and draws one frame. `dt` is in seconds, `frameMs` the previous frame's cost. */
  frame(dt: number, frameMs: number): void {
    if (this.params.freeze) {
      this.animTime = FROZEN_TIME;
    } else {
      this.animTime += dt;
      if (this.fixedMoment === null) this.clockTime += dt;
    }
    if (this.fixedMoment === null || this.dirty) this.sky = this.computeSky();

    if (this.path) {
      this.pathTime += dt;
      this.path.apply(this.camera, this.pathTime);
    } else {
      this.controller.update(dt);
      this.controller.apply(this.camera);
    }
    this.camera.updateMatrixWorld();

    if (this.governor && frameMs > 0 && this.governor.update(frameMs)) this.fitRenderScale();

    this.atmosphere.update(this.sky, this.camera, this.animTime);
    this.sun.update(this.atmosphere.uniforms.uKeyDir.value, this.camera);
    this.terrain.update(this.camera);
    this.vegetation.update(this.camera);
    this.pipeline.render(
      this.scene,
      this.camera,
      { sky: this.sky, timeSeconds: this.animTime },
      this.stats,
    );
    this.dirty = false;
  }

  get drawSize(): { width: number; height: number } {
    return { width: this.canvasWidth, height: this.canvasHeight };
  }

  dispose(): void {
    this.vegetation.dispose();
    this.foliage.dispose();
    this.backdrop.dispose();
    this.water?.dispose();
    this.terrain.dispose();
    this.sun.dispose();
    this.pipeline.dispose();
    this.registry.dispose();
    this.textures.dispose();
    this.renderer.dispose();
  }
}
