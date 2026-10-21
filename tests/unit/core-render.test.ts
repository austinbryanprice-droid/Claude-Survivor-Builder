import { Box3, Group, Mesh, Vector3, type Color, type ShaderMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  CORE_FOOTPRINT,
  CORE_HEIGHT,
  CORE_SKIRT,
  outpostFor,
  type Outpost,
} from '../../src/world/outpost';
import { CoreRenderer, type CoreLook } from '../../src/world/render/core-render';
import { createTestRegistry } from './helpers/registry';
import { terrain } from './helpers/valley';

function build(look: CoreLook | null = null) {
  const outpost = outpostFor((x, z) => terrain().grid.groundAt(x, z));
  const registry = createTestRegistry();
  const parent = new Group();
  const core = new CoreRenderer(parent, registry, outpost);
  core.follow(() => look);
  return { core, registry, parent, outpost };
}

/** The crystal is the mesh whose glow follows the way a face points. */
function crystalOf(core: CoreRenderer): Mesh {
  const found = core.object.children.find(
    (child): child is Mesh =>
      child instanceof Mesh &&
      ((child.material as ShaderMaterial).uniforms.uFacets?.value as number) > 0,
  );
  if (!found) throw new Error('The Core has no crystal');
  return found;
}

const glowOf = (mesh: Mesh): Color =>
  (mesh.material as ShaderMaterial).uniforms.uGlow?.value as Color;

const brightness = (color: Color): number => color.r + color.g + color.b;

/** Where the Core stands for a look, posed at once (the stage's clock is not moving). */
function posed(look: CoreLook) {
  const made = build(look);
  made.core.update(0);
  return { ...made, glow: glowOf(crystalOf(made.core)).clone() };
}

