import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/shared/hash';
import { NET } from '../../src/shared/net-config';
import {
  CODE_ALPHABET,
  ROOM_PREFIX,
  generateRoomCode,
  normalizeRoomCode,
  peerIdForCode,
} from '../../src/shared/room-code';

describe('room codes', () => {
  it('uses 32 unambiguous symbols', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    for (const confusing of ['0', 'O', '1', 'I']) expect(CODE_ALPHABET).not.toContain(confusing);
  });

  it('generates codes of the configured length from the alphabet', () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode(rng);
      expect(code).toHaveLength(NET.roomCodeLength);
      for (const symbol of code) expect(CODE_ALPHABET).toContain(symbol);
    }
  });

  it('survives a generator that returns exactly 1 or a negative zero', () => {
    expect(generateRoomCode(() => 1)).toBe('3'.repeat(0) + '9'.repeat(NET.roomCodeLength));
    expect(generateRoomCode(() => 0)).toBe('A'.repeat(NET.roomCodeLength));
  });

  it('spreads over the whole alphabet', () => {
    const rng = createRng(11);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) for (const symbol of generateRoomCode(rng)) seen.add(symbol);
    expect(seen.size).toBe(32);
  });

  it('cleans up what a player types', () => {
    expect(normalizeRoomCode('k7qmx')).toBe('K7QMX');
    expect(normalizeRoomCode('  K7Q-MX ')).toBe('K7QMX');
    expect(normalizeRoomCode('k7q mx')).toBe('K7QMX');
  });

  it('accepts a pasted link', () => {
    expect(normalizeRoomCode('https://example.test/game/?join=k7qmx')).toBe('K7QMX');
    expect(normalizeRoomCode('https://example.test/#join=K7QMX')).toBe('K7QMX');
    expect(normalizeRoomCode('https://example.test/?debug&join=K7QMX&broker=x')).toBe('K7QMX');
  });

  it('rejects anything that cannot be a code', () => {
    expect(normalizeRoomCode('')).toBeNull();
    expect(normalizeRoomCode('K7QM')).toBeNull();
    expect(normalizeRoomCode('K7QMXX')).toBeNull();
    expect(normalizeRoomCode('K0QMX')).toBeNull(); // zero is never used
    expect(normalizeRoomCode('KIQMX')).toBeNull(); // nor is the letter I
    expect(normalizeRoomCode('K7QM!')).toBeNull();
  });

  it('prefixes the broker id and the id passes PeerJS validation', () => {
    const id = peerIdForCode('K7QMX');
    expect(id).toBe(`${ROOM_PREFIX}K7QMX`);
    // PeerJS accepts ids made of letters, digits and single separators between groups.
    expect(/^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/.test(id)).toBe(true);
  });
});
