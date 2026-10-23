import { describe, expect, it } from 'vitest';
import { CYCLE_SECONDS } from '../../src/shared/daycycle';
import { angleDelta } from '../../src/shared/look';
import { nightStart, type SurvivalEvent, type SurvivalView } from '../../src/shared/survival-state';
import { WAVES } from '../../src/systems/survival/balance';
import { arena, play, sim } from './helpers/arena';

function listen(view: SurvivalView): SurvivalEvent[] {
  const seen: SurvivalEvent[] = [];
  view.onEvent((event) => seen.push(event));
  return seen;
}

const wavesIn = (seen: readonly SurvivalEvent[]) => seen.filter((event) => event.k === 'wave');

/** A run whose nights send their waves, opened a little before the night it is told to start at. */
const dusk = (night: number) => ({ waves: true, startAt: nightStart(night) - 30 });

describe('the waves in a room', () => {
  it("tell the host's screen and every guest's of each wave, once, ten seconds before it comes", async () => {
    const { room } = arena({}, dusk(2));
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const ada = await room.join(code, 'Ada');
    const bo = await room.join(code, 'Bo');
    const heard = [room.host.survival, ada.session.survival, bo.session.survival].map(listen);

    // Night 2 sends two waves of four: the first is told four seconds in, the second seventy later.
    await play(room, nightStart(2) + 3 - sim(room).elapsed);
    for (const seen of heard) expect(wavesIn(seen)).toEqual([]);
    await play(room, 2);
    for (const seen of heard)
      expect(wavesIn(seen)).toEqual([{ k: 'wave', n: 2, i: 1, of: 2, c: 4 }]);
    await play(room, 70);
    for (const seen of heard) {
      expect(wavesIn(seen)).toEqual([
        { k: 'wave', n: 2, i: 1, of: 2, c: 4 },
        { k: 'wave', n: 2, i: 2, of: 2, c: 4 },
      ]);
    }
  });

  it('bring the machines out on every screen, a wave from one side of the ring', async () => {
    const { room, core } = arena({}, dusk(2));
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const guest = await room.join(code, 'Ada');
    // The wave comes at fourteen seconds, a machine every 0.4 s, and has walked a little by seventeen.
    await play(room, nightStart(2) + 17 - sim(room).elapsed);

    const around = (pose: { x: number; z: number }) => Math.atan2(pose.z - core.z, pose.x - core.x);
    for (const poses of [room.host.sampleEnemies(), guest.session.sampleEnemies()]) {
      expect(poses).toHaveLength(4);
      for (const pose of poses) {
        expect(Math.abs(angleDelta(around(pose), around(poses[0]!)))).toBeLessThan(2 * WAVES.arc);
      }
    }
    const host = room.host.sampleEnemies().map((pose) => pose.id);
    expect(
      guest.session
        .sampleEnemies()
        .map((pose) => pose.id)
        .sort(),
    ).toEqual(host.sort());
  });

  it('let the machines still standing at dawn fall back, and every screen sees them go', async () => {
    const { room, machines } = arena({}, { waves: true, startAt: CYCLE_SECONDS - 25 });
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const guest = await room.join(code, 'Ada');
    const left = CYCLE_SECONDS - sim(room).elapsed;
    expect(left).toBeGreaterThan(8);

    machines().spawn(4);
    await play(room, 3);
    expect(room.host.sampleEnemies()).toHaveLength(4);
    expect(guest.session.sampleEnemies()).toHaveLength(4);

    await play(room, left - 3 + 2);
    expect(room.host.sampleEnemies()).toEqual([]);
    expect(guest.session.sampleEnemies()).toEqual([]);
    expect(sim(room).over).toBe(false);
  });

  it('send nothing with waves: false, and the clock still runs', async () => {
    const { room } = arena({}, { waves: false, startAt: nightStart(2) - 30 });
    room.host.setLocalActive(true);
    const code = await room.openRoom();
    const guest = await room.join(code, 'Ada');
    const heard = listen(guest.session.survival);
    await play(room, 60);
    expect(wavesIn(heard)).toEqual([]);
    expect(room.host.sampleEnemies()).toEqual([]);
    expect(heard.some((event) => event.k === 'nightfall')).toBe(true);
  });
});