describe('the Outpost Core as it is drawn', () => {
  it('stands where the world holds it, as six meshes', () => {
    const { core, parent, outpost } = build();
    expect(parent.children).toEqual([core.object]);
    expect(core.object.name).toBe('outpost-core');
    expect(core.object.position.toArray()).toEqual([outpost.x, outpost.baseY, outpost.z]);
    expect(core.object.children.filter((child) => child instanceof Mesh)).toHaveLength(6);
  });

  it('fits the box the world holds solid, so nothing is solid that is not drawn and nothing drawn sticks out of it', () => {
    const { core, outpost } = build();
    core.object.updateMatrixWorld(true);
    const box = new Box3().setFromObject(core.object);
    const half = CORE_FOOTPRINT / 2;
    // A rounded trim a few hundredths proud of the footprint is the only thing allowed past it at
    // the sides, and the foundation reaches down below the base into the ground.
    const slack = 0.05;
    expect(box.min.x).toBeGreaterThanOrEqual(outpost.x - half - slack);
    expect(box.max.x).toBeLessThanOrEqual(outpost.x + half + slack);
    expect(box.min.z).toBeGreaterThanOrEqual(outpost.z - half - slack);
    expect(box.max.z).toBeLessThanOrEqual(outpost.z + half + slack);
    expect(box.min.y).toBeGreaterThanOrEqual(outpost.baseY - CORE_SKIRT - 1e-6);
    expect(box.max.y).toBeLessThanOrEqual(outpost.baseY + CORE_HEIGHT);
    // And it fills most of it: a Core that is a speck in its box would be a wall nobody can see.
    const size = box.getSize(new Vector3());
    expect(size.x).toBeGreaterThan(CORE_FOOTPRINT - 0.2);
    expect(size.z).toBeGreaterThan(CORE_FOOTPRINT - 0.2);
    expect(size.y).toBeGreaterThan(CORE_HEIGHT - 0.3);
  });

  it('shows a whole Core as cyan, a worn one as amber and a failing one as red', () => {
    const whole = posed({ health: 1, fallen: false }).glow;
    const worn = posed({ health: 0.4, fallen: false }).glow;
    const failing = posed({ health: 0.1, fallen: false }).glow;
    expect(whole.b).toBeGreaterThan(whole.r);
    expect(whole.g).toBeGreaterThan(whole.r);
    expect(worn.r).toBeGreaterThan(worn.g);
    expect(worn.g).toBeGreaterThan(worn.b);
    expect(failing.r).toBeGreaterThan(failing.g * 2);
    expect(failing.r).toBeGreaterThan(failing.b * 2);
    // Amber is yellower than red.
    expect(worn.g / worn.r).toBeGreaterThan(failing.g / failing.r);
  });

  it('agrees with the gauge on the HUD about where amber and red begin', () => {
    // The gauge is amber below half and red below a quarter: by then the crystal has mostly turned.
    const half = posed({ health: 0.5, fallen: false }).glow;
    const quarter = posed({ health: 0.25, fallen: false }).glow;
    expect(half.r).toBeGreaterThan(half.b);
    expect(quarter.g / quarter.r).toBeLessThan(0.5);
  });

  it('goes dark, low and tilted when it has fallen', () => {
    const alive = posed({ health: 1, fallen: false });
    const fallen = posed({ health: 0, fallen: true });
    const crystalAlive = crystalOf(alive.core);
    const crystalFallen = crystalOf(fallen.core);
    expect(brightness(fallen.glow)).toBeLessThan(brightness(alive.glow) * 0.2);
    expect(crystalFallen.rotation.x).toBeGreaterThan(0.2);
    expect(crystalFallen.position.y).toBeLessThan(crystalAlive.position.y - 0.15);
  });

  it('eases to the health it is told instead of jumping, once time is passing', () => {
    let look: CoreLook = { health: 1, fallen: false };
    const { core } = build();
    core.follow(() => look);
    core.update(10);
    const whole = glowOf(crystalOf(core)).clone();
    look = { health: 0.1, fallen: false };
    core.update(10.05);
    const soon = glowOf(crystalOf(core)).clone();
    for (let t = 10.05; t < 14; t += 0.05) core.update(t + 0.05);
    const later = glowOf(crystalOf(core)).clone();
    // A moment after the blow the crystal is still mostly cyan (and lit with the flash); a few seconds on it is red.
    expect(soon.b).toBeGreaterThan(soon.r * 0.5);
    expect(whole.b).toBeGreaterThan(whole.r);
    expect(later.r).toBeGreaterThan(later.b * 2);
  });

  it('flashes when it is hit, and the flash dies away', () => {
    let look: CoreLook = { health: 1, fallen: false };
    const { core } = build();
    core.follow(() => look);
    core.update(5);
    core.update(5.05);
    const calm = brightness(glowOf(crystalOf(core)));
    look = { health: 0.9, fallen: false };
    core.update(5.1);
    const struck = brightness(glowOf(crystalOf(core)));
    for (let t = 5.1; t < 9; t += 0.05) core.update(t + 0.05);
    const after = brightness(glowOf(crystalOf(core)));
    expect(struck).toBeGreaterThan(calm * 1.5);
    expect(after).toBeLessThan(struck);
  });

  it('is posed the same way for the same clock, so a frozen page gives the same picture twice', () => {
    const a = posed({ health: 0.35, fallen: false });
    const b = posed({ health: 0.35, fallen: false });
    expect(glowOf(crystalOf(a.core)).toArray()).toEqual(glowOf(crystalOf(b.core)).toArray());
    expect(crystalOf(a.core).rotation.toArray()).toEqual(crystalOf(b.core).rotation.toArray());
  });

  it('shows a whole Core when nothing says otherwise, and ignores a time that runs backwards', () => {
    const { core } = build(null);
    core.update(3);
    const whole = glowOf(crystalOf(core)).clone();
    core.update(2);
    expect(glowOf(crystalOf(core)).b).toBeGreaterThan(whole.r);
    expect(Number.isFinite(crystalOf(core).rotation.y)).toBe(true);
  });

  it('does not count a long gap (a hidden tab) as time passing for the Core', () => {
    const { core } = build({ health: 1, fallen: false });
    core.update(0);
    const before = crystalOf(core).rotation.y;
    core.update(500);
    // The turn is a fraction of a second's worth, not five hundred seconds' worth.
    expect(crystalOf(core).rotation.y - before).toBeLessThan(1);
  });

  it('takes itself out of the scene and gives its materials back when it is disposed', () => {
    const { core, parent, registry } = build();
    const release = vi.spyOn(registry, 'release');
    core.dispose();
    expect(parent.children).toHaveLength(0);
    expect(release).toHaveBeenCalledTimes(5);
  });
});

describe('where it is drawn on another seed', () => {
  it('follows the outpost it is given, wherever the ground puts it', () => {
    const lifted: Outpost = { ...outpostFor(() => 20), cellX: 7, cellZ: -9 };
    const parent = new Group();
    const core = new CoreRenderer(parent, createTestRegistry(), lifted);
    expect(core.object.position.toArray()).toEqual([lifted.x, lifted.baseY, lifted.z]);
  });
});
