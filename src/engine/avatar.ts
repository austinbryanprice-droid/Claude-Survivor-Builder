import { Group, Mesh, type BufferGeometry, type ShaderMaterial } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createLitMaterial } from './lit-material';
import type { MaterialRegistry } from './materials';

/**
 * The crew member seen in third person: a small articulated suit built from rounded boxes, with a
 * walk cycle driven by speed. A placeholder until the generated glTF pipeline arrives in Phase 5;
 * it only has to read well and cast a shadow.
 */

export interface AvatarPose {
  x: number;
  y: number;
  z: number;
  /** Direction the body faces, in the same yaw convention as the view. */
  bodyYaw: number;
  /** Horizontal speed in blocks per second. */
  speed: number;
  onGround: boolean;
  /** View pitch; the head follows it a little. */
  pitch: number;
}

export interface Avatar {
  readonly object: Group;
  update(dt: number, pose: AvatarPose): void;
  dispose(): void;
}

export interface AvatarOptions {
  /** The suit's accent (shoulder pad and chest light), as a CSS color. Amber when left out. */
  accent?: string;
}

const WALK_SPEED_FOR_FULL_SWING = 4.4;
/** Radians of gait phase per block walked. */
const STRIDE = 3.4;

export function createAvatar(
  registry: MaterialRegistry,
  { accent = '#f2a43a' }: AvatarOptions = {},
): Avatar {
  const geometries: BufferGeometry[] = [];
  const materials: ShaderMaterial[] = [];

  const material = (
    color: string,
    roughness: number,
    metalness: number,
    glow?: string,
    glowIntensity = 0.9,
  ): ShaderMaterial => {
    const m = createLitMaterial(registry, {
      color,
      gloss: 1 - roughness,
      metalness,
      ...(glow ? { glow, glowIntensity } : {}),
    });
    materials.push(m);
    return m;
  };
  const suit = material('#8896a6', 0.58, 0.3);
  const panel = material('#566270', 0.66, 0.35);
  const dark = material('#262d35', 0.85, 0.15);
  const helmet = material('#b4bfcb', 0.45, 0.35);
  const visor = material('#0d1c22', 0.18, 0.7, '#2bb8c8');
  const accentTrim = material(accent, 0.5, 0.2, accent, 0.35);

  const box = (w: number, h: number, d: number, mat: ShaderMaterial, x = 0, y = 0, z = 0): Mesh => {
    const radius = Math.min(w, h, d) * 0.32;
    const geometry = new RoundedBoxGeometry(w, h, d, 3, radius);
    geometries.push(geometry);
    const mesh = new Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  const root = new Group();
  const rig = new Group();
  root.add(rig);

  // Torso, chest light and backpack. The body faces -Z.
  rig.add(box(0.46, 0.58, 0.28, suit, 0, 1.17, 0));
  rig.add(box(0.3, 0.2, 0.04, panel, 0, 1.24, -0.15));
  rig.add(box(0.1, 0.04, 0.03, accentTrim, 0.08, 1.3, -0.175));
  rig.add(box(0.34, 0.46, 0.16, panel, 0, 1.2, 0.22));
  rig.add(box(0.06, 0.3, 0.03, visor, 0, 1.2, 0.305));

  // Head.
  const head = new Group();
  head.position.set(0, 1.46, 0);
  head.add(box(0.3, 0.3, 0.32, helmet, 0, 0.17, 0));
  head.add(box(0.24, 0.12, 0.05, visor, 0, 0.19, -0.165));
  rig.add(head);

  const limb = (x: number, y: number, parts: Mesh[]): Group => {
    const pivot = new Group();
    pivot.position.set(x, y, 0);
    parts.forEach((part) => pivot.add(part));
    rig.add(pivot);
    return pivot;
  };

  const armL = limb(-0.31, 1.42, [
    box(0.17, 0.12, 0.17, accentTrim, 0, 0.0, 0),
    box(0.13, 0.5, 0.13, suit, 0, -0.27, 0),
    box(0.12, 0.12, 0.12, dark, 0, -0.56, 0),
  ]);
  const armR = limb(0.31, 1.42, [
    box(0.17, 0.12, 0.17, suit, 0, 0.0, 0),
    box(0.13, 0.5, 0.13, suit, 0, -0.27, 0),
    box(0.12, 0.12, 0.12, dark, 0, -0.56, 0),
  ]);
  const legL = limb(-0.12, 0.88, [
    box(0.18, 0.66, 0.2, panel, 0, -0.33, 0),
    box(0.2, 0.15, 0.3, dark, 0, -0.8, -0.04),
  ]);
  const legR = limb(0.12, 0.88, [
    box(0.18, 0.66, 0.2, panel, 0, -0.33, 0),
    box(0.2, 0.15, 0.3, dark, 0, -0.8, -0.04),
  ]);

  let phase = 0;
  let airBlend = 0;
  let clock = 0;

  return {
    object: root,
    update(dt, pose) {
      clock += dt;
      root.position.set(pose.x, pose.y, pose.z);
      root.rotation.y = pose.bodyYaw;

      const moving = Math.min(1, pose.speed / WALK_SPEED_FOR_FULL_SWING);
      phase += pose.speed * dt * STRIDE;
      airBlend += ((pose.onGround ? 0 : 1) - airBlend) * (1 - Math.exp(-12 * dt));

      const swing = Math.sin(phase) * Math.min(1.2, pose.speed / WALK_SPEED_FOR_FULL_SWING);
      const ground = 1 - airBlend;
      legL.rotation.x = swing * 0.8 * ground + 0.5 * airBlend;
      legR.rotation.x = -swing * 0.8 * ground - 0.35 * airBlend;
      armL.rotation.x = -swing * 0.7 * ground - 0.55 * airBlend;
      armR.rotation.x = swing * 0.7 * ground - 0.55 * airBlend;
      armL.rotation.z = -0.1 - 0.3 * airBlend;
      armR.rotation.z = 0.1 + 0.3 * airBlend;

      rig.rotation.x = -0.1 * moving;
      rig.position.y =
        Math.abs(Math.sin(phase)) * 0.04 * moving * ground +
        Math.sin(clock * 2.2) * 0.004 * (1 - moving);
      head.rotation.x = pose.pitch * 0.6 + 0.1 * moving;
    },
    dispose() {
      geometries.forEach((g) => g.dispose());
      // The registry made these materials; handing them back lets it forget them, so players
      // who come and go do not pile up in it.
      materials.forEach((m) => registry.release(m));
    },
  };
}
