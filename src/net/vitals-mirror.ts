import { createVitalsReading, type VitalsReading, type VitalsView } from '../shared/vitals-state';
import { handScaleFor, speedScaleFor } from '../systems/survival/vitals';

/**
 * A guest's copy of its own Health and Energy: what the host last said, held until the next word
 * arrives. The slowing that low Energy brings is worked out here from the points the host sent, by
 * the same rule the host uses, so every screen slows by the same amount. Until the first word
 * there is nothing to show, and the bars are drawn full.
 */
export class VitalsMirror implements VitalsView {
  private readonly held: VitalsReading = createVitalsReading();

  /** The host's latest word about this player. */
  apply(
    health: number,
    healthMax: number,
    energy: number,
    energyMax: number,
    charging: boolean,
    returnIn = 0,
    shaken = 0,
  ): void {
    const held = this.held;
    held.health = health;
    held.healthMax = healthMax;
    held.energy = energy;
    held.energyMax = energyMax;
    held.charging = charging;
    held.returnIn = returnIn;
    held.shaken = shaken;
    const fraction = energyMax > 0 ? energy / energyMax : 1;
    held.speedScale = speedScaleFor(fraction);
    held.handScale = handScaleFor(fraction);
  }

  /** The host started the run over: forget the last word, so the bars are full again until the new run's first one. */
  reset(): void {
    Object.assign(this.held, createVitalsReading());
  }

  read(out: VitalsReading): VitalsReading {
    const held = this.held;
    out.health = held.health;
    out.healthMax = held.healthMax;
    out.energy = held.energy;
    out.energyMax = held.energyMax;
    out.speedScale = held.speedScale;
    out.handScale = held.handScale;
    out.charging = held.charging;
    out.returnIn = held.returnIn;
    out.shaken = held.shaken;
    return out;
  }
}
