/**
 * What a player's own meters look like from outside: Health and Energy, and what low Energy does
 * to how fast they move and work. Pure types, so the host's simulation, a guest's mirror and the
 * HUD read the same numbers the same way (the run's clock and the Outpost Core are in
 * `survival-state.ts`).
 */

/**
 * The local player's meters, read once a frame. The object is reused from call to call, so read
 * what you need and do not keep it. Points are whole numbers; a bar is empty only at 0.
 */
export interface VitalsReading {
  health: number;
  /** Full health. 0 where there is nothing to show, which draws full bars. */
  healthMax: number;
  energy: number;
  energyMax: number;
  /** Walking and sprinting speed as a fraction of normal: 1 until Energy runs low. */
  speedScale: number;
  /** How fast the hands repeat a held click, as a fraction of normal: 1 until Energy runs low. */
  handScale: number;
  /** True while the Core's charge field is restoring Energy. */
  charging: boolean;
  /**
   * Whole seconds until the Core brings a downed player back, counting down; 0 for a player who is
   * up, and for one who is down with no respawn charge to spend, who waits for the dawn.
   */
  returnIn: number;
  /** Whole seconds a player who has just come back stays shaken; 0 when they are not. */
  shaken: number;
}

export function createVitalsReading(): VitalsReading {
  return {
    health: 0,
    healthMax: 0,
    energy: 0,
    energyMax: 0,
    speedScale: 1,
    handScale: 1,
    charging: false,
    returnIn: 0,
    shaken: 0,
  };
}

/** True when the meters say the player is down: they have a Health bar and none is left in it. */
export function isDown(reading: Pick<VitalsReading, 'health' | 'healthMax'>): boolean {
  return reading.healthMax > 0 && reading.health <= 0;
}

/**
 * The player's meters as a screen sees them. The host reads its own player straight from the
 * simulation and a guest reads the mirror of what the host last said; the screen cannot tell which.
 */
export interface VitalsView {
  /** Fills `out` with the local player's meters as they stand now and returns it. */
  read(out: VitalsReading): VitalsReading;
}
