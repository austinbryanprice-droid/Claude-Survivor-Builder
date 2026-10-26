import type { Vec3 } from './look';

/**
 * Where a turret's gun is, as pure geometry (no DOM, no three.js): the host that decides a shot, the
 * screens that draw the bolt and the model whose head turns all take the muzzle from here, so a bolt
 * leaves the barrel the head is drawn pointing along. The numbers are in cell units, with the model's
 * pivot on the cell's vertical middle line (`pivot` up from the floor) and the muzzle `reach` out of
 * it along the way the gun points; the model in `world/render/module-models.ts` is drawn to fit.
 */
export const TURRET_GUN = { pivot: 0.6, reach: 0.4 } as const;

/** Puts the point the head of the turret in cell (x, y, z) turns about into `out`. */
export function turretPivot(x: number, y: number, z: number, out: Vec3): Vec3 {
  out.x = x + 0.5;
  out.y = y + TURRET_GUN.pivot;
  out.z = z + 0.5;
  return out;
}

/**
 * Puts the muzzle of the turret in cell (x, y, z) into `out`, with the gun pointed at (tx, ty, tz).
 * A target at the pivot itself has no direction, so the muzzle is the pivot.
 */
export function turretMuzzle(
  x: number,
  y: number,
  z: number,
  tx: number,
  ty: number,
  tz: number,
  out: Vec3,
): Vec3 {
  turretPivot(x, y, z, out);
  const dx = tx - out.x;
  const dy = ty - out.y;
  const dz = tz - out.z;
  const length = Math.hypot(dx, dy, dz);
  if (!(length > 1e-9)) return out;
  const scale = TURRET_GUN.reach / length;
  out.x += dx * scale;
  out.y += dy * scale;
  out.z += dz * scale;
  return out;
}
