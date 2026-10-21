import type {
  PeerConnectionLike,
  PeerConstructor,
  PeerErrorLike,
  PeerLibrary,
  PeerLike,
  PeerOptionsLike,
} from '../../../src/net/peer-transport';
import type { Scheduler } from '../../../src/net/scheduler';

/**
 * A stand-in for PeerJS that follows the parts of its behaviour the transport relies on: a broker
 * that registers ids and says when one is taken or unknown, peers that emit `open`, `connection`,
 * `error` and `disconnected`, and data connections that open a little later, deliver in order and
 * report a close to the other side. Delays run on the scheduler, so tests control time.
 */

type Listener = (...args: never[]) => void;

class Emitter {
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  protected emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      (listener as (...rest: unknown[]) => void)(...args);
    }
  }
}

export class FakeConnection extends Emitter implements PeerConnectionLike {
  open = false;
  bufferSize = 0;
  closed = false;
  other: FakeConnection | null = null;
  readonly sent: (string | Uint8Array)[] = [];

  constructor(
    readonly peer: string,
    readonly label: string,
    private readonly broker: FakeBroker,
  ) {
    super();
  }

  send(data: string | Uint8Array): void {
    if (!this.open) return;
    this.sent.push(data);
    const target = this.other;
    // Binary frames arrive as ArrayBuffers, as they do from a data channel set to `arraybuffer`.
    const payload =
      typeof data === 'string'
        ? data
        : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    this.broker.later(this.broker.dataDelay, () => {
      if (target?.open) target.emit('data', payload);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const wasOpen = this.open;
    this.open = false;
    if (wasOpen) this.emit('close');
    const remote = this.other;
    if (remote) {
      this.broker.later(this.broker.dataDelay, () => {
        if (remote.closed) return;
        remote.closed = true;
        const remoteWasOpen = remote.open;
        remote.open = false;
        if (remoteWasOpen) remote.emit('close');
      });
    }
  }

  /** Opens this end (the other end is opened by the broker at the same time). */
  opened(): void {
    if (this.closed) return;
    this.open = true;
    this.emit('open');
  }

  fail(error: PeerErrorLike): void {
    this.emit('error', error);
  }

  /** Dies without telling the other side, as a vanished machine does. */
  vanish(): void {
    this.open = false;
    this.closed = true;
    this.other = null;
  }
}

export class FakePeer extends Emitter implements PeerLike {
  destroyed = false;
  disconnected = false;
  registered = false;
  readonly connections: FakeConnection[] = [];

  constructor(
    readonly id: string,
    readonly options: PeerOptionsLike,
    private readonly broker: FakeBroker,
  ) {
    super();
    broker.peers.push(this);
    broker.later(broker.latency, () => this.register());
  }

  private register(): void {
    if (this.destroyed || this.disconnected) return;
    if (this.broker.down) {
      if (!this.broker.silent) {
        this.emit('error', { type: 'socket-error', message: 'Could not reach the server.' });
        this.disconnect();
      }
      return;
    }
    const holder = this.broker.registry.get(this.id);
    if (holder && holder !== this) {
      this.emit('error', { type: 'unavailable-id', message: `ID "${this.id}" is taken` });
      this.destroy();
      return;
    }
    this.broker.registry.set(this.id, this);
    this.registered = true;
    this.emit('open', this.id);
  }

  connect(
    id: string,
    options: { label: string; reliable: boolean; serialization: string },
  ): FakeConnection | undefined {
    if (this.destroyed || this.disconnected) {
      this.emit('error', { type: 'disconnected', message: 'Cannot connect after disconnecting.' });
      return undefined;
    }
    this.broker.connectOptions.push({ from: this.id, to: id, ...options });
    const mine = new FakeConnection(id, options.label, this.broker);
    this.connections.push(mine);
    this.broker.later(this.broker.latency, () => {
      const target = this.broker.registry.get(id);
      if (!target || target.destroyed || target.disconnected || mine.closed) {
        this.emit('error', {
          type: 'peer-unavailable',
          message: `Could not connect to peer ${id}`,
        });
        return;
      }
      if (this.broker.refuse) return; // the host never answers
      const theirs = new FakeConnection(this.id, options.label, this.broker);
      mine.other = theirs;
      theirs.other = mine;
      target.connections.push(theirs);
      target.emit('connection', theirs);
      this.broker.later(this.broker.openDelay(options.label), () => {
        if (mine.closed || theirs.closed) return;
        mine.opened();
        theirs.opened();
      });
    });
    return mine;
  }

  disconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    if (this.broker.registry.get(this.id) === this) this.broker.registry.delete(this.id);
    this.registered = false;
    this.emit('disconnected');
  }

  reconnect(): void {
    if (this.destroyed) throw new Error('destroyed');
    if (!this.disconnected) throw new Error('not disconnected');
    this.disconnected = false;
    this.broker.reconnects++;
    this.broker.later(this.broker.latency, () => this.register());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disconnected = true;
    if (this.broker.registry.get(this.id) === this) this.broker.registry.delete(this.id);
    for (const connection of this.connections) connection.close();
  }

  /** The broker's socket drops while peer-to-peer links stay up. */
  dropBrokerSocket(): void {
    if (this.disconnected) return;
    this.emit('error', { type: 'network', message: 'Lost connection to server.' });
    this.disconnect();
  }
}

/** A `Peer` constructor whose peers all register with `broker`. */
function peerClassFor(broker: FakeBroker): new (id: string, options: PeerOptionsLike) => FakePeer {
  return class extends FakePeer {
    constructor(id: string, options: PeerOptionsLike) {
      super(id, options, broker);
    }
  };
}

export class FakeBroker {
  readonly peers: FakePeer[] = [];
  readonly registry = new Map<string, FakePeer>();
  readonly connectOptions: {
    from: string;
    to: string;
    label: string;
    reliable: boolean;
    serialization: string;
  }[] = [];
  /** One-way delay to the broker, in ms. */
  latency = 20;
  dataDelay = 5;
  /** Per-lane time to open after the broker has introduced the peers. */
  laneOpenMs: Record<string, number> = { ctl: 30, fast: 60 };
  /** When true the broker cannot be reached: peers get an error instead of `open`. */
  down = false;
  /** With `down`, say nothing at all instead of an error. */
  silent = false;
  /** When true connections are introduced but never open (a host behind a wall). */
  refuse = false;
  reconnects = 0;

  constructor(private readonly scheduler: Scheduler) {}

  later(ms: number, run: () => void): void {
    this.scheduler.after(ms, run);
  }

  openDelay(label: string): number {
    return this.laneOpenMs[label] ?? 30;
  }

  /** A library to hand to `PeerTransport`. */
  library(): PeerLibrary {
    return { Peer: peerClassFor(this) as unknown as PeerConstructor };
  }

  peerById(id: string): FakePeer | undefined {
    return this.peers.find((p) => p.id === id);
  }
}
