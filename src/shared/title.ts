/**
 * The title screen: the page the game opens on, with the valley behind the name and one large Play
 * button. Pure data and arithmetic, so the camera that drifts over the valley, the screen that
 * says the words and the tests all read one table. What follows Play is the intro film, or, for a
 * player who has turned the film off, a glide from the title's view into the run.
 */
import { INTRO_TITLE } from './intro';

/** What the URL says about the title screen. */
export type TitleMode = 'auto' | 'on' | 'off';

export const TITLE = {
  name: INTRO_TITLE.title,
  tagline: INTRO_TITLE.subtitle,
  play: 'Play',
  /** Seconds the camera takes to go along its path and back, slowing to a stop at each end. */
  driftSeconds: 96,
  /** Seconds the screen takes to fade to black after Play, before the film opens out of black. */
  leadSeconds: 0.7,
  /** Seconds the camera takes to fly into the player's view when no film follows. */
  glideSeconds: 1.8,
  /** Seconds the screen waits in black for the film's code, after the fade, before it glides into the run without the film. */
  filmWaitSeconds: 5,
} as const;

/**
 * How far along its path the title's camera is `seconds` after the screen came up: 0 at the start,
 * 1 at the far end half a period later, and back again, with no jerk at either end.
 */
export function driftShare(seconds: number, period: number = TITLE.driftSeconds): number {
  return 0.5 - 0.5 * Math.cos((seconds / period) * Math.PI * 2);
}

/** The things that decide whether the page opens on the title screen. */
export interface TitleWish {
  /** `?title=on` shows it whatever else is going on and `?title=off` never does. */
  readonly mode: TitleMode;
  /** The browser is driven by a script or a test, which a screen that waits for a click would only hold up. */
  readonly automated: boolean;
  /** The URL asks for something other than the plain start: a room to join, a debug switch, a viewpoint, a held moment of the film, a benchmark, no HUD. */
  readonly custom: boolean;
}

/** Whether the page opens on the title screen: every plain start does, for a person at the keyboard. */
export function titleWanted({ mode, automated, custom }: TitleWish): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return !automated && !custom;
}
