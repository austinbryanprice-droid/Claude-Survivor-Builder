import {
  IDLE_ECONOMY,
  POOL_SLOTS,
  createEconomyReading,
  type DebrisNode,
  type DebrisView,
  type EconomyReading,
  type EconomyView,
  type HarvestEvent,
} from '../shared/economy';
import { NET } from '../shared/net-config';
import type { HostFrame } from '../shared/protocol';
import type { Unsubscribe } from '../shared/survival-state';
import { encodeFrame } from '../shared/wire';
import type { Economy } from '../systems/economy/economy';
import { Emitter } from './emitter';

/**
 * How the economy crosses the network: what the host tells its guests (the pool as it changes,
 * the list of heaps of debris when someone arrives, a dawn uncovers some or a run starts over, and
 * every strip as it happens), and the mirror a guest keeps of it. The host's own screen reads the
 * economy of its simulation through the same `EconomyView` a guest reads its mirror through.
 */

/** A heap of the list in its wire form: `[x, y, z, yaw, scale, harvests, grade, from, left]`. */
function heapWire(node: DebrisNode, left: number): number[] {
  return [node.x, node.y, node.z, node.yaw, node.scale, node.harvests, node.grade, node.from, left];
}

/** The heap a wire entry describes, as the screen reads it. */
function heapOf(entry: readonly number[], index: number): DebrisNode {
  return {
    index,
    x: entry[0] as number,
    y: entry[1] as number,
    z: entry[2] as number,
    yaw: entry[3] as number,
    scale: entry[4] as number,
    harvests: entry[5] as number,
    grade: entry[6] as number,
    from: entry[7] as number,
  };
}

/** The host's own screen's view of the heaps: those of the economy of the run being played now. */
class HostDebrisView implements DebrisView {
  constructor(
    private readonly source: () => Economy | null,
    private readonly runs: () => number,
    private readonly harvests: Emitter<HarvestEvent>,
  ) {}

  get nodes(): readonly DebrisNode[] {
    return this.source()?.nodes ?? IDLE_ECONOMY.debris.nodes;
  }

  /** Counts the runs too, so a renderer can tell a new run's heaps from the last run's even at the same version. */
  get version(): number {
    return this.runs() * RUN_VERSION_STEP + (this.source()?.version ?? 0);
  }

  leftOf(index: number): number {
    return this.source()?.leftOf(index) ?? 0;
  }

  onHarvest(listener: (event: HarvestEvent) => void): Unsubscribe {
    return this.harvests.on(listener);
  }
}

/** A run's heaps change this many times at most, so the version of one run never reaches the next run's. */
const RUN_VERSION_STEP = 1_000_000;

/**
 * The host's side. It does not own the economy (the survival simulation does, and a new run has a
 * new one); it is told where to find the current one and keeps only what it has sent.
 */
export class HostEconomyReport {
  private runs = 0;
  private readonly harvests = new Emitter<HarvestEvent>();
  private readonly scratch = createEconomyReading();
  private sentStock: number[] = [];
  private sentCap = -1;
  private sentAt = -Infinity;
  private listDirty = true;

  /** The economy as the host's own screen reads it. */
  readonly view: EconomyView;

  constructor(private readonly source: () => Economy | null) {
    this.view = {
      read: (out) => source()?.read(out) ?? IDLE_ECONOMY.read(out),
      debris: new HostDebrisView(source, () => this.runs, this.harvests),
    };
  }

  /** A strip happened: the host's own listeners hear of it, and the frame for the guests is returned. */
  harvested(event: HarvestEvent): string {
    this.harvests.emit(event);
    return encodeFrame({
      t: 'hd',
      p: event.by,
      i: event.node,
      m: event.material,
      g: event.gained,
      l: event.left,
      f: event.full,
    });
  }

  /** The list of heaps changed under the guests (a dawn uncovered some): it is sent at the next tick. */
  markList(): void {
    this.listDirty = true;
  }

