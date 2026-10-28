import { FX_COLOR, type ShotFx } from '../engine/shot-fx';
import { Emitter } from '../net/emitter';
import type { GameSession, Unsubscribe } from '../net/session';
import type { Vec3 } from '../shared/look';
import { PLAYER } from '../shared/movement';
import { colorForSlot } from '../shared/player-colors';
import { createPlayerSample, type PlayerId } from '../shared/protocol';
import type { RayWorld } from '../shared/raycast';
import { SHOT_FLAG, createShotTrace, muzzleOf, traceShot, type ShotEvent } from '../shared/shot';
import { turretMuzzle } from '../shared/turret';
import { BLASTER, hitboxOf } from '../systems/survival/balance';
import { turretLevel } from '../systems/survival/turrets';
import { wildHitboxOf } from '../systems/wildlife/balance';
import type { LocalPlayer } from './player-sync';

/**
 * Decides what the pulse blaster's shots look like on this screen. The player's own shot is drawn
 * the moment they click, from what their screen shows (the machines and creatures where they are
 * drawn, the blocks and ground of their world), so the gun answers at once whatever the network is
 * doing; the host's word on it arrives later and adds only what the click could not know, that a
 * machine or a creature fell.
 * Everyone else's shots are drawn when the host reports them: from the shooter's gun, as it is drawn
 * on this screen, to the place the host says the bolt ended.
 */

/** The part of a session that the effects use. */
export type ShotSession = Pick<
  GameSession,
  'localId' | 'players' | 'sampleRemotes' | 'sampleEnemies' | 'sampleWildlife'
>;

export interface ShotEffectsOptions {
  fx: ShotFx;
  session: ShotSession;
  /** What stops a bolt in the world being played now (its blocks, ground and Core), or null where there is none. */
  rayWorld(): RayWorld | null;
  /** The local player, whose gun is held where they stand and look. */
  player: Pick<LocalPlayer, 'read'>;
  /** A turret in cell (x, y, z) fired at (tx, ty, tz): the head of the model that stands there turns to it. */
  aimTurret?(x: number, y: number, z: number, tx: number, ty: number, tz: number): void;
  /** The level of the turret standing in cell (x, y, z) on this screen (its cell's material byte), or 1 where none is known: a heavier gun draws a heavier bolt. */
  levelOfTurret?(x: number, y: number, z: number): number;
}

/** One shot as it was drawn, for the browser tests and a curious console. */
export interface ShotLogEntry {
  /** The player who fired, or `NO_PLAYER` for a turret's shot. */
  readonly by: PlayerId;
  /** `SHOT_FLAG` bits: what the bolt struck, as this screen drew it (a click) or as the host said (a report). */
  readonly flags: number;
  /** Where the bolt ended. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** True for the player's own click, drawn before the host had answered. */
  readonly predicted: boolean;
  /** The cell of the turret that fired it, for a turret's shot. */
  readonly turret?: readonly [x: number, y: number, z: number];
  /** How heavy the bolt was drawn, for a turret's shot: the weight of the gun of the level this screen has in that cell. */
  readonly heft?: number;
  /** The muzzle the bolt was drawn from. Null where the shooter's gun could not be found, and for the host's word on the player's own click, which draws nothing. */
  readonly from: Vec3 | null;
  /** Seconds the bolt takes to land, as drawn; 0 where nothing was drawn. */
  readonly arrives: number;
  /** The machine it struck, as this screen saw it (a click) or as the host said, or 0. */
  readonly enemy: number;
}

