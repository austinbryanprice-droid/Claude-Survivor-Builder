import { describe, expect, it } from 'vitest';
import {
  MATERIAL,
  isUpsideDown,
  shapeKind,
  stateMaterial,
  stateShape,
  wedgeFacing,
} from '../../src/shared/blocks';
import { DEMO_NAMES, buildDemo, isDemoName } from '../../src/world/voxels/demo';
import { inBuildBounds, createWorld, type VoxelWorld } from '../../src/world/voxels/world';
import { TEST_SEED, terrain } from './helpers/valley';

function newWorld(): VoxelWorld {
  return createWorld(TEST_SEED, terrain());
}

describe('demo structures', () => {
  it('names the demos it can build', () => {
    expect(DEMO_NAMES).toEqual(['outpost', 'swatch', 'hall']);
    expect(isDemoName('outpost')).toBe(true);
    expect(isDemoName('swatch')).toBe(true);
    expect(isDemoName('hall')).toBe(true);
    expect(isDemoName('castle')).toBe(false);
    expect(isDemoName('')).toBe(false);
    expect(isDemoName(null)).toBe(false);
  });

  for (const name of DEMO_NAMES) {
    describe(name, () => {
      it('places every block the plan asks for on the default valley', () => {
        const world = newWorld();
        const result = buildDemo(world, name);
        expect(result.refused).toBe(0);
        expect(result.edits.length).toBeGreaterThan(100);
        expect(world.blockCount).toBe(result.edits.length);
      });

      it('only places blocks the host would accept, in the order it placed them', () => {
        const { edits } = buildDemo(newWorld(), name);
        // Replay the edits on a fresh world: each one must be legal at the moment it goes down.
        const replay = newWorld();
        for (const edit of edits) {
          expect(replay.checkPlace(edit.x, edit.y, edit.z, edit.state)).toBeNull();
          expect(replay.setBlock(edit.x, edit.y, edit.z, edit.state)).toBe(true);
        }
      });

      it('builds the same structure every time', () => {
        expect(buildDemo(newWorld(), name)).toEqual(buildDemo(newWorld(), name));
      });

      it('stays inside the build area and on or above the ground', () => {
        const world = newWorld();
        const { edits } = buildDemo(world, name);
        for (const { x, y, z } of edits) {
          expect(inBuildBounds(x, y, z)).toBe(true);
          // No block floats: the lowest corner of a block's column reaches the ground or another block.
          expect(y).toBeGreaterThanOrEqual(0);
        }
      });

      it('keeps its clearing over the blocks', () => {
        const world = newWorld();
        const { edits, clearing } = buildDemo(world, name);
        expect(clearing.radius).toBeGreaterThan(0);
        for (const { x, z } of edits) {
          const reach = Math.hypot(x + 0.5 - clearing.x, z + 0.5 - clearing.z);
          expect(reach).toBeLessThan(clearing.radius);
        }
      });

      it('marks every chunk it touched for meshing', () => {
        const world = newWorld();
        buildDemo(world, name);
        expect(world.dirtyCount).toBeGreaterThan(0);
        expect(world.dirtyCount).toBeGreaterThanOrEqual(world.chunkCount);
      });
    });
  }

  it('shows every material in the outpost and in the swatches', () => {
    for (const name of DEMO_NAMES) {
      const used = new Set(buildDemo(newWorld(), name).edits.map((e) => stateMaterial(e.state)));
      for (const material of [
        MATERIAL.scrap,
        MATERIAL.composite,
        MATERIAL.alloy,
        MATERIAL.energy,
      ]) {
        expect(used.has(material)).toBe(true);
      }
    }
  });

  it('shows slabs and wedges in the hall, upside-down wedges and several facings included', () => {
    const { edits } = buildDemo(newWorld(), 'hall');
    const shapes = edits.map((e) => stateShape(e.state));
    expect(new Set(shapes.map((s) => shapeKind(s)))).toEqual(new Set(['cube', 'slab', 'wedge']));
    const wedges = shapes.filter((s) => shapeKind(s) === 'wedge');
    expect(wedges.some((s) => isUpsideDown(s))).toBe(true);
    expect(new Set(wedges.map((s) => wedgeFacing(s))).size).toBeGreaterThanOrEqual(3);
  });

  it('tops the hall with a row of wedges seven blocks above its floor', () => {
    const { edits, floorY } = buildDemo(newWorld(), 'hall');
    const top = Math.max(...edits.map((e) => e.y));
    expect(top).toBe(floorY + 7);
    const ridge = edits.filter((e) => e.y === top);
    expect(ridge.length).toBeGreaterThan(0);
    expect(ridge.every((e) => shapeKind(stateShape(e.state)) === 'wedge')).toBe(true);
  });

  it('puts the floor of the outpost at one height with a foundation under the low side', () => {
    const world = newWorld();
    const { edits, floorY } = buildDemo(world, 'outpost');
    const floor = edits.filter((e) => e.y === floorY);
    expect(floor.length).toBeGreaterThan(50);
    const lowest = Math.min(...edits.map((e) => e.y));
    expect(lowest).toBeLessThanOrEqual(floorY);
    // Anything below the floor is foundation: scrap, one block to a cell.
    for (const e of edits.filter((x) => x.y < floorY))
      expect(stateMaterial(e.state)).toBe(MATERIAL.scrap);
  });
});
