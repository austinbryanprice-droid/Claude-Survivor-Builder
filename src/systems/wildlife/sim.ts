import { createRng, hash32, unitFloat } from '../../shared/hash';
import { angleDelta, wrapAngle } from '../../shared/look';
import { WILD_FLAG, WILD_HEALTH_FULL, type WildState } from '../../shared/wildlife-state';
import type { Target } from '../survival/enemies';
import type { NavWorld } from '../survival/nav';
import { SPECIES, WILDLIFE, speciesOf, type Species } from './balance';

/**
 * The creatures that roam the valley, as the host simulates them. It is pure (no DOM, no three.js,
 * no network) and takes fixed steps from the survival simulation, so a Worker, a test and the
 * browser all play the same valley. It has nothing to do with the machines' map or the waves: a
 * creature is a point with a radius that reads the ground, the water and what players have built
 * straight from the world, and it steers by a few rules (SPEC section 14 leaves out advanced AI, and
 * this stays short of it: nothing here finds a route round anything, it turns away and tries again).
 *
 * The creatures live in **herds** (a school, a flock, a pair or a single, by species). A herd has a
 * middle, an invisible point that drifts over the valley at the pace of its species and keeps to the
 * ground, water or air its species lives in and away from the Core; the members go about inside a
 * spread of it, so the herd roams as a whole and the valley never fills up in one corner.
 *
 * A creature does one of four things each step, in this order of preference:
 * - **fight**: a defiant species that a player has hurt goes for that player, lands a few mild blows
 *   and gives up (a player who gets away is forgotten);
 * - **flee**: something startled it (a machine near enough, a player nearer than the species likes, or
 *   a blow that fell on it or its herd), so it runs, swims or flies off and its herd goes with it;
 * - **circle**: a flier moves in a ring round the middle of its herd;
 * - **roam**: it walks to a spot near the middle of its herd, stands about for a while, and again.
 *
 * Nothing here starts a fight. Only `hurt`, which the survival simulation calls for a player's bolt,
 * turns a creature against anyone, and only against that player. A turret's bolt and the machines never
 * touch a creature.
 */

/** A creature that is blocked for a moment is let step out of a cell a block was just built in. */
const EPSILON = 1e-4;
/** How far above their feet a blow reaches a player: the middle of the body, not the soles. */
const CHEST_HEIGHT = 0.9;
/** A wind-up this close to nothing is over: the sum of 0.05-second steps does not land exactly on 0.5. */
const WINDUP_EPSILON = 1e-6;
/** A creature has reached its goal when it is this near it. */
const ARRIVED = 0.45;
/** Samples along a straight walk are this far apart, in blocks. */
const LINE_STEP = 2;
/** The herd's middle flees at this part of its species' running speed when its herd has been startled. */
const RUSH_SPEED = 0.5;
/** ...for this many seconds. */
const RUSH_SECONDS = 5;
/** Seconds a flier or swimmer takes to settle to its level, as the fastest it changes height. */
const CLIMB = { air: 3, alarmedAir: 6, dive: 8, water: 1 } as const;
/** How a creature that goes by quickly slows through a sharp turn without stopping, which fliers do not. */
const MIN_FLIGHT_PACE = 0.5;

/** What a blow of a creature's does to the world. The survival simulation answers it. */
export interface WildStrikes {
  /** Wounds a player; returns the points it took. */
  hurtPlayer(id: number, amount: number): number;
}

/** The places that frighten a creature: where each machine is. The survival simulation fills it before every step. */
export class Threats {
  count = 0;
  readonly x: number[] = [];
  readonly z: number[] = [];

  clear(): void {
    this.count = 0;
  }

  add(x: number, z: number): void {
    this.x[this.count] = x;
    this.z[this.count] = z;
    this.count++;
  }
}

export interface WildlifeOptions {
  /** The middle of the Core, which creatures keep away from. */
  readonly core: { readonly x: number; readonly z: number };
  /** The world's seed. Where the herds are and where they roam is drawn from it. */
  readonly seed: number;
  /** False leaves the valley empty, for tests and pictures that bring their own creatures (`spawnHerd`). */
  readonly populate?: boolean;
}

/** One herd, school or flock: the middle its members go about, and where that is going. */
interface Herd {
  readonly id: number;
  readonly species: number;
  readonly body: Species;
  /** How many it started with, so a top-up can bring it back to strength. */
  readonly want: number;
  readonly members: Creature[];
  x: number;
  z: number;
  /** The way the middle was going, in radians (toward `(sin, cos)` in x and z). */
  heading: number;
  goalX: number;
  goalZ: number;
  going: boolean;
  /** Seconds the middle stands still before it picks its next way. */
  wait: number;
  /** Seconds left that the herd is running from something. */
  rush: number;
  /** Which way a flock circles: 1 or -1. */
  readonly spin: number;
}