/** A machine's end as it was drawn: where, how long from now (the bolt that fells it may still be on its way) and which machine. */
export interface FelledEntry {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly after: number;
  readonly enemy: number;
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
  /**
   * Calls `listener` with each bolt as it is drawn, for the sound of it: the local player's click when
   * it is drawn, everyone else's and the turrets' when the host reports them, and not the host's word
   * on the click, which draws nothing.
   */
  onDrawn(listener: (shot: ShotLogEntry) => void): Unsubscribe;
  /** Calls `listener` with each machine's end as it is drawn. */
  onFelled(listener: (felled: FelledEntry) => void): Unsubscribe;
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
  aimTurret,
  levelOfTurret,
}: ShotEffectsOptions): ShotEffects {
  const sample = createPlayerSample();
  const gun: Vec3 = { x: 0, y: 0, z: 0 };
  const mark: Vec3 = { x: 0, y: 0, z: 0 };
  const way: Vec3 = { x: 0, y: 0, z: 0 };
  const trace = createShotTrace();
  const creatureTrace = createShotTrace();
  const shots: ShotLogEntry[] = [];
  const drawn = new Emitter<ShotLogEntry>();
  const felled = new Emitter<FelledEntry>();
  /** Whether the last bolt was drawn from a gun that was found, and how long it takes to land: what the log records of it. */
  let armedLast = false;
  let arrivesLast = 0;
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

  /**
   * Draws a bolt in `color` from the gun in `gun` (where `armed`) to `mark`, and what it does there
   * once it lands. Returns the seconds it takes to.
   */
  const draw = (
    color: string,
    flags: number,
    aim: Vec3 | null,
    armed: boolean,
    heft = 1,
  ): number => {
    let arrives = 0;
    if (armed) {
      const length = Math.hypot(mark.x - gun.x, mark.y - gun.y, mark.z - gun.z);
      if (length > 0.01) {
        way.x = (mark.x - gun.x) / length;
        way.y = (mark.y - gun.y) / length;
        way.z = (mark.z - gun.z) / length;
      } else {
        aimAlong(aim ?? DOWN);
      }
      fx.muzzle(gun, way, color, heft);
      arrives = fx.bolt(gun, mark, color, heft);
    } else {
      aimAlong(aim ?? DOWN);
    }
    if (flags & SHOT_FLAG.enemy) fx.impact(mark, way, FX_COLOR.hit, arrives);
    else if (flags & SHOT_FLAG.wild) fx.impact(mark, way, FX_COLOR.wild, arrives);
    else if (flags & SHOT_FLAG.world) fx.impact(mark, way, color, arrives);
    armedLast = armed;
    arrivesLast = arrives;
    return arrives;
  };

  /** Draws a bolt from the gun of `by` to `mark`. Returns the seconds it takes to. */
  const fly = (by: PlayerId, flags: number, aim: Vec3 | null): number =>
    draw(colorOf(by), flags, aim, takeGun(by));

  /** How heavy the gun of the turret in `cell` draws its bolt: its level's heft (`TURRET`), by the level this screen sees there, or the first level's where none is known. */
  const heftOf = (cell: readonly [number, number, number]): number =>
    turretLevel(levelOfTurret?.(cell[0], cell[1], cell[2]) ?? 1).heft;

  /**
   * Draws a turret's bolt to `mark`, from the muzzle of the turret in `cell`: where every screen
   * works it out from the cell and the end of the bolt, so the bolt leaves the barrel the head is
   * turned along, and as heavy as the gun of its level. Returns the seconds it takes to.
   */
  const flyFromTurret = (
    cell: readonly [number, number, number],
    flags: number,
    heft: number,
  ): number => {
    turretMuzzle(cell[0], cell[1], cell[2], mark.x, mark.y, mark.z, gun);
    aimTurret?.(cell[0], cell[1], cell[2], mark.x, mark.y, mark.z);
    return draw(FX_COLOR.turret, flags, null, true, heft);
  };

  /**
   * A machine falls apart in a burst of fire at the mark, `after` seconds from now, and its end is told
   * to the listeners of `onFelled`; a creature falls in a puff of dust, which they are not told of.
   */
  const falls = (flags: number, after: number, enemy: number): void => {
    if (flags & SHOT_FLAG.wild) {
      fx.puff(mark, after);
      return;
    }
    fx.burst(mark, after);
    felled.emit({ x: mark.x, y: mark.y, z: mark.z, after, enemy });
  };

  /**
   * Writes a shot into the log and returns the entry. `enemy` is the machine it struck (or, with
   * `SHOT_FLAG.wild`, the creature), or 0, and `drawnNow` whether a bolt was drawn for it just now
   * (the host's word on the player's own click draws none, since the click drew its bolt already).
   */
  const remember = (
    by: PlayerId,
    flags: number,
    predicted: boolean,
    enemy: number,
    drawnNow: boolean,
    turret?: { readonly cell: readonly [number, number, number]; readonly heft: number },
  ): ShotLogEntry => {
    const entry: ShotLogEntry = {
      by,
      flags,
      x: mark.x,
      y: mark.y,
      z: mark.z,
      predicted,
      ...(turret ? { turret: turret.cell, heft: turret.heft } : {}),
      from: drawnNow && armedLast ? { x: gun.x, y: gun.y, z: gun.z } : null,
      arrives: drawnNow ? arrivesLast : 0,
      enemy,
    };
    shots.push(entry);
    if (shots.length > REMEMBERED_SHOTS) shots.shift();
    return entry;
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
      let flags = trace.flags;
      let distance = trace.distance;
      let struck = flags & SHOT_FLAG.enemy ? (bodies[trace.index]?.id ?? 0) : 0;
      // A creature nearer than whatever the bolt would have stopped at takes it, as the host will judge.
      const creatures = session.sampleWildlife();
      if (creatures.length > 0) {
        traceShot(
          null,
          origin,
          dir,
          distance,
          creatures,
          creatures.length,
          wildHitboxOf,
          null,
          creatureTrace,
        );
        if (creatureTrace.flags & SHOT_FLAG.enemy) {
          flags = SHOT_FLAG.wild;
          distance = creatureTrace.distance;
          struck = creatures[creatureTrace.index]?.id ?? 0;
        }
      }
      mark.x = origin.x + dir.x * distance;
      mark.y = origin.y + dir.y * distance;
      mark.z = origin.z + dir.z * distance;
      landing = now + fly(session.localId, flags, dir);
      drawn.emit(remember(session.localId, flags, true, struck, true));
    },

    hear(shot) {
      mark.x = shot.x;
      mark.y = shot.y;
      mark.z = shot.z;
      if (shot.turret) {
        const heft = heftOf(shot.turret);
        const arrives = flyFromTurret(shot.turret, shot.flags, heft);
        drawn.emit(
          remember(shot.by, shot.flags, false, shot.enemy, true, { cell: shot.turret, heft }),
        );
        if (shot.flags & SHOT_FLAG.kill) falls(shot.flags, arrives, shot.enemy);
        return;
      }
      if (shot.by === session.localId) {
        // The click drew this bolt already. What the host adds is the end of a machine or a creature,
        // which falls when the bolt that felled it lands: on a fast link the word can come back before that.
        if (shot.flags & SHOT_FLAG.kill)
          falls(shot.flags, Math.min(Math.max(0, landing - now), LONGEST_WAIT), shot.enemy);
        remember(shot.by, shot.flags, false, shot.enemy, false);
      } else {
        const arrives = fly(shot.by, shot.flags, null);
        drawn.emit(remember(shot.by, shot.flags, false, shot.enemy, true));
        if (shot.flags & SHOT_FLAG.kill) falls(shot.flags, arrives, shot.enemy);
      }
    },

    update(dt) {
      now += Math.max(0, dt);
      fx.update(dt);
    },

    onDrawn: (listener) => drawn.on(listener),
    onFelled: (listener) => felled.on(listener),

    debug() {
      return { shots: [...shots], live: fx.live() };
    },
  };
}
