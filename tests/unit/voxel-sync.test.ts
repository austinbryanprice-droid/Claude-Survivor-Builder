import { describe, expect, it } from 'vitest';
import { Lobby } from '../../src/net/lobby';
import { LoopbackNetwork } from '../../src/net/loopback';
import { ManualScheduler } from '../../src/net/scheduler';
import { digestBlocks } from '../../src/shared/block-digest';
import { MATERIAL, SHAPE, packState } from '../../src/shared/blocks';
import { createRng } from '../../src/shared/hash';
import { NET } from '../../src/shared/net-config';
import { VoxelWorld } from '../../src/world/voxels/world';
import { at } from './helpers/net';
import { TEST_SEED, terrain } from './helpers/valley';

/**
 * The sessions against the real voxel world rather than the small test one: the placement rules
 * (support, buried cells, bounds), the snapshot of a big build, and equal worlds on every peer.
 */

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const ALLOY = packState(SHAPE.cube, MATERIAL.alloy);

function makeEnv() {
  const scheduler = new ManualScheduler();
  const network = new LoopbackNetwork({ scheduler, random: createRng(7), latency: 10 });
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const settle = async (ms = 300): Promise<void> => {
    await flush();
    for (let t = 0; t < ms; t += 5) {
      scheduler.advance(5);
      await flush();
    }
  };
  let count = 0;
  function player() {
    const n = ++count;
    let world = new VoxelWorld(TEST_SEED, terrain());
    const lobby = new Lobby({
      scheduler,
      transport: network,
      buildId: 'test',
      random: createRng(900 + n),
      game: {
        world: () => world,
        loadWorld: (seed) => {
          world = new VoxelWorld(seed, terrain());
          return Promise.resolve(world);
        },
        spawnPoint: (slot) => {
          const x = 0.5 + slot * 2;
          return { x, y: terrain().field.heightAt(x, 0.5) + 0.05, z: 0.5 };
        },
      },
    });
    return { lobby, world: () => world };
  }
  return { scheduler, settle, player };
}

/** The cell that holds the surface at (x, z): the lowest cell a block can rest on the ground in. */
function surfaceCell(x: number, z: number): number {
  return Math.floor(terrain().field.heightAt(x + 0.5, z + 0.5));
}

