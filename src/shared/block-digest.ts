import type { BlockWorld } from './block-world';

export interface BlockDigest {
  /** How many player-made cells the world holds. */
  readonly count: number;
  /** Eight hex digits that change when any cell does; equal worlds always give equal digests. */
  readonly hash: string;
}

/**
 * A fingerprint of every player-made block, so two copies of a world can be compared with one
 * short string (the tests and the debug hook use it). `forEachEdit` visits cells in a fixed
 * order, which is what makes the same world give the same digest on every machine.
 */
export function digestBlocks(world: Pick<BlockWorld, 'forEachEdit'>): BlockDigest {
  let hash = 0x811c9dc5;
  let count = 0;
  const mix = (value: number): void => {
    hash = Math.imul(hash ^ (value & 0xffff), 0x01000193);
    hash = Math.imul(hash ^ ((value >> 16) & 0xffff), 0x01000193);
  };
  world.forEachEdit((x, y, z, state) => {
    mix(x);
    mix(y);
    mix(z);
    mix(state);
    count++;
  });
  return { count, hash: (hash >>> 0).toString(16).padStart(8, '0') };
}
