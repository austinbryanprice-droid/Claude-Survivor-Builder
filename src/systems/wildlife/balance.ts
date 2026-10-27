import type { Hitbox } from '../../shared/shot';
import { WILD_SPECIES_COUNT } from '../../shared/wildlife-state';

/**
 * The wildlife of the valley: eight species in three realms, none of which ever starts a fight.
 * Everything a species is (how big, how fast, how shy, where it lives, how many there are, and what
 * it does once a player has hurt it) is a row of this table, so the simulation, the drawing and the
 * tests read one set of numbers. A first guess to be tuned by playing (docs/decisions.md, Wildlife).
 *
 * The temper decides what a blow does. A **skittish** species has no way to hurt anyone: struck, it
 * runs, swims or flies away and keeps its distance from the one who struck it for a while. A
 * **defiant** one (the stag, the mossback, the ray, the kite) is hurt into anger instead: for a
 * while it goes for the one who hurt it, lands a few mild blows and gives up, and a player who walks
 * away from it is soon forgotten. Nothing here is aimed at a player who has not struck a creature,
 * and no creature takes any notice of a turret's shot or of the machines.
 */

export type Realm = 'land' | 'water' | 'air';

/** What a defiant species does to the player who hurt it. */
export interface Retaliation {
  /** Points of Health one blow takes off the player: a crawler's bite takes 6. */
  readonly player: number;
  /** Seconds from the start of a blow to its landing (the drawing shows the lunge), and between blows. */
  readonly windup: number;
  readonly interval: number;
  /** How close the player must be, across the ground, and how far above or below the creature's middle. */
  readonly reach: number;
  readonly height: number;
  /** It gives up on a player who gets farther than this from it. */
  readonly chase: number;
  /** Seconds it stays angry after the last blow it took, before it calms down. */
  readonly calm: number;
  /** Blows it lands before it has had enough. */
  readonly strikes: number;
}

export interface Species {
  readonly name: string;
  readonly realm: Realm;
  /** Points of Health: the blaster takes 10 off with a hit. */
  readonly health: number;
  /** Blocks a second when it goes about its day, and when it runs, swims or flies off or goes after someone. */
  readonly walk: number;
  readonly run: number;
  /** Radians a second it can turn. */
  readonly turnRate: number;
  /** The steepest slope it climbs (a rise over a run), for a creature of the land. */
  readonly climb: number;
  /** Its body as a disc, for the crowd: two creatures of a realm do not sit inside each other. */
  readonly radius: number;
  /** What a bolt meets, standing on its feet (a swimmer's or a flier's `y` is the underside of its body). */
  readonly hitbox: Hitbox;

  /** How many herds (or schools, flocks, singles) the valley holds, and how many make a herd. */
  readonly herds: number;
  readonly size: readonly [min: number, max: number];
  /** How far from the middle of its herd a creature goes about, in blocks. */
  readonly spread: number;
  /** Blocks a second the middle of a herd moves at, which is how a herd roams the valley. */
  readonly drift: number;
  /** Seconds a creature stands about between one walk and the next. */
  readonly pause: readonly [min: number, max: number];
  /** It is startled by a player nearer than this, or by a machine nearer than `scare`; 0 means it never is. */
  readonly shy: number;
  readonly scare: number;
  /** Seconds a skittish creature keeps away from the player who hurt it. */
  readonly fright: number;
  /** A flier circles the middle of its herd at about this radius; 0 for the ones that mill about instead. */
  readonly orbit: number;

  /** Where it lives. A land species keeps to ground this high above the water's surface, a swimmer to water this deep. */
  readonly above?: readonly [low: number, high: number];
  readonly depth?: number;
  /** A swimmer's body keeps this far under the surface (its top) and a flier's this far over the ground (its underside). */
  readonly level?: readonly [low: number, high: number];

  /** What it does to the player who hurt it; absent for a skittish species, which does nothing to anyone. */
  readonly retaliation?: Retaliation;
}

