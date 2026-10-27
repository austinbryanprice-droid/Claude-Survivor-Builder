import { describe, expect, it } from 'vitest';
import { createEconomyReading, type EconomyReading } from '../../src/shared/economy';
import { PoolWatcher, poolFull } from '../../src/ui/pool-hud';

/** A reading of a run with a pool whose ceiling is `cap` (0 for no pool), this many research points earned. */
function reading(cap: number, research = 40): EconomyReading {
  const out = createEconomyReading();
  out.cap = cap;
  out.research = research;
  out.claimed = research;
  return out;
}

describe('a pool that holds all it can of a material', () => {
  it('is full at the ceiling and above it, and not below', () => {
    expect(poolFull(399, 400)).toBe(false);
    expect(poolFull(400, 400)).toBe(true);
    // A Storage that falls leaves the pool above its ceiling until it is spent down.
    expect(poolFull(450, 400)).toBe(true);
    expect(poolFull(0, 400)).toBe(false);
  });

  it('is never full where there is no pool to be full', () => {
    expect(poolFull(0, 0)).toBe(false);
    expect(poolFull(5, 0)).toBe(false);
  });
});

describe('the messages about the room in the pool', () => {
  it('say nothing at the first look, whatever the ceiling', () => {
    const watcher = new PoolWatcher();
    expect(watcher.update(reading(500))).toEqual([]);
    expect(watcher.update(reading(500))).toEqual([]);
  });

  it('tell that a Storage raised the ceiling, once', () => {
    const watcher = new PoolWatcher();
    watcher.update(reading(400));
    expect(watcher.update(reading(500))).toEqual(['Storage built · the pool holds 500 of each']);
    expect(watcher.update(reading(500))).toEqual([]);
    expect(watcher.update(reading(700))).toEqual(['Storage built · the pool holds 700 of each']);
  });

  it('tell that a Storage was lost when the ceiling falls and the run goes on', () => {
    const watcher = new PoolWatcher();
    watcher.update(reading(500, 40));
    expect(watcher.update(reading(400, 40))).toEqual([
      'A Storage is gone · the pool holds 400 of each',
    ]);
    expect(watcher.update(reading(400, 50))).toEqual([]);
  });

  it('say nothing when a new run takes the ceiling back with the research points', () => {
    const watcher = new PoolWatcher();
    watcher.update(reading(600, 90));
    expect(watcher.update(reading(400, 0))).toEqual([]);
    // The new run's first Storage is news again.
    expect(watcher.update(reading(500, 40))).toEqual([
      'Storage built · the pool holds 500 of each',
    ]);
  });

  it('say nothing while there is no pool, and treat the first word of the host as a first look', () => {
    const watcher = new PoolWatcher();
    watcher.update(reading(400));
    expect(watcher.update(reading(0))).toEqual([]);
    expect(watcher.update(reading(500))).toEqual([]);
    expect(watcher.update(reading(600))).toEqual(['Storage built · the pool holds 600 of each']);
  });
});
