import { describe, expect, it } from 'vitest';
import type { LoopbackLink } from '../../src/net/loopback';
import type { GameSession } from '../../src/net/session';
import type { Vec3 } from '../../src/shared/look';
import { createReading, type SurvivalView } from '../../src/shared/survival-state';
import { HOST_PLAYER_ID, type HostFrame } from '../../src/shared/protocol';
import { createVitalsReading } from '../../src/shared/vitals-state';
import { encodeFrame, encodeGuestState } from '../../src/shared/wire';
import { RESPAWN, SURVIVAL, VITALS } from '../../src/systems/survival/balance';
import { at, helloText, makeRoom, rawGuest, token, type Guest } from './helpers/net';

type Room = ReturnType<typeof makeRoom>;
type Welcome = Extract<HostFrame, { t: 'welcome' }>;
type RunFrame = Extract<HostFrame, { t: 'run' }>;

const MAX = SURVIVAL.core.maxHealth;
/** The world a test room's host starts in. */
const FIRST_SEED = 4242;
/** The seat of the host (slot 0) and of the first guest (slot 1) when the room sets no spawn rule of its own. */
const HOST_SEAT = { x: 0.5, y: 0, z: 0.5 };
const GUEST_SEAT = { x: 2.5, y: 0, z: 0.5 };

function read(view: SurvivalView) {
  return { ...view.read(createReading()) };
}

/** The Core falls: the run is lost. */
function lose(room: Room): void {
  room.host.survivalSim?.hurtCore(MAX);
}

/** A room whose host can start a lost run over, and draws `seed` for a new valley. */
function restartableRoom(seed = 9001) {
  return makeRoom({ survival: true, restartable: { nextSeed: () => seed } });
}

/** Says something to a guest as its host would, down the real link. */
function tell(guest: Guest, frame: HostFrame): void {
  const link = (guest.session as unknown as { link: LoopbackLink | null }).link;
  link?.peer.sendControl(encodeFrame(frame));
}

function runFrames(raw: Awaited<ReturnType<typeof rawGuest>>): RunFrame[] {
  return raw.frames.filter((frame): frame is RunFrame => frame.t === 'run');
}

