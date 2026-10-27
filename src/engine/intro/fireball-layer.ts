import { Group, Quaternion, Vector3 } from 'three';
import { STOP_AT, TOUCHDOWN_AT } from '../../shared/intro';
import { placeInFrame } from '../../shared/intro-camera';
import { createWreckState } from '../../shared/intro-wreck';
import { createRng } from '../../shared/hash';
import { between, mixColor } from './fx-util';
import { createGlow } from './glow';
import { createHull } from './hull';
import type { IntroContext, IntroLayer } from './layer';
import { createParticleField } from './particles';

/**
 * The piece of the station coming down, from the first glimpse of it high over the hills to the
 * moment it comes to rest in the crater: the hull itself, the light round it, and the fire, smoke
 * and sparks it leaves in its wake. Everything is a function of the film's clock.
 */

const FORWARD = new Vector3(0, 0, 1);

/** The film's seconds over which the wreck's heat dies away after it stops. */
const COOL_SECONDS = 22;

/** The wind that drags the smoke of its trail, in meters a second. */
const WIND: readonly [number, number] = [2.2, 1.1];

/** The first moment the wreck is in the sky. */
const FIRST = 0.4;

/** How fast it tumbles about the way it flies while it falls, in radians a second. */
const TUMBLE = 0.9;
/** Seconds the ground takes to drag that tumble to a stop once it is down. */
const TUMBLE_DRAG = 1.6;

/** How far it has turned about its own length at `time`: tumbling in the air, then dragged to rest on the ground. */
function rollAt(time: number): number {
  if (time <= TOUCHDOWN_AT) return TUMBLE * time;
  const down = Math.min(time - TOUCHDOWN_AT, TUMBLE_DRAG);
  // The spin slows steadily from the full tumble to nothing: the area under that line is how far it still turns.
  return TUMBLE * (TOUCHDOWN_AT + down - (down * down) / (2 * TUMBLE_DRAG));
}

