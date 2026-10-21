import { NET } from './net-config';

/** Every room's broker id starts with this, so ids from other apps on the same broker never clash. */
export const ROOM_PREFIX = 'ashbound-';

/** 32 symbols: the letters except I and O, and the digits 2 to 9, so nothing is mistaken for 1 or 0. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A fresh code from any generator that returns floats in [0, 1). */
export function generateRoomCode(random: () => number, length = NET.roomCodeLength): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    const index = Math.min(CODE_ALPHABET.length - 1, Math.floor(random() * CODE_ALPHABET.length));
    code += CODE_ALPHABET[index];
  }
  return code;
}

/**
 * Cleans up what a player typed or pasted (case, spaces and dashes do not matter, and a full
 * link with `?join=` works too) and returns the code, or null when it cannot be a code.
 */
export function normalizeRoomCode(input: string): string | null {
  let text = input.trim();
  const fromLink = /[?&#]join=([^&#\s]+)/i.exec(text);
  if (fromLink?.[1]) text = fromLink[1];
  const code = text.replace(/[\s\-_.]/g, '').toUpperCase();
  if (code.length !== NET.roomCodeLength) return null;
  for (const symbol of code) {
    if (!CODE_ALPHABET.includes(symbol)) return null;
  }
  return code;
}

/** The broker id a room's host registers under. */
export function peerIdForCode(code: string): string {
  return ROOM_PREFIX + code;
}