describe('a host starting a lost run over', () => {
  it('does nothing while the run goes on', async () => {
    const room = restartableRoom();
    const runs: number[] = [];
    room.host.onRun((n) => runs.push(n));
    const sim = room.host.survivalSim;
    room.host.restartRun('retry');
    room.host.restartRun('new');
    await room.settle(100);
    expect(room.host.run).toBe(1);
    expect(room.host.survivalSim).toBe(sim);
    expect(room.hostWorld.seed).toBe(FIRST_SEED);
    expect(runs).toEqual([]);
  });

  it('does nothing where there is no way to build the next run', async () => {
    const plain = makeRoom({ survival: true });
    lose(plain);
    plain.host.restartRun('retry');
    await plain.settle(100);
    expect(plain.host.run).toBe(1);
    expect(read(plain.host.survival).over).toBe(true);

    const none = makeRoom({ restartable: true });
    none.host.restartRun('retry');
    await none.settle(100);
    expect(none.host.run).toBe(1);
  });

  it('plays the same valley again on Retry, with nothing built on it and a new run', async () => {
    const room = restartableRoom();
    const runs: number[] = [];
    room.host.onRun((n) => runs.push(n));
    room.host.sendCommand({ type: 'place', x: 3, y: 0, z: 1, state: 257 });
    room.host.sendCommand({ type: 'place', x: 4, y: 0, z: 1, state: 257 });
    room.host.survivalSim?.hurtPlayer(HOST_PLAYER_ID, 60);
    room.host.survivalSim?.setRespawns(0);
    room.host.survivalSim?.warp(100);
    expect(room.hostWorld.cells.size).toBe(2);
    const before = room.host.survivalSim;
    lose(room);

    room.host.restartRun('retry');
    await room.settle(100);

    expect(room.host.run).toBe(2);
    expect(runs).toEqual([2]);
    expect(room.host.survivalSim).not.toBe(before);
    expect(room.hostWorld.seed).toBe(FIRST_SEED);
    expect(room.hostWorld.cells.size).toBe(0);
    expect(read(room.host.survival)).toMatchObject({
      over: false,
      overWhy: null,
      elapsed: 0,
      coreHealth: MAX,
      coreMax: MAX,
      respawns: RESPAWN.startPerPlayer,
      felled: 0,
      placed: 0,
      revived: 0,
    });
    expect(room.host.vitals.read(createVitalsReading())).toMatchObject({
      health: VITALS.maxHealth,
      energy: VITALS.maxEnergy,
    });
  });

  it('draws another valley on New Run, and never the one being played', async () => {
    const room = restartableRoom(9001);
    lose(room);
    room.host.restartRun('new');
    await room.settle(100);
    expect(room.hostWorld.seed).toBe(9001);
    expect(room.host.run).toBe(2);

    // A draw that lands on the current valley is not taken.
    const same = restartableRoom(FIRST_SEED);
    lose(same);
    same.host.restartRun('new');
    await same.settle(100);
    expect(same.hostWorld.seed).toBe(FIRST_SEED + 1);

    // Nor is one that is not a whole number; the next draw is.
    const draws = [1.5, Number.NaN, FIRST_SEED, 77];
    const picky = makeRoom({
      survival: true,
      restartable: { nextSeed: () => draws.shift() ?? 5 },
    });
    lose(picky);
    picky.host.restartRun('new');
    await picky.settle(100);
    expect(picky.hostWorld.seed).toBe(77);
  });

  it('keeps Retry on the valley it was playing, however many runs it has lost', async () => {
    const room = restartableRoom(31337);
    lose(room);
    room.host.restartRun('new');
    await room.settle(50);
    expect(room.hostWorld.seed).toBe(31337);
    lose(room);
    room.host.restartRun('retry');
    await room.settle(50);
    expect(room.hostWorld.seed).toBe(31337);
    expect(room.host.run).toBe(3);
  });

  it('starts only one run for a choice made twice, and none for a run that has not been lost', async () => {
    const room = restartableRoom();
    const runs: number[] = [];
    room.host.onRun((n) => runs.push(n));
    lose(room);
    room.host.restartRun('retry');
    room.host.restartRun('new');
    await room.settle(100);
    expect(runs).toEqual([2]);
    expect(room.hostWorld.seed).toBe(FIRST_SEED);
    room.host.restartRun('new');
    await room.settle(100);
    expect(runs).toEqual([2]);
  });

  it('seats the host again and tells their screen where', async () => {
    const room = makeRoom({
      survival: true,
      restartable: true,
      spawnFor: (slot) => ({ x: 20 + slot, y: 1, z: 20 }),
    });
    room.host.publishState(at(5, 0, 5));
    room.scheduler.advance(100);
    const fixes: { x: number; y: number; z: number }[] = [];
    room.host.onCorrection((fix) => fixes.push(fix));
    lose(room);
    room.host.restartRun('retry');
    await room.settle(100);
    expect(fixes).toEqual([{ x: 20, y: 1, z: 20 }]);
    const feet = { x: 0, y: 0, z: 0 };
    expect(room.host.survivalSim?.playerVitals(HOST_PLAYER_ID)?.position(feet)).toBe(true);
    expect(feet).toEqual({ x: 20, y: 1, z: 20 });
  });

  it('seats everyone at their seats, not at a Bed: the spawn rule is asked for no place', async () => {
    const asked: (Vec3 | undefined)[] = [];
    const room = makeRoom({
      survival: true,
      restartable: true,
      spawnFor: (slot, near) => {
        asked.push(near);
        return { x: 20 + slot, y: 1, z: 20 };
      },
    });
    room.host.publishState(at(5, 0, 5));
    room.scheduler.advance(100);
    lose(room);
    room.host.restartRun('retry');
    await room.settle(100);
    expect(asked.length).toBeGreaterThanOrEqual(2);
    expect(asked.every((near) => near === undefined)).toBe(true);
  });

  it('holds the new clock until someone plays, and does not replay the wait', async () => {
    const room = restartableRoom();
    room.host.setLocalActive(true);
    room.scheduler.advance(5_000);
    lose(room);
    room.scheduler.advance(200);
    room.host.setLocalActive(false);
    room.host.restartRun('retry');
    await room.settle(100);
    room.scheduler.advance(60_000);
    expect(read(room.host.survival)).toMatchObject({ elapsed: 0, running: false });
    room.host.setLocalActive(true);
    room.scheduler.advance(10_000);
    const playing = read(room.host.survival);
    expect(playing.running).toBe(true);
    expect(playing.elapsed).toBeGreaterThan(8);
    expect(playing.elapsed).toBeLessThan(11);
  });

  it('can be started over again and again', async () => {
    const room = restartableRoom();
    for (let run = 2; run <= 4; run++) {
      lose(room);
      room.host.restartRun('retry');
      await room.settle(50);
      expect(room.host.run).toBe(run);
      expect(read(room.host.survival).over).toBe(false);
    }
  });
});

