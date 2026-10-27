/** Small helpers for writing the film's particles: draws from a seeded generator. */
export type Rng = () => number;

/** A number between `a` and `b`. */
export function between(random: Rng, a: number, b: number): number {
  return a + (b - a) * random();
}

/** A random point on the unit sphere. */
export function onSphere(random: Rng, out: [number, number, number]): [number, number, number] {
  const z = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const ring = Math.sqrt(1 - z * z);
  out[0] = ring * Math.cos(angle);
  out[1] = z;
  out[2] = ring * Math.sin(angle);
  return out;
}

/** Mixes two colors. */
export function mixColor(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** A color scaled by `k`. */
export function scaleColor(
  color: readonly [number, number, number],
  k: number,
): [number, number, number] {
  return [color[0] * k, color[1] * k, color[2] * k];
}
