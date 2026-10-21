import { Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { createRemotePlayers } from '../../src/engine/remote-players';
import { PLAYER_COLORS } from '../../src/shared/player-colors';
import type { RemotePose } from '../../src/shared/protocol';

function pose(id: number, extra: Partial<RemotePose> = {}): RemotePose {
  return {
    id,
    slot: id - 1,
    name: `P${id}`,
    x: id,
    y: 0,
    z: -id,
    yaw: 0,
    pitch: 0,
    speed: 0,
    onGround: true,
    ...extra,
  };
}

function setup() {
  const drawn: { name: string; color: string }[] = [];
  const players = createRemotePlayers({
    drawTag: (name, color) => {
      drawn.push({ name, color });
      return new Texture();
    },
  });
  return { players, drawn };
}

describe('remote players', () => {
  it('shows one suit per pose, in its seat color, at its place', () => {
    const { players, drawn } = setup();
    players.update(0.016, [pose(2), pose(3, { x: 5, y: 1, z: 7 })]);
    expect(players.object.children).toHaveLength(2);
    expect(players.list()).toEqual([
      { id: 2, name: 'P2', slot: 1, x: 2, y: 0, z: -2 },
      { id: 3, name: 'P3', slot: 2, x: 5, y: 1, z: 7 },
    ]);
    expect(drawn).toEqual([
      { name: 'P2', color: PLAYER_COLORS[1]?.hex },
      { name: 'P3', color: PLAYER_COLORS[2]?.hex },
    ]);
  });

  it('keeps the same objects while the same players stay', () => {
    const { players, drawn } = setup();
    players.update(0.016, [pose(2)]);
    const first = players.object.children[0];
    players.update(0.016, [pose(2, { x: 9 })]);
    players.update(0.016, [pose(2, { x: 10 })]);
    expect(players.object.children[0]).toBe(first);
    expect(players.object.children).toHaveLength(1);
    expect(players.list()[0]?.x).toBe(10);
    expect(drawn).toHaveLength(1);
  });

  it('removes a player who left', () => {
    const { players } = setup();
    players.update(0.016, [pose(2), pose(3)]);
    players.update(0.016, [pose(3)]);
    expect(players.object.children).toHaveLength(1);
    expect(players.list().map((p) => p.id)).toEqual([3]);
    players.update(0.016, []);
    expect(players.object.children).toHaveLength(0);
    expect(players.list()).toEqual([]);
  });

  it('redraws the tag when a seat changes hands, and only then', () => {
    const { players, drawn } = setup();
    players.update(0.016, [pose(2)]);
    players.update(0.016, [pose(2)]);
    expect(drawn).toHaveLength(1);
    players.update(0.016, [pose(2, { name: 'Renamed' })]);
    expect(drawn).toHaveLength(2);
    expect(drawn[1]).toEqual({ name: 'Renamed', color: PLAYER_COLORS[1]?.hex });
    players.update(0.016, [pose(2, { name: 'Renamed', slot: 3 })]);
    expect(drawn[2]).toEqual({ name: 'Renamed', color: PLAYER_COLORS[3]?.hex });
  });

  it('turns the body toward the view the short way round', () => {
    const { players } = setup();
    players.update(0.016, [pose(2, { yaw: 3.0 })]);
    const suit = players.object.children[0]?.children[0];
    expect(suit?.rotation.y).toBeCloseTo(3.0, 5);
    // A target just across the ±π seam is a small turn, not a spin through zero.
    players.update(0.05, [pose(2, { yaw: -3.0 })]);
    const after = suit?.rotation.y ?? 0;
    expect(Math.abs(Math.abs(after) - Math.PI)).toBeLessThan(0.2);
    for (let i = 0; i < 40; i++) players.update(0.05, [pose(2, { yaw: -3.0 })]);
    expect(suit?.rotation.y).toBeCloseTo(-3.0, 3);
  });

  it('cleans up after itself', () => {
    const { players } = setup();
    players.update(0.016, [pose(2), pose(3)]);
    const root = players.object;
    players.dispose();
    expect(players.list()).toEqual([]);
    expect(root.children).toHaveLength(0);
    expect(root.parent).toBeNull();
  });
});
