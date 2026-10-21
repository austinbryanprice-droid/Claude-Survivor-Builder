/**
 * Named viewpoints over the valley: the camera poses that screenshots are taken from, the player's
 * starting spot, and the route the benchmark flies. Bearings are compass degrees (0 north, 90
 * east) because that is how a person thinks about a view; `shotPose` and the route turn them into
 * the yaw the rest of the game uses.
 */
import type { CameraPose, CameraRoute } from '../../shared/camera-pose';

export interface ShotPose {
  readonly x: number;
  readonly z: number;
  /** Eye height above the ground (or above the water where the ground is lower). */
  readonly height: number;
  /** Compass bearing in degrees: 0 north (-z), 90 east (+x). */
  readonly bearing: number;
  /** Degrees above the horizon. */
  readonly pitch: number;
  readonly fov?: number;
  /** Radius in meters kept free of trees around the camera; defaults to a trunk's width. */
  readonly clear?: number;
  /** Named moment from TIME_PRESETS to use unless the URL asks for another. */
  readonly time?: string;
  readonly note: string;
}

export const SHOTS: Readonly<Record<string, ShotPose>> = {
  // From the west bank across the lake into the low sun (references 01 and 02).
  lake: {
    x: 12,
    z: 7,
    height: 1.7,
    clear: 13,
    bearing: 92,
    pitch: 2,
    fov: 58,
    time: 'golden',
    note: 'Across the lake into the sun',
  },
  // From the western rim over the valley in the morning, mist pooled on the lake and at the
  // crash site (reference 07).
  valley: {
    x: -50,
    z: -6,
    height: 16,
    clear: 22,
    bearing: 78,
    pitch: -7,
    fov: 64,
    time: 'morning',
    note: 'Valley view with mist',
  },
  // High over the forest canopy toward the setting sun (reference 03).
  canopy: {
    x: -22,
    z: 46,
    height: 24,
    clear: 6,
    bearing: 60,
    pitch: -9,
    fov: 66,
    time: 'golden',
    note: 'Over the canopy',
  },
  // Back toward the crash site with the low sun to the right.
  crash: {
    x: 10,
    z: 16,
    height: 2,
    bearing: 332,
    pitch: 4,
    fov: 62,
    time: 'golden',
    note: 'Crash site at golden hour',
  },
  // Low, close and backlit: grass and trees against the sun.
  trail: {
    x: -14,
    z: 18,
    height: 1.25,
    bearing: 100,
    pitch: 8,
    fov: 60,
    time: 'golden',
    note: 'Backlit grass and trees',
  },
  // A big rock outcrop at the edge of the clearing, for the terrain mesher comparison.
  outcrop: {
    x: 28,
    z: -33,
    height: 3,
    clear: 11,
    bearing: 38,
    pitch: 9,
    fov: 62,
    time: 'afternoon',
    note: 'Rock outcrop',
  },
  noon: {
    x: 0,
    z: 20,
    height: 2.4,
    bearing: 20,
    pitch: -2,
    fov: 62,
    time: 'noon',
    note: 'High sun',
  },
  // The sun just above the western hills, sky going violet and the haze orange (reference 08).
  sunset: {
    x: 20,
    z: -24,
    height: 2.5,
    clear: 10,
    bearing: 262,
    pitch: 6,
    fov: 64,
    time: 'sunset',
    note: 'Sunset over the valley',
  },
  dusk: {
    x: 12,
    z: 7,
    height: 1.8,
    bearing: 95,
    pitch: 6,
    fov: 60,
    time: 'dusk',
    note: 'Dusk',
  },
  night: {
    x: 10,
    z: 10,
    height: 1.8,
    bearing: 70,
    pitch: 14,
    fov: 62,
    time: 'night',
    note: 'Night',
  },
};

/** The viewpoint the player starts at: on the west bank, looking across the lake into the low sun. */
export const SPAWN_SHOT = 'lake';

