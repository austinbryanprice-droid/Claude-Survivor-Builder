import { MODULE, moduleOfShape, stateMaterial, stateShape } from '../../shared/blocks';
import { createEnemyPose, type EnemyPose } from '../../shared/enemy-state';
import type { Vec3 } from '../../shared/look';
import type { RayWorld } from '../../shared/raycast';
import { SHOT_FLAG, createShotTrace, traceShot } from '../../shared/shot';
import { cellKey } from '../../shared/solid';
import { SIM_HZ } from '../../shared/survival-state';
import { turretMuzzle, turretPivot } from '../../shared/turret';
import { TURRET, hitboxOf, type TurretLevel } from './balance';
import type { EnemySim } from './enemies';

/**
 * The crew's turrets (SPEC section 9): a turret is a module standing in a cell, and while it stands it
 * shoots the nearest machine it has a clear line to, again each time its gun is ready, with no one at
 * the trigger and no Energy spent. It is pure and runs in the host's fixed steps with the machines:
 * the host judges the shot, wounds the machine, and tells every screen where the bolt ended.
 *
 * The bolt is the blaster's: a straight line from the muzzle to the middle of the machine's body,
 * stopped by the blocks the crew built, the ground and the Core, so a turret walled in at its own
 * level cannot shoot that way and a turret on a wall can shoot over it. Players are never in the way
 * of a bolt and never hurt by one. Which cells hold turrets is read from the world each step, so a
 * turret placed, broken or chewed is known the moment the world knows it. A turret that has power
 * (SPEC section 9: a Generator, or a Power Node that is carrying it) shoots `TURRET.poweredRate`
 * times as often; one without shoots as it always did.
 */

/** A module standing in a cell, as the world lists it: where, and its state (the shape names the module, the material byte is its level). */
export interface ModuleSite {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly state: number;
}

/** Walks the modules standing in the world: calls `visit` once for each, in no particular order. */
export type ModuleSource = (visit: (site: ModuleSite) => void) => void;

/** What a turret asks of the crew's power: whether the module standing in a cell has any. */
export interface Powered {
  powered(x: number, y: number, z: number): boolean;
}

/** One shot of a turret, as the host reports it: which turret fired, and how the bolt ended. */
export interface TurretShot {
  /** The cell the turret stands in. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Where the bolt ended, in blocks. */
  readonly ex: number;
  readonly ey: number;
  readonly ez: number;
  /** `SHOT_FLAG` bits. */
  readonly flags: number;
  /** The machine it struck. */
  readonly enemy: number;
}

/**
 * A turret's due time is a fraction of a step once it has power, added up shot after shot, so it can come
 * out a hair past the whole step it was due on (three waits of 6.67 steps are 20.000000000000004). This is
 * how much of a step is not counted against it.
 */
const DUE_SLACK = 1e-6;

/** A machine a turret may shoot at: where its feet are, and how far its aim point is from the turret's head. */
interface Candidate {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  d2: number;
}

/** What a turret of this level does: the table's row, or its last row for a level the table does not have. */
export function turretLevel(level: number): TurretLevel {
  const levels = TURRET.levels;
  return levels[Math.min(Math.max(1, Math.floor(level)), levels.length) - 1] as TurretLevel;
}

export class Turrets {
  /**
   * The step each turret in the middle of its wait may fire again on, keyed by cell. It is not a whole
   * number of steps for a turret that has power, so one that fires without a gap keeps its pace to a
   * fraction of a step: a turret at 1.5 times its rate shoots 3 times in 2 intervals however they
   * fall among the steps.
   */
  private readonly readyAt = new Map<number, number>();
  private readonly candidates: Candidate[] = Array.from({ length: TURRET.tries }, () => ({
    id: 0,
    kind: 0,
    x: 0,
    y: 0,
    z: 0,
    d2: 0,
  }));
  private found = 0;

  // Scratch values, so a step allocates nothing but the shots it reports.
  private readonly pivot: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly muzzle: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly aim: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly pose: EnemyPose = createEnemyPose();
  private readonly bodies: EnemyPose[] = [this.pose];
  private readonly trace = createShotTrace();

  // What the turret being served needs, set by `step` and `serve` for the visitors below.
  private tick = 0;
  private range2 = 0;
  private rate = 1;
  private felled = 0;
  private machines: EnemySim | null = null;
  private ray: RayWorld | null = null;
  private out: TurretShot[] | null = null;

  private readonly visitSite = (site: ModuleSite): void => this.serve(site);
  private readonly visitMachine = (
    id: number,
    kind: number,
    x: number,
    y: number,
    z: number,
  ): void => this.consider(id, kind, x, y, z);

  constructor(
    private readonly source: ModuleSource,
    private readonly power: Powered | null = null,
  ) {}

