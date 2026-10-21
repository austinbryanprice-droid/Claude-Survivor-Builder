import { describe, expect, it } from 'vitest';
import { MoveGuard } from '../../src/shared/move-guard';
import { MOVEMENT, jumpSpeed } from '../../src/shared/movement';
import { NET } from '../../src/shared/net-config';
import { createPlayerSample, type PlayerSample } from '../../src/shared/protocol';
import { SparseCells } from '../../src/shared/solid';

function at(x: number, y: number, z: number, extra: Partial<PlayerSample> = {}): PlayerSample {
  return { ...createPlayerSample(), x, y, z, ...extra };
}

describe('move guard', () => {
  it('passes honest sprinting', () => {
    const guard = new MoveGuard();
    guard.place(0, 0, 0, 0);
    let x = 0;
    for (let t = 50; t <= 10_000; t += 50) {
      x += MOVEMENT.sprintSpeed * 0.05;
      expect(guard.check(at(x, 0, 0), t, null).ok).toBe(true);
    }
    expect(guard.position.x).toBeCloseTo(x, 9);
  });

  it('passes a burst of delayed packets that adds up to honest movement', () => {
    const guard = new MoveGuard();
    guard.place(0, 0, 0, 0);
    // One second of silence at full sprint, then 20 packets at once.
    let x = 0;
    for (let i = 0; i < 20; i++) {
      x += MOVEMENT.sprintSpeed * 0.05;
      expect(guard.check(at(x, 0, 0), 1000, null).ok).toBe(true);
    }
  });

  it('refuses a teleport', () => {
    const guard = new MoveGuard();
    guard.place(0, 0, 0, 0);
    const verdict = guard.check(at(50, 0, 0), 50, null);
    expect(verdict).toEqual({ ok: false, reason: 'speed' });
    expect(guard.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('refuses a speed hack that outruns the bank', () => {
    const guard = new MoveGuard();
    guard.place(0, 0, 0, 0);
    let refused = 0;
    let x = 0;
    // Three times top speed.
    for (let t = 50; t <= 5000; t += 50) {
      x += MOVEMENT.sprintSpeed * 3 * 0.05;
      if (!guard.check(at(x, 0, 0), t, null).ok) {
        refused++;
        x = guard.position.x;
      }
    }
    expect(refused).toBeGreaterThan(10);
  });

  it('does not hand out a fresh allowance when a guest is put back', () => {
    const guard = new MoveGuard();
    guard.place(0, 0, 0, 0);
    const bank = MOVEMENT.sprintSpeed * NET.move.speedSlack * NET.move.burstSeconds;
    // Spend the whole bank in one leap, then ask again straight after being put back.
    expect(guard.check(at(bank - 0.5, 0, 0), 0, null).ok).toBe(true);
    expect(guard.check(at(2 * bank - 1, 0, 0), 50, null).ok).toBe(false);
    guard.restore(50);
    expect(guard.position.x).toBeCloseTo(bank - 0.5, 9);
    expect(guard.check(at(guard.position.x + bank - 1, 0, 0), 100, null).ok).toBe(false);
  });

  it('holds a cheater that obeys every correction and keeps speeding to the allowance', () => {
    const guard = new MoveGuard();
    guard.place(0, 0, 0, 0);
    const cheat = 30;
    const seconds = 20;
    let last = 0;
    for (let t = 50; t <= seconds * 1000; t += 50) {
      const claimed = guard.position.x + (cheat * (t - last)) / 1000;
      if (!guard.check(at(claimed, 0, 0), t, null).ok) guard.restore(t);
      last = t;
    }
    const allowance =
      MOVEMENT.sprintSpeed * NET.move.speedSlack * (NET.move.burstSeconds + seconds);
    expect(guard.position.x).toBeLessThanOrEqual(allowance + 0.5);
    // Roughly the allowance: the guard is not stricter than it says.
    expect(guard.position.x).toBeGreaterThan(allowance * 0.7);
  });

  it('refuses climbing faster than a jump and allows a jump', () => {
    const guard = new MoveGuard();
    guard.place(0, 0, 0, 0);
    // The bank holds a second and a half of climbing, so a rise of 30 blocks at once is far beyond it.
    expect(guard.check(at(0, 30, 0), 50, null)).toEqual({ ok: false, reason: 'climb' });
    // A jump: up at launch speed for a few packets.
    let y = 0;
    for (let t = 50; t <= 350; t += 50) {
      y += jumpSpeed() * 0.05;
      expect(guard.check(at(0, y, 0), t, null).ok).toBe(true);
    }
  });

  it('allows falling at terminal speed but not faster', () => {
    const guard = new MoveGuard();
    guard.place(0, 100, 0, 0);
    let y = 100;
    for (let t = 50; t <= 1000; t += 50) {
      y -= MOVEMENT.maxFallSpeed * 0.05;
      expect(guard.check(at(0, y, 0), t, null).ok).toBe(true);
    }
    expect(guard.check(at(0, y - 400, 0), 1050, null)).toEqual({ ok: false, reason: 'fall' });
  });

  it('believes the respawn after falling out of the world, once', () => {
    const guard = new MoveGuard();
    guard.place(10, -25, 10, 0);
    expect(guard.check(at(0.5, 0, 0.5, { reset: true }), 50, null).ok).toBe(true);
    expect(guard.position).toEqual({ x: 0.5, y: 0, z: 0.5 });
    // The same flag from a player standing on the ground is just a teleport.
    expect(guard.check(at(30, 0, 0.5, { reset: true }), 100, null)).toEqual({
      ok: false,
      reason: 'speed',
    });
  });

  it('believes the respawn from where the game really puts it, a little under the world and a little above', () => {
    // The game returns a player to the start once they fall below -10; the last report the host
    // took can be several blocks above that.
    for (const y of [-10.4, -7.5, -2]) {
      const guard = new MoveGuard();
      guard.place(10, y, 10, 0);
      expect(guard.check(at(60.5, 3, 0.5, { reset: true }), 50, null).ok, `from y=${y}`).toBe(true);
    }
    // Anywhere with ground under it, the same flag is a teleport.
    for (const y of [0, 2.9, 12]) {
      const guard = new MoveGuard();
      guard.place(10, y, 10, 0);
      expect(guard.check(at(60.5, 3, 0.5, { reset: true }), 50, null).ok, `from y=${y}`).toBe(
        false,
      );
    }
  });

  it('moves a player back who stays inside a wall, but not one who clips a corner for a moment', () => {
    const world = new SparseCells();
    world.fillBox(5, 0, -2, 5, 3, 2);
    const guard = new MoveGuard();
    guard.place(4, 0, 0, 0);

    // Walking into the wall and out again quickly is fine (a block landed on the player).
    expect(guard.check(at(5.5, 0, 0), 100, world).ok).toBe(true);
    expect(guard.check(at(6.5, 0, 0), 200, world).ok).toBe(true);
    expect(guard.position.x).toBeCloseTo(6.5, 9);

    // Standing in it for good is refused, and the safe spot is where they were before.
    guard.place(4.5, 0, 0, 1000);
    let verdict = guard.check(at(5.5, 0, 0), 1050, world);
    expect(verdict.ok).toBe(true);
    const buried = (t: number) => guard.check(at(5.5, 0, 0), t, world);
    for (let t = 1100; t < 1000 + NET.move.insideSolidMs; t += 50) expect(buried(t).ok).toBe(true);
    verdict = buried(1000 + NET.move.insideSolidMs + 100);
    expect(verdict).toEqual({ ok: false, reason: 'inside-solid' });
    expect(guard.position.x).toBeCloseTo(4.5, 9);
  });

  it('starts fresh after place()', () => {
    const guard = new MoveGuard();
    guard.place(0, 0, 0, 0);
    guard.check(at(5, 0, 0), 50, null);
    guard.place(100, 0, 0, 100);
    expect(guard.check(at(100.3, 0, 0), 150, null).ok).toBe(true);
  });
});
