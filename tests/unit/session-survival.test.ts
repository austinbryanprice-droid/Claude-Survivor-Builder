import { describe, expect, it } from 'vitest';
import { SessionHub } from '../../src/net/hub';
import { HostSession } from '../../src/net/host-session';
import { ManualScheduler } from '../../src/net/scheduler';
import { fixedWorld } from '../../src/net/session';
import { SurvivalMirror } from '../../src/net/survival-mirror';
import { DAY_SECONDS } from '../../src/shared/daycycle';
import { NET } from '../../src/shared/net-config';
import {
  createReading,
  nightStart,
  type SurvivalEvent,
  type SurvivalView,
} from '../../src/shared/survival-state';
import { SURVIVAL } from '../../src/systems/survival/balance';
import { SurvivalSim } from '../../src/systems/survival/sim';
import { TestWorld, helloText, makeRoom, rawGuest, token } from './helpers/net';

function read(view: SurvivalView) {
  return { ...view.read(createReading()) };
}

/** What the host says about the clock when the Core is whole. */
function say(mirror: SurvivalMirror, tick: number, run: boolean): void {
  mirror.apply(tick, run, 1000, 1000, false);
}

function listen(view: SurvivalView): SurvivalEvent[] {
  const seen: SurvivalEvent[] = [];
  view.onEvent((event) => seen.push(event));
  return seen;
}

describe('the survival clock on the host', () => {
  it('waits for a lone player: nothing passes while the mouse is free', () => {
    const room = makeRoom({ survival: true });
    room.scheduler.advance(10_000);
    expect(read(room.host.survival)).toMatchObject({ elapsed: 0, running: false });
  });

  it('runs while the player is playing and stops again when they step away', () => {
    const room = makeRoom({ survival: true });
    room.host.setLocalActive(true);
    room.scheduler.advance(10_000);
    const playing = read(room.host.survival);
    expect(playing.running).toBe(true);
    expect(playing.elapsed).toBeCloseTo(10, 0);

    room.host.setLocalActive(false);
    room.scheduler.advance(10_000);
    const away = read(room.host.survival);
    expect(away.running).toBe(false);
    expect(away.elapsed).toBeCloseTo(playing.elapsed, 1);
  });

  it('does not replay the time it was held when play starts again', () => {
    const room = makeRoom({ survival: true });
    room.scheduler.advance(60_000);
    room.host.setLocalActive(true);
    room.scheduler.advance(NET.relayIntervalMs * 2);
    expect(room.host.survivalSim?.elapsed).toBeLessThan(0.2);
  });

  it('keeps running for guests while the host is away, and holds again when they have all gone', async () => {
    const room = makeRoom({ survival: true });
    const code = await room.openRoom();
    const guest = await room.join(code);
    room.host.setLocalActive(false);
    const before = room.host.survivalSim?.elapsed ?? 0;
    await room.settle(3000);
    const during = read(room.host.survival);
    expect(during.running).toBe(true);
    expect((room.host.survivalSim?.elapsed ?? 0) - before).toBeGreaterThan(2.5);

    guest.session.close();
    await room.settle(1000);
    const held = room.host.survivalSim?.elapsed ?? 0;
    await room.settle(3000);
    expect(room.host.survivalSim?.elapsed).toBe(held);
    expect(read(room.host.survival).running).toBe(false);
  });

  it('loses the time a blocked page missed instead of replaying a night', () => {
    const room = makeRoom({ survival: true });
    room.host.setLocalActive(true);
    room.scheduler.advance(1000);
    const before = room.host.survivalSim?.elapsed ?? 0;
    room.scheduler.stall(60_000);
    room.scheduler.advance(NET.relayIntervalMs * 2);
    const after = room.host.survivalSim?.elapsed ?? 0;
    expect(after - before).toBeLessThanOrEqual(SURVIVAL.maxCatchUpSeconds + 0.2);
  });

  it("announces nightfall and dawn to the host's own screen once each", () => {
    const room = makeRoom({ survival: true });
    const seen = listen(room.host.survival);
    room.host.survivalSim?.warp(DAY_SECONDS + 1);
    room.scheduler.advance(NET.relayIntervalMs);
    room.host.survivalSim?.warp(300);
    room.scheduler.advance(NET.relayIntervalMs);
    expect(seen).toEqual([
      { k: 'nightfall', n: 1 },
      { k: 'dawn', n: 1 },
    ]);
  });

  it('shows the first morning, held, when it has no simulation', () => {
    const room = makeRoom();
    room.host.setLocalActive(true);
    room.scheduler.advance(5000);
    expect(read(room.host.survival)).toMatchObject({ cycle: 1, phase: 'day', running: false });
    expect(room.host.survivalSim).toBeNull();
  });
});

