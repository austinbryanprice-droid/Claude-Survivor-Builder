/**
 * Named viewpoints over the valley: the camera poses that screenshots are taken from, the player's
 * starting spot, and the route the benchmark flies. Bearings are compass degrees (0 north, 90
 * east) because that is how a person thinks about a view; `shotPose` and the route turn them into
 * the yaw the rest of the game uses.
 */
import type { CameraPose, CameraRoute } from '../../shared/camera-pose';
import { blendPose } from '../../shared/intro-camera';

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
  // From the south-east rim down into the crater at the Outpost Core, the low sun on its pylons.
  core: {
    x: 5.5,
    z: 2,
    height: 1.7,
    clear: 6,
    bearing: 308,
    pitch: -12,
    fov: 52,
    time: 'golden',
    note: 'The Outpost Core at golden hour',
  },
  // From the east side of the crater a few steps from the Core, with the low sun behind the
  // camera and full on its face.
  reactor: {
    x: 4.5,
    z: -3.5,
    height: 1.6,
    clear: 4,
    bearing: 270,
    pitch: -10,
    fov: 60,
    time: 'golden',
    note: 'Close to the Outpost Core',
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
  // South of the demo outpost, with the lake on the right and the afternoon sun raking its
  // south face (`?demo=outpost`).
  outpost: {
    x: -3,
    z: 27,
    height: 5,
    clear: 8,
    bearing: 8,
    pitch: -9,
    fov: 58,
    time: 'afternoon',
    note: 'The demo outpost',
  },
  // A few steps east of the outpost, with the golden-hour sun full on its gate (`?demo=outpost`).
  gate: {
    x: 14.5,
    z: 9,
    height: 3,
    clear: 7,
    bearing: 277,
    pitch: -3,
    fov: 56,
    time: 'golden',
    note: 'The outpost gate at golden hour',
  },
  // South of the gabled hall, a little to the west so the low sun rakes its front (`?demo=hall`).
  hall: {
    x: -2,
    z: 25,
    height: 3.2,
    clear: 9,
    bearing: 4,
    pitch: -4,
    fov: 58,
    time: 'golden',
    note: 'The gabled hall',
  },
  // From the south-west, the whole hall with its roof, eaves and lamp posts (`?demo=hall`).
  hallside: {
    x: -11,
    z: 22,
    height: 3.6,
    clear: 9,
    bearing: 39,
    pitch: -6,
    fov: 58,
    time: 'golden',
    note: 'The hall from the south-west',
  },
  // Close to the south-east corner of the roof, looking along the eaves and the wedges (`?demo=hall`).
  eaves: {
    x: 8.5,
    z: 16.5,
    height: 4.2,
    clear: 9,
    bearing: 315,
    pitch: -12,
    fov: 60,
    time: 'golden',
    note: 'The roof and eaves of the hall',
  },
  // In front of the four material swatches (`?demo=swatch`): Scrap, Composite, Alloy, Energy.
  swatch: {
    x: 8,
    z: 31,
    height: 2.6,
    clear: 9,
    bearing: 0,
    pitch: -4,
    fov: 56,
    time: 'afternoon',
    note: 'The four material tiers',
  },
  // A few steps from the Alloy swatch, to see its chamfers, grooves and ambient occlusion (`?demo=swatch`).
  closeup: {
    x: 9.6,
    z: 22.5,
    height: 1.7,
    clear: 9,
    bearing: 0,
    pitch: -3,
    fov: 56,
    time: 'afternoon',
    note: 'Block close-up',
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

/**
 * The two views the title screen's camera drifts between: low over the valley with the crash site
 * below and the sun ahead, and high over the western forest with the lake, the whole valley and
 * the mountains in the picture. They are not named shots, since a named shot keeps the trees clear
 * around it and nobody photographs from these.
 */
export const TITLE_VIEWS: readonly [ShotPose, ShotPose] = [
  {
    x: -26,
    z: 30,
    height: 15,
    bearing: 66,
    pitch: -7,
    fov: 64,
    note: 'The title screen opens here, over the crash site',
  },
  {
    x: -34,
    z: 52,
    height: 26,
    bearing: 60,
    pitch: -11,
    fov: 68,
    note: 'and drifts up and back to here, over the whole valley',
  },
];

/** The title route keeps its eye at least this far above the ground, which a hill between its two views could otherwise break. */
const TITLE_CLEARANCE = 6;

/** The title camera's path: `sample(0)` is the first view and `sample(1)` the second, a straight glide from one to the other. */
export function createTitleRoute(groundAt: (x: number, z: number) => number): CameraRoute {
  const [from, to] = [shotPose(TITLE_VIEWS[0], groundAt), shotPose(TITLE_VIEWS[1], groundAt)];
  return {
    sample(fraction, out) {
      Object.assign(out, from);
      out.roll = 0;
      blendPose(out, to, fraction);
      out.y = smoothMax(out.y, groundAt(out.x, out.z) + TITLE_CLEARANCE, ROUTE_BLEND);
      return out;
    },
  };
}
