import { describe, expect, it } from 'vitest';
import {
  MATERIAL,
  MATERIALS,
  MODULE,
  MODULES,
  SHAPE,
  moduleShape,
  packState,
  slabShape,
  stateMaterial,
  stateShape,
  wedgeShape,
} from '../../src/shared/blocks';
import { createEconomyReading, type DebrisNode } from '../../src/shared/economy';
import { DEBRIS } from '../../src/systems/economy/balance';
import {
  DEBRIS_IN_THE_WAY,
  FULLY_UPGRADED,
  NOTHING_TO_UPGRADE,
  builtOver,
  groupRefusal,
  heapInTheWay,
  keepsClear,
  lockedRefusal,
  moduleStands,
  needsResearch,
  notEnough,
  pieceCost,
  placementRefusal,
  shortfall,
  upgradeBlocker,
  upgradeRefusal,
  upgradeRefusalOnScreen,
  upgradeStep,
  type PlacementEconomy,
} from '../../src/systems/economy/build-rules';
import { blockPrice, turretStepPrice } from './helpers/prices';

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const COMPOSITE = packState(SHAPE.cube, MATERIAL.composite);
const ALLOY = packState(SHAPE.cube, MATERIAL.alloy);

function heap(index: number, overrides: Partial<DebrisNode> = {}): DebrisNode {
  return {
    index,
    x: 20.5,
    y: 10,
    z: -6.5,
    yaw: 0,
    scale: 1,
    harvests: 3,
    grade: MATERIAL.scrap,
    from: 0,
    ...overrides,
  };
}

describe('what a piece costs', () => {
  it('is the cost of its material, whatever its shape', () => {
    for (const material of MATERIALS) {
      for (const shape of [SHAPE.cube, SHAPE.slab, SHAPE.wedge]) {
        expect(pieceCost(packState(shape, material.id))).toEqual({
          material: material.id,
          name: material.name,
          amount: material.cost,
        });
      }
    }
  });

  it('is nothing for a cell state the tables do not know', () => {
    expect(pieceCost(0)).toBeNull();
    expect(pieceCost(packState(SHAPE.cube, 99))).toBeNull();
    expect(pieceCost(packState(moduleShape(MODULE.terminal, 0), 9))).toBeNull();
  });

  it('is what the module table says for a module, whichever way it faces, in the material it names', () => {
    const terminal = MODULES.find((def) => def.id === MODULE.terminal)!;
    const scrap = MATERIALS.find((material) => material.id === terminal.cost.material)!;
    for (let facing = 0; facing < 4; facing++) {
      expect(pieceCost(packState(moduleShape(MODULE.terminal, facing), 1))).toEqual({
        material: scrap.id,
        name: scrap.name,
        amount: terminal.cost.amount,
      });
    }
    expect(pieceCost(packState(moduleShape(MODULE.terminal, 0), 1))?.amount).toBe(40);
  });

  it('is the price of the level for a module that has a ladder, in the material that step is paid in', () => {
    const at = (level: number, facing = 0) =>
      pieceCost(packState(moduleShape(MODULE.turret, facing), level));
    expect(at(1)).toEqual({ material: MATERIAL.scrap, name: 'Scrap', amount: 25 });
    for (let facing = 0; facing < 4; facing++) {
      expect(at(2, facing)).toEqual({
        material: MATERIAL.composite,
        name: 'Reinforced Composite',
        amount: turretStepPrice(2),
      });
      expect(at(3, facing)).toEqual({
        material: MATERIAL.alloy,
        name: 'Advanced Alloy',
        amount: turretStepPrice(3),
      });
    }
    // A level the module does not have is not a piece.
    expect(at(4)).toBeNull();
    expect(at(0)).toBeNull();
  });

  it('tells which material is short, by name', () => {
    expect(notEnough('Scrap')).toBe('not enough Scrap');
    expect(shortfall(() => 0, SCRAP)).toBe('not enough Scrap');
    expect(shortfall(() => 0, COMPOSITE)).toBe('not enough Reinforced Composite');
    expect(shortfall((material) => (material === MATERIAL.scrap ? 1 : 0), SCRAP)).toBeNull();
    expect(shortfall(() => 50, COMPOSITE)).toBeNull();
    expect(shortfall(() => 0, 0)).toBeNull();
  });
});

