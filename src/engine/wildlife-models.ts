import { SphereGeometry, type BufferGeometry } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WILD_SPECIES } from '../shared/wildlife-state';
import {
  HOW,
  LOOK,
  acrossAll,
  ellipsoid,
  leaf,
  lathe,
  rigged,
  tube,
  weld,
  type Point,
  type Rig,
} from './wildlife-shapes';

/**
 * The eight creatures of the valley, each built in code as one welded, smooth-shaded geometry: a
 * stag with antlers, a hare with long ears, a mossy tortoise, a silver fish, a ray, a lantern jelly,
 * a finch and a kite. A model is drawn at its own size here (the picture scales it with the
 * species' `scale`), the ground or the underside of its body at the origin, its face +Z and its
 * left +X. The pieces that move say how (`HOW`) and where they turn, and the vertex shader does the
 * rest, so a herd of them costs a handful of array writes a frame.
 *
 * The models are drawn about the middle of the whole animal, head to tail, rather than the middle of
 * its body, so the box a bolt is judged against (a square around the creature's place) lies over
 * the creature the way it looks on screen.
 */

const SIDES = [-1, 1] as const;

/** Adds pieces to a model as they are described. */
function assembly(): {
  parts: BufferGeometry[];
  add: (geometry: BufferGeometry, rig: Rig) => void;
} {
  const parts: BufferGeometry[] = [];
  return {
    parts,
    add: (geometry, rig) => {
      parts.push(rigged(geometry, rig));
    },
  };
}

/**
 * The stag, drawn at design size: about 1.9 long with the head up, a shoulder height of 1.2 and
 * antlers to 1.75. Its head and neck turn about the base of the neck; its legs have a knee, or a
 * hock, to bend.
 */
