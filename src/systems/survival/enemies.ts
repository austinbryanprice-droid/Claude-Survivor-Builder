import {
  ENEMY_FLAG,
  ENEMY_HEALTH_FULL,
  ENEMY_KIND,
  type EnemyState,
} from '../../shared/enemy-state';
import { createRng, hash32 } from '../../shared/hash';
import { angleDelta, wrapAngle } from '../../shared/look';
import { CORE_FOOTPRINT, type Outpost } from '../../world/outpost';
import { ENEMIES, bodyOf, type EnemyBody } from './balance';
import { NAV_WALLED, type NavCell, type NavGrid } from './nav';

/**
 * The machines that come for the Core, as the host simulates them: where each one is, whom it is
 * after, when it bites, and which wall it is chewing. It is pure (no DOM, no three.js, no
 * network) and takes fixed steps from the survival simulation, so a Worker, a test and the
 * browser all play the same night.
 *
 * An enemy does one of four things each step, in this order of preference:
 * - **bite**: a player or the Core is within reach, so it stands, faces it, winds up and bites;
 * - **chase**: a player is near and can be walked to in a straight line, so it goes for them;
 * - **chew**: the next column on its way to the Core is a wall that is cheaper to chew than to go
 *   round (the map says so), so it works at the lowest block of that wall until it gives;
 * - **march**: otherwise it follows the map's route to the Core.
 *
 * The map (`NavGrid`) knows the ground and what players have built on it; this class only moves
 * bodies over it. Every enemy is a point with a radius: it never leaves the columns the map calls
 * open, so it cannot walk into water, up a cliff or through a wall. What an enemy is, its speed,
 * its bite and how much of a hit it takes, is the body of its kind (`bodyOf`).
 */

/** What a bite is aimed at: nothing, the Core, or (a positive number) the player with that id. */
const BITE_NOTHING = 0;
const BITE_CORE = -1;

/** An enemy that is turned this far from where it wants to go stands and turns before it walks. */
const TURN_FIRST = 1.2;
/** A new enemy is placed by trying this many spots on the ring before giving up. */
const SPAWN_ATTEMPTS = 24;
/** The first of those tries stay in the arc a wave comes from, if it has one. */
const SPAWN_ATTEMPTS_IN_ARC = 16;
/** Crowding pushes each of two overlapping enemies this part of the way out of each other each step. */
const CROWD_PUSH = 0.35;
/** A wind-up this close to nothing is over: the sum of 0.05-second steps does not land exactly on 0.4. */
const WINDUP_EPSILON = 1e-6;
const TWO_PI = Math.PI * 2;

/** Someone an enemy may go after: a player who is in the world and not down. */
export interface Target {
  id: number;
  x: number;
  y: number;
  z: number;
}

/** What a bite does to the world. The survival simulation answers it. */
export interface Strikes {
  /** Wounds a player; returns the points it took. */
  hurtPlayer(id: number, amount: number): number;
  /** Wounds the Core; returns true when this blow felled it. */
  hurtCore(amount: number): boolean;
}

export interface EnemySimOptions {
  /** The Core: the goal, and what they bite. */
  readonly core: Outpost;
  /** The world's seed. Where enemies appear is drawn from it, so the same seed plays the same spawns. */
  readonly seed: number;
}

/** Where the machines of one wave come from, and the numbers that decide it. */
export interface SpawnPlan {
  /** Draws the numbers for each try. The simulation's own stream when omitted. */
  readonly rng?: () => number;
  /**
   * The middle of the stretch of the ring they come from, as an angle round the Core, and half its
   * width in radians. Anywhere on the ring when omitted; a wave whose stretch has no ground to
   * stand on (the lake, a cliff) spreads out to the rest of the ring for its last tries.
   */
  readonly bearing?: number;
  readonly arc?: number;
}

