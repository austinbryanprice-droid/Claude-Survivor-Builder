import {
  SIM_HZ,
  readClock,
  type SurvivalEvent,
  type SurvivalReading,
  type SurvivalView,
  type Unsubscribe,
} from '../shared/survival-state';
import { Emitter } from './emitter';
import type { Scheduler } from './scheduler';

/** The mirror carries the host's last word forward for at most this long, however quiet the host goes. */
const MAX_CARRY_SECONDS = 3;
/** A clock that would read less than this far behind what was shown a moment ago is held, not rewound. */
const REWIND_FORGIVEN_SECONDS = 1;

/**
 * A guest's copy of the survival loop: what the host last said about the clock, carried forward on
 * the guest's own timer until the next word arrives, and the events the host announces. The
 * screen reads it exactly as the host reads the simulation.
 */
export class SurvivalMirror implements SurvivalView {
  private base = 0;
  private at = 0;
  private running = false;
  private coreHealth = 0;
  private coreMax = 0;
  private over = false;
  private shown = 0;
  private readonly events = new Emitter<SurvivalEvent>();

  constructor(private readonly scheduler: Scheduler) {}

  /** The host's step count, whether its clock runs, and the Core's health and fall, as of now. */
  apply(tick: number, running: boolean, coreHealth: number, coreMax: number, over: boolean): void {
    this.base = tick / SIM_HZ;
    this.at = this.scheduler.now();
    this.running = running;
    this.coreHealth = coreHealth;
    this.coreMax = coreMax;
    this.over = over;
  }

  announce(event: SurvivalEvent): void {
    this.events.emit(event);
  }

  read(out: SurvivalReading): SurvivalReading {
    let elapsed = this.base;
    if (this.running) {
      const carried = (this.scheduler.now() - this.at) / 1000;
      elapsed += Math.min(MAX_CARRY_SECONDS, Math.max(0, carried));
    }
    // The host's word and our own timer disagree by a few milliseconds either way; a countdown
    // that ticks 5:13, 5:14, 5:13 looks broken, so small rewinds are held at what was shown.
    if (elapsed < this.shown && this.shown - elapsed < REWIND_FORGIVEN_SECONDS) {
      elapsed = this.shown;
    }
    this.shown = elapsed;
    readClock(elapsed, out);
    out.running = this.running;
    out.coreHealth = this.coreHealth;
    out.coreMax = this.coreMax;
    out.over = this.over;
    return out;
  }

  onEvent(listener: (event: SurvivalEvent) => void): Unsubscribe {
    return this.events.on(listener);
  }
}
