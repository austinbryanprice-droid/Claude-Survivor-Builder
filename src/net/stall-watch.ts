import { NET } from '../shared/net-config';

/**
 * Notices when this page's own thread was blocked. A tick that should run every `everyMs` runs
 * late when the page was busy (a long script, a heavy frame, a suspended tab), and the packets
 * that arrived meanwhile are read only after it. Silence that overlapped the stall says nothing
 * about the other side, so a session forgives it instead of declaring the host or a guest lost.
 * A background tab's timer, slowed to one tick a second, is late by less than `NET.stallMs` and
 * is not a stall: a link that really died is still noticed on time.
 */
export class StallWatch {
  private last: number;

  constructor(
    private readonly everyMs: number,
    now: number,
  ) {
    this.last = now;
  }

  /** Call at the start of every tick. Returns how long the page was blocked (0 when the tick ran about on time). */
  lateBy(now: number): number {
    const late = now - this.last - this.everyMs;
    this.last = now;
    return late > NET.stallMs ? late : 0;
  }
}
