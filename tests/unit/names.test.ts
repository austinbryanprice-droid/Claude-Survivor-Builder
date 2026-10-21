import { describe, expect, it } from 'vitest';
import { NET } from '../../src/shared/net-config';
import { cleanName, defaultName, isToken } from '../../src/shared/names';

describe('player names', () => {
  it('keeps an ordinary name', () => {
    expect(cleanName('Ada', 'Crew')).toBe('Ada');
    expect(cleanName('Mira Okafor', 'Crew')).toBe('Mira Okafor');
  });

  it('collapses spaces and trims', () => {
    expect(cleanName('  Ada   Lovelace ', 'Crew')).toBe('Ada Lovelace');
  });

  it('strips control, bidi and zero-width characters', () => {
    expect(cleanName('Ada\u0000\u0007', 'Crew')).toBe('Ada');
    expect(cleanName('A‮d‬a', 'Crew')).toBe('A d a');
    expect(cleanName('​​', 'Crew')).toBe('Crew');
    expect(cleanName('line\nbreak', 'Crew')).toBe('line break');
  });

  it('cuts long names without splitting a surrogate pair', () => {
    const long = '😀'.repeat(NET.maxNameLength + 5);
    const cut = cleanName(long, 'Crew');
    expect(Array.from(cut)).toHaveLength(NET.maxNameLength);
    expect(cut).toBe('😀'.repeat(NET.maxNameLength));
  });

  it('falls back for anything that is not a usable string', () => {
    expect(cleanName(undefined, 'Crew')).toBe('Crew');
    expect(cleanName(42, 'Crew')).toBe('Crew');
    expect(cleanName('   ', 'Crew')).toBe('Crew');
  });

  it('derives a default name from the token', () => {
    expect(defaultName('abcdefghijklmnop')).toBe('Crew-NOP');
    expect(defaultName('---')).toBe('Crew-X');
  });

  it('recognises tokens', () => {
    expect(isToken('abcdefghijklmnop')).toBe(true);
    expect(isToken('short')).toBe(false);
    expect(isToken('has spaces in it......')).toBe(false);
    expect(isToken(123)).toBe(false);
    expect(isToken('a'.repeat(65))).toBe(false);
  });
});