describe('the room a heap keeps clear', () => {
  const node = heap(0);

  it('takes in the cells under and beside the pile', () => {
    expect(keepsClear(node, 20, 10, -7)).toBe(true);
    expect(keepsClear(node, 20, 11, -7)).toBe(true);
    expect(keepsClear(node, 19, 10, -7)).toBe(true);
    expect(keepsClear(node, 21, 10, -6)).toBe(true);
  });

  it('is round: its radius reaches across a cell edge at the right distance, and no further', () => {
    const radius = DEBRIS.keepClear.radius;
    // A cell whose nearest corner is just inside the radius, and one just outside it.
    const inside = Math.floor(node.x + radius - 0.05);
    const outside = Math.ceil(node.x + radius + 0.05);
    expect(keepsClear(node, inside, 10, Math.floor(node.z))).toBe(true);
    expect(keepsClear(node, outside, 10, Math.floor(node.z))).toBe(false);
    // The corner of a square is farther from the axis than its side: the diagonal cell is not in.
    expect(keepsClear(node, Math.floor(node.x) + 2, 10, Math.floor(node.z) + 2)).toBe(false);
  });

  it('is as tall as the pile and no taller, and reaches a little under the ground', () => {
    const top = node.y + DEBRIS.keepClear.height;
    expect(keepsClear(node, 20, Math.floor(top - 0.1), -7)).toBe(true);
    expect(keepsClear(node, 20, Math.ceil(top + 0.01), -7)).toBe(false);
    expect(keepsClear(node, 20, node.y - 1, -7)).toBe(true);
    expect(keepsClear(node, 20, node.y - 2, -7)).toBe(false);
  });

  it('grows and shrinks with the size of the heap', () => {
    // A heap whose middle is half a block up the cell it lies in, so a cell's bottom edge tells the sizes apart.
    const big = heap(1, { y: 10.5, scale: 1.25 });
    const small = heap(2, { y: 10.5, scale: 0.85 });
    const reach = (n: DebrisNode) => {
      let far = 0;
      for (let dx = 0; dx < 5; dx++) {
        if (keepsClear(n, Math.floor(n.x) + dx, 10, Math.floor(n.z))) far = dx;
      }
      return far;
    };
    expect(reach(big)).toBeGreaterThan(reach(small));
    // The big pile stands three blocks tall (up into the cell at 13), the small one two (not into it).
    expect(keepsClear(big, 20, 13, -7)).toBe(true);
    expect(keepsClear(small, 20, 13, -7)).toBe(false);
    expect(keepsClear(small, 20, 12, -7)).toBe(true);
  });
});

describe('the heap in the way of a block', () => {
  const nodes = [heap(0), heap(1, { x: 40.5 }), heap(2, { x: 60.5 })];
  const left: Record<number, number> = { 0: 3, 1: 0, 2: 2 };
  const debris = { nodes, leftOf: (index: number) => left[index] ?? 0 };

  it('is the heap lying there with strips left whose room the cell is in', () => {
    expect(heapInTheWay(debris, 20, 10, -7)?.index).toBe(0);
    expect(heapInTheWay(debris, 60, 10, -7)?.index).toBe(2);
  });

  it('is none for a heap stripped bare or not uncovered yet, which has strips left of 0', () => {
    expect(heapInTheWay(debris, 40, 10, -7)).toBeNull();
  });

  it('is none away from every heap', () => {
    expect(heapInTheWay(debris, 30, 10, -7)).toBeNull();
    expect(heapInTheWay({ nodes: [], leftOf: () => 0 }, 20, 10, -7)).toBeNull();
  });
});

describe('ground a block stands on where a heap would come up', () => {
  const node = heap(0);

  it('is built over when any cell of the room has a block', () => {
    const cells = new Set<string>();
    const blockAt = (x: number, y: number, z: number) => (cells.has(`${x},${y},${z}`) ? SCRAP : 0);
    expect(builtOver(node, blockAt)).toBe(false);
    cells.add('21,11,-7');
    expect(builtOver(node, blockAt)).toBe(true);
  });

  it('is not built over by a block just outside the room, or above the pile', () => {
    const blockAt = (x: number, y: number, z: number) =>
      (x === 24 && y === 10 && z === -7) || (x === 20 && y === 14 && z === -7) ? SCRAP : 0;
    expect(builtOver(node, blockAt)).toBe(false);
  });

  it('looks at every cell of the room, the corners of its column too', () => {
    const asked = new Set<string>();
    builtOver(node, (x, y, z) => {
      asked.add(`${x},${y},${z}`);
      return 0;
    });
    for (let x = 19; x <= 21; x++) {
      for (let z = -8; z <= -6; z++) {
        for (let y = 10; y <= 11; y++)
          expect(asked.has(`${x},${y},${z}`), `${x},${y},${z}`).toBe(true);
      }
    }
  });
});

