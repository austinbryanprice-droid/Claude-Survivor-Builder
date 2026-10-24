import { describe, expect, it } from 'vitest';
import { REFUSAL } from '../../src/net/host-session';
import { SurvivalMirror } from '../../src/net/survival-mirror';
import { ManualScheduler } from '../../src/net/scheduler';
import {
  createReading,
  type SurvivalEvent,
  type SurvivalView,
} from '../../src/shared/survival-state';
import { HOST_PLAYER_ID, type HostFrame } from '../../src/shared/protocol';
import { RESPAWN, VITALS } from '../../src/systems/survival/balance';
import { at, helloText, makeRoom, rawGuest, type TestWorld } from './helpers/net';

type Room = ReturnType<typeof makeRoom>;

const DELAY_MS = RESPAWN.delaySeconds * 1000;

function read(view: SurvivalView) {
  return { ...view.read(createReading()) };
}

function listen(view: SurvivalView): SurvivalEvent[] {
  const seen: SurvivalEvent[] = [];
  view.onEvent((event) => seen.push(event));
  return seen;
}

/** Lays a player down on the spot. */
function fell(room: Room, id: number): void {
  room.host.survivalSim?.hurtPlayer(id, VITALS.maxHealth * 10);
}

/** The `vt` words, or the `sv` words, a raw guest has been sent so far. */
function words<K extends 'vt' | 'sv'>(
  raw: Awaited<ReturnType<typeof rawGuest>>,
  kind: K,
): Extract<HostFrame, { t: K }>[] {
  return raw.frames.filter((frame): frame is Extract<HostFrame, { t: K }> => frame.t === kind);
}

describe('a guest who is down', () => {
  async function downGuest() {
    const room = makeRoom({ survival: true });
    const code = await room.openRoom();
    const guest = await room.join(code, 'Ada');
    guest.session.publishState(at(2.5, 0, 0.5));
    await room.settle(100);
    return { room, guest, id: guest.session.localId };
  }

  it('is refused every change to the world, with the reason to show', async () => {
    const { room, guest, id } = await downGuest();
    const refusals: string[] = [];
    guest.session.onRejected((refusal) => refusals.push(refusal.reason));
    fell(room, id);
    await room.settle(300);
    guest.session.sendCommand({ type: 'place', x: 3, y: 0, z: 1, state: 257 });
    await room.settle(300);
    expect(refusals).toEqual([REFUSAL.down]);
    expect((room.hostWorld as TestWorld).cells.size).toBe(0);
    expect(REFUSAL.down).toBe('you are down');
  });

  it('builds again once the Core has brought them back', async () => {
    const { room, guest, id } = await downGuest();
    fell(room, id);
    await room.settle(DELAY_MS + 600);
    guest.session.publishState(at(2.5, 0, 0.5));
    await room.settle(100);
    guest.session.sendCommand({ type: 'place', x: 3, y: 0, z: 1, state: 257 });
    await room.settle(300);
    expect(room.hostWorld.cells.size).toBe(1);
  });

  it('is announced to everyone, and so is their return with the charges left', async () => {
    const { room, guest, id } = await downGuest();
    const hostSeen = listen(room.host.survival);
    const guestSeen = listen(guest.session.survival);
    fell(room, id);
    await room.settle(300);
    expect(hostSeen).toEqual([{ k: 'down', n: 1, p: id }]);
    expect(guestSeen).toEqual([{ k: 'down', n: 1, p: id }]);
    await room.settle(DELAY_MS + 300);
    const back = { k: 'back', n: 1, p: id, c: 2 * RESPAWN.startPerPlayer - 1 };
    expect(hostSeen).toEqual([{ k: 'down', n: 1, p: id }, back]);
    expect(guestSeen).toEqual([{ k: 'down', n: 1, p: id }, back]);
  });

  it('is told their Health is gone and how long the Core takes, then that they are back and shaken', async () => {
    const room = makeRoom({ survival: true });
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const id = (raw.frames.find((frame) => frame.t === 'welcome') as { id: number }).id;
    fell(room, id);
    await room.settle(DELAY_MS + 800);
    const seen = words(raw, 'vt');
    const downWords = seen.filter((word) => word.hp[0] === 0);
    expect(downWords.length).toBeGreaterThanOrEqual(RESPAWN.delaySeconds - 1);
    // The countdown goes out as it changes, a word a second at least, each one lower than the last.
    const countdown = downWords.map((word) => word.rt);
    expect(countdown[0]).toBe(RESPAWN.delaySeconds);
    expect(countdown.at(-1)).toBeGreaterThanOrEqual(1);
    expect(countdown).toEqual([...countdown].sort((a, b) => b - a));
    expect(new Set(countdown).size).toBeGreaterThanOrEqual(RESPAWN.delaySeconds - 1);
    expect(downWords.every((word) => word.sk === 0)).toBe(true);

    const last = seen.at(-1)!;
    expect(last.hp).toEqual([VITALS.maxHealth, VITALS.maxHealth]);
    expect(last.en[0]).toBeLessThanOrEqual(VITALS.maxEnergy * RESPAWN.energy);
    expect(last.rt).toBe(0);
    expect(last.sk).toBeGreaterThan(RESPAWN.shaken.seconds - 3);
  });

  it('is carried back to their seat at the base, and the host believes it from then on', async () => {
    const { room, guest, id } = await downGuest();
    const fixes: { x: number; y: number; z: number }[] = [];
    guest.session.onCorrection((fix) => fixes.push(fix));
    // The guest walks a little way off and falls there.
    guest.session.publishState(at(9.5, 0, 0.5));
    await room.settle(100);
    fell(room, id);
    await room.settle(DELAY_MS + 500);
    expect(fixes).toEqual([{ x: 2.5, y: 0, z: 0.5 }]);
    expect(guest.session.stats.corrections).toBe(1);
    expect(room.host.stats.corrections).toBe(1);

    // Reports from before the word arrived are thrown away; the ones after it are taken.
    guest.session.publishState(at(2.5, 0, 0.5));
    await room.settle(200);
    const seen = room.host.sampleRemotes().find((pose) => pose.id === id);
    expect(seen?.x).toBeCloseTo(2.5, 0);
    expect(room.host.stats.corrections).toBe(1);

    const feet = { x: 0, y: 0, z: 0 };
    expect(room.host.survivalSim?.playerVitals(id)?.position(feet)).toBe(true);
    expect(feet.x).toBeCloseTo(2.5, 6);
    expect(feet.z).toBeCloseTo(0.5, 6);
  });

  it('is put at the base the moment they return, not where the machines last saw them', async () => {
    const { room, guest, id } = await downGuest();
    guest.session.publishState(at(9.5, 0, 0.5));
    await room.settle(100);
    const feet = { x: 0, y: 0, z: 0 };
    room.host.survivalSim?.playerVitals(id)?.position(feet);
    expect(feet.x).toBeCloseTo(9.5, 6);
    fell(room, id);
    await room.settle(DELAY_MS + 300);
    room.host.survivalSim?.playerVitals(id)?.position(feet);
    expect(feet.x).toBeCloseTo(2.5, 6);
    // The host's screen shows them there at once, not on the spot where they fell and not nowhere.
    const seat = room.host.sampleRemotes().find((pose) => pose.id === id);
    expect(seat).toBeDefined();
    expect(seat?.x).toBeCloseTo(2.5, 6);
  });

  it('is not corrected for the spot they were carried to being far from where they fell', async () => {
    const { room, guest, id } = await downGuest();
    // The base is a long way from the fall: more than a guest could walk in the time the host allows.
    guest.session.publishState(at(40.5, 0, 0.5));
    await room.settle(100);
    fell(room, id);
    await room.settle(DELAY_MS + 500);
    const before = room.host.stats.corrections;
    guest.session.publishState(at(2.5, 0, 0.5, { reset: true }));
    await room.settle(300);
    guest.session.publishState(at(3, 0, 0.5));
    await room.settle(300);
    expect(room.host.stats.corrections).toBe(before);
  });
});

