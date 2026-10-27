import type { CellState } from '../../shared/block-world';
import { stateMaterial } from '../../shared/blocks';
import type { SolidQuery } from '../../shared/solid';
import { CORE_FOOTPRINT, type Outpost } from '../../world/outpost';
import { ENEMIES } from './balance';

/**
 * How the enemies find their way: the ground round the Core cut into columns one block square,
 * and for every column the length of the cheapest walk from it to the Core. An enemy reads the
 * field by stepping to the neighbour with the lowest number. It is pure (no DOM, no three.js), so
 * the host's simulation, a test and a Worker all get the same routes.
 *
 * What the ground is, for a body of a given size:
 * - **blocked**: water that is too deep, the edge of the valley, or terrain too steep to climb
 *   (any step between neighbours taller than the body can climb);
 * - **open**: nothing a player built stands in the body's way;
 * - **walled**: blocks stand where the body would be. The enemy cannot walk through, but it can
 *   chew its way in, so the column stays on the map at the price of the chewing. A wall that
 *   costs less to chew than the walk round it is chewed through, so a Core that is walled in on
 *   every side is still reached, and a crew learns that walls buy time and do not end a night;
 * - **core**: the Core's own footprint, which is the goal.
 *
 * Enemies walk on the ground: a block on the ground is a wall, whatever its height, and nothing
 * above head height matters, so they pass under a bridge. They do not climb structures.
 */

export const NAV_BLOCKED = 0;
export const NAV_OPEN = 1;
export const NAV_WALLED = 2;
export const NAV_CORE = 3;
export type NavState = typeof NAV_BLOCKED | typeof NAV_OPEN | typeof NAV_WALLED | typeof NAV_CORE;

/** What the map is made from. The valley provides it; a test provides a flat plane. */
export interface NavWorld {
  /** The blocks players have built (and the Core), as the movement code sees them. */
  readonly solids: SolidQuery;
  /** What a cell holds: 0 when it is empty, otherwise the packed shape and material of the block. */
  blockAt(x: number, y: number, z: number): CellState;
  /** Where feet rest on the terrain at a point, rocks included. */
  surfaceAt(x: number, z: number): number;
  /** The height of the water's surface. */
  readonly waterLevel: number;
  /** The valley runs from `-half` to `half` in x and z. */
  readonly half: number;
}

/** The size and strength of the body the map is made for, in blocks and seconds. */
export interface NavBody {
  /** Height of the body: blocks in the way anywhere up to this far above the ground are a wall. */
  readonly height: number;
  /** The tallest step it climbs. */
  readonly step: number;
  /** Blocks a second on level ground, which turns the time spent chewing a block into the length of a walk. */
  readonly speed: number;
  /** Seconds to chew through one block of a material. */
  gnawSeconds(material: number): number;
}

export function crawlerBody(): NavBody {
  const crawler = ENEMIES.crawler;
  return {
    height: crawler.height,
    step: crawler.step,
    speed: crawler.speed,
    gnawSeconds: (material) => crawler.gnawSeconds[material] ?? crawler.gnawDefault,
  };
}

/** A cell, for the place where a wall is chewed. */
export interface NavCell {
  x: number;
  y: number;
  z: number;
}

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const DZ = [0, 0, 1, -1, 1, -1, 1, -1] as const;
const DIAGONAL_FROM = 4;
/** Lines are checked this often, in blocks: shorter than the chord of any cell a line clips. */
const LINE_STEP = 0.3;
/** A line keeps this far from walls, so a body that is wider than a point does not scrape them. */
const LINE_MARGIN = 0.32;
/** Cells at the edge of the valley are not walked on: the world's invisible wall stands a block inside it. */
const EDGE_MARGIN = 1.5;
/** A tiny amount, so a ground that sits exactly on a cell boundary is counted in the cell above it. */
const EPSILON = 1e-4;

/** A binary min-heap of columns by the length of the walk to them, on typed arrays so a solve allocates nothing. */
class Frontier {
  private keys = new Float64Array(2048);
  private items = new Int32Array(2048);
  size = 0;
  /** The column and the cost `pop` last took off the heap. */
  item = 0;
  key = 0;