export function buildStag(): BufferGeometry {
  const { parts, add } = assembly();
  const neck: Point = [0, 1.0, 0.4];
  const body = (geometry: BufferGeometry, look: number = LOOK.coat): void =>
    add(geometry, { look });
  const head = (geometry: BufferGeometry, look: number = LOOK.coat): void =>
    add(geometry, { look, how: HOW.head, hip: neck });

  // The barrel, deeper than it is wide, the haunches over the hind legs and the pale patch of the rump.
  body(
    tube(
      [
        [0, 0.9, -0.62],
        [0, 0.89, -0.46],
        [0, 0.88, -0.22],
        [0, 0.89, 0.04],
        [0, 0.91, 0.28],
        [0, 0.94, 0.46],
        [0, 0.96, 0.56],
      ],
      [0.07, 0.17, 0.205, 0.205, 0.215, 0.19, 0.1],
      { sides: 10, squash: 1.3 },
    ),
  );
  for (const s of SIDES)
    body(ellipsoid([0.1, 0.17, 0.2], [s * 0.12, 0.82, -0.4], undefined, [9, 5]));
  body(ellipsoid([0.09, 0.12, 0.05], [0, 0.88, -0.6], [-0.2, 0, 0], [6, 4]), LOOK.belly);

  // The neck and the head, carried high: a long skull on a short muzzle, a chin, a dark nose and eyes.
  head(
    tube(
      [
        [0, 0.99, 0.38],
        [0, 1.1, 0.52],
        [0, 1.22, 0.66],
        [0, 1.3, 0.78],
      ],
      [0.14, 0.115, 0.09, 0.075],
      { sides: 8, squash: 1.1, caps: 'none' },
    ),
  );
  head(ellipsoid([0.085, 0.09, 0.16], [0, 1.31, 0.9], [0.45, 0, 0], [10, 6]));
  head(
    tube(
      [
        [0, 1.265, 1.02],
        [0, 1.2, 1.19],
      ],
      [0.058, 0.04],
      { sides: 8, squash: 0.95, caps: 'end' },
    ),
  );
  head(ellipsoid([0.04, 0.028, 0.03], [0, 1.195, 1.2], [0.3, 0, 0], [6, 4]), LOOK.dark);
  head(ellipsoid([0.03, 0.028, 0.09], [0, 1.185, 1.1], [0.25, 0, 0], [6, 4]), LOOK.belly);
  for (const s of SIDES) {
    head(ellipsoid([0.02, 0.024, 0.02], [s * 0.075, 1.345, 0.935], undefined, [6, 4]), LOOK.eye);
    head(ellipsoid([0.032, 0.1, 0.05], [s * 0.115, 1.42, 0.83], [-0.35, 0, -s * 0.75], [8, 4]));
  }

  // The antlers: a beam that sweeps up and back with a brow, a bez and a trez tine and a crown of two.
  for (const s of SIDES) {
    const tine = (path: Point[], radii: number[], sides = 5): void =>
      head(tube(acrossAll(s, path), radii, { sides, caps: 'start', ref: [0, 0, 1] }), LOOK.trim);
    tine(
      [
        [0.06, 1.37, 0.86],
        [0.09, 1.47, 0.82],
        [0.14, 1.58, 0.77],
        [0.19, 1.68, 0.76],
        [0.22, 1.76, 0.8],
      ],
      [0.024, 0.02, 0.016, 0.012, 0.006],
      6,
    );
    tine(
      [
        [0.075, 1.42, 0.85],
        [0.085, 1.47, 0.93],
        [0.09, 1.53, 0.99],
      ],
      [0.016, 0.012, 0.005],
    );
    tine(
      [
        [0.11, 1.52, 0.8],
        [0.14, 1.6, 0.88],
        [0.15, 1.67, 0.93],
      ],
      [0.013, 0.01, 0.004],
    );
    tine(
      [
        [0.165, 1.63, 0.765],
        [0.2, 1.7, 0.83],
        [0.215, 1.76, 0.88],
      ],
      [0.012, 0.009, 0.004],
    );
    tine(
      [
        [0.2, 1.73, 0.79],
        [0.27, 1.77, 0.76],
        [0.3, 1.79, 0.73],
      ],
      [0.01, 0.008, 0.004],
    );
  }

  // The legs. Opposite corners step together, as a trotting deer's do.
  for (const s of SIDES) {
    const fore = s > 0 ? 0 : 1;
    const hind = s > 0 ? 1 : 0;

    const shoulder: Point = [s * 0.12, 0.8, 0.36];
    const wrist: Point = [s * 0.115, 0.46, 0.4];
    add(
      tube([shoulder, [s * 0.118, 0.62, 0.385], wrist], [0.088, 0.074, 0.052], {
        sides: 7,
        caps: 'end',
      }),
      { look: LOOK.coat, how: HOW.leg, group: fore, hip: shoulder },
    );
    const foreLower: Rig = {
      look: LOOK.coat,
      how: HOW.lowerLeg,
      group: fore,
      hip: shoulder,
      knee: wrist,
    };
    add(
      tube([wrist, [s * 0.113, 0.28, 0.39], [s * 0.11, 0.1, 0.37]], [0.05, 0.04, 0.034], {
        caps: 'none',
      }),
      foreLower,
    );
    add(ellipsoid([0.048, 0.05, 0.06], [s * 0.11, 0.05, 0.385], undefined, [7, 4]), {
      ...foreLower,
      look: LOOK.dark,
    });

    const haunch: Point = [s * 0.14, 0.84, -0.42];
    const hock: Point = [s * 0.125, 0.46, -0.5];
    add(
      tube([haunch, [s * 0.135, 0.66, -0.44], hock], [0.115, 0.09, 0.06], {
        sides: 8,
        caps: 'end',
      }),
      { look: LOOK.coat, how: HOW.leg, group: hind, hip: haunch },
    );
    const hindLower: Rig = {
      look: LOOK.coat,
      how: HOW.lowerLeg,
      group: hind,
      hip: haunch,
      knee: hock,
    };
    add(
      tube([hock, [s * 0.12, 0.28, -0.47], [s * 0.115, 0.1, -0.44]], [0.052, 0.042, 0.034], {
        caps: 'none',
      }),
      hindLower,
    );
    add(ellipsoid([0.048, 0.05, 0.06], [s * 0.115, 0.05, -0.455], undefined, [7, 4]), {
      ...hindLower,
      look: LOOK.dark,
    });
  }

  // The short white tail, which flags up when the stag is alarmed.
  add(ellipsoid([0.04, 0.085, 0.05], [0, 0.95, -0.65], [-0.6, 0, 0], [6, 4]), {
    look: LOOK.belly,
    how: HOW.limp,
    group: 0.9,
    hip: [0, 0.92, -0.6],
  });

  return weld(parts, 'stag', -0.27);
}

