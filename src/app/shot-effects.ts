import { FX_COLOR, type ShotFx } from '../engine/shot-fx';
import type { GameSession } from '../net/session';
import type { Vec3 } from '../shared/look';
import { PLAYER } from '../shared/movement';
import { colorForSlot } from '../shared/player-colors';
import { createPlayerSample, type PlayerId } from '../shared/protocol';
import type { RayWorld } from '../shared/raycast';
import { SHOT_FLAG, createShotTrace, muzzleOf, traceShot, type ShotEvent } from '../shared/shot';
import { BLASTER, hitboxOf } from '../systems/survival/balance';
import type { LocalPlayer } from './player-sync';

/**
 * Decides what the pulse blaster's shots look like on this screen. The player's own shot is drawn
 * the moment they click, from what their screen shows (the machines where they are drawn, the
 * blocks and ground of their world), so the gun answers at once whatever the network is doing; the
 * host's word on it arrives later and adds only what the click could not know, that a machine fell.
 * Everyone else's shots are drawn when the host reports them: from the shooter's gun, as it is drawn
 * on this screen, to the place the host says the bolt ended.
 */

/** The part of a session that the effects use. */
export type ShotSession = Pick<
  GameSession,
  'localId' | 'players' | 'sampleRemotes' | 'sampleEnemies'
>;

export interface ShotEffectsOptions {
  fx: ShotFx;
  session: ShotSession;
  /** What stops a bolt in the world being played now (its blocks, ground and Core), or null where there is none. */
  rayWorld(): RayWorld | null;
  /** The local player, whose gun is held where they stand and look. */
  player: Pick<LocalPlayer, 'read'>;
}

/** One shot as it was drawn, for the browser tests and a curious console. */
export interface ShotLogEntry {
  readonly by: PlayerId;
  /** `SHOT_FLAG` bits: what the bolt struck, as this screen drew it (a click) or as the host said (a report). */
  readonly flags: number;
  /** Where the bolt ended. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** True for the player's own click, drawn before the host had answered. */
  readonly predicted: boolean;
}

export interface ShotEffects {
  /**
   * The local player fired from the camera at `origin` along the unit vector `dir`: draw the bolt now.
   * Call it before the shot goes to the session: a host hears its own shot before `fire` returns, and
   * the burst of a kill waits for the bolt that this draws.
   */
  predict(origin: Vec3, dir: Vec3): void;
  /** The host decided a shot, anyone's, the local player's included. */
  hear(shot: ShotEvent): void;
  /** Lets `dt` seconds pass for the light. */
  update(dt: number): void;
  /** The latest shots drawn, newest last, and the light playing now. */
  debug(): { shots: ShotLogEntry[]; live: ReturnType<ShotFx['live']> };
}

const REMEMBERED_SHOTS = 24;

/** The way a bolt is taken to leave when nothing says: down, so that its sparks leap up. */
const DOWN: Vec3 = { x: 0, y: -1, z: 0 };

/** The longest the host's word on a kill waits for the bolt to land: more than any flight takes (the gun's range, at the speed of its light), so only a stale landing is cut short. */
const LONGEST_WAIT = 0.5;

export function createShotEffects({
  fx,
  session,
  rayWorld,
  player,
}: ShotEffectsOptions): ShotEffects {
  const sample = createPlayerSample();
  const gun: Vec3 = { x: 0, y: 0, z: 0 };
  const mark: Vec3 = { x: 0, y: 0, z: 0 };
  const way: Vec3 = { x: 0, y: 0, z: 0 };
  const trace = createShotTrace();
  const shots: ShotLogEntry[] = [];
  /** The light's own clock, in seconds, so that the host's word can wait for a bolt that is still on its way. */
  let now = 0;
  /** When the player's latest bolt lands, on that clock. */
  let landing = 0;

  const aimAlong = (v: Vec3): void => {
    way.x = v.x;
    way.y = v.y;
    way.z = v.z;
  };

  const colorOf = (id: PlayerId): string =>
    colorForSlot(session.players.find((entry) => entry.id === id)?.slot ?? 0).hex;

  /** Puts the muzzle of a player's gun into `gun`, where it is drawn on this screen; false where they are not to be found. */
  const takeGun = (id: PlayerId): boolean => {
    if (id === session.localId) {
      if (!player.read(sample)) return false;
      muzzleOf(sample.x, sample.y + PLAYER.eyeHeight, sample.z, sample.yaw, sample.pitch, gun);
      return true;
    }
    for (const pose of session.sampleRemotes()) {
      if (pose.id !== id) continue;
      muzzleOf(pose.x, pose.y + PLAYER.eyeHeight, pose.z, pose.yaw, pose.pitch, gun);
      return true;
    }
    return false;
  };

  /** Draws a bolt from the gun of `by` to `mark`, and what it does there once it lands. Returns the seconds it takes to. */
  const fly = (by: PlayerId, flags: number, aim: Vec3 | null): number => {
    const color = colorOf(by);
    let arrives = 0;
    if (takeGun(by)) {
      const length = Math.hypot(mark.x - gun.x, mark.y - gun.y, mark.z - gun.z);
      if (length > 0.01) {
        way.x = (mark.x - gun.x) / length;
        way.y = (mark.y - gun.y) / length;
        way.z = (mark.z - gun.z) / length;
      } else {
        aimAlong(aim ?? DOWN);
      }
      fx.muzzle(gun, way, color);
      arrives = fx.bolt(gun, mark, color);
    } else {
      aimAlong(aim ?? DOWN);
    }
    if (flags & SHOT_FLAG.enemy) fx.impact(mark, way, FX_COLOR.hit, arrives);
    else if (flags & SHOT_FLAG.world) fx.impact(mark, way, color, arrives);
    return arrives;
  };

  const remember = (by: PlayerId, flags: number, predicted: boolean): void => {
    shots.push({ by, flags, x: mark.x, y: mark.y, z: mark.z, predicted });
    if (shots.length > REMEMBERED_SHOTS) shots.shift();
  };

  return {
    predict(origin, dir) {
      const bodies = session.sampleEnemies();
      traceShot(
        rayWorld(),
        origin,
        dir,
        BLASTER.range,
        bodies,
        bodies.length,
        hitboxOf,
        null,
        trace,
      );
      mark.x = origin.x + dir.x * trace.distance;
      mark.y = origin.y + dir.y * trace.distance;
      mark.z = origin.z + dir.z * trace.distance;
      landing = now + fly(session.localId, trace.flags, dir);
      remember(session.localId, trace.flags, true);
    },

    hear(shot) {
      mark.x = shot.x;
      mark.y = shot.y;
      mark.z = shot.z;
      if (shot.by === session.localId) {
        // The click drew this bolt already. What the host adds is the end of a machine, which falls
        // when the bolt that felled it lands: on a fast link the word can come back before that.
        if (shot.flags & SHOT_FLAG.kill)
          fx.burst(mark, Math.min(Math.max(0, landing - now), LONGEST_WAIT));
      } else {
        const arrives = fly(shot.by, shot.flags, null);
        if (shot.flags & SHOT_FLAG.kill) fx.burst(mark, arrives);
      }
      remember(shot.by, shot.flags, false);
    },

    update(dt) {
      now += Math.max(0, dt);
      fx.update(dt);
    },

    debug() {
      return { shots: [...shots], live: fx.live() };
    },
  };
}