describe('the host’s own player down', () => {
  it('is refused changes to the world, and builds again when back', () => {
    const room = makeRoom({ survival: true });
    room.host.setLocalActive(true);
    room.host.publishState(at(0.5, 0, 0.5));
    const refusals: string[] = [];
    room.host.onRejected((refusal) => refusals.push(refusal.reason));
    fell(room, HOST_PLAYER_ID);
    room.scheduler.advance(300);
    room.host.sendCommand({ type: 'place', x: 1, y: 0, z: 1, state: 257 });
    expect(refusals).toEqual([REFUSAL.down]);
    expect(room.hostWorld.cells.size).toBe(0);
    room.scheduler.advance(DELAY_MS + 300);
    room.host.sendCommand({ type: 'place', x: 1, y: 0, z: 1, state: 257 });
    expect(room.hostWorld.cells.size).toBe(1);
  });

  it('is moved to the first seat when the Core brings them back, by the same word a guest gets', () => {
    const room = makeRoom({
      survival: true,
      spawnFor: (slot) => ({ x: 20 + slot, y: 1, z: 20 }),
    });
    room.host.setLocalActive(true);
    room.host.publishState(at(5, 0, 5));
    room.scheduler.advance(100);
    const fixes: { x: number; y: number; z: number }[] = [];
    room.host.onCorrection((fix) => fixes.push(fix));
    fell(room, HOST_PLAYER_ID);
    room.scheduler.advance(DELAY_MS - 500);
    expect(fixes).toEqual([]);
    room.scheduler.advance(1000);
    expect(fixes).toEqual([{ x: 20, y: 1, z: 20 }]);
    const feet = { x: 0, y: 0, z: 0 };
    expect(room.host.survivalSim?.playerVitals(HOST_PLAYER_ID)?.position(feet)).toBe(true);
    expect(feet).toEqual({ x: 20, y: 1, z: 20 });
    // It is not a movement check: the count of guests moved back stays where it was.
    expect(room.host.stats.corrections).toBe(0);
  });
});

