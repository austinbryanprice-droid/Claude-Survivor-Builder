import {
  Color,
  Group,
  LatheGeometry,
  Mesh,
  TorusGeometry,
  Vector2,
  type BufferGeometry,
  type ShaderMaterial,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createLitMaterial } from '../../engine/lit-material';
import type { MaterialRegistry } from '../../engine/materials';
import type { Outpost } from '../outpost';
import { CORE_FOOTPRINT, CORE_SKIRT } from '../outpost';

/**
 * The Outpost Core as the player sees it: the station's reactor standing in its crater. A dark
 * plinth with amber trim carries a cage of four pylons, and a cyan crystal turns and bobs inside
 * it with a thin ring about it. The crystal is the health gauge in the world: it shifts from cyan
 * to amber to red as the Core is worn down, beats faster, flickers when it is close to falling,
 * flashes white when it is hit, and goes dark and still when it has fallen.
 *
 * Everything is built from generated geometry and the shared lit material, in local coordinates
 * with the foot of the Core at y = 0, and merged by material so the whole thing is a handful of
 * draw calls. The shape fills the box the world holds solid (3 by 3 cells, 4 high). Its
 * foundation reaches `CORE_SKIRT` below that, into the ground, so the Core meets a sloping floor
 * on every side.
 */

/** What the renderer needs to know about the Core each frame. */
export interface CoreLook {
  /** How much of its health is left, from 0 to 1. */
  readonly health: number;
  /** The Core has fallen: the crystal is dark and still. */
  readonly fallen: boolean;
}

/** The cyan of the accents in the art direction, then the amber and the red it passes through. */
const CYAN = new Color('#3ad1e0');
const AMBER = new Color('#ffa726');
const RED = new Color('#ff3b2f');
const DEAD = new Color('#59606b');
const FLASH = new Color('#fff4ec');

/**
 * Health at which the crystal stops being cyan, becomes amber and stops being amber, and becomes
 * red. The gauge on the HUD turns amber below half and red below a quarter; the crystal changes
 * over the few points around those marks, so the two agree and neither lingers in between.
 */
const CYAN_UNTIL = 0.56;
const AMBER_AT = 0.46;
const AMBER_UNTIL = 0.31;
const RED_AT = 0.21;
/** Below this the crystal flickers. */
const FLICKER_BELOW = 0.4;

/** Local heights of the parts, in blocks above the foot of the Core. */
const BASE_HEIGHT = 0.5;
const BODY_HEIGHT = 1.5;
const DECK_TOP = 1.8;
export const CRYSTAL_Y = 2.9;
const CRYSTAL_HALF_HEIGHT = 1;
const PYLON_OFFSET = 1.2;
const FRAME_Y = 3.72;

/** A frame longer than this (a hidden tab, a breakpoint) is not time passing for the Core. */
const MAX_STEP = 0.25;
/** How fast the shown health follows the real one, per second. */
const HEALTH_FOLLOW = 6;
/** A hit lights the crystal this much, and the light dies away at this rate. */
const FLASH_PER_HIT = 0.7;
const FLASH_DECAY = 5;

export class CoreRenderer {
  readonly object = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: ShaderMaterial[] = [];
  private readonly crystal: Mesh;
  private readonly ring: Mesh;
  private readonly crystalGlow: Color;
  private readonly crystalColor: Color;
  private readonly lightGlow: Color;
  private readonly tone = new Color();
  private source: (() => CoreLook | null) | null = null;
  /** Seconds of the Core's own animation: the sum of the time the stage has let pass. */
  private clock = 0;
  private lastTime = Number.NaN;
  private shown = 1;
  private flash = 0;
  private fallenBlend = 0;
  private lastTarget = 1;

