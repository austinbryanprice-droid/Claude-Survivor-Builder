/**
 * The intro film's sound: what is heard when, in seconds from the film's first frame, as data. The
 * film's picture is a function of its clock, and so is its sound: a list of cues (a hit, a creak, a
 * note) that start at a second, and a few beds (the roar of the fall, the grinding of the skid, the
 * wind) that run for a stretch with their loudness drawn as a curve. Nothing here touches the
 * browser. The engine's synth (`engine/audio`) turns a cue into the noise it names, and the tests
 * and the offline renderer read the same script as the player's film does.
 *
 * The music is in D, minor while the night lasts and major with the dawn: a low drone and a pad
 * under the fall, silence and a few bell notes in the crater, a pulse that quickens as the machines
 * wake, and then G, A and D as the sun comes up and the title arrives. Each cue that goes with
 * something on the screen takes its time from the script of the picture (`intro.ts`), so the two
 * cannot drift apart when one is retimed.
 */
import { dbToGain, lerp, lerpLog, noteHz } from './audio';
import { createRng } from './hash';
import {
  BURN_UNTIL,
  CORE_PULSES,
  CRAWLER_RISES,
  INTRO_SECONDS,
  REVEAL_AT,
  STOP_AT,
  TITLE_WINDOW,
  TOUCHDOWN_AT,
  coreGlowAt,
  sceneTime,
  smoothstep01,
} from './intro';

/** Seconds after the picture ends that the sound is let ring out, into the first moments of play. */
export const TAIL_SECONDS = 3.6;
/** When the last of the film's sound has died away. */
export const SOUND_SECONDS = INTRO_SECONDS + TAIL_SECONDS;

export type VoiceName =
  | 'boom'
  | 'thud'
  | 'clang'
  | 'groan'
  | 'steam'
  | 'tick'
  | 'crackle'
  | 'ping'
  | 'whoom'
  | 'servo'
  | 'blip'
  | 'rumble'
  | 'step'
  | 'pluck'
  | 'pad'
  | 'timp'
  | 'heart'
  | 'riser'
  | 'breath'
  | 'duck';

/** One sound that starts at a second of the film. What each field means is up to the voice that plays it. */
export interface Cue {
  /** Seconds from the film's first frame at which it starts. */
  readonly at: number;
  readonly voice: VoiceName;
  /** Decibels above the voice's own nominal level (0), which the mix is set against. */
  readonly level: number;
  /** Pitch in Hz, or the centre of the band for a noise. */
  readonly hz?: number;
  /** Where a glide or a sweep ends, in Hz. */
  readonly to?: number;
  /** How long it is held or lasts, in seconds, for the voices that have a length. */
  readonly seconds?: number;
  /** Seconds a held note takes to come up to full, and to fade after it is let go. */
  readonly attack?: number;
  readonly release?: number;
  /** -1 is hard left and 1 hard right. */
  readonly pan?: number;
  /** How much of it goes to the reverb, from 0 to 1; each voice has its own habit. */
  readonly send?: number;
  /** Fixes the little differences between two plays of the same voice (which part of the noise, how far a partial is detuned). */
  readonly seed: number;
}

/**
 * The mixing board: decibels added to every cue of a voice, so that the numbers in the score are
 * about the music and the picture and the balance between the kinds of sound is set in one place.
 * Full volume is meant to peak a little under the top, with the hit of the touchdown the loudest
 * thing in the film and the crater and the waking the quietest.
 */
const FADERS: Readonly<Record<VoiceName, number>> = {
  boom: -3,
  thud: -4,
  clang: -4,
  groan: -4,
  steam: -2,
  tick: 0,
  crackle: 0,
  ping: -3,
  whoom: -9,
  servo: 0,
  blip: 0,
  rumble: -4,
  step: 0,
  pluck: -3,
  pad: -5,
  timp: -9,
  heart: -8,
  riser: 0,
  breath: 0,
  duck: 0,
};

const SEED = 0x1d7a50c1;

const CRATER_AT = sceneTime('crater', 0);
const EYES_AT = sceneTime('eyes', 0);
const DAWN_AT = sceneTime('dawn', 0);