interface Enemy {
  readonly id: number;
  readonly kind: number;
  /** What its kind is: read from the table once, when it comes. */
  readonly body: EnemyBody;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  readonly maxHealth: number;
  /** Seconds left of the wind-up of a bite; 0 when it is not biting. */
  windup: number;
  /** Seconds before it may begin its next bite. */
  cooldown: number;
  /** What the wind-up is aimed at. */
  biting: number;
  /** The player it is chasing, or 0. */
  chasing: number;
  /** Seconds left of the flash a blow gave it. */
  hurt: number;
  /** Blocks a second it covered in the last step. */
  speed: number;
}

/** The cell a chewed block was in. Players build inside a few hundred cells of the middle, so a number holds it. */
function cellKey(x: number, y: number, z: number): number {
  return ((x + 512) * 1024 + (z + 512)) * 256 + (y & 255);
}

export class EnemySim {
  private readonly list: Enemy[] = [];
  private readonly byId = new Map<number, Enemy>();
  private readonly rng: () => number;
  private nextId = 1;
  private changes = 0;

  /**
   * Called with the kind of every machine that a blow fells, once, as it falls (and not for machines that
   * fall back at dawn). The survival simulation hangs the drops of the special kinds on it.
   */
  onFelled: ((kind: number) => void) | null = null;

  /** How far each wall block has been chewed, from 0 to 1, keyed by cell. */
  private readonly chewed = new Map<number, number>();
  private readonly touched = new Set<number>();
  private readonly breaks: NavCell[] = [];

  // Scratch values, so a step allocates nothing.
  private readonly aimPoint = { x: 0, z: 0 };
  private readonly cell: NavCell = { x: 0, y: 0, z: 0 };
  private goalX = 0;
  private goalZ = 0;

  constructor(
    readonly nav: NavGrid,
    private readonly options: EnemySimOptions,
  ) {
    this.rng = createRng(hash32(options.seed ^ 0x5eed5eed));
  }

  /** How many are alive. */
  get count(): number {
    return this.list.length;
  }

  /** Counts every change that does not come from a step (a spawn, a blow, a clear), so a watcher can tell. */
  get revision(): number {
    return this.changes;
  }

  /**
   * Brings `count` machines of a kind (crawlers unless it says otherwise) in from the ring round the
   * Core, or as many as fit under the cap and find a place. Returns how many came.
   */
  spawn(
    count: number,
    healthScale = 1,
    plan?: SpawnPlan,
    kind: number = ENEMY_KIND.crawler,
  ): number {
    let made = 0;
    while (made < count && this.list.length < ENEMIES.maxAlive) {
      if (!this.spawnOne(healthScale, plan, kind)) break;
      made++;
    }
    return made;
  }

  /** Puts a machine at a spot, for tests and the debug page. Null where there is no room for it. */
  spawnAt(x: number, z: number, healthScale = 1, kind: number = ENEMY_KIND.crawler): number | null {
    if (this.list.length >= ENEMIES.maxAlive) return null;
    if (!this.nav.pointClear(x, z)) return null;
    const core = this.options.core;
    return this.add(x, z, Math.atan2(core.x - x, core.z - z), healthScale, kind).id;
  }

  /** True while the enemy with this id is alive. */
  has(id: number): boolean {
    return this.byId.has(id);
  }

  /**
   * Calls `visit` with the id, kind and feet of every enemy alive, in the order they came. `visit`
   * must not wound or remove an enemy: that changes the list under the loop.
   */
  forEach(visit: (id: number, kind: number, x: number, y: number, z: number) => void): void {
    for (let i = 0; i < this.list.length; i++) {
      const enemy = this.list[i] as Enemy;
      visit(enemy.id, enemy.kind, enemy.x, enemy.y, enemy.z);
    }
  }