describe('what a screen asks before it shows a block as placeable', () => {
  /**
   * A pool that holds `stock`, for a crew that has researched up to `tier` (all of them, unless said)
   * and whose Terminal has read `claimed` points (none, unless said).
   */
  function view(
    stock: number[],
    cap: number,
    left: Record<number, number>,
    tier = 4,
    claimed = 0,
  ): PlacementEconomy {
    return {
      read(out) {
        out.stock.splice(0, out.stock.length, ...stock);
        out.cap = cap;
        out.tier = tier;
        out.claimed = claimed;
        return out;
      },
      debris: { nodes: [heap(0)], leftOf: (index) => left[index] ?? 0 },
    };
  }
  const scratch = createEconomyReading();

  it('accepts a block the pool can pay for where no heap lies', () => {
    expect(
      placementRefusal(view([5, 0, 0, 0], 400, { 0: 3 }), scratch, 30, 10, -7, SCRAP),
    ).toBeNull();
  });

  it('refuses a block the pool cannot pay for, naming what is short', () => {
    const empty = view([0, 0, 0, 0], 400, {});
    expect(placementRefusal(empty, scratch, 30, 10, -7, SCRAP)).toBe('not enough Scrap');
    expect(placementRefusal(empty, scratch, 30, 10, -7, COMPOSITE)).toBe(
      'not enough Reinforced Composite',
    );
  });

  it('charges a module its own price in Scrap, and names what is short', () => {
    const terminal = packState(moduleShape(MODULE.terminal, 0), 1);
    expect(placementRefusal(view([39, 0, 0, 0], 400, {}), scratch, 30, 10, -7, terminal)).toBe(
      'not enough Scrap',
    );
    expect(
      placementRefusal(view([40, 0, 0, 0], 400, {}), scratch, 30, 10, -7, terminal),
    ).toBeNull();
    // Researched tiers do not matter to it.
    expect(
      placementRefusal(view([40, 0, 0, 0], 400, {}, 1), scratch, 30, 10, -7, terminal),
    ).toBeNull();
  });

  it('refuses a block on a heap before it asks about the pool', () => {
    const empty = view([0, 0, 0, 0], 400, { 0: 3 });
    expect(placementRefusal(empty, scratch, 20, 10, -7, SCRAP)).toBe(DEBRIS_IN_THE_WAY);
  });

  it('charges nothing where there is no pool to read', () => {
    const none = view([0, 0, 0, 0], 0, {});
    expect(placementRefusal(none, scratch, 30, 10, -7, SCRAP)).toBeNull();
  });

  it('refuses a material the crew has not researched, however full the pool is', () => {
    const plenty = [99, 99, 99, 99];
    expect(placementRefusal(view(plenty, 400, {}, 1), scratch, 30, 10, -7, COMPOSITE)).toBe(
      needsResearch('Reinforced Composite'),
    );
    expect(placementRefusal(view(plenty, 400, {}, 2), scratch, 30, 10, -7, COMPOSITE)).toBeNull();
    expect(placementRefusal(view(plenty, 400, {}, 2), scratch, 30, 10, -7, ALLOY)).toBe(
      needsResearch('Advanced Alloy'),
    );
    expect(placementRefusal(view(plenty, 400, {}, 3), scratch, 30, 10, -7, ALLOY)).toBeNull();
  });

  it('asks about the lock before the pool, and about the heap before the lock', () => {
    const empty = [0, 0, 0, 0];
    expect(placementRefusal(view(empty, 400, {}, 1), scratch, 30, 10, -7, COMPOSITE)).toBe(
      needsResearch('Reinforced Composite'),
    );
    expect(placementRefusal(view(empty, 400, { 0: 3 }, 1), scratch, 20, 10, -7, COMPOSITE)).toBe(
      DEBRIS_IN_THE_WAY,
    );
  });

  it('locks nothing where there is no pool to read', () => {
    const none = view([0, 0, 0, 0], 0, {}, 1);
    expect(placementRefusal(none, scratch, 30, 10, -7, COMPOSITE)).toBeNull();
  });

  it('refuses a module whose group of research the Terminal has not read, whatever the tier and the pool', () => {
    const generator = packState(moduleShape(MODULE.generator, 0), 1);
    const plenty = [99, 99, 99, 99];
    expect(placementRefusal(view(plenty, 400, {}, 4, 0), scratch, 30, 10, -7, generator)).toBe(
      needsResearch('Generator'),
    );
    expect(placementRefusal(view(plenty, 400, {}, 4, 9), scratch, 30, 10, -7, generator)).toBe(
      needsResearch('Generator'),
    );
    // It is paid in Scrap, so the tier does not matter once the group is read.
    expect(
      placementRefusal(view(plenty, 400, {}, 1, 10), scratch, 30, 10, -7, generator),
    ).toBeNull();
  });

  it('asks about the group before the pool, and about the heap before the group', () => {
    const generator = packState(moduleShape(MODULE.generator, 0), 1);
    const empty = [0, 0, 0, 0];
    expect(placementRefusal(view(empty, 400, {}, 1, 0), scratch, 30, 10, -7, generator)).toBe(
      needsResearch('Generator'),
    );
    expect(placementRefusal(view(empty, 400, {}, 1, 10), scratch, 30, 10, -7, generator)).toBe(
      'not enough Scrap',
    );
    expect(
      placementRefusal(view([39, 0, 0, 0], 400, {}, 1, 10), scratch, 30, 10, -7, generator),
    ).toBe('not enough Scrap');
    expect(
      placementRefusal(view([40, 0, 0, 0], 400, {}, 1, 10), scratch, 30, 10, -7, generator),
    ).toBeNull();
    expect(placementRefusal(view(empty, 400, { 0: 3 }, 1, 0), scratch, 20, 10, -7, generator)).toBe(
      DEBRIS_IN_THE_WAY,
    );
  });

  it('locks no group where there is no pool to read', () => {
    const generator = packState(moduleShape(MODULE.generator, 0), 1);
    expect(
      placementRefusal(view([0, 0, 0, 0], 0, {}, 1, 0), scratch, 30, 10, -7, generator),
    ).toBeNull();
  });
});

