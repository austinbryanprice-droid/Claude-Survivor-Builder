/**
 * Estimates how far another machine's clock is from ours, from the timestamps on its packets.
 *
 * Every packet's `local arrival - remote send time` is the clock offset plus the trip time, so
 * the smallest value seen lately is the offset plus the shortest trip. Using that minimum and
 * letting it move slowly keeps remote motion smooth: packets that were merely slow arrive late
 * relative to the timeline instead of dragging the timeline with them.
 */

const WINDOW_MS = 8000;
/** The estimate moves by at most this many milliseconds per packet, so a change glides in. */
const SLEW_MS_PER_SAMPLE = 0.5;
/** A disagreement bigger than this (a first guess, a long stall) is taken at once. */
const SNAP_MS = 250;

export class ClockSync {
  private readonly recent: { at: number; value: number }[] = [];
  private estimate = 0;
  private seen = false;

  /** True once at least one packet has been seen. */
  get ready(): boolean {
    return this.seen;
  }

  /** Our clock minus theirs, in milliseconds. */
  get offset(): number {
    return this.estimate;
  }

  /** Feeds one packet: our clock when it arrived and their clock when they sent it. */
  observe(localNow: number, remoteTime: number): void {
    const value = localNow - remoteTime;
    this.recent.push({ at: localNow, value });
    while (this.recent.length > 1 && localNow - (this.recent[0] as { at: number }).at > WINDOW_MS) {
      this.recent.shift();
    }
    let lowest = value;
    for (const entry of this.recent) if (entry.value < lowest) lowest = entry.value;

    if (!this.seen) {
      this.estimate = lowest;
      this.seen = true;
      return;
    }
    const gap = lowest - this.estimate;
    if (Math.abs(gap) > SNAP_MS) this.estimate = lowest;
    else this.estimate += Math.max(-SLEW_MS_PER_SAMPLE, Math.min(SLEW_MS_PER_SAMPLE, gap));
  }

  /** What their clock reads now, by our clock. */
  remoteNow(localNow: number): number {
    return localNow - this.estimate;
  }

  /** The moment on our clock that their timestamp stands for. */
  toLocal(remoteTime: number): number {
    return remoteTime + this.estimate;
  }
}