/**
 * The hare: about 0.7 long with the ears back and 0.3 tall at the back, with big haunches, big dark
 * eyes, long ears that stand when it is startled and a white scut. It hops: the front legs reach
 * and the hind legs push in turn.
 */
export function buildHare(): BufferGeometry {
  const { parts, add } = assembly();
  const neck: Point = [0, 0.2, 0.2];
  const body = (geometry: BufferGeometry, look: number = LOOK.coat): void =>
    add(geometry, { look });
  const head = (geometry: BufferGeometry, look: number = LOOK.coat): void =>
    add(geometry, { look, how: HOW.head, hip: neck });

  body(
    tube(
      [
        [0, 0.17, -0.27],
        [0, 0.2, -0.17],
        [0, 0.22, -0.02],
        [0, 0.21, 0.12],
        [0, 0.19, 0.22],
      ],
      [0.04, 0.09, 0.11, 0.085, 0.05],
      { sides: 8, squash: 1.05 },
    ),
  );
  for (const s of SIDES)
    body(ellipsoid([0.06, 0.1, 0.12], [s * 0.085, 0.155, -0.15], undefined, [8, 5]));

  head(
    tube(
      [
        [0, 0.2, 0.17],
        [0, 0.25, 0.27],
      ],
      [0.062, 0.055],
      { sides: 7, caps: 'none' },
    ),
  );
  head(ellipsoid([0.055, 0.058, 0.085], [0, 0.27, 0.28], [0.25, 0, 0], [8, 5]));
  head(ellipsoid([0.034, 0.032, 0.045], [0, 0.245, 0.345], [0.3, 0, 0], [6, 4]));
  head(ellipsoid([0.014, 0.012, 0.012], [0, 0.248, 0.385], undefined, [4, 3]), LOOK.dark);
  for (const s of SIDES) {
    head(ellipsoid([0.02, 0.025, 0.02], [s * 0.052, 0.29, 0.3], undefined, [6, 4]), LOOK.eye);
    // The long ears, laid back along the shoulders at rest and standing straight up when it is startled.
    const root: Point = [s * 0.032, 0.318, 0.235];
    add(
      tube([root, [s * 0.05, 0.385, 0.15], [s * 0.065, 0.44, 0.05]], [0.017, 0.031, 0.012], {
        sides: 6,
        squash: 0.35,
        ref: [1, 0, 0],
        caps: 'end',
      }),
      { look: LOOK.coat, how: HOW.limp, group: 0.9, hip: root, weight: true },
    );
  }

  for (const s of SIDES) {
    // The forelegs are thin and reach; the hind feet are long and push off.
    const shoulder: Point = [s * 0.045, 0.17, 0.17];
    const wrist: Point = [s * 0.045, 0.1, 0.19];
    const fore = s > 0 ? 0 : 0.12;
    add(tube([shoulder, wrist], [0.028, 0.022], { sides: 5, caps: 'none' }), {
      look: LOOK.coat,
      how: HOW.leg,
      group: fore,
      hip: shoulder,
    });
    const foreLower: Rig = {
      look: LOOK.coat,
      how: HOW.lowerLeg,
      group: fore,
      hip: shoulder,
      knee: wrist,
    };
    add(
      tube([wrist, [s * 0.045, 0.012, 0.2]], [0.02, 0.017], { sides: 5, caps: 'end' }),
      foreLower,
    );
    add(ellipsoid([0.02, 0.012, 0.035], [s * 0.045, 0.014, 0.215], undefined, [6, 3]), foreLower);

    const haunch: Point = [s * 0.085, 0.16, -0.15];
    const hock: Point = [s * 0.09, 0.08, -0.27];
    const hind = s > 0 ? 0.55 : 0.67;
    add(
      tube([haunch, [s * 0.09, 0.12, -0.22], hock], [0.05, 0.04, 0.028], {
        sides: 6,
        caps: 'none',
      }),
      {
        look: LOOK.coat,
        how: HOW.leg,
        group: hind,
        hip: haunch,
      },
    );
    const hindLower: Rig = {
      look: LOOK.coat,
      how: HOW.lowerLeg,
      group: hind,
      hip: haunch,
      knee: hock,
    };
    add(
      tube([hock, [s * 0.09, 0.04, -0.18], [s * 0.09, 0.014, -0.08]], [0.026, 0.022, 0.018], {
        sides: 5,
        caps: 'end',
      }),
      hindLower,
    );
    add(ellipsoid([0.022, 0.012, 0.05], [s * 0.09, 0.014, -0.14], undefined, [6, 3]), hindLower);
  }

  add(ellipsoid([0.038, 0.04, 0.04], [0, 0.2, -0.3], undefined, [6, 4]), {
    look: LOOK.belly,
    how: HOW.limp,
    group: 0.6,
    hip: [0, 0.2, -0.27],
  });

  return weld(parts, 'hare', -0.045);
}

