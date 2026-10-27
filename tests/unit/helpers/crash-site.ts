import type { CrashSite } from '../../../src/shared/intro-camera';
import { CRASH, FURROW, WORLD_HALF, createTerrainField } from '../../../src/world/terrain/field';
import { bakeGrid } from '../../../src/world/terrain/grid';

export interface TestCrashSite {
  readonly site: CrashSite;
  /** The ground a flying thing is over: the valley inside its walls, the hills of the skyline beyond them. */
  readonly under: (x: number, z: number) => number;
}

/** The crash site of the valley a seed grows, as the intro film is given it. */
export function crashSiteFor(seed: number): TestCrashSite {
  const field = createTerrainField(seed);
  const grid = bakeGrid(field);
  const site: CrashSite = {
    groundAt: (x, z) => grid.groundAt(x, z),
    crater: { x: CRASH.x, z: CRASH.z, radius: CRASH.radius },
    furrow: FURROW,
    spawn: { x: 12, z: 7 },
    core: { x: CRASH.x, y: grid.groundAt(CRASH.x, CRASH.z) + 3, z: CRASH.z },
  };
  const under = (x: number, z: number): number =>
    Math.abs(x) <= WORLD_HALF - 2 && Math.abs(z) <= WORLD_HALF - 2
      ? grid.groundAt(x, z)
      : field.skylineAt(x, z);
  return { site, under };
}
