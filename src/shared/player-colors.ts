/**
 * One color per seat in the room, so a player is the same color on everyone's screen: the
 * suit's accent in the world, the dot in the player list and the name tag. The seat is the
 * `slot` the host hands out (the host is always slot 0).
 */
export interface PlayerColor {
  readonly name: string;
  /** CSS color. */
  readonly hex: string;
}

export const PLAYER_COLORS: readonly PlayerColor[] = [
  { name: 'Amber', hex: '#f2a43a' },
  { name: 'Cyan', hex: '#3ad1e0' },
  { name: 'Mint', hex: '#8fe3a6' },
  { name: 'Violet', hex: '#c59bff' },
];

export function colorForSlot(slot: number): PlayerColor {
  const index = Number.isInteger(slot) && slot >= 0 ? slot % PLAYER_COLORS.length : 0;
  return PLAYER_COLORS[index] as PlayerColor;
}
