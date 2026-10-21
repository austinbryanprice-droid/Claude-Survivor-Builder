import { NET } from '../shared/net-config';
import type { BrokerConfig, IceServer } from '../shared/net-flags';
import { generateRoomCode, peerIdForCode } from '../shared/room-code';
import { cryptoRandom, randomString } from './random';
import type { Scheduler } from './scheduler';
import {
  NetError,
  type HostEndpoint,
  type Link,
  type LinkHandlers,
  type Transport,
} from './transport';

/**
 * Rooms over WebRTC, through PeerJS. The host registers a short room code with a small public
 * server (the broker) that only introduces peers; after that, players talk to the host directly.
 *
 * Each player opens two connections to the host: `ctl`, ordered and reliable, for control frames,
 * and `fast`, unordered, for player state, so one late packet never holds up the newer ones behind
 * it. Until the fast one is open, state rides on the ordered one. Both use PeerJS's `raw`
 * serialization, which sends messages as they are (no chunking), so every control frame must stay
 * well under a browser's message limit; the session keeps them under `NET.maxFrameLength`.
 */

// ----------------------------------------------------------------------------------------------
// The slice of PeerJS this file uses. Declared here so tests can stand in a fake, and so PeerJS's
// own typings (and its weight) stay out of the rest of the code.
// ----------------------------------------------------------------------------------------------

export interface PeerConnectionLike {
  readonly peer: string;
  readonly label: string;
  readonly open: boolean;
  /** Messages PeerJS is holding back because the channel is busy. */
  readonly bufferSize?: number;
  send(data: string | Uint8Array): unknown;
  close(): void;
  on(event: 'open' | 'close', listener: () => void): unknown;
  on(event: 'data', listener: (data: unknown) => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
}

export interface PeerErrorLike {
  readonly type?: string;
  readonly message?: string;
}

export interface PeerOptionsLike {
  host?: string;
  port?: number;
  path?: string;
  secure?: boolean;
  key?: string;
  config?: { iceServers: IceServer[] };
  debug?: number;
}

export interface PeerLike {
  readonly destroyed: boolean;
  on(event: 'open', listener: (id: string) => void): unknown;
  on(event: 'connection', listener: (connection: PeerConnectionLike) => void): unknown;
  on(event: 'disconnected' | 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: PeerErrorLike) => void): unknown;
  connect(
    id: string,
    options: { label: string; reliable: boolean; serialization: string },
  ): PeerConnectionLike | undefined;
  disconnect(): void;
  reconnect(): void;
  destroy(): void;
}

export type PeerConstructor = new (id: string, options: PeerOptionsLike) => PeerLike;

export interface PeerLibrary {
  Peer: PeerConstructor;
}

/** Loads PeerJS only when a room is hosted or joined, so single-player never downloads it. */
async function loadPeerJs(): Promise<PeerLibrary> {
  const module = await import('peerjs');
  return { Peer: module.Peer as unknown as PeerConstructor };
}

// ----------------------------------------------------------------------------------------------
// Options.
// ----------------------------------------------------------------------------------------------

export interface PeerTransportOptions {
  scheduler: Scheduler;
  /** Defaults to the public PeerJS cloud server. */
  broker?: BrokerConfig;
  /** Defaults to PeerJS's list (a public STUN server and a free shared TURN relay). `[]` means direct connections only. */
  iceServers?: IceServer[];
  /** Floats in [0, 1) for room codes and guest ids; defaults to the browser's crypto source. */
  random?: () => number;
  /** For tests. */
  loadPeer?: () => Promise<PeerLibrary>;
}

const LANE_CONTROL = 'ctl';
const LANE_FAST = 'fast';
const RECONNECT_FIRST_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
/** After a room closes, the PeerJS peer lives this long so goodbye frames already queued can leave. */
const DESTROY_GRACE_MS = 1500;

function randomId(random: () => number, length: number): string {
  return randomString(random, 'abcdefghijklmnopqrstuvwxyz0123456789', length);
}

/** How a PeerJS error type reads while setting a connection up. */
function netErrorFor(type: string | undefined, message: string): NetError {
  switch (type) {
    case 'peer-unavailable':
      return new NetError('room-not-found', message);
    case 'browser-incompatible':
      return new NetError('unsupported', message);
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'ssl-unavailable':
    case 'invalid-key':
    case 'disconnected':
      return new NetError('broker-unreachable', message);
    case 'webrtc':
    case 'negotiation-failed':
    case 'connection-closed':
      return new NetError('timed-out', message);
    default:
      return new NetError('error', message);
  }
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return 'Unknown connection error.';
}

