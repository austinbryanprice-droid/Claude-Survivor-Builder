import { describe, expect, it } from 'vitest';
import { createSurfaceQuery } from '../../src/world/terrain/surface';
import { terrain } from './helpers/valley';

describe('where feet rest on the valley', () => {
  const { field, grid } = terrain();
  const surfaceAt = createSurfaceQuery({ field, grid });

  it('is the ground itself on open ground', () => {
    for (const [x, z] of [
      [-2, -4],
      [20.5, 30.5],
      [-60.2, 10.7],
      [40.1, -50.3],
    ] as const) {
      const near = field.rocks.some((rock) => Math.hypot(x - rock.x, z - rock.z) < rock.bound);
      if (near) continue;
      expect(surfaceAt(x, z)).toBe(grid.groundAt(x, z));
    }
  });

  it('is never under the ground', () => {
    for (let x = -90; x <= 90; x += 7.3) {
      for (let z = -90; z <= 90; z += 7.9) {
        expect(surfaceAt(x, z)).toBeGreaterThanOrEqual(grid.groundAt(x, z));
      }
    }
  });

  it('rests on top of a rock where one stands, on the surface the player collides with', () => {
    let risen = 0;
    for (const rock of field.rocks) {
      for (const [dx, dz] of [
        [0, 0],
        [rock.rx * 0.3, 0],
        [0, rock.rz * 0.3],
      ] as const) {
        const x = rock.x + dx;
        const z = rock.z + dz;
        const top = surfaceAt(x, z);
        if (top <= grid.groundAt(x, z) + 0.05) continue;
        risen++;
        // Just under the surface is inside the rock, just over it is open air.
        expect(grid.sample(x, top - 0.05, z)).toBeLessThanOrEqual(0);
        expect(grid.sample(x, top + 0.2, z)).toBeGreaterThan(0);
      }
    }
    // The valley has rocks that stand proud of the ground; the search must find them.
    expect(risen).toBeGreaterThan(0);
  });
});
