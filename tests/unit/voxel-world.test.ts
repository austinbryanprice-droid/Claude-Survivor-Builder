import { describe, expect, it } from 'vitest';
import type { BlockWorld, CellState } from '../../src/shared/block-world';
import {
  MATERIAL,
  MODULE,
  SHAPE,
  moduleShape,
  packState,
  slabShape,
} from '../../src/shared/blocks';
import { CHUNK_SIZE, chunkCoords, type ChunkCoords } from '../../src/world/voxels/chunk';
import {
  BUILD_BOUNDS,
  createWorld,
  inBuildBounds,
  type VoxelWorld,
} from '../../src/world/voxels/world';
import { TEST_SEED, terrain } from './helpers/valley';

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const ALLOY = packState(SHAPE.cube, MATERIAL.alloy);
const TERMINAL = packState(moduleShape(MODULE.terminal, 0), 1);

function newWorld(): VoxelWorld {
  return createWorld(TEST_SEED, terrain());
}

/** A column in the crash clearing and the cell that straddles the ground there. */
function groundCell(world: VoxelWorld): { x: number; y: number; z: number } {
  const x = 8;
  const z = -4;
  return { x, y: Math.floor(world.terrain.grid.groundAt(x + 0.5, z + 0.5)), z };
}

function dirtyCoords(world: VoxelWorld): string[] {
  const out: ChunkCoords = { cx: 0, cy: 0, cz: 0 };
  return world.drainDirty().map((key) => {
    chunkCoords(key, out);
    return `${out.cx},${out.cy},${out.cz}`;
  });
}

function edits(world: BlockWorld): string[] {
  const list: string[] = [];
  world.forEachEdit((x, y, z, state) => list.push(`${x},${y},${z}:${state}`));
  return list;
}

