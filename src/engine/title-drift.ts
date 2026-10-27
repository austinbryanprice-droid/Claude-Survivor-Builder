import type { CameraRoute } from '../shared/camera-pose';
import { smootherstep01 } from '../shared/intro';
import { blendPose } from '../shared/intro-camera';
import { driftShare } from '../shared/title';
import type { Cinematic } from './cinematic';

export interface TitleDriftOptions {
  /** The path the camera drifts along: `sample(0)` is where the screen opens. */
  readonly route: CameraRoute;
  /** True holds the camera where its path begins, for a player whose system asks for less motion. */
  readonly calm: boolean;
  /** Called once when the drift stops, however it stops: it glided into the run, the film took the camera, or the game closed. */
  readonly onEnd: () => void;
}

/**
 * The camera of the title screen: it drifts slowly along its path over the live valley, to and
 * fro, until the player presses Play. If no film follows, `glide` flies it into the player's own
 * view and the drift is over when it gets there, so the run begins with no cut.
 */
export interface TitleDrift extends Cinematic {
  /** Seconds the camera has been drifting. */
  readonly seconds: number;
  /** True from `glide` until the drift ends. */
  readonly gliding: boolean;
  /** Starts flying into the player's view over `span` seconds; the drift is over when it gets there. */
  glide(span: number): void;
}

export function createTitleDrift({ route, calm, onEnd }: TitleDriftOptions): TitleDrift {
  let seconds = 0;
  let span = 0;
  let glided = 0;
  let ended = false;

  return {
    get seconds() {
      return seconds;
    },
    get gliding() {
      return span > 0;
    },
    glide(next) {
      if (span > 0) return;
      span = Math.max(1e-3, next);
      glided = 0;
    },
    update(dt, view, out) {
      seconds += dt;
      route.sample(calm ? 0 : driftShare(seconds), out);
      if (span === 0) return true;
      // The drift carries on under the glide, so the camera never stops before it sets off for the player's view.
      glided += dt;
      blendPose(out, view, smootherstep01(glided / span));
      return glided < span;
    },
    end() {
      if (ended) return;
      ended = true;
      onEnd();
    },
  };
}