/** The profile of the mossback's shell, from the underside up: a radius, as a part of the shell's own, and a height. */
const SHELL_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0.2],
  [0.84, 0.2],
  [1, 0.3],
  [0.98, 0.5],
  [0.82, 0.72],
  [0.55, 0.93],
  [0.25, 1.07],
  [0, 1.12],
];
const SHELL_AT = -0.08;
const SHELL_RADIUS: Point = [0.8, 1, 0.9];

/** How high the shell is at this place across it, to set the moss and the mushrooms on it. */
function shellHeight(x: number, z: number): number {
  const r = Math.hypot(x / SHELL_RADIUS[0], (z - SHELL_AT) / SHELL_RADIUS[2]);
  for (let i = 2; i < SHELL_PROFILE.length; i++) {
    const [rLow, yLow] = SHELL_PROFILE[i] as readonly [number, number];
    const [rHigh, yHigh] = SHELL_PROFILE[i - 1] as readonly [number, number];
    if (r <= rHigh && r >= rLow)
      return yHigh + ((yLow - yHigh) * (rHigh - r)) / (rHigh - rLow || 1);
  }
  return SHELL_PROFILE[SHELL_PROFILE.length - 1]?.[1] ?? 1;
}

/**
 * The mossback: a huge tortoise with a domed shell of plates that moss, little ferns and glowing
 * mushrooms grow on, a small heavy-lidded head on a thick neck, and stout legs. About 2.2 long with
 * the head out, 1.6 across the shell and 1.15 tall. Its head lowers to graze and bashes to strike.
 */