describe('VoxelWorld cells', () => {
  it('starts empty and reports the seed', () => {
    const world = newWorld();
    expect(world.seed).toBe(TEST_SEED);
    expect(world.blockCount).toBe(0);
    expect(world.chunkCount).toBe(0);
    expect(world.getBlock(0, 20, 0)).toBe(0);
    expect(world.isSolid(0, 20, 0)).toBe(false);
  });

  it('stores a block and reads it back, as a block world and as a solid query', () => {
    const world = newWorld();
    expect(world.setBlock(3, 20, -5, SCRAP)).toBe(true);
    expect(world.getBlock(3, 20, -5)).toBe(SCRAP);
    expect(world.isSolid(3, 20, -5)).toBe(true);
    expect(world.isSolid(4, 20, -5)).toBe(false);
    expect(world.blockCount).toBe(1);
    expect(world.chunkCount).toBe(1);
  });

  it('handles negative coordinates and chunk edges', () => {
    const world = newWorld();
    const cells: [number, number, number][] = [
      [-1, 0, -1],
      [-16, 5, -17],
      [-17, 5, 15],
      [15, 15, 16],
      [0, 16, 0],
      [BUILD_BOUNDS.minX, 0, BUILD_BOUNDS.minZ],
      [BUILD_BOUNDS.maxX, BUILD_BOUNDS.maxY, BUILD_BOUNDS.maxZ],
    ];
    cells.forEach(([x, y, z], i) => {
      const state = packState(SHAPE.cube, 1 + (i % 4));
      expect(world.setBlock(x, y, z, state)).toBe(true);
    });
    cells.forEach(([x, y, z], i) => {
      expect(world.getBlock(x, y, z)).toBe(packState(SHAPE.cube, 1 + (i % 4)));
    });
    expect(world.blockCount).toBe(cells.length);
  });

  it('is idempotent: setting a cell to the state it already has changes nothing', () => {
    const world = newWorld();
    expect(world.setBlock(1, 20, 1, SCRAP)).toBe(true);
    world.drainDirty();
    expect(world.setBlock(1, 20, 1, SCRAP)).toBe(false);
    expect(world.dirtyCount).toBe(0);
    expect(world.setBlock(2, 20, 2, 0)).toBe(false);
    expect(world.blockCount).toBe(1);
  });

  it('replaces a block with another state and removes it with 0', () => {
    const world = newWorld();
    world.setBlock(1, 20, 1, SCRAP);
    expect(world.setBlock(1, 20, 1, ALLOY)).toBe(true);
    expect(world.getBlock(1, 20, 1)).toBe(ALLOY);
    expect(world.blockCount).toBe(1);
    expect(world.setBlock(1, 20, 1, 0)).toBe(true);
    expect(world.getBlock(1, 20, 1)).toBe(0);
    expect(world.blockCount).toBe(0);
  });

  it('drops a chunk when its last block goes, and reports the chunk dirty so its mesh can go too', () => {
    const world = newWorld();
    world.setBlock(40, 20, 40, SCRAP);
    expect(world.chunkCount).toBe(1);
    world.drainDirty();
    world.setBlock(40, 20, 40, 0);
    expect(world.chunkCount).toBe(0);
    expect(world.getChunk(2, 1, 2)).toBeUndefined();
    expect(dirtyCoords(world)).toEqual(['2,1,2']);
  });

  it('ignores edits outside the buildable area and values that are not a 16-bit whole number', () => {
    const world = newWorld();
    expect(world.setBlock(BUILD_BOUNDS.maxX + 1, 20, 0, SCRAP)).toBe(false);
    expect(world.setBlock(BUILD_BOUNDS.minX - 1, 20, 0, SCRAP)).toBe(false);
    expect(world.setBlock(0, -1, 0, SCRAP)).toBe(false);
    expect(world.setBlock(0, BUILD_BOUNDS.maxY + 1, 0, SCRAP)).toBe(false);
    expect(world.setBlock(0, 20, BUILD_BOUNDS.maxZ + 1, SCRAP)).toBe(false);
    expect(world.setBlock(0.5, 20, 0, SCRAP)).toBe(false);
    expect(world.setBlock(0, 20, 0, 65536)).toBe(false);
    expect(world.setBlock(0, 20, 0, -3)).toBe(false);
    expect(world.setBlock(0, 20, 0, Number.NaN)).toBe(false);
    expect(world.blockCount).toBe(0);
    expect(world.dirtyCount).toBe(0);
    expect(world.getBlock(BUILD_BOUNDS.maxX + 1, 20, 0)).toBe(0);
    expect(world.getBlock(0, -50, 0)).toBe(0);
    expect(world.getBlock(100000, 20, 0)).toBe(0);
  });

  it('keeps a state the tables do not know, so a newer host never loses data', () => {
    const world = newWorld();
    const odd = packState(77, 9);
    expect(world.setBlock(0, 20, 0, odd)).toBe(true);
    expect(world.getBlock(0, 20, 0)).toBe(odd);
  });

  it('keeps the buildable area inside the valley and the chunk key range', () => {
    expect(inBuildBounds(0, 0, 0)).toBe(true);
    expect(inBuildBounds(0, 95, 0)).toBe(true);
    expect(inBuildBounds(0, 96, 0)).toBe(false);
    expect(BUILD_BOUNDS.minX).toBeGreaterThan(-96);
    expect(BUILD_BOUNDS.maxX).toBeLessThan(96);
  });
});