/** Writes the score. It draws its little differences (when a fire snaps, how loud a thud is) from a seeded generator, so each call gives the same film. */
export function buildIntroCues(): readonly Cue[] {
  const rng = createRng(SEED);
  const between = (from: number, to: number): number => from + (to - from) * rng();
  const cues: Cue[] = [];
  const add = (at: number, voice: VoiceName, level: number, rest: Partial<Cue> = {}): void => {
    cues.push({
      at,
      voice,
      level: level + FADERS[voice],
      seed: Math.floor(rng() * 0x7fffffff),
      ...rest,
    });
  };

  /** A chord of held pad notes; `level` is the whole chord's, shared out among its notes. */
  const chord = (
    at: number,
    seconds: number,
    notes: readonly string[],
    level: number,
    shape: { attack?: number; release?: number; pan?: number } = {},
  ): void => {
    const each = level - 10 * Math.log10(notes.length);
    for (const name of notes) {
      const hz = noteHz(name);
      // The ear is slow to hear the lowest notes, so they are given a little more.
      add(at, 'pad', each + (hz < 100 ? 2.5 : 0), { hz, seconds, ...shape });
    }
  };

  /** Events at random moments between two seconds, `perSecond` of them a second on average, each handed its time. */
  const scatter = (
    from: number,
    to: number,
    perSecond: number,
    visit: (at: number) => void,
  ): void => {
    let at = from;
    for (;;) {
      at += -Math.log(1 - rng()) / perSecond;
      if (at >= to) return;
      visit(at);
    }
  };

  // --- The fall (0 to 8): the hull stresses and sheds plates, a dark chord swells and a pulse quickens ---
  add(1.6, 'groan', -8, { hz: 118, to: 96, seconds: 2.0, pan: -0.3 });
  add(3.9, 'groan', -6, { hz: 104, to: 84, seconds: 2.4, pan: 0.4 });
  add(5.6, 'groan', -4, { hz: 150, to: 108, seconds: 1.6, pan: -0.2 });
  for (const [at, hz, level, pan] of [
    [2.8, 3100, -17, 0.5],
    [4.4, 2500, -16, -0.4],
    [5.0, 3900, -15, 0.3],
    [6.1, 2800, -13, -0.5],
    [6.8, 3300, -12, 0.4],
  ] as const) {
    add(at, 'tick', level, { hz, pan });
  }
  add(4.9, 'clang', -18, { hz: 310, pan: 0.5 });
  add(6.4, 'clang', -14, { hz: 262, pan: -0.4 });

  chord(3.2, 4.5, ['D2', 'A2', 'D3', 'F3'], -9, { attack: 3.2, release: 0.15 });
  add(5.5, 'pad', -17, { hz: noteHz('A4'), seconds: 2.3, attack: 2.0, release: 0.15 });
  add(6.8, 'pad', -19, { hz: noteHz('Bb4'), seconds: 1.0, attack: 1.0, release: 0.15 });
  [5.8, 6.4, 6.93, 7.38, 7.72].forEach((at, i) => {
    add(at, 'heart', -12 + i * 2, { hz: 55 });
  });
  add(6.0, 'riser', -10, { hz: 350, to: 5200, seconds: 1.86 });
  // The breath before the hit: the whole mix drops away for the last moment of the fall.
  const HOLD_FROM = TOUCHDOWN_AT - 0.22;
  add(HOLD_FROM, 'duck', -26, { seconds: TOUCHDOWN_AT - HOLD_FROM });

  // --- The skid (8 to 14.5): the touchdown, the wreck tearing through the trees, coming to rest ---
  add(TOUCHDOWN_AT, 'boom', 0, { seconds: 3.6 });
  add(TOUCHDOWN_AT + 0.02, 'clang', -3, { hz: 148 });
  add(TOUCHDOWN_AT + 0.2, 'clang', -7, { hz: 205, pan: -0.3 });
  add(TOUCHDOWN_AT + 0.42, 'clang', -10, { hz: 330, pan: 0.35 });
  scatter(TOUCHDOWN_AT + 0.05, TOUCHDOWN_AT + 1.8, 7, (at) => {
    add(at, 'crackle', between(-11, -3), { hz: between(600, 1500), pan: between(-0.8, 0.8) });
  });
  scatter(TOUCHDOWN_AT + 0.4, STOP_AT - 0.2, 3.2, (at) => {
    add(at, 'thud', between(-17, -8), { hz: between(55, 105), pan: between(-0.7, 0.7) });
  });
  scatter(TOUCHDOWN_AT + 0.6, STOP_AT - 0.4, 1.1, (at) => {
    add(at, 'clang', between(-23, -15), { hz: between(170, 420), pan: between(-0.7, 0.7) });
  });
  scatter(TOUCHDOWN_AT + 0.3, STOP_AT, 3.4, (at) => {
    add(at, 'tick', between(-25, -16), { hz: between(2200, 4800), pan: between(-0.8, 0.8) });
  });
  // The wreck stops: one last great metal sound, a groan as it settles, steam venting from the hull.
  add(STOP_AT, 'clang', -2, { hz: 96 });
  add(STOP_AT + 0.05, 'thud', -4, { hz: 52 });
  add(STOP_AT + 0.1, 'groan', -5, { hz: 82, to: 54, seconds: 2.6, pan: 0.1 });
  add(STOP_AT + 0.35, 'steam', -9, { seconds: 2.8, pan: -0.3 });
  add(STOP_AT + 1.0, 'steam', -13, { seconds: 2.0, pan: 0.5, hz: 4200 });
  // The Core is uncovered, and its light goes out across the crater each time it pulses.
  const PING_NOTES = ['A5', 'A5', 'A5', 'D6'] as const;
  CORE_PULSES.forEach((at, i) => {
    add(at, 'whoom', [-2, -5, -5, -3][i] ?? -4, { hz: noteHz('D2') });
    add(at + 0.02, 'ping', [-7, -9, -9, -6][i] ?? -8, { hz: noteHz(PING_NOTES[i] ?? 'A5') });
  });
  for (const [at, hz, level, pan] of [
    [12.9, 3400, -18, -0.4],
    [13.4, 2700, -17, 0.5],
    [14.0, 4000, -19, 0.1],
  ] as const) {
    add(at, 'tick', level, { hz, pan });
  }
  chord(12.9, 2.2, ['D3', 'A3', 'E4'], -17, { attack: 1.4, release: 1.5 });
  add(13.45, 'pluck', -21, { hz: noteHz('A5'), seconds: 2.0, pan: 0.2 });
  add(13.8, 'pluck', -22, { hz: noteHz('F5'), seconds: 2.0, pan: -0.2 });
  add(14.15, 'pluck', -22, { hz: noteHz('D6'), seconds: 2.0, pan: 0.3 });

  // --- The crater (14.5 to 22.5): quiet, a few bell notes over a held chord, steam and cooling metal ---
  chord(CRATER_AT, EYES_AT - CRATER_AT - 0.1, ['D2', 'A2', 'D3', 'F3', 'A3'], -15, {
    attack: 2.4,
    release: 2.0,
  });
  for (const [at, note] of [
    [15.3, 'A4'],
    [16.4, 'F4'],
    [17.5, 'D4'],
    [19.0, 'E4'],
    [20.0, 'F4'],
    [21.05, 'A4'],
    [22.0, 'G4'],
  ] as const) {
    add(at, 'pluck', -14, { hz: noteHz(note), seconds: 2.4 });
  }
  add(15.0, 'steam', -15, { hz: 3000, seconds: 2.0, pan: 0.3 });
  add(18.4, 'steam', -15, { hz: 3600, seconds: 1.8, pan: -0.4 });
  add(20.6, 'steam', -17, { hz: 3200, seconds: 1.6, pan: 0.2 });
  scatter(CRATER_AT + 0.3, EYES_AT - 0.3, 0.8, (at) => {
    add(at, 'tick', between(-27, -20), { hz: between(2300, 4500), pan: between(-0.8, 0.8) });
  });
  // Something far off in the wreck stirs, a moment before the night turns on it.
  add(21.2, 'groan', -10, { hz: 62, to: 92, seconds: 2.0, pan: 0.5 });

  // --- The eyes (22.5 to 29.5): the machines wake one by one, a pulse quickens, a riser climbs to the cut ---
  chord(EYES_AT + 0.1, 3.6, ['Bb1', 'F2', 'Bb2', 'D3', 'F3', 'A3'], -14, {
    attack: 1.6,
    release: 0.9,
  });
  chord(26.2, DAWN_AT - 0.25 - 26.2, ['G1', 'D2', 'G2', 'Bb2', 'D3', 'G3'], -13, {
    attack: 1.4,
    release: 0.25,
  });
  const CRAWLER_PAN = [-0.45, 0.3, -0.1, 0.55, 0.05] as const;
  const CRAWLER_SPEED = [0.9, 1.05, 0.85, 1.1, 0.95] as const;
  CRAWLER_RISES.forEach((rise, i) => {
    const pan = CRAWLER_PAN[i] ?? 0;
    // The ground gives way, a plate scrapes, a servo winds up, and an eye lights.
    add(rise, 'rumble', -8, { seconds: 1.0, pan });
    add(rise + 0.12, 'clang', -21, { hz: 120 + 14 * i, pan });
    add(rise + 0.38, 'servo', -15, { hz: 140 + 22 * i, to: 380 + 30 * i, seconds: 0.6, pan });
    add(rise + 0.68, 'blip', -17, { hz: 1000 + 110 * i, pan });
    // Then it walks toward the Core, nearer and louder as the scene goes on.
    let at = rise + 0.7;
    const stride = 0.62 / (CRAWLER_SPEED[i] ?? 1);
    while (at < DAWN_AT - 0.35) {
      const near = Math.min(1, Math.max(0, (at - 23.5) / 5.7));
      add(at, 'step', lerp(-27, -17, near), { hz: 110 + 15 * i, pan });
      at += stride * between(0.92, 1.08);
    }
  });
  // A pulse that comes faster and harder until the cut: soft hearts, then drum hits.
  {
    let at = 24.1;
    let gap = 1.05;
    let n = 0;
    while (at < DAWN_AT - 0.25) {
      const level = lerp(-14, -4, Math.min(1, n / 6));
      if (gap > 0.62) add(at, 'heart', level, { hz: 55 });
      else add(at, 'timp', level - 6, { hz: noteHz('D2') });
      at += gap;
      gap *= 0.9;
      n++;
    }
  }
  add(26.8, 'riser', -9, { hz: 300, to: 6500, seconds: 2.5 });
  add(27.0, 'pad', -17, { hz: noteHz('A4'), seconds: 2.2, attack: 2.2, release: 0.2 });

  // --- The dawn (29.5 to 38): G, A, and D as the title arrives, then bells over D, A and B minor ---
  const BEAT = 0.55;
  const BAR = 4 * BEAT;
  const arrival = TITLE_WINDOW.from;
  chord(arrival - BAR, 2 * BEAT, ['G2', 'D3', 'G3', 'B3', 'D4'], -13, {
    attack: 0.7,
    release: 0.5,
  });
  chord(arrival - 2 * BEAT, 2 * BEAT, ['A2', 'E3', 'A3', 'C#4', 'E4'], -12, {
    attack: 0.35,
    release: 0.5,
  });
  add(arrival - 2 * BEAT, 'timp', -9, { hz: noteHz('E2') });
  add(arrival - BEAT, 'timp', -8, { hz: noteHz('E2') });
  add(arrival - 2.1, 'riser', -16, { hz: 1500, to: 9000, seconds: 2.1 });
  add(arrival, 'boom', -8, { seconds: 2.8 });
  add(arrival, 'timp', -3, { hz: noteHz('D2') });
  chord(arrival, BAR, ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'], -10, { attack: 0.25, release: 0.4 });
  chord(arrival + BAR, BAR, ['A1', 'E2', 'A3', 'C#3', 'E3', 'A2'], -11, {
    attack: 0.3,
    release: 0.4,
  });
  chord(arrival + 2 * BAR, BAR, ['B1', 'F#2', 'B2', 'D3', 'F#3', 'B3'], -11, {
    attack: 0.3,
    release: 0.4,
  });
  add(arrival + BAR, 'timp', -10, { hz: noteHz('A1') });
  add(arrival + 2 * BAR, 'timp', -10, { hz: noteHz('B1') });
  for (const [i, note] of ['D5', 'F#5', 'A5', 'D6'].entries()) {
    add(arrival + 0.04 * i, 'pluck', -15 - i, {
      hz: noteHz(note),
      seconds: 2.4,
      pan: 0.2 * (i - 1.5),
    });
  }
  add(arrival, 'ping', -12, { hz: noteHz('D6') });

  // --- The waking (38 to 43.5): G, then D, with the heart of the survivor under the bells ---
  const woken = arrival + 3 * BAR;
  chord(woken, BAR, ['G1', 'D2', 'G2', 'B2', 'D3', 'G3'], -11, { attack: 0.5, release: 0.6 });
  add(woken, 'timp', -12, { hz: noteHz('G1') });
  const home = woken + BAR;
  chord(
    home,
    INTRO_SECONDS - 0.2 - home,
    ['D1', 'A1', 'D2', 'A2', 'D3', 'F#3', 'A3', 'D4', 'E4'],
    -8,
    {
      attack: 0.5,
      release: 2.8,
    },
  );
  add(home, 'timp', -6, { hz: noteHz('D2') });
  add(home, 'ping', -12, { hz: noteHz('D6') });
  [38.3, 38.62, 39.18, 39.5, 40.06, 40.38].forEach((at, i) => {
    add(at, 'heart', [-8, -11, -9, -12, -11, -14][i] ?? -10, { hz: 52 });
  });
  add(38.75, 'breath', -24, { hz: 1700, seconds: 1.4 });
  add(40.35, 'breath', -26, { hz: 1500, seconds: 1.6 });

  // Bells in eighth notes over the dawn chords, arriving with the title and thinning as the film ends.
  const PATTERN = [0, 2, 1, 2, 3, 2, 1, 2] as const;
  const BARS: readonly (readonly [number, readonly string[]])[] = [
    [arrival, ['D5', 'F#5', 'A5', 'D6']],
    [arrival + BAR, ['E5', 'A5', 'C#6', 'E6']],
    [arrival + 2 * BAR, ['F#5', 'B5', 'D6', 'F#6']],
    [woken, ['D5', 'G5', 'B5', 'D6']],
    [home, ['D5', 'F#5', 'A5', 'D6']],
  ];
  for (const [start, tones] of BARS) {
    for (let k = 0; k < 8; k++) {
      const at = start + k * (BEAT / 2) + between(-0.008, 0.008);
      if (at < arrival + BEAT || at > INTRO_SECONDS - 0.6) continue;
      // Up to full over the first bar, and away over the last two seconds.
      const fade =
        Math.min(1, (at - arrival) / BAR) * (1 - smoothstep01((at - (INTRO_SECONDS - 2.6)) / 2.2));
      const note = tones[PATTERN[k] ?? 0] as string;
      add(at, 'pluck', lerp(-27, -14, fade) + (k % 4 === 0 ? 2.5 : 0) + between(-1.5, 1.5), {
        hz: noteHz(note),
        seconds: 1.6,
        pan: k % 2 === 0 ? -0.25 : 0.25,
      });
    }
  }

  // --- Fire, all along: the small fires of the wreck crackle until the sun is up ---
  const burnRate = (t: number): number => {
    if (t < CRATER_AT) return 9;
    if (t < EYES_AT) return 6;
    if (t < DAWN_AT) return 3.5;
    return lerp(3, 0.3, Math.min(1, (t - DAWN_AT) / (BURN_UNTIL - DAWN_AT)));
  };
  for (let t = REVEAL_AT + 0.2; t < BURN_UNTIL;) {
    t += -Math.log(1 - rng()) / burnRate(t);
    if (t >= BURN_UNTIL) break;
    const pop = rng() < 0.12;
    add(t, 'crackle', pop ? between(-14, -9) : between(-27, -17), {
      hz: between(pop ? 700 : 1100, pop ? 1800 : 3300),
      pan: between(-0.8, 0.8),
    });
  }

  return cues.sort((a, b) => a.at - b.at);
}

/** Every cue of the film, in the order they start. */
export const INTRO_CUES: readonly Cue[] = buildIntroCues();

export type BedName = 'roar' | 'grind' | 'wind' | 'drone' | 'hum';

/** A sound that runs for a stretch of the film with its loudness and tone drawn as curves. */
export interface BedScore {
  /** When it starts and when it is over; its curves are read between. */
  readonly from: number;
  readonly to: number;
  /** How loud it is at `t`, from 0 to 1 (1 is the bed's own full level). */
  readonly gain: (t: number) => number;
  /** Its character at `t`, in Hz: the middle of the band for a noise, the pitch for a tone, the cutoff of the filter that darkens it. */
  readonly tone: (t: number) => number;
  /** A second control some beds use, in Hz (how fast the grinding flutters). */
  readonly rate?: (t: number) => number;
}

/** A line through `points` (seconds, value), flat before the first and after the last. */
function line(points: readonly (readonly [number, number])[]): (t: number) => number {
  return (t) => {
    const first = points[0] as readonly [number, number];
    if (t <= first[0]) return first[1];
    for (let i = 1; i < points.length; i++) {
      const [t1, v1] = points[i] as readonly [number, number];
      if (t <= t1) {
        const [t0, v0] = points[i - 1] as readonly [number, number];
        return t1 > t0 ? lerp(v0, v1, (t - t0) / (t1 - t0)) : v1;
      }
    }
    return (points[points.length - 1] as readonly [number, number])[1];
  };
}

/** The same through points whose values are Hz, joined by the curve that changes by the same ratio each second. */
function lineLog(points: readonly (readonly [number, number])[]): (t: number) => number {
  return (t) => {
    const first = points[0] as readonly [number, number];
    if (t <= first[0]) return first[1];
    for (let i = 1; i < points.length; i++) {
      const [t1, v1] = points[i] as readonly [number, number];
      if (t <= t1) {
        const [t0, v0] = points[i - 1] as readonly [number, number];
        return t1 > t0 ? lerpLog(v0, v1, (t - t0) / (t1 - t0)) : v1;
      }
    }
    return (points[points.length - 1] as readonly [number, number])[1];
  };
}

/** A curve turned down by `db` decibels: the faders of the beds, set where each bed is drawn. */
function fader(db: number, curve: (t: number) => number): (t: number) => number {
  const gain = dbToGain(db);
  return (t) => curve(t) * gain;
}

/** How loudly the Core hums, as a share of full: it follows its own glow on the screen. */
const HUM_SHARE = 0.55;
/** The hum is started a moment before the Core is uncovered, and comes up over this many seconds since the glow itself arrives at once. */
const HUM_FROM = REVEAL_AT - 0.04;
const HUM_RISE = 0.12;
/** The third in the Core's chord: F in the night, F sharp in the morning, gliding as the sun comes up. */
const THIRD_FROM = noteHz('F3');
const THIRD_TO = noteHz('F#3');
const THIRD_AT = sceneTime('dawn', 0.5);
const THIRD_FOR = 3;

export const INTRO_BEDS: Readonly<Record<BedName, BedScore>> = {
  // The air screaming past the reactor as it falls: a band of noise that climbs and swells, gone as it lands.
  roar: {
    from: 3,
    to: TOUCHDOWN_AT + 1.4,
    gain: fader(
      -8,
      line([
        [3, 0],
        [3.5, 0.05],
        [5.5, 0.18],
        [7, 0.42],
        [TOUCHDOWN_AT - 0.14, 0.6],
        [TOUCHDOWN_AT, 0.6],
        [TOUCHDOWN_AT + 1.4, 0],
      ]),
    ),
    tone: lineLog([
      [3, 160],
      [5.5, 700],
      [7, 1500],
      [TOUCHDOWN_AT - 0.1, 2600],
      [TOUCHDOWN_AT + 1.4, 500],
    ]),
  },
  // The wreck dragging itself through the valley: scraping metal that flutters and slows as the speed drops.
  grind: {
    from: TOUCHDOWN_AT - 0.05,
    to: STOP_AT + 0.6,
    gain: fader(
      -8,
      line([
        [TOUCHDOWN_AT - 0.05, 0],
        [TOUCHDOWN_AT + 0.03, 0.8],
        [10.5, 0.7],
        [12, 0.35],
        [STOP_AT, 0.2],
        [STOP_AT + 0.6, 0],
      ]),
    ),
    tone: lineLog([
      [TOUCHDOWN_AT, 1700],
      [10, 900],
      [STOP_AT, 300],
    ]),
    rate: line([
      [TOUCHDOWN_AT, 14],
      [STOP_AT, 3],
    ]),
  },
  // Air moving over the valley, higher and nearer as the film goes on, and still blowing as the game begins.
  wind: {
    from: 0.8,
    to: SOUND_SECONDS,
    gain: fader(
      0,
      line([
        [0.8, 0],
        [3.5, 0.03],
        [7.8, 0.07],
        [TOUCHDOWN_AT + 0.1, 0.02],
        [STOP_AT, 0.02],
        [14.5, 0.05],
        [22.5, 0.05],
        [29.3, 0.03],
        [30.5, 0.06],
        [35, 0.09],
        [38.5, 0.11],
        [INTRO_SECONDS, 0.12],
        [SOUND_SECONDS - 0.2, 0],
      ]),
    ),
    tone: line([
      [0.8, 380],
      [14.5, 420],
      [30, 520],
      [INTRO_SECONDS, 700],
    ]),
  },
  // The low note the whole film stands on: D, felt more than heard, ducked while the wreck makes its own noise.
  drone: {
    from: 0.3,
    to: SOUND_SECONDS - 0.4,
    gain: fader(
      -26,
      line([
        [0.3, 0],
        [4, 0.5],
        [TOUCHDOWN_AT - 0.2, 0.7],
        [TOUCHDOWN_AT + 0.1, 0.25],
        [STOP_AT, 0.25],
        [CRATER_AT, 0.55],
        [EYES_AT, 0.55],
        [sceneTime('eyes', 3.5), 0.8],
        [sceneTime('dawn', -0.2), 0.8],
        [sceneTime('dawn', -0.1), 0.05],
        [sceneTime('dawn', 0.5), 0.35],
        [38, 0.4],
        [INTRO_SECONDS, 0.45],
        [SOUND_SECONDS - 0.4, 0],
      ]),
    ),
    tone: line([
      [0.3, 110],
      [TOUCHDOWN_AT - 0.2, 240],
      [TOUCHDOWN_AT + 0.1, 140],
      [sceneTime('eyes', 0), 200],
      [sceneTime('dawn', -0.1), 380],
      [TITLE_WINDOW.from, 520],
      [SOUND_SECONDS, 520],
    ]),
  },
  // The Core's hum: a chord that rises and falls with the light of its crystal and goes with the night.
  hum: {
    from: HUM_FROM,
    to: sceneTime('dawn', 5),
    gain: fader(
      -16,
      (t) => Math.min(1, coreGlowAt(t) * HUM_SHARE) * smoothstep01((t - HUM_FROM) / HUM_RISE),
    ),
    tone: (t) => lerp(THIRD_FROM, THIRD_TO, smoothstep01((t - THIRD_AT) / THIRD_FOR)),
  },
};

/**
 * The cutoff in Hz of the lowpass over the whole mix with the eyes open. It is above anything most
 * ears pick out, and not nearer to half the sample rate than this, where a filter turns touchy and
 * magnifies the last digit of whatever is fed to it.
 */
export const LID_OPEN_HZ = 20000;
/** The same with the eyes shut: the world heard through a wall. */
export const LID_SHUT_HZ = 450;

/** The cutoff in Hz of the lowpass over the whole mix, for eyes that are `lids` shut (0 open, 1 shut): the world is muffled behind closed lids. */
export function lidCutoffAt(lids: number): number {
  return lerpLog(LID_OPEN_HZ, LID_SHUT_HZ, lids < 0 ? 0 : lids > 1 ? 1 : lids);
}
