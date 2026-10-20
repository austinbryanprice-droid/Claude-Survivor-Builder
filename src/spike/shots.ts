/** Named camera poses for screenshots, the benchmark path and the demo. Throwaway with the spike. */

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

export const DEFAULT_SHOT = 'lake';

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