describe('the real voxel world over the network', () => {
  it('lets a guest build on the ground, and every peer ends up with the same blocks', async () => {
    const env = makeEnv();
    const host = env.player();
    host.lobby.host();
    await env.settle(40);
    const code = host.lobby.state.code as string;
    const guest = env.player();
    guest.lobby.join(code);
    await env.settle(300);
    expect(guest.lobby.state.status).toBe('joined');

    const spawn = terrain().field.heightAt(2.5, 0.5);
    host.lobby.hub.publishState(at(0.5, terrain().field.heightAt(0.5, 0.5) + 0.05, 0.5));
    guest.lobby.hub.publishState(at(2.5, spawn + 0.05, 0.5));
    await env.settle(200);

    const y = surfaceCell(3, 3);
    guest.lobby.hub.sendCommand({ type: 'place', x: 3, y, z: 3, state: SCRAP });
    host.lobby.hub.sendCommand({ type: 'place', x: 4, y, z: 3, state: ALLOY });
    await env.settle(200);
    // A tower: each block rests on the one below.
    for (let i = 1; i <= 3; i++) {
      host.lobby.hub.sendCommand({ type: 'place', x: 3, y: y + i, z: 3, state: SCRAP });
    }
    await env.settle(200);

    expect(host.world().getBlock(3, y, 3)).toBe(SCRAP);
    expect(host.world().getBlock(4, y, 3)).toBe(ALLOY);
    expect(host.world().getBlock(3, y + 3, 3)).toBe(SCRAP);
    expect(digestBlocks(guest.world())).toEqual(digestBlocks(host.world()));
    expect(digestBlocks(host.world()).count).toBe(5);

    guest.lobby.hub.sendCommand({ type: 'break', x: 3, y: y + 3, z: 3 });
    await env.settle(100);
    expect(host.world().getBlock(3, y + 3, 3)).toBe(0);
    expect(digestBlocks(guest.world())).toEqual(digestBlocks(host.world()));
  });

  it("refuses what the world's own rules refuse, with the reason", async () => {
    const env = makeEnv();
    const host = env.player();
    host.lobby.host();
    await env.settle(40);
    const guest = env.player();
    guest.lobby.join(host.lobby.state.code as string);
    await env.settle(300);
    const spawnY = terrain().field.heightAt(2.5, 0.5) + 0.05;
    guest.lobby.hub.publishState(at(2.5, spawnY, 0.5));
    await env.settle(200);

    const reasons: string[] = [];
    guest.lobby.hub.onRejected((r) => reasons.push(r.reason));
    const y = surfaceCell(3, 3);
    // Floating in the air, with nothing to rest on.
    guest.lobby.hub.sendCommand({ type: 'place', x: 3, y: y + 3, z: 3, state: SCRAP });
    // A shape or material the tables do not have.
    guest.lobby.hub.sendCommand({ type: 'place', x: 3, y, z: 3, state: packState(9, 9) });
    // Deep inside the hill.
    guest.lobby.hub.sendCommand({ type: 'place', x: 3, y: y - 6, z: 3, state: SCRAP });
    // Nothing there to break.
    guest.lobby.hub.sendCommand({ type: 'break', x: 3, y, z: 3 });
    await env.settle(200);
    expect(reasons).toEqual(['unsupported', 'unknown-block', 'buried', 'empty']);
    expect(digestBlocks(host.world()).count).toBe(0);
  });

  it('sends a big build to a late joiner in several frames and builds the same world', async () => {
    const env = makeEnv();
    const host = env.player();
    host.lobby.host();
    await env.settle(40);
    // More cells than one snapshot frame holds. Built straight into the world: this is about the snapshot.
    const world = host.world();
    let placed = 0;
    for (let x = -26; x < 26 && placed < 2600; x++) {
      for (let z = -26; z < 26 && placed < 2600; z++) {
        const y = surfaceCell(x, z);
        if (world.setBlock(x, y, z, SCRAP)) placed++;
      }
    }
    expect(placed).toBeGreaterThan(NET.snapshotEditsPerFrame * 2);

    const guest = env.player();
    guest.lobby.join(host.lobby.state.code as string);
    await env.settle(500);
    expect(guest.lobby.state.status).toBe('joined');
    expect(digestBlocks(guest.world())).toEqual(digestBlocks(world));
    expect(digestBlocks(guest.world()).count).toBe(placed);
    // The joiner's world is the host's seed, built fresh.
    expect(guest.world().seed).toBe(TEST_SEED);
  });

  it('keeps the world and carries on alone when the host leaves', async () => {
    const env = makeEnv();
    const host = env.player();
    host.lobby.host();
    await env.settle(40);
    const guest = env.player();
    guest.lobby.join(host.lobby.state.code as string);
    await env.settle(300);
    host.lobby.hub.publishState(at(0.5, terrain().field.heightAt(0.5, 0.5) + 0.05, 0.5));
    const y = surfaceCell(2, 2);
    host.lobby.hub.sendCommand({ type: 'place', x: 2, y, z: 2, state: SCRAP });
    await env.settle(100);
    host.lobby.leave();
    await env.settle(100);
    expect(guest.lobby.state.status).toBe('ended');
    guest.lobby.playAlone();
    expect(guest.world().getBlock(2, y, 2)).toBe(SCRAP);
    guest.lobby.hub.publishState(at(0.5, terrain().field.heightAt(0.5, 0.5) + 0.05, 0.5));
    guest.lobby.hub.sendCommand({ type: 'place', x: 3, y: surfaceCell(3, 2), z: 2, state: SCRAP });
    expect(digestBlocks(guest.world()).count).toBe(2);
  });
});