  /**
   * Wounds an enemy by a blow of `amount` points, of which it takes the share its body takes (plating
   * turns some away); true when this blow killed it. Nothing happens for an enemy that is not here.
   */
  hurt(id: number, amount: number): boolean {
    const enemy = this.byId.get(id);
    if (!enemy || !(amount > 0)) return false;
    enemy.health -= amount * enemy.body.takes;
    enemy.hurt = ENEMIES.hurtFlashSeconds;
    this.changes++;
    if (enemy.health > 0) return false;
    this.remove(enemy);
    this.onFelled?.(enemy.kind);
    return true;
  }

  /** Takes every enemy off the field. */
  clear(): void {
    if (this.list.length === 0) return;
    this.list.length = 0;
    this.byId.clear();
    this.changes++;
  }

  /** Fills `out` with the enemies as the host reports them. Returns how many; `out` must hold `maxAlive`. */
  write(out: EnemyState[]): number {
    const count = Math.min(this.list.length, out.length);
    for (let i = 0; i < count; i++) {
      const enemy = this.list[i] as Enemy;
      const state = out[i] as EnemyState;
      state.id = enemy.id;
      state.kind = enemy.kind;
      state.x = enemy.x;
      state.y = enemy.y;
      state.z = enemy.z;
      state.yaw = enemy.yaw;
      state.health = Math.max(
        1,
        Math.min(
          ENEMY_HEALTH_FULL,
          Math.round((enemy.health / enemy.maxHealth) * ENEMY_HEALTH_FULL),
        ),
      );
      state.flags =
        (enemy.windup > 0 ? ENEMY_FLAG.attack : 0) | (enemy.hurt > 0 ? ENEMY_FLAG.hurt : 0);
    }
    return count;
  }

  /** A block was placed or broken: the map reads it, and any chewing of that cell starts over. */
  blockChanged(x: number, y: number, z: number): void {
    this.nav.cellChanged(x, y, z);
    this.chewed.delete(cellKey(x, y, z));
  }

  /** Moves the blocks the enemies have chewed through since the last call into `out`. The host breaks them. */
  drainBreaks(out: NavCell[]): void {
    for (const cell of this.breaks) out.push(cell);
    this.breaks.length = 0;
  }

  // --------------------------------------------------------------------------------------------
  // The step.
  // --------------------------------------------------------------------------------------------

  /**
   * Plays `dt` seconds. `targets` are the first `count` entries of the array: the players who can
   * be bitten. The host's survival simulation calls it once per fixed step.
   */
  step(dt: number, targets: readonly Target[], count: number, strikes: Strikes): void {
    this.nav.advance(dt);
    this.touched.clear();
    for (let i = 0; i < this.list.length; i++) {
      this.stepOne(this.list[i] as Enemy, dt, targets, count, strikes);
    }
    this.crowd();
    this.wearOff(dt);
  }

  private stepOne(
    e: Enemy,
    dt: number,
    targets: readonly Target[],
    count: number,
    strikes: Strikes,
  ): void {
    e.cooldown = Math.max(0, e.cooldown - dt);
    if (e.hurt > 0) e.hurt = Math.max(0, e.hurt - dt);
    e.speed = 0;

    const victim = this.victimOf(e, targets, count);
    if (victim !== BITE_NOTHING) {
      this.bite(e, victim, dt, strikes);
      return;
    }
    e.windup = 0;
    e.biting = BITE_NOTHING;

    if (this.chaseOf(e, targets, count)) {
      this.walk(e, this.goalX, this.goalZ, dt);
      return;
    }

    // On the way to the Core. A wall that is cheaper to chew than to go round stands next on the route.
    const here = this.nav.indexAt(e.x, e.z);
    if (here < 0) return;
    const next = this.nav.nextOf(here);
    if (
      next >= 0 &&
      this.nav.state[next] === NAV_WALLED &&
      this.nearColumn(e.x, e.z, next) <= ENEMIES.gnawReach
    ) {
      this.chew(e, next, dt);
      return;
    }
    if (!this.nav.aim(e.x, e.z, ENEMIES.lookAhead, this.aimPoint)) return;
    this.walk(e, this.aimPoint.x, this.aimPoint.z, dt);
  }

