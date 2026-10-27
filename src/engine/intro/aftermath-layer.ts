import { Group } from 'three';
import {
  BURN_UNTIL,
  CORE_PULSES,
  REVEAL_AT,
  coreGlowAt,
  sceneTime,
  smoothstep01,
} from '../../shared/intro';
import { createRng } from '../../shared/hash';
import { between, mixColor } from './fx-util';
import { createGlow } from './glow';
import type { IntroContext, IntroLayer } from './layer';
import { createParticleField } from './particles';

/**
 * What the crash leaves: embers lifting off the crater into the dark, the smoke column over the
 * wreck, the small fires that burn on among the debris, and the Core, which wakes in the middle of
 * it with a flash and then a slow cyan breath. Everything is a function of the film's clock.
 */

const TWO_PI = Math.PI * 2;
/** How far the Core's glow reaches, in meters; the camera of the eyes scene stands a few steps from the Core, so it is held tighter there. */
const BREATH_REACH = 6;
const BREATH_REACH_NEAR = 2.8;

export function createAftermathLayer({ registry, frame }: IntroContext): IntroLayer {
  const random = createRng(0xa5f7e2a9);
  const group = new Group();
  group.name = 'intro-aftermath';

  const { crater, core: heart } = frame.site;
  const ground = (x: number, z: number): number => frame.site.groundAt(x, z);

  const embers = createParticleField(registry, 'ember', 520);
  const smoke = createParticleField(registry, 'smoke', 300);
  const fires = createParticleField(registry, 'fire', 700);
  const rings = createParticleField(registry, 'fire', CORE_PULSES.length * 90);
  const breath = createGlow(registry, { core: '#d6f8ff', halo: '#27c8e6', rays: 0.35, share: 0 });
  group.add(smoke.object, fires.object, embers.object, rings.object, breath.mesh);

  const emit = (count: number, from: number, to: number, write: (birth: number) => void): void => {
    for (let i = 0; i < count; i++) write(from + ((to - from) * (i + random())) / count);
  };

  // Embers: lifted off the whole floor of the crater by the heat, drifting up and downwind into the dark.
  emit(480, REVEAL_AT, BURN_UNTIL, (birth) => {
    const aim = between(random, 0, TWO_PI);
    const radius = Math.sqrt(random()) * crater.radius * 0.95;
    const x = crater.x + Math.cos(aim) * radius;
    const z = crater.z + Math.sin(aim) * radius;
    embers.add({
      x,
      y: ground(x, z) + between(random, 0.2, 3),
      z,
      birth,
      life: between(random, 4, 9.5),
      vx: 1.4 + between(random, -1.2, 1.2),
      vy: between(random, 0.8, 3),
      vz: 0.7 + between(random, -1.2, 1.2),
      drag: 0.15,
      gravity: -0.15,
      size: between(random, 0.22, 0.5),
      sizeEnd: 0.08,
      color: mixColor([3.1, 1.2, 0.28], [2.4, 0.8, 0.15], random()),
      colorEnd: [1.2, 0.2, 0.04],
      alpha: 0.95,
      seed: random(),
      fadeIn: 0.05,
      fadeOut: 0.5,
    });
  });

  // The smoke column: from the heart of the wreck straight up, then leaning with the wind, until the sun burns it away.
  emit(220, REVEAL_AT - 0.1, sceneTime('dawn', 2.5), (birth) => {
    const x = crater.x + between(random, -2.5, 2.5);
    const z = crater.z + between(random, -2.5, 2.5);
    smoke.add({
      x,
      y: ground(x, z) + between(random, 0.5, 3),
      z,
      birth,
      life: between(random, 8, 14),
      vx: 1.2 + between(random, -0.6, 0.6),
      vy: between(random, 2.2, 4.5),
      vz: 0.6 + between(random, -0.6, 0.6),
      drag: 0.2,
      gravity: -0.1,
      size: between(random, 5, 8),
      sizeEnd: between(random, 16, 30),
      color: [0.7, 0.36, 0.2],
      colorEnd: mixColor([0.2, 0.19, 0.21], [0.3, 0.27, 0.27], random()),
      alpha: 0.5,
      seed: random(),
      fadeIn: 0.12,
      fadeOut: 0.6,
      spin: between(random, -0.3, 0.3),
    });
  });

  // Fires among the debris: a few spots round the crater, each a stream of small flames.
  const spots = Array.from({ length: 7 }, () => {
    const aim = between(random, 0, TWO_PI);
    const radius = between(random, 4, crater.radius * 0.85);
    return {
      x: crater.x + Math.cos(aim) * radius,
      z: crater.z + Math.sin(aim) * radius,
      size: between(random, 0.8, 1.7),
    };
  });
  for (const spot of spots) {
    emit(70, REVEAL_AT + between(random, 0, 1.2), BURN_UNTIL, (birth) => {
      const x = spot.x + between(random, -0.6, 0.6);
      const z = spot.z + between(random, -0.6, 0.6);
      fires.add({
        x,
        y: ground(x, z) + 0.3,
        z,
        birth,
        life: between(random, 0.7, 1.6),
        vy: between(random, 1, 2.6),
        drag: 0.8,
        size: spot.size * between(random, 0.7, 1.1),
        sizeEnd: spot.size * 0.25,
        stretch: 1.5,
        color: mixColor([2.6, 1.15, 0.3], [2.1, 0.8, 0.15], random()),
        colorEnd: [1, 0.18, 0.04],
        alpha: 0.9,
        seed: random(),
        fadeIn: 0.15,
        fadeOut: 0.6,
      });
    });
  }

  // The rings of light the Core sends across the ground, one for each pulse of its crystal.
  for (const at of CORE_PULSES) {
    for (let i = 0; i < 90; i++) {
      const aim = (i / 90) * TWO_PI + random() * 0.05;
      const x = heart.x + Math.cos(aim) * 1.8;
      const z = heart.z + Math.sin(aim) * 1.8;
      rings.add({
        x,
        y: ground(x, z) + 0.35,
        z,
        birth: at,
        life: 1.7,
        vx: Math.cos(aim) * 17,
        vz: Math.sin(aim) * 17,
        drag: 1.1,
        size: 1.3,
        sizeEnd: 2.2,
        color: [0.25, 1.1, 1.5],
        colorEnd: [0.08, 0.4, 0.7],
        alpha: 0.55,
        seed: random(),
        fadeIn: 0.05,
        fadeOut: 0.75,
      });
    }
  }

  for (const field of [embers, smoke, fires, rings]) field.commit();

  return {
    object: group,
    update(time) {
      for (const field of [embers, smoke, fires, rings]) field.setTime(time);

      // The Core's glow: a flash as it is uncovered, then a slow breath that the morning dims.
      const power = coreGlowAt(time);
      const near =
        smoothstep01((time - sceneTime('eyes', 0)) / 0.4) *
        (1 - smoothstep01((time - sceneTime('eyes', 6.6)) / 0.4));
      breath.set(
        heart.x,
        heart.y,
        heart.z,
        BREATH_REACH + (BREATH_REACH_NEAR - BREATH_REACH) * near,
        power,
      );
    },
    dispose() {
      for (const field of [embers, smoke, fires, rings]) field.dispose();
      breath.dispose();
      group.removeFromParent();
    },
  };
}
