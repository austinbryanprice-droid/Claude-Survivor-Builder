import type { Camera } from 'three';
import type { Stage } from '../../engine/stage';
import type { QualitySettings } from '../../shared/quality';
import type { TerrainMode } from '../../shared/view-flags';
import { GrassField, createScatterGround, scatterTrees, type KeepClear } from '../scatter';
import type { Terrain } from '../terrain/terrain';
import { SHOTS } from '../terrain/viewpoints';
import type { VoxelWorld } from '../voxels/world';
import { BackdropRenderer } from './backdrop-render';
import { CoreRenderer } from './core-render';
import { bakeFoliageTextures, type FoliageTextures } from './foliage-textures';
import { GhostRenderer } from './ghost-render';
import { bakeGroundMaps, TerrainRenderer } from './terrain-render';
import { VegetationRenderer } from './vegetation-render';
import { VoxelRenderer } from './voxel-render';
import { WaterRenderer } from './water-render';

/** Trees keep this far from a viewpoint unless the viewpoint asks for more. */
const SHOT_CLEARANCE = 4.5;

/** How long the pieces of the picture took to build, in milliseconds. */
export interface ValleyBuildTimings {
  readonly mesh: number;
  readonly scatter: number;
}

/**
 * The valley as the stage draws it: the terrain mesh, the distant hills, the lake, the trees and
 * grass scattered over the ground, the Outpost Core at the crash site, and the blocks players have
 * built on it. It follows the stage's
 * quality preset and gets a callback before every frame to hide what is out of range and to mesh
 * the blocks that changed. Everything is built for one terrain, so a new seed means a new view.
 */
export class ValleyView {
  readonly terrain: TerrainRenderer;
  readonly backdrop: BackdropRenderer;
  readonly water: WaterRenderer | null;
  readonly vegetation: VegetationRenderer;
  readonly structures: VoxelRenderer;
  /** The ghost block and the outline of the block a click would break. */
  readonly ghost: GhostRenderer;
  /** The Outpost Core at the crash site; null in a world that has none. */
  readonly core: CoreRenderer | null;
  readonly foliage: FoliageTextures;
  readonly buildMs: ValleyBuildTimings;
  private readonly stopQuality: () => void;
  private readonly stopRender: () => void;
  private seenRevision = 0;

  constructor(
    private readonly stage: Stage,
    data: Terrain,
    mode: TerrainMode,
    private readonly voxels: VoxelWorld,
    /** Places where no tree may grow, beside the viewpoints that always stay clear. */
    keepClear: readonly KeepClear[] = [],
  ) {
    const { world, registry, textures, renderer } = stage;
    const { grid, field, seed } = data;
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const maps = bakeGroundMaps(field, grid);

    this.terrain = new TerrainRenderer(world, grid, maps, textures, registry, mode);
    this.backdrop = new BackdropRenderer(world, field, registry);
    this.water = maps.lake ? new WaterRenderer(world, maps.lake, textures, registry) : null;

    const t0 = performance.now();
    this.foliage = bakeFoliageTextures(seed, anisotropy);
    const ground = createScatterGround(grid, { data: maps.splatData, size: maps.splatSize });
    const trees = scatterTrees(seed, ground, [
      ...Object.values(SHOTS).map((pose) => ({
        x: pose.x,
        z: pose.z,
        radius: pose.clear ?? SHOT_CLEARANCE,
      })),
      ...keepClear,
    ]);
    const grass = new GrassField(seed, ground, trees);
    this.vegetation = new VegetationRenderer(
      world,
      trees,
      grass,
      this.foliage,
      textures,
      maps,
      registry,
    );
    this.buildMs = { mesh: this.terrain.stats.meshMs, scatter: performance.now() - t0 };
    this.structures = new VoxelRenderer(stage, voxels);
    this.ghost = new GhostRenderer(stage);
    this.core = voxels.outpost ? new CoreRenderer(world, registry, voxels.outpost) : null;
    this.vegetation.setObstacles(voxels);

    // The planar water reflection is drawn from the lake's side of the scene, before the main view.
    stage.pipeline.beforeScene = (camera) =>
      this.water?.renderReflection(
        renderer,
        stage.scene,
        camera,
        stage.pipeline.width,
        stage.pipeline.height,
      );
    this.stopQuality = stage.onQuality((quality) => this.setQuality(quality));
    this.setQuality(stage.quality);
    this.stopRender = stage.onBeforeRender((camera) => this.update(camera));
  }

  /** Applies a preset: how far the terrain is drawn, which water model, how much foliage. */
  setQuality(quality: QualitySettings): void {
    this.terrain.setViewDistance(quality.viewChunks * 16 + 64);
    this.water?.setMode(quality.water, quality.reflectionScale);
    this.vegetation.setQuality(quality);
  }

  /** Hides what is out of range and moves the grass and trees that follow the camera. */
  update(camera: Camera): void {
    this.terrain.update(camera);
    if (this.voxels.revision !== this.seenRevision) {
      this.seenRevision = this.voxels.revision;
      this.vegetation.invalidate();
    }
    this.vegetation.update(camera);
    this.structures.update(camera);
    this.core?.update(this.stage.animTime);
  }

  dispose(): void {
    this.stopQuality();
    this.stopRender();
    this.stage.pipeline.beforeScene = null;
    this.core?.dispose();
    this.ghost.dispose();
    this.structures.dispose();
    this.vegetation.dispose();
    this.foliage.dispose();
    this.backdrop.dispose();
    this.water?.dispose();
    this.terrain.dispose();
  }
}
