import type {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
} from 'three';
import { describe, expect, it } from 'vitest';
import { createDebrisRenderer } from '../../src/engine/debris-render';
import { MATERIAL } from '../../src/shared/blocks';
import type { DebrisNode } from '../../src/shared/economy';
import { NET } from '../../src/shared/net-config';
import { createTestRegistry } from './helpers/registry';

function heap(index: number, extra: Partial<DebrisNode> = {}): DebrisNode {
  return {
    index,
    x: 10 + index * 7,
    y: 12.5,
    z: -4 - index * 3,
    yaw: 0.5 + index,
    scale: 1,
    harvests: 3,
    grade: MATERIAL.scrap,
    from: 0,
    ...extra,
  };
}

/** A stand-in for the view the network layer keeps: the heaps, what is left of each, and a version that moves with them. */
function field(nodes: DebrisNode[], left?: number[]) {
  const strips = left ?? nodes.map((node) => node.harvests);
  return {
    nodes,
    strips,
    version: 1,
    leftOf: (index: number) => strips[index] ?? 0,
    /** Changes the strips a heap has left, as a strip or a dawn does. */
    set(index: number, value: number) {
      strips[index] = value;
      this.version++;
    },
  };
}

function setup(capacity?: number) {
  const registry = createTestRegistry();
  const renderer = createDebrisRenderer({ registry, ...(capacity ? { capacity } : {}) });
  const mesh = renderer.object.children[0] as Mesh;
  const geometry = mesh.geometry as InstancedBufferGeometry;
  const value = (name: string, index: number, width: number): number[] => {
    const array = geometry.getAttribute(name).array as Float32Array;
    return Array.from(array.slice(index * width, index * width + width));
  };
  return { renderer, registry, mesh, geometry, value };
}

/** Runs `seconds` of frames. */
function pass(
  rig: Pick<ReturnType<typeof setup>, 'renderer'>,
  view: ReturnType<typeof field>,
  seconds: number,
  run = 1,
): void {
  const frames = Math.ceil(seconds / 0.016);
  for (let i = 0; i < frames; i++) rig.renderer.update(0.016, view, run);
}