function typeOf(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'type' in error) {
    const type = (error as { type?: unknown }).type;
    if (typeof type === 'string') return type;
  }
  return undefined;
}

// ----------------------------------------------------------------------------------------------
// A link: the control connection plus, once it opens, the fast one.
// ----------------------------------------------------------------------------------------------

class PeerLink implements Link {
  private handlers: LinkHandlers | null = null;
  private backlog: (() => void)[] = [];
  private fast: PeerConnectionLike | null = null;
  private closedByUs = false;
  private gone = false;
  private reportedClosed = false;

  constructor(
    readonly remoteId: string,
    private readonly control: PeerConnectionLike,
    private readonly dispose: () => void,
  ) {
    control.on('data', (data) => this.receive(data, true));
    control.on('close', () => this.lost());
    control.on('error', () => {
      // PeerJS follows a fatal error with a close event; a send that failed is simply not delivered.
    });
  }

  get fastOpen(): boolean {
    return this.fast !== null && this.fast.open;
  }

  /** Adds the unordered connection once it exists. It may open later; until then state uses `ctl`. */
  attachFast(connection: PeerConnectionLike): void {
    if (this.fast || this.gone) {
      connection.close();
      return;
    }
    this.fast = connection;
    connection.on('data', (data) => this.receive(data, false));
    connection.on('close', () => {
      if (this.fast === connection) this.fast = null;
    });
    connection.on('error', () => {});
  }

  attach(handlers: LinkHandlers): void {
    this.handlers = handlers;
    for (const run of this.backlog.splice(0)) run();
  }

  sendControl(frame: string): void {
    if (this.gone || !this.control.open) return;
    this.control.send(frame);
  }

  sendState(frame: Uint8Array): void {
    if (this.gone) return;
    const lane = this.fast?.open ? this.fast : this.control;
    if (!lane.open) return;
    // A busy channel drops the packet: a newer one is on its way, and queueing would only add lag.
    if ((lane.bufferSize ?? 0) >= NET.fastBacklogMax) return;
    lane.send(frame);
  }

  close(): void {
    if (this.closedByUs) return;
    this.closedByUs = true;
    this.shutdown();
  }

  private receive(data: unknown, fromControl: boolean): void {
    if (this.gone) return;
    if (typeof data === 'string') {
      if (fromControl) this.deliver(() => this.handlers?.control(data));
      return;
    }
    let bytes: Uint8Array | null = null;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (bytes) {
      const packet = bytes;
      this.deliver(() => this.handlers?.state(packet));
    }
  }

  private deliver(run: () => void): void {
    if (this.handlers) run();
    else this.backlog.push(run);
  }

  /** The other side went away (or the connection failed). */
  private lost(): void {
    if (this.gone) return;
    this.shutdown();
    if (this.closedByUs) return;
    const report = () => {
      if (this.reportedClosed) return;
      this.reportedClosed = true;
      this.handlers?.closed();
    };
    // Frames that arrived before the close are delivered first, then the close.
    if (this.handlers) report();
    else this.backlog.push(report);
  }

  private shutdown(): void {
    if (this.gone) return;
    this.gone = true;
    try {
      this.fast?.close();
    } catch {
      /* the connection was already torn down */
    }
    try {
      this.control.close();
    } catch {
      /* the connection was already torn down */
    }
    this.fast = null;
    this.dispose();
  }
}

// ----------------------------------------------------------------------------------------------
// The host's side of a room.
// ----------------------------------------------------------------------------------------------

interface Lanes {
  control?: PeerConnectionLike;
  fast?: PeerConnectionLike;
  link?: PeerLink;
  cancel: () => void;
}

class PeerHostEndpoint implements HostEndpoint {
  private listener: ((link: Link) => void) | null = null;
  private readonly backlog: Link[] = [];
  private readonly lanes = new Map<string, Lanes>();
  private brokerListener: ((online: boolean) => void) | null = null;
  private online = true;
  private closed = false;
  private reconnectAttempt = 0;
  private cancelReconnect: (() => void) | null = null;

  constructor(
    readonly code: string,
    private readonly peer: PeerLike,
    private readonly scheduler: Scheduler,
  ) {
    peer.on('connection', (connection) => this.onConnection(connection));
    peer.on('disconnected', () => this.brokerLost());
    peer.on('open', () => this.brokerBack());
    peer.on('error', (error) => {
      const type = error.type;
      if (type === 'network' || type === 'socket-error' || type === 'socket-closed') {
        this.brokerLost();
      }
      // Anything else (a failed negotiation with one player, say) concerns that player only.
    });
  }

  onLink(listener: (link: Link) => void): void {
    this.listener = listener;
    for (const link of this.backlog.splice(0)) listener(link);
  }

