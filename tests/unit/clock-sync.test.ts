import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/shared/hash';
import { ClockSync } from '../../src/shared/clock-sync';

describe('clock sync', () => {
  it('takes the first packet as the offset', () => {
    const sync = new ClockSync();
    expect(sync.ready).toBe(false);
    sync.observe(1000, 400);
    expect(sync.ready).toBe(true);
    expect(sync.offset).toBe(600);
    expect(sync.toLocal(500)).toBe(1100);
    expect(sync.remoteNow(1600)).toBe(1000);
  });

  it('settles on the fastest trips, not the average', () => {
    // Their clock is 5000 ms ahead of ours (offset -5000); trips take 20 to 120 ms.
    const sync = new ClockSync();
    const rng = createRng(3);
    for (let i = 0; i < 400; i++) {
      const sent = i * 50;
      const trip = 20 + rng() * 100;
      sync.observe(sent + 5000 * -1 + trip, sent);
    }
    expect(sync.offset).toBeLessThan(-5000 + 25);
    expect(sync.offset).toBeGreaterThan(-5000 + 18);
  });

  it('glides toward a new offset instead of jumping', () => {
    const sync = new ClockSync();
    for (let i = 0; i < 20; i++) sync.observe(i * 50 + 100, i * 50);
    expect(sync.offset).toBe(100);
    // The path suddenly gets 40 ms faster; the estimate follows at 0.5 ms a packet.
    let previous = sync.offset;
    for (let i = 20; i < 40; i++) {
      sync.observe(i * 50 + 60, i * 50);
      expect(sync.offset).toBeLessThanOrEqual(previous);
      expect(previous - sync.offset).toBeLessThanOrEqual(0.5 + 1e-9);
      previous = sync.offset;
    }
    expect(sync.offset).toBeCloseTo(90, 6);
  });

  it('snaps when the disagreement is large', () => {
    const sync = new ClockSync();
    for (let i = 0; i < 10; i++) sync.observe(i * 50 + 100, i * 50);
    // The other clock restarts, or a long stall passes: a gap over 250 ms is taken at once.
    for (let i = 10; i < 400; i++) sync.observe(i * 50 + 2000, i * 50);
    expect(sync.offset).toBeCloseTo(2000, 6);
  });

  it('forgets old minimums after the window', () => {
    const sync = new ClockSync();
    sync.observe(0, -50); // one unusually fast trip: offset 50
    for (let i = 1; i <= 400; i++) sync.observe(i * 50 + 130, i * 50); // offset 130 from then on
    expect(sync.offset).toBeCloseTo(130, 6);
  });
});
