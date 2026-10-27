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
  type ModulePalette,
} from './module-models';

/**
 * The functional modules as the player sees them: each module standing in the world is a small group
 * of meshes on its cell's floor, turned to the way it faces. The modules are cells of the block world
 * (the mesher leaves them out), so this follows the world's list of them: it draws the ones that stand
 * when it is made, and then each one that is placed, turned or broken.
 *
 * Every module of a kind and level shares one model, and every module of a grade one set of materials,
 * so a base full of them costs a handful of draw calls each and no more geometry. A module's level is
 * its cell's material byte: raising one is a change of the cell's state, which draws it again with
 * the model and the paint of its new level (the Auto Turret is grey-green and cyan, the Heavy Turret
 * brushed steel and amber). The lit material cannot be instanced (it reads the model matrix), so a
 * group of meshes stands for each one; the turret of 5f is where a crowd of them would first be, and
 * where instancing would be looked at.
 *
 * A turret has a head that turns, a group of its own inside the module's, which `aim` points at the end
 * of a shot and which stays pointing there until the next one.
 *
 * The screens breathe, the light strips beat slowly and the beacon blinks, all from the stage's
 * animation clock, so a frozen page shows the same module twice. A module without power (5g2) keeps its
 * shape and its plates but burns its lights low and still: `setPowered` swaps its glowing looks for dim
 * copies, made the first time one is needed. Which modules have power is not known here (this layer
 * imports nothing from the simulation); the app works it out and says.
 */

/** How the lights move: a shimmer on the screens, a slow beat on the strips and a blink on the beacon. */
const BLINK_PERIOD = 2.2;
const BLINK_ON = 0.28;
const BLINK_OFF_GLOW = 0.15;

/** The name of the group a turning head hangs in, inside the group of the module it belongs to. */
const HEAD = 'head';

/**
 * How much of its glow a look keeps in a module without power: the lights are on standby, not out, so the
 * module still reads as one. Chosen by eye, side by side with a module that has power, by day and by night:
 * at 0.16 the cyan strips and the amber lamps of a standing module were still bright enough to read as lit
 * from a few blocks off; at 0.08 they are a dull teal and a brown, and 0.04 and below lose the strips.
 */
export const DIM_GLOW = 0.08;

/** The materials of one paint, a lit material for each look, and the glow each is animated through. */
interface Paint {
  readonly palette: ModulePalette;
  readonly materials: Map<ModuleLook, ShaderMaterial>;
  readonly glows: Map<ModuleLook, { readonly now: Color; readonly base: Color }>;
  /** The looks that glow, with their glow turned down and held still, made the first time a module without power is drawn in this paint. */
  dim: Map<ModuleLook, ShaderMaterial> | null;
}

/** How a module's group is dressed now: the paint it was drawn in and whether its lights are up. */
interface Dress {
  readonly paint: Paint;
  powered: boolean;
}

export class ModuleRenderer {
  readonly object = new Group();
  /** The models of the kinds and levels of module that have been drawn, each shared by every module of its kind and level. */
  private readonly kits = new Map<number, ModuleKit>();
  private readonly placed = new Map<number, Group>();
  /** The materials of each paint that has been drawn in. */
  private readonly paints = new Map<ModulePalette, Paint>();
  /** What each drawn module is dressed in, so that `setPowered` can swap its lights. */
  private readonly dress = new WeakMap<Group, Dress>();
  /** The animation clock the lights were last moved to, so that a paint made later starts where the others are. */
  private time = 0;
  private readonly stop: () => void;

