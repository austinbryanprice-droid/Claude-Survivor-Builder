import type { CameraKey } from '../../shared/intro-camera';
import type { SceneName } from '../../shared/intro';

/**
 * The camera of each scene of the film, as keys in the crash site's own terms (forward along the
 * wreck's last run, to its right, and above the ground; see `shared/intro-camera.ts`). Times are
 * seconds into the scene. The crater is the origin and the far end of the furrow, where the wreck
 * first touches down, is about 53 meters back along it.
 */
export const TRACKS: Readonly<Record<SceneName, readonly CameraKey[]>> = {
  // From the edge of the clearing where the player will stand, looking up the sky the wreck swings in across.
  skyfall: [
    { t: 0, at: [21, 10, 2.4], look: [-600, -110, 250], fov: 56 },
    { t: 4.5, at: [17, 9, 2.4], look: [-420, -50, 160], fov: 52, follow: 0.45 },
    { t: 7.2, at: [13, 8, 2.2], look: [-120, -8, 40], fov: 48, follow: 0.85 },
    { t: 8, at: [12, 8, 2.2], look: [-53, 0, 10], fov: 46, follow: 1 },
  ],
  // The cut at the flash puts the camera low beside the clearing's edge, and it pans with the wreck as it bursts out of the trees and slides into the crater.
  skid: [
    { t: 0, at: [-14, 17, 1.6], look: [-36, 0, 4], fov: 52, follow: 0.5 },
    { t: 1.6, at: [-10, 17, 1.5], look: [-18, 0, 2], fov: 50, follow: 1 },
    { t: 4.4, at: [-2, 17, 1.7], look: [0, 0, 2], fov: 50, follow: 1 },
    { t: 6.5, at: [3, 15, 2.8], look: [0, 0, 4], fov: 52 },
  ],
  // The crater at nightfall, the Core standing in the settling dust: seen first from above the grass of the rim, then the camera settles toward it.
  crater: [
    { t: 0, at: [22, -16, 6.5], look: [0, 0, 2.4], fov: 54 },
    { t: 3.5, at: [17, -12.5, 4.2], look: [0, 0, 3], fov: 50 },
    { t: 8, at: [11, -9, 2.4], look: [0, 0, 3.2], fov: 46 },
  ],
  // Low on the crater floor, looking out across it into the dark where the machines of the wreck wake: the Core is at the left of the frame at first, and the camera drifts on past it.
  eyes: [
    { t: 0, at: [-3.5, 7.5, 1.2], look: [9, -2, 1], fov: 48 },
    { t: 7, at: [2, 5, 1.3], look: [10, -3, 1], fov: 42 },
  ],
  // Up from the crater and out over the valley as the sun rises across the lake.
  dawn: [
    { t: 0, at: [6, 8, 3], look: [-2, 0, 3], fov: 55 },
    { t: 4.5, at: [30, 40, 22], look: [80, -20, 15], fov: 58 },
    { t: 8.5, at: [34, 8, 12], look: [80, -20, 6], fov: 60 },
  ],
  // Down from the sky to where the player stands, straight over the clearing, ending at the player's own view.
  wake: [
    { t: 0, at: [18, 0.6, 13], look: [70, -20, 3], fov: 58 },
    { t: 3.4, at: [18, 0.6, 5.5], look: [66, -20, 3.5], fov: 62 },
    { t: 5.5, at: [18, 0.6, 1.7], look: [60, -20, 4], fov: 70 },
  ],
};

/** How much the camera shakes, in meters, at `time` seconds of the film. */
export function shakeAt(time: number, scene: SceneName, seconds: number): number {
  void time;
  if (scene === 'skid') return seconds < 4.4 ? 0.35 : 0.12;
  if (scene === 'skyfall') return Math.max(0, (seconds - 5.5) / 2.5) * 0.18;
  return 0;
}
