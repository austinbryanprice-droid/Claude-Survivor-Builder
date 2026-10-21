import { describe, expect, it } from 'vitest';
import {
  buildInviteLink,
  describeNetwork,
  parseBroker,
  parseIce,
  readNetFlags,
  withJoinParam,
} from '../../src/shared/net-flags';

const http = { secure: false };
const https = { secure: true };

describe('broker switch', () => {
  it('reads host, port and path', () => {
    expect(parseBroker('localhost:9000', true)).toEqual({
      host: 'localhost',
      port: 9000,
      path: '/',
      secure: false,
    });
    expect(parseBroker('peers.example.com/myapp', true)).toEqual({
      host: 'peers.example.com',
      port: 443,
      path: '/myapp/',
      secure: true,
    });
    expect(parseBroker('peers.example.com:9001/', false)).toEqual({
      host: 'peers.example.com',
      port: 9001,
      path: '/',
      secure: false,
    });
  });

  it('follows the page for security, except on the same machine', () => {
    expect(parseBroker('peers.example.com', true)?.secure).toBe(true);
    expect(parseBroker('peers.example.com', false)?.secure).toBe(false);
    expect(parseBroker('127.0.0.1:9000', true)?.secure).toBe(false);
    expect(parseBroker('[::1]:9000', true)?.secure).toBe(false);
  });

  it('takes a scheme at its word', () => {
    expect(parseBroker('https://peers.example.com', false)).toMatchObject({
      secure: true,
      port: 443,
    });
    expect(parseBroker('wss://peers.example.com:8443/x', false)).toMatchObject({
      secure: true,
      port: 8443,
      path: '/x/',
    });
    expect(parseBroker('http://peers.example.com', true)).toMatchObject({
      secure: false,
      port: 80,
    });
  });

  it('refuses what is not a server address', () => {
    for (const bad of [
      '',
      'not a host',
      'host:99999',
      'host:0',
      'ftp://host',
      'host/with space',
      '//x',
    ]) {
      expect(parseBroker(bad, false), bad).toBeNull();
    }
  });
});

describe('ice switch', () => {
  it('understands none and default', () => {
    expect(parseIce('none', null, null)).toEqual([]);
    expect(parseIce('NONE', null, null)).toEqual([]);
    expect(parseIce('default', null, null)).toBeNull();
    expect(parseIce('', null, null)).toBeNull();
  });

  it('reads a list and gives credentials to TURN servers only', () => {
    expect(
      parseIce('stun:stun.example.com:3478, turn:turn.example.com:3478', 'user', 'secret'),
    ).toEqual([
      { urls: 'stun:stun.example.com:3478' },
      { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'secret' },
    ]);
    expect(parseIce('turn:t.example.com', 'only-user', null)).toEqual([
      { urls: 'turn:t.example.com' },
    ]);
  });

  it('refuses anything else, so a link cannot smuggle in other URLs', () => {
    expect(parseIce('http://evil.example.com', null, null)).toBeUndefined();
    expect(parseIce('stun:ok.example.com,javascript:alert(1)', null, null)).toBeUndefined();
    expect(parseIce(Array(9).fill('stun:a.example.com').join(','), null, null)).toBeUndefined();
  });
});

describe('reading a whole address', () => {
  it('has no custom network by default', () => {
    const flags = readNetFlags('', http);
    expect(flags).toEqual({
      join: null,
      name: null,
      broker: null,
      iceServers: null,
      warnings: [],
    });
    expect(describeNetwork(flags)).toBeNull();
  });

  it('collects the switches for a local test', () => {
    const flags = readNetFlags(
      '?join=K7P2M&name=Ada&broker=localhost:9000&ice=none&brokerKey=peerjs',
      http,
    );
    expect(flags.join).toBe('K7P2M');
    expect(flags.name).toBe('Ada');
    expect(flags.broker).toEqual({
      host: 'localhost',
      port: 9000,
      path: '/',
      secure: false,
      key: 'peerjs',
    });
    expect(flags.iceServers).toEqual([]);
    expect(describeNetwork(flags)).toBe(
      'Custom network: matchmaking server localhost:9000, direct connections only.',
    );
  });

  it('keeps a full invite link in join for the room-code reader', () => {
    const flags = readNetFlags(`?join=${encodeURIComponent('https://x.test/?join=K7P2M')}`, https);
    expect(flags.join).toBe('https://x.test/?join=K7P2M');
  });

  it('cleans the name and drops an empty one', () => {
    expect(readNetFlags('?name=%E2%80%AEevil%20%20name', http).name).toBe('evil name');
    expect(readNetFlags('?name=%20%20', http).name).toBeNull();
  });

  it('explains what it ignored', () => {
    const flags = readNetFlags('?broker=nope!!&ice=http://x&brokerKey=bad key', http);
    expect(flags.broker).toBeNull();
    expect(flags.iceServers).toBeNull();
    expect(flags.warnings).toHaveLength(2);
    expect(describeNetwork(flags)).toBeNull();
  });
});

describe('invite links', () => {
  it('points at this page with the code and nothing personal', () => {
    expect(buildInviteLink('https://example.com/game/?name=Ada&debug=1#top', 'K7M2Q')).toBe(
      'https://example.com/game/?join=K7M2Q',
    );
  });

  it('keeps the switches that decide which servers the room is on', () => {
    const link = buildInviteLink(
      'http://localhost:4173/?broker=localhost:9000&ice=none&name=Ada&bench=1&join=OLD11',
      'ABCDE',
    );
    const url = new URL(link);
    expect(url.searchParams.get('join')).toBe('ABCDE');
    expect(url.searchParams.get('broker')).toBe('localhost:9000');
    expect(url.searchParams.get('ice')).toBe('none');
    expect(url.searchParams.has('name')).toBe(false);
    expect(url.searchParams.has('bench')).toBe(false);
    // And the link reads back as the same network.
    const flags = readNetFlags(url.search, { secure: false });
    expect(flags.join).toBe('ABCDE');
    expect(flags.broker?.port).toBe(9000);
    expect(flags.iceServers).toEqual([]);
  });

  it('sets and clears the join switch without touching the rest', () => {
    const href = 'http://localhost:4173/play?name=Ada&broker=localhost:9000';
    const joined = withJoinParam(href, 'K7M2Q');
    expect(new URL(joined).searchParams.get('join')).toBe('K7M2Q');
    expect(new URL(joined).searchParams.get('name')).toBe('Ada');
    expect(withJoinParam(joined, 'ZZZZZ')).toContain('join=ZZZZZ');
    expect(withJoinParam(joined, null)).toBe(href);
  });
});