describe('the crew’s respawn charges in a room', () => {
  it('are told to a newcomer with the clock, and to everyone as they change', async () => {
    const room = makeRoom({ survival: true });
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const first = words(raw, 'sv')[0]!;
    expect(first.rc).toEqual([2 * RESPAWN.startPerPlayer, 2 * RESPAWN.capPerPlayer]);
    expect(first.why).toBeUndefined();

    const id = (raw.frames.find((frame) => frame.t === 'welcome') as { id: number }).id;
    fell(room, id);
    await room.settle(DELAY_MS + 800);
    expect(words(raw, 'sv').at(-1)?.rc).toEqual([
      2 * RESPAWN.startPerPlayer - 1,
      2 * RESPAWN.capPerPlayer,
    ]);
  });

  it('read the same on the host and on a guest', async () => {
    const room = makeRoom({ survival: true });
    const code = await room.openRoom();
    const guest = await room.join(code);
    await room.settle(600);
    const mine = read(guest.session.survival);
    const theirs = read(room.host.survival);
    expect(mine).toMatchObject({
      respawns: 2 * RESPAWN.startPerPlayer,
      respawnMax: 2 * RESPAWN.capPerPlayer,
      overWhy: null,
    });
    expect(theirs).toMatchObject({ respawns: mine.respawns, respawnMax: mine.respawnMax });
    room.host.survivalSim?.setRespawns(1);
    await room.settle(600);
    expect(read(guest.session.survival).respawns).toBe(1);
  });

  it('end the run for everyone when the last player falls with none left, and say why', async () => {
    const room = makeRoom({ survival: true });
    const code = await room.openRoom();
    const guest = await room.join(code);
    room.host.survivalSim?.setRespawns(0);
    const hostSeen = listen(room.host.survival);
    const guestSeen = listen(guest.session.survival);
    fell(room, guest.session.localId);
    await room.settle(300);
    expect(read(room.host.survival).over).toBe(false);
    fell(room, HOST_PLAYER_ID);
    await room.settle(600);
    const overrun = { k: 'overrun', n: 1, why: 'crew' };
    expect(hostSeen.at(-1)).toEqual(overrun);
    expect(guestSeen.at(-1)).toEqual(overrun);
    expect(read(room.host.survival)).toMatchObject({ over: true, overWhy: 'crew', running: false });
    expect(read(guest.session.survival)).toMatchObject({
      over: true,
      overWhy: 'crew',
      running: false,
      respawns: 0,
    });
    // The Core is standing, and the guest's gauge says so.
    expect(read(guest.session.survival).coreHealth).toBe(read(guest.session.survival).coreMax);
    const held = room.host.survivalSim?.elapsed ?? 0;
    await room.settle(3000);
    expect(room.host.survivalSim?.elapsed).toBe(held);
  });

  it('tell a player who joins after the wipe that the run is over, and why', async () => {
    const room = makeRoom({ survival: true });
    room.host.setLocalActive(true);
    room.host.survivalSim?.setRespawns(0);
    fell(room, HOST_PLAYER_ID);
    room.scheduler.advance(200);
    const code = await room.openRoom();
    const guest = await room.join(code);
    await room.settle(300);
    expect(read(guest.session.survival)).toMatchObject({ over: true, overWhy: 'crew' });
  });

  it('grow at dawn, for every player in the room', async () => {
    const room = makeRoom({ survival: true });
    const code = await room.openRoom();
    const guest = await room.join(code);
    room.host.survivalSim?.setRespawns(0);
    room.host.survivalSim?.warp(12 * 60);
    await room.settle(600);
    expect(read(guest.session.survival).respawns).toBe(2 * RESPAWN.dawnPerPlayer);
  });

  it('say nothing of respawns where the host has no simulation', () => {
    const room = makeRoom();
    expect(read(room.host.survival)).toMatchObject({
      respawns: 0,
      respawnMax: 0,
      overWhy: null,
    });
  });
});

describe('the guest’s mirror of the crew’s respawn charges', () => {
  it('shows the last word and the cause, only while the run is over', () => {
    const mirror = new SurvivalMirror(new ManualScheduler());
    expect(read(mirror)).toMatchObject({ respawns: 0, respawnMax: 0, overWhy: null });
    mirror.apply(100, true, 1000, 1000, false, null, 4, 6);
    expect(read(mirror)).toMatchObject({ respawns: 4, respawnMax: 6, overWhy: null });
    mirror.apply(200, false, 1000, 1000, true, 'crew', 0, 6);
    expect(read(mirror)).toMatchObject({ respawns: 0, respawnMax: 6, over: true, overWhy: 'crew' });
    // A cause without an end is nothing to show.
    mirror.apply(300, true, 1000, 1000, false, 'core', 1, 6);
    expect(read(mirror).overWhy).toBeNull();
  });

  it('works for callers that send only the clock and the Core, as before', () => {
    const mirror = new SurvivalMirror(new ManualScheduler());
    mirror.apply(20, true, 640, 1000, false);
    expect(read(mirror)).toMatchObject({ respawns: 0, respawnMax: 0, overWhy: null });
  });
});