export function createFireballLayer({ registry, wreck, frame }: IntroContext): IntroLayer {
  const random = createRng(0xf1eb0a11);
  const group = new Group();
  group.name = 'intro-fireball';

  const hull = createHull(registry);
  const halo = createGlow(registry, { core: '#ffe3b8', halo: '#ff5a14', rays: 0.35, share: 0.018 });
  const core = createGlow(registry, { core: '#fff6e6', halo: '#ffb060', rays: 0.2, share: 0.007 });
  const fire = createParticleField(registry, 'fire', 1300);
  const smoke = createParticleField(registry, 'smoke', 700, { fog: 0.25 });
  const sparks = createParticleField(registry, 'spark', 400);
  group.add(smoke.object, fire.object, sparks.object, hull.mesh, halo.mesh, core.mesh);

  const here = createWreckState();

  // The film watches the fall from the edge of the crater, so what is far away is drawn larger: the
  // trail has to read as a long burning streak across the sky, not as a hairline, while close by it
  // is only as big as the wreck's own fire.
  const watcher = placeInFrame(frame, 18, 9, 13, { x: 0, y: 0, z: 0 });
  const distance = (): number =>
    Math.hypot(here.x - watcher.x, here.y - watcher.y, here.z - watcher.z);
  /** The width of a puff of the wake, in meters, for a wreck this far from the watcher. */
  const puffAt = (away: number): number => Math.min(26, 3 + 0.012 * away);
  /** How much farther than it is a spark is flung, so that it still shows from afar. */
  const flingAt = (away: number): number => Math.min(4, Math.max(1, away / 150));

  const emit = (count: number, from: number, to: number, write: (birth: number) => void): void => {
    for (let i = 0; i < count; i++) write(from + ((to - from) * (i + random())) / count);
  };

  // The wake of the fall: fire that burns on for seconds behind it, so that it draws a streak across the sky.
  emit(1000, FIRST, TOUCHDOWN_AT, (birth) => {
    wreck.at(birth, here);
    const puff = puffAt(distance());
    const scatter = 0.3 * puff;
    fire.add({
      x: here.x + between(random, -scatter, scatter),
      y: here.y + between(random, -scatter * 0.6, scatter),
      z: here.z + between(random, -scatter, scatter),
      birth,
      life: between(random, 2.4, 4.2),
      vx: between(random, -2, 2) - here.dx * 3,
      vy: between(random, 0.5, 3.5),
      vz: between(random, -2, 2) - here.dz * 3,
      drag: 0.9,
      size: between(random, 0.9, 1.5) * puff,
      sizeEnd: between(random, 0.3, 0.55) * puff,
      color: mixColor([3.2, 1.7, 0.6], [2.4, 1.1, 0.3], random()),
      colorEnd: [0.9, 0.12, 0.03],
      alpha: 0.8,
      seed: random(),
      fadeIn: 0.04,
      fadeOut: 0.7,
    });
  });

  // And the smoke it leaves in the sky, which hangs there for longer.
  emit(520, FIRST, TOUCHDOWN_AT, (birth) => {
    wreck.at(birth, here);
    const puff = puffAt(distance());
    const spread = 0.4 * puff;
    smoke.add({
      x: here.x + between(random, -spread, spread),
      y: here.y + between(random, -spread, spread),
      z: here.z + between(random, -spread, spread),
      birth,
      life: between(random, 4, 8),
      vx: WIND[0] + between(random, -2.5, 2.5),
      vy: between(random, 0.8, 3.4),
      vz: WIND[1] + between(random, -2.5, 2.5),
      drag: 0.35,
      gravity: -0.12,
      size: between(random, 1.2, 1.9) * puff,
      sizeEnd: between(random, 4, 6.5) * puff,
      color: [0.9, 0.45, 0.25],
      colorEnd: mixColor([0.26, 0.2, 0.22], [0.36, 0.28, 0.27], random()),
      alpha: 0.5,
      seed: random(),
      fadeIn: 0.1,
      fadeOut: 0.55,
      spin: between(random, -0.35, 0.35),
    });
  });

  // Burning pieces thrown off it as it comes in.
  emit(380, FIRST, TOUCHDOWN_AT - 0.2, (birth) => {
    wreck.at(birth, here);
    const boost = flingAt(distance());
    const flight = between(random, 8, 24) * boost;
    const aim = between(random, 0, Math.PI * 2);
    sparks.add({
      x: here.x,
      y: here.y,
      z: here.z,
      birth,
      life: between(random, 0.7, 2),
      vx: Math.cos(aim) * flight - here.dx * 14,
      vy: between(random, -4, 12) * boost,
      vz: Math.sin(aim) * flight - here.dz * 14,
      drag: 0.35,
      gravity: 10,
      size: between(random, 0.5, 1.1) * boost,
      color: mixColor([3.2, 1.8, 0.7], [2.6, 1.1, 0.3], random()),
      colorEnd: [1.2, 0.3, 0.05],
      alpha: 1,
      seed: random(),
      stretch: 7,
      fadeIn: 0.02,
      fadeOut: 0.5,
    });
  });

  // The skid: a plume of flame and black smoke torn back from the open end of the drum, behind it and not over it.
  emit(190, TOUCHDOWN_AT, STOP_AT - 0.3, (birth) => {
    wreck.at(birth, here);
    const behind = 3.2 + random() * 2.6;
    fire.add({
      x: here.x - here.dx * behind + between(random, -1.2, 1.2),
      y: here.y + between(random, -0.4, 1.4),
      z: here.z - here.dz * behind + between(random, -1.2, 1.2),
      birth,
      life: between(random, 0.6, 1.5),
      vx: -here.dx * between(random, 3, 8),
      vy: between(random, 1, 4),
      vz: -here.dz * between(random, 3, 8),
      drag: 0.8,
      size: between(random, 3.2, 5.5),
      sizeEnd: between(random, 1.4, 2.6),
      color: mixColor([3, 1.5, 0.5], [2.4, 1, 0.25], random()),
      colorEnd: [1, 0.18, 0.04],
      alpha: 0.5,
      seed: random(),
      fadeIn: 0.1,
      fadeOut: 0.6,
    });
  });
  emit(130, TOUCHDOWN_AT, STOP_AT - 0.2, (birth) => {
    wreck.at(birth, here);
    const behind = 4 + random() * 3;
    smoke.add({
      x: here.x - here.dx * behind + between(random, -1.5, 1.5),
      y: here.y + between(random, 0, 1.8),
      z: here.z - here.dz * behind + between(random, -1.5, 1.5),
      birth,
      life: between(random, 3, 6),
      vx: -here.dx * between(random, 2, 6) + between(random, -1, 1),
      vy: between(random, 2, 5),
      vz: -here.dz * between(random, 2, 6) + between(random, -1, 1),
      drag: 0.6,
      gravity: -0.3,
      size: between(random, 4, 7),
      sizeEnd: between(random, 18, 32),
      color: [0.55, 0.26, 0.13],
      colorEnd: [0.15, 0.14, 0.15],
      alpha: 0.6,
      seed: random(),
      fadeIn: 0.1,
      fadeOut: 0.6,
      spin: between(random, -0.4, 0.4),
    });
  });

  for (const field of [fire, smoke, sparks]) field.commit();

  const turn = new Quaternion();
  const heading = new Vector3();

  return {
    object: group,
    update(time) {
      for (const field of [fire, smoke, sparks]) field.setTime(time);
      hull.setTime(time);
      wreck.at(time, here);

      const alive = time >= FIRST - 0.05 && time < STOP_AT + 0.3;
      hull.mesh.visible = alive;
      if (alive) {
        hull.mesh.position.set(here.x, here.y, here.z);
        heading.set(here.dx, here.dy, here.dz);
        turn.setFromUnitVectors(FORWARD, heading);
        hull.mesh.quaternion.copy(turn);
        hull.mesh.rotateZ(rollAt(time));
        // Hot while it burns in, cooling once it has stopped.
        const cooled = Math.max(0, time - STOP_AT) / COOL_SECONDS;
        hull.setHeat(Math.max(0.2, 1 - cooled));
      }

      // The light round it: brightest in the air, smaller on the ground where the dust and the trees hide it, gone as the hull is.
      const skidding = here.phase === 'skid';
      const share = skidding ? (time - TOUCHDOWN_AT) / (STOP_AT - TOUCHDOWN_AT) : 0;
      const brightness =
        here.phase === 'fall'
          ? Math.min(1, (time - FIRST) / 0.8)
          : skidding
            ? 0.4 - 0.2 * share
            : 0;
      // (From afar the glow covers a share of the distance, so these are the least it is up close.)
      halo.set(here.x, here.y, here.z, skidding ? 8 : 5, alive ? brightness : 0);
      core.set(here.x, here.y, here.z, skidding ? 3 : 1.8, alive ? brightness : 0);
    },
    dispose() {
      for (const field of [fire, smoke, sparks]) field.dispose();
      hull.dispose();
      halo.dispose();
      core.dispose();
      group.removeFromParent();
    },
  };
}
