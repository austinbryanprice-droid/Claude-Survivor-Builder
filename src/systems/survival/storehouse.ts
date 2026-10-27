import { MODULE, moduleOfShape, stateShape } from '../../shared/blocks';
import { POOL } from '../economy/balance';
import type { Pool } from '../economy/pool';
import type { ModuleSite, ModuleSource } from './turrets';

/**
 * The crew's storehouse (SPEC section 9: Storage; the approved default "Storage raises the shared pool
 * cap"). A Storage is a module standing in a cell, and while it stands the pool holds `POOL.perStorage`
 * more of every material than the `POOL.cap` the crew starts with. The ceiling is worked out from the
 * Storages that stand, so one placed, broken or chewed changes it the moment the world knows. What the pool
 * holds above a lowered ceiling stays, to be spent down (a crew does not lose its stock when a Storage
 * falls), but nothing more goes in until it is under again. The host looks at the world's own list of
 * modules once a step, as it does for the power grid, and nothing is sent for a Storage but its state: the
 * ceiling is part of the pool the host already tells its guests.
 */

/** The most the pool holds of any one material with so many Storages standing. */
export function ceilingWith(storages: number): number {
  return (
    POOL.cap + (Number.isFinite(storages) ? Math.max(0, Math.floor(storages)) : 0) * POOL.perStorage
  );
}

export class Storehouse {
  private count = 0;
  private seen = 0;

  private readonly visit = (site: ModuleSite): void => {
    if (moduleOfShape(stateShape(site.state))?.id === MODULE.storage) this.seen++;
  };

  constructor(
    private readonly source: ModuleSource,
    private readonly pool: Pool,
  ) {}

  /** How many Storages stood at the last look. */
  get standing(): number {
    return this.count;
  }

  /** Looks at the world's modules again and sets the pool's ceiling to what the Storages that stand allow. Once a step. */
  refresh(): void {
    this.seen = 0;
    this.source(this.visit);
    this.count = this.seen;
    const ceiling = ceilingWith(this.count);
    if (ceiling !== this.pool.cap) this.pool.setCap(ceiling);
  }
}