describe('the words for a module whose group of research is shut', () => {
  const generator = (facing = 0) => packState(moduleShape(MODULE.generator, facing), 1);

  it('name the module, as the words for a material name the material', () => {
    expect(groupRefusal(0, generator())).toBe('Generator needs research');
    expect(groupRefusal(0, generator())).toBe(needsResearch('Generator'));
    expect(groupRefusal(9, generator())).toBe(needsResearch('Generator'));
    expect(groupRefusal(10, generator())).toBeNull();
    expect(groupRefusal(400, generator())).toBeNull();
  });

  it('say the same whichever way the module faces', () => {
    for (let facing = 0; facing < 4; facing++) {
      expect(groupRefusal(0, generator(facing))).toBe(needsResearch('Generator'));
      expect(groupRefusal(10, generator(facing))).toBeNull();
    }
  });

  it('say nothing of a block, a module no group gates, or a state the tables do not know', () => {
    expect(groupRefusal(0, SCRAP)).toBeNull();
    expect(groupRefusal(0, COMPOSITE)).toBeNull();
    expect(groupRefusal(0, packState(moduleShape(MODULE.terminal, 0), 1))).toBeNull();
    expect(groupRefusal(0, packState(moduleShape(MODULE.turret, 0), 1))).toBeNull();
    expect(groupRefusal(0, 0)).toBeNull();
  });

  it('leave the material lock alone: the Generator is paid in Scrap, which is never locked', () => {
    for (let tier = 1; tier <= 4; tier++) expect(lockedRefusal(tier, generator())).toBeNull();
  });
});