  onBroker(listener: (online: boolean) => void): void {
    this.brokerListener = listener;
    listener(this.online);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cancelReconnect?.();
    this.cancelReconnect = null;
    for (const [, lanes] of this.lanes) {
      lanes.cancel();
      if (!lanes.link) {
        lanes.control?.close();
        lanes.fast?.close();
      }
    }
    this.lanes.clear();
    // Off the broker at once, so the code stops working; connections already up get a moment to say goodbye.
    try {
      this.peer.disconnect();
    } catch {
      /* already disconnected */
    }
    this.scheduler.after(DESTROY_GRACE_MS, () => this.peer.destroy());
  }

  private onConnection(connection: PeerConnectionLike): void {
    if (this.closed) {
      connection.close();
      return;
    }
    const lane = connection.label;
    if (lane !== LANE_CONTROL && lane !== LANE_FAST) {
      connection.close();
      return;
    }
    let entry = this.lanes.get(connection.peer);
    if (!entry) {
      if (this.lanes.size >= NET.pendingLinksMax) {
        connection.close();
        return;
      }
      const created: Lanes = { cancel: () => {} };
      created.cancel = this.scheduler.after(NET.connectTimeoutMs, () => {
        // A player that never finished connecting must not hold the slot.
        if (created.link) return;
        created.control?.close();
        created.fast?.close();
        if (this.lanes.get(connection.peer) === created) this.lanes.delete(connection.peer);
      });
      this.lanes.set(connection.peer, created);
      entry = created;
    }
    const lanes = entry;

    if (lane === LANE_FAST) {
      if (lanes.fast) {
        connection.close();
        return;
      }
      lanes.fast = connection;
      if (lanes.link) lanes.link.attachFast(connection);
      return;
    }

    if (lanes.control) {
      connection.close();
      return;
    }
    lanes.control = connection;
    const opened = () => {
      if (this.closed || lanes.link) return;
      lanes.cancel();
      const link = new PeerLink(connection.peer, connection, () => {
        if (this.lanes.get(connection.peer) === lanes) this.lanes.delete(connection.peer);
      });
      lanes.link = link;
      if (lanes.fast) link.attachFast(lanes.fast);
      if (this.listener) this.listener(link);
      else this.backlog.push(link);
    };
    if (connection.open) opened();
    else connection.on('open', opened);
    connection.on('close', () => {
      // Closed before it ever opened: forget the half-built player.
      if (!lanes.link && this.lanes.get(connection.peer) === lanes) {
        lanes.cancel();
        lanes.fast?.close();
        this.lanes.delete(connection.peer);
      }
    });
  }

  private setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    this.brokerListener?.(online);
  }

  private brokerLost(): void {
    if (this.closed) return;
    this.setOnline(false);
    if (this.cancelReconnect) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_FIRST_MS * 2 ** this.reconnectAttempt);
    this.reconnectAttempt++;
    this.cancelReconnect = this.scheduler.after(delay, () => {
      this.cancelReconnect = null;
      if (this.closed || this.peer.destroyed) return;
      try {
        this.peer.reconnect();
      } catch {
        this.brokerLost();
        return;
      }
      // Success arrives as an `open` event; a failure as another `disconnected` or `error`, which schedules the next try.
    });
  }

  private brokerBack(): void {
    if (this.closed) return;
    this.reconnectAttempt = 0;
    this.setOnline(true);
  }
}

// ----------------------------------------------------------------------------------------------
// The transport.
// ----------------------------------------------------------------------------------------------

type Registration =
  { kind: 'ok'; peer: PeerLike } | { kind: 'taken' } | { kind: 'failed'; error: NetError };

export class PeerTransport implements Transport {
  private readonly scheduler: Scheduler;
  private readonly random: () => number;
  private readonly loadPeer: () => Promise<PeerLibrary>;
  private library: Promise<PeerLibrary> | null = null;

  constructor(private readonly options: PeerTransportOptions) {
    this.scheduler = options.scheduler;
    this.random = options.random ?? cryptoRandom();
    this.loadPeer = options.loadPeer ?? loadPeerJs;
  }

  private peerOptions(): PeerOptionsLike {
    const { broker, iceServers } = this.options;
    const out: PeerOptionsLike = { debug: 0 };
    if (broker) {
      out.host = broker.host;
      out.port = broker.port;
      out.path = broker.path;
      out.secure = broker.secure;
      if (broker.key) out.key = broker.key;
    }
    if (iceServers) out.config = { iceServers };
    return out;
  }

