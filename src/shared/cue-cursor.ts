/**
 * A cursor over a score: things that start at a given second, handed out once each and in order as
 * the clock reaches them. The audio side asks for everything due before the clock plus a short
 * lookahead, so that the sound is queued ahead of the picture rather than behind it.
 */

export interface Timed {
  /** Seconds from the start of the score at which this begins. */
  readonly at: number;
}

export interface CueCursor<T extends Timed> {
  /** Calls `visit` for every cue not yet taken that starts at or before `until`, in order, and marks them taken. */
  take(until: number, visit: (cue: T) => void): void;
  /** Marks every cue that starts at or before `until` as taken without handing it out. */
  skip(until: number): void;
  /** How many cues are still to come. */
  readonly remaining: number;
}

/** A cursor over `cues`, which need not be sorted. */
export function createCueCursor<T extends Timed>(cues: readonly T[]): CueCursor<T> {
  const ordered = [...cues].sort((a, b) => a.at - b.at);
  let next = 0;
  return {
    take(until, visit) {
      while (next < ordered.length && (ordered[next] as T).at <= until) {
        visit(ordered[next] as T);
        next++;
      }
    },
    skip(until) {
      while (next < ordered.length && (ordered[next] as T).at <= until) next++;
    },
    get remaining() {
      return ordered.length - next;
    },
  };
}