  clear(): void {
    this.size = 0;
  }

  push(item: number, key: number): void {
    if (this.size === this.keys.length) this.grow();
    let at = this.size++;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if ((this.keys[parent] as number) <= key) break;
      this.keys[at] = this.keys[parent] as number;
      this.items[at] = this.items[parent] as number;
      at = parent;
    }
    this.keys[at] = key;
    this.items[at] = item;
  }

  pop(): void {
    this.item = this.items[0] as number;
    this.key = this.keys[0] as number;
    const last = --this.size;
    if (last === 0) return;
    const key = this.keys[last] as number;
    const item = this.items[last] as number;
    let at = 0;
    for (;;) {
      let child = 2 * at + 1;
      if (child >= last) break;
      if (child + 1 < last && (this.keys[child + 1] as number) < (this.keys[child] as number)) {
        child++;
      }
      if ((this.keys[child] as number) >= key) break;
      this.keys[at] = this.keys[child] as number;
      this.items[at] = this.items[child] as number;
      at = child;
    }
    this.keys[at] = key;
    this.items[at] = item;
  }

  private grow(): void {
    const keys = new Float64Array(this.keys.length * 2);
    const items = new Int32Array(this.items.length * 2);
    keys.set(this.keys);
    items.set(this.items);
    this.keys = keys;
    this.items = items;
  }
}

export class NavGrid {
  /** Columns along each side of the map. */
  readonly side: number;
  /** The cell column the first column of the map stands on, in x and z. */
  readonly minX: number;
  readonly minZ: number;
  /** The ground's height at the middle of each column. */
  readonly ground: Float32Array;
  /** What each column is: `NAV_BLOCKED`, `NAV_OPEN`, `NAV_WALLED` or `NAV_CORE`. */
  readonly state: Uint8Array;

  /** What it costs to cross each column on the way to the Core: the chewing, in blocks of walking. */
  private readonly crossing: Float32Array;
  /**
   * The length of the cheapest walk from each column to the Core, or Infinity where there is none.
   * Doubles, not floats: `solve` compares a number it just worked out against the one it stored,
   * and a float that rounds down would make the column look already beaten and never spread from it.
   */
  private readonly cost: Float64Array;
  /** The next column along that walk, or -1 at the Core and where there is no way. */
  private readonly next: Int32Array;
  private readonly frontier = new Frontier();
  /** The columns of the route `aim` is looking down, kept here so looking allocates nothing. */
  private readonly route = new Int32Array(64);
  /** Seconds since the routes were last worked out. */
  private sinceSolve = Infinity;
  private solveDue = false;

  constructor(
    private readonly world: NavWorld,
    private readonly core: Outpost,
    private readonly body: NavBody = crawlerBody(),
    radius: number = ENEMIES.navRadius,
  ) {
    this.side = Math.ceil(radius) * 2 + 1;
    this.minX = Math.floor(core.x) - Math.ceil(radius);
    this.minZ = Math.floor(core.z) - Math.ceil(radius);
    const count = this.side * this.side;
    this.ground = new Float32Array(count);
    this.state = new Uint8Array(count);
    this.crossing = new Float32Array(count);
    this.cost = new Float64Array(count);
    this.next = new Int32Array(count);
    for (let i = 0; i < count; i++) this.refreshColumn(i);
    this.solve();
  }

  // --------------------------------------------------------------------------------------------
  // Columns.
  // --------------------------------------------------------------------------------------------

  /** The column holding the point, or -1 when it is off the map. */
  indexAt(x: number, z: number): number {
    return this.indexOfCell(Math.floor(x), Math.floor(z));
  }

  indexOfCell(cx: number, cz: number): number {
    const ix = cx - this.minX;
    const iz = cz - this.minZ;
    if (ix < 0 || iz < 0 || ix >= this.side || iz >= this.side) return -1;
    return iz * this.side + ix;
  }

  /** The cell column of a column, written into `out` as x and z. */
  cellOf(index: number, out: { x: number; z: number }): void {
    out.x = (index % this.side) + this.minX;
    out.z = Math.floor(index / this.side) + this.minZ;
  }

