import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/shared/hash';
import { MOVEMENT } from '../../src/shared/movement';
import { NET } from '../../src/shared/net-config';
import type { PlayerSample } from '../../src/shared/protocol';
import { encodeFrame, encodeGuestState } from '../../src/shared/wire';
import { at, helloText, makeRoom, rawGuest, type Guest } from './helpers/net';

type Room = ReturnType<typeof makeRoom>;

const FRAME_MS = 16;

/** Runs the room frame by frame, calling `each` with the virtual time before every step. */
async function frames(room: Room, ms: number, each: (now: number) => void): Promise<void> {
  const end = room.scheduler.now() + ms;
  while (room.scheduler.now() < end) {
    each(room.scheduler.now());
    room.scheduler.advance(FRAME_MS);
    await room.flush();
  }
}

/** A player walking along +x at a steady speed, reported every frame. */
function walker(startX: number, z: number, speed: number, startAt: number) {
  const position = (now: number) => startX + (speed * (now - startAt)) / 1000;
  const sample = (now: number): PlayerSample =>
    at(position(now), 0, z, { vx: speed, yaw: 1.2, pitch: -0.2 });
  return { position, sample };
}

function poseOf(
  guest: Pick<Guest, 'session'>,
  id: number,
): { x: number; y: number; z: number; name: string; slot: number } | undefined {
  const pose = guest.session.sampleRemotes().find((p) => p.id === id);
  return pose ? { x: pose.x, y: pose.y, z: pose.z, name: pose.name, slot: pose.slot } : undefined;
}

