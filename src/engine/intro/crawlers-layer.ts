import { Group } from 'three';
import { createEnemyPose, type EnemyPose } from '../../shared/enemy-state';
import { CRAWLER_RISES } from '../../shared/intro';
import { placeInFrame, type Point3 } from '../../shared/intro-camera';
import { createEnemyRenderer } from '../enemy-render';
import { createGlow, type Glow } from './glow';
import type { IntroContext, IntroLayer } from './layer';

/**
 * The machines of the wreck, waking: the game's own crawlers rise out of the debris round the
 * crater in the dark, one after another, and start toward the Core. They are the real thing, drawn
 * by the real renderer at scripted poses, so the film shows exactly what the first night will bring;
 * each gets a small red glint on top so that its eye carries across the dark.
 */

interface Waking {
  /** Where it rises, forward and to the right of the crater's middle, in meters. */
  readonly from: readonly [number, number];
  /** The film's second it breaks the ground (the script's `CRAWLER_RISES`, which the sound follows too). */
  readonly rises: number;
  /** Meters a second it walks once it is up. */
  readonly speed: number;
}

const WAKING: readonly Waking[] = (
  [
    { from: [8.5, -4.5], speed: 0.9 },
    { from: [11.5, -1], speed: 1.05 },
    { from: [7, 0], speed: 0.85 },
    { from: [12.5, -6.5], speed: 1.1 },
    { from: [9.5, 2.5], speed: 0.95 },
  ] as const
).map((machine, i) => ({ ...machine, rises: CRAWLER_RISES[i] as number }));

/** The seconds a machine takes to climb out of the ground, which the renderer sets. */
const RISE_SECONDS = 0.6;
/** What a held film gives the renderer to settle the machines: this many steps of this many seconds. */
const SETTLE_STEPS = 8;
const SETTLE_STEP = 0.1;
/** Where the Core's glint of an eye sits on a crawler, in meters ahead of and above its feet. */
const EYE_AHEAD = 0.85;
const EYE_UP = 0.5;

export function createCrawlersLayer({ registry, frame }: IntroContext): IntroLayer {
  const renderer = createEnemyRenderer({ registry, capacity: WAKING.length });
  const group = new Group();
  group.name = 'intro-crawlers';
  group.add(renderer.object);

  const glints: Glow[] = WAKING.map(() =>
    createGlow(registry, { core: '#ffb8a0', halo: '#ff2a10', rays: 0.25, share: 0.0015 }),
  );
  for (const glint of glints) group.add(glint.mesh);

  const crater = { x: frame.x, z: frame.z };
  const start: Point3[] = WAKING.map((w) =>
    placeInFrame(frame, w.from[0], w.from[1], 0, { x: 0, y: 0, z: 0 }),
  );
  // Which way each one walks: at the Core.
  const heading = start.map((spot) => Math.atan2(crater.x - spot.x, crater.z - spot.z));
  const slots = WAKING.map(() => createEnemyPose());
  const poses: EnemyPose[] = [];

  return {
    object: group,
    update(time, dt) {
      poses.length = 0;
      WAKING.forEach((w, i) => {
        const glint = glints[i] as Glow;
        if (time < w.rises) {
          glint.set(0, 0, 0, 1, 0);
          return;
        }
        const born = start[i] as Point3;
        const yaw = heading[i] as number;
        const walked = Math.max(0, time - w.rises - RISE_SECONDS) * w.speed;
        const x = born.x + Math.sin(yaw) * walked;
        const z = born.z + Math.cos(yaw) * walked;
        const y = frame.site.groundAt(x, z);
        const slot = slots[i] as EnemyPose;
        slot.id = i + 1;
        slot.x = x;
        slot.y = y;
        slot.z = z;
        slot.yaw = yaw;
        slot.speed = walked > 0 ? w.speed : 0;
        poses.push(slot);
        // A glint on the eye, there once the machine has climbed out and a little before it opens.
        const up = Math.min(1, (time - w.rises) / RISE_SECONDS);
        glint.set(
          x + Math.sin(yaw) * EYE_AHEAD,
          y + EYE_UP,
          z + Math.cos(yaw) * EYE_AHEAD,
          0.3,
          Math.max(0, (up - 0.5) * 2) * 0.45,
        );
      });
      // A held film has no time passing for the machines to climb out and settle in, so they are given a moment to.
      if (dt > 0) renderer.update(dt, poses);
      else for (let i = 0; i < SETTLE_STEPS; i++) renderer.update(SETTLE_STEP, poses);
    },
    dispose() {
      renderer.dispose();
      for (const glint of glints) glint.dispose();
      group.removeFromParent();
    },
  };
}
