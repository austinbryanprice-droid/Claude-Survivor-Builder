import { MOVEMENT, PLAYER } from '../../shared/movement';
import type { VitalsReading } from '../../shared/vitals-state';
import { outpostDistance, type Outpost } from '../../world/outpost';
import { BLASTER, RESPAWN, VITALS } from './balance';
import type { ChargeSource } from './power';

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
/** Shots are counted in fractions of a shot; this close to a whole one is a whole one. */
const SHOT_EPSILON = 1e-6;
/** Seconds are counted in steps of a twentieth; this close to a whole one is a whole one. */
const SECOND_EPSILON = 1e-6;

/**
 * One player's Health and Energy, as the host keeps them. Pure and stepped by the survival
 * simulation, so it runs the same under a Worker, a test and the browser.
 *
 * Energy is the hunger analog: it drains slowly all the time, faster while sprinting, fighting
 * and building, and refills inside a charge field (the Core's, or a standing Generator's). Health mends by itself a while after
 * the last wound, as long as there is some Energy left. Both are kept as fractions of a point;
 * what is read out is whole points, and 0 only when a bar is truly empty.
 *
 * A player at no Health is down: nothing else about them changes while they lie there, and the
 * simulation brings them back with `revive` when the crew has a respawn charge to spend. They come
 * back shaken for a while, which drains their Energy faster and softens the blaster.
 */
export class PlayerVitals {
  private healthPoints: number = VITALS.maxHealth;
  private energyPoints: number = VITALS.maxEnergy;
  private inField = false;
  /** Seconds since the last wound. */
  private sinceHurt = Infinity;
  /** Seconds since the player went down, or -1 while they are up. */
  private downFor = -1;
  /** Seconds the player stays shaken after coming back. */
  private shakenLeft = 0;

  /** Shots the blaster has ready: a full burst to begin with, one spent on each shot and won back as the hands allow. */
  private shots: number = BLASTER.burst;

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

  /** True while the player stands within a charge field: the Core's, or a Generator's. */
  get charging(): boolean {
    return this.inField;
  }

  /** True while the player has Health left: someone at none is down, and the machines leave them be. */
  get alive(): boolean {
    return this.healthPoints > 0;
  }

  /** Seconds the player has lain down, counted from the moment they fell; -1 while they are up. */
  get downSeconds(): number {
    return this.downFor;
  }

  /** Whole seconds the player stays shaken after coming back; 0 when they are not. */
  get shaken(): number {
    return Math.max(0, Math.ceil(this.shakenLeft - SECOND_EPSILON));
  }

  /** How much of its damage the player's blaster does now: all of it, until they are shaken. */
  get damageScale(): number {
    return this.shakenLeft > 0 ? RESPAWN.shaken.damageScale : 1;
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
    if (this.healthPoints <= 0) this.fall();
    return taken;
  }

  /** The player has no Health left: the clock of lying down starts, and whatever shook them is forgotten. */
  private fall(): void {
    this.downFor = 0;
    this.shakenLeft = 0;
  }

  /**
   * Brings a downed player back at the base: Health full, Energy part of a bar, the blaster ready
   * again, and shaken for a while.
   */
  revive(): void {
    this.healthPoints = VITALS.maxHealth;
    this.energyPoints = VITALS.maxEnergy * RESPAWN.energy;
    this.shots = BLASTER.burst;
    this.sinceHurt = Infinity;
    this.downFor = -1;
    this.shakenLeft = RESPAWN.shaken.seconds;
    this.inField = false;
  }

  /** Spends Energy on something the player did (a block placed, a shot fired). It cannot go below nothing. */
  spend(amount: number): void {
    if (!(amount > 0)) return;
    this.energyPoints = Math.max(0, this.energyPoints - amount);
  }

  /**
   * Whether the blaster may fire now, and if so one shot is spent. The blaster is ready again
   * `BLASTER.interval` seconds after a shot, later the lower the Energy (low Energy slows the
   * hands), and up to `BLASTER.burst` shots are kept, so two that were held up on the way both land.
   */
  takeShot(): boolean {
    if (this.shots < 1 - SHOT_EPSILON) return false;
    this.shots = Math.max(0, this.shots - 1);
    return true;
  }

  /** Sets the meters outright, for tests and the debug page. A missing value is left as it is. */
  set(values: { health?: number; energy?: number }): void {
    if (values.health !== undefined) {
      this.healthPoints = Math.min(VITALS.maxHealth, Math.max(0, values.health));
      if (this.healthPoints > 0) this.downFor = -1;
      else if (this.downFor < 0) this.fall();
    }
    if (values.energy !== undefined) {
      this.energyPoints = Math.min(VITALS.maxEnergy, Math.max(0, values.energy));
    }
  }

  /**
   * Plays `dt` seconds. `core` is the Outpost Core while it stands, or null where there is none
   * (or it has fallen), and its field is then not there to charge anyone. `chargers` is whatever else
   * gives Energy back by radius (the crew's Generators); a player in more than one field gets the best.
   */
  step(dt: number, core: Outpost | null, chargers: ChargeSource | null = null): void {
    // Someone who is down only lies there: no Energy drains or charges, no wound mends.
    if (this.healthPoints <= 0) {
      this.downFor = Math.max(0, this.downFor) + dt;
      this.inField = false;
      return;
    }
    const energy = VITALS.energy;
    this.sinceHurt += dt;
    this.shakenLeft = Math.max(0, this.shakenLeft - dt);

    this.shots = Math.min(
      BLASTER.burst,
      this.shots + (dt * handScaleFor(this.energy / VITALS.maxEnergy)) / BLASTER.interval,
    );

    const scale = speedScaleFor(this.energy / VITALS.maxEnergy);
    let drain = energy.idlePerSecond;
    if (this.placed && this.onGround && this.speed > MOVEMENT.walkSpeed * scale * SPRINT_FACTOR) {
      drain += energy.sprintPerSecond;
    }
    if (this.sinceHurt < energy.combatSeconds) drain += energy.combatPerSecond;
    if (this.shakenLeft > 0) drain *= RESPAWN.shaken.drainScale;

    const inCore =
      core !== null &&
      this.placed &&
      outpostDistance(core, this.x, this.y + PLAYER.height / 2, this.z) <=
        VITALS.chargeField.radius;
    const given = this.placed && chargers ? chargers.chargeAt(this.x, this.y, this.z) : 0;
    const charge = Math.max(inCore ? VITALS.chargeField.perSecond : 0, given);
    this.inField = charge > 0;
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
    // How long until the Core brings a downed player back is the crew's to say (it holds the
    // charges), so the simulation fills `returnIn` in after this.
    out.returnIn = 0;
    out.shaken = this.shaken;
    return out;
  }
}
