import { Group } from 'three';
import type { CameraPose } from '../../shared/camera-pose';
import { skyStateAt, sunBearingAt, sunElevationAt } from '../../shared/daycycle';
import {
  INTRO_SECONDS,
  STOP_AT,
  TOUCHDOWN_AT,
  createIntroFrame,
  introFrameAt,
  introPhaseAt,
  sceneAt,
  smootherstep01,
  smoothstep01,
  type IntroFrame,
} from '../../shared/intro';
import {
  aimTrack,
  blendPose,
  createCrashFrame,
  createTrackSample,
  sampleTrack,
  shakePose,
  type CrashSite,
  type Point3,
} from '../../shared/intro-camera';
import { createWreckPath, createWreckState } from '../../shared/intro-wreck';
import type { Cinematic } from '../cinematic';
import type { Stage } from '../stage';
import type { IntroContext, IntroLayer } from './layer';
import { createLayers } from './layers';
import { TRACKS, shakeAt } from './tracks';

/** The valley as the film needs it: the crash site's shape and how to show what the crash made. */
export interface IntroSite extends CrashSite {
  /** Shows or hides what the crash brought (the Core, the heaps of wreckage), which did not stand there before it fell. */
  showWreck(shown: boolean): void;
}

/** How a film ended: it ran out, the player skipped it, or something else took the camera. */
export type IntroEnd = 'finished' | 'skipped' | 'cut';

/** What the film asks of its sound (`createIntroSound` in `sound.ts` is the real one). */
export interface IntroSoundPort {
  /** Tells it where the film is; called every frame the film plays. */
  update(filmTime: number): void;
  /** The film was skipped or cut: fade out over this many seconds. */
  fadeOut(seconds: number): void;
  /** The film ran to its end: let what is left ring out. */
  finish(): void;
}

/** What the film asks of its narrator (`createNarrator` in `narration.ts` is the real one). */
export interface IntroNarrationPort {
  /** Tells it where the film is; called every frame the film plays. */
  update(filmTime: number): void;
  /** The film was skipped or cut: whatever is being said stops now. */
  stop(): void;
  /** The film ran to its end: no more lines are begun, and the one being said is let finish. */
  finish(): void;
}

export interface IntroOptions {
  readonly stage: Stage;
  readonly site: IntroSite;
  /** Gets each frame of the overlay (bars, captions, flashes) as the film plays. */
  readonly onFrame: (frame: IntroFrame) => void;
  /** Called once, when the film stops. */
  readonly onEnd: (how: IntroEnd) => void;
  /** Holds the film at this many seconds instead of playing it: for pictures and tests. */
  readonly holdAt?: number | null;
  /** A calmer film for a player whose system asks for less motion: the camera does not shake (the overlay takes the flashes down itself). */
  readonly calm?: boolean;
  /** The film's music and sound effects, or null for a silent film (held films are, and so is a page with its sound off). */
  readonly sound?: IntroSoundPort | null;
  /** The voice that tells the film, or null for one with captions alone (held films have none, and nor does a page with its sound or its narration off). */
  readonly narration?: IntroNarrationPort | null;
}

export interface IntroPlayback extends Cinematic {
  /** Seconds into the film. */
  readonly time: number;
  /** True while the film is held at a moment instead of playing. */
  readonly held: boolean;
  /** Fades to black and ends the film. */
  skip(): void;
  /** Holds the film at `seconds`. */
  seek(seconds: number): void;
  /** Lets a held film play on. */
  play(): void;
}

/** A frame longer than this (a hidden tab, a shader compiling) is not time passing for the film. */
const MAX_STEP = 0.1;
/** Seconds the picture takes to go black when the film is skipped. */
const SKIP_FADE = 0.45;
/** The last seconds of the film fly the camera to where the player's own view is. */
const HANDOFF_SECONDS = 1.6;
/** Seconds the sound takes to fade when something else takes the camera (the mouse was let go of). */
const CUT_FADE = 0.25;