describe('the words for a material that is not researched', () => {
  it('name the material', () => {
    expect(needsResearch('Reinforced Composite')).toBe('Reinforced Composite needs research');
  });

  it('refuse a state above the tier and none at or below it', () => {
    expect(lockedRefusal(1, SCRAP)).toBeNull();
    expect(lockedRefusal(1, COMPOSITE)).toBe('Reinforced Composite needs research');
    expect(lockedRefusal(2, COMPOSITE)).toBeNull();
    expect(lockedRefusal(2, ALLOY)).toBe('Advanced Alloy needs research');
    expect(lockedRefusal(3, ALLOY)).toBeNull();
    expect(lockedRefusal(3, packState(SHAPE.wedge, MATERIAL.energy))).toBe(
      'Energy-Infused needs research',
    );
    expect(lockedRefusal(4, packState(SHAPE.slab, MATERIAL.energy))).toBeNull();
  });

  it('say nothing of a state the tables do not know', () => {
    expect(lockedRefusal(1, 0)).toBeNull();
    expect(lockedRefusal(1, packState(SHAPE.cube, 99))).toBeNull();
  });

  it('lock no module as it is built: its material byte is a level, and it is paid in Scrap', () => {
    for (let tier = 1; tier <= 4; tier++) {
      expect(lockedRefusal(tier, packState(moduleShape(MODULE.terminal, 0), 1))).toBeNull();
      expect(lockedRefusal(tier, packState(moduleShape(MODULE.turret, 0), 1))).toBeNull();
    }
  });

  it('open the steps up a module by the research of the material that pays for them', () => {
    const turret = (level: number) => packState(moduleShape(MODULE.turret, 2), level);
    expect(lockedRefusal(1, turret(2))).toBe('Reinforced Composite needs research');
    expect(lockedRefusal(2, turret(2))).toBeNull();
    expect(lockedRefusal(2, turret(3))).toBe('Advanced Alloy needs research');
    expect(lockedRefusal(3, turret(3))).toBeNull();
    // A level the module does not have names no material, so there is nothing to lock.
    expect(lockedRefusal(1, turret(4))).toBeNull();
  });
});

describe('whether a module stands in the world', () => {
  const TERMINAL = packState(moduleShape(MODULE.terminal, 2), 1);
  /** A world of the given cells, handing them over the way the block world does. */
  const worldOf = (cells: readonly number[]) => ({
    forEachEdit(visit: (x: number, y: number, z: number, state: number) => void) {
      cells.forEach((state, i) => visit(i, 10, 0, state));
    },
  });

  it('finds a Terminal among other cells, whichever way it faces', () => {
    expect(moduleStands(worldOf([SCRAP, COMPOSITE, TERMINAL]), MODULE.terminal)).toBe(true);
    for (let facing = 0; facing < 4; facing++) {
      const turned = packState(moduleShape(MODULE.terminal, facing), 1);
      expect(moduleStands(worldOf([turned]), MODULE.terminal)).toBe(true);
    }
  });

  it('finds none in a world of blocks, or of nothing, or of another module', () => {
    expect(moduleStands(worldOf([]), MODULE.terminal)).toBe(false);
    expect(moduleStands(worldOf([SCRAP, COMPOSITE, ALLOY]), MODULE.terminal)).toBe(false);
    expect(moduleStands(worldOf([TERMINAL]), MODULE.terminal + 1)).toBe(false);
  });
});