interface Creature {
  readonly id: number;
  readonly species: number;
  readonly body: Species;
  readonly herd: Herd;
  /** A number from 0 to 1 that is its own, so a crowd of one species is not a stamp. */
  readonly quirk: number;
  x: number;
  /** Where its feet rest; for a swimmer or a flier, the underside of its body. */
  y: number;
  z: number;
  yaw: number;
  health: number;
  readonly maxHealth: number;
  /** Where it is going, and for how many more seconds it will keep trying to get there. */
  goalX: number;
  goalZ: number;
  going: boolean;
  leg: number;
  /** Seconds it stands about before it goes anywhere. */
  rest: number;
  /** Seconds it has been blocked, running up to `stuckSeconds`. */
  stuck: number;
  /** Seconds left that it is running from `threatX`, `threatZ`. */
  alarm: number;
  threatX: number;
  threatZ: number;
  /** Which way it veers when it runs: 1 or -1, turned over when it is blocked. */
  veer: number;
  /** Seconds left that a skittish creature keeps away from the player who hurt it. */
  fright: number;
  /** Seconds left that a defiant creature is out for the player who hurt it, who that is, and how many blows it has landed. */
  anger: number;
  grudge: number;
  blows: number;
  /** Seconds left of the wind-up of a blow, and before the next may begin. */
  windup: number;
  cooldown: number;
  /** Seconds left of the flash a blow gave it. */
  hurt: number;
  /** Blocks a second it covered in the last step. */
  speed: number;
  /** Where on its ring a flier is, and where in its bob a swimmer is. */
  phase: number;
  /** The height a flier that is going for a player brings the underside of its body to, or NaN when it is not. */
  dive: number;
}

export class WildlifeSim {
  private readonly list: Creature[] = [];
  private readonly byId = new Map<number, Creature>();
  private readonly herds: Herd[] = [];
  private readonly rng: () => number;
  private nextId = 1;
  private nextHerd = 1;
  private changes = 0;
  private clock = 0;
  private sinceTopUp = 0;
  /** A valley that was left empty on purpose (tests, pictures) is not filled up again behind their backs. */
  private readonly refills: boolean;

  /** Called with the species of every creature that a blow fells, once, as it falls. */
  onFelled: ((species: number) => void) | null = null;

  constructor(
    private readonly world: NavWorld,
    private readonly options: WildlifeOptions,
  ) {
    this.rng = createRng(hash32(options.seed ^ 0xa11d117e));
    this.refills = options.populate !== false;
    if (this.refills) this.populate();
  }

  /** How many are alive. */
  get count(): number {
    return this.list.length;
  }

  /** How many herds there are. */
  get herdCount(): number {
    return this.herds.length;
  }

  /** Counts every change that does not come from a step (a spawn, a blow, a clear), so a watcher can tell. */
  get revision(): number {
    return this.changes;
  }

  /** True while the creature with this id is alive. */
  has(id: number): boolean {
    return this.byId.has(id);
  }

  /** How many creatures of a species are alive. */
  countOf(species: number): number {
    let n = 0;
    for (const c of this.list) if (c.species === species) n++;
    return n;
  }