export const WILDLIFE = {
  /** The most creatures alive at once; the wire's packet holds this many. */
  maxAlive: 64,
  /** Seconds between the top-ups that bring back the herds the crew has thinned out. */
  topUpSeconds: 30,
  /** A new herd, or a replacement, comes in no nearer than this to any player, so nobody watches one arrive. */
  unseen: 42,
  /** Creatures keep this far from the middle of the Core: its clearing, its walls and the crew's work. */
  avoid: 24,
  /** ...and this far in from the edge of the valley. */
  margin: 6,
  /** A land creature keeps this far above the water's surface; nearer is the shore, where it does not go. */
  shore: 0.35,
  /** Seconds a creature goes on fleeing after the last thing that startled it. */
  alarmSeconds: 1.6,
  /** A creature that is startled turns this many times faster. */
  alarmTurn: 1.8,
  /** While it is afraid of the player who hurt it, a skittish creature keeps this far from them. */
  attackerRadius: 28,
  /** Seconds the flash of a blow lasts. */
  hurtFlashSeconds: 0.25,
  /** A creature that has been blocked this long stops trying and picks something else to do. */
  stuckSeconds: 1.2,
  /** A creature turned this far from where it is going stands and turns before it walks. */
  turnFirst: 1.3,
  /** A creature farther than this many spreads from its herd hurries back to it, at this multiple of its walk. */
  strayAt: 2.2,
  hurry: 1.6,
  /** Overlapping creatures of a realm push each other this part of the way apart each step, no more than `crowdMax` blocks. */
  crowdPush: 0.4,
  crowdMax: 0.03,
  /** A herd's middle picks its next way this far off, and tries this many times before it stands still a moment. */
  legs: { land: [14, 32], water: [10, 24], air: [40, 90] } as const,
  legTries: 8,
  /** How many tries it takes to find a spot to put a herd, and how level the ground there must be. */
  spotTries: 400,
  flatWithin: 3,
} as const;