export function buildMossback(): BufferGeometry {
  const { parts, add } = assembly();
  const neck: Point = [0, 0.5, 0.78];
  const body = (geometry: BufferGeometry, look: number = LOOK.coat): void =>
    add(geometry, { look });
  const head = (geometry: BufferGeometry, look: number = LOOK.coat): void =>
    add(geometry, { look, how: HOW.head, hip: neck });

  add(lathe(SHELL_PROFILE, 16, [0, 0, SHELL_AT], SHELL_RADIUS), { look: LOOK.trim });

  // Moss cushions that grow over the plates, and a few mushrooms in them that glow in the dusk.
  const moss: readonly (readonly [number, number, number])[] = [
    [0.2, -0.05, 0.2],
    [-0.3, 0.3, 0.17],
    [0.34, -0.45, 0.16],
    [-0.18, -0.55, 0.19],
    [0.08, 0.5, 0.13],
  ];
  for (const [x, z, r] of moss) {
    body(
      ellipsoid([r, r * 0.45, r], [x, shellHeight(x, z) + 0.01, z], undefined, [8, 5]),
      LOOK.mark,
    );
  }
  const mushrooms: readonly (readonly [number, number, number])[] = [
    [0.24, -0.1, 1],
    [0.15, 0.02, 0.7],
    [-0.28, 0.26, 0.85],
  ];
  for (const [x, z, size] of mushrooms) {
    const y = shellHeight(x, z) + 0.05;
    body(
      tube(
        [
          [x, y, z],
          [x, y + 0.09 * size, z],
        ],
        [0.014 * size, 0.011 * size],
        { sides: 5, caps: 'none' },
      ),
      LOOK.belly,
    );
    body(
      ellipsoid(
        [0.045 * size, 0.026 * size, 0.045 * size],
        [x, y + 0.095 * size, z],
        undefined,
        [7, 4],
      ),
      LOOK.glow,
    );
  }

  // The head on its thick neck, with heavy lids over dark eyes and a long dark mouth.
  head(
    tube(
      [
        [0, 0.52, 0.7],
        [0, 0.5, 0.88],
        [0, 0.47, 1.0],
      ],
      [0.17, 0.15, 0.13],
      { sides: 8, caps: 'none' },
    ),
  );
  head(ellipsoid([0.15, 0.13, 0.19], [0, 0.47, 1.0], [0.1, 0, 0], [10, 6]));
  head(ellipsoid([0.085, 0.012, 0.11], [0, 0.405, 1.07], [0.1, 0, 0], [6, 3]), LOOK.dark);
  for (const s of SIDES) {
    head(ellipsoid([0.03, 0.032, 0.03], [s * 0.12, 0.505, 1.05], undefined, [6, 4]), LOOK.eye);
    head(ellipsoid([0.042, 0.022, 0.042], [s * 0.12, 0.535, 1.05], [0.15, 0, 0], [6, 3]));
    head(ellipsoid([0.01, 0.01, 0.01], [s * 0.032, 0.49, 1.18], undefined, [4, 3]), LOOK.dark);
  }

  // Four stout legs with broad feet, and a short tail.
  for (const s of SIDES) {
    for (const [z, rowGroup] of [
      [0.38, s > 0 ? 0 : 1],
      [-0.52, s > 0 ? 1 : 0],
    ] as const) {
      const hip: Point = [s * 0.55, 0.5, z];
      const rig: Rig = { look: LOOK.coat, how: HOW.leg, group: rowGroup, hip };
      add(
        tube([hip, [s * 0.58, 0.28, z + 0.01], [s * 0.6, 0.1, z + 0.03]], [0.19, 0.17, 0.16], {
          sides: 7,
          caps: 'end',
        }),
        rig,
      );
      add(ellipsoid([0.17, 0.07, 0.2], [s * 0.6, 0.05, z + 0.08], undefined, [8, 4]), rig);
    }
  }
  add(
    tube(
      [
        [0, 0.3, -0.95],
        [0, 0.26, -1.1],
      ],
      [0.07, 0.015],
      { sides: 6, caps: 'end' },
    ),
    { look: LOOK.coat, how: HOW.limp, group: 0.3, hip: [0, 0.3, -0.95] },
  );

  return weld(parts, 'mossback', -0.09);
}

/**
 * One fish of the shoal: a slim, tall-bodied silver fish about 0.45 long with a forked tail, a sail
 * of a dorsal fin and two pectoral fins. It swims by undulating from head to tail; its eye and the
 * bright stripe along its side are painted.
 */
export function buildShoal(): BufferGeometry {
  const { parts, add } = assembly();
  /** How far down the fish a point is, from its nose (0) to the tip of its tail (1.4), which is how far the swimming has bent it. */
  const aft = (_x: number, _y: number, z: number): number =>
    Math.min(Math.max((0.15 - z) / 0.32, 0), 1.4);
  const swim = (look: number): Rig => ({ look, how: HOW.spine, weight: aft });

  add(
    tube(
      [
        [0, 0.06, -0.17],
        [0, 0.065, -0.09],
        [0, 0.07, 0],
        [0, 0.07, 0.09],
        [0, 0.065, 0.15],
      ],
      [0.01, 0.028, 0.036, 0.03, 0.012],
      { sides: 6, squash: 1.45 },
    ),
    swim(LOOK.coat),
  );
  // The forked tail, in two lobes.
  add(
    leaf([
      [0, 0.08, -0.16],
      [0, 0.15, -0.27],
      [0, 0.065, -0.235],
      [0, 0.065, -0.16],
    ]),
    swim(LOOK.trim),
  );
  add(
    leaf([
      [0, 0.065, -0.16],
      [0, 0.065, -0.235],
      [0, -0.02, -0.27],
      [0, 0.05, -0.16],
    ]),
    swim(LOOK.trim),
  );
  add(
    leaf([
      [0, 0.1, 0.04],
      [0, 0.165, -0.01],
      [0, 0.16, -0.065],
      [0, 0.1, -0.09],
    ]),
    swim(LOOK.trim),
  );
  for (const s of SIDES) {
    add(
      leaf([
        [s * 0.03, 0.05, 0.07],
        [s * 0.1, 0.02, 0.025],
        [s * 0.09, 0.03, 0.01],
        [s * 0.03, 0.045, 0.035],
      ]),
      swim(LOOK.trim),
    );
  }
  return weld(parts, 'shoal', 0.06);
}

