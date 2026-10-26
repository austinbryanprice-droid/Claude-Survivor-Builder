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
  buildModuleKit,
  type ModuleKit,
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
 * A turret has a head that turns, a group of its own inside the module's, which `aim` points at the end
 * of a shot and which stays pointing there until the next one.
 *
 * The screens breathe, the light strips beat slowly and the beacon blinks, all from the stage's
 * animation clock, so a frozen page shows the same module twice.
 */

/** How the lights move: a shimmer on the screens, a slow beat on the strips and a blink on the beacon. */
const BLINK_PERIOD = 2.2;
const BLINK_ON = 0.28;
const BLINK_OFF_GLOW = 0.15;

/** The name of the group a turning head hangs in, inside the group of the module it belongs to. */
const HEAD = 'head';

export class ModuleRenderer {
  readonly object = new Group();
  /** The models of the kinds of module that have been drawn, each shared by every module of its kind. */
  private readonly kits = new Map<number, ModuleKit>();
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

  /**
   * Turns the head of the module in a cell to look at a point, the way a turret points at where its shot
   * ended: about the vertical for the heading and about the head's own side for the lift. It stays there
   * until it is aimed again or the cell is drawn again. False when the cell has no head to turn.
   */
  aim(x: number, y: number, z: number, tx: number, ty: number, tz: number): boolean {
    const group = this.placed.get(cellKey(x, y, z));
    const head = group?.getObjectByName(HEAD);
    if (!group || !head) return false;
    const dx = tx - (x + 0.5);
    const dy = ty - (y + head.position.y);
    const dz = tz - (z + 0.5);
    const flat = Math.hypot(dx, dz);
    if (flat < 1e-9 && Math.abs(dy) < 1e-9) return false;
    // The group already turns the model to the way the module faces, and the head's front is +x: the
    // heading that points it at the target is the world's, less the group's.
    const yaw = flat < 1e-9 ? head.rotation.y : Math.atan2(-dz, dx) - group.rotation.y;
    head.rotation.set(0, yaw, Math.atan2(dy, flat), 'YZX');
    return true;
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
      for (const model of [kit.model, kit.head?.model]) {
        for (const geometry of Object.values(model ?? {})) geometry.dispose();
      }
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
    this.mesh(group, kit.model);
    if (kit.head) {
      // Yaw first, then the lift about the head's own side, then no roll: the order the turn is built in.
      const head = new Group();
      head.name = HEAD;
      head.position.y = kit.head.pivot;
      head.rotation.order = 'YZX';
      this.mesh(head, kit.head.model);
      group.add(head);
    }
    this.object.add(group);
    this.placed.set(key, group);
  }

  /** Hangs a mesh for each look of a model in a group. */
  private mesh(parent: Group, model: ModuleModel): void {
    for (const look of MODULE_LOOK_NAMES) {
      const geometry: BufferGeometry | undefined = model[look];
      const material = this.materials.get(look);
      if (!geometry || !material) continue;
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }

  /** The model of a module, built the first time one is drawn. */
  private kit(module: ModuleDef): ModuleKit | undefined {
    let kit = this.kits.get(module.id);
    if (!kit) {
      kit = buildModuleKit(module.id);
      if (!kit) return undefined;
      this.kits.set(module.id, kit);
    }
    return kit;
  }
}