describe('VoxelWorld dirty chunks', () => {
  it('marks only its own chunk when the cell is deep inside it', () => {
    const world = newWorld();
    world.setBlock(8, 8, 8, SCRAP);
    expect(dirtyCoords(world)).toEqual(['0,0,0']);
    expect(world.dirtyCount).toBe(0);
  });

  it('marks the neighbor when the cell is on a chunk face', () => {
    const world = newWorld();
    world.setBlock(CHUNK_SIZE, 8, 8, SCRAP); // lx = 0 of chunk 1
    expect(dirtyCoords(world).sort()).toEqual(['0,0,0', '1,0,0']);
    world.setBlock(15, 8, 8, SCRAP); // lx = 15 of chunk 0
    expect(dirtyCoords(world).sort()).toEqual(['0,0,0', '1,0,0']);
  });

  it('marks the three chunks beside a cell on a chunk edge and seven beside a corner', () => {
    const world = newWorld();
    world.setBlock(16, 16, 8, SCRAP); // x and y on the low side of chunk (1, 1, 0)
    expect(dirtyCoords(world).sort()).toEqual(['0,0,0', '0,1,0', '1,0,0', '1,1,0']);
    world.setBlock(31, 31, 31, SCRAP); // the high corner of chunk (1, 1, 1)
    expect(dirtyCoords(world)).toHaveLength(8);
  });

  it('does not invent chunks outside the buildable area', () => {
    const world = newWorld();
    world.setBlock(BUILD_BOUNDS.minX, 0, BUILD_BOUNDS.minZ, SCRAP);
    for (const key of world.drainDirty()) {
      const { cx, cy, cz } = chunkCoords(key, { cx: 0, cy: 0, cz: 0 });
      expect(cx).toBeGreaterThanOrEqual(-6);
      expect(cy).toBeGreaterThanOrEqual(0);
      expect(cz).toBeGreaterThanOrEqual(-6);
    }
  });

  it('tells a listener once per chunk until the dirty list is drained', () => {
    const world = newWorld();
    const seen: string[] = [];
    const stop = world.onChunkDirty((cx, cy, cz) => seen.push(`${cx},${cy},${cz}`));
    world.setBlock(8, 8, 8, SCRAP);
    world.setBlock(9, 8, 8, SCRAP);
    expect(seen).toEqual(['0,0,0']);
    world.drainDirty();
    world.setBlock(10, 8, 8, SCRAP);
    expect(seen).toEqual(['0,0,0', '0,0,0']);
    stop();
    world.setBlock(11, 8, 8, SCRAP);
    world.drainDirty();
    world.setBlock(12, 8, 8, SCRAP);
    expect(seen).toHaveLength(2);
  });

  it('drains in key order, a few at a time when asked', () => {
    const world = newWorld();
    world.setBlock(40, 8, 40, SCRAP);
    world.setBlock(8, 8, 8, SCRAP);
    world.setBlock(-40, 8, 8, SCRAP);
    const first = world.drainDirty(2);
    expect(first).toHaveLength(2);
    expect(world.dirtyCount).toBe(1);
    const second = world.drainDirty();
    expect(second).toHaveLength(1);
    const all = [...first, ...second];
    expect(all).toEqual(all.slice().sort((a, b) => a - b));
  });

  it('bumps the chunk version on every change', () => {
    const world = newWorld();
    world.setBlock(8, 8, 8, SCRAP);
    const chunk = world.getChunk(0, 0, 0);
    const before = chunk?.version ?? -1;
    world.setBlock(9, 8, 8, SCRAP);
    expect(world.getChunk(0, 0, 0)?.version).toBe(before + 1);
    expect(world.getChunk(0, 0, 0)?.count).toBe(2);
  });
});

describe('VoxelWorld edits', () => {
  const cells: [number, number, number, CellState][] = [
    [40, 20, 40, SCRAP],
    [-3, 12, 7, ALLOY],
    [8, 8, 8, SCRAP],
    [9, 8, 8, SCRAP],
    [-40, 30, -8, packState(SHAPE.cube, MATERIAL.composite)],
    [8, 40, 8, SCRAP],
  ];

  it('are listed in a fixed order, whatever order they were made in', () => {
    const a = newWorld();
    const b = newWorld();
    for (const [x, y, z, s] of cells) a.setBlock(x, y, z, s);
    for (const [x, y, z, s] of cells.slice().reverse()) b.setBlock(x, y, z, s);
    expect(edits(a)).toEqual(edits(b));
    expect(edits(a)).toHaveLength(cells.length);
    // Chunk by chunk (lowest y, then z, then x), and layer by layer inside a chunk.
    expect(edits(a)[0]).toBe(`-3,12,7:${ALLOY}`);
    expect(edits(a).slice(1, 3)).toEqual([`8,8,8:${SCRAP}`, `9,8,8:${SCRAP}`]);
  });

  it('rebuild the same world when replayed into a fresh one, as a late joiner does', () => {
    const host = newWorld();
    for (const [x, y, z, s] of cells) host.setBlock(x, y, z, s);
    host.setBlock(8, 8, 8, 0);
    const joiner = newWorld();
    host.forEachEdit((x, y, z, s) => joiner.setBlock(x, y, z, s));
    expect(edits(joiner)).toEqual(edits(host));
    expect(joiner.blockCount).toBe(host.blockCount);
    for (const [x, y, z] of cells) expect(joiner.getBlock(x, y, z)).toBe(host.getBlock(x, y, z));
  });

  it('are empty for a fresh world', () => {
    expect(edits(newWorld())).toEqual([]);
  });

  it('can be applied twice without changing anything', () => {
    const world = newWorld();
    for (const [x, y, z, s] of cells) world.setBlock(x, y, z, s);
    const once = edits(world);
    world.drainDirty();
    for (const [x, y, z, s] of cells) expect(world.setBlock(x, y, z, s)).toBe(false);
    expect(edits(world)).toEqual(once);
    expect(world.dirtyCount).toBe(0);
  });
});