describe('what upgrading a piece makes of it', () => {
  const SHAPES = [
    SHAPE.cube,
    slabShape(false),
    slabShape(true),
    ...[0, 1, 2, 3].flatMap((facing) => [wedgeShape(facing), wedgeShape(facing, true)]),
  ];

  it('is the same piece in the next material up, whatever its shape, half or facing', () => {
    for (const shape of SHAPES) {
      for (const material of [MATERIAL.scrap, MATERIAL.composite, MATERIAL.alloy]) {
        const step = upgradeStep(packState(shape, material));
        expect(step).not.toBeNull();
        expect(stateShape(step!.to)).toBe(shape);
        expect(stateMaterial(step!.to)).toBe(material + 1);
        expect(step!.from).toBe(packState(shape, material));
      }
    }
  });

  it('climbs the ladder one rung at a time, from Scrap to Energy-Infused and no further', () => {
    let state = SCRAP;
    const climbed = [stateMaterial(state)];
    for (let step = upgradeStep(state); step; step = upgradeStep(state)) {
      state = step.to;
      climbed.push(stateMaterial(state));
    }
    expect(climbed).toEqual([MATERIAL.scrap, MATERIAL.composite, MATERIAL.alloy, MATERIAL.energy]);
  });

  it('costs the price of the better piece, which the table gives for its material', () => {
    for (const material of [MATERIAL.scrap, MATERIAL.composite, MATERIAL.alloy]) {
      const step = upgradeStep(packState(SHAPE.cube, material))!;
      const better = MATERIALS.find(
        (m) => m.tier === MATERIALS.find((m2) => m2.id === material)!.tier + 1,
      )!;
      expect(step.cost).toEqual({ material: better.id, name: better.name, amount: better.cost });
      expect(step.cost).toEqual(pieceCost(step.to));
    }
  });

  it('is nothing for Energy-Infused, an empty cell and a state the tables do not know', () => {
    expect(upgradeStep(packState(SHAPE.cube, MATERIAL.energy))).toBeNull();
    expect(upgradeStep(packState(wedgeShape(1), MATERIAL.energy))).toBeNull();
    expect(upgradeStep(0)).toBeNull();
    expect(upgradeStep(packState(SHAPE.cube, 99))).toBeNull();
  });

  it('is nothing for a module with no ladder, such as the Terminal', () => {
    for (let facing = 0; facing < 4; facing++) {
      expect(upgradeStep(packState(moduleShape(MODULE.terminal, facing), 1))).toBeNull();
    }
  });

  it('is the next level for a module with a ladder, facing the way it did, at the price of that level', () => {
    for (let facing = 0; facing < 4; facing++) {
      const shape = moduleShape(MODULE.turret, facing);
      const first = upgradeStep(packState(shape, 1))!;
      expect(first.from).toBe(packState(shape, 1));
      expect(first.to).toBe(packState(shape, 2));
      expect(first.cost).toEqual({
        material: MATERIAL.composite,
        name: 'Reinforced Composite',
        amount: turretStepPrice(2),
      });
      const second = upgradeStep(first.to)!;
      expect(second.to).toBe(packState(shape, 3));
      expect(second.cost).toEqual({
        material: MATERIAL.alloy,
        name: 'Advanced Alloy',
        amount: turretStepPrice(3),
      });
      expect(second.cost).toEqual(pieceCost(second.to));
    }
  });

  it('stops at the top of a module ladder, and at a level the module does not have', () => {
    const shape = moduleShape(MODULE.turret, 0);
    expect(upgradeStep(packState(shape, 3))).toBeNull();
    expect(upgradeStep(packState(shape, 4))).toBeNull();
    expect(upgradeStep(packState(shape, 0))).toBeNull();
  });
});

describe('why a piece cannot be upgraded at all', () => {
  it('says nothing is there for an empty cell', () => {
    expect(upgradeBlocker(0)).toBe(NOTHING_TO_UPGRADE);
  });

  it('says a piece at the top, or a module with nothing above it, is fully upgraded', () => {
    expect(upgradeBlocker(packState(SHAPE.cube, MATERIAL.energy))).toBe(FULLY_UPGRADED);
    expect(upgradeBlocker(packState(moduleShape(MODULE.terminal, 0), 1))).toBe(FULLY_UPGRADED);
    expect(upgradeBlocker(packState(moduleShape(MODULE.turret, 0), 3))).toBe(FULLY_UPGRADED);
  });

  it('says nothing of a piece that has a better self', () => {
    expect(upgradeBlocker(SCRAP)).toBeNull();
    expect(upgradeBlocker(COMPOSITE)).toBeNull();
    expect(upgradeBlocker(ALLOY)).toBeNull();
    expect(upgradeBlocker(packState(moduleShape(MODULE.turret, 1), 1))).toBeNull();
    expect(upgradeBlocker(packState(moduleShape(MODULE.turret, 1), 2))).toBeNull();
  });
});

