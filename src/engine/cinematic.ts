import type { CameraPose } from '../shared/camera-pose';

/**
 * Something that flies the camera for a while, such as the intro, in place of the player's view.
 * The game asks it for a pose every frame, keeps the player standing where they are, and takes the
 * camera back the moment it says it is done.
 */
export interface Cinematic {
  /**
   * Moves the cinematic on by `dt` seconds and writes where the camera is into `out`. `view` is
   * where the player's own camera would be this frame, which a cinematic flies to at its end so
   * that the hand-over is not a cut. Returns false once it is over (what it wrote this time is the
   * last frame shown).
   */
  update(dt: number, view: CameraPose, out: CameraPose): boolean;
  /** Called once when the cinematic stops, however it stops (it finished, was replaced or the game closed). */
  end(): void;
}
