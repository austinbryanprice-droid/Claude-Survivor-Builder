import { NET } from '../shared/net-config';
import { generateRoomCode } from '../shared/room-code';
import type { Scheduler } from './scheduler';
import {
  NetError,
  type HostEndpoint,
  type Link,
  type LinkHandlers,
  type Transport,
} from './transport';

/**
 * A transport that lives in memory. Single-player uses it for the local host, and the tests use
 * it to run a whole room in one process on virtual time, with latency, jitter, packet loss and
 * links that die without saying goodbye.
 */

export interface LoopbackOptions {
  scheduler: Scheduler;
  /** One-way delay in milliseconds: a number, or a function for jitter. */
  latency?: number | (() => number);
  /** Share of state packets (the fast lane) that never arrive, from 0 to 1. */
  stateLoss?: number;
  /** When true a state packet may overtake an earlier one, as on an unordered channel. */
  stateReorder?: boolean;
  /** Source of randomness for codes, loss and jitter; defaults to Math.random. */
  random?: () => number;
}

class LoopbackEndpoint implements HostEndpoint {
  private listener: ((link: Link) => void) | null = null;
  private backlog: Link[] = [];
  closed = false;

  constructor(
    readonly code: string,
    private readonly network: LoopbackNetwork,
  ) {}

  onLink(listener: (link: Link) => void): void {
    this.listener = listener;
    for (const link of this.backlog.splice(0)) listener(link);
  }

  offer(link: Link): void {
    if (this.listener) this.listener(link);
    else this.backlog.push(link);
  }

  close(): void {
    this.closed = true;
    this.network.forget(this);
  }
}

export class LoopbackLink implements Link {
  peer!: LoopbackLink;
  readonly fastOpen = true;
  private handlers: LinkHandlers | null = null;
  private backlog: (() => void)[] = [];
  private closedFlag = false;
  private lastControlDue = 0;
  private lastStateDue = 0;
  /** Set on both ends by `sever`: nothing is delivered either way and nobody is told. */
  severed = false;

  constructor(
    readonly remoteId: string,
    private readonly network: LoopbackNetwork,
  ) {}

  attach(handlers: LinkHandlers): void {
    this.handlers = handlers;
    for (const run of this.backlog.splice(0)) run();
  }

  get isClosed(): boolean {
    return this.closedFlag;
  }

  sendControl(frame: string): void {
    if (this.closedFlag || this.severed) return;
    this.network.deliver(this, 'control', () =>
      this.peer.receive(() => this.peer.handlers?.control(frame)),
    );
  }

  sendState(frame: Uint8Array): void {
    if (this.closedFlag || this.severed) return;
    const copy = frame.slice();
    if (this.network.dropsState()) return;
    this.network.deliver(this, 'state', () =>
      this.peer.receive(() => this.peer.handlers?.state(copy)),
    );
  }

  close(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    if (this.severed) return;
    this.network.deliver(this, 'control', () =>
      this.peer.receive(() => {
        if (this.peer.closedFlag) return;
        this.peer.closedFlag = true;
        this.peer.handlers?.closed();
      }),
    );
  }

  /** Runs a delivery now if someone is listening, otherwise keeps it until `attach`. */
  private receive(run: () => void): void {
    if (this.closedFlag && !this.severed) {
      // A frame can still arrive just after a local close; it is dropped like on a real channel.
      return;
    }
    if (this.severed) return;
    if (this.handlers) run();
    else this.backlog.push(run);
  }

  nextControlDue(due: number): number {
    this.lastControlDue = Math.max(due, this.lastControlDue);
    return this.lastControlDue;
  }

  nextStateDue(due: number, ordered: boolean): number {
    if (!ordered) return due;
    this.lastStateDue = Math.max(due, this.lastStateDue);
    return this.lastStateDue;
  }
}

export class LoopbackNetwork implements Transport {
  private readonly hosts = new Map<string, LoopbackEndpoint>();
  private readonly allLinks: LoopbackLink[] = [];
  private readonly scheduler: Scheduler;
  private readonly random: () => number;
  private readonly options: LoopbackOptions;
  private serial = 0;

  constructor(options: LoopbackOptions) {
    this.options = options;
    this.scheduler = options.scheduler;
    this.random = options.random ?? Math.random;
  }

  private delay(): number {
    const { latency = 0 } = this.options;
    return Math.max(0, typeof latency === 'function' ? latency() : latency);
  }

  dropsState(): boolean {
    const loss = this.options.stateLoss ?? 0;
    return loss > 0 && this.random() < loss;
  }

  /** Queues a delivery on a link's lane after the network delay, keeping the ordered lane in order. */
  deliver(from: LoopbackLink, lane: 'control' | 'state', run: () => void): void {
    const now = this.scheduler.now();
    const due = now + this.delay();
    const at =
      lane === 'control'
        ? from.nextControlDue(due)
        : from.nextStateDue(due, !this.options.stateReorder);
    this.scheduler.after(at - now, run);
  }

  forget(endpoint: LoopbackEndpoint): void {
    if (this.hosts.get(endpoint.code) === endpoint) this.hosts.delete(endpoint.code);
  }

  /** Every link made so far, both ends, for tests that need to sever or inspect them. */
  get links(): readonly LoopbackLink[] {
    return this.allLinks;
  }

  /** Makes a link silently dead in both directions: no close event, nothing delivered. */
  sever(link: LoopbackLink): void {
    link.severed = true;
    link.peer.severed = true;
  }

  openHost(): Promise<HostEndpoint> {
    for (let attempt = 0; attempt < NET.codeRetries; attempt++) {
      const code = generateRoomCode(this.random);
      if (this.hosts.has(code)) continue;
      const endpoint = new LoopbackEndpoint(code, this);
      this.hosts.set(code, endpoint);
      return Promise.resolve(endpoint);
    }
    return Promise.reject(new NetError('error', 'No free room code.'));
  }

  dial(code: string): Promise<Link> {
    const endpoint = this.hosts.get(code);
    if (!endpoint) return Promise.reject(new NetError('room-not-found', `No room ${code}.`));
    const id = ++this.serial;
    const guestEnd = new LoopbackLink(`host-${code}`, this);
    const hostEnd = new LoopbackLink(`guest-${id}`, this);
    guestEnd.peer = hostEnd;
    hostEnd.peer = guestEnd;
    this.allLinks.push(guestEnd, hostEnd);
    return new Promise((resolve) => {
      this.scheduler.after(this.delay(), () => {
        endpoint.offer(hostEnd);
        resolve(guestEnd);
      });
    });
  }
}