describe('the heaps of wreckage on screen', () => {
  it('are one mesh, drawn in one call whatever their number, and hidden when there are none', () => {
    const rig = setup();
    const { renderer, mesh, geometry } = rig;
    expect(renderer.object.children).toHaveLength(1);
    expect(mesh.visible).toBe(false);
    const view = field([heap(0), heap(1), heap(2)]);
    renderer.update(0.016, view, 1);
    expect(mesh.visible).toBe(true);
    expect(geometry.instanceCount).toBe(3);
    const empty = field([]);
    empty.version = 2;
    renderer.update(0.016, empty, 1);
    expect(mesh.visible).toBe(false);
    expect(geometry.instanceCount).toBe(0);
  });

  it('put each heap where the list says, turned and sized as it says', () => {
    const { renderer, value } = setup();
    const view = field([
      heap(0, { x: 3.5, y: 11.25, z: -8, yaw: 1.5, scale: 1.2 }),
      heap(1, { x: -4, y: 9, z: 6, yaw: 0.25, scale: 0.9 }),
    ]);
    renderer.update(0.016, view, 1);
    expect(value('iPos', 0, 3)).toEqual([3.5, 11.25, -8]);
    expect(value('iPos', 1, 3)).toEqual([-4, 9, 6]);
    expect(value('iData', 0, 4)[0]).toBeCloseTo(1.5, 6);
    expect(value('iData', 0, 4)[1]).toBeCloseTo(1.2, 6);
    expect(value('iData', 1, 4)[1]).toBeCloseTo(0.9, 6);
    expect(renderer.list().map((shown) => shown.index)).toEqual([0, 1]);
  });

  it('dress the top of a heap three ways, by turns, and keep each heap in the dress it has', () => {
    const rig = setup();
    const view = field([heap(0), heap(1), heap(2), heap(3)]);
    rig.renderer.update(0.016, view, 1);
    const dressings = [0, 1, 2, 3].map((i) => rig.value('iState', i, 4)[2]);
    expect(dressings).toEqual([1, 2, 3, 1]);
    pass(rig, view, 1);
    expect([0, 1, 2, 3].map((i) => rig.value('iState', i, 4)[2])).toEqual(dressings);
  });

  it('dress each heap in the grade of its strips, Scrap first', () => {
    const rig = setup();
    const view = field([
      heap(0),
      heap(1, { grade: MATERIAL.composite }),
      heap(2, { grade: MATERIAL.alloy }),
      heap(3, { grade: MATERIAL.scrap }),
    ]);
    rig.renderer.update(0.016, view, 1);
    expect([0, 1, 2, 3].map((i) => rig.value('iGrade', i, 1)[0])).toEqual([0, 1, 2, 0]);
    expect(rig.renderer.list().map((shown) => shown.grade)).toEqual([
      MATERIAL.scrap,
      MATERIAL.composite,
      MATERIAL.alloy,
      MATERIAL.scrap,
    ]);
    // The grade belongs to the heap, not to the slot it is drawn in: a heap before it going away moves it up.
    view.set(0, 0);
    pass(rig, view, 2);
    expect(rig.renderer.list().map((shown) => shown.grade)).toEqual([
      MATERIAL.composite,
      MATERIAL.alloy,
      MATERIAL.scrap,
    ]);
    expect([0, 1, 2].map((i) => rig.value('iGrade', i, 1)[0])).toEqual([1, 2, 0]);
  });

  it('show a heap that has nothing left, or is not uncovered yet, as not there at all', () => {
    const { renderer, geometry } = setup();
    const view = field([heap(0), heap(1), heap(2, { from: 2 })], [3, 0, 0]);
    renderer.update(0.016, view, 1);
    expect(geometry.instanceCount).toBe(1);
    expect(renderer.list().map((shown) => shown.index)).toEqual([0]);
  });

  it('draw no more than they have room for, and never write past the buffers', () => {
    const { renderer, geometry } = setup(4);
    const crowd = Array.from({ length: 9 }, (_, i) => heap(i));
    renderer.update(0.016, field(crowd), 1);
    expect(geometry.instanceCount).toBe(4);
    expect(renderer.list()).toHaveLength(4);
    // The room the network allows for a list is the room the picture has by default.
    const full = setup();
    full.renderer.update(
      0.016,
      field(Array.from({ length: NET.maxDebris + 5 }, (_, i) => heap(i))),
      1,
    );
    expect(full.geometry.instanceCount).toBe(NET.maxDebris);
  });

  it('are there from the first look, in the first picture of a run and for a player who just arrived', () => {
    const { renderer, geometry } = setup();
    renderer.update(0.016, field([heap(0), heap(1)]), 1);
    expect(geometry.instanceCount).toBe(2);
    for (const shown of renderer.list()) {
      expect(shown.presence).toBe(1);
      expect(shown.share).toBe(1);
      expect(shown.flash).toBe(0);
    }
  });
});

describe('a strip', () => {
  it('lights the heap and takes a layer off it, easing the share shown toward the share left', () => {
    const rig = setup();
    const view = field([heap(0)]);
    rig.renderer.update(0.016, view, 1);
    view.set(0, 2);
    rig.renderer.update(0.016, view, 1);
    const early = rig.renderer.list()[0];
    expect(early?.flash).toBe(1);
    expect(early?.left).toBe(2);
    expect(early?.share).toBeLessThan(1);
    expect(early?.share).toBeGreaterThan(2 / 3);
    pass(rig, view, 1);
    const settled = rig.renderer.list()[0];
    expect(settled?.share).toBeCloseTo(2 / 3, 6);
    expect(settled?.flash).toBe(0);
    expect(rig.value('iData', 0, 4)[2]).toBeCloseTo(2 / 3, 5);
  });

  it('dies away as a flash within a third of a second', () => {
    const rig = setup();
    const view = field([heap(0)]);
    rig.renderer.update(0.016, view, 1);
    view.set(0, 2);
    rig.renderer.update(0.016, view, 1);
    rig.renderer.update(0.1, view, 1);
    const fading = rig.renderer.list()[0]?.flash ?? 0;
    expect(fading).toBeGreaterThan(0.4);
    expect(fading).toBeLessThan(1);
    rig.renderer.update(0.1, view, 1);
    rig.renderer.update(0.1, view, 1);
    rig.renderer.update(0.1, view, 1);
    expect(rig.renderer.list()[0]?.flash).toBe(0);
  });

  it('sinks a heap that has been stripped bare into the ground, and then stops drawing it', () => {
    const rig = setup();
    const view = field([heap(0), heap(1)], [3, 1]);
    rig.renderer.update(0.016, view, 1);
    view.set(1, 0);
    rig.renderer.update(0.3, view, 1);
    const sinking = rig.renderer.list().find((shown) => shown.index === 1);
    expect(sinking?.presence).toBeGreaterThan(0);
    expect(sinking?.presence).toBeLessThan(1);
    expect(rig.geometry.instanceCount).toBe(2);
    pass(rig, view, 0.6);
    expect(rig.geometry.instanceCount).toBe(1);
    expect(rig.renderer.list().map((shown) => shown.index)).toEqual([0]);
  });

  it('takes the layers off in order: the share shown is the share of strips left, whole heaps first', () => {
    const rig = setup();
    const view = field([heap(0, { harvests: 4 })], [4]);
    rig.renderer.update(0.016, view, 1);
    const shares: number[] = [];
    for (const left of [3, 2, 1]) {
      view.set(0, left);
      pass(rig, view, 1);
      shares.push(rig.renderer.list()[0]?.share ?? -1);
    }
    expect(shares[0]).toBeCloseTo(0.75, 6);
    expect(shares[1]).toBeCloseTo(0.5, 6);
    expect(shares[2]).toBeCloseTo(0.25, 6);
  });
});