  constructor(
    parent: Group,
    private readonly registry: MaterialRegistry,
    outpost: Outpost,
  ) {
    this.object.name = 'outpost-core';
    this.object.position.set(outpost.x, outpost.baseY, outpost.z);

    const plate = this.material('#31405a', 0.55, 0.65);
    const trimPlate = this.material('#4d6079', 0.6, 0.55);
    const amber = this.material('#b9741f', 0.35, 0.3, '#f2a43a', 0.9);
    const lights = this.material('#0e2f36', 0.5, 0.1, '#3ad1e0', 1.4);
    const crystalMaterial = this.material('#0e2f36', 0.9, 0.1, '#3ad1e0', 1.8, 0.85);
    this.lightGlow = lights.uniforms.uGlow?.value as Color;
    this.crystalGlow = crystalMaterial.uniforms.uGlow?.value as Color;
    this.crystalColor = crystalMaterial.uniforms.uColor?.value as Color;

    // The foundation, the body of the plinth, the deck the pylons stand on, and the pylons with
    // the frame that joins their tops.
    const reach = PYLON_OFFSET * 2 + 0.4;
    this.addMerged(plate, [
      box(
        CORE_FOOTPRINT,
        BASE_HEIGHT + CORE_SKIRT,
        CORE_FOOTPRINT,
        0,
        (BASE_HEIGHT - CORE_SKIRT) / 2,
        0,
      ),
      box(2.7, BODY_HEIGHT - BASE_HEIGHT, 2.7, 0, (BASE_HEIGHT + BODY_HEIGHT) / 2, 0),
      box(2.9, DECK_TOP - BODY_HEIGHT, 2.9, 0, (BODY_HEIGHT + DECK_TOP) / 2, 0),
      ...pylons((x, z) => box(0.4, 2, 0.4, x, 2.8, z)),
      box(reach, 0.2, 0.26, 0, FRAME_Y, PYLON_OFFSET),
      box(reach, 0.2, 0.26, 0, FRAME_Y, -PYLON_OFFSET),
      box(0.26, 0.2, reach, PYLON_OFFSET, FRAME_Y, 0),
      box(0.26, 0.2, reach, -PYLON_OFFSET, FRAME_Y, 0),
    ]);
    // Lighter plates: a belt round the top of the foundation and a rim under the deck.
    this.addMerged(trimPlate, [
      box(CORE_FOOTPRINT + 0.04, 0.1, CORE_FOOTPRINT + 0.04, 0, BASE_HEIGHT, 0, 0.4),
      box(2.94, 0.1, 2.94, 0, BODY_HEIGHT, 0, 0.4),
    ]);
    // Amber trim along the four faces of the body, and a band round each pylon.
    this.addMerged(amber, [
      box(2.0, 0.12, 0.06, 0, 1.3, 1.37),
      box(2.0, 0.12, 0.06, 0, 1.3, -1.37),
      box(0.06, 0.12, 2.0, 1.37, 1.3, 0),
      box(0.06, 0.12, 2.0, -1.37, 1.3, 0),
      ...pylons((x, z) => box(0.46, 0.09, 0.46, x, 2.3, z)),
    ]);
    // The lights: three vents of light in each face of the body, a plate of light under the
    // crystal and a cap on each pylon. They take the crystal's color, so the whole plinth shows
    // the Core's health.
    const vents: BufferGeometry[] = [];
    for (const along of [-0.6, 0, 0.6]) {
      vents.push(
        box(0.14, 0.5, 0.06, along, 0.88, 1.37, 0.4),
        box(0.14, 0.5, 0.06, along, 0.88, -1.37, 0.4),
        box(0.06, 0.5, 0.14, 1.37, 0.88, along, 0.4),
        box(0.06, 0.5, 0.14, -1.37, 0.88, along, 0.4),
      );
    }
    this.addMerged(lights, [
      ...vents,
      box(1.5, 0.05, 1.5, 0, DECK_TOP + 0.02, 0, 0.45),
      ...pylons((x, z) => box(0.3, 0.12, 0.3, x, 3.88, z)),
    ]);

    // The crystal: a six-sided bipyramid with flat facets.
    const profile = [
      new Vector2(0.0001, -CRYSTAL_HALF_HEIGHT),
      new Vector2(0.6, -0.36),
      new Vector2(0.6, 0.36),
      new Vector2(0.0001, CRYSTAL_HALF_HEIGHT),
    ];
    const lathe = new LatheGeometry(profile, 6);
    const facets = lathe.toNonIndexed();
    lathe.dispose();
    facets.computeVertexNormals();
    this.geometries.push(facets);
    this.crystal = new Mesh(facets, crystalMaterial);
    this.crystal.position.y = CRYSTAL_Y;
    this.crystal.castShadow = true;
    this.object.add(this.crystal);

    // The ring about it, turning on its own tilt.
    const ringGeometry = new TorusGeometry(0.88, 0.03, 8, 48);
    this.geometries.push(ringGeometry);
    this.ring = new Mesh(ringGeometry, lights);
    this.ring.position.y = CRYSTAL_Y;
    this.ring.rotation.x = Math.PI / 2 + 0.3;
    this.object.add(this.ring);

    parent.add(this.object);
    this.apply(0);
  }

  /** Where the Core's health comes from each frame; null (or a source that answers null) shows it whole. */
  follow(source: (() => CoreLook | null) | null): void {
    this.source = source;
  }