describe('what the crew did, counted for the results', () => {
  it('counts the blocks the host accepted, whoever placed them, and not the ones it refused or the ones broken', async () => {
    const room = restartableRoom();
    const code = await room.openRoom();
    const guest = await room.join(code, 'Ada');
    guest.session.publishState(at(2.5, 0, 0.5));
    await room.settle(100);
    guest.session.sendCommand({ type: 'place', x: 3, y: 0, z: 1, state: 257 });
    guest.session.sendCommand({ type: 'place', x: 4, y: 0, z: 1, state: 257 });
    room.host.sendCommand({ type: 'place', x: 5, y: 0, z: 1, state: 257 });
    await room.settle(200);
    // An occupied cell, and one block broken: neither counts.
    guest.session.sendCommand({ type: 'place', x: 3, y: 0, z: 1, state: 257 });
    guest.session.sendCommand({ type: 'break', x: 4, y: 0, z: 1 });
    await room.settle(600);
    expect(room.host.survivalSim?.placed).toBe(3);
    expect(read(room.host.survival).placed).toBe(3);
    expect(read(guest.session.survival).placed).toBe(3);
  });

  it('tells a guest what the run came to when it is lost, to show on its own results card', async () => {
    const room = restartableRoom();
    const code = await room.openRoom();
    const guest = await room.join(code, 'Ada');
    room.host.survivalSim?.setRespawns(0);
    room.host.sendCommand({ type: 'place', x: 3, y: 0, z: 1, state: 257 });
    lose(room);
    await room.settle(600);
    expect(read(guest.session.survival)).toMatchObject({ over: true, placed: 1, felled: 0 });
  });
});

