import type { DebrisNode } from '../../shared/economy';
import { createRng, hash3 } from '../../shared/hash';
import { DEBRIS } from './balance';
import { gradeAt, harvestsOfGrade } from './grades';

/**
 * Where the heaps of debris lie in the valley: a pure function of the seed and the ground, so the
 * same run is the same on every try and a test can check every heap. The host draws the list once
 * when the run starts and sends it to its guests (so no two screens can disagree about where a
 * heap is even if their sums differ in the last place); nothing but the host needs to call this.
 *
 * The list is the whole run's field, drawn up front: the first batch lies in the open when the run
 * begins, and each later batch is uncovered at a dawn, in a band a little farther out than the one
 * before it ("new nodes appear slowly or in slightly farther areas", SPEC section 8).
 */

/** What the generator reads of the valley: the ground a heap rests on, the lake and the edge. */
export interface FieldGround {
  /** Where feet rest on the terrain at a point, rocks included. */
  surfaceAt(x: number, z: number): number;
  /** The height of the water's surface. */
  readonly waterLevel: number;
  /** The valley runs from `-half` to `half` in x and z. */
  readonly half: number;
}

/** The middle of the Core, which the bands are measured from. */
export interface FieldCenter {
  readonly x: number;
  readonly z: number;
}

const FIELD_SALT = 0x4a11;
const TWO_PI = Math.PI * 2;
/** Where the slope is read, in blocks either side, and how far the ground round a heap is checked. */
const SLOPE_STEP = 1;
const SURROUND = 2.5;
/** The ground round a heap lies within this much of the heap's own height, or it sits on a rock or at a cliff's edge. */
const SURROUND_RISE = 1.3;
/** The field is written to a hundredth of a block, which no screen can see and which keeps the wire short. */
const GRID = 100;

function snap(value: number): number {
  return Math.round(value * GRID) / GRID;
}

/** The band (inner and outer radius) the heaps of a batch lie in: 0 is the batch that lies there from the start. */
export function debrisBand(batch: number): { inner: number; outer: number } {
  if (batch <= 0) return { inner: DEBRIS.inner, outer: DEBRIS.outer };
  const inner = Math.min(
    DEBRIS.limit - DEBRIS.ringWidth,
    DEBRIS.inner + 10 + DEBRIS.ringStep * (batch - 1),
  );
  return { inner, outer: Math.min(DEBRIS.limit, inner + DEBRIS.ringWidth) };
}

/** True when a heap can lie at (x, z): in the valley, on dry level ground that is not a rock's top or a ledge. */
function usable(ground: FieldGround, x: number, z: number): boolean {
  const reach = ground.half - DEBRIS.edge;
  if (Math.abs(x) > reach || Math.abs(z) > reach) return false;
  const y = ground.surfaceAt(x, z);
  if (y < ground.waterLevel + DEBRIS.dry) return false;
  const dx = (ground.surfaceAt(x + SLOPE_STEP, z) - ground.surfaceAt(x - SLOPE_STEP, z)) / 2;
  const dz = (ground.surfaceAt(x, z + SLOPE_STEP) - ground.surfaceAt(x, z - SLOPE_STEP)) / 2;
  if (1 / Math.sqrt(1 + dx * dx + dz * dz) < DEBRIS.flatness) return false;
  for (const [ox, oz] of [
    [SURROUND, 0],
    [-SURROUND, 0],
    [0, SURROUND],
    [0, -SURROUND],
  ] as const) {
    if (Math.abs(ground.surfaceAt(x + ox, z + oz) - y) > SURROUND_RISE) return false;
  }
  return true;
}

/**
 * The whole field for a run. Each batch draws from a generator of its own, so a batch that cannot
 * find room for every heap does not shift where the later ones go. A heap that finds no place in
 * `DEBRIS.attempts` tries is left out, so the list can be a little shorter than the table says on
 * a crowded or watery valley.
 */
export function debrisField(
  seed: number,
  ground: FieldGround,
  center: FieldCenter,
): readonly DebrisNode[] {
  const nodes: DebrisNode[] = [];
  for (let batch = 0; batch <= DEBRIS.dawns; batch++) {
    const rng = createRng(hash3(seed, FIELD_SALT, batch, 0));
    const { inner, outer } = debrisBand(batch);
    const count = batch === 0 ? DEBRIS.initial : DEBRIS.perDawn;
    for (let n = 0; n < count; n++) {
      for (let attempt = 0; attempt < DEBRIS.attempts; attempt++) {
        const angle = rng() * TWO_PI;
        const radius = inner + rng() * (outer - inner);
        const yaw = rng() * TWO_PI;
        const size = rng();
        const strips = rng();
        const x = snap(center.x + Math.cos(angle) * radius);
        const z = snap(center.z + Math.sin(angle) * radius);
        if (!usable(ground, x, z)) continue;
        if (nodes.some((other) => Math.hypot(other.x - x, other.z - z) < DEBRIS.gap)) continue;
        // The grade comes from the heap's place in its batch, not from the generator, so the better
        // grades move no heap: a run's Scrap lies where it did before they existed.
        const grade = gradeAt(batch, n);
        const span = harvestsOfGrade(grade);
        nodes.push({
          index: nodes.length,
          x,
          y: snap(ground.surfaceAt(x, z)),
          z,
          yaw: snap(yaw),
          scale: snap(DEBRIS.size.min + size * (DEBRIS.size.max - DEBRIS.size.min)),
          harvests:
            span.min +
            Math.min(span.max - span.min, Math.floor(strips * (span.max - span.min + 1))),
          grade,
          from: batch,
        });
        break;
      }
    }
  }
  return nodes;
}
