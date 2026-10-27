import { Group } from 'three';
import { STOP_AT, TOUCHDOWN_AT } from '../../shared/intro';
import { createWreckState } from '../../shared/intro-wreck';
import { createRng } from '../../shared/hash';
import { between, mixColor } from './fx-util';
import { createGlow } from './glow';
import type { IntroContext, IntroLayer } from './layer';
import { createParticleField } from './particles';

/**
 * What the wreck does to the ground: the wall of dust it ploughs up, the fires it leaves in the
 * furrow, the burst where it first touches down and the great flash, shock ring and fountain of
 * sparks where it stops. Like the rest of the film, a function of the clock alone.
 */

const DUST: readonly [number, number, number] = [0.24, 0.19, 0.16];
const DUST_END: readonly [number, number, number] = [0.15, 0.14, 0.15];
/** Dust the fire inside it lights from below. */
const DUST_LIT: readonly [number, number, number] = [0.6, 0.3, 0.14];
const TWO_PI = Math.PI * 2;

export function createImpactLayer({ registry, wreck, frame }: IntroContext): IntroLayer {
  const random = createRng(0x1ac70d57);
  const group = new Group();
  group.name = 'intro-impact';

  const dust = createParticleField(registry, 'smoke', 1500);
  const fire = createParticleField(registry, 'fire', 700);
  const sparks = createParticleField(registry, 'spark', 700);
  const flashTouch = createGlow(registry, {
    core: '#fff2d8',
    halo: '#ff7a24',
    rays: 0.9,
    share: 0,
  });
  const flashStop = createGlow(registry, { core: '#ffffff', halo: '#ffb05a', rays: 1, share: 0 });
  group.add(dust.object, fire.object, sparks.object, flashTouch.mesh, flashStop.mesh);

  const here = createWreckState();
  const groundAt = (x: number, z: number): number => frame.site.groundAt(x, z);
  const { touchdown, rest } = wreck;

  /** Writes `count` things born between two moments of the film. */
  const emit = (count: number, from: number, to: number, write: (birth: number) => void): void => {
    for (let i = 0; i < count; i++) write(from + ((to - from) * (i + random())) / count);
  };

  // The wall of dust: a puff to each side of the furrow all along the skid, thrown up and out, and a
  // heavier plume right behind the wreck that the fire inside it lights from below.
  emit(560, TOUCHDOWN_AT, STOP_AT - 0.15, (birth) => {
    wreck.at(birth, here);
    const across = between(random, -1, 1);
    const side = Math.sign(across) || 1;
    // The unit vector to the left of the way it is going, as seen from above.
    const lx = here.dz;
    const lz = -here.dx;
    const offset = across * 3.6;
    const x = here.x + lx * offset;
    const z = here.z + lz * offset;
    const young = random() < 0.35;
    dust.add({
      x,
      y: groundAt(x, z) + between(random, 0.3, 1.8),
      z,
      birth,
      life: between(random, 3.4, 6.8),
      vx: lx * side * between(random, 2, 9) + between(random, -1.5, 1.5) - here.dx * 3,
      vy: between(random, 1.5, 6.5),
      vz: lz * side * between(random, 2, 9) + between(random, -1.5, 1.5) - here.dz * 3,
      drag: 0.7,
      gravity: -0.35,
      size: between(random, 5, 9),
      sizeEnd: between(random, 22, 40),
      color: young ? DUST_LIT : DUST,
      colorEnd: mixColor(DUST_END, DUST, random() * 0.4),
      alpha: young ? 0.6 : 0.5,
      seed: random(),
      fadeIn: 0.1,
      fadeOut: 0.6,
      spin: between(random, -0.4, 0.4),
    });
  });

  // The furrow burns behind it: fires in the torn grass, a few seconds each.
  emit(130, TOUCHDOWN_AT + 0.1, STOP_AT, (birth) => {
    wreck.at(birth, here);
    const x = here.x + between(random, -2.8, 2.8);
    const z = here.z + between(random, -2.8, 2.8);
    fire.add({
      x,
      y: groundAt(x, z) + 0.5,
      z,
      birth,
      life: between(random, 2.2, 5.5),
      vy: between(random, 0.6, 1.8),
      drag: 0.6,
      size: between(random, 1.4, 2.8),
      sizeEnd: between(random, 0.4, 1),
      stretch: 1.3,
      color: mixColor([2.8, 1.3, 0.35], [2.2, 0.9, 0.2], random()),
      colorEnd: [1, 0.2, 0.04],
      alpha: 0.85,
      seed: random(),
      fadeIn: 0.12,
      fadeOut: 0.6,
    });
  });

  // Sparks off the metal as it drags: white-hot streaks thrown out and back along the furrow.
  emit(240, TOUCHDOWN_AT, STOP_AT - 0.2, (birth) => {
    wreck.at(birth, here);
    const aim = between(random, 0, TWO_PI);
    const flight = between(random, 4, 15);
    sparks.add({
      x: here.x,
      y: here.y - 1,
      z: here.z,
      birth,
      life: between(random, 0.6, 1.5),
      vx: Math.cos(aim) * flight - here.dx * 6,
      vy: between(random, 3, 12),
      vz: Math.sin(aim) * flight - here.dz * 6,
      drag: 0.25,
      gravity: 12,
      size: between(random, 0.35, 0.8),
      color: mixColor([3.2, 1.9, 0.8], [2.6, 1.2, 0.3], random()),
      colorEnd: [1.4, 0.35, 0.06],
      seed: random(),
      stretch: 7,
      fadeIn: 0.02,
      fadeOut: 0.5,
    });
  });

  // The touchdown: dust and fire thrown skyward from the first bite, in a ring that opens across the slope.
  emit(110, TOUCHDOWN_AT - 0.04, TOUCHDOWN_AT + 0.3, (birth) => {
    const aim = between(random, 0, TWO_PI);
    const flight = between(random, 6, 22);
    const x = touchdown.x + Math.cos(aim) * 2;
    const z = touchdown.z + Math.sin(aim) * 2;
    dust.add({
      x,
      y: groundAt(x, z) + 1,
      z,
      birth,
      life: between(random, 3.5, 7),
      vx: Math.cos(aim) * flight,
      vy: between(random, 6, 18),
      vz: Math.sin(aim) * flight,
      drag: 0.55,
      gravity: 2,
      size: between(random, 7, 12),
      sizeEnd: between(random, 30, 55),
      color: random() < 0.4 ? DUST_LIT : DUST,
      colorEnd: DUST_END,
      alpha: 0.6,
      seed: random(),
      fadeIn: 0.08,
      fadeOut: 0.6,
      spin: between(random, -0.4, 0.4),
    });
  });
  emit(70, TOUCHDOWN_AT - 0.04, TOUCHDOWN_AT + 0.25, (birth) => {
    const aim = between(random, 0, TWO_PI);
    const flight = between(random, 3, 16);
    fire.add({
      x: touchdown.x,
      y: touchdown.y,
      z: touchdown.z,
      birth,
      life: between(random, 0.8, 2.2),
      vx: Math.cos(aim) * flight,
      vy: between(random, 4, 16),
      vz: Math.sin(aim) * flight,
      drag: 0.7,
      size: between(random, 9, 17),
      sizeEnd: between(random, 3, 7),
      color: [3.3, 1.8, 0.7],
      colorEnd: [1.2, 0.25, 0.04],
      seed: random(),
      fadeIn: 0.06,
      fadeOut: 0.6,
    });
  });
  emit(120, TOUCHDOWN_AT - 0.04, TOUCHDOWN_AT + 0.35, (birth) => {
    const aim = between(random, 0, TWO_PI);
    const flight = between(random, 5, 26);
    sparks.add({
      x: touchdown.x,
      y: touchdown.y,
      z: touchdown.z,
      birth,
      life: between(random, 0.9, 2.4),
      vx: Math.cos(aim) * flight,
      vy: between(random, 8, 30),
      vz: Math.sin(aim) * flight,
      drag: 0.2,
      gravity: 14,
      size: between(random, 0.5, 1.1),
      color: [3.4, 2, 0.8],
      colorEnd: [1.4, 0.35, 0.06],
      seed: random(),
      stretch: 8,
      fadeIn: 0.02,
      fadeOut: 0.5,
    });
  });

  // The stop: a shock ring of dust racing out along the ground, a billow rising from the middle, a fountain of fire and sparks.
  emit(110, STOP_AT - 0.04, STOP_AT + 0.22, (birth) => {
    const aim = between(random, 0, TWO_PI);
    const flight = between(random, 8, 17);
    const radius = between(random, 2.5, 5);
    const x = rest.x + Math.cos(aim) * radius;
    const z = rest.z + Math.sin(aim) * radius;
    dust.add({
      x,
      y: groundAt(x, z) + 0.6,
      z,
      birth,
      life: between(random, 3.6, 6.5),
      vx: Math.cos(aim) * flight,
      vy: between(random, 0.4, 3),
      vz: Math.sin(aim) * flight,
      drag: 0.85,
      gravity: -0.2,
      size: between(random, 4, 8),
      sizeEnd: between(random, 20, 34),
      color: random() < 0.3 ? DUST_LIT : DUST,
      colorEnd: DUST_END,
      alpha: 0.6,
      seed: random(),
      fadeIn: 0.08,
      fadeOut: 0.6,
      spin: between(random, -0.4, 0.4),
    });
  });
  emit(70, STOP_AT - 0.04, STOP_AT + 0.5, (birth) => {
    const x = rest.x + between(random, -3, 3);
    const z = rest.z + between(random, -3, 3);
    dust.add({
      x,
      y: groundAt(x, z) + between(random, 1, 3),
      z,
      birth,
      life: between(random, 5, 9.5),
      vx: between(random, -3.5, 3.5),
      vy: between(random, 2.5, 8),
      vz: between(random, -3.5, 3.5),
      drag: 0.5,
      gravity: -0.5,
      size: between(random, 9, 14),
      sizeEnd: between(random, 38, 64),
      color: DUST_LIT,
      colorEnd: mixColor([0.22, 0.2, 0.21], DUST_END, random()),
      alpha: 0.6,
      seed: random(),
      fadeIn: 0.1,
      fadeOut: 0.6,
      spin: between(random, -0.3, 0.3),
    });
  });
  emit(36, STOP_AT - 0.04, STOP_AT + 0.3, (birth) => {
    const aim = between(random, 0, TWO_PI);
    const flight = between(random, 2, 14);
    fire.add({
      x: rest.x,
      y: rest.y + 0.5,
      z: rest.z,
      birth,
      life: between(random, 0.7, 2),
      vx: Math.cos(aim) * flight,
      vy: between(random, 5, 18),
      vz: Math.sin(aim) * flight,
      drag: 0.8,
      gravity: 5,
      size: between(random, 2.4, 4.8),
      sizeEnd: between(random, 1, 2.4),
      color: [2.1, 1.05, 0.4],
      colorEnd: [1.1, 0.22, 0.04],
      alpha: 0.75,
      seed: random(),
      fadeIn: 0.06,
      fadeOut: 0.6,
    });
  });
  emit(150, STOP_AT - 0.04, STOP_AT + 0.4, (birth) => {
    const aim = between(random, 0, TWO_PI);
    const flight = between(random, 3, 18);
    sparks.add({
      x: rest.x,
      y: rest.y,
      z: rest.z,
      birth,
      life: between(random, 1, 2.6),
      vx: Math.cos(aim) * flight,
      vy: between(random, 8, 26),
      vz: Math.sin(aim) * flight,
      drag: 0.18,
      gravity: 14,
      size: between(random, 0.3, 0.7),
      color: mixColor([3.4, 2, 0.8], [2.6, 1.1, 0.3], random()),
      colorEnd: [1.4, 0.35, 0.06],
      seed: random(),
      stretch: 6,
      fadeIn: 0.02,
      fadeOut: 0.5,
    });
  });

  for (const field of [dust, fire, sparks]) field.commit();

  return {
    object: group,
    update(time) {
      for (const field of [dust, fire, sparks]) field.setTime(time);

      // The flashes: the bite at the touchdown, and the stop, which is the bigger of the two.
      const touch = time - TOUCHDOWN_AT;
      const bite =
        touch > -0.04 && touch < 0.9 ? Math.max(0, 1 - Math.max(0, touch) / 0.9) ** 1.6 : 0;
      flashTouch.set(touchdown.x, touchdown.y + 2, touchdown.z, 22, bite * 0.8);
      const halt = time - STOP_AT;
      const blast =
        halt > -0.04 && halt < 1.6 ? Math.max(0, 1 - Math.max(0, halt) / 1.6) ** 1.8 : 0;
      flashStop.set(rest.x, rest.y + 1.5, rest.z, 9, blast * 0.4);
    },
    dispose() {
      for (const field of [dust, fire, sparks]) field.dispose();
      flashTouch.dispose();
      flashStop.dispose();
      group.removeFromParent();
    },
  };
}