describe('a dawn', () => {
  it('raises a heap it uncovers out of the ground over most of a second, where the ones already there stand', () => {
    const rig = setup();
    const view = field([heap(0), heap(1, { from: 1 })], [3, 0]);
    rig.renderer.update(0.016, view, 1);
    expect(rig.geometry.instanceCount).toBe(1);
    view.set(1, 3);
    rig.renderer.update(0.016, view, 1);
    expect(rig.geometry.instanceCount).toBe(2);
    const rising = rig.renderer.list().find((shown) => shown.index === 1);
    expect(rising?.presence).toBeGreaterThan(0);
    expect(rising?.presence).toBeLessThan(0.1);
    expect(rising?.flash).toBe(0);
    pass(rig, view, 0.45);
    const halfway = rig.renderer.list().find((shown) => shown.index === 1)?.presence ?? 0;
    expect(halfway).toBeGreaterThan(0.3);
    expect(halfway).toBeLessThan(0.7);
    pass(rig, view, 0.6);
    expect(rig.renderer.list().find((shown) => shown.index === 1)?.presence).toBe(1);
    expect(rig.renderer.list().find((shown) => shown.index === 0)?.presence).toBe(1);
  });

  it('sees through a list that was sent again with the same heaps in it', () => {
    const rig = setup();
    const view = field([heap(0), heap(1, { from: 1 })], [3, 0]);
    rig.renderer.update(0.016, view, 1);
    // A guest is sent the whole list at a dawn: new objects, the same heaps, one of them uncovered.
    const again = field([heap(0), heap(1, { from: 1 })], [3, 3]);
    again.version = 5;
    rig.renderer.update(0.016, again, 1);
    const entries = rig.renderer.list();
    expect(entries.find((shown) => shown.index === 0)?.presence).toBe(1);
    expect(entries.find((shown) => shown.index === 1)?.presence).toBeLessThan(0.1);
  });
});

describe('a new run', () => {
  it('has its heaps simply there, even where the last run left a heap at the same spot', () => {
    const rig = setup();
    const view = field([heap(0), heap(1)], [3, 0]);
    pass(rig, view, 1, 1);
    expect(rig.geometry.instanceCount).toBe(1);
    // The run starts over with the same valley: heap 1 has all its strips again, from the first frame.
    const next = field([heap(0), heap(1)], [3, 3]);
    next.version = 9;
    rig.renderer.update(0.016, next, 2);
    expect(rig.geometry.instanceCount).toBe(2);
    expect(rig.renderer.list().every((shown) => shown.presence === 1 && shown.flash === 0)).toBe(
      true,
    );
  });

  it('is told a different heap from the old one when a list puts another where one stood', () => {
    const rig = setup();
    const view = field([heap(0)], [1]);
    pass(rig, view, 1);
    expect(rig.renderer.list()[0]?.share).toBeCloseTo(1 / 3, 6);
    const other = field([heap(0, { x: -50, z: 33 })], [3]);
    other.version = 4;
    rig.renderer.update(0.016, other, 1);
    expect(rig.renderer.list()[0]?.share).toBe(1);
    expect(rig.renderer.list()[0]?.flash).toBe(0);
  });

  it('forgets heaps a shorter list no longer has', () => {
    const rig = setup();
    rig.renderer.update(0.016, field([heap(0), heap(1), heap(2)]), 1);
    const shorter = field([heap(0)]);
    shorter.version = 2;
    rig.renderer.update(0.016, shorter, 1);
    expect(rig.geometry.instanceCount).toBe(1);
    // A longer list afterwards does not bring the old ones back sinking or rising.
    const longer = field([heap(0), heap(1), heap(2)]);
    longer.version = 3;
    rig.renderer.update(0.016, longer, 1);
    expect(rig.renderer.list().every((shown) => shown.presence === 1)).toBe(true);
  });
});