  /** What the column holding the point is, or `NAV_BLOCKED` off the map. */
  stateAt(x: number, z: number): NavState {
    const i = this.indexAt(x, z);
    return i < 0 ? NAV_BLOCKED : (this.state[i] as NavState);
  }

  /** The length of the cheapest walk from the point to the Core, or Infinity where there is none. */
  costAt(x: number, z: number): number {
    const i = this.indexAt(x, z);
    return i < 0 ? Infinity : (this.cost[i] as number);
  }

  costOf(index: number): number {
    return this.cost[index] as number;
  }

  /** The next column along the walk from this one, or -1. */
  nextOf(index: number): number {
    return this.next[index] as number;
  }

  /** The height of the ground at a point, from the columns round it. Off the map it is the terrain's own. */
  heightAt(x: number, z: number): number {
    const fx = x - 0.5;
    const fz = z - 0.5;
    const cx = Math.floor(fx);
    const cz = Math.floor(fz);
    const u = fx - cx;
    const v = fz - cz;
    const a = this.indexOfCell(cx, cz);
    const b = this.indexOfCell(cx + 1, cz);
    const c = this.indexOfCell(cx, cz + 1);
    const d = this.indexOfCell(cx + 1, cz + 1);
    if (a < 0 || b < 0 || c < 0 || d < 0) return this.world.surfaceAt(x, z);
    const g = this.ground;
    const near = (g[a] as number) * (1 - u) + (g[b] as number) * u;
    const far = (g[c] as number) * (1 - u) + (g[d] as number) * u;
    return near * (1 - v) + far * v;
  }

  /**
   * How high the ground is (the water's surface over a lake), or the top of the highest block that
   * stands in the cell column holding the point, looking up to `scan` rows above that. The Core's own
   * blocks count unless `withCore` is false. A machine that flies reads it to keep clear of walls, roofs
   * and water. It asks the world, not the columns, so it is right about what is built this moment and
   * for points off the map too.
   */
  coverAt(x: number, z: number, scan: number, withCore = true): number {
    const ground = Math.max(this.heightAt(x, z), this.world.waterLevel);
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    const low = Math.floor(ground + EPSILON);
    for (let y = low + scan; y >= low; y--) {
      if (!this.world.solids.isSolid(cx, y, cz)) continue;
      if (!withCore && this.core.contains(cx, y, cz)) continue;
      return Math.max(ground, y + 1);
    }
    return ground;
  }

  // --------------------------------------------------------------------------------------------
  // Changes.
  // --------------------------------------------------------------------------------------------

  /**
   * A block was placed or broken. The column it stands in is read again at once, so what an enemy
   * bumps into is right; the routes follow within `ENEMIES.navRefreshSeconds`.
   */
  cellChanged(x: number, y: number, z: number): void {
    const i = this.indexOfCell(x, z);
    if (i < 0) return;
    // A cell far above any body in the column cannot matter.
    if (y > (this.ground[i] as number) + this.body.height + 2) return;
    this.refreshColumn(i);
    this.solveDue = true;
  }

  /** Lets time pass, and works the routes out again if something changed and it has been long enough. */
  advance(seconds: number): void {
    this.sinceSolve += seconds;
    if (this.solveDue && this.sinceSolve >= ENEMIES.navRefreshSeconds) this.solve();
  }

  /** True while a change is waiting for the routes to be worked out again. */
  get stale(): boolean {
    return this.solveDue;
  }