describe('VoxelWorld placement rules', () => {
  it('accept a block that straddles the ground surface', () => {
    const world = newWorld();
    const { x, y, z } = groundCell(world);
    expect(world.checkPlace(x, y, z, SCRAP)).toBeNull();
  });

  it('refuse a block buried in the hill', () => {
    const world = newWorld();
    const { x, y, z } = groundCell(world);
    expect(world.checkPlace(x, y - 3, z, SCRAP)).toBe('buried');
  });

  it('refuse a block floating in the open air with nothing beside it', () => {
    const world = newWorld();
    const { x, y, z } = groundCell(world);
    expect(world.checkPlace(x, y + 3, z, SCRAP)).toBe('unsupported');
  });

  it('accept a block that touches another block, so a tower can grow', () => {
    const world = newWorld();
    const { x, y, z } = groundCell(world);
    world.setBlock(x, y, z, SCRAP);
    expect(world.checkPlace(x, y + 1, z, SCRAP)).toBeNull();
    expect(world.checkPlace(x + 1, y + 1, z, SCRAP)).toBe('unsupported'); // only a diagonal neighbor
    expect(world.checkPlace(x, y + 2, z, SCRAP)).toBe('unsupported');
    world.setBlock(x, y + 1, z, SCRAP);
    expect(world.checkPlace(x, y + 2, z, SCRAP)).toBeNull();
    expect(world.checkPlace(x + 1, y + 1, z, SCRAP)).toBeNull();
  });

  it('refuse an occupied cell, even with the same state', () => {
    const world = newWorld();
    const { x, y, z } = groundCell(world);
    world.setBlock(x, y, z, SCRAP);
    expect(world.checkPlace(x, y, z, SCRAP)).toBe('occupied');
    expect(world.checkPlace(x, y, z, ALLOY)).toBe('occupied');
  });

  it('refuse a state the tables do not know', () => {
    const world = newWorld();
    const { x, y, z } = groundCell(world);
    expect(world.checkPlace(x, y, z, 0)).toBe('unknown-block');
    expect(world.checkPlace(x, y, z, packState(SHAPE.cube, MATERIAL.none))).toBe('unknown-block');
    expect(world.checkPlace(x, y, z, 70000)).toBe('unknown-block');
  });

  it('refuse cells outside the buildable area', () => {
    const world = newWorld();
    const { y } = groundCell(world);
    expect(world.checkPlace(BUILD_BOUNDS.maxX + 1, y, 0, SCRAP)).toBe('out-of-bounds');
    expect(world.checkPlace(0, BUILD_BOUNDS.maxY + 1, 0, SCRAP)).toBe('out-of-bounds');
    expect(world.checkPlace(0, -1, 0, SCRAP)).toBe('out-of-bounds');
    expect(world.checkPlace(0.5, y, 0, SCRAP)).toBe('out-of-bounds');
  });

  it('allow a break only where a block is', () => {
    const world = newWorld();
    const { x, y, z } = groundCell(world);
    expect(world.checkBreak(x, y, z)).toBe('empty');
    world.setBlock(x, y, z, SCRAP);
    expect(world.checkBreak(x, y, z)).toBeNull();
    expect(world.checkBreak(BUILD_BOUNDS.minX - 1, y, z)).toBe('out-of-bounds');
    expect(world.checkBreak(x, y, z + 0.25)).toBe('out-of-bounds');
  });

  it('never let terrain be broken: a cell with no block is empty even inside a hill', () => {
    const world = newWorld();
    const { x, y, z } = groundCell(world);
    expect(world.checkBreak(x, y - 3, z)).toBe('empty');
  });
});