describe('seeing each other move', () => {
  it('shows a walking guest to the host and to another guest, a little in the past', async () => {
    const room = makeRoom({ latency: 40 });
    const code = await room.openRoom();
    const a = await room.join(code, 'Ada');
    const b = await room.join(code, 'Bo');
    const start = room.scheduler.now();
    const walk = walker(3, 0.5, 5, start);

    const hostErrors: number[] = [];
    const guestErrors: number[] = [];
    await frames(room, 3000, (now) => {
      a.session.publishState(walk.sample(now));
      if (now - start < 1000) return;
      const seenByHost = room.host.sampleRemotes().find((p) => p.id === a.session.localId);
      const seenByGuest = poseOf(b, a.session.localId);
      // The host sees a guest as it was one link plus the display delay ago; a second guest, two links.
      if (seenByHost) {
        hostErrors.push(Math.abs(seenByHost.x - walk.position(now - 40 - NET.interpDelayMs)));
      }
      if (seenByGuest) {
        guestErrors.push(Math.abs(seenByGuest.x - walk.position(now - 80 - NET.interpDelayMs)));
      }
    });
    expect(hostErrors.length).toBeGreaterThan(50);
    expect(guestErrors.length).toBeGreaterThan(50);
    expect(Math.max(...hostErrors)).toBeLessThan(0.15);
    expect(Math.max(...guestErrors)).toBeLessThan(0.15);
  });

  it('carries the view angles, the name and the seat colour along', async () => {
    const room = makeRoom({ latency: 20 });
    const code = await room.openRoom();
    const a = await room.join(code, 'Ada');
    const b = await room.join(code, 'Bo');
    a.session.publishState(at(4.5, 0, 1.5, { yaw: 2, pitch: 0.4, onGround: false }));
    await room.settle(400);
    const seen = poseOf(b, a.session.localId);
    expect(seen).toMatchObject({ name: 'Ada', slot: 1 });
    const pose = b.session.sampleRemotes().find((p) => p.id === a.session.localId);
    expect(pose?.yaw).toBeCloseTo(2, 2);
    expect(pose?.pitch).toBeCloseTo(0.4, 2);
    expect(pose?.onGround).toBe(false);
  });

  it('shows the host to the guests and never shows a player to themselves', async () => {
    const room = makeRoom({ latency: 25 });
    const code = await room.openRoom();
    const a = await room.join(code, 'Ada');
    const walk = walker(0.5, 0.5, 4, room.scheduler.now());
    await frames(room, 1500, (now) => {
      room.host.publishState(walk.sample(now));
      a.session.publishState(at(3.5, 0, 0.5));
    });
    const hostPose = poseOf(a, 1);
    expect(hostPose).toBeDefined();
    const expected = walk.position(room.scheduler.now() - 25 - NET.interpDelayMs);
    expect(Math.abs((hostPose?.x ?? 0) - expected)).toBeLessThan(0.15);
    expect(a.session.sampleRemotes().map((p) => p.id)).toEqual([1]);
    expect(room.host.sampleRemotes().map((p) => p.id)).toEqual([2]);
  });

  it('reuses its pose objects, so drawing other players allocates nothing per frame', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const a = await room.join(code, 'Ada');
    room.host.publishState(at(0.5, 0, 0.5));
    await room.settle(400);
    const first = a.session.sampleRemotes();
    const pose = first[0];
    expect(pose).toBeDefined();
    const second = a.session.sampleRemotes();
    expect(second).toBe(first);
    expect(second[0]).toBe(pose);
  });

  it('shows everyone already in the room to a late joiner within a moment', async () => {
    const room = makeRoom({ latency: 30 });
    const code = await room.openRoom();
    const a = await room.join(code, 'Ada');
    a.session.publishState(at(5.5, 0, 2.5));
    room.host.publishState(at(0.5, 0, 0.5));
    await room.settle(300);
    const late = await room.join(code, 'Late');
    await room.settle(400);
    expect(
      late.session
        .sampleRemotes()
        .map((p) => p.name)
        .sort(),
    ).toEqual(['Ada', 'Host']);
  });

  it('settles on the exact final spot when a player stops', async () => {
    const room = makeRoom({ latency: 40 });
    const code = await room.openRoom();
    const a = await room.join(code, 'Ada');
    const b = await room.join(code, 'Bo');
    const walk = walker(3, 0.5, 5, room.scheduler.now());
    await frames(room, 1000, (now) => a.session.publishState(walk.sample(now)));
    const stopAt = walk.position(room.scheduler.now());
    // Stand still: a few more reports of the same spot, then nothing new.
    await frames(room, 500, () => a.session.publishState(at(stopAt, 0, 0.5, { vx: 0 })));
    await room.settle(1200);
    const seen = poseOf(b, a.session.localId);
    expect(seen?.x).toBeCloseTo(stopAt, 1);
    expect(seen?.z).toBeCloseTo(0.5, 2);
  });

  it('stops showing a player who left', async () => {
    const room = makeRoom({ latency: 20 });
    const code = await room.openRoom();
    const a = await room.join(code, 'Ada');
    const b = await room.join(code, 'Bo');
    a.session.publishState(at(4.5, 0, 1.5));
    await room.settle(300);
    expect(poseOf(b, a.session.localId)).toBeDefined();
    const id = a.session.localId;
    a.session.close();
    await room.settle(300);
    expect(poseOf(b, id)).toBeUndefined();
    expect(room.host.sampleRemotes().map((p) => p.id)).not.toContain(id);
  });
});