/** The species, by the number that travels. */
export const SPECIES: readonly Species[] = [
  // WILD_SPECIES.stag
  {
    name: 'stag',
    realm: 'land',
    health: 60,
    walk: 1.3,
    run: 6.5,
    turnRate: 3.5,
    climb: 0.9,
    radius: 0.5,
    hitbox: { halfWidth: 0.7, height: 1.5 },
    herds: 2,
    size: [3, 4],
    spread: 9,
    drift: 0.35,
    pause: [3, 9],
    shy: 11,
    scare: 16,
    fright: 0,
    orbit: 0,
    above: [2, 14],
    retaliation: {
      player: 7,
      windup: 0.5,
      interval: 1.6,
      reach: 2.2,
      height: 1.8,
      chase: 26,
      calm: 14,
      strikes: 4,
    },
  },
  // WILD_SPECIES.hare
  {
    name: 'hare',
    realm: 'land',
    health: 14,
    walk: 1,
    run: 8.5,
    turnRate: 9,
    climb: 1.3,
    radius: 0.3,
    hitbox: { halfWidth: 0.36, height: 0.55 },
    herds: 3,
    size: [2, 3],
    spread: 6,
    drift: 0.4,
    pause: [1.2, 4.5],
    shy: 8,
    scare: 14,
    fright: 10,
    orbit: 0,
    above: [1, 24],
  },
  // WILD_SPECIES.mossback
  {
    name: 'mossback',
    realm: 'land',
    health: 120,
    walk: 0.9,
    run: 2.6,
    turnRate: 1.6,
    climb: 0.7,
    radius: 1,
    hitbox: { halfWidth: 1.1, height: 1.3 },
    herds: 2,
    size: [1, 2],
    spread: 5,
    drift: 0.2,
    pause: [4, 11],
    shy: 0,
    scare: 7,
    fright: 0,
    orbit: 0,
    above: [0.5, 8],
    retaliation: {
      player: 9,
      windup: 0.8,
      interval: 2.2,
      reach: 2.4,
      height: 1.6,
      chase: 22,
      calm: 16,
      strikes: 3,
    },
  },
  // WILD_SPECIES.shoal
  {
    name: 'shoal',
    realm: 'water',
    health: 6,
    walk: 1.4,
    run: 4.5,
    turnRate: 7,
    climb: 0,
    radius: 0.22,
    hitbox: { halfWidth: 0.3, height: 0.3 },
    herds: 2,
    size: [6, 8],
    spread: 3.5,
    drift: 0.9,
    pause: [0, 0.3],
    shy: 5,
    scare: 0,
    fright: 6,
    orbit: 0,
    depth: 1.4,
    level: [0.5, 1],
  },
  // WILD_SPECIES.ray
  {
    name: 'ray',
    realm: 'water',
    health: 70,
    walk: 1.1,
    run: 3,
    turnRate: 1.4,
    climb: 0,
    radius: 1,
    hitbox: { halfWidth: 1.2, height: 0.45 },
    herds: 2,
    size: [1, 1],
    spread: 10,
    drift: 0.8,
    pause: [0, 0],
    shy: 0,
    scare: 8,
    fright: 0,
    orbit: 0,
    depth: 2.4,
    level: [0.9, 1.5],
    retaliation: {
      player: 6,
      windup: 0.5,
      interval: 1.8,
      reach: 2.8,
      height: 3,
      chase: 24,
      calm: 12,
      strikes: 3,
    },
  },
  // WILD_SPECIES.jelly
  {
    name: 'jelly',
    realm: 'water',
    health: 20,
    walk: 0.5,
    run: 2.4,
    turnRate: 1.8,
    climb: 0,
    radius: 0.45,
    hitbox: { halfWidth: 0.42, height: 0.9 },
    herds: 2,
    size: [2, 3],
    spread: 4,
    drift: 0.25,
    pause: [1.5, 5],
    shy: 3,
    scare: 6,
    fright: 7,
    orbit: 0,
    depth: 2.2,
    level: [0.35, 0.9],
  },
  // WILD_SPECIES.finch
  {
    name: 'finch',
    realm: 'air',
    health: 6,
    walk: 5.5,
    run: 8,
    turnRate: 5,
    climb: 0,
    radius: 0.18,
    hitbox: { halfWidth: 0.27, height: 0.3 },
    herds: 2,
    size: [4, 6],
    spread: 5,
    drift: 3.5,
    pause: [0, 0],
    shy: 10,
    scare: 18,
    fright: 12,
    orbit: 5,
    level: [4, 8],
  },
  // WILD_SPECIES.kite
  {
    name: 'kite',
    realm: 'air',
    health: 50,
    walk: 4,
    run: 7,
    turnRate: 1.8,
    climb: 0,
    radius: 0.6,
    hitbox: { halfWidth: 0.8, height: 0.5 },
    herds: 2,
    size: [1, 1],
    spread: 14,
    drift: 3,
    pause: [0, 0],
    shy: 0,
    scare: 0,
    fright: 0,
    orbit: 14,
    level: [12, 20],
    retaliation: {
      player: 5,
      windup: 0.4,
      interval: 2,
      reach: 2,
      height: 1.5,
      chase: 40,
      calm: 12,
      strikes: 3,
    },
  },
];

/** The species numbered `species`, or undefined for one this table does not know. */
export function speciesOf(species: number): Species | undefined {
  return species >= 0 && species < WILD_SPECIES_COUNT ? SPECIES[species] : undefined;
}

/** What a bolt meets of a creature of this species, or undefined for one this table does not know. */
export function wildHitboxOf(species: number): Hitbox | undefined {
  return speciesOf(species)?.hitbox;
}

/** The names by number, for the tests and the debug page. */
export const SPECIES_NAMES: readonly string[] = SPECIES.map((s) => s.name);
