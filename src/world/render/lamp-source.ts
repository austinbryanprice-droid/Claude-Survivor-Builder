import type { LampSource } from '../../engine/lamps';
import { LAMP_HEIGHT, LAMP_LENS, LAMP_TILT } from './module-models';

/** Which way each facing looks across the ground, as (x, z): facing 0 is +x, and each quarter turn takes it on to +z, -x and -z. */
const FORWARD = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

/** How far in front of the lens the light is taken to leave, in blocks, so that the housing does not light itself from inside. */
const STAND_OFF = 0.05;

/**
 * The lamp of the Light that stands in a cell and looks the way `facing` says (a module's facing, 0 to 3):
 * the light leaves just in front of the lens and is aimed along its face, which leans toward the ground with
 * the head (`LAMP_TILT` in `module-models.ts`). The numbers are the model's own, so the light comes from
 * where the lens is drawn.
 */
export function lampSource(x: number, y: number, z: number, facing: number): LampSource {
  const [fx, fz] = FORWARD[facing & 3] as readonly [number, number];
  const along = Math.cos(LAMP_TILT);
  const down = Math.sin(LAMP_TILT);
  const out = LAMP_LENS + STAND_OFF;
  return {
    x: x + 0.5 + fx * out * along,
    y: y + LAMP_HEIGHT - out * down,
    z: z + 0.5 + fz * out * along,
    ax: fx * along,
    ay: -down,
    az: fz * along,
  };
}
