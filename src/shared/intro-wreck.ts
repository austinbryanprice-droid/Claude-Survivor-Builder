/**
 * The path of the thing that falls in the intro: a piece of the station, burning in out of the
 * dusk, touching down at the far end of the furrow and ploughing along it into the crater. It is
 * a function of the film's clock alone, so the glow of its trail, the dust of its skid and the
 * camera that follows it can all be worked out for any moment without having played the ones
 * before.
 */
import type { CrashSite, Point3 } from './intro-camera';

/** When the wreck is where, in seconds of the film. */
export interface WreckTimes {
  /** The first moment it is on screen, high and far. */
  readonly appears: number;
  /** When it first touches the ground, at the far end of the furrow. */
  readonly touchdown: number;
  /** When it comes to rest in the crater. */
  readonly stop: number;
}

export type WreckPhase = 'fall' | 'skid' | 'rest';

export interface WreckState extends Point3 {
  phase: WreckPhase;
  /** A unit vector along the way it is going. */
  dx: number;
  dy: number;
  dz: number;
  /** Meters a second of the film. */
  speed: number;
}

export function createWreckState(): WreckState {
  return { x: 0, y: 0, z: 0, phase: 'fall', dx: 0, dy: 0, dz: 1, speed: 0 };
}

export interface WreckPath {
  /** Writes where the wreck is at `time`, and which way it is heading, into `out`. */
  at(time: number, out: WreckState): WreckState;
  /** The point where it first touches the ground. */
  readonly touchdown: Point3;
  /** The point where it rests. */
  readonly rest: Point3;
  /** The ground distance it ploughs, in meters. */
  readonly skidLength: number;
  /** The ground point at `distance` meters along the skid, with the unit direction there in `dir`. */
  alongSkid(distance: number, out: Point3, dir?: { x: number; z: number }): Point3;
}

/** How far out the fall begins, along the line it comes in on, in meters. */
const FALL_RANGE = 1500;
/** The slope of the fall near the ground, as height over distance: steep enough to clear the hills behind the furrow. */
const FALL_SLOPE = Math.tan((38 * Math.PI) / 180);
/**
 * How far to the left of its line (looking the way it flies) the fall begins, in meters. It comes
 * in on a curve and straightens onto the furrow, so that from the crater it sweeps across the sky
 * instead of coming straight down the line of sight.
 */
const FALL_SWING = 620;
/** How much steeper the fall is the farther out it begins, so its tail curves. */
const FALL_BEND = 0.00022;
/** How the distance left to fly shrinks as the fall goes on: above 1 it slows toward the ground. */
const FALL_EASE = 1.2;
/** How high the wreck's middle rides above the ground as it ploughs, in meters. */
const SKID_RIDE = 1.9;
/** How the skid slows: the speed falls away as `(1 - share) ** (SKID_EASE - 1)`. */
const SKID_EASE = 2.6;

export function createWreckPath(site: CrashSite, times: WreckTimes): WreckPath {
  // The skid runs from the far end of the furrow to its crater end, and on to the middle of the crater.
  const points: [number, number][] = [...site.furrow].reverse().map(([x, z]) => [x, z]);
  points.push([site.crater.x, site.crater.z]);
  const start = points[0] as [number, number];
  const next = points[1] as [number, number];
  const lengths: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as [number, number];
    const b = points[i] as [number, number];
    lengths.push((lengths[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const skidLength = lengths[lengths.length - 1] as number;

  const inX = next[0] - start[0];
  const inZ = next[1] - start[1];
  const inLength = Math.hypot(inX, inZ) || 1;
  const comeX = inX / inLength;
  const comeZ = inZ / inLength;
  const groundAtStart = site.groundAt(start[0], start[1]);

  const touchdown: Point3 = { x: start[0], y: groundAtStart + SKID_RIDE, z: start[1] };
  const restGround = site.groundAt(
    points[points.length - 1]?.[0] ?? 0,
    points[points.length - 1]?.[1] ?? 0,
  );
  const rest: Point3 = {
    x: site.crater.x,
    y: restGround + SKID_RIDE,
    z: site.crater.z,
  };

  const alongSkid = (distance: number, out: Point3, dir?: { x: number; z: number }): Point3 => {
    const d = Math.min(skidLength, Math.max(0, distance));
    let i = 1;
    while (i < lengths.length - 1 && (lengths[i] as number) < d) i++;
    const a = points[i - 1] as [number, number];
    const b = points[i] as [number, number];
    const segment = (lengths[i] as number) - (lengths[i - 1] as number);
    const u = segment > 0 ? (d - (lengths[i - 1] as number)) / segment : 0;
    out.x = a[0] + (b[0] - a[0]) * u;
    out.z = a[1] + (b[1] - a[1]) * u;
    out.y = site.groundAt(out.x, out.z);
    if (dir) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      dir.x = (b[0] - a[0]) / length;
      dir.z = (b[1] - a[1]) / length;
    }
    return out;
  };

  /** The place of the falling wreck when it still has `range` meters to fly along the ground. */
  const falling = (range: number, out: Point3): Point3 => {
    const swing = FALL_SWING * (range / FALL_RANGE) ** 2;
    out.x = start[0] - comeX * range + comeZ * swing;
    out.z = start[1] - comeZ * range - comeX * swing;
    out.y = groundAtStart + SKID_RIDE + range * FALL_SLOPE + range * range * FALL_BEND * 0.5;
    return out;
  };

  const a: Point3 = { x: 0, y: 0, z: 0 };
  const b: Point3 = { x: 0, y: 0, z: 0 };
  const dirScratch = { x: 0, z: 0 };

  const at = (time: number, out: WreckState): WreckState => {
    if (time < times.touchdown) {
      out.phase = 'fall';
      const left = (t: number): number => {
        const u = Math.min(1, Math.max(0, (t - times.appears) / (times.touchdown - times.appears)));
        return FALL_RANGE * (1 - u) ** FALL_EASE;
      };
      falling(left(time), out);
      // The way it is going, from where it will be a moment on.
      const step = 0.05;
      falling(left(time), a);
      falling(left(time + step), b);
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const vz = b.z - a.z;
      const length = Math.hypot(vx, vy, vz) || 1;
      out.dx = vx / length;
      out.dy = vy / length;
      out.dz = vz / length;
      out.speed = length / step;
      return out;
    }
    if (time < times.stop) {
      out.phase = 'skid';
      const share = (time - times.touchdown) / (times.stop - times.touchdown);
      // Fast at the touchdown and easing to rest: the share of the skid done by `share` of its time.
      const done = 1 - (1 - share) ** SKID_EASE;
      alongSkid(done * skidLength, out, dirScratch);
      out.y += SKID_RIDE;
      out.dx = dirScratch.x;
      out.dz = dirScratch.z;
      out.dy = 0;
      out.speed =
        (SKID_EASE * (1 - share) ** (SKID_EASE - 1) * skidLength) / (times.stop - times.touchdown);
      return out;
    }
    out.phase = 'rest';
    out.x = rest.x;
    out.y = rest.y;
    out.z = rest.z;
    out.dx = dirScratch.x;
    out.dz = dirScratch.z;
    out.dy = 0;
    out.speed = 0;
    return out;
  };

  // The heading at rest is the last way the skid went.
  alongSkid(skidLength, a, dirScratch);

  return { at, touchdown, rest, skidLength, alongSkid };
}
