/** The clock and timers the sessions run on, so tests can drive them with virtual time. */
export interface Scheduler {
  /** Milliseconds on a monotonic clock. */
  now(): number;
  /** Calls `fn` every `ms` until the returned function is called. */
  every(ms: number, fn: () => void): () => void;
  /** Calls `fn` once after `ms` unless the returned function is called first. */
  after(ms: number, fn: () => void): () => void;
}

export const systemScheduler: Scheduler = {
  now: () => performance.now(),
  every(ms, fn) {
    const handle = setInterval(fn, ms);
    return () => clearInterval(handle);
  },
  after(ms, fn) {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};

interface Timer {
  id: number;
  due: number;
  fn: () => void;
  every: number | null;
}

/** Virtual time: nothing runs until `advance` moves the clock, and timers fire in due order. */
export class ManualScheduler implements Scheduler {
  private time = 0;
  private nextId = 1;
  private timers: Timer[] = [];

  now(): number {
    return this.time;
  }

  every(ms: number, fn: () => void): () => void {
    return this.add(ms, fn, ms);
  }

  after(ms: number, fn: () => void): () => void {
    return this.add(ms, fn, null);
  }

  private add(ms: number, fn: () => void, every: number | null): () => void {
    const timer: Timer = { id: this.nextId++, due: this.time + Math.max(0, ms), fn, every };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((t) => t.id !== timer.id);
    };
  }

  /** Runs everything due within the next `ms` milliseconds, moving the clock to each timer first. */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      let next: Timer | undefined;
      for (const timer of this.timers) {
        if (
          timer.due <= end &&
          (!next || timer.due < next.due || (timer.due === next.due && timer.id < next.id))
        ) {
          next = timer;
        }
      }
      if (!next) break;
      this.time = Math.max(this.time, next.due);
      if (next.every === null) this.timers = this.timers.filter((t) => t.id !== next.id);
      else next.due += Math.max(1, next.every);
      next.fn();
    }
    this.time = end;
  }

  /**
   * The page is blocked for `ms`: the clock moves and no timer runs. When it wakes, an interval
   * that fell due fires once and carries on from there, the way a browser's `setInterval` does.
   */
  stall(ms: number): void {
    this.time += ms;
    for (const timer of this.timers) {
      if (timer.every !== null && timer.due < this.time) timer.due = this.time;
    }
  }

  /** Number of timers waiting, for leak checks in tests. */
  get pending(): number {
    return this.timers.length;
  }
}