  // --------------------------------------------------------------------------------------------
  // Biting.
  // --------------------------------------------------------------------------------------------

  /**
   * Whom the enemy can bite from where it stands: the nearest player in reach, else the Core if
   * the Core is, else nothing. Leaves the spot it faces in `goalX` and `goalZ`.
   */
  private victimOf(e: Enemy, targets: readonly Target[], count: number): number {
    const body = e.body;
    let best = BITE_NOTHING;
    let bestSquared = body.reach.player * body.reach.player;
    for (let i = 0; i < count; i++) {
      const t = targets[i] as Target;
      if (Math.abs(t.y - e.y) > body.reach.height) continue;
      const dx = t.x - e.x;
      const dz = t.z - e.z;
      const squared = dx * dx + dz * dz;
      if (squared <= bestSquared) {
        bestSquared = squared;
        best = t.id;
        this.goalX = t.x;
        this.goalZ = t.z;
      }
    }
    if (best !== BITE_NOTHING) return best;

    const core = this.options.core;
    const nearX = Math.min(core.cellX + CORE_FOOTPRINT, Math.max(core.cellX, e.x));
    const nearZ = Math.min(core.cellZ + CORE_FOOTPRINT, Math.max(core.cellZ, e.z));
    const dx = nearX - e.x;
    const dz = nearZ - e.z;
    if (dx * dx + dz * dz > body.reach.core * body.reach.core) return BITE_NOTHING;
    // Facing the point on the wall nearest to it; from inside the footprint's shadow, the middle.
    this.goalX = dx === 0 && dz === 0 ? core.x : nearX;
    this.goalZ = dx === 0 && dz === 0 ? core.z : nearZ;
    return BITE_CORE;
  }

  private bite(e: Enemy, victim: number, dt: number, strikes: Strikes): void {
    const body = e.body;
    this.turn(e, this.goalX, this.goalZ, dt);
    // A different victim starts the wind-up again.
    if (e.biting !== victim) {
      e.biting = victim;
      e.windup = 0;
    }
    if (e.windup > 0) {
      e.windup -= dt;
      if (e.windup > WINDUP_EPSILON) return;
      e.windup = 0;
      e.cooldown = Math.max(0, body.bite.interval - body.bite.windup);
      if (victim === BITE_CORE) strikes.hurtCore(body.bite.core);
      else strikes.hurtPlayer(victim, body.bite.player);
    } else if (e.cooldown <= 0) {
      e.windup = body.bite.windup;
    }
  }

  // --------------------------------------------------------------------------------------------
  // Chewing walls.
  // --------------------------------------------------------------------------------------------

  private chew(e: Enemy, column: number, dt: number): void {
    const cell = this.cell;
    e.windup = 0;
    if (!this.nav.wallCell(column, cell)) return;
    // Face the wall it is working at.
    this.nav.cellOf(column, this.aimPoint);
    this.turn(e, this.aimPoint.x + 0.5, this.aimPoint.z + 0.5, dt);

    const key = cellKey(cell.x, cell.y, cell.z);
    const done = (this.chewed.get(key) ?? 0) + dt / this.nav.gnawSeconds(cell.x, cell.y, cell.z);
    this.touched.add(key);
    if (done < 1) {
      this.chewed.set(key, done);
      return;
    }
    // Through. The host breaks the block and tells us it is gone.
    this.chewed.delete(key);
    this.breaks.push({ x: cell.x, y: cell.y, z: cell.z });
  }

  /** Chewing nobody is working at any more wears off, so a wall mends from a half-chewed block. */
  private wearOff(dt: number): void {
    if (this.chewed.size === 0) return;
    for (const [key, done] of this.chewed) {
      if (this.touched.has(key)) continue;
      const left = done - ENEMIES.gnawRecoverPerSecond * dt;
      if (left > 0) this.chewed.set(key, left);
      else this.chewed.delete(key);
    }
  }

