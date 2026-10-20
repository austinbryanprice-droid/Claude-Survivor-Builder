/** The simulation runs at a fixed rate and rendering interpolates between its last two states. */
export const TICK_RATE = 60;
export const TICK_SECONDS = 1 / TICK_RATE;

export interface FixedStepperOptions {
  tickSeconds?: number;
  /** Longest frame that counts. A frame that took longer (a hidden tab, a breakpoint) is cut to this. */
  maxFrameSeconds?: number;
  /** Most ticks run for one frame. Beyond this the simulation drops time instead of spiraling. */
  maxTicksPerFrame?: number;
}

export interface FixedStepper {
  /** Adds a frame's duration and returns how many ticks to run for it. */
  advance(frameSeconds: number): number;
  /** How far the next tick is along, in [0, 1). Rendering uses it to blend the last two states. */
  readonly alpha: number;
  reset(): void;
}

export function createFixedStepper(options: FixedStepperOptions = {}): FixedStepper {
  const tickSeconds = options.tickSeconds ?? TICK_SECONDS;
  const maxFrameSeconds = options.maxFrameSeconds ?? 0.25;
  const maxTicksPerFrame = options.maxTicksPerFrame ?? 5;
  let accumulator = 0;

  return {
    advance(frameSeconds) {
      if (frameSeconds > 0) accumulator += Math.min(frameSeconds, maxFrameSeconds);
      let ticks = Math.floor(accumulator / tickSeconds);
      if (ticks > maxTicksPerFrame) {
        ticks = maxTicksPerFrame;
        accumulator = 0;
      } else {
        accumulator -= ticks * tickSeconds;
      }
      return ticks;
    },
    get alpha() {
      return Math.min(1, Math.max(0, accumulator / tickSeconds));
    },
    reset() {
      accumulator = 0;
    },
  };
}
