import { Group, Mesh, type BufferGeometry, type Color, type ShaderMaterial } from 'three';
import { createLitMaterial } from '../../engine/lit-material';
import type { MaterialRegistry } from '../../engine/materials';
import {
  moduleFacing,
  moduleOfShape,
  stateMaterial,
  stateShape,
  type ModuleDef,
} from '../../shared/blocks';
import { cellKey } from '../../shared/solid';
import type { VoxelWorld } from '../voxels/world';
import {
  MODULE_LOOKS,
  MODULE_LOOK_NAMES,
  buildModuleModel,
  type ModuleLook,
  type ModuleModel,
} from './module-models';

/**
 * The functional modules as the player sees them: each module standing in the world is a small group
 * of meshes on its cell's floor, turned to the way it faces. The modules are cells of the block world
 * (the mesher leaves them out), so this follows the world's list of them: it draws the ones that stand
 * when it is made, and then each one that is placed, turned or broken.
 *
 * Every module of a kind shares one model and one set of materials, so a base full of them costs a
 * handful of draw calls each and no more geometry. The lit material cannot be instanced (it reads the
 * model matrix), so a group of meshes stands for each one; the turret of 5f is where a crowd of
 * them would first be, and where instancing would be looked at.
 *
 * The screens breathe, the light strips beat slowly and the beacon blinks, all from the stage's
 * animation clock, so a frozen page shows the same module twice.
 */

/** How the lights move: a shimmer on the screens, a slow beat on the strips and a blink on the beacon. */
const BLINK_PERIOD = 2.2;
const BLINK_ON = 0.28;
const BLINK_OFF_GLOW = 0.15;

/** A kind of module as the renderer holds it: its model, shared by every module of the kind. */
interface Kit {
  readonly model: ModuleModel;
}

export class ModuleRenderer {
  readonly object = new Group();
  private readonly kits = new Map<number, Kit>();
  private readonly placed = new Map<number, Group>();
  private readonly materials = new Map<ModuleLook, ShaderMaterial>();
  private readonly glows = new Map<ModuleLook, { readonly now: Color; readonly base: Color }>();
  private readonly stop: () => void;

  constructor(
    parent: Group,
    private readonly registry: MaterialRegistry,
    voxels: VoxelWorld,
  ) {
    this.object.name = 'modules';
    for (const look of MODULE_LOOK_NAMES) {
      const spec = MODULE_LOOKS[look];
      const material = createLitMaterial(registry, spec);
      this.materials.set(look, material);
      const now = material.uniforms.uGlow?.value as Color;
      this.glows.set(look, { now, base: now.clone() });
    }
    parent.add(this.object);
    voxels.forEachModule(({ x, y, z, state }) => this.show(x, y, z, state));
    this.stop = voxels.onModuleChange((x, y, z, _previous, state) => this.show(x, y, z, state));
    this.update(0);
  }

  /** How many modules are drawn. */
  get count(): number {
    return this.placed.size;
  }

  /** The group that draws the module standing in a cell, or undefined when none is drawn there. */
  at(x: number, y: number, z: number): Group | undefined {
    return this.placed.get(cellKey(x, y, z));
  }

  /** Moves the lights for the stage's animation clock, in seconds. */
  update(time: number): void {
    const shimmer = 1 + 0.08 * Math.sin(time * 2.3) + 0.04 * Math.sin(time * 7.1 + 1.3);
    const beat = 0.92 + 0.08 * Math.sin(time * 1.3 + 1);
    const blink = time % BLINK_PERIOD < BLINK_ON ? 1 : BLINK_OFF_GLOW;
    this.glow('screen', shimmer);
    this.glow('lights', beat);
    this.glow('amber', 0.9 + 0.1 * beat);
    this.glow('beacon', blink);
  }

  dispose(): void {
    this.stop();
    this.object.removeFromParent();
    for (const group of this.placed.values()) group.removeFromParent();
    this.placed.clear();
    for (const kit of this.kits.values()) {
      for (const geometry of Object.values(kit.model)) geometry?.dispose();
    }
    this.kits.clear();
    this.materials.forEach((material) => this.registry.release(material));
    this.materials.clear();
  }

  private glow(look: ModuleLook, scale: number): void {
    const glow = this.glows.get(look);
    if (glow) glow.now.copy(glow.base).multiplyScalar(scale);
  }

  /** Draws the cell as it is now: the module in it, turned the way it faces, or nothing. */
  private show(x: number, y: number, z: number, state: number): void {
    const key = cellKey(x, y, z);
    const shape = stateShape(state);
    const module = moduleOfShape(shape);
    const kit = module ? this.kit(module) : undefined;
    const old = this.placed.get(key);
    if (old) {
      old.removeFromParent();
      this.placed.delete(key);
    }
    if (!module || !kit) return;
    const group = new Group();
    group.name = 'module';
    group.userData = { module: module.id, level: stateMaterial(state) };
    group.position.set(x + 0.5, y, z + 0.5);
    group.rotation.y = (-moduleFacing(shape) * Math.PI) / 2;
    for (const look of MODULE_LOOK_NAMES) {
      const geometry: BufferGeometry | undefined = kit.model[look];
      const material = this.materials.get(look);
      if (!geometry || !material) continue;
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.object.add(group);
    this.placed.set(key, group);
  }

  /** The model of a module, built the first time one is drawn. */
  private kit(module: ModuleDef): Kit | undefined {
    let kit = this.kits.get(module.id);
    if (!kit) {
      const model = buildModuleModel(module.id);
      if (!model) return undefined;
      kit = { model };
      this.kits.set(module.id, kit);
    }
    return kit;
  }
}