  /**
   * Calls `visit` with the id, species and feet of every creature alive, in the order they came.
   * `visit` must not wound or remove a creature: that changes the list under the loop.
   */
  forEach(visit: (id: number, species: number, x: number, y: number, z: number) => void): void {
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i] as Creature;
      visit(c.id, c.species, c.x, c.y, c.z);
    }
  }

  /** The middle of the herd the creature belongs to, or false for a creature that is not here. For tests and the debug page. */
  herdOf(id: number, out: { x: number; z: number }): boolean {
    const c = this.byId.get(id);
    if (!c) return false;
    out.x = c.herd.x;
    out.z = c.herd.z;
    return true;
  }

  /** What a creature is up to, for tests: its moods as they stand. */
  moodOf(id: number): { alarm: number; anger: number; fright: number; blows: number } | null {
    const c = this.byId.get(id);
    return c ? { alarm: c.alarm, anger: c.anger, fright: c.fright, blows: c.blows } : null;
  }

  // --------------------------------------------------------------------------------------------
  // Blows.
  // --------------------------------------------------------------------------------------------

  /**
   * Wounds a creature by `amount` points, struck by player `by` from (fromX, fromZ); true when this
   * blow killed it. Nothing happens for a creature that is not here. A defiant species turns on the
   * player; a skittish one runs from them; the rest of the creature's herd runs from the spot the
   * blow came from either way.
   */
  hurt(id: number, amount: number, by: number, fromX: number, fromZ: number): boolean {
    const c = this.byId.get(id);
    if (!c || !(amount > 0)) return false;
    c.health -= amount;
    c.hurt = WILDLIFE.hurtFlashSeconds;
    this.changes++;
    if (c.health <= 0) {
      this.remove(c);
      this.onFelled?.(c.species);
      return true;
    }
    c.grudge = by;
    const retaliation = c.body.retaliation;
    if (retaliation) {
      c.anger = retaliation.calm;
      c.alarm = 0;
    } else {
      c.fright = c.body.fright;
      this.startle(c, fromX, fromZ);
    }
    this.startleHerd(c, fromX, fromZ);
    return false;
  }

  // --------------------------------------------------------------------------------------------
  // Putting them there.
  // --------------------------------------------------------------------------------------------

  /** Fills the valley with the herds of every species. */
  populate(): void {
    for (let species = 0; species < SPECIES.length; species++) {
      const body = SPECIES[species] as Species;
      for (let i = 0; i < body.herds; i++) this.newHerd(species, null, 0);
    }
  }

  /**
   * Puts a herd of `size` creatures of a species at a spot, for tests and the debug page (the species'
   * own size when it is left out). Returns the id of the first, or 0 where there is no room: a land
   * creature needs ground that is dry and clear, a swimmer water that is deep enough, and a herd is
   * not made past the cap.
   */
  spawnHerd(species: number, x: number, z: number, size?: number): number {
    const body = speciesOf(species);
    if (!body) return 0;
    const n = size ?? this.between(body.size[0], body.size[1] + 1, true);
    return this.makeHerd(species, body, x, z, n, false);
  }

  /** Puts one creature at a spot, as a herd of one. Returns its id, or 0 where there is no room. */
  spawnAt(species: number, x: number, z: number): number {
    return this.spawnHerd(species, x, z, 1);
  }

  /** Takes every creature off the field, and every herd. */
  clear(): void {
    if (this.list.length === 0 && this.herds.length === 0) return;
    this.list.length = 0;
    this.byId.clear();
    this.herds.length = 0;
    this.changes++;
  }

  /** Fills `out` with the creatures as the host reports them. Returns how many; `out` must hold `maxAlive`. */
  write(out: WildState[]): number {
    const count = Math.min(this.list.length, out.length);
    for (let i = 0; i < count; i++) {
      const c = this.list[i] as Creature;
      const state = out[i] as WildState;
      state.id = c.id;
      state.kind = c.species;
      state.x = c.x;
      state.y = c.y;
      state.z = c.z;
      state.yaw = c.yaw;
      state.health = Math.max(
        1,
        Math.min(WILD_HEALTH_FULL, Math.round((c.health / c.maxHealth) * WILD_HEALTH_FULL)),
      );
      state.flags =
        (c.alarm > 0 ? WILD_FLAG.alarmed : 0) |
        (c.hurt > 0 ? WILD_FLAG.hurt : 0) |
        (c.anger > 0 ? WILD_FLAG.angry : 0) |
        (c.windup > 0 ? WILD_FLAG.strike : 0);
    }
    return count;
  }

  // --------------------------------------------------------------------------------------------
  // The step.
  // --------------------------------------------------------------------------------------------

  /**
   * Plays `dt` seconds. `targets` are the first `count` entries of the array: the players who are in
   * the world and not down. `threats` are the machines. The host's survival simulation calls it once
   * per fixed step.
   */
  step(
    dt: number,
    targets: readonly Target[],
    count: number,
    threats: Threats,
    strikes: WildStrikes,
  ): void {
    this.clock += dt;
    for (let i = 0; i < this.herds.length; i++) this.moveHerd(this.herds[i] as Herd, dt);
    for (let i = 0; i < this.list.length; i++) {
      this.stepOne(this.list[i] as Creature, dt, targets, count, threats, strikes);
    }
    this.crowd();
    this.topUp(dt, targets, count);
  }

  private stepOne(
    c: Creature,
    dt: number,
    targets: readonly Target[],
    count: number,
    threats: Threats,
    strikes: WildStrikes,
  ): void {
    c.cooldown = Math.max(0, c.cooldown - dt);
    if (c.hurt > 0) c.hurt = Math.max(0, c.hurt - dt);
    c.speed = 0;

    this.sense(c, dt, targets, count, threats);

    if (c.anger > 0 && this.fight(c, dt, targets, count, strikes)) return;

    if (c.alarm > 0) {
      c.alarm -= dt;
      this.flee(c, dt);
      if (c.alarm <= 0) {
        c.going = false;
        c.rest = 0.6 + this.rng() * 1.2;
      }
      return;
    }

    if (c.body.orbit > 0) this.circle(c, dt);
    else this.roam(c, dt);
  }

  // --------------------------------------------------------------------------------------------
  // Fear.
  // --------------------------------------------------------------------------------------------

  /**
   * Looks for what startles the creature: the nearest machine within its `scare`, the nearest player
   * within its `shy`, and, while a skittish creature is still afraid of the player who hurt it, that
   * player within `attackerRadius`. A defiant creature that is angry is not afraid of the player it is
   * angry with.
   */
  private sense(
    c: Creature,
    dt: number,
    targets: readonly Target[],
    count: number,
    threats: Threats,
  ): void {
    const body = c.body;
    let best = Infinity;
    let fromX = 0;
    let fromZ = 0;
    if (body.scare > 0) {
      const reach = body.scare * body.scare;
      for (let i = 0; i < threats.count; i++) {
        const dx = (threats.x[i] as number) - c.x;
        const dz = (threats.z[i] as number) - c.z;
        const squared = dx * dx + dz * dz;
        if (squared > reach || squared >= best) continue;
        best = squared;
        fromX = threats.x[i] as number;
        fromZ = threats.z[i] as number;
      }
    }
    if (body.shy > 0) {
      const reach = body.shy * body.shy;
      for (let i = 0; i < count; i++) {
        const t = targets[i] as Target;
        if (c.anger > 0 && t.id === c.grudge) continue;
        const dx = t.x - c.x;
        const dz = t.z - c.z;
        const squared = dx * dx + dz * dz;
        if (squared > reach || squared >= best) continue;
        best = squared;
        fromX = t.x;
        fromZ = t.z;
      }
    }
    if (c.fright > 0) {
      c.fright = Math.max(0, c.fright - dt);
      const reach = WILDLIFE.attackerRadius * WILDLIFE.attackerRadius;
      let found = false;
      for (let i = 0; i < count; i++) {
        const t = targets[i] as Target;
        if (t.id !== c.grudge) continue;
        found = true;
        const dx = t.x - c.x;
        const dz = t.z - c.z;
        const squared = dx * dx + dz * dz;
        if (squared <= reach && squared < best) {
          best = squared;
          fromX = t.x;
          fromZ = t.z;
        }
      }
      // The player it was afraid of is gone (felled, or left): nothing to keep away from.
      if (!found) c.fright = 0;
    }
    if (best === Infinity) return;
    const fresh = c.alarm <= 0;
    this.startle(c, fromX, fromZ);
    if (fresh) this.startleHerd(c, fromX, fromZ);
  }

  /** Sends the creature running from a spot. */
  private startle(c: Creature, fromX: number, fromZ: number): void {
    c.alarm = WILDLIFE.alarmSeconds;
    c.threatX = fromX;
    c.threatZ = fromZ;
    c.windup = 0;
  }

  /** The rest of the creature's herd runs from a spot too, and the middle of the herd moves off with them. */
  private startleHerd(c: Creature, fromX: number, fromZ: number): void {
    const herd = c.herd;
    for (const mate of herd.members) {
      if (mate === c || mate.anger > 0) continue;
      this.startle(mate, fromX, fromZ);
    }
    // The middle goes the other way, so the herd that calms down is not back where it was frightened.
    const away = Math.atan2(herd.x - fromX, herd.z - fromZ);
    const [low, high] = WILDLIFE.legs[herd.body.realm];
    const length = (low + high) / 2;
    const gx = herd.x + Math.sin(away) * length;
    const gz = herd.z + Math.cos(away) * length;
    herd.rush = RUSH_SECONDS;
    herd.wait = 0;
    if (this.habitable(herd.body, gx, gz)) {
      herd.goalX = gx;
      herd.goalZ = gz;
      herd.going = true;
    }
  }

  private flee(c: Creature, dt: number): void {
    const body = c.body;
    // Straight away from what startled it, a little to one side so a crowd scatters instead of streaming.
    let heading = Math.atan2(c.x - c.threatX, c.z - c.threatZ);
    heading += c.veer * (0.25 + c.quirk * 0.5);
    this.steer(
      c,
      c.x + Math.sin(heading) * 6,
      c.z + Math.cos(heading) * 6,
      body.run,
      dt,
      WILDLIFE.alarmTurn,
    );
    if (c.stuck > 0.25) {
      // Blocked: go the other way round.
      c.veer = -c.veer;
      c.stuck = 0;
    }
  }

  // --------------------------------------------------------------------------------------------
  // Fighting back.
  // --------------------------------------------------------------------------------------------

  /**
   * A defiant creature that a player hurt goes for that player. True when it did (it is chasing or
   * striking, and has nothing else to do this step); false when it has calmed down.
   */
  private fight(
    c: Creature,
    dt: number,
    targets: readonly Target[],
    count: number,
    strikes: WildStrikes,
  ): boolean {
    const retaliation = c.body.retaliation;
    if (!retaliation) {
      this.calm(c);
      return false;
    }
    c.anger -= dt;
    let target: Target | null = null;
    for (let i = 0; i < count; i++) {
      const t = targets[i] as Target;
      if (t.id === c.grudge) {
        target = t;
        break;
      }
    }
    if (!target || c.anger <= 0 || c.blows >= retaliation.strikes) {
      this.calm(c);
      return false;
    }
    const dx = target.x - c.x;
    const dz = target.z - c.z;
    const distance = Math.hypot(dx, dz);
    if (distance > retaliation.chase) {
      this.calm(c);
      return false;
    }
    const vertical = Math.abs(target.y + CHEST_HEIGHT - (c.y + c.body.hitbox.height * 0.5));
    // A flier comes down to the player's height for the blow.
    c.dive =
      c.body.realm === 'air' ? target.y + CHEST_HEIGHT - c.body.hitbox.height * 0.5 : Number.NaN;
    if (distance <= retaliation.reach && vertical <= retaliation.height) {
      this.strike(
        c,
        target,
        retaliation.windup,
        retaliation.interval,
        retaliation.player,
        dt,
        strikes,
      );
      this.settle(c, dt);
      return true;
    }
    c.windup = 0;
    this.steer(c, target.x, target.z, c.body.run, dt, WILDLIFE.alarmTurn);
    if (c.stuck >= WILDLIFE.stuckSeconds) this.calm(c);
    return true;
  }

  private strike(
    c: Creature,
    target: Target,
    windup: number,
    interval: number,
    damage: number,
    dt: number,
    strikes: WildStrikes,
  ): void {
    this.face(c, target.x, target.z, dt, WILDLIFE.alarmTurn);
    if (c.windup > 0) {
      c.windup -= dt;
      if (c.windup > WINDUP_EPSILON) return;
      c.windup = 0;
      c.cooldown = Math.max(0, interval - windup);
      c.blows++;
      strikes.hurtPlayer(target.id, damage);
    } else if (c.cooldown <= 0) {
      c.windup = windup;
    }
  }

  /** The creature has had enough: it forgets the grudge and goes back to its day. */
  private calm(c: Creature): void {
    c.anger = 0;
    c.windup = 0;
    c.grudge = 0;
    c.blows = 0;
    c.going = false;
    c.stuck = 0;
    c.dive = Number.NaN;
    c.rest = 1.5 + this.rng() * 1.5;
  }

  // --------------------------------------------------------------------------------------------
  // Going about the day.
  // --------------------------------------------------------------------------------------------

  /**
   * Walks to a spot near the middle of the herd, stands about, and again. A creature that has fallen
   * far behind its herd hurries to catch it up. A swimmer that never stops (a shoal, a ray) has no
   * pause in its species' table.
   */
  private roam(c: Creature, dt: number): void {
    const body = c.body;
    if (c.rest > 0) {
      c.rest -= dt;
      return;
    }
    const herd = c.herd;
    const gap = Math.hypot(c.x - herd.x, c.z - herd.z);
    if (gap > body.spread * WILDLIFE.strayAt) {
      c.going = false;
      this.steer(c, herd.x, herd.z, body.walk * WILDLIFE.hurry, dt, 1);
      if (c.stuck >= WILDLIFE.stuckSeconds) c.stuck = 0;
      return;
    }
    if (!c.going && !this.pickGoal(c)) {
      c.rest = 0.6 + this.rng() * 1.2;
      return;
    }
    this.steer(c, c.goalX, c.goalZ, body.walk, dt, 1);
    c.leg -= dt;
    if (
      Math.hypot(c.goalX - c.x, c.goalZ - c.z) < ARRIVED ||
      c.leg <= 0 ||
      c.stuck >= WILDLIFE.stuckSeconds
    ) {
      c.going = false;
      c.stuck = 0;
      c.rest = this.between(body.pause[0], body.pause[1], false);
    }
  }

  /** A flier goes round the middle of its herd on a ring of its own, and keeps pace with the herd as it drifts. */
  private circle(c: Creature, dt: number): void {
    const body = c.body;
    const herd = c.herd;
    const radius = body.orbit * (0.55 + 0.45 * c.quirk);
    const pace = body.walk * (0.9 + 0.2 * c.quirk);
    c.phase = wrapAngle(c.phase + herd.spin * (pace / radius) * dt);
    const gx = herd.x + Math.cos(c.phase) * radius;
    const gz = herd.z + Math.sin(c.phase) * radius;
    const gap = Math.hypot(c.x - herd.x, c.z - herd.z);
    const hurry = gap > body.spread * WILDLIFE.strayAt ? WILDLIFE.hurry : 1;
    this.steer(c, gx, gz, pace * hurry, dt, 1);
    c.dive = Number.NaN;
  }

  /** Picks a spot to walk to near the middle of the herd, on ground it can walk to. False if it finds none. */
  private pickGoal(c: Creature): boolean {
    const body = c.body;
    const herd = c.herd;
    for (let attempt = 0; attempt < 4; attempt++) {
      const angle = this.rng() * Math.PI * 2;
      const radius = Math.sqrt(this.rng()) * body.spread;
      const gx = herd.x + Math.cos(angle) * radius;
      const gz = herd.z + Math.sin(angle) * radius;
      if (!this.habitable(body, gx, gz, true)) continue;
      if (body.realm !== 'air' && !this.openLine(body, c.x, c.z, gx, gz)) continue;
      c.goalX = gx;
      c.goalZ = gz;
      c.going = true;
      c.leg = 3 + (Math.hypot(gx - c.x, gz - c.z) / body.walk) * 2;
      c.stuck = 0;
      return true;
    }
    return false;
  }

  // --------------------------------------------------------------------------------------------
  // Herds.
  // --------------------------------------------------------------------------------------------

  /** The middle of a herd drifts toward a goal of its own, and runs when its herd has been startled. */
  private moveHerd(herd: Herd, dt: number): void {
    const body = herd.body;
    if (herd.rush > 0) herd.rush = Math.max(0, herd.rush - dt);
    if (herd.wait > 0) {
      herd.wait -= dt;
      return;
    }
    if (!herd.going && !this.pickLeg(herd)) {
      herd.wait = 2 + this.rng() * 3;
      return;
    }
    const dx = herd.goalX - herd.x;
    const dz = herd.goalZ - herd.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1) {
      herd.going = false;
      herd.wait = body.realm === 'air' ? 0 : this.between(2, 8, false);
      return;
    }
    const speed = herd.rush > 0 ? Math.max(body.drift, body.run * RUSH_SPEED) : body.drift;
    const step = Math.min(distance, speed * dt);
    const nx = herd.x + (dx / distance) * step;
    const nz = herd.z + (dz / distance) * step;
    if (!this.habitable(body, nx, nz)) {
      // The way is closed (the Core's clearing, a shore, the edge of the valley): pick another.
      herd.going = false;
      herd.wait = 0.5;
      return;
    }
    herd.x = nx;
    herd.z = nz;
    herd.heading = Math.atan2(dx, dz);
  }

  /** Picks where the middle of a herd goes next: roughly the way it was going, then anywhere. */
  private pickLeg(herd: Herd): boolean {
    const body = herd.body;
    const [low, high] = WILDLIFE.legs[body.realm];
    for (let attempt = 0; attempt < WILDLIFE.legTries; attempt++) {
      const swing = attempt < 4 ? 1.2 : Math.PI;
      const angle = herd.heading + (this.rng() * 2 - 1) * swing;
      const length = low + this.rng() * (high - low);
      const gx = herd.x + Math.sin(angle) * length;
      const gz = herd.z + Math.cos(angle) * length;
      if (!this.habitable(body, gx, gz)) continue;
      if (body.realm !== 'air' && !this.openLine(body, herd.x, herd.z, gx, gz)) continue;
      herd.goalX = gx;
      herd.goalZ = gz;
      herd.going = true;
      return true;
    }
    return false;
  }

  private newHerd(species: number, targets: readonly Target[] | null, count: number): boolean {
    const body = SPECIES[species] as Species;
    if (this.list.length >= WILDLIFE.maxAlive) return false;
    for (let attempt = 0; attempt < WILDLIFE.spotTries; attempt++) {
      const half = this.world.half - WILDLIFE.margin;
      const x = (this.rng() * 2 - 1) * half;
      const z = (this.rng() * 2 - 1) * half;
      if (!this.habitable(body, x, z) || !this.level(body, x, z)) continue;
      if (targets && this.nearPlayer(targets, count, x, z, WILDLIFE.unseen)) continue;
      const size = this.between(body.size[0], body.size[1] + 1, true);
      return this.makeHerd(species, body, x, z, size, true) !== 0;
    }
    return false;
  }

  /** Makes a herd at a spot. `habitat` holds the herd to its species' band of ground; the debug page's spawns do not. */
  private makeHerd(
    species: number,
    body: Species,
    x: number,
    z: number,
    size: number,
    habitat: boolean,
  ): number {
    if (size < 1 || this.list.length >= WILDLIFE.maxAlive) return 0;
    if (!habitat && !this.standable(body, x, z)) return 0;
    const herd: Herd = {
      id: this.nextHerd++,
      species,
      body,
      want: size,
      members: [],
      x,
      z,
      heading: this.rng() * Math.PI * 2 - Math.PI,
      goalX: x,
      goalZ: z,
      going: false,
      wait: this.between(0, 3, false),
      rush: 0,
      spin: this.rng() < 0.5 ? 1 : -1,
    };
    this.herds.push(herd);
    let first = 0;
    for (let i = 0; i < size && this.list.length < WILDLIFE.maxAlive; i++) {
      const id = this.addMember(herd, x, z);
      if (first === 0) first = id;
    }
    if (herd.members.length === 0) {
      this.herds.splice(this.herds.indexOf(herd), 1);
      return 0;
    }
    return first;
  }

  /** Adds one creature to a herd near a spot; 0 where it finds no place. */
  private addMember(herd: Herd, x: number, z: number): number {
    const body = herd.body;
    let px = x;
    let pz = z;
    // A herd comes in a bunch: the second and later creatures take a spot near the first that suits them.
    if (herd.members.length > 0) {
      const room = Math.min(body.spread * 0.5, 3);
      let found = false;
      for (let attempt = 0; attempt < 8 && !found; attempt++) {
        const angle = this.rng() * Math.PI * 2;
        const radius = Math.sqrt(this.rng()) * room;
        px = x + Math.cos(angle) * radius;
        pz = z + Math.sin(angle) * radius;
        found = this.standable(body, px, pz);
      }
      if (!found) {
        px = x;
        pz = z;
      }
    }
    const id = this.takeId();
    const maxHealth = body.health;
    const yaw = this.rng() * Math.PI * 2 - Math.PI;
    const c: Creature = {
      id,
      species: herd.species,
      body,
      herd,
      quirk: unitFloat(hash32(id * 0x9e3779b1 + this.options.seed)),
      x: px,
      y: 0,
      z: pz,
      yaw,
      health: maxHealth,
      maxHealth,
      goalX: px,
      goalZ: pz,
      going: false,
      leg: 0,
      rest: this.between(0, 2, false),
      stuck: 0,
      alarm: 0,
      threatX: 0,
      threatZ: 0,
      veer: this.rng() < 0.5 ? 1 : -1,
      fright: 0,
      anger: 0,
      grudge: 0,
      blows: 0,
      windup: 0,
      cooldown: 0,
      hurt: 0,
      speed: 0,
      phase: this.rng() * Math.PI * 2 - Math.PI,
      dive: Number.NaN,
    };
    c.y = this.levelAt(c, px, pz);
    this.list.push(c);
    this.byId.set(id, c);
    herd.members.push(c);
    this.changes++;
    return id;
  }

  private remove(c: Creature): void {
    const at = this.list.indexOf(c);
    if (at >= 0) this.list.splice(at, 1);
    this.byId.delete(c.id);
    const members = c.herd.members;
    const inHerd = members.indexOf(c);
    if (inHerd >= 0) members.splice(inHerd, 1);
    if (members.length === 0) {
      const herd = this.herds.indexOf(c.herd);
      if (herd >= 0) this.herds.splice(herd, 1);
    }
    this.changes++;
  }

  /**
   * Every `topUpSeconds`, brings back what the crew has thinned out: a herd of a species that has
   * fewer herds than its table says, in a place no player can see, and one more creature for a herd
   * that has fewer members than it began with, if nobody is near it. Creatures that die stay dead
   * for at least that long.
   */
  private topUp(dt: number, targets: readonly Target[], count: number): void {
    if (!this.refills) return;
    this.sinceTopUp += dt;
    if (this.sinceTopUp < WILDLIFE.topUpSeconds) return;
    this.sinceTopUp = 0;
    if (this.list.length >= WILDLIFE.maxAlive) return;
    for (let species = 0; species < SPECIES.length; species++) {
      const body = SPECIES[species] as Species;
      let herds = 0;
      for (const herd of this.herds) if (herd.species === species) herds++;
      if (herds < body.herds) {
        this.newHerd(species, targets, count);
        continue;
      }
      for (const herd of this.herds) {
        if (herd.species !== species || herd.members.length >= herd.want) continue;
        if (this.nearPlayer(targets, count, herd.x, herd.z, WILDLIFE.unseen)) continue;
        this.addMember(herd, herd.x, herd.z);
        break;
      }
    }
  }

  private nearPlayer(
    targets: readonly Target[],
    count: number,
    x: number,
    z: number,
    radius: number,
  ): boolean {
    const squared = radius * radius;
    for (let i = 0; i < count; i++) {
      const t = targets[i] as Target;
      const dx = t.x - x;
      const dz = t.z - z;
      if (dx * dx + dz * dz < squared) return true;
    }
    return false;
  }

  // --------------------------------------------------------------------------------------------
  // The ground.
  // --------------------------------------------------------------------------------------------

  /**
   * True when a species may be at a spot at all: inside the valley, away from the Core, and in the
   * kind of place it lives in (dry ground within its band above the water for a land species, water
   * deep enough for a swimmer, anywhere for a flier). Without `loose` the band of ground a land
   * species lives in counts too; with it only dry ground does, which is where a creature may walk.
   */
  private habitable(body: Species, x: number, z: number, loose = false): boolean {
    const half = this.world.half - WILDLIFE.margin;
    if (Math.abs(x) > half || Math.abs(z) > half) return false;
    const core = this.options.core;
    if (Math.hypot(x - core.x, z - core.z) < WILDLIFE.avoid) return false;
    if (body.realm === 'air') return true;
    const ground = this.world.surfaceAt(x, z);
    if (body.realm === 'water') return this.world.waterLevel - ground >= (body.depth ?? 0);
    const above = ground - this.world.waterLevel;
    if (above < WILDLIFE.shore) return false;
    if (loose) return true;
    const band = body.above;
    return !band || (above >= band[0] && above <= band[1]);
  }

  /** True when the ground round a spot is level enough to put a herd of the land on; always true for the sea and the air. */
  private level(body: Species, x: number, z: number): boolean {
    if (body.realm !== 'land') return true;
    const near = WILDLIFE.flatWithin;
    const here = this.world.surfaceAt(x, z);
    return (
      Math.abs(this.world.surfaceAt(x + near, z) - here) <= near &&
      Math.abs(this.world.surfaceAt(x - near, z) - here) <= near &&
      Math.abs(this.world.surfaceAt(x, z + near) - here) <= near &&
      Math.abs(this.world.surfaceAt(x, z - near) - here) <= near
    );
  }

  /** True when a creature of the species could be put at a spot: dry clear ground, water, or air. */
  private standable(body: Species, x: number, z: number): boolean {
    const half = this.world.half - WILDLIFE.margin * 0.5;
    if (Math.abs(x) > half || Math.abs(z) > half) return false;
    if (body.realm === 'air') return true;
    const ground = this.world.surfaceAt(x, z);
    if (body.realm === 'water') return this.world.waterLevel - ground >= (body.depth ?? 0);
    return ground >= this.world.waterLevel + WILDLIFE.shore && !this.blocked(body, x, z, ground);
  }

  /** True when a block the crew built stands where the body of a land creature would be. */
  private blocked(body: Species, x: number, z: number, ground: number): boolean {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    const low = Math.floor(ground + EPSILON);
    const high = Math.max(low, Math.floor(ground + body.hitbox.height - EPSILON));
    for (let y = low; y <= high; y++) {
      if (this.world.solids.isSolid(cx, y, cz)) return true;
    }
    return false;
  }

  /**
   * True when a creature at (x, z) can go to (tx, tz) at its pace: the ground there is dry and clear,
   * and no steeper than the creature climbs over the distance it goes. A creature that is already in
   * a block somebody just built may step out into any clear cell.
   */
  private canStand(c: Creature, tx: number, tz: number, travel: number): boolean {
    const body = c.body;
    const half = this.world.half - WILDLIFE.margin * 0.5;
    if (Math.abs(tx) > half || Math.abs(tz) > half) return false;
    if (body.realm === 'air') return true;
    const ground = this.world.surfaceAt(tx, tz);
    if (body.realm === 'water') return this.world.waterLevel - ground >= (body.depth ?? 0);
    if (ground < this.world.waterLevel + WILDLIFE.shore) return false;
    if (this.blocked(body, tx, tz, ground)) return false;
    return (
      Math.abs(ground - c.y) <= body.climb * travel + 0.03 || this.blocked(body, c.x, c.z, c.y)
    );
  }

  /** True when a straight walk from one spot to another stays on ground the species may walk, for the samples along it. */
  private openLine(body: Species, x0: number, z0: number, x1: number, z1: number): boolean {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(length / LINE_STEP);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      if (!this.habitable(body, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, true)) return false;
    }
    return true;
  }

  /**
   * Where the feet of a creature rest at a spot: the ground for a land creature, a swim under the
   * water's surface for a swimmer, and a flight over the ground for a flier. Swimmers and fliers
   * bob a little with the clock, each in its own time.
   */
  private levelAt(c: Creature, x: number, z: number): number {
    const body = c.body;
    const ground = this.world.surfaceAt(x, z);
    if (body.realm === 'land') return ground;
    const wave = 0.5 + 0.5 * Math.sin(this.clock * 0.4 + c.phase);
    if (body.realm === 'water') {
      const [low, high] = body.level ?? [0.5, 1];
      const top = this.world.waterLevel - (low + (high - low) * wave);
      return Math.max(ground + 0.1, top - body.hitbox.height);
    }
    const [low, high] = body.level ?? [4, 8];
    const base = Math.max(ground, this.world.waterLevel);
    return base + low + (high - low) * wave;
  }

  // --------------------------------------------------------------------------------------------
  // Moving.
  // --------------------------------------------------------------------------------------------

  /** Turns toward a point as far as the turn rate allows. Returns how far it still has to turn, in radians. */
  private face(c: Creature, tx: number, tz: number, dt: number, scale: number): number {
    const dx = tx - c.x;
    const dz = tz - c.z;
    if (dx * dx + dz * dz < 1e-8) return 0;
    const delta = angleDelta(c.yaw, Math.atan2(dx, dz));
    const most = c.body.turnRate * scale * dt;
    const applied = Math.max(-most, Math.min(most, delta));
    c.yaw = wrapAngle(c.yaw + applied);
    return delta - applied;
  }

  /**
   * Turns toward a point and moves toward it as far as the turn rate, `speed` and the ground allow.
   * A walker or a swimmer that is turned well away stands and turns first; a flier cannot stop, so it
   * slows through a sharp turn instead. A body that meets something it cannot stand on slides along
   * it if it can. How long it has been blocked is counted in `stuck`.
   */
  private steer(
    c: Creature,
    gx: number,
    gz: number,
    speed: number,
    dt: number,
    turn: number,
  ): void {
    const body = c.body;
    const flies = body.realm === 'air';
    const dx = gx - c.x;
    const dz = gz - c.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.02 && !flies) return;
    const left = Math.abs(this.face(c, gx, gz, dt, turn));
    if (!flies && left > WILDLIFE.turnFirst) {
      this.settle(c, dt);
      return;
    }
    const pace = flies ? Math.max(MIN_FLIGHT_PACE, Math.cos(Math.min(left, 1.2))) : Math.cos(left);
    const travel = flies ? speed * dt * pace : Math.min(distance, speed * dt * pace);
    const mx = Math.sin(c.yaw) * travel;
    const mz = Math.cos(c.yaw) * travel;
    const fromX = c.x;
    const fromZ = c.z;
    if (this.canStand(c, fromX + mx, fromZ + mz, travel)) {
      c.x = fromX + mx;
      c.z = fromZ + mz;
    } else if (Math.abs(mx) >= Math.abs(mz)) {
      // Along a wall: take the part of the move that it allows.
      if (this.canStand(c, fromX + mx, fromZ, Math.abs(mx))) c.x = fromX + mx;
      else if (this.canStand(c, fromX, fromZ + mz, Math.abs(mz))) c.z = fromZ + mz;
    } else if (this.canStand(c, fromX, fromZ + mz, Math.abs(mz))) {
      c.z = fromZ + mz;
    } else if (this.canStand(c, fromX + mx, fromZ, Math.abs(mx))) {
      c.x = fromX + mx;
    }
    const moved = Math.hypot(c.x - fromX, c.z - fromZ);
    c.speed = moved / dt;
    if (travel > 0 && moved < travel * 0.25) c.stuck += dt;
    else c.stuck = Math.max(0, c.stuck - dt);
    this.settle(c, dt);
  }

  /** Puts a creature at the height its realm gives it at the spot it stands on. */
  private settle(c: Creature, dt: number): void {
    const body = c.body;
    if (body.realm === 'land') {
      c.y = this.world.surfaceAt(c.x, c.z);
      return;
    }
    let target: number;
    let most: number;
    if (body.realm === 'water') {
      target = this.levelAt(c, c.x, c.z);
      most = CLIMB.water * dt;
    } else if (!Number.isNaN(c.dive)) {
      // A flier going for a player comes down to them: its underside is level with their chest.
      target = c.dive;
      most = CLIMB.dive * dt;
    } else {
      // Over the highest of the ground here and a little ahead, so it is already rising when it comes to a hill.
      const ahead = this.world.surfaceAt(c.x + Math.sin(c.yaw) * 4, c.z + Math.cos(c.yaw) * 4);
      const base = Math.max(this.world.surfaceAt(c.x, c.z), ahead, this.world.waterLevel);
      const [low, high] = body.level ?? [4, 8];
      const wave = 0.5 + 0.5 * Math.sin(this.clock * 0.2 + c.phase);
      target = base + low + (high - low) * wave;
      most = (c.alarm > 0 ? CLIMB.alarmedAir : CLIMB.air) * dt;
    }
    c.y += Math.max(-most, Math.min(most, target - c.y));
  }

  /** Pushes creatures of one realm that overlap apart, so a herd spreads out instead of standing in one spot. */
  private crowd(): void {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as Creature;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j] as Creature;
        if (a.body.realm !== b.body.realm) continue;
        const need = a.body.radius + b.body.radius;
        const dx = b.x - a.x;
        if (dx > need || dx < -need) continue;
        const dz = b.z - a.z;
        const squared = dx * dx + dz * dz;
        if (squared >= need * need) continue;
        const distance = Math.sqrt(squared);
        // Two on one spot part along an axis that depends on who they are.
        const ux = distance > 1e-6 ? dx / distance : (a.id & 1) === 0 ? 1 : 0;
        const uz = distance > 1e-6 ? dz / distance : (a.id & 1) === 0 ? 0 : 1;
        const push = Math.min(WILDLIFE.crowdMax, (need - distance) * WILDLIFE.crowdPush);
        this.shove(a, -ux * push, -uz * push);
        this.shove(b, ux * push, uz * push);
      }
    }
  }

  private shove(c: Creature, dx: number, dz: number): void {
    if (c.body.realm !== 'air' && !this.canStand(c, c.x + dx, c.z + dz, Math.hypot(dx, dz))) return;
    c.x += dx;
    c.z += dz;
    if (c.body.realm === 'land') c.y = this.world.surfaceAt(c.x, c.z);
  }

  // --------------------------------------------------------------------------------------------
  // Odds and ends.
  // --------------------------------------------------------------------------------------------

  /** A number from `low` up to but not including `high`; a whole one when `whole` is set. */
  private between(low: number, high: number, whole: boolean): number {
    const value = low + this.rng() * (high - low);
    return whole ? Math.floor(value) : value;
  }

  /** The next id nobody is using. Ids count up and wrap at 65535, which is what the wire holds. */
  private takeId(): number {
    for (;;) {
      const id = this.nextId;
      this.nextId = this.nextId >= 0xffff ? 1 : this.nextId + 1;
      if (!this.byId.has(id)) return id;
    }
  }
}
