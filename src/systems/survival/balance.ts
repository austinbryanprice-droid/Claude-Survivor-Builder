/**
 * Every number that shapes the survival loop, in one table so it can be tuned and tested without
 * hunting through the code. The length of the day and the night is not here: it is
 * `DAY_SECONDS` and `NIGHT_SECONDS` in `shared/daycycle.ts`, because the sky reads it too
 * (8 minutes of day and 4 of night, see docs/decisions.md).
 */
export const SURVIVAL = {
  /**
   * A host whose page was blocked or throttled (a hidden tab) catches up by at most this much game
   * time in one go. A longer gap is lost, not replayed: nobody wants a night to fly by in the
   * second a tab comes back.
   */
  maxCatchUpSeconds: 2,
} as const;