  /** Works the routes out now, whether or not anything changed. */
  solve(): void {
    const { side, state, ground, cost, next, crossing, frontier } = this;
    cost.fill(Infinity);
    next.fill(-1);
    frontier.clear();
    for (let i = 0; i < state.length; i++) {
      if (state[i] === NAV_CORE) {
        cost[i] = 0;
        frontier.push(i, 0);
      }
    }
    const climb = this.body.step;
    while (frontier.size > 0) {
      frontier.pop();
      const from = frontier.item;
      const at = frontier.key;
      if (at > (cost[from] as number)) continue;
      const ix = from % side;
      const iz = (from - ix) / side;
      // The walk from a neighbour passes through this column, so it pays this column's chewing.
      const through = at + (crossing[from] as number);
      for (let k = 0; k < 8; k++) {
        const jx = ix + (DX[k] as number);
        const jz = iz + (DZ[k] as number);
        if (jx < 0 || jz < 0 || jx >= side || jz >= side) continue;
        const to = jz * side + jx;
        const kind = state[to] as number;
        if (kind === NAV_BLOCKED || kind === NAV_CORE) continue;
        const diagonal = k >= DIAGONAL_FROM;
        if (diagonal) {
          // Cutting a corner needs both columns beside it to be clear, and the walk to be an easy
          // one through either: a body that clips the corner of a cliff does not get past it.
          const a = iz * side + jx;
          const b = jz * side + ix;
          if (state[a] !== NAV_OPEN || state[b] !== NAV_OPEN) continue;
          const here = ground[from] as number;
          const there = ground[to] as number;
          const viaA = ground[a] as number;
          const viaB = ground[b] as number;
          if (
            Math.abs(here - viaA) > climb ||
            Math.abs(viaA - there) > climb ||
            Math.abs(here - viaB) > climb ||
            Math.abs(viaB - there) > climb
          ) {
            continue;
          }
        }
        const rise = Math.abs((ground[to] as number) - (ground[from] as number));
        if (rise > climb * (diagonal ? SQRT2 : 1)) continue;
        const total = through + (diagonal ? SQRT2 : 1);
        if (total < (cost[to] as number)) {
          cost[to] = total;
          next[to] = from;
          frontier.push(to, total);
        }
      }
    }
    this.sinceSolve = 0;
    this.solveDue = false;
  }

  // --------------------------------------------------------------------------------------------
  // Walking.
  // --------------------------------------------------------------------------------------------

  /**
   * Where to head from a point: the farthest spot along the route, up to `lookAhead` steps on,
   * that can be reached in a straight line over open ground. Written into `out` as x and z (the
   * middle of that column). False where the point is off the map or has no way to the Core.
   */
  aim(x: number, z: number, lookAhead: number, out: { x: number; z: number }): boolean {
    const start = this.indexAt(x, z);
    if (start < 0 || !Number.isFinite(this.cost[start] as number)) return false;
    // The route, as far as we look.
    const route = this.route;
    const limit = Math.min(lookAhead, route.length);
    let length = 0;
    let at = start;
    while (length < limit) {
      const to = this.next[at] as number;
      if (to < 0) break;
      route[length++] = to;
      at = to;
    }
    if (length === 0) return false;
    for (let k = length - 1; k >= 0; k--) {
      const to = route[k] as number;
      const kind = this.state[to] as number;
      // The Core and a wall are not places to walk to in a line; they are where the route ends.
      if (kind !== NAV_OPEN) continue;
      const tx = (to % this.side) + this.minX + 0.5;
      const tz = Math.floor(to / this.side) + this.minZ + 0.5;
      if (k === 0 || this.lineClear(x, z, tx, tz)) {
        out.x = tx;
        out.z = tz;
        return true;
      }
    }
    // The next column on the route is a wall or the Core: stand against it.
    const to = route[0] as number;
    out.x = (to % this.side) + this.minX + 0.5;
    out.z = Math.floor(to / this.side) + this.minZ + 0.5;
    return true;
  }