describe('the survival clock in a room', () => {
  it('tells a newcomer the time with the world, not at the next regular word', async () => {
    const room = makeRoom({ survival: { startAt: nightStart(2) } });
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const kinds = raw.frames.map((frame) => frame.t);
    const welcome = kinds.indexOf('welcome');
    const word = kinds.indexOf('sv');
    expect(welcome).toBeGreaterThanOrEqual(0);
    expect(word).toBeGreaterThan(welcome);
    const first = raw.frames[word];
    expect(first).toMatchObject({ t: 'sv', run: true });
    expect(first && 'tick' in first ? first.tick : 0).toBeGreaterThanOrEqual(nightStart(2) * 20);
  });

  it("keeps a guest's clock within a moment of the host's", async () => {
    const room = makeRoom({ survival: { startAt: 100 }, latency: 40 });
    const code = await room.openRoom();
    const guest = await room.join(code);
    for (let i = 0; i < 6; i++) {
      await room.settle(1000);
      const host = read(room.host.survival);
      const mine = read(guest.session.survival);
      expect(mine.running).toBe(true);
      expect(Math.abs(mine.elapsed - host.elapsed)).toBeLessThan(0.25);
    }
  });

  it('tells every guest about nightfall and dawn, and the host too', async () => {
    const room = makeRoom({ survival: true });
    const code = await room.openRoom();
    const a = await room.join(code);
    const b = await room.join(code);
    const hostSeen = listen(room.host.survival);
    const aSeen = listen(a.session.survival);
    const bSeen = listen(b.session.survival);
    room.host.survivalSim?.warp(DAY_SECONDS + 1);
    await room.settle(200);
    room.host.survivalSim?.warp(300);
    await room.settle(200);
    const expected = [
      { k: 'nightfall', n: 1 },
      { k: 'dawn', n: 1 },
    ];
    expect(hostSeen).toEqual(expected);
    expect(aSeen).toEqual(expected);
    expect(bSeen).toEqual(expected);
  });

  it('shows a guest the new time soon after the host jumps the clock', async () => {
    const room = makeRoom({ survival: true });
    const code = await room.openRoom();
    const guest = await room.join(code);
    room.host.survivalSim?.warp(nightStart(3));
    await room.settle(1200);
    expect(read(guest.session.survival)).toMatchObject({ cycle: 3, phase: 'night' });
  });

  it('keeps the clock running for a guest when another guest leaves', async () => {
    const room = makeRoom({ survival: true });
    const code = await room.openRoom();
    const guest = await room.join(code);
    expect(read(guest.session.survival).running).toBe(true);
    // The first guest is still there, so the clock still runs.
    const other = await room.join(code);
    other.session.close();
    await room.settle(1000);
    expect(read(guest.session.survival).running).toBe(true);
  });
});

