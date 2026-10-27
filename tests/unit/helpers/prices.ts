import { MATERIALS, MODULE, MODULES, moduleLevelCost } from '../../../src/shared/blocks';

/**
 * Prices as the tables have them, so a test of what a purchase does follows the balance pass (5j)
 * and does not repeat its numbers. A test that means to pin a price says so in its own words.
 */

/** What one block of `material` costs, in that material. */
export function blockPrice(material: number): number {
  const found = MATERIALS.find((m) => m.id === material);
  if (!found) throw new Error(`no material ${material}`);
  return found.cost;
}

/** What raising the Basic Turret to `level` (2 for the Auto Turret, 3 for the Heavy) costs, in that step's material. */
export function turretStepPrice(level: number): number {
  const turret = MODULES.find((def) => def.id === MODULE.turret);
  if (!turret) throw new Error('no turret module');
  return moduleLevelCost(turret, level).amount;
}