/** Waypoints for the benchmark and demo flythrough: x, z, height, bearing, pitch. */
export const FLY_PATH: readonly (readonly [number, number, number, number, number])[] = [
  [17, 4, 2, 92, 5],
  [-10, 22, 2.4, 80, 2],
  [-38, 30, 6, 60, -4],
  [-22, 46, 22, 40, -8],
  [10, 60, 12, 330, -5],
  [30, 30, 4, 20, 0],
  [24, 10, 2.2, 280, 3],
  [4, -6, 3, 250, 2],
  [17, 4, 2, 92, 5],
];

const RAD = Math.PI / 180;

/** Compass bearing in degrees to a yaw in radians: a bearing grows clockwise, a yaw counterclockwise. */
export function yawFromBearing(bearing: number): number {
  return -bearing * RAD;
}

/** Where a named shot puts the camera: its eye height above the ground at that spot. */
export function shotPose(shot: ShotPose, groundAt: (x: number, z: number) => number): CameraPose {
  const pose: CameraPose = {
    x: shot.x,
    y: groundAt(shot.x, shot.z) + shot.height,
    z: shot.z,
    yaw: yawFromBearing(shot.bearing),
    pitch: shot.pitch * RAD,
  };
  if (shot.fov !== undefined) pose.fov = shot.fov;
  return pose;
}

/** Field of view of the benchmark route, which the camera keeps whatever the player's setting is. */
export const ROUTE_FOV = 60;

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (p2 - p0) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (3 * p1 - p0 - 3 * p2 + p3) * t3)
  );
}

/** The route keeps its eye at least this far above the ground, which a hill between waypoints could otherwise break. */
const ROUTE_CLEARANCE = 1.2;
/** Over this height difference the lift off the ground fades in, so the camera does not kink. */
const ROUTE_BLEND = 0.8;

/** A maximum of two numbers with a rounded corner, so a path bends away from a floor instead of creasing. */
function smoothMax(a: number, b: number, blend: number): number {
  const h = Math.max(blend - Math.abs(a - b), 0) / blend;
  return Math.max(a, b) + (h * h * blend) / 4;
}

/**
 * The benchmark route: a smooth loop through `FLY_PATH`, at the height above the ground each
 * waypoint asks for. Between waypoints the camera never dips under the terrain: a hill that rises
 * between two low waypoints lifts the path over it. A fraction of 0 and a fraction of 1 are the
 * same spot.
 */
export function createFlyRoute(groundAt: (x: number, z: number) => number): CameraRoute {
  const count = FLY_PATH.length;
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const zs = new Float64Array(count);
  const bearings = new Float64Array(count);
  const pitches = new Float64Array(count);
  FLY_PATH.forEach(([x, z, height, bearing, pitch], i) => {
    xs[i] = x;
    ys[i] = groundAt(x, z) + height;
    zs[i] = z;
    bearings[i] = bearing;
    pitches[i] = pitch;
  });
  const last = count - 1;
  const at = (n: number): number => Math.min(last, Math.max(0, n));

  return {
    sample(fraction, out) {
      const u = (fraction - Math.floor(fraction)) * last;
      const i = Math.min(last - 1, Math.floor(u));
      const f = u - i;
      const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      out.x = catmull(xs[a] as number, xs[b] as number, xs[c] as number, xs[d] as number, f);
      out.z = catmull(zs[a] as number, zs[b] as number, zs[c] as number, zs[d] as number, f);
      const y = catmull(ys[a] as number, ys[b] as number, ys[c] as number, ys[d] as number, f);
      out.y = smoothMax(y, groundAt(out.x, out.z) + ROUTE_CLEARANCE, ROUTE_BLEND);
      // Bearings turn the short way round, and the look eases in and out between waypoints.
      let turn = (bearings[c] as number) - (bearings[b] as number);
      if (turn > 180) turn -= 360;
      if (turn < -180) turn += 360;
      const ease = f * f * (3 - 2 * f);
      out.yaw = yawFromBearing((bearings[b] as number) + turn * ease);
      out.pitch =
        ((pitches[b] as number) + ((pitches[c] as number) - (pitches[b] as number)) * ease) * RAD;
      out.fov = ROUTE_FOV;
      return out;
    },
  };
}
