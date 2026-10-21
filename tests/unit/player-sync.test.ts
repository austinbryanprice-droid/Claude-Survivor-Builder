import { describe, expect, it } from 'vitest';
import { PlayerSync, type LocalPlayer } from '../../src/app/player-sync';
import { Emitter } from '../../src/net/emitter';
import type { Correction } from '../../src/net/session';
import type { PlayerSample } from '../../src/shared/protocol';
import { digestBlocks } from '../../src/shared/block-digest';
import { TestWorld } from './helpers/net';

function setup() {
  const published: PlayerSample[] = [];
  const corrections = new Emitter<Correction>();
  const state = { x: 1, y: 0, z: 2, ready: true };
  const teleports: number[][] = [];
  const player: LocalPlayer = {
    read(out) {
      if (!state.ready) return false;
      out.x = state.x;
      out.y = state.y;
      out.z = state.z;
      out.vx = 1;
      out.yaw = 0.5;
      out.pitch = -0.25;
      out.onGround = true;
      return true;
    },
    teleport(x, y, z) {
      teleports.push([x, y, z]);
      state.x = x;
      state.y = y;
      state.z = z;
    },
  };
  const sync = new PlayerSync(
    {
      publishState: (s) => published.push({ ...s }),
      onCorrection: (l) => corrections.on(l),
    },
    player,
  );
  return { sync, state, published, corrections, teleports };
}

describe('player sync', () => {
  it('reports the player each frame, marking the first report as a move on purpose', () => {
    const t = setup();
    t.sync.update(1 / 60);
    t.state.x += 0.1;
    t.sync.update(1 / 60);
    expect(t.published).toHaveLength(2);
    expect(t.published[0]).toMatchObject({ x: 1, z: 2, yaw: 0.5, pitch: -0.25, reset: true });
    expect(t.published[1]).toMatchObject({ x: 1.1, reset: false });
  });

  it('says nothing while there is no player', () => {
    const t = setup();
    t.state.ready = false;
    t.sync.update(1 / 60);
    expect(t.published).toHaveLength(0);
  });

  it('flags a jump that walking, falling or sprinting cannot make', () => {
    const t = setup();
    t.sync.update(1 / 60);
    // 7.2 m/s sprint, 55 m/s fall: both ordinary even on a slow frame.
    t.state.x += 0.12;
    t.sync.update(1 / 60);
    t.state.y -= 0.9;
    t.sync.update(1 / 60);
    expect(t.published.slice(1).every((s) => !s.reset)).toBe(true);
    // A respawn: 40 blocks in one frame.
    t.state.x += 40;
    t.sync.update(1 / 60);
    expect(t.published[3]?.reset).toBe(true);
    t.sync.update(1 / 60);
    expect(t.published[4]?.reset).toBe(false);
  });

  it('allows more distance after a long frame', () => {
    const t = setup();
    t.sync.update(1 / 60);
    t.state.x += 9;
    t.sync.update(0.5);
    expect(t.published[1]?.reset).toBe(false);
  });

  it('moves the player when the host corrects it, and reports the move as on purpose', () => {
    const t = setup();
    t.sync.update(1 / 60);
    t.corrections.emit({ x: 5, y: 1, z: 6 });
    expect(t.teleports).toEqual([[5, 1, 6]]);
    t.sync.update(1 / 60);
    expect(t.published[1]).toMatchObject({ x: 5, y: 1, z: 6, reset: true });
    t.sync.update(1 / 60);
    expect(t.published[2]?.reset).toBe(false);
  });

  it('stops listening when disposed', () => {
    const t = setup();
    t.sync.dispose();
    t.corrections.emit({ x: 5, y: 1, z: 6 });
    expect(t.teleports).toEqual([]);
  });
});

describe('block digest', () => {
  it('is the same for equal worlds and changes with any cell', () => {
    const a = new TestWorld(1);
    const b = new TestWorld(2);
    expect(digestBlocks(a)).toEqual({ count: 0, hash: digestBlocks(b).hash });
    a.setBlock(1, 2, 3, 257);
    a.setBlock(-4, 0, 9, 258);
    // Built in the other order, as a late joiner would.
    b.setBlock(-4, 0, 9, 258);
    b.setBlock(1, 2, 3, 257);
    expect(digestBlocks(a)).toEqual(digestBlocks(b));
    expect(digestBlocks(a).count).toBe(2);
    const before = digestBlocks(a).hash;
    b.setBlock(1, 2, 3, 259);
    expect(digestBlocks(b).hash).not.toBe(before);
    b.setBlock(1, 2, 3, 257);
    b.setBlock(7, 7, 7, 1);
    expect(digestBlocks(b).hash).not.toBe(before);
    b.setBlock(7, 7, 7, 0);
    expect(digestBlocks(b).hash).toBe(before);
  });
});
