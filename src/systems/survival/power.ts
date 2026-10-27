import { MODULE, moduleOfShape, stateShape } from '../../shared/blocks';
import { inReach } from '../../shared/power';
import { cellKey } from '../../shared/solid';
import { POWER } from './balance';
import type { ModuleSite, ModuleSource, Powered } from './turrets';

/**
 * The crew's power (SPEC section 9: power by radius, no wiring, "do not require a full simulation").
 * A Generator is a module standing in a cell, and while it stands it has power: a player within its
 * reach gets Energy back, as inside the Core's field, and a turret, a Light or a Power Node within its
 * reach has power too. A Node that has power carries it on, to the turrets, Lights and Nodes within its
 * own reach, so a few Nodes take power from a Generator across a base. There is no fuel, no wiring and no load:
 * standing is powered, being near is powered, and nothing runs out. The host's simulation looks again
 * at which modules stand at the start of every step, from the world's own list of them, so one
 * placed, broken or chewed is known the moment the world knows it; every screen runs the same grid on
 * its own copy of the world, so the lights dim in step with what the host does, with nothing on the wire.
 */

/**
 * How far from the middle of its cell the power of a module (a `MODULE` id) reaches, in blocks, or 0 for
 * a module that gives nothing by radius. The screen draws a ring of this size round one in hand or aimed at.
 */
export function reachOfModule(module: number): number {
  if (module === MODULE.generator) return POWER.generator.radius;
  if (module === MODULE.node) return POWER.node.radius;
  return 0;
}

/** Whether a module takes part in power: it gives it, carries it or takes it (a Terminal, a Storage and a Bed do none of these). */
function takesPart(module: number): boolean {
  return (
    module === MODULE.generator ||
    module === MODULE.node ||
    module === MODULE.turret ||
    module === MODULE.light
  );
}

/** Whether a module takes power from the ones around it (a Generator has its own): the ones that are 'on' or 'off', and that the screen tags with which. */
export function receivesPower(module: number): boolean {
  return module === MODULE.node || module === MODULE.turret || module === MODULE.light;
}

/** Where Energy comes back besides the Core's field: what a player standing at a spot is given each second. */
export interface ChargeSource {
  /** Energy a second given to a player whose feet are at (x, y, z); 0 when none reaches them. */
  chargeAt(x: number, y: number, z: number): number;
}

/**
 * What a module has of power: 'on' when it has some (every standing Generator, and a Node or a turret
 * within reach of one that has), 'off' for a Node or a turret with none, and 'none' for a cell that
 * holds no module that takes part, such as a Terminal or empty air.
 */
export type PowerState = 'none' | 'off' | 'on';

/** A module that takes part in power: where it stands, and whether it has power as of the last look. */
interface Site {
  module: number;
  x: number;
  y: number;
  z: number;
  on: boolean;
}

export class PowerGrid implements ChargeSource, Powered {
  /** The modules that take part, as the last look found them; the first `count` are in use. */
  private readonly sites: Site[] = [];
  private count = 0;
  /** The Generators among them, which charge the players near them. */
  private readonly sources: Site[] = [];
  private readonly byCell = new Map<number, Site>();
  /** Power on the move from a module that has it, in the walk outward from the Generators. */
  private readonly frontier: Site[] = [];

  // The look in progress.
  private seen = 0;
  private changed = false;

  private readonly visit = (site: ModuleSite): void => {
    const module = moduleOfShape(stateShape(site.state))?.id;
    if (module === undefined || !takesPart(module)) return;
    const held = this.sites[this.seen];
    if (!held) {
      this.sites[this.seen] = { module, x: site.x, y: site.y, z: site.z, on: false };
      this.changed = true;
    } else if (
      held.module !== module ||
      held.x !== site.x ||
      held.y !== site.y ||
      held.z !== site.z
    ) {
      held.module = module;
      held.x = site.x;
      held.y = site.y;
      held.z = site.z;
      this.changed = true;
    }
    this.seen++;
  };

  constructor(private readonly source: ModuleSource) {}

  /** How many Generators stood at the last look. */
  get standing(): number {
    return this.sources.length;
  }

  /**
   * Looks at the world's modules again: the Generators that stand now are the ones that give, and the
   * power goes out from them again if any module was placed, broken or moved since the last look. Once a
   * step, before the players are charged and the turrets shoot.
   */
  refresh(): void {
    this.seen = 0;
    this.changed = false;
    this.source(this.visit);
    if (this.seen !== this.count) this.changed = true;
    this.count = this.seen;
    if (this.changed) this.spread();
  }

  chargeAt(x: number, y: number, z: number): number {
    const field = POWER.generator;
    for (const site of this.sources) {
      if (inReach(site.x, site.y, site.z, field.radius, x, y, z)) return field.perSecond;
    }
    return 0;
  }

  /** Whether the module in the cell (x, y, z) has power: a Generator always, a Node or a turret within reach of one that has. */
  powered(x: number, y: number, z: number): boolean {
    return this.byCell.get(cellKey(x, y, z))?.on ?? false;
  }

  /** What the module in a cell has of power, 'none' when it is not one that takes part. */
  stateAt(x: number, y: number, z: number): PowerState {
    const site = this.byCell.get(cellKey(x, y, z));
    return site ? (site.on ? 'on' : 'off') : 'none';
  }

  /** Calls `visit` for each module that takes part, with whether it has power, as of the last look. */
  forEach(visit: (x: number, y: number, z: number, on: boolean) => void): void {
    for (let i = 0; i < this.count; i++) {
      const site = this.sites[i] as Site;
      visit(site.x, site.y, site.z, site.on);
    }
  }

  /** Works out who has power: the Generators, and from each module that has it, whatever receives and lies within its reach. */
  private spread(): void {
    const frontier = this.frontier;
    frontier.length = 0;
    this.sources.length = 0;
    this.byCell.clear();
    for (let i = 0; i < this.count; i++) {
      const site = this.sites[i] as Site;
      site.on = site.module === MODULE.generator;
      this.byCell.set(cellKey(site.x, site.y, site.z), site);
      if (site.on) {
        this.sources.push(site);
        frontier.push(site);
      }
    }
    while (frontier.length > 0) {
      const from = frontier.pop() as Site;
      const reach = reachOfModule(from.module);
      if (!(reach > 0)) continue;
      const reach2 = reach * reach;
      for (let i = 0; i < this.count; i++) {
        const to = this.sites[i] as Site;
        if (to.on || !receivesPower(to.module)) continue;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dz = to.z - from.z;
        if (dx * dx + dy * dy + dz * dz > reach2) continue;
        to.on = true;
        // Only a Node carries power on; a turret that has it uses it.
        if (to.module === MODULE.node) frontier.push(to);
      }
    }
  }
}