  constructor(
    parent: Group,
    private readonly registry: MaterialRegistry,
    voxels: VoxelWorld,
  ) {
    this.object.name = 'modules';
    this.paint(MODULE_LOOKS);
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

  /**
   * Turns the lights of the module in a cell down or back up: a module without power keeps its shape and
   * its plates, and the cyan and amber it glows with burn low and still. A module drawn again (raised, say)
   * starts with its lights up, so whoever knows which have power says again. True when the module's lights
   * changed; false when none is drawn there or they were as asked already.
   */
  setPowered(x: number, y: number, z: number, powered: boolean): boolean {
    const group = this.placed.get(cellKey(x, y, z));
    const dress = group ? this.dress.get(group) : undefined;
    if (!group || !dress || dress.powered === powered) return false;
    dress.powered = powered;
    const lit = powered ? dress.paint.materials : this.dimmed(dress.paint);
    group.traverse((object) => {
      const look = object.userData.look as ModuleLook | undefined;
      if (!(object instanceof Mesh) || look === undefined) return;
      object.material = lit.get(look) ?? dress.paint.materials.get(look) ?? object.material;
    });
    return true;
  }

  /** Whether the lights of the module in a cell are up, or null when none is drawn there. */
  isPowered(x: number, y: number, z: number): boolean | null {
    const group = this.placed.get(cellKey(x, y, z));
    return (group ? this.dress.get(group)?.powered : undefined) ?? null;
  }

  /** Moves the lights for the stage's animation clock, in seconds. */
  update(time: number): void {
    this.time = time;
    for (const paint of this.paints.values()) this.light(paint);
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
    for (const paint of this.paints.values()) {
      paint.materials.forEach((material) => this.registry.release(material));
      paint.dim?.forEach((material) => this.registry.release(material));
    }
    this.paints.clear();
  }

  /** Moves the lights of one paint for the clock. */
  private light(paint: Paint): void {
    const time = this.time;
    const shimmer = 1 + 0.08 * Math.sin(time * 2.3) + 0.04 * Math.sin(time * 7.1 + 1.3);
    const beat = 0.92 + 0.08 * Math.sin(time * 1.3 + 1);
    const blink = time % BLINK_PERIOD < BLINK_ON ? 1 : BLINK_OFF_GLOW;
    this.glow(paint, 'screen', shimmer);
    this.glow(paint, 'lights', beat);
    this.glow(paint, 'amber', 0.9 + 0.1 * beat);
    this.glow(paint, 'beacon', blink);
  }

  private glow(paint: Paint, look: ModuleLook, scale: number): void {
    const glow = paint.glows.get(look);
    if (glow) glow.now.copy(glow.base).multiplyScalar(scale);
  }

  /** The materials of a paint, made the first time a module is drawn in it. */
  private paint(palette: ModulePalette): Paint {
    let paint = this.paints.get(palette);
    if (!paint) {
      paint = { palette, materials: new Map(), glows: new Map(), dim: null };
      for (const look of MODULE_LOOK_NAMES) {
        const material = createLitMaterial(this.registry, palette[look]);
        paint.materials.set(look, material);
        const now = material.uniforms.uGlow?.value as Color;
        paint.glows.set(look, { now, base: now.clone() });
      }
      this.paints.set(palette, paint);
      this.light(paint);
    }
    return paint;
  }

  /** The glowing looks of a paint with their lights turned down, made the first time a module without power needs them. */
  private dimmed(paint: Paint): Map<ModuleLook, ShaderMaterial> {
    if (!paint.dim) {
      paint.dim = new Map();
      for (const look of MODULE_LOOK_NAMES) {
        const spec = paint.palette[look];
        if (spec.glow === undefined) continue;
        const glowIntensity = (spec.glowIntensity ?? 1) * DIM_GLOW;
        paint.dim.set(look, createLitMaterial(this.registry, { ...spec, glowIntensity }));
      }
    }
    return paint.dim;
  }

  /** Draws the cell as it is now: the module in it, turned the way it faces, or nothing. */
  private show(x: number, y: number, z: number, state: number): void {
    const key = cellKey(x, y, z);
    const shape = stateShape(state);
    const module = moduleOfShape(shape);
    const level = stateMaterial(state);
    const kit = module ? this.kit(module, level) : undefined;
    const old = this.placed.get(key);
    if (old) {
      old.removeFromParent();
      this.placed.delete(key);
    }
    if (!module || !kit) return;
    const group = new Group();
    group.name = 'module';
    group.userData = { module: module.id, level };
    group.position.set(x + 0.5, y, z + 0.5);
    group.rotation.y = (-moduleFacing(shape) * Math.PI) / 2;
    const paint = this.paint(kit.palette);
    this.dress.set(group, { paint, powered: true });
    this.mesh(group, kit.model, paint);
    if (kit.head) {
      // Yaw first, then the lift about the head's own side, then no roll: the order the turn is built in.
      const head = new Group();
      head.name = HEAD;
      head.position.y = kit.head.pivot;
      head.rotation.order = 'YZX';
      this.mesh(head, kit.head.model, paint);
      group.add(head);
    }
    this.object.add(group);
    this.placed.set(key, group);
  }

  /** Hangs a mesh for each look of a model in a group, in the materials of a paint. */
  private mesh(parent: Group, model: ModuleModel, paint: Paint): void {
    for (const look of MODULE_LOOK_NAMES) {
      const geometry: BufferGeometry | undefined = model[look];
      const material = paint.materials.get(look);
      if (!geometry || !material) continue;
      const mesh = new Mesh(geometry, material);
      mesh.userData.look = look;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }

  /** The model of a module at a level, built the first time one is drawn. */
  private kit(module: ModuleDef, level: number): ModuleKit | undefined {
    const key = module.id * 256 + level;
    let kit = this.kits.get(key);
    if (!kit) {
      kit = buildModuleKit(module.id, level);
      if (!kit) return undefined;
      this.kits.set(key, kit);
    }
    return kit;
  }
}
