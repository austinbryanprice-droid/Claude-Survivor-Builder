import { NET } from './net-config';

/** Letters, digits, dash and underscore, long enough to be unguessable and short enough to log. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function isToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** Splits a string into code points so a cut never lands inside a surrogate pair. */
function truncate(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join('');
}

/**
 * Makes a player name fit to show: no control or formatting characters (which can hide text or
 * flip its direction), single spaces, trimmed, and at most `NET.maxNameLength` characters. A name
 * that comes out empty becomes the fallback.
 */
export function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    .replace(/[\p{C}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const cut = truncate(cleaned, NET.maxNameLength).trim();
  return cut.length > 0 ? cut : fallback;
}

/** The name a player gets until they pick one, taken from the end of their token. */
export function defaultName(token: string): string {
  const tail = token
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(-3)
    .toUpperCase();
  return `Crew-${tail || 'X'}`;
}
