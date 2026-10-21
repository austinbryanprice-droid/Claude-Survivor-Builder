import { describe, expect, it } from 'vitest';
import { chunkKey } from '../../src/world/voxels/chunk';
import { RemeshQueue } from '../../src/world/voxels/remesh-queue';

describe('RemeshQueue', () => {
  it('holds a chunk once, however often it is added', () => {
    const queue = new RemeshQueue();
    const key = chunkKey(1, 2, 3);
    queue.add(key);
    queue.add(key);
    expect(queue.size).toBe(1);
    expect(queue.has(key)).toBe(true);
    expect(queue.has(chunkKey(0, 0, 0))).toBe(false);
  });

  it('hands out the chunks nearest the point first', () => {
    const queue = new RemeshQueue();
    const near = chunkKey(0, 0, 0);
    const middle = chunkKey(2, 0, 0);
    const far = chunkKey(-4, 1, 3);
    // Added far to near, so a plain insertion order would come out the wrong way round.
    queue.add(far);
    queue.add(middle);
    queue.add(near);
    expect(queue.nearestFirst(8, 8, 8)).toEqual([near, middle, far]);
    // Moving the point to the far chunk's middle turns the order round.
    expect(queue.nearestFirst(-4 * 16 + 8, 1 * 16 + 8, 3 * 16 + 8)[0]).toBe(far);
  });

  it('breaks ties by key, whatever order the chunks arrived in', () => {
    const a = chunkKey(-1, 0, 0);
    const b = chunkKey(1, 0, 0);
    const first = new RemeshQueue();
    first.add(a);
    first.add(b);
    const second = new RemeshQueue();
    second.add(b);
    second.add(a);
    // The point sits halfway between the two chunks' middles.
    expect(first.nearestFirst(0, 8, 8)).toEqual(second.nearestFirst(0, 8, 8));
    expect(first.nearestFirst(0, 8, 8)).toEqual([Math.min(a, b), Math.max(a, b)]);
  });

  it('forgets chunks that are deleted or cleared', () => {
    const queue = new RemeshQueue();
    queue.add(chunkKey(0, 0, 0));
    queue.add(chunkKey(1, 0, 0));
    expect(queue.delete(chunkKey(0, 0, 0))).toBe(true);
    expect(queue.delete(chunkKey(0, 0, 0))).toBe(false);
    expect(queue.size).toBe(1);
    queue.clear();
    expect(queue.size).toBe(0);
    expect(queue.nearestFirst(0, 0, 0)).toEqual([]);
  });

  it('does not change the queue when it lists the chunks', () => {
    const queue = new RemeshQueue();
    queue.add(chunkKey(0, 0, 0));
    queue.nearestFirst(0, 0, 0);
    expect(queue.size).toBe(1);
  });
});