describe('a bad network', () => {
  /** Watches a walking guest on another guest's screen and reports how steady the picture is. */
  async function watch(seed: number, lossShare: number, jitterMs: number, ms: number) {
    // Loss and jitter draw from separate streams so one cannot shape the other.
    const lossRandom = createRng(seed);
    const jitterRandom = createRng(seed + 1000);
    const room = makeRoom({
      latency: () => 20 + jitterRandom() * jitterMs,
      stateLoss: lossShare,
      stateReorder: true,
      random: lossRandom,
    });
    const code = await room.openRoom();
    const a = await room.join(code, 'Ada');
    const b = await room.join(code, 'Bo');
    const start = room.scheduler.now();
    const walk = walker(3, 0.5, 5, start);
    let last: number | null = null;
    const result = { frames: 0, minStep: Infinity, maxStep: -Infinity, maxLag: 0, stale: 0 };
    await frames(room, ms, (now) => {
      a.session.publishState(walk.sample(now));
      if (now - start < 2000) return;
      const seen = poseOf(b, a.session.localId);
      if (!seen) return;
      if (last !== null) {
        result.minStep = Math.min(result.minStep, seen.x - last);
        result.maxStep = Math.max(result.maxStep, seen.x - last);
      }
      // How far behind real time the drawn position is, in milliseconds.
      result.maxLag = Math.max(result.maxLag, now - start - ((seen.x - 3) / 5) * 1000);
      last = seen.x;
      result.frames++;
    });
    result.stale = room.host.stats.staleDropped + b.session.stats.staleDropped;
    return result;
  }

  it('draws smooth motion on a decent connection', async () => {
    for (const seed of [21, 22, 23]) {
      const r = await watch(seed, 0.05, 40, 8000);
      expect(r.frames).toBeGreaterThan(300);
      // Nominal step is 5 m/s x 16 ms = 0.08 m.
      expect(r.minStep).toBeGreaterThan(0.06);
      expect(r.maxStep).toBeLessThan(0.1);
      expect(r.maxLag).toBeLessThan(200);
    }
  });

  it('keeps the picture steady through loss, jitter and reordering', async () => {
    let stale = 0;
    for (const seed of [21, 22, 23, 24, 25, 26]) {
      const r = await watch(seed, 0.2, 100, 8000);
      expect(r.frames).toBeGreaterThan(300);
      // Gaps freeze the figure for a moment and catch up after, but never move it backwards or fling it.
      expect(r.minStep).toBeGreaterThan(-0.01);
      expect(r.maxStep).toBeLessThan(1);
      expect(r.maxLag).toBeLessThan(400);
      stale += r.stale;
    }
    // Packets that arrived behind a newer one were noticed and dropped, not applied.
    expect(stale).toBeGreaterThan(0);
  });

  it('never moves a remote player backwards because of an old packet', async () => {
    for (const seed of [11, 12, 13, 14]) {
      const r = await watch(seed, 0, 120, 8000);
      expect(r.minStep).toBeGreaterThan(-0.01);
    }
  });
});