/**
 * The ray: a broad, swept-back disc of a body 2.2 across with a hump behind the eyes, two curled
 * lobes at the front and a long thin tail with a barb on it. Its wings ripple from the middle out;
 * it banks into its turns, and rears its tail up to sting.
 */
export function buildRay(): BufferGeometry {
  const { parts, add } = assembly();
  /** How far out toward the tip of a wing a point is. */
  const outward = (x: number): number => Math.min(Math.abs(x) / 1.1, 1);
  /** How far down the tail a point is, from where it leaves the body. */
  const down = (_x: number, _y: number, z: number): number =>
    Math.min(Math.max((-z - 0.5) / 1.45, 0), 1);
  const wing: Rig = { look: LOOK.coat, how: HOW.fin, weight: outward };

  // The disc: a sphere pressed flat, swept back at the tips, thick at the middle and a knife's edge at the rim.
  const sphere = new SphereGeometry(1, 20, 8);
  sphere.deleteAttribute('uv');
  sphere.deleteAttribute('normal');
  const disc = mergeVertices(sphere);
  sphere.dispose();
  const position = disc.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const ux = position.getX(i);
    const uy = position.getY(i);
    const uz = position.getZ(i);
    const edge = Math.abs(ux);
    const hump = uy > 0 ? 0.055 * Math.exp(-(ux * ux * 6 + uz * uz * 8)) : 0;
    position.setXYZ(
      i,
      ux * 1.1,
      0.16 + uy * (0.045 + 0.1 * (1 - edge) ** 1.2) + hump - 0.1 * edge * edge,
      uz * 0.66 * (1 - 0.5 * edge ** 1.4) - 0.38 * edge * edge,
    );
  }
  disc.computeVertexNormals();
  add(disc, wing);

  // The lobes at the front, curled in like a manta's.
  for (const s of SIDES) {
    add(
      tube(
        [
          [s * 0.3, 0.14, 0.5],
          [s * 0.35, 0.13, 0.64],
          [s * 0.31, 0.13, 0.76],
        ],
        [0.05, 0.036, 0.012],
        { sides: 6, squash: 0.6, caps: 'end' },
      ),
      wing,
    );
  }

  // The tail and its barb.
  const tail: Rig = {
    look: LOOK.coat,
    how: HOW.spine,
    group: 1,
    hip: [0, 0.14, -0.5],
    weight: down,
  };
  add(
    tube(
      [
        [0, 0.14, -0.5],
        [0, 0.13, -0.95],
        [0, 0.15, -1.5],
        [0, 0.19, -1.95],
      ],
      [0.07, 0.045, 0.025, 0.008],
      { sides: 6, caps: 'end' },
    ),
    tail,
  );
  add(
    leaf([
      [0, 0.14, -0.9],
      [0, 0.24, -1.0],
      [0, 0.145, -1.06],
    ]),
    { ...tail, look: LOOK.dark },
  );
  return weld(parts, 'ray');
}

/**
 * The lantern jelly: a glass-clear bell 0.8 across with a lantern of light inside it, four frilled
 * arms and eight trailing tentacles, about 0.9 tall from the tips of the tentacles to the crown. The
 * lantern, the arms and the tentacles are built before the bell, so the bell is drawn over them.
 */