describe('a room whose host starts a lost run over', () => {
  async function joined(seed = 9001) {
    const room = restartableRoom(seed);
    const code = await room.openRoom();
    const guest = await room.join(code, 'Ada');
    guest.session.publishState(at(GUEST_SEAT.x, 0, GUEST_SEAT.z));
    await room.settle(100);
    return { room, code, guest, id: guest.session.localId };
  }

  it('takes every guest along: a new world, empty, and everyone back at their seat', async () => {
    const { room, guest, id } = await joined(9001);
    const runs: number[] = [];
    const fixes: { x: number; y: number; z: number }[] = [];
    guest.session.onRun((n) => runs.push(n));
    guest.session.onCorrection((fix) => fixes.push(fix));
    guest.session.sendCommand({ type: 'place', x: 3, y: 0, z: 1, state: 257 });
    room.host.sendCommand({ type: 'place', x: 4, y: 0, z: 1, state: 257 });
    room.host.survivalSim?.hurtPlayer(id, 70);
    await room.settle(300);
    expect(guest.world().cells.size).toBe(2);
    lose(room);
    await room.settle(300);
    expect(read(guest.session.survival).over).toBe(true);

    room.host.restartRun('new');
    await room.settle(400);

    expect(guest.loads.at(-1)).toEqual({ seed: 9001, count: 0 });
    expect(guest.world().seed).toBe(9001);
    expect(guest.world().cells.size).toBe(0);
    expect(room.hostWorld.seed).toBe(9001);
    expect(room.hostWorld.cells.size).toBe(0);
    expect(guest.session.run).toBe(2);
    expect(guest.session.phase).toBe('open');
    expect(runs).toEqual([2]);
    expect(fixes).toEqual([GUEST_SEAT]);

    expect(read(guest.session.survival)).toMatchObject({
      over: false,
      overWhy: null,
      coreHealth: MAX,
      coreMax: MAX,
      respawns: 2 * RESPAWN.startPerPlayer,
      felled: 0,
      placed: 0,
      revived: 0,
    });
    expect(read(guest.session.survival).elapsed).toBeLessThan(3);
    expect(guest.session.vitals.read(createVitalsReading()).health).toBe(VITALS.maxHealth);
    expect(room.host.survivalSim?.playerVitals(id)?.health).toBe(VITALS.maxHealth);
    const feet = { x: 0, y: 0, z: 0 };
    expect(room.host.survivalSim?.playerVitals(id)?.position(feet)).toBe(true);
    expect(feet).toEqual(GUEST_SEAT);
    expect(room.host.survivalSim?.playerVitals(HOST_PLAYER_ID)?.position(feet)).toBe(true);
    expect(feet).toEqual(HOST_SEAT);
  });

  it('plays Retry on the same valley for the guest too', async () => {
    const { room, guest } = await joined();
    lose(room);
    await room.settle(200);
    room.host.restartRun('retry');
    await room.settle(400);
    expect(guest.loads.at(-1)).toEqual({ seed: FIRST_SEED, count: 0 });
    expect(guest.session.run).toBe(2);
  });

  it('lets the guest build in the new world, and the host and the guest see the same one', async () => {
    const { room, guest } = await joined();
    lose(room);
    room.host.restartRun('new');
    await room.settle(400);
    guest.session.publishState(at(GUEST_SEAT.x, 0, GUEST_SEAT.z));
    await room.settle(100);
    guest.session.sendCommand({ type: 'place', x: 3, y: 0, z: 1, state: 257 });
    room.host.sendCommand({ type: 'place', x: 6, y: 0, z: 1, state: 257 });
    await room.settle(400);
    expect(room.hostWorld.cells.size).toBe(2);
    expect(guest.world().edits()).toEqual(room.hostWorld.edits());
    expect(room.host.survivalSim?.placed).toBe(2);
  });

  it('keeps what happens in the new world while the guest builds it, and applies it once it is up', async () => {
    const room = makeRoom({ survival: true, restartable: { nextSeed: () => 9001 }, loadMs: 500 });
    const code = await room.openRoom();
    const guest = await room.join(code, 'Ada');
    await room.settle(700);
    expect(guest.session.phase).toBe('open');
    lose(room);
    await room.settle(100);
    room.host.restartRun('new');
    await room.settle(100);
    expect(guest.session.phase).toBe('loading');
    // Nothing is sent from a screen that is building, and what the host does meanwhile waits.
    room.host.sendCommand({ type: 'place', x: 6, y: 0, z: 1, state: 257 });
    await room.settle(100);
    expect(guest.world().cells.size).toBe(0);
    await room.settle(600);
    expect(guest.session.phase).toBe('open');
    expect(guest.session.run).toBe(2);
    expect(guest.world().seed).toBe(9001);
    expect(guest.world().edits()).toEqual(room.hostWorld.edits());
    expect(guest.world().cells.size).toBe(1);
  });

  it('follows once the first world is up, for a guest still building it when the host starts over', async () => {
    const room = restartableRoom(9001);
    const code = await room.openRoom();
    const guest = room.addGuest('Ada', undefined, 800);
    guest.session.join(code);
    await room.settle(100);
    expect(guest.session.phase).toBe('loading');
    lose(room);
    room.host.restartRun('new');
    await room.settle(200);
    expect(guest.session.phase).toBe('loading');
    await room.settle(2000);
    expect(guest.loads.map((load) => load.seed)).toEqual([FIRST_SEED, 9001]);
    expect(guest.session.phase).toBe('open');
    expect(guest.session.run).toBe(2);
    expect(guest.world().seed).toBe(9001);
  });

  it('starts a guest who joins later in the run the host is on', async () => {
    const { room, code } = await joined();
    lose(room);
    room.host.restartRun('new');
    await room.settle(200);
    const late = await room.join(code, 'Bo');
    expect(late.session.run).toBe(2);
    expect(late.loads.at(-1)).toEqual({ seed: 9001, count: 0 });
    expect(read(late.session.survival).over).toBe(false);
  });

  it('is not something a guest can ask for', async () => {
    const { room, guest } = await joined();
    lose(room);
    await room.settle(200);
    const asked: GameSession = guest.session;
    asked.restartRun('retry');
    asked.restartRun('new');
    await room.settle(400);
    expect(room.host.run).toBe(1);
    expect(guest.session.run).toBe(1);
    expect(read(room.host.survival).over).toBe(true);
  });

  it('tells a guest with a frame of its own, with the seed and the seat, under a new epoch', async () => {
    const room = restartableRoom(9001);
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const welcome = raw.frames.find((frame): frame is Welcome => frame.t === 'welcome')!;
    expect(welcome.run).toBe(1);
    lose(room);
    room.host.restartRun('new');
    await room.settle(100);
    const [frame] = runFrames(raw);
    expect(runFrames(raw)).toHaveLength(1);
    expect(frame).toEqual({
      t: 'run',
      n: 2,
      seed: 9001,
      seq: expect.any(Number),
      spawn: GUEST_SEAT,
      epoch: (welcome.epoch + 1) & 0xff,
    });
    expect(raw.garbage).toEqual([]);
  });

  it('throws away what a guest sent under the old epoch and takes what it sends under the new', async () => {
    const room = restartableRoom();
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const welcome = raw.frames.find((frame): frame is Welcome => frame.t === 'welcome')!;
    const send = (epoch: number, seq: number, x: number) =>
      raw.link.sendState(
        encodeGuestState({ epoch, seq, time: room.scheduler.now(), sample: at(x, 0, 0.5) }),
      );
    send(welcome.epoch, 1, 2.5);
    await room.settle(100);
    const guestId = welcome.id;
    expect(room.host.sampleRemotes().find((pose) => pose.id === guestId)?.x).toBeCloseTo(2.5, 1);

    lose(room);
    room.host.restartRun('retry');
    await room.settle(100);
    const [frame] = runFrames(raw);
    // The screen has not rebuilt yet; what it reports from the old world is not believed.
    send(welcome.epoch, 2, 7.5);
    await room.settle(100);
    expect(room.host.sampleRemotes().find((pose) => pose.id === guestId)).toBeUndefined();
    send(frame!.epoch, 3, 2.5);
    await room.settle(100);
    expect(room.host.sampleRemotes().find((pose) => pose.id === guestId)?.x).toBeCloseTo(2.5, 1);
  });

  it('forgets where a guest who left in the old run had got to', async () => {
    const room = restartableRoom();
    const code = await room.openRoom();
    const first = await room.join(code, 'Ada', token(5));
    first.session.publishState(at(8.5, 0, -3.5));
    await room.settle(200);
    first.session.close();
    await room.settle(100);

    lose(room);
    room.host.restartRun('retry');
    await room.settle(100);

    const back = room.addGuest('Ada again', token(5));
    const moves: { x: number; y: number; z: number }[] = [];
    back.session.onCorrection((move) => moves.push(move));
    back.session.join(code);
    await room.settle(300);
    expect(moves[0]).toEqual(GUEST_SEAT);
    expect(back.session.run).toBe(2);
  });

  it('ignores a start-over it has played, and one that is older, and plays one that is newer', async () => {
    const { room, guest } = await joined();
    lose(room);
    room.host.restartRun('new');
    await room.settle(300);
    expect(guest.session.run).toBe(2);
    const loads = guest.loads.length;

    const again: RunFrame = {
      t: 'run',
      n: 2,
      seed: 555,
      seq: 0,
      spawn: { x: 1.5, y: 0, z: 1.5 },
      epoch: 7,
    };
    tell(guest, again);
    await room.settle(200);
    expect(guest.loads).toHaveLength(loads);
    expect(guest.session.run).toBe(2);

    tell(guest, { ...again, n: 3 });
    await room.settle(200);
    expect(guest.loads).toHaveLength(loads + 1);
    expect(guest.loads.at(-1)).toEqual({ seed: 555, count: 0 });
    expect(guest.session.run).toBe(3);

    tell(guest, again);
    tell(guest, { ...again, n: 3, seed: 556 });
    await room.settle(200);
    expect(guest.loads).toHaveLength(loads + 1);
    expect(guest.session.run).toBe(3);
  });

  it('is told nothing by a host that has not started anything over', async () => {
    const { room, guest } = await joined();
    await room.settle(500);
    expect(guest.session.run).toBe(1);
    expect(guest.loads).toHaveLength(1);
  });
});