  /** True when a body can walk from one point to another in a straight line over open ground it can climb. */
  lineClear(x0: number, z0: number, x1: number, z1: number): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const length = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(length / LINE_STEP));
    let previous = this.indexAt(x0, z0);
    let previousHeight = previous < 0 ? 0 : (this.ground[previous] as number);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const x = x0 + dx * t;
      const z = z0 + dz * t;
      if (!this.pointClear(x, z)) return false;
      const here = this.indexAt(x, z);
      if (here !== previous) {
        const height = this.ground[here] as number;
        if (Math.abs(height - previousHeight) > this.body.step * SQRT2) return false;
        previous = here;
        previousHeight = height;
      }
    }
    return true;
  }

  /**
   * True when the column at the point, and the ones a body's width to each side of it, are open and
   * no higher or lower than the body climbs: a point at the foot of a cliff is not clear.
   */
  pointClear(x: number, z: number): boolean {
    const here = this.indexAt(x, z);
    if (here < 0 || this.state[here] !== NAV_OPEN) return false;
    const height = this.ground[here] as number;
    return (
      this.sideClear(x + LINE_MARGIN, z, height) &&
      this.sideClear(x - LINE_MARGIN, z, height) &&
      this.sideClear(x, z + LINE_MARGIN, height) &&
      this.sideClear(x, z - LINE_MARGIN, height)
    );
  }

  /**
   * True when a body standing at one point can step to another: the other is in open ground, and in
   * the same column or one that is no higher or lower than the body climbs.
   */
  canEnter(fromX: number, fromZ: number, x: number, z: number): boolean {
    const to = this.indexAt(x, z);
    if (to < 0 || this.state[to] !== NAV_OPEN) return false;
    const from = this.indexAt(fromX, fromZ);
    if (from < 0) return false;
    return (
      from === to ||
      Math.abs((this.ground[to] as number) - (this.ground[from] as number)) <= this.body.step
    );
  }

  private sideClear(x: number, z: number, from: number): boolean {
    const there = this.indexAt(x, z);
    return (
      there >= 0 &&
      this.state[there] === NAV_OPEN &&
      Math.abs((this.ground[there] as number) - from) <= this.body.step
    );
  }

  /**
   * The block to chew first to get through a walled column: the lowest one in the way of a body
   * standing on it. False when nothing stands in the way (it was broken a moment ago).
   */
  wallCell(index: number, out: NavCell): boolean {
    const x = (index % this.side) + this.minX;
    const z = Math.floor(index / this.side) + this.minZ;
    const [low, high] = this.bodyCells(this.ground[index] as number);
    for (let y = low; y <= high; y++) {
      if (this.world.solids.isSolid(x, y, z) && !this.core.contains(x, y, z)) {
        out.x = x;
        out.y = y;
        out.z = z;
        return true;
      }
    }
    return false;
  }

  /** Seconds a crawler takes to chew through the block in a cell. */
  gnawSeconds(x: number, y: number, z: number): number {
    return this.body.gnawSeconds(stateMaterial(this.world.blockAt(x, y, z)));
  }

  // --------------------------------------------------------------------------------------------
  // Reading the world.
  // --------------------------------------------------------------------------------------------

  /** The lowest and highest cell rows a body standing on ground at this height fills. */
  private bodyCells(height: number): [number, number] {
    return [
      Math.floor(height + EPSILON),
      Math.max(Math.floor(height + EPSILON), Math.floor(height + this.body.height - EPSILON)),
    ];
  }

  private refreshColumn(index: number): void {
    const x = (index % this.side) + this.minX;
    const z = Math.floor(index / this.side) + this.minZ;
    const half = this.world.half - EDGE_MARGIN;
    this.crossing[index] = 0;
    if (this.inCore(x, z)) {
      this.ground[index] = this.world.surfaceAt(x + 0.5, z + 0.5);
      this.state[index] = NAV_CORE;
      return;
    }
    const centerX = x + 0.5;
    const centerZ = z + 0.5;
    const height = this.world.surfaceAt(centerX, centerZ);
    this.ground[index] = height;
    if (
      Math.abs(centerX) > half ||
      Math.abs(centerZ) > half ||
      height < this.world.waterLevel - ENEMIES.wadeDepth
    ) {
      this.state[index] = NAV_BLOCKED;
      return;
    }
    const [low, high] = this.bodyCells(height);
    let chewing = 0;
    let walled = false;
    for (let y = low; y <= high; y++) {
      if (!this.world.solids.isSolid(x, y, z)) continue;
      walled = true;
      chewing += this.gnawSeconds(x, y, z) * this.body.speed;
    }
    this.state[index] = walled ? NAV_WALLED : NAV_OPEN;
    this.crossing[index] = chewing;
  }

  private inCore(x: number, z: number): boolean {
    return (
      x >= this.core.cellX &&
      x < this.core.cellX + CORE_FOOTPRINT &&
      z >= this.core.cellZ &&
      z < this.core.cellZ + CORE_FOOTPRINT
    );
  }
}
