import { PowerGrid, type PowerState } from '../systems/survival/power';
import type { ModuleRenderer } from '../world/render/module-render';
import type { VoxelWorld } from '../world/voxels/world';

/**
 * Which of the crew's modules have power, as this screen sees it, and the lights to match. The host
 * decides what a powered turret does with the same function over its own copy of the world (SPEC
 * section 9: power by radius, nothing to wire), so every screen follows the world's own list of
 * modules and works out the same answer: the lights of a turret go down on every screen as the
 * Generator it stood by is broken, in step with the host, with nothing sent. Made after the module
 * renderer, so a module that comes is drawn before it is dressed.
 */
export class PowerWatcher {
  private readonly grid: PowerGrid;
  private readonly stop: () => void;

  constructor(
    voxels: VoxelWorld,
    private readonly modules: ModuleRenderer,
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
   * up, and this puts them down again.
   */
  private look(): void {
    this.grid.refresh();
    this.grid.forEach((x, y, z, on) => {
      this.modules.setPowered(x, y, z, on);
    });
  }

  dispose(): void {
    this.stop();
  }
}