describe('the glow of the cursor', () => {
  it('comes up on the heap it is on, fades from the one it leaves, and never lights a heap with nothing left', () => {
    const rig = setup();
    const view = field([heap(0), heap(1), heap(2)], [3, 3, 0]);
    rig.renderer.update(0.016, view, 1);
    rig.renderer.setAimed(1);
    pass(rig, view, 0.6);
    const aimed = (index: number) => rig.renderer.list().find((s) => s.index === index)?.aimed;
    expect(aimed(1)).toBe(1);
    expect(aimed(0)).toBe(0);
    rig.renderer.setAimed(0);
    rig.renderer.update(0.03, view, 1);
    expect(aimed(1)).toBeLessThan(1);
    expect(aimed(1)).toBeGreaterThan(0);
    pass(rig, view, 0.5);
    expect(aimed(1)).toBe(0);
    expect(aimed(0)).toBe(1);
    // Aiming at a heap with nothing left lights nothing.
    rig.renderer.setAimed(2);
    pass(rig, view, 0.5);
    expect(rig.renderer.list().every((shown) => shown.aimed === 0)).toBe(true);
  });
});

describe('the work a frame costs', () => {
  it('is nothing at all once everything has settled and nothing has changed', () => {
    const rig = setup();
    const view = field([heap(0), heap(1)]);
    pass(rig, view, 1);
    const uploads = () => (rig.geometry.getAttribute('iData') as InstancedBufferAttribute).version;
    const before = uploads();
    pass(rig, view, 0.5);
    expect(uploads()).toBe(before);
    // A strip wakes it up again.
    view.set(0, 2);
    rig.renderer.update(0.016, view, 1);
    expect(uploads()).toBeGreaterThan(before);
  });

  it('treats a long frame as a short one, so a hidden tab does not skip a heap’s rise', () => {
    const rig = setup();
    const view = field([heap(0, { from: 1 })], [0]);
    rig.renderer.update(0.016, view, 1);
    view.set(0, 3);
    rig.renderer.update(0.016, view, 1);
    rig.renderer.update(30, view, 1);
    const presence = rig.renderer.list()[0]?.presence ?? 0;
    expect(presence).toBeLessThan(0.3);
  });

  it('has a model of a few hundred triangles, and a full field of heaps costs well under a million', () => {
    const { renderer } = setup();
    expect(renderer.trianglesPerHeap).toBeGreaterThan(300);
    expect(renderer.trianglesPerHeap).toBeLessThan(2500);
    expect(renderer.trianglesPerHeap * 70).toBeLessThan(200_000);
  });
});

describe('the look of the heaps', () => {
  it('is lit like the rest of the world, and casts a shadow that moves the same way', () => {
    const { mesh, registry } = setup();
    const material = mesh.material as ShaderMaterial;
    expect(material.uniforms.uShadowParams).toBe(registry.shadowParams);
    expect(material.uniforms.uKeyDir).toBeDefined();
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    expect(mesh.frustumCulled).toBe(false);
    const depth = mesh.customDepthMaterial as ShaderMaterial;
    expect(depth.vertexShader).toContain('poseVertex');
    expect(material.vertexShader).toContain('poseVertex');
  });

  it('gives the materials back and leaves the scene when it is done', () => {
    const { renderer, registry } = setup();
    renderer.update(0.016, field([heap(0)]), 1);
    const materials = Reflect.get(registry, 'materials') as Set<unknown>;
    expect(materials.size).toBe(1);
    renderer.dispose();
    expect(materials.size).toBe(0);
    expect(renderer.object.children).toHaveLength(0);
    expect(renderer.list()).toEqual([]);
  });
});
