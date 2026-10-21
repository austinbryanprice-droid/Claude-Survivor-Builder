import { describe, expect, it } from 'vitest';
import { RemoteTrack, createPoseOut } from '../../src/shared/interpolation';
import { NET } from '../../src/shared/net-config';
import { createPlayerSample, type PlayerSample } from '../../src/shared/protocol';

function at(x: number, extra: Partial<PlayerSample> = {}): PlayerSample {
  return { ...createPlayerSample(), x, ...extra };
}

function poseAt(track: RemoteTrack, time: number) {
  const out = createPoseOut();
  const ok = track.sample(time, out);
  return { ok, out };
}

describe('remote track', () => {
  it('has nothing to say until a sample arrives', () => {
    expect(poseAt(new RemoteTrack(), 0).ok).toBe(false);
  });

  it('holds the first sample before it and interpolates between samples', () => {
    const track = new RemoteTrack();
    track.push(1000, at(0, { z: 0 }));
    track.push(1050, at(2, { z: -1 }));
    expect(poseAt(track, 900).out.x).toBe(0);
    const mid = poseAt(track, 1025).out;
    expect(mid.x).toBeCloseTo(1, 9);
    expect(mid.z).toBeCloseTo(-0.5, 9);
    expect(poseAt(track, 1010).out.x).toBeCloseTo(0.4, 9);
  });

  it('turns yaw the short way round', () => {
    const track = new RemoteTrack();
    track.push(0, at(0, { yaw: 3.0 }));
    track.push(100, at(0, { yaw: -3.0 }));
    const yaw = poseAt(track, 50).out.yaw;
    // Halfway between 3.0 and -3.0 the short way is through pi, not through 0.
    expect(Math.abs(Math.abs(yaw) - Math.PI)).toBeLessThan(0.01);
  });

  it('carries the newest sample forward on its velocity, but not for long', () => {
    const track = new RemoteTrack();
    track.push(0, at(0, { vx: 4, onGround: true }));
    expect(poseAt(track, 100).out.x).toBeCloseTo(0.4, 9);
    // After the extrapolation limit the pose stops instead of running away.
    const limit = poseAt(track, NET.extrapolateMs).out.x;
    expect(poseAt(track, NET.extrapolateMs + 5000).out.x).toBeCloseTo(limit, 9);
  });

  it('lets a jumping player rise on their vertical speed and a grounded one keep their height', () => {
    const air = new RemoteTrack();
    air.push(0, at(0, { y: 1, vy: 5, onGround: false }));
    expect(poseAt(air, 100).out.y).toBeCloseTo(1.5, 9);
    const ground = new RemoteTrack();
    ground.push(0, at(0, { y: 1, vy: 5, onGround: true }));
    expect(poseAt(ground, 100).out.y).toBe(1);
  });

  it('reports horizontal speed for the walk cycle', () => {
    const track = new RemoteTrack();
    track.push(0, at(0, { vx: 3, vz: 4 }));
    track.push(50, at(1, { vx: 3, vz: 4 }));
    expect(poseAt(track, 25).out.speed).toBeCloseTo(5, 9);
  });

  it('does not glide across a reset or a big hop', () => {
    const track = new RemoteTrack();
    track.push(0, at(0));
    track.push(50, at(1));
    track.push(100, at(40, { reset: true }));
    track.push(150, at(41));
    // Between the second and third sample the player is held, then appears at the new place.
    expect(poseAt(track, 75).out.x).toBe(1);
    expect(poseAt(track, 100).out.x).toBeCloseTo(40, 9);
    expect(poseAt(track, 125).out.x).toBeCloseTo(40.5, 9);

    const hop = new RemoteTrack();
    hop.push(0, at(0));
    hop.push(50, at(NET.snapDistance + 1));
    expect(poseAt(hop, 25).out.x).toBe(0);
  });

  it('ignores duplicates and keeps samples in time order when they arrive out of order', () => {
    const track = new RemoteTrack();
    expect(track.push(100, at(1))).toBe(true);
    expect(track.push(100, at(9))).toBe(false);
    expect(track.push(200, at(3))).toBe(true);
    expect(track.push(150, at(2))).toBe(true); // late but inside the history
    expect(track.length).toBe(3);
    expect(poseAt(track, 150).out.x).toBeCloseTo(2, 9);
    expect(track.newestTime).toBe(200);
  });

  it('keeps a bounded history and drops samples older than all of it', () => {
    const track = new RemoteTrack();
    for (let i = 0; i < NET.trackLength + 10; i++) track.push(1000 + i * 50, at(i));
    expect(track.length).toBe(NET.trackLength);
    expect(track.push(0, at(-1))).toBe(false);
  });

  it('does not alias the sample it was given', () => {
    const track = new RemoteTrack();
    const s = at(1);
    track.push(0, s);
    s.x = 99;
    expect(poseAt(track, 0).out.x).toBe(1);
  });

  it('draws smooth motion when samples arrive in uneven lumps', () => {
    // A player walking at 4 blocks per second, sampled every 50 ms, arriving with jitter.
    const track = new RemoteTrack();
    const sampleAt = (t: number) => at((t / 1000) * 4, { vx: 4 });
    let previous: number | null = null;
    let worstStep = 0;
    // Samples for t = 0, 50, ... reach us at t + jitter; we draw every 16 ms at (now - 100 ms).
    const arrivals = [];
    for (let k = 0; k < 60; k++) arrivals.push({ sent: k * 50, at: k * 50 + ((k * 37) % 60) });
    arrivals.sort((a, b) => a.at - b.at);
    let next = 0;
    for (let now = 0; now < 3000; now += 16) {
      while (next < arrivals.length && (arrivals[next] as { at: number }).at <= now) {
        const sent = (arrivals[next] as { sent: number }).sent;
        track.push(sent, sampleAt(sent));
        next++;
      }
      const out = createPoseOut();
      if (!track.sample(now - NET.interpDelayMs, out)) continue;
      if (now > 400) {
        if (previous !== null)
          worstStep = Math.max(worstStep, Math.abs(out.x - previous - 4 * 0.016));
        previous = out.x;
      }
    }
    // Perfectly smooth would be 0; with the delay buffer it should stay well under a centimetre.
    expect(worstStep).toBeLessThan(0.01);
  });
});
