import type { LampSource } from '../engine/lamps';
import { MODULE, moduleFacing, moduleOfShape, stateShape } from '../shared/blocks';
import { PowerGrid, type PowerState } from '../systems/survival/power';
import { lampSource } from '../world/render/lamp-source';
import type { ModuleRenderer } from '../world/render/module-render';
import type { VoxelWorld } from '../world/voxels/world';

/** Where the lamps of the Lights that have power are handed on to: the stage's lamp field. */
export interface LampSink {
  set(sources: readonly LampSource[]): void;
}

/**
 * Which of the crew's modules have power, as this screen sees it, and the lights to match. The host
 * decides what a powered turret does with the same function over its own copy of the world (SPEC
 * section 9: power by radius, nothing to wire), so every screen follows the world's own list of
 * modules and works out the same answer: the lights of a turret go down on every screen as the
 * Generator it stood by is broken, in step with the host, with nothing sent. A Light that has power also
 * throws light, so the watcher keeps the list of those lamps for the stage. Made after the module
 * renderer, so a module that comes is drawn before it is dressed.
 */
export class PowerWatcher {
  private readonly grid: PowerGrid;
  private readonly stop: () => void;

  constructor(
    private readonly voxels: VoxelWorld,
    private readonly modules: ModuleRenderer,
    private readonly lamps?: LampSink,
  ) {
    this.grid = new PowerGrid((visit) => voxels.forEachModule(visit));
    this.stop = voxels.onModuleChange(() => this.look());
    this.look();
  }

  /** What the module in a cell has of power; 'none' for a cell that holds no module that takes part. */
  stateAt(x: number, y: number, z: number): PowerState {
    return this.grid.stateAt(x, y, z);
  }

  /**
   * Looks at the modules again and dresses each one for it. Every module is dressed on every change, not
   * only the ones whose power changed: a module that was drawn again (raised, say) starts with its lights
   * up, and this puts them down again. The Lights that have power are the lamps that burn.
   */
  private look(): void {
    this.grid.refresh();
    const burning: LampSource[] = [];
    this.grid.forEach((x, y, z, on) => {
      this.modules.setPowered(x, y, z, on);
      if (!on) return;
      const shape = stateShape(this.voxels.getBlock(x, y, z));
      if (moduleOfShape(shape)?.id === MODULE.light) {
        burning.push(lampSource(x, y, z, moduleFacing(shape)));
      }
    });
    this.lamps?.set(burning);
  }

  dispose(): void {
    this.stop();
    this.lamps?.set([]);
  }
}
