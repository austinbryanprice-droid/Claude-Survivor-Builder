import { describe, expect, it } from 'vitest';
import { NET } from '../../src/shared/net-config';
import { StallWatch } from '../../src/net/stall-watch';
import { makeRoom } from './helpers/net';

describe('stall watch', () => {
  it('reports nothing while ticks run about on time', () => {
    const watch = new StallWatch(50, 0);
    expect(watch.lateBy(50)).toBe(0);
    expect(watch.lateBy(103)).toBe(0);
    expect(watch.lateBy(160)).toBe(0);
    // Late, but by no more than a stall: ordinary timer jitter.
    expect(watch.lateBy(160 + 50 + NET.stallMs)).toBe(0);
  });

  it('reports how long the page was blocked, once', () => {
    const watch = new StallWatch(50, 0);
    expect(watch.lateBy(50)).toBe(0);
    expect(watch.lateBy(9050)).toBe(8950);
    expect(watch.lateBy(9100)).toBe(0);
  });

  it('does not take a background tab, whose timer ticks once a second, for a stall', () => {
    const watch = new StallWatch(50, 0);
    for (let second = 1; second <= 30; second++) expect(watch.lateBy(second * 1000)).toBe(0);
  });
});

describe('a page that was blocked is not the other side being gone', () => {
  it('keeps the guests and the host when every page was blocked for longer than the silence limit', async () => {
    const room = makeRoom({ latency: 20 });
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    const bo = await room.join(code, 'Bo');
    expect(room.host.players.map((p) => p.name)).toEqual(['Host', 'Ada', 'Bo']);

    // Every page is busy for twice the silence limit, so nothing is sent or read meanwhile.
    room.scheduler.stall(NET.timeoutMs * 2);
    await room.settle(1000);

    expect(room.host.players.map((p) => p.name)).toEqual(['Host', 'Ada', 'Bo']);
    expect(ada.session.phase).toBe('open');
    expect(bo.session.phase).toBe('open');
    expect(ada.session.closed).toBeNull();
  });

  it('keeps a room that is still talking after a stall', async () => {
    const room = makeRoom({ latency: 20 });
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    room.scheduler.stall(NET.timeoutMs * 3);
    await room.settle(NET.timeoutMs + 3000);
    // Well past the silence limit again, and both sides kept the link up by talking.
    expect(ada.session.phase).toBe('open');
    expect(room.host.players.map((p) => p.name)).toEqual(['Host', 'Ada']);
  });

  it('still drops a guest that went quiet for good, with a stall in the middle of the silence', async () => {
    const room = makeRoom({ latency: 20 });
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    const bo = await room.join(code, 'Bo');
    // Ada's link dies without a word; Bo's carries on.
    room.network.sever(room.network.links.find((l) => l.remoteId.startsWith('host-'))!);
    room.scheduler.stall(NET.timeoutMs * 2);
    await room.settle(1000);
    // The stall is forgiven: nobody is dropped on the strength of it...
    expect(room.host.players.map((p) => p.name)).toEqual(['Host', 'Ada', 'Bo']);
    // ...but the silence that comes after it counts in full.
    await room.settle(NET.timeoutMs + 3000);
    expect(room.host.players.map((p) => p.name)).toEqual(['Host', 'Bo']);
    expect(bo.session.phase).toBe('open');
    // Ada heard nothing from the host either, and says so once her own silence is up.
    expect(ada.session.closed?.reason).toBe('host-lost');
  });

  it('notices a dead guest on time when the host runs in a background tab, ticking once a second', async () => {
    const room = makeRoom({ latency: 20 });
    const code = await room.openRoom();
    await room.join(code, 'Ada');
    const bo = await room.join(code, 'Bo');
    room.network.sever(room.network.links.find((l) => l.remoteId.startsWith('host-'))!);
    for (let second = 0; second < (NET.timeoutMs + 3000) / 1000; second++) {
      room.scheduler.stall(950);
      await room.settle(50);
    }
    expect(room.host.players.map((p) => p.name)).toEqual(['Host', 'Bo']);
    expect(bo.session.phase).toBe('open');
  });
});