describe('the host checks guests', () => {
  it('lets a guest sprint at top speed for as long as it likes', async () => {
    const room = makeRoom({ latency: 30 });
    const code = await room.openRoom();
    const a = await room.join(code, 'Ada');
    const fixes: unknown[] = [];
    a.session.onCorrection((c) => fixes.push(c));
    const walk = walker(2.5, 0.5, MOVEMENT.sprintSpeed, room.scheduler.now());
    await frames(room, 8000, (now) => a.session.publishState(walk.sample(now)));
    expect(fixes).toEqual([]);
    expect(room.host.stats.corrections).toBe(0);
  });

  it('puts a guest back when it moves much faster than the controller can', async () => {
    const room = makeRoom({ latency: 30 });
    const code = await room.openRoom();
    const a = await room.join(code, 'Ada');
    const b = await room.join(code, 'Bo');
    const fixes: { x: number; y: number; z: number }[] = [];
    a.session.onCorrection((c) => fixes.push(c));
    const seconds = 4;
    const walk = walker(2.5, 0.5, 30, room.scheduler.now());
    await frames(room, seconds * 1000, (now) => a.session.publishState(walk.sample(now)));
    expect(room.host.stats.corrections).toBeGreaterThan(0);
    expect(fixes.length).toBeGreaterThan(0);
    expect(a.session.stats.corrections).toBe(fixes.length);
    // The host never believed more than the allowance: a full bank plus top speed for the time that passed.
    const allowance =
      MOVEMENT.sprintSpeed * NET.move.speedSlack * (NET.move.burstSeconds + seconds + 0.2);
    const seen = room.host.sampleRemotes().find((p) => p.id === a.session.localId);
    const seenByB = poseOf(b, a.session.localId);
    expect((seen?.x ?? 0) - 2.5).toBeLessThan(allowance);
    expect((seenByB?.x ?? 0) - 2.5).toBeLessThan(allowance);
    expect(walk.position(room.scheduler.now())).toBeGreaterThan(2.5 + 2 * allowance);
  });

  it('moves a guest that claims to be far away back to its last good spot, once', async () => {
    const room = makeRoom({ latency: 100 });
    const code = await room.openRoom();
    const a = await room.join(code, 'Ada');
    const b = await room.join(code, 'Bo');
    const fixes: { x: number; y: number; z: number }[] = [];
    a.session.onCorrection((c) => fixes.push(c));

    a.session.publishState(at(60.5, 0, 0.5)); // not a walk anyone can make
    await room.settle(60);
    // Reports sent while the fix is still on its way carry the old epoch and are thrown away.
    a.session.publishState(at(60.5, 0, 0.5));
    await room.settle(60);
    a.session.publishState(at(60.5, 0, 0.5));
    await room.settle(400);
    expect(fixes).toEqual([{ x: 2.5, y: 0, z: 0.5 }]);
    expect(room.host.stats.corrections).toBe(1);

    // After the fix, honest reports are taken again.
    a.session.publishState(at(3.5, 0, 1.5));
    await room.settle(600);
    const seen = poseOf(b, a.session.localId);
    expect(seen?.x).toBeCloseTo(3.5, 1);
    expect(seen?.z).toBeCloseTo(1.5, 1);
  });

  it('believes a respawn only after a fall out of the world', async () => {
    const room = makeRoom({ latency: 20 });
    const code = await room.openRoom();
    const a = await room.join(code, 'Ada');
    const fixes: unknown[] = [];
    a.session.onCorrection((c) => fixes.push(c));

    // A respawn from solid ground is a teleport in disguise.
    a.session.publishState(at(40.5, 0, 0.5, { reset: true }));
    await room.settle(200);
    expect(fixes).toHaveLength(1);

    // Fall off the world (a legal descent), then respawn at the spawn point.
    let y = 0;
    await frames(room, 1500, () => {
      y = Math.max(-30, y - 0.9);
      a.session.publishState(at(2.5, y, 0.5, { vy: -55, onGround: false }));
    });
    expect(y).toBeLessThan(-20);
    a.session.publishState(at(2.5, 0, 0.5, { reset: true }));
    await room.settle(200);
    expect(fixes).toHaveLength(1);
    expect(room.host.stats.corrections).toBe(1);
    const seen = room.host.sampleRemotes().find((p) => p.id === a.session.localId);
    expect(seen?.y ?? -99).toBeGreaterThan(-1);
  });

  it('counts state packets that arrive behind a newer one, across the 16-bit wrap', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    const welcome = raw.frames.find((f) => f.t === 'welcome');
    expect(welcome).toBeDefined();
    const epoch = welcome && welcome.t === 'welcome' ? welcome.epoch : 0;
    const send = (seq: number, x: number) =>
      raw.link.sendState(
        encodeGuestState({ epoch, seq, time: room.scheduler.now(), sample: at(x, 0, 0.5) }),
      );

    for (const [seq, x] of [
      [65534, 2.5],
      [65535, 2.6],
      [0, 2.7], // newer, because the counter wrapped
      [65535, 2.6], // older again
      [1, 2.8],
    ] as const) {
      send(seq, x);
      await room.settle(60);
    }
    await room.settle(200);
    expect(room.host.stats.staleDropped).toBe(1);
    const a = room.host.sampleRemotes().find((p) => p.id === 2);
    expect(a?.x).toBeCloseTo(2.8, 1);
  });

  it('ignores a state packet that names an old epoch', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    raw.link.sendState(
      encodeGuestState({ epoch: 9, seq: 1, time: room.scheduler.now(), sample: at(2.5, 0, 0.5) }),
    );
    await room.settle(100);
    expect(room.host.sampleRemotes()).toEqual([]);
    expect(room.host.stats.badFrames).toBe(0);
  });

  it('keeps a hostile frame from a seated guest from changing anyone else', async () => {
    const room = makeRoom();
    const code = await room.openRoom();
    const raw = await rawGuest(room, code);
    raw.link.sendControl(helloText());
    await room.settle(100);
    raw.link.sendControl(
      encodeFrame({ t: 'hello', v: 1, build: 'x', token: 'y'.repeat(20), name: 'Evil' }),
    );
    raw.link.sendControl('{"t":"pong","n":1}');
    raw.link.sendControl('{"t":"fix","epoch":1,"x":0,"y":0,"z":0}');
    await room.settle(100);
    expect(room.host.players).toHaveLength(2);
  });
});