describe('the Outpost Core in a room', () => {
  const MAX = SURVIVAL.core.maxHealth;
  const night = { startAt: nightStart(1) };

  it('tells a newcomer how the Core stands with the world', async () => {
    const room = makeRoom({ survival: { ...night, coreHealth: 400 } });
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const word = raw.frames.find((frame) => frame.t === 'sv');
    expect(word).toMatchObject({ t: 'sv', core: [400, MAX], over: false });
  });

  it("shows a guest the host's Core soon after it is hurt", async () => {
    const room = makeRoom({ survival: night, latency: 40 });
    const code = await room.openRoom();
    const guest = await room.join(code);
    expect(read(guest.session.survival)).toMatchObject({ coreHealth: MAX, coreMax: MAX });
    room.host.survivalSim?.hurtCore(250);
    await room.settle(500);
    expect(read(guest.session.survival)).toMatchObject({
      coreHealth: MAX - 250,
      coreMax: MAX,
      over: false,
    });
    expect(read(room.host.survival)).toMatchObject({ coreHealth: MAX - 250, over: false });
  });

  it('does not send a word for every blow: a fight is reported a few times a second', async () => {
    const room = makeRoom({ survival: night });
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const before = raw.frames.filter((frame) => frame.t === 'sv').length;
    for (let i = 0; i < 20; i++) {
      room.host.survivalSim?.hurtCore(5);
      room.scheduler.advance(NET.relayIntervalMs);
    }
    const sent = raw.frames.filter((frame) => frame.t === 'sv').length - before;
    // A second of blows, one every 50 ms: about one word per coreIntervalMs, never one per blow.
    expect(sent).toBeGreaterThanOrEqual(3);
    expect(sent).toBeLessThanOrEqual(Math.ceil(1000 / NET.coreIntervalMs) + 1);
    // And the last word says where it ended up.
    await room.settle(NET.coreIntervalMs * 2);
    const last = raw.frames.filter((frame) => frame.t === 'sv').at(-1);
    expect(last).toMatchObject({ core: [MAX - 100, MAX] });
  });

  it('is quiet while nothing changes beyond the regular word', async () => {
    const room = makeRoom({ survival: night });
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const before = raw.frames.filter((frame) => frame.t === 'sv').length;
    await room.settle(2000);
    const sent = raw.frames.filter((frame) => frame.t === 'sv').length - before;
    expect(sent).toBeLessThanOrEqual(5);
  });

  it('ends the run for everyone when the Core falls: announced, flagged and the clocks stopped', async () => {
    const room = makeRoom({ survival: night });
    const code = await room.openRoom();
    const guest = await room.join(code);
    const hostSeen = listen(room.host.survival);
    const guestSeen = listen(guest.session.survival);
    room.host.survivalSim?.hurtCore(MAX);
    await room.settle(300);
    expect(hostSeen).toEqual([{ k: 'overrun', n: 1, why: 'core' }]);
    expect(guestSeen).toEqual([{ k: 'overrun', n: 1, why: 'core' }]);
    expect(read(room.host.survival)).toMatchObject({ over: true, running: false, coreHealth: 0 });
    expect(read(guest.session.survival)).toMatchObject({
      over: true,
      running: false,
      coreHealth: 0,
    });

    const held = room.host.survivalSim?.elapsed ?? 0;
    await room.settle(3000);
    expect(room.host.survivalSim?.elapsed).toBe(held);
    expect(read(guest.session.survival).elapsed).toBeCloseTo(held, 1);
  });

  it('tells a player who joins after the fall that the run is over', async () => {
    const room = makeRoom({ survival: night });
    room.host.setLocalActive(true);
    room.host.survivalSim?.hurtCore(MAX);
    room.scheduler.advance(NET.relayIntervalMs);
    const code = await room.openRoom();
    const guest = await room.join(code);
    await room.settle(300);
    expect(read(guest.session.survival)).toMatchObject({ over: true, coreHealth: 0 });
  });

  it('stops the host’s own clock at the fall even while the player is playing', () => {
    const room = makeRoom({ survival: night });
    room.host.setLocalActive(true);
    const seen = listen(room.host.survival);
    room.scheduler.advance(1000);
    room.host.survivalSim?.hurtCore(MAX);
    room.scheduler.advance(NET.relayIntervalMs);
    const held = room.host.survivalSim?.elapsed ?? 0;
    room.scheduler.advance(5000);
    expect(room.host.survivalSim?.elapsed).toBe(held);
    expect(read(room.host.survival)).toMatchObject({ running: false, over: true });
    expect(seen).toEqual([{ k: 'overrun', n: 1, why: 'core' }]);
  });

  it('has no Core to show where there is no simulation', () => {
    const room = makeRoom();
    expect(read(room.host.survival)).toMatchObject({ coreMax: 0, coreHealth: 0, over: false });
  });
});

describe("the guest's mirror of the Core", () => {
  it('shows the Core and the fall the host last reported', () => {
    const mirror = new SurvivalMirror(new ManualScheduler());
    expect(read(mirror)).toMatchObject({ coreHealth: 0, coreMax: 0, over: false });
    mirror.apply(20 * 300, true, 640, 1000, false);
    expect(read(mirror)).toMatchObject({ coreHealth: 640, coreMax: 1000, over: false });
    mirror.apply(20 * 301, false, 0, 1000, true);
    expect(read(mirror)).toMatchObject({
      coreHealth: 0,
      coreMax: 1000,
      over: true,
      running: false,
    });
  });
});