describe('whether the crew can upgrade a piece now', () => {
  const plenty = () => 99;
  const none = () => 0;

  it('accepts when the better material is researched and the pool holds its price', () => {
    expect(upgradeRefusal(2, plenty, SCRAP)).toBeNull();
    expect(upgradeRefusal(3, plenty, COMPOSITE)).toBeNull();
    expect(upgradeRefusal(4, plenty, ALLOY)).toBeNull();
  });

  it('refuses a better material the crew has not researched, in the words placing it would get', () => {
    expect(upgradeRefusal(1, plenty, SCRAP)).toBe(needsResearch('Reinforced Composite'));
    expect(upgradeRefusal(2, plenty, COMPOSITE)).toBe(needsResearch('Advanced Alloy'));
    expect(upgradeRefusal(3, plenty, ALLOY)).toBe(needsResearch('Energy-Infused'));
  });

  it('refuses a pool short of the better material, naming it', () => {
    expect(upgradeRefusal(2, none, SCRAP)).toBe(notEnough('Reinforced Composite'));
    expect(upgradeRefusal(4, none, ALLOY)).toBe(notEnough('Energy-Infused'));
  });

  it('asks only about the better material: a pool without Scrap can upgrade a Scrap block', () => {
    const onlyComposite = (material: number) =>
      material === MATERIAL.composite ? blockPrice(MATERIAL.composite) : 0;
    expect(upgradeRefusal(2, onlyComposite, SCRAP)).toBeNull();
  });

  it('asks about the research before the pool', () => {
    expect(upgradeRefusal(1, none, SCRAP)).toBe(needsResearch('Reinforced Composite'));
  });

  it('raises a turret by the same rules: the better material researched and in the pool', () => {
    const turret = (level: number) => packState(moduleShape(MODULE.turret, 3), level);
    expect(upgradeRefusal(1, plenty, turret(1))).toBe(needsResearch('Reinforced Composite'));
    expect(upgradeRefusal(2, none, turret(1))).toBe(notEnough('Reinforced Composite'));
    expect(upgradeRefusal(2, plenty, turret(1))).toBeNull();
    expect(upgradeRefusal(2, plenty, turret(2))).toBe(needsResearch('Advanced Alloy'));
    expect(upgradeRefusal(3, none, turret(2))).toBe(notEnough('Advanced Alloy'));
    expect(upgradeRefusal(3, plenty, turret(2))).toBeNull();
    expect(upgradeRefusal(4, plenty, turret(3))).toBe(FULLY_UPGRADED);
    // The pool is asked for the better material only: a pool with no Scrap can raise a turret.
    const exactly = (material: number) =>
      material === MATERIAL.composite ? turretStepPrice(2) : 0;
    expect(upgradeRefusal(2, exactly, turret(1))).toBeNull();
    const oneShort = (material: number) =>
      material === MATERIAL.composite ? turretStepPrice(2) - 1 : 0;
    expect(upgradeRefusal(2, oneShort, turret(1))).toBe(notEnough('Reinforced Composite'));
  });

  it('says what stops a piece that cannot be upgraded, whatever the crew holds', () => {
    expect(upgradeRefusal(4, plenty, 0)).toBe(NOTHING_TO_UPGRADE);
    expect(upgradeRefusal(4, plenty, packState(SHAPE.cube, MATERIAL.energy))).toBe(FULLY_UPGRADED);
  });
});

describe('what a screen asks before it offers an upgrade', () => {
  const scratch = createEconomyReading();
  function view(stock: number[], cap: number, tier: number): Pick<PlacementEconomy, 'read'> {
    return {
      read(out) {
        out.stock.splice(0, out.stock.length, ...stock);
        out.cap = cap;
        out.tier = tier;
        return out;
      },
    };
  }

  it('reads the pool as this screen has it', () => {
    expect(
      upgradeRefusalOnScreen(
        view([0, blockPrice(MATERIAL.composite), 0, 0], 400, 2),
        scratch,
        SCRAP,
      ),
    ).toBeNull();
    expect(upgradeRefusalOnScreen(view([9, 0, 0, 0], 400, 2), scratch, SCRAP)).toBe(
      notEnough('Reinforced Composite'),
    );
    expect(upgradeRefusalOnScreen(view([9, 9, 9, 9], 400, 1), scratch, SCRAP)).toBe(
      needsResearch('Reinforced Composite'),
    );
  });

  it('charges and locks nothing where there is no pool to read, but still says a piece has no better self', () => {
    const nothing = view([0, 0, 0, 0], 0, 1);
    expect(upgradeRefusalOnScreen(nothing, scratch, SCRAP)).toBeNull();
    expect(upgradeRefusalOnScreen(nothing, scratch, packState(SHAPE.cube, MATERIAL.energy))).toBe(
      FULLY_UPGRADED,
    );
    expect(upgradeRefusalOnScreen(nothing, scratch, 0)).toBe(NOTHING_TO_UPGRADE);
  });
});