  // --------------------------------------------------------------------------------------------
  // Going after players.
  // --------------------------------------------------------------------------------------------

  /**
   * Picks the nearest player within the pull who can be walked to in a straight line and leaves
   * them in `goalX` and `goalZ`. A player an enemy already hunts holds it a little farther out, so
   * it does not flicker between two choices at the edge.
   */
  private chaseOf(e: Enemy, targets: readonly Target[], count: number): boolean {
    const body = e.body;
    let best = 0;
    let bestSquared = Infinity;
    for (let i = 0; i < count; i++) {
      const t = targets[i] as Target;
      const reach = t.id === e.chasing ? body.aggro * ENEMIES.aggroKeep : body.aggro;
      const dx = t.x - e.x;
      const dz = t.z - e.z;
      const squared = dx * dx + dz * dz;
      if (squared > reach * reach || squared >= bestSquared) continue;
      if (Math.abs(t.y - e.y) > body.step + body.reach.height) continue;
      if (!this.nav.lineClear(e.x, e.z, t.x, t.z)) continue;
      best = t.id;
      bestSquared = squared;
      this.goalX = t.x;
      this.goalZ = t.z;
    }
    e.chasing = best;
    return best !== 0;
  }

  // --------------------------------------------------------------------------------------------
  // Moving.
  // --------------------------------------------------------------------------------------------

  /** Turns toward a point as far as the turn rate allows. Returns how far it still has to turn, in radians. */
  private turn(e: Enemy, tx: number, tz: number, dt: number): number {
    const dx = tx - e.x;
    const dz = tz - e.z;
    if (dx * dx + dz * dz < 1e-8) return 0;
    const delta = angleDelta(e.yaw, Math.atan2(dx, dz));
    const most = e.body.turnRate * dt;
    const applied = Math.max(-most, Math.min(most, delta));
    e.yaw = wrapAngle(e.yaw + applied);
    return delta - applied;
  }