export function buildJelly(): BufferGeometry {
  const { parts, add } = assembly();
  const heart: Point = [0, 0.5, 0];

  add(ellipsoid([0.15, 0.2, 0.15], [0, 0.62, 0], undefined, [10, 6]), {
    look: LOOK.glow,
    how: HOW.bell,
    hip: heart,
  });
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + 0.4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    add(
      tube(
        [
          [c * 0.05, 0.52, s * 0.05],
          [c * 0.1, 0.38, s * 0.1],
          [c * 0.07, 0.25, s * 0.14],
          [c * 0.02, 0.14, s * 0.1],
        ],
        [0.045, 0.04, 0.03, 0.012],
        { sides: 6, caps: 'end' },
      ),
      { look: LOOK.belly, how: HOW.tentacle, group: k * 1.3, weight: true },
    );
  }
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + 0.2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    add(
      tube(
        [
          [c * 0.31, 0.5, s * 0.31],
          [c * 0.3, 0.3, s * 0.3],
          [c * 0.26, 0.0, s * 0.26],
        ],
        [0.014, 0.01, 0.004],
        { sides: 4, caps: 'none' },
      ),
      { look: LOOK.trim, how: HOW.tentacle, group: k * 0.9, weight: true },
    );
  }

  // The bell, scalloped at its rim.
  const bell = lathe(
    [
      [0.96, 0.46],
      [1.04, 0.5],
      [0.98, 0.58],
      [0.84, 0.7],
      [0.62, 0.8],
      [0.34, 0.87],
      [0, 0.9],
    ],
    14,
    [0, 0, 0],
    [0.4, 1, 0.4],
  );
  const position = bell.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const rim = Math.min(Math.max((0.56 - position.getY(i)) / 0.1, 0), 1);
    const angle = Math.atan2(position.getZ(i), position.getX(i));
    position.setY(i, position.getY(i) - rim * 0.035 * (0.5 + 0.5 * Math.cos(8 * angle)));
  }
  add(bell, { look: LOOK.coat, how: HOW.bell, hip: heart });

  return weld(parts, 'jelly');
}

/**
 * The finch: a plump little bird about 0.2 long with a short beak, a forked tail and two blade-thin
 * wings 0.4 across that beat quickly. Its eye, its wing bar and its breast are painted.
 */
export function buildFinch(): BufferGeometry {
  const { parts, add } = assembly();
  /** How far out along a wing a point is. */
  const span = (x: number): number => Math.min(Math.abs(x) / 0.2, 1);
  const body = (geometry: BufferGeometry, look: number = LOOK.coat): void =>
    add(geometry, { look });

  body(
    tube(
      [
        [0, 0.1, -0.06],
        [0, 0.115, 0],
        [0, 0.115, 0.05],
        [0, 0.105, 0.085],
      ],
      [0.02, 0.048, 0.05, 0.03],
      { sides: 8, squash: 0.95 },
    ),
  );
  body(ellipsoid([0.037, 0.037, 0.04], [0, 0.145, 0.085], undefined, [8, 5]));
  body(
    tube(
      [
        [0, 0.14, 0.118],
        [0, 0.137, 0.148],
      ],
      [0.014, 0.003],
      { sides: 4, caps: 'start' },
    ),
    LOOK.dark,
  );
  body(
    tube(
      [
        [0, 0.11, -0.07],
        [0, 0.108, -0.17],
      ],
      [0.02, 0.036],
      { sides: 6, squash: 0.15, caps: 'end' },
    ),
    LOOK.trim,
  );
  for (const s of SIDES) {
    const shoulder: Point = [s * 0.03, 0.125, 0.03];
    add(
      tube([shoulder, [s * 0.1, 0.135, 0.01], [s * 0.2, 0.14, -0.04]], [0.04, 0.045, 0.02], {
        sides: 6,
        squash: 0.12,
        caps: 'end',
      }),
      { look: LOOK.coat, how: HOW.wing, side: s, hip: shoulder, weight: (x) => span(x) },
    );
  }
  return weld(parts, 'finch', 0, -0.07);
}