  /** A new run began: the old economy is gone, and everyone is told the new one from the start. */
  reset(): void {
    this.runs++;
    this.sentStock = [];
    this.sentCap = -1;
    this.sentAt = -Infinity;
    this.listDirty = true;
  }

  /** What a newcomer needs to see the economy as it stands: the pool and the whole list of heaps. */
  hello(): string[] {
    const economy = this.source();
    if (!economy) return [];
    return [this.poolFrame(economy), this.listFrame(economy)];
  }

  /**
   * What the guests should be told now, if anything: the list when it changed, and the pool when it
   * has changed and `NET.poolIntervalMs` has passed since the last word. Call it every tick while
   * there are guests.
   */
  due(now: number): string[] {
    const economy = this.source();
    if (!economy) return [];
    const frames: string[] = [];
    if (this.listDirty) {
      this.listDirty = false;
      frames.push(this.listFrame(economy));
    }
    economy.read(this.scratch);
    const changed =
      this.scratch.cap !== this.sentCap ||
      this.scratch.stock.some((amount, i) => amount !== this.sentStock[i]);
    if (changed && now - this.sentAt >= NET.poolIntervalMs) {
      this.sentAt = now;
      this.sentCap = this.scratch.cap;
      this.sentStock = [...this.scratch.stock];
      frames.push(this.poolFrame(economy));
    }
    return frames;
  }

  private poolFrame(economy: Economy): string {
    economy.read(this.scratch);
    const frame: HostFrame = { t: 'ec', pl: [...this.scratch.stock], cap: this.scratch.cap };
    return encodeFrame(frame);
  }

  private listFrame(economy: Economy): string {
    const frame: HostFrame = {
      t: 'nl',
      n: economy.nodes.map((node) => heapWire(node, economy.leftOf(node.index))),
    };
    return encodeFrame(frame);
  }
}

/** A guest's copy of the heaps: the list the host sent and what is left of each. */
export class DebrisMirror implements DebrisView {
  private list: readonly DebrisNode[] = [];
  private left: number[] = [];
  private versionValue = 0;
  private readonly harvests = new Emitter<HarvestEvent>();

  get nodes(): readonly DebrisNode[] {
    return this.list;
  }

  get version(): number {
    return this.versionValue;
  }

  leftOf(index: number): number {
    return this.left[index] ?? 0;
  }

  onHarvest(listener: (event: HarvestEvent) => void): Unsubscribe {
    return this.harvests.on(listener);
  }

  /** Replaces the whole list with what the host sent. */
  setList(entries: readonly (readonly number[])[]): void {
    this.list = entries.map(heapOf);
    this.left = entries.map((entry) => entry[8] as number);
    this.versionValue++;
  }

  /** Someone stripped a heap: it has this many strips left now. */
  strip(event: HarvestEvent): void {
    if (event.node >= this.left.length) return;
    this.left[event.node] = event.left;
    this.versionValue++;
    this.harvests.emit(event);
  }

  /** Forgets the heaps, for a run that starts over before the new list arrives. */
  clear(): void {
    this.list = [];
    this.left = [];
    this.versionValue++;
  }
}

/** A guest's copy of the economy: the pool as the host last said it, and the heaps. */
export class EconomyMirror implements EconomyView {
  private readonly stock = new Array<number>(POOL_SLOTS).fill(0);
  private cap = 0;
  readonly debris = new DebrisMirror();

  /** The pool as the host last said it. */
  applyPool(stock: readonly number[], cap: number): void {
    for (let i = 0; i < POOL_SLOTS; i++) this.stock[i] = stock[i] ?? 0;
    this.cap = cap;
  }

  /** A new run: nothing is known until the host speaks. */
  reset(): void {
    this.stock.fill(0);
    this.cap = 0;
    this.debris.clear();
  }

  read(out: EconomyReading): EconomyReading {
    for (let i = 0; i < POOL_SLOTS; i++) out.stock[i] = this.stock[i] as number;
    out.cap = this.cap;
    return out;
  }
}