  private walk(e: Enemy, gx: number, gz: number, dt: number): void {
    const body = e.body;
    const dx = gx - e.x;
    const dz = gz - e.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.02) return;
    const left = Math.abs(this.turn(e, gx, gz, dt));
    if (left > TURN_FIRST) return;
    // A sharp turn costs speed; a straight line costs none.
    const travel = Math.min(distance, body.speed * dt * Math.cos(left));
    const mx = Math.sin(e.yaw) * travel;
    const mz = Math.cos(e.yaw) * travel;
    const fromX = e.x;
    const fromZ = e.z;
    if (this.canStand(e, fromX + mx, fromZ + mz)) {
      e.x = fromX + mx;
      e.z = fromZ + mz;
    } else if (Math.abs(mx) >= Math.abs(mz)) {
      // Along a wall: take the part of the move that the wall allows.
      if (this.canStand(e, fromX + mx, fromZ)) e.x = fromX + mx;
      else if (this.canStand(e, fromX, fromZ + mz)) e.z = fromZ + mz;
    } else if (this.canStand(e, fromX, fromZ + mz)) {
      e.z = fromZ + mz;
    } else if (this.canStand(e, fromX + mx, fromZ)) {
      e.x = fromX + mx;
    }
    e.speed = Math.hypot(e.x - fromX, e.z - fromZ) / dt;
    e.y = this.nav.heightAt(e.x, e.z);
  }

  /**
   * True when the body fits at a spot: open ground all round it that it can climb. An enemy that
   * is already stuck (a block was built beside it) may step out into any open column it can climb to.
   */
  private canStand(e: Enemy, x: number, z: number): boolean {
    if (this.nav.pointClear(x, z)) return true;
    return !this.nav.pointClear(e.x, e.z) && this.nav.canEnter(e.x, e.z, x, z);
  }

  /** Pushes enemies that overlap apart, so a crowd spreads out round the Core instead of standing in one spot. */
  private crowd(): void {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as Enemy;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j] as Enemy;
        // Two machines part when their bodies touch: the sum of their radii.
        const need = a.body.radius + b.body.radius;
        const needSquared = need * need;
        const dx = b.x - a.x;
        if (dx > need || dx < -need) continue;
        const dz = b.z - a.z;
        const squared = dx * dx + dz * dz;
        if (squared >= needSquared) continue;
        const distance = Math.sqrt(squared);
        // Two enemies on one spot part along an axis that depends on who they are.
        const ux = distance > 1e-6 ? dx / distance : (a.id & 1) === 0 ? 1 : 0;
        const uz = distance > 1e-6 ? dz / distance : (a.id & 1) === 0 ? 0 : 1;
        const push = (need - distance) * CROWD_PUSH;
        this.shove(a, -ux * push, -uz * push);
        this.shove(b, ux * push, uz * push);
      }
    }
  }

  private shove(e: Enemy, dx: number, dz: number): void {
    if (!this.canStand(e, e.x + dx, e.z + dz)) return;
    e.x += dx;
    e.z += dz;
    e.y = this.nav.heightAt(e.x, e.z);
  }

  /** How far a point is from the nearest edge of a column, in blocks: 0 inside it. */
  private nearColumn(x: number, z: number, column: number): number {
    this.nav.cellOf(column, this.aimPoint);
    const cx = this.aimPoint.x;
    const cz = this.aimPoint.z;
    const dx = Math.max(cx - x, 0, x - (cx + 1));
    const dz = Math.max(cz - z, 0, z - (cz + 1));
    return Math.hypot(dx, dz);
  }

  // --------------------------------------------------------------------------------------------
  // Coming and going.
  // --------------------------------------------------------------------------------------------

  private spawnOne(healthScale: number, plan: SpawnPlan | undefined, kind: number): boolean {
    const core = this.options.core;
    const rng = plan?.rng ?? this.rng;
    const bearing = plan?.bearing;
    const arc = plan?.arc ?? 0;
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
      // The first tries keep to the wave's stretch of the ring; the last few take any of it.
      const angle =
        bearing !== undefined && attempt < SPAWN_ATTEMPTS_IN_ARC
          ? bearing + (rng() * 2 - 1) * arc
          : rng() * TWO_PI;
      const radius = ENEMIES.spawnRadius + (rng() * 2 - 1) * ENEMIES.spawnJitter;
      const x = core.x + Math.cos(angle) * radius;
      const z = core.z + Math.sin(angle) * radius;
      const column = this.nav.indexAt(x, z);
      if (column < 0 || !Number.isFinite(this.nav.costOf(column))) continue;
      if (!this.nav.pointClear(x, z)) continue;
      this.add(x, z, Math.atan2(core.x - x, core.z - z), healthScale, kind);
      return true;
    }
    return false;
  }

  private add(x: number, z: number, yaw: number, healthScale: number, kind: number): Enemy {
    // A kind this table does not know is a crawler, so a machine always has a body.
    const known = bodyOf(kind);
    const body = known ?? ENEMIES.crawler;
    const maxHealth = body.health * healthScale;
    const enemy: Enemy = {
      id: this.takeId(),
      kind: known ? kind : ENEMY_KIND.crawler,
      body,
      x,
      y: this.nav.heightAt(x, z),
      z,
      yaw,
      health: maxHealth,
      maxHealth,
      windup: 0,
      cooldown: 0,
      biting: BITE_NOTHING,
      chasing: 0,
      hurt: 0,
      speed: 0,
    };
    this.list.push(enemy);
    this.byId.set(enemy.id, enemy);
    this.changes++;
    return enemy;
  }

  private remove(enemy: Enemy): void {
    const at = this.list.indexOf(enemy);
    if (at >= 0) this.list.splice(at, 1);
    this.byId.delete(enemy.id);
    this.changes++;
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
