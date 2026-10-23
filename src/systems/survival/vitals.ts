import { MOVEMENT, PLAYER } from '../../shared/movement';
import type { VitalsReading } from '../../shared/vitals-state';
import { outpostDistance, type Outpost } from '../../world/outpost';
import { VITALS } from './balance';

/** How low Energy is: 0 while it is not low, rising to 1 with none left. */
function lowness(fraction: number): number {
  const lowAt = VITALS.energy.lowAt;
  if (!(fraction < lowAt)) return 0;
  return 1 - Math.max(0, fraction) / lowAt;
}

/** Walking and sprinting speed for a fraction of a full Energy bar, as a fraction of normal. */
export function speedScaleFor(fraction: number): number {
  return 1 - lowness(fraction) * (1 - VITALS.energy.emptySpeed);
}

/** How fast the hands repeat a held click for a fraction of a full Energy bar, as a fraction of normal. */
export function handScaleFor(fraction: number): number {
  return 1 - lowness(fraction) * (1 - VITALS.energy.emptyHands);
}

/** A player on the ground moving faster than this many times their walking speed is sprinting. */
const SPRINT_FACTOR = 1.1;

/**
 * One player's Health and Energy, as the host keeps them. Pure and stepped by the survival
 * simulation, so it runs the same under a Worker, a test and the browser.
 *
 * Energy is the hunger analog: it drains slowly all the time, faster while sprinting, fighting
 * and building, and refills inside the Core's charge field. Health mends by itself a while after
 * the last wound, as long as there is some Energy left. Both are kept as fractions of a point;
 * what is read out is whole points, and 0 only when a bar is truly empty.
 */
export class PlayerVitals {
  private healthPoints: number = VITALS.maxHealth;
  private energyPoints: number = VITALS.maxEnergy;
  private inField = false;
  /** Seconds since the last wound. */
  private sinceHurt = Infinity;

  // What the host last saw of the player. Until it has seen them they are not sprinting and not at the Core.
  private placed = false;
  private x = 0;
  private y = 0;
  private z = 0;
  private speed = 0;
  private onGround = true;

  get health(): number {
    return Math.ceil(this.healthPoints);
  }

  get energy(): number {
    return Math.ceil(this.energyPoints);
  }

  /** True while the player stands within the Core's charge field. */
  get charging(): boolean {
    return this.inField;
  }

  /** True while the player has Health left: someone at none is down, and the machines leave them be. */
  get alive(): boolean {
    return this.healthPoints > 0;
  }

  /**
   * Writes where the player's feet were when the host last saw them into `out`. False before the
   * host has seen them at all, which leaves `out` as it was.
   */
  position(out: { x: number; y: number; z: number }): boolean {
    if (!this.placed) return false;
    out.x = this.x;
    out.y = this.y;
    out.z = this.z;
    return true;
  }

  /** Where the player is and how fast they cross the ground (blocks per second), as the host last saw them. */
  observe(x: number, y: number, z: number, speed: number, onGround: boolean): void {
    this.placed = true;
    this.x = x;
    this.y = y;
    this.z = z;
    this.speed = speed;
    this.onGround = onGround;
  }

  /** Wounds the player and returns the points it took: 0 for a blow that is not a positive number. */
  hurt(amount: number): number {
    if (!(amount > 0) || this.healthPoints <= 0) return 0;
    const taken = Math.min(this.healthPoints, amount);
    this.healthPoints -= taken;
    this.sinceHurt = 0;
    return taken;
  }

  /** Spends Energy on something the player did (a block placed, a shot fired). It cannot go below nothing. */
  spend(amount: number): void {
    if (!(amount > 0)) return;
    this.energyPoints = Math.max(0, this.energyPoints - amount);
  }

  /** Sets the meters outright, for tests and the debug page. A missing value is left as it is. */
  set(values: { health?: number; energy?: number }): void {
    if (values.health !== undefined) {
      this.healthPoints = Math.min(VITALS.maxHealth, Math.max(0, values.health));
    }
    if (values.energy !== undefined) {
      this.energyPoints = Math.min(VITALS.maxEnergy, Math.max(0, values.energy));
    }
  }

  /**
   * Plays `dt` seconds. `core` is the Outpost Core while it stands, or null where there is none
   * (or it has fallen), and its field is then not there to charge anyone.
   */
  step(dt: number, core: Outpost | null): void {
    const energy = VITALS.energy;
    this.sinceHurt += dt;

    const scale = speedScaleFor(this.energy / VITALS.maxEnergy);
    let drain = energy.idlePerSecond;
    if (this.placed && this.onGround && this.speed > MOVEMENT.walkSpeed * scale * SPRINT_FACTOR) {
      drain += energy.sprintPerSecond;
    }
    if (this.sinceHurt < energy.combatSeconds) drain += energy.combatPerSecond;

    this.inField =
      core !== null &&
      this.placed &&
      outpostDistance(core, this.x, this.y + PLAYER.height / 2, this.z) <=
        VITALS.chargeField.radius;
    const charge = this.inField ? VITALS.chargeField.perSecond : 0;
    this.energyPoints = Math.min(
      VITALS.maxEnergy,
      Math.max(0, this.energyPoints + (charge - drain) * dt),
    );

    if (
      this.healthPoints > 0 &&
      this.healthPoints < VITALS.maxHealth &&
      this.sinceHurt >= VITALS.regenDelay &&
      this.energyPoints > 0
    ) {
      this.healthPoints = Math.min(
        VITALS.maxHealth,
        this.healthPoints + VITALS.regenPerSecond * dt,
      );
    }
  }

  /** Fills `out` with the meters, and what the Energy does to the player's speed and hands. */
  read(out: VitalsReading): VitalsReading {
    // The effects follow the whole points a guest is told, so every screen slows by the same amount.
    const fraction = this.energy / VITALS.maxEnergy;
    out.health = this.health;
    out.healthMax = VITALS.maxHealth;
    out.energy = this.energy;
    out.energyMax = VITALS.maxEnergy;
    out.speedScale = speedScaleFor(fraction);
    out.handScale = handScaleFor(fraction);
    out.charging = this.inField;
    return out;
  }
}
