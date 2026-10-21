import { cleanName } from './names';

/**
 * URL switches for the multiplayer layer. The defaults need none of them: rooms go through the
 * public PeerJS server and PeerJS's own list of STUN and TURN servers. They exist so a test can
 * run against a local PeerServer with no internet, and so a host with a strict network can point
 * the game at a relay of their own.
 *
 *   ?join=K7P2M                    join this room on load (a full invite link works too)
 *   ?name=Ada                      the name to join with
 *   ?broker=localhost:9000         a PeerJS-compatible server: host[:port][/path], or with a scheme
 *   ?broker=https://peers.example.com/myapp&brokerKey=k
 *   ?ice=none                      direct connections only (no STUN or TURN), for local tests
 *   ?ice=stun:stun.example.com:3478,turn:turn.example.com:3478&iceUser=u&iceCred=p
 */

/** A PeerJS-compatible signalling server. */
export interface BrokerConfig {
  host: string;
  port: number;
  path: string;
  secure: boolean;
  key?: string;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface NetFlags {
  /** What was in `?join=`, unchecked, or null. */
  readonly join: string | null;
  /** The name to join with, or null to use the saved one. */
  readonly name: string | null;
  /** Null means the public PeerJS cloud server. */
  readonly broker: BrokerConfig | null;
  /** Null means PeerJS's defaults; an empty list means direct connections only. */
  readonly iceServers: IceServer[] | null;
  /** Switches that were present but could not be used, in words. */
  readonly warnings: readonly string[];
}

const MAX_ICE_SERVERS = 8;
const ICE_URL = /^(stun|stuns|turn|turns):[^\s,]+$/i;
const BROKER =
  /^(?:(https?|wss?):\/\/)?(\[[0-9a-f:]+\]|[a-z0-9][a-z0-9.-]*)(?::(\d{1,5}))?(\/[^?#\s]*)?$/i;
const KEY = /^[A-Za-z0-9_-]{1,64}$/;

function isLocalHost(host: string): boolean {
  const name = host.toLowerCase();
  return (
    name === 'localhost' || name === '127.0.0.1' || name === '[::1]' || name.endsWith('.localhost')
  );
}

/** Reads `host[:port][/path]` or a URL with a scheme. `pageSecure` is whether the game page itself is on https. */
export function parseBroker(value: string, pageSecure: boolean): BrokerConfig | null {
  const match = BROKER.exec(value.trim());
  if (!match) return null;
  const scheme = match[1]?.toLowerCase();
  const host = match[2] as string;
  const secure = scheme
    ? scheme === 'https' || scheme === 'wss'
    : isLocalHost(host)
      ? false
      : pageSecure;
  const port = match[3] ? Number(match[3]) : secure ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  let path = match[4] ?? '/';
  if (!path.startsWith('/')) path = `/${path}`;
  if (!path.endsWith('/')) path += '/';
  return { host, port, path, secure };
}

/** `none`, `default`, or a comma-separated list of STUN and TURN URLs. */
export function parseIce(
  value: string,
  user: string | null,
  credential: string | null,
): IceServer[] | null | undefined {
  const text = value.trim();
  if (text === '' || text.toLowerCase() === 'default') return null;
  if (text.toLowerCase() === 'none') return [];
  const urls = text.split(',').map((part) => part.trim());
  if (urls.length > MAX_ICE_SERVERS || urls.some((url) => !ICE_URL.test(url))) return undefined;
  return urls.map((url) => {
    const server: IceServer = { urls: url };
    if (/^turns?:/i.test(url) && user !== null && credential !== null) {
      server.username = user;
      server.credential = credential;
    }
    return server;
  });
}

export function readNetFlags(search: string, page: { secure: boolean }): NetFlags {
  const params = new URLSearchParams(search);
  const warnings: string[] = [];

  const joinRaw = params.get('join');
  const nameRaw = params.get('name');
  const name = nameRaw === null ? null : cleanName(nameRaw, '') || null;

  let broker: BrokerConfig | null = null;
  const brokerRaw = params.get('broker');
  if (brokerRaw !== null && brokerRaw.trim() !== '') {
    broker = parseBroker(brokerRaw, page.secure);
    if (!broker) warnings.push(`Ignoring broker=${brokerRaw}: not a host, host:port or URL.`);
    const key = params.get('brokerKey');
    if (broker && key !== null) {
      if (KEY.test(key)) broker.key = key;
      else warnings.push('Ignoring brokerKey: letters, digits, dash and underscore only.');
    }
  }

  let iceServers: IceServer[] | null = null;
  const iceRaw = params.get('ice');
  if (iceRaw !== null) {
    const parsed = parseIce(iceRaw, params.get('iceUser'), params.get('iceCred'));
    if (parsed === undefined) {
      warnings.push(`Ignoring ice=${iceRaw}: expected none, default, or stun:/turn: URLs.`);
    } else {
      iceServers = parsed;
    }
  }

  return {
    join: joinRaw !== null && joinRaw.trim() !== '' ? joinRaw : null,
    name,
    broker,
    iceServers,
    warnings,
  };
}

/** A line for the room panel when the network is not set up the usual way, or null when it is. */
export function describeNetwork(flags: NetFlags): string | null {
  const parts: string[] = [];
  if (flags.broker) {
    const { host, port, path } = flags.broker;
    parts.push(`matchmaking server ${host}:${port}${path === '/' ? '' : path}`);
  }
  if (flags.iceServers) {
    parts.push(
      flags.iceServers.length === 0
        ? 'direct connections only'
        : `${flags.iceServers.length} custom relay server${flags.iceServers.length === 1 ? '' : 's'}`,
    );
  }
  return parts.length > 0 ? `Custom network: ${parts.join(', ')}.` : null;
}
