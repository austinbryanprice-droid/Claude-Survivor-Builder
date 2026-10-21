import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  Sphere,
  Vector3,
  type Camera,
  type Group,
  type ShaderMaterial,
} from 'three';
import type { Stage } from '../../engine/stage';
import { MATERIAL, MATERIALS, SHAPE, TILE_LAYOUTS, packState } from '../../shared/blocks';
import { chunkCoords } from '../voxels/chunk';
import { meshChunk, type ChunkMeshData, type GroundHeight } from '../voxels/mesher';
import { RemeshQueue } from '../voxels/remesh-queue';
import type { VoxelWorld } from '../voxels/world';
import { createStructureMaterial } from './structure-material';

/** Milliseconds a frame may spend meshing chunks. One chunk is always meshed, however slow. */
export const REMESH_BUDGET_MS = 3;

/** What the renderer is holding, for the debug overlay and the tests. */
export interface VoxelRenderStats {
  /** Chunks with a mesh, one draw call each. */
  chunks: number;
  triangles: number;
  vertices: number;
  /** Chunks waiting to be meshed. */
  pending: number;
  /** How long the latest chunk took to mesh, in milliseconds. */
  lastMeshMs: number;
  /** Chunks meshed since the renderer was made. */
  meshed: number;
}

interface ChunkDraw {
  readonly mesh: Mesh;
  readonly triangles: number;
  readonly vertices: number;
}

/**
 * Draws the blocks of a `VoxelWorld`: one mesh per chunk that holds a block, all sharing one
 * material. It watches the world for changes, and each frame re-meshes what changed, nearest the
 * camera first, within a small time budget. Meshing is the pure `meshChunk`; this class only turns
 * its arrays into geometry and keeps the meshes in the scene.
 *
 * The block tiles are baked, and the material made, when the first chunk is meshed or `warmUp` is
 * called, so a world with no blocks costs no video memory and no start-up time.
 */
export class VoxelRenderer {
  readonly stats: VoxelRenderStats = {
    chunks: 0,
    triangles: 0,
    vertices: 0,
    pending: 0,
    lastMeshMs: 0,
    meshed: 0,
  };
  private readonly draws = new Map<number, ChunkDraw>();
  private readonly queue = new RemeshQueue();
  private readonly group: Group;
  private readonly eye = new Vector3();
  private material: ShaderMaterial | null = null;
  private warming: Promise<void> | null = null;
  private primer: Mesh | null = null;
  private readonly ground: GroundHeight = (x, z) => this.world.terrain.grid.groundAt(x, z);

  constructor(
    private readonly stage: Stage,
    private readonly world: VoxelWorld,
    private readonly budgetMs = REMESH_BUDGET_MS,
  ) {
    this.group = stage.world;
  }

  /** True once the tiles are baked and the material exists. */
  get ready(): boolean {
    return this.material !== null;
  }

  /**
   * Bakes the block tiles, builds the material and starts compiling its program now, so the first
   * block does not wait for any of it. Resolves when the program is ready; calling it again returns
   * the same promise.
   */
  warmUp(): Promise<void> {
    this.warming ??= this.compile();
    return this.warming;
  }

  private compile(): Promise<void> {
    // One block stands in for a chunk. Which program the driver builds depends on the material, the
    // scene and the attributes the geometry has (a mesh without normals is another program), so the
    // stand-in is made the way a chunk is, and flagged the way one is.
    const cube = packState(SHAPE.cube, MATERIAL.scrap);
    const data = meshChunk(
      { getBlock: (x, y, z) => (x === 0 && y === 0 && z === 0 ? cube : 0) },
      0,
      0,
      0,
    );
    this.primer = new Mesh(this.toGeometry(data), this.blockMaterial());
    this.primer.castShadow = true;
    this.primer.receiveShadow = true;
    return this.stage.precompile(this.primer);
  }

  private blockMaterial(): ShaderMaterial {
    this.material ??= createStructureMaterial(
      this.stage.registry,
      this.stage.structure,
      MATERIALS.length,
      TILE_LAYOUTS,
    );
    return this.material;
  }

  /** Takes the world's changes and meshes what the time budget allows, nearest the camera first. */
  update(camera: Camera): void {
    this.collect();
    if (this.queue.size === 0) return;
    camera.getWorldPosition(this.eye);
    const start = performance.now();
    for (const key of this.queue.nearestFirst(this.eye.x, this.eye.y, this.eye.z)) {
      this.meshKey(key);
      this.queue.delete(key);
      if (performance.now() - start >= this.budgetMs) break;
    }
    this.stats.pending = this.queue.size;
  }

  /** Meshes everything that is waiting right now, ignoring the budget. A loaded world appears at once. */
  meshAll(): void {
    this.collect();
    for (const key of this.queue.nearestFirst(0, 0, 0)) this.meshKey(key);
    this.queue.clear();
    this.stats.pending = 0;
  }

  private collect(): void {
    if (this.world.dirtyCount > 0) {
      for (const key of this.world.drainDirty()) this.queue.add(key);
    }
    this.stats.pending = this.queue.size;
  }

  private meshKey(key: number): void {
    const { cx, cy, cz } = chunkCoords(key, { cx: 0, cy: 0, cz: 0 });
    const old = this.draws.get(key);
    if (this.world.getChunk(cx, cy, cz) === undefined) {
      if (old) this.remove(key, old);
      return;
    }
    const t0 = performance.now();
    const data = meshChunk(this.world, cx, cy, cz, this.ground);
    this.stats.lastMeshMs = performance.now() - t0;
    this.stats.meshed++;
    if (data.triangleCount === 0) {
      if (old) this.remove(key, old);
      return;
    }
    if (old) {
      old.mesh.geometry.dispose();
      old.mesh.geometry = this.toGeometry(data);
      this.stats.triangles += data.triangleCount - old.triangles;
      this.stats.vertices += data.vertexCount - old.vertices;
      this.draws.set(key, {
        mesh: old.mesh,
        triangles: data.triangleCount,
        vertices: data.vertexCount,
      });
      return;
    }
    const mesh = new Mesh(this.toGeometry(data), this.blockMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this.draws.set(key, { mesh, triangles: data.triangleCount, vertices: data.vertexCount });
    this.stats.chunks++;
    this.stats.triangles += data.triangleCount;
    this.stats.vertices += data.vertexCount;
  }

  private remove(key: number, draw: ChunkDraw): void {
    this.group.remove(draw.mesh);
    draw.mesh.geometry.dispose();
    this.draws.delete(key);
    this.stats.chunks--;
    this.stats.triangles -= draw.triangles;
    this.stats.vertices -= draw.vertices;
  }

  private toGeometry(data: ChunkMeshData): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
    geometry.setAttribute('uv', new BufferAttribute(data.uvs, 2));
    // Four bytes read as 0 to 255 in the shader, not normalized.
    geometry.setAttribute('aAux', new BufferAttribute(data.aux, 4));
    geometry.setIndex(new BufferAttribute(data.indices, 1));
    const [x0, y0, z0, x1, y1, z1] = data.bounds;
    const center = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    geometry.boundingSphere = new Sphere(
      center,
      Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2) / 2 + 0.1,
    );
    return geometry;
  }

  dispose(): void {
    for (const [key, draw] of [...this.draws]) this.remove(key, draw);
    this.queue.clear();
    this.primer?.geometry.dispose();
    this.material?.dispose();
  }
}