  private async lib(): Promise<PeerLibrary> {
    this.library ??= this.loadPeer();
    try {
      return await this.library;
    } catch (error) {
      this.library = null;
      throw new NetError('error', `Could not load the networking library: ${describe(error)}`);
    }
  }

  async openHost(): Promise<HostEndpoint> {
    const { Peer } = await this.lib();
    for (let attempt = 0; attempt < NET.codeRetries; attempt++) {
      const code = generateRoomCode(this.random);
      const outcome = await this.register(Peer, peerIdForCode(code));
      if (outcome.kind === 'ok') return new PeerHostEndpoint(code, outcome.peer, this.scheduler);
      if (outcome.kind === 'failed') throw outcome.error;
      // 'taken': someone already has that code on this broker, so draw another.
    }
    throw new NetError('error', 'Could not find a free room code.');
  }

  private register(Peer: PeerConstructor, id: string): Promise<Registration> {
    return new Promise((resolve) => {
      let peer: PeerLike;
      try {
        peer = new Peer(id, this.peerOptions());
      } catch (error) {
        resolve({ kind: 'failed', error: new NetError('unsupported', describe(error)) });
        return;
      }
      let settled = false;
      const finish = (result: Registration, destroy: boolean) => {
        if (settled) return;
        settled = true;
        cancel();
        if (destroy) peer.destroy();
        resolve(result);
      };
      const cancel = this.scheduler.after(NET.brokerTimeoutMs, () =>
        finish(
          {
            kind: 'failed',
            error: new NetError('broker-unreachable', 'The matchmaking server did not answer.'),
          },
          true,
        ),
      );
      peer.on('open', () => finish({ kind: 'ok', peer }, false));
      peer.on('error', (error) => {
        if (settled) return;
        if (error.type === 'unavailable-id') finish({ kind: 'taken' }, true);
        else finish({ kind: 'failed', error: netErrorFor(error.type, describe(error)) }, true);
      });
    });
  }

  async dial(code: string, signal?: AbortSignal): Promise<Link> {
    const { Peer } = await this.lib();
    if (signal?.aborted) throw new NetError('closed', 'Cancelled.');
    const guestId = `ashbound-g-${randomId(this.random, 14)}`;
    const roomId = peerIdForCode(code);

    return new Promise<Link>((resolve, reject) => {
      let peer: PeerLike;
      try {
        peer = new Peer(guestId, this.peerOptions());
      } catch (error) {
        reject(new NetError('unsupported', describe(error)));
        return;
      }
      let settled = false;
      let cancelStep: () => void = () => {};
      let link: PeerLink | null = null;

      const give = (error: NetError) => {
        if (settled) return;
        settled = true;
        cancelStep();
        signal?.removeEventListener('abort', onAbort);
        try {
          peer.destroy();
        } catch {
          /* already gone */
        }
        reject(error);
      };
      const onAbort = () => give(new NetError('closed', 'Cancelled.'));
      signal?.addEventListener('abort', onAbort);

      const step = (ms: number, error: NetError) => {
        cancelStep();
        cancelStep = this.scheduler.after(ms, () => give(error));
      };

      step(
        NET.brokerTimeoutMs,
        new NetError('broker-unreachable', 'The matchmaking server did not answer.'),
      );

      // Errors on the peer while connecting say why the attempt failed; later ones are not ours.
      peer.on('error', (error) => {
        if (settled) return;
        give(netErrorFor(error.type, describe(error)));
      });

      peer.on('open', () => {
        if (settled) return;
        const control = peer.connect(roomId, {
          label: LANE_CONTROL,
          reliable: true,
          serialization: 'raw',
        });
        if (!control) {
          give(new NetError('broker-unreachable', 'Could not start the connection.'));
          return;
        }
        step(NET.connectTimeoutMs, new NetError('timed-out', 'The host did not answer.'));
        control.on('error', (error) => {
          if (settled) return;
          give(netErrorFor(typeOf(error), describe(error)));
        });
        control.on('close', () => {
          // Closed before opening: the host refused, vanished or could not be reached.
          if (settled) return;
          give(new NetError('timed-out', 'The connection to the host closed.'));
        });
        control.on('open', () => {
          if (settled) return;
          settled = true;
          cancelStep();
          signal?.removeEventListener('abort', onAbort);
          link = new PeerLink(roomId, control, () => {
            try {
              peer.destroy();
            } catch {
              /* already gone */
            }
          });
          // The fast lane is a bonus: if it never opens, state keeps riding on the ordered one.
          const fast = peer.connect(roomId, {
            label: LANE_FAST,
            reliable: false,
            serialization: 'raw',
          });
          if (fast) link.attachFast(fast);
          resolve(link);
        });
      });
    });
  }
}