  /**
   * Poses the Core for the stage's animation clock, in seconds. The clock stands still when the
   * page is frozen for a screenshot, and then the crystal shows the Core's health straight away
   * instead of easing to it.
   */
  update(time: number): void {
    const dt = Number.isFinite(this.lastTime)
      ? Math.min(MAX_STEP, Math.max(0, time - this.lastTime))
      : 0;
    this.lastTime = time;
    const look = this.source?.() ?? null;
    const target = look ? Math.min(1, Math.max(0, look.health)) : 1;
    const fallen = look?.fallen === true;
    this.clock += dt;
    if (dt === 0) {
      this.shown = target;
      this.fallenBlend = fallen ? 1 : 0;
    } else {
      if (target < this.lastTarget - 1e-4) this.flash = Math.min(1, this.flash + FLASH_PER_HIT);
      this.flash *= Math.exp(-FLASH_DECAY * dt);
      this.shown += (target - this.shown) * (1 - Math.exp(-HEALTH_FOLLOW * dt));
      this.fallenBlend += ((fallen ? 1 : 0) - this.fallenBlend) * (1 - Math.exp(-3 * dt));
    }
    this.lastTarget = target;
    this.apply(dt);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => this.registry.release(material));
  }

  /** Colors, glow and motion for the current health, flash and fall. */
  private apply(dt: number): void {
    const health = this.shown;
    const alive = 1 - this.fallenBlend;

    // Cyan while sound, amber once it is worn, red near the end, grey once it has fallen.
    if (health >= CYAN_UNTIL) this.tone.copy(CYAN);
    else if (health >= AMBER_AT) {
      this.tone.copy(CYAN).lerp(AMBER, (CYAN_UNTIL - health) / (CYAN_UNTIL - AMBER_AT));
    } else if (health >= AMBER_UNTIL) this.tone.copy(AMBER);
    else if (health >= RED_AT) {
      this.tone.copy(AMBER).lerp(RED, (AMBER_UNTIL - health) / (AMBER_UNTIL - RED_AT));
    } else this.tone.copy(RED);
    this.tone.lerp(DEAD, this.fallenBlend);

    // A slow beat that quickens as the Core weakens, and a flicker close to the end.
    const beat = 0.7 + (1 - health) * 2.2;
    let pulse = 1 + 0.14 * Math.sin(this.clock * beat * Math.PI * 2);
    if (health < FLICKER_BELOW) {
      const unease = 1 - health / FLICKER_BELOW;
      const flicker = 0.5 + 0.5 * Math.sin(this.clock * 37) * Math.sin(this.clock * 23.3);
      pulse *= 1 - unease * 0.35 * flicker;
    }

    const strength = (0.08 + 0.92 * alive) * pulse;
    const flash = Math.min(1, this.flash);
    this.crystalGlow
      .copy(this.tone)
      .lerp(FLASH, flash)
      .multiplyScalar(1.8 * strength + this.flash * 2.2);
    this.crystalColor.copy(this.tone).multiplyScalar(0.28);
    this.lightGlow
      .copy(this.tone)
      .lerp(FLASH, flash * 0.5)
      .multiplyScalar(1.3 * strength + this.flash);

    // Motion: the crystal turns and bobs while it lives, and settles, dark, when it has fallen.
    const spin = alive * (0.5 + (1 - health) * 0.6);
    this.crystal.rotation.y += dt * spin;
    this.ring.rotation.z += dt * (0.4 + 0.9 * alive);
    this.crystal.position.y =
      CRYSTAL_Y + Math.sin(this.clock * 1.1) * 0.07 * alive - this.fallenBlend * 0.22;
    this.crystal.rotation.x = this.fallenBlend * 0.28;
  }

  private material(
    color: string,
    gloss: number,
    metalness: number,
    glow?: string,
    glowIntensity?: number,
    facets?: number,
  ): ShaderMaterial {
    const material = createLitMaterial(this.registry, {
      color,
      gloss,
      metalness,
      ...(glow ? { glow, glowIntensity } : {}),
      ...(facets ? { facets } : {}),
    });
    this.materials.push(material);
    return material;
  }

  private addMerged(material: ShaderMaterial, parts: BufferGeometry[]): void {
    const merged = mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    if (!merged) throw new Error('The Core could not merge its parts');
    this.geometries.push(merged);
    const mesh = new Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.object.add(mesh);
  }
}

/** A rounded box of the given size, centered at (x, y, z), ready to be merged with its neighbors. */
function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rounding = 0.3,
): BufferGeometry {
  const geometry = new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * rounding);
  geometry.translate(x, y, z);
  return geometry;
}

/** One part at each of the four pylons. */
function pylons(make: (x: number, z: number) => BufferGeometry): BufferGeometry[] {
  return [
    make(PYLON_OFFSET, PYLON_OFFSET),
    make(-PYLON_OFFSET, PYLON_OFFSET),
    make(PYLON_OFFSET, -PYLON_OFFSET),
    make(-PYLON_OFFSET, -PYLON_OFFSET),
  ];
}