describe('the hub and the survival view', () => {
  function solo(survival: boolean) {
    const scheduler = new ManualScheduler();
    const session = new HostSession({
      scheduler,
      world: fixedWorld(new TestWorld(1)),
      name: 'Solo',
      token: token(60),
      survival: survival ? new SurvivalSim() : undefined,
    });
    return { scheduler, session };
  }

  it('reads whichever session is behind it and hears events from each in turn', () => {
    const first = solo(true);
    const second = solo(true);
    const hub = new SessionHub(first.session);
    const seen = listen(hub.survival);
    first.session.survivalSim?.warp(DAY_SECONDS + 1);
    first.scheduler.advance(NET.relayIntervalMs);
    expect(seen).toEqual([{ k: 'nightfall', n: 1 }]);

    hub.swap(second.session);
    expect(read(hub.survival).elapsed).toBe(0);
    first.session.survivalSim?.warp(300);
    first.scheduler.advance(NET.relayIntervalMs);
    expect(seen).toHaveLength(1);
    second.session.survivalSim?.warp(DAY_SECONDS + 5);
    second.scheduler.advance(NET.relayIntervalMs);
    expect(seen).toEqual([
      { k: 'nightfall', n: 1 },
      { k: 'nightfall', n: 1 },
    ]);
  });

  it("passes the player's presence to the session behind it, now and after a swap", () => {
    const first = solo(true);
    const second = solo(true);
    const hub = new SessionHub(first.session);
    hub.setLocalActive(true);
    first.scheduler.advance(2000);
    expect(first.session.survivalSim?.elapsed).toBeGreaterThan(1.5);

    hub.swap(second.session);
    second.scheduler.advance(2000);
    expect(second.session.survivalSim?.elapsed).toBeGreaterThan(1.5);

    hub.setLocalActive(false);
    second.scheduler.advance(2000);
    expect(second.session.survivalSim?.elapsed).toBeLessThan(2.5);
  });
});

describe("the guest's mirror of the clock", () => {
  it("carries the host's last word forward on its own timer while the clock runs", () => {
    const scheduler = new ManualScheduler();
    const mirror = new SurvivalMirror(scheduler);
    say(mirror, 20 * 100, true);
    scheduler.advance(1500);
    expect(read(mirror).elapsed).toBeCloseTo(101.5, 6);
  });

  it('stands still while the host says the clock is held', () => {
    const scheduler = new ManualScheduler();
    const mirror = new SurvivalMirror(scheduler);
    say(mirror, 20 * 100, false);
    scheduler.advance(5000);
    expect(read(mirror)).toMatchObject({ elapsed: 100, running: false });
  });

  it('stops carrying the clock if the host goes quiet', () => {
    const scheduler = new ManualScheduler();
    const mirror = new SurvivalMirror(scheduler);
    say(mirror, 0, true);
    scheduler.advance(60_000);
    expect(read(mirror).elapsed).toBeLessThanOrEqual(3);
  });

  it("does not let the countdown tick backwards when the host's word runs a little behind", () => {
    const scheduler = new ManualScheduler();
    const mirror = new SurvivalMirror(scheduler);
    say(mirror, 0, true);
    scheduler.advance(500);
    const shown = read(mirror).elapsed;
    // The next word says 0.45 s: the host's clock is a hair behind ours.
    say(mirror, Math.round(0.45 * 20), true);
    expect(read(mirror).elapsed).toBeGreaterThanOrEqual(shown);
  });

  it('follows a real rewind, such as a new run starting', () => {
    const scheduler = new ManualScheduler();
    const mirror = new SurvivalMirror(scheduler);
    say(mirror, 20 * 500, true);
    read(mirror);
    say(mirror, 0, true);
    expect(read(mirror).elapsed).toBeLessThan(1);
  });

  it('passes on what the host announces', () => {
    const mirror = new SurvivalMirror(new ManualScheduler());
    const seen = listen(mirror);
    mirror.announce({ k: 'nightfall', n: 2 });
    expect(seen).toEqual([{ k: 'nightfall', n: 2 }]);
  });
});
