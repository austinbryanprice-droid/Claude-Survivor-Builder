import { MODULE, moduleOfShape, stateShape } from '../../shared/blocks';
import { inReach } from '../../shared/power';
import { POWER } from './balance';
import type { ModuleSite, ModuleSource } from './turrets';

/**
 * The crew's Generators (SPEC section 9): a Generator is a module standing in a cell, and while it
 * stands a player within its reach gets Energy back, as inside the Core's field. There is no fuel and
 * no wiring: standing is powered. The host's simulation looks again at which Generators stand at the
 * start of every step, from the world's own list of modules, so one placed, broken or chewed is known
 * the moment the world knows it, and asks each player's Energy what the Generators give them.
 */

/**
 * How far from the middle of its cell the power of a module (a `MODULE` id) reaches, in blocks, or 0 for
 * a module that gives nothing by radius. The screen draws a ring of this size round one in hand or aimed at.
 */
export function reachOfModule(module: number): number {
  return module === MODULE.generator ? POWER.generator.radius : 0;
}

/** Where Energy comes back besides the Core's field: what a player standing at a spot is given each second. */
export interface ChargeSource {
  /** Energy a second given to a player whose feet are at (x, y, z); 0 when none reaches them. */
  chargeAt(x: number, y: number, z: number): number;
}

/** The middle of the cell a Generator stands in is where its reach is measured from. */
interface Cell {
  x: number;
  y: number;
  z: number;
}

export class Generators implements ChargeSource {
  private readonly cells: Cell[] = [];
  private count = 0;

  private readonly visit = (site: ModuleSite): void => {
    if (moduleOfShape(stateShape(site.state))?.id !== MODULE.generator) return;
    const cell = (this.cells[this.count] ??= { x: 0, y: 0, z: 0 });
    cell.x = site.x;
    cell.y = site.y;
    cell.z = site.z;
    this.count++;
  };

  constructor(private readonly source: ModuleSource) {}

  /** How many Generators stood at the last look. */
  get standing(): number {
    return this.count;
  }

  /** Looks at the world's modules again: the Generators that stand now are the ones that give. Once a step, before the players are charged. */
  refresh(): void {
    this.count = 0;
    this.source(this.visit);
  }

  chargeAt(x: number, y: number, z: number): number {
    const field = POWER.generator;
    for (let i = 0; i < this.count; i++) {
      const cell = this.cells[i] as Cell;
      if (inReach(cell.x, cell.y, cell.z, field.radius, x, y, z)) return field.perSecond;
    }
    return 0;
  }
}
