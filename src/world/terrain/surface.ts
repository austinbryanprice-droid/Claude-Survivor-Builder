import type { TerrainField } from './field';
import type { SdfGrid } from './grid';

/**
 * How far past the top of a rock's bounding sphere the search for its surface starts, so a lumpy
 * rock whose bump pokes a little out of its estimate is still found from above.
 */
const ROCK_HEADROOM = 0.5;
/** The search walks down a rock this far at a time, then narrows the last step. */
const SEARCH_STEP = 0.1;
const REFINE_STEPS = 6;

/**
 * The height at which feet rest on the terrain at a point: the ground's own height, or the top of
 * a rock where one stands over the spot. It reads the same density grid the player collides with,
 * so something that walks along it stands on what is drawn, rocks included. Terrain is a function
 * of the seed, so every peer gets the same answers.
 *
 * Most of the valley is open ground and answers from the column heights without searching; only a
 * point inside the reach of a rock walks down the density field from the top of that rock.
 */
export function createSurfaceQuery(terrain: {
  readonly field: TerrainField;
  readonly grid: SdfGrid;
}): (x: number, z: number) => number {
  const { field, grid } = terrain;
  const rocks = field.rocks;
  return (x, z) => {
    const ground = grid.groundAt(x, z);
    let top = ground;
    for (const rock of rocks) {
      const dx = x - rock.x;
      const dz = z - rock.z;
      if (dx * dx + dz * dz > rock.bound * rock.bound) continue;
      top = Math.max(top, rock.y + rock.bound + ROCK_HEADROOM);
    }
    if (top === ground) return ground;

    let y = top;
    while (y > ground && grid.sample(x, y, z) > 0) y -= SEARCH_STEP;
    if (y <= ground) return ground;
    // `y` is inside the rock and `y + SEARCH_STEP` was in the open: the surface lies between.
    let inside = y;
    let open = Math.min(top, y + SEARCH_STEP);
    for (let i = 0; i < REFINE_STEPS; i++) {
      const middle = (inside + open) / 2;
      if (grid.sample(x, middle, z) > 0) open = middle;
      else inside = middle;
    }
    return Math.max(ground, inside);
  };
}