  /**
   * Lets every turret that is ready shoot, on step `tick`, and appends what they did to `out`.
   * Returns how many machines the shots felled.
   */
  step(tick: number, machines: EnemySim, ray: RayWorld | null, out: TurretShot[]): number {
    this.tick = tick;
    this.machines = machines;
    this.ray = ray;
    this.out = out;
    this.felled = 0;
    this.source(this.visitSite);
    this.machines = null;
    this.ray = null;
    this.out = null;
    // A turret whose wait is over is the same as one that never fired.
    for (const [key, ready] of this.readyAt)
      if (ready - DUE_SLACK <= tick) this.readyAt.delete(key);
    return this.felled;
  }

  /** Lets one module shoot, if it is a turret and its gun is ready. */
  private serve(site: ModuleSite): void {
    if (moduleOfShape(stateShape(site.state))?.id !== MODULE.turret) return;
    const key = cellKey(site.x, site.y, site.z);
    if (this.tick + DUE_SLACK < (this.readyAt.get(key) ?? 0)) return;
    const level = turretLevel(stateMaterial(site.state));
    turretPivot(site.x, site.y, site.z, this.pivot);
    this.range2 = level.range * level.range;
    this.rate = this.power?.powered(site.x, site.y, site.z) ? TURRET.poweredRate : 1;
    this.found = 0;
    this.machines?.forEach(this.visitMachine);
    for (let i = 0; i < this.found; i++) {
      if (this.shoot(site, key, level, this.candidates[i] as Candidate)) return;
    }
  }

  /** Keeps the machine among the nearest few in reach of the turret being served, nearest first. */
  private consider(id: number, kind: number, x: number, y: number, z: number): void {
    const box = hitboxOf(kind);
    if (!box) return;
    const dx = x - this.pivot.x;
    const dy = y + box.height * TURRET.aimHeight - this.pivot.y;
    const dz = z - this.pivot.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > this.range2) return;
    const list = this.candidates;
    const size = Math.min(this.found + 1, TURRET.tries);
    let at = this.found;
    while (at > 0 && (list[at - 1] as Candidate).d2 > d2) at--;
    if (at >= size) return;
    // The last place is either unused or the farthest of the lot, which this one pushes out.
    const spare = list[size - 1] as Candidate;
    for (let i = size - 1; i > at; i--) list[i] = list[i - 1] as Candidate;
    list[at] = spare;
    spare.id = id;
    spare.kind = kind;
    spare.x = x;
    spare.y = y;
    spare.z = z;
    spare.d2 = d2;
    this.found = size;
  }

  /** Shoots the machine if the bolt reaches it, and reports the shot. False when a block or the ground is in the way. */
  private shoot(site: ModuleSite, key: number, level: TurretLevel, target: Candidate): boolean {
    const box = hitboxOf(target.kind);
    const machines = this.machines;
    const out = this.out;
    if (!box || !machines || !out) return false;
    const aimY = target.y + box.height * TURRET.aimHeight;
    const muzzle = turretMuzzle(site.x, site.y, site.z, target.x, aimY, target.z, this.muzzle);
    const dx = target.x - muzzle.x;
    const dy = aimY - muzzle.y;
    const dz = target.z - muzzle.z;
    const length = Math.hypot(dx, dy, dz);
    if (!(length > 1e-6)) return false;
    const aim = this.aim;
    aim.x = dx / length;
    aim.y = dy / length;
    aim.z = dz / length;
    const pose = this.pose;
    pose.id = target.id;
    pose.kind = target.kind;
    pose.x = target.x;
    pose.y = target.y;
    pose.z = target.z;
    const trace = traceShot(
      this.ray,
      muzzle,
      aim,
      level.range,
      this.bodies,
      1,
      hitboxOf,
      null,
      this.trace,
    );
    if ((trace.flags & SHOT_FLAG.enemy) === 0) return false;
    let flags: number = SHOT_FLAG.enemy;
    if (machines.hurt(target.id, level.damage)) {
      flags |= SHOT_FLAG.kill;
      this.felled++;
    }
    // The wait counts from when the gun was due and not from when the step came, if the step came within
    // one of it: a turret that fires without a gap loses nothing to the steps being whole.
    const wait = Math.max(1, (level.interval * SIM_HZ) / this.rate);
    const due = this.readyAt.get(key);
    this.readyAt.set(key, (due !== undefined && this.tick - due < 1 ? due : this.tick) + wait);
    out.push({
      x: site.x,
      y: site.y,
      z: site.z,
      ex: muzzle.x + aim.x * trace.distance,
      ey: muzzle.y + aim.y * trace.distance,
      ez: muzzle.z + aim.z * trace.distance,
      flags,
      enemy: target.id,
    });
    return true;
  }
}