/**
 * The kite: a raptor with a pale head, a hooked beak and a fierce yellow eye, broad wings 1.5 across
 * with fingered tips, and a forked tail. It soars on stiff wings, beating them slowly, and sweeps them
 * back to dive. About 0.75 long.
 */
export function buildKite(): BufferGeometry {
  const { parts, add } = assembly();
  /** How far out along a wing a point is. */
  const span = (x: number): number => Math.min(Math.abs(x) / 0.78, 1);
  const body = (geometry: BufferGeometry, look: number = LOOK.coat): void =>
    add(geometry, { look });

  body(
    tube(
      [
        [0, 0.1, -0.25],
        [0, 0.11, -0.12],
        [0, 0.115, 0.02],
        [0, 0.115, 0.14],
        [0, 0.105, 0.22],
      ],
      [0.03, 0.075, 0.1, 0.085, 0.045],
      { sides: 8, squash: 0.95 },
    ),
  );
  body(ellipsoid([0.055, 0.06, 0.08], [0, 0.16, 0.27], [0.15, 0, 0], [8, 5]), LOOK.mark);
  body(
    tube(
      [
        [0, 0.15, 0.335],
        [0, 0.145, 0.4],
        [0, 0.11, 0.43],
      ],
      [0.03, 0.022, 0.006],
      { sides: 5, caps: 'start' },
    ),
    LOOK.dark,
  );
  for (const s of SIDES) {
    body(ellipsoid([0.02, 0.022, 0.02], [s * 0.05, 0.175, 0.3], undefined, [6, 4]), LOOK.eye);
    body(ellipsoid([0.032, 0.012, 0.04], [s * 0.05, 0.2, 0.295], [0.2, 0, 0], [6, 3]), LOOK.trim);
    // The talons, tucked under the belly.
    body(ellipsoid([0.018, 0.018, 0.05], [s * 0.04, 0.045, 0.12], undefined, [6, 3]), LOOK.dark);
    body(
      tube(
        [
          [s * 0.02, 0.1, -0.22],
          [s * 0.07, 0.1, -0.38],
          [s * 0.15, 0.1, -0.52],
        ],
        [0.045, 0.05, 0.05],
        { sides: 6, squash: 0.1, caps: 'end' },
      ),
      LOOK.trim,
    );
  }

  for (const s of SIDES) {
    const shoulder: Point = [s * 0.07, 0.13, 0.06];
    const wing: Rig = {
      look: LOOK.coat,
      how: HOW.wing,
      side: s,
      hip: shoulder,
      weight: (x) => span(x),
    };
    add(
      tube(
        [shoulder, [s * 0.3, 0.16, 0.02], [s * 0.55, 0.17, -0.05], [s * 0.75, 0.15, -0.17]],
        [0.14, 0.15, 0.11, 0.04],
        { sides: 6, squash: 0.09, caps: 'none' },
      ),
      wing,
    );
    // The long finger feathers at the tip, spread like a hand.
    for (let k = 0; k < 4; k++) {
      add(
        tube(
          [
            [s * (0.5 + 0.05 * k), 0.165, -0.06 - 0.01 * k],
            [s * (0.66 + 0.06 * k), 0.15, -0.26 - 0.05 * k],
          ],
          [0.035, 0.01],
          { sides: 4, squash: 0.1, caps: 'end' },
        ),
        { ...wing, look: LOOK.trim },
      );
    }
  }
  return weld(parts, 'kite', 0.07);
}

const BUILDERS = {
  [WILD_SPECIES.stag]: buildStag,
  [WILD_SPECIES.hare]: buildHare,
  [WILD_SPECIES.mossback]: buildMossback,
  [WILD_SPECIES.shoal]: buildShoal,
  [WILD_SPECIES.ray]: buildRay,
  [WILD_SPECIES.jelly]: buildJelly,
  [WILD_SPECIES.finch]: buildFinch,
  [WILD_SPECIES.kite]: buildKite,
} as const;

/** The model of a species, or undefined for a number the picture does not know. */
export function buildModel(species: number): BufferGeometry | undefined {
  return (BUILDERS as Record<number, (() => BufferGeometry) | undefined>)[species]?.();
}
