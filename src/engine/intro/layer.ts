import type { Object3D } from 'three';
import type { CrashFrame } from '../../shared/intro-camera';
import type { WreckPath } from '../../shared/intro-wreck';
import type { MaterialRegistry } from '../materials';

/** What a layer of the intro's picture is built from. */
export interface IntroContext {
  readonly registry: MaterialRegistry;
  readonly frame: CrashFrame;
  readonly wreck: WreckPath;
}

/**
 * One part of the intro's picture (the falling wreck, the dust of its skid, the embers over the
 * crater, the eyes in the dark). A layer draws whatever the film's clock says, so that the film can be
 * held at any moment for a picture or a test.
 */
export interface IntroLayer {
  readonly object: Object3D;
  /** Puts the layer as it is `time` seconds into the film; `dt` is the real time since the last call (0 while the film is held). */
  update(time: number, dt: number): void;
  dispose(): void;
}