describe('VoxelWorld modules', () => {
  it('stand on the ground like a block, in any facing', () => {
    const world = newWorld();
    const { x, y, z } = groundCell(world);
    for (let facing = 0; facing < 4; facing++) {
      expect(
        world.checkPlace(x, y, z, packState(moduleShape(MODULE.terminal, facing), 1)),
      ).toBeNull();
    }
    expect(world.checkPlace(x, y - 3, z, TERMINAL)).toBe('buried');
    expect(world.checkPlace(x, y + 3, z, TERMINAL)).toBe('unsupported');
  });

  it('need something under them: a block, or a slab with its flat side up, but not one beside them', () => {
    const world = newWorld();
    const { x, y, z } = groundCell(world);
    world.setBlock(x, y, z, SCRAP);
    expect(world.checkPlace(x, y + 1, z, TERMINAL)).toBeNull();
    // A block can be hung on the side of a tower; a module would float there.
    world.setBlock(x, y + 1, z, SCRAP);
    world.setBlock(x, y + 2, z, SCRAP);
    expect(world.checkPlace(x + 1, y + 2, z, SCRAP)).toBeNull();
    expect(world.checkPlace(x + 1, y + 2, z, TERMINAL)).toBe('unsupported');
    expect(world.checkPlace(x, y + 3, z, TERMINAL)).toBeNull();
    // The top of a lower slab is half a cell down, and a module would hang in the air there.
    world.setBlock(x, y + 2, z, packState(slabShape(false), MATERIAL.scrap));
    expect(world.checkPlace(x, y + 3, z, TERMINAL)).toBe('unsupported');
    world.setBlock(x, y + 2, z, packState(slabShape(true), MATERIAL.scrap));
    expect(world.checkPlace(x, y + 3, z, TERMINAL)).toBeNull();
  });

  it('keep the other rules of a block: occupied cells, unknown levels, the edge of the build area', () => {
    const world = newWorld();
    const { x, y, z } = groundCell(world);
    world.setBlock(x, y, z, TERMINAL);
    expect(world.checkPlace(x, y, z, TERMINAL)).toBe('occupied');
    expect(world.checkPlace(x + 1, y, z, packState(moduleShape(MODULE.terminal, 0), 2))).toBe(
      'unknown-block',
    );
    expect(world.checkPlace(BUILD_BOUNDS.maxX + 1, y, z, TERMINAL)).toBe('out-of-bounds');
  });

  it('are counted and listed with where they stand and what state they are in', () => {
    const world = newWorld();
    const { x, y, z } = groundCell(world);
    expect(world.moduleCount).toBe(0);
    world.setBlock(x, y, z, TERMINAL);
    world.setBlock(x + 1, y, z, SCRAP);
    expect(world.moduleCount).toBe(1);
    const seen: { x: number; y: number; z: number; state: number }[] = [];
    world.forEachModule((module) => seen.push({ ...module }));
    expect(seen).toEqual([{ x, y, z, state: TERMINAL }]);
    // A module turned to face another way is still one module, with its new state.
    const turned = packState(moduleShape(MODULE.terminal, 2), 1);
    world.setBlock(x, y, z, turned);
    expect(world.moduleCount).toBe(1);
    world.forEachModule((module) => expect(module.state).toBe(turned));
    world.setBlock(x, y, z, 0);
    expect(world.moduleCount).toBe(0);
  });

  it('tell a listener when one comes, turns or goes, and not when a block does', () => {
    const world = newWorld();
    const { x, y, z } = groundCell(world);
    const calls: string[] = [];
    const stop = world.onModuleChange((cx, cy, cz, previous, state) =>
      calls.push(`${cx},${cy},${cz}:${previous}>${state}`),
    );
    world.setBlock(x + 2, y, z, SCRAP);
    expect(calls).toEqual([]);
    world.setBlock(x, y, z, TERMINAL);
    const turned = packState(moduleShape(MODULE.terminal, 1), 1);
    world.setBlock(x, y, z, turned);
    world.setBlock(x, y, z, turned);
    world.setBlock(x, y, z, 0);
    expect(calls).toEqual([
      `${x},${y},${z}:0>${TERMINAL}`,
      `${x},${y},${z}:${TERMINAL}>${turned}`,
      `${x},${y},${z}:${turned}>0`,
    ]);
    stop();
    world.setBlock(x, y, z, TERMINAL);
    expect(calls).toHaveLength(3);
  });

  it('ride the edit list like any block, so a late joiner is told of them', () => {
    const host = newWorld();
    const { x, y, z } = groundCell(host);
    host.setBlock(x, y, z, TERMINAL);
    host.setBlock(x - 1, y, z, SCRAP);
    const joiner = newWorld();
    const heard: string[] = [];
    joiner.onModuleChange((cx, cy, cz) => heard.push(`${cx},${cy},${cz}`));
    host.forEachEdit((ex, ey, ez, state) => joiner.setBlock(ex, ey, ez, state));
    expect(joiner.moduleCount).toBe(1);
    expect(heard).toEqual([`${x},${y},${z}`]);
    expect(edits(joiner)).toEqual(edits(host));
  });
});