export function createIntro(options: IntroOptions): IntroPlayback {
  const { stage, site } = options;
  const frame = createCrashFrame(site);
  const wreck = createWreckPath(site, {
    appears: 0.4,
    touchdown: TOUCHDOWN_AT,
    stop: STOP_AT,
  });
  const context: IntroContext = { registry: stage.registry, frame, wreck };

  const group = new Group();
  group.name = 'intro';
  stage.world.add(group);
  const layers: IntroLayer[] = createLayers(context);
  for (const layer of layers) group.add(layer.object);
  // Every shader of the film is compiled now, while it opens out of black, so that none stalls a frame the first time something that uses it is drawn.
  stage.precompile(group).catch((error: unknown) => {
    console.error('The intro film could not prepare its shaders.', error);
  });

  const sample = createTrackSample();
  const scratch = { eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
  const filmPose: CameraPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  const subject = createWreckState();
  const overlay = createIntroFrame();

  let time = options.holdAt ?? 0;
  let held = options.holdAt != null;
  let skipping = false;
  let skipFade = 0;
  let ended: IntroEnd | null = null;
  let wreckShown = false;
  let soundFailed = false;
  let narrationFailed = false;

  site.showWreck(false);
  stage.setSkyOverride(() => {
    const phase = introPhaseAt(time);
    return skyStateAt(sunElevationAt(phase), sunBearingAt(phase));
  });

  // While it is hidden it is hidden again every frame, since some of it (the heaps) can arrive after the film has begun.
  const showWreck = (shown: boolean): void => {
    if (shown === wreckShown && shown) return;
    wreckShown = shown;
    site.showWreck(shown);
  };

  /** The sound is a courtesy: if it fails that is told once and the film goes on without it, and neither the picture nor the player's way into the game ever waits on it. */
  const tellSound = (tell: (sound: IntroSoundPort) => void): void => {
    if (!options.sound) return;
    try {
      tell(options.sound);
    } catch (error) {
      if (!soundFailed)
        console.error("The intro film's sound failed; the film goes on without it.", error);
      soundFailed = true;
    }
  };

  /** The same for the narrator: the captions tell the film without a voice, so a voice that fails is told once and the film goes on. */
  const tellNarration = (tell: (narration: IntroNarrationPort) => void): void => {
    if (!options.narration) return;
    try {
      tell(options.narration);
    } catch (error) {
      if (!narrationFailed)
        console.error("The intro film's narration failed; the film goes on without it.", error);
      narrationFailed = true;
    }
  };

  const subjectPoint: Point3 = subject;

  const intro: IntroPlayback = {
    get time() {
      return time;
    },
    get held() {
      return held;
    },
    skip() {
      if (skipping) return;
      skipping = true;
      // The sound fades with the picture, and the voice, which cannot fade, stops.
      tellSound((sound) => sound.fadeOut(SKIP_FADE));
      tellNarration((narration) => narration.stop());
    },
    seek(seconds) {
      time = Math.min(INTRO_SECONDS, Math.max(0, seconds));
      held = true;
    },
    play() {
      held = false;
    },

    update(dt, view, out) {
      const step = held ? 0 : Math.min(dt, MAX_STEP);
      time = Math.min(INTRO_SECONDS, time + step);
      if (skipping) skipFade = Math.min(1, skipFade + dt / SKIP_FADE);
      if (!held && !skipping && !soundFailed) tellSound((sound) => sound.update(time));
      if (!held && !skipping && !narrationFailed) {
        tellNarration((narration) => narration.update(time));
      }

      // What the crash made is not there until the wreck has come to rest in its crater.
      showWreck(time >= STOP_AT + 0.35);

      const scene = sceneAt(time);
      const local = time - scene.from;
      wreck.at(time, subject);
      sampleTrack(TRACKS[scene.name], local, sample);
      aimTrack(frame, sample, subjectPoint, scratch, filmPose);
      shakePose(filmPose, time, options.calm ? 0 : shakeAt(time, scene.name, local));

      // The last of the film flies the camera into the player's own view.
      const handoff = (time - (INTRO_SECONDS - HANDOFF_SECONDS)) / HANDOFF_SECONDS;
      if (handoff > 0) blendPose(filmPose, view, smootherstep01(handoff));
      out.x = filmPose.x;
      out.y = filmPose.y;
      out.z = filmPose.z;
      out.yaw = filmPose.yaw;
      out.pitch = filmPose.pitch;
      out.fov = filmPose.fov;
      out.roll = filmPose.roll;

      for (const layer of layers) layer.update(time, step);

      introFrameAt(time, overlay);
      if (skipping) overlay.black = Math.max(overlay.black, smoothstep01(skipFade));
      options.onFrame(overlay);

      if (skipping && skipFade >= 1) {
        ended = 'skipped';
        return false;
      }
      if (!held && time >= INTRO_SECONDS) {
        ended = 'finished';
        return false;
      }
      return true;
    },

    end() {
      stage.setSkyOverride(null);
      group.removeFromParent();
      for (const layer of layers) layer.dispose();
      site.showWreck(true);
      const how = ended ?? 'cut';
      // A film that ran out lets its last chord ring into the game, one that something cut fades at once, and a skipped one began to fade when it was skipped.
      if (how === 'finished') {
        tellSound((sound) => sound.finish());
        tellNarration((narration) => narration.finish());
      } else if (how === 'cut') {
        tellSound((sound) => sound.fadeOut(CUT_FADE));
        tellNarration((narration) => narration.stop());
      }
      options.onEnd(how);
    },
  };

  return intro;
}
