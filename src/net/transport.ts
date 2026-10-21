/**
 * What the sessions need from a way of reaching other players. Two implementations exist: a
 * loopback in memory (single-player, tests) and PeerJS over WebRTC (rooms). A link has two
 * lanes: an ordered, reliable one for control frames, and a fast one for player state that may
 * lose or reorder packets. The fast lane falls back to the ordered one until it is open.
 */

export interface LinkHandlers {
  /** A control frame (JSON text) arrived on the ordered lane. */
  control(frame: string): void;
  /** A state packet arrived on the fast lane (or on the ordered lane, while the fast one was not open). */
  state(frame: Uint8Array): void;
  /** The link is gone, from either side. Called at most once. */
  closed(): void;
}

export interface Link {
  /** The transport's name for the other side. */
  readonly remoteId: string;
  /** True once the fast lane is open. */
  readonly fastOpen: boolean;
  /** Takes over delivery. Call it in the same turn the link is handed over, or frames are lost. */
  attach(handlers: LinkHandlers): void;
  sendControl(frame: string): void;
  sendState(frame: Uint8Array): void;
  /** Closes the link. Handlers are not called for a close the caller asked for. */
  close(): void;
}

/** A room that a host has opened and is accepting links for. */
export interface HostEndpoint {
  readonly code: string;
  /** Called with each new link once its control lane is open. */
  onLink(listener: (link: Link) => void): void;
  close(): void;
}

export interface Transport {
  /** Opens a room under a fresh short code, retrying if the code is taken. */
  openHost(): Promise<HostEndpoint>;
  /** Connects to the room with this code. Rejects with a `NetError`. */
  dial(code: string): Promise<Link>;
}

export type NetErrorKind =
  'broker-unreachable' | 'room-not-found' | 'timed-out' | 'unsupported' | 'closed' | 'error';

export class NetError extends Error {
  constructor(
    readonly kind: NetErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'NetError';
  }
}
