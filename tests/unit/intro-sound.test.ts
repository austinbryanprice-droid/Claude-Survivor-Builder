import { describe, expect, it } from 'vitest';
import { noteHz } from '../../src/shared/audio';
import {
  BURN_UNTIL,
  CORE_PULSES,
  CRAWLER_RISES,
  INTRO_SECONDS,
  REVEAL_AT,
  SCENES,
  STOP_AT,
  TITLE_WINDOW,
  TOUCHDOWN_AT,
  coreGlowAt,
  lidsAt,
  sceneTime,
} from '../../src/shared/intro';
import {
  INTRO_BEDS,
  INTRO_CUES,
  LID_OPEN_HZ,
  LID_SHUT_HZ,
  SOUND_SECONDS,
  TAIL_SECONDS,
  buildIntroCues,
  lidCutoffAt,
  type BedName,
  type Cue,
  type VoiceName,
} from '../../src/shared/intro-sound';

const cuesOf = (voice: VoiceName): Cue[] => INTRO_CUES.filter((cue) => cue.voice === voice);
const BED_NAMES = Object.keys(INTRO_BEDS) as BedName[];

describe('the intro’s score', () => {
  it('is the same score every time it is written, in the order it plays', () => {
    expect(buildIntroCues()).toEqual(INTRO_CUES);
    expect(buildIntroCues()).toEqual(buildIntroCues());
    for (let i = 1; i < INTRO_CUES.length; i++) {
      expect((INTRO_CUES[i] as Cue).at).toBeGreaterThanOrEqual((INTRO_CUES[i - 1] as Cue).at);
    }
  });

  it('lets the sound ring on a few seconds after the picture ends, into the first moments of play', () => {
    expect(TAIL_SECONDS).toBeGreaterThan(2);
    expect(SOUND_SECONDS).toBeCloseTo(INTRO_SECONDS + TAIL_SECONDS, 9);
  });

  it('keeps every cue inside the film with numbers a recipe can use', () => {
    expect(INTRO_CUES.length).toBeGreaterThan(200);
    for (const cue of INTRO_CUES) {
      const what = `${cue.voice} at ${cue.at}`;
      expect(cue.at, what).toBeGreaterThanOrEqual(0);
      expect(cue.at, what).toBeLessThanOrEqual(INTRO_SECONDS);
      expect(Number.isFinite(cue.level), what).toBe(true);
      expect(cue.level, what).toBeLessThanOrEqual(0);
      expect(cue.level, what).toBeGreaterThan(-40);
      expect(Number.isInteger(cue.seed) && cue.seed >= 0, what).toBe(true);
      for (const key of ['hz', 'to', 'seconds'] as const) {
        const value = cue[key];
        if (value !== undefined) {
          expect(Number.isFinite(value) && value > 0, `${what}: ${key} is ${value}`).toBe(true);
        }
      }
      for (const key of ['attack', 'release'] as const) {
        const value = cue[key];
        if (value !== undefined) expect(value >= 0 && Number.isFinite(value), what).toBe(true);
      }
      if (cue.pan !== undefined) expect(Math.abs(cue.pan), what).toBeLessThanOrEqual(1);
      if (cue.send !== undefined) expect(cue.send >= 0 && cue.send <= 1, what).toBe(true);
    }
  });

  it('gives every voice that is a note a pitch, and keeps every note in the film’s key (D, minor by night and major by day)', () => {
    // The notes of D minor and D major together: no E flat and no G sharp.
    const IN_KEY = new Set([0, 1, 2, 4, 5, 6, 7, 9, 10, 11]);
    const notes = INTRO_CUES.filter((cue) =>
      ['pad', 'pluck', 'ping', 'timp', 'whoom'].includes(cue.voice),
    );
    expect(notes.length).toBeGreaterThan(100);
    for (const cue of notes) {
      expect(cue.hz, `${cue.voice} at ${cue.at} has no pitch`).toBeDefined();
      const midi = 69 + 12 * Math.log2((cue.hz as number) / 440);
      expect(
        Math.abs(midi - Math.round(midi)),
        `${cue.voice} at ${cue.at} is out of tune`,
      ).toBeLessThan(0.001);
      const pitchClass = (((Math.round(midi) % 12) + 12) % 12) as number;
      expect(
        IN_KEY.has(pitchClass),
        `${cue.voice} at ${cue.at}: ${cue.hz} Hz is not in the key`,
      ).toBe(true);
    }
  });

  it('makes the touchdown the loudest sound of the film, ducking the mix just before it', () => {
    const loudest = INTRO_CUES.reduce((a, b) => (b.level > a.level ? b : a));
    expect(loudest.voice).toBe('boom');
    expect(loudest.at).toBe(TOUCHDOWN_AT);
    const [duck] = cuesOf('duck');
    expect(duck?.at).toBeLessThan(TOUCHDOWN_AT);
    expect((duck as Cue).at + ((duck as Cue).seconds as number)).toBeCloseTo(TOUCHDOWN_AT, 9);
    expect(duck?.level).toBeLessThan(-12);
  });

  it('hits the title’s arrival with a boom and a drum, the second great blow of the film', () => {
    const booms = cuesOf('boom');
    expect(booms.map((cue) => cue.at)).toEqual([TOUCHDOWN_AT, TITLE_WINDOW.from]);
    expect((booms[1] as Cue).level).toBeLessThan((booms[0] as Cue).level);
    expect(
      cuesOf('timp').some((cue) => cue.at === TITLE_WINDOW.from && cue.hz === noteHz('D2')),
    ).toBe(true);
  });

  it('strikes the wreck’s last great sound as it comes to rest, and lets steam out after it', () => {
    expect(cuesOf('clang').some((cue) => cue.at === STOP_AT && (cue.hz as number) < 120)).toBe(
      true,
    );
    const steam = cuesOf('steam').filter((cue) => cue.at > STOP_AT && cue.at < STOP_AT + 2);
    expect(steam.length).toBeGreaterThanOrEqual(2);
  });

  it('sounds the Core’s pulse exactly when the picture sends its ring across the crater', () => {
    expect(cuesOf('whoom').map((cue) => cue.at)).toEqual([...CORE_PULSES]);
    for (const cue of cuesOf('ping')) {
      expect(
        CORE_PULSES.some((pulse) => Math.abs(pulse - cue.at) < 0.05) || cue.at >= TITLE_WINDOW.from,
      ).toBe(true);
    }
  });

  it('has each machine of the wreck break the ground, wind up and light its eye when the picture raises it', () => {
    expect(cuesOf('rumble').map((cue) => cue.at)).toEqual([...CRAWLER_RISES]);
    expect(cuesOf('servo')).toHaveLength(CRAWLER_RISES.length);
    expect(cuesOf('blip')).toHaveLength(CRAWLER_RISES.length);
    CRAWLER_RISES.forEach((rise, i) => {
      expect((cuesOf('servo')[i] as Cue).at).toBeGreaterThan(rise);
      expect((cuesOf('blip')[i] as Cue).at).toBeGreaterThan((cuesOf('servo')[i] as Cue).at);
    });
  });

  it('lets the fires crackle from the moment the Core is uncovered until the sun is up, and not after', () => {
    const crackles = cuesOf('crackle').map((cue) => cue.at);
    expect(crackles.length).toBeGreaterThan(50);
    expect(Math.min(...crackles.filter((at) => at > TOUCHDOWN_AT + 2))).toBeGreaterThanOrEqual(
      REVEAL_AT,
    );
    expect(Math.max(...crackles)).toBeLessThanOrEqual(BURN_UNTIL);
    // The fires die down: fewer crackles a second by the morning than in the crater.
    const rate = (from: number, to: number): number =>
      crackles.filter((at) => at >= from && at < to).length / (to - from);
    expect(rate(sceneTime('dawn', 0), BURN_UNTIL)).toBeLessThan(
      rate(sceneTime('crater', 0), sceneTime('crater', 8)),
    );
  });

  it('never leaves a scene without something to hear', () => {
    for (const scene of SCENES) {
      const inScene = INTRO_CUES.filter((cue) => cue.at >= scene.from && cue.at < scene.to);
      expect(inScene.length, scene.name).toBeGreaterThan(15);
      // And no stretch of four seconds without a cue.
      for (let from = scene.from; from + 4 <= scene.to; from += 1) {
        expect(
          INTRO_CUES.some((cue) => cue.at >= from && cue.at < from + 4),
          `${scene.name} from ${from}`,
        ).toBe(true);
      }
    }
  });

  it('brings the bells in eighth notes with the title and thins them out toward the end', () => {
    const bells = cuesOf('pluck').filter((cue) => cue.at > TITLE_WINDOW.from + 0.6);
    expect(bells.length).toBeGreaterThan(20);
    const level = (from: number, to: number): number => {
      const inside = bells.filter((cue) => cue.at >= from && cue.at < to);
      return inside.reduce((sum, cue) => sum + cue.level, 0) / inside.length;
    };
    expect(level(TITLE_WINDOW.from + 2, TITLE_WINDOW.from + 5)).toBeGreaterThan(
      level(INTRO_SECONDS - 3, INTRO_SECONDS),
    );
  });
});

describe('the intro’s beds', () => {
  it('has the five long sounds of the film, each running for a stretch inside the sound', () => {
    expect(BED_NAMES.sort()).toEqual(['drone', 'grind', 'hum', 'roar', 'wind']);
    for (const name of BED_NAMES) {
      const bed = INTRO_BEDS[name];
      expect(bed.from, name).toBeGreaterThanOrEqual(0);
      expect(bed.to, name).toBeGreaterThan(bed.from);
      expect(bed.to, name).toBeLessThanOrEqual(SOUND_SECONDS);
    }
  });

  it('keeps every curve a finite number all along its bed, a loudness never above full and a tone above zero', () => {
    for (const name of BED_NAMES) {
      const bed = INTRO_BEDS[name];
      for (let t = bed.from - 0.5; t <= bed.to + 0.5; t += 0.01) {
        const gain = bed.gain(t);
        expect(
          Number.isFinite(gain) && gain >= 0 && gain <= 1,
          `${name} gain at ${t} is ${gain}`,
        ).toBe(true);
        const tone = bed.tone(t);
        expect(Number.isFinite(tone) && tone > 0, `${name} tone at ${t} is ${tone}`).toBe(true);
        if (bed.rate)
          expect(Number.isFinite(bed.rate(t)) && bed.rate(t) > 0, `${name} rate at ${t}`).toBe(
            true,
          );
      }
    }
  });

  it('starts and ends every bed on silence, so that it cannot click in or out', () => {
    for (const name of BED_NAMES) {
      const bed = INTRO_BEDS[name];
      // The hum is the Core's own glow, which is dark where it begins and ends.
      expect(bed.gain(bed.from), `${name} at its start`).toBeLessThan(0.002);
      expect(bed.gain(bed.to), `${name} at its end`).toBeLessThan(0.002);
    }
  });

  it('draws the roar of the fall rising to the touchdown and gone a moment after it', () => {
    const roar = INTRO_BEDS.roar;
    expect(roar.gain(roar.from)).toBe(0);
    expect(roar.gain(TOUCHDOWN_AT - 0.2)).toBeGreaterThan(roar.gain(5));
    expect(roar.gain(5)).toBeGreaterThan(roar.gain(3.5));
    expect(roar.gain(TOUCHDOWN_AT + 1.4)).toBe(0);
    expect(roar.tone(TOUCHDOWN_AT - 0.2)).toBeGreaterThan(roar.tone(4));
  });

  it('draws the grinding of the wreck starting with the touchdown, slowing and dropping as it comes to rest', () => {
    const { grind } = INTRO_BEDS;
    expect(grind.from).toBeLessThanOrEqual(TOUCHDOWN_AT);
    expect(grind.gain(TOUCHDOWN_AT + 0.1)).toBeGreaterThan(grind.gain(STOP_AT));
    expect(grind.tone(TOUCHDOWN_AT)).toBeGreaterThan(grind.tone(STOP_AT));
    expect((grind.rate as (t: number) => number)(TOUCHDOWN_AT)).toBeGreaterThan(
      (grind.rate as (t: number) => number)(STOP_AT),
    );
    expect(grind.gain(grind.to)).toBe(0);
  });

  it('has the Core hum swell and fade with its glow, and sing its third a semitone higher in the morning', () => {
    const { hum } = INTRO_BEDS;
    expect(hum.from).toBeLessThanOrEqual(REVEAL_AT);
    expect(hum.gain(REVEAL_AT - 1)).toBe(0);
    expect(hum.gain(REVEAL_AT + 0.05)).toBeGreaterThan(hum.gain(REVEAL_AT + 3));
    const times: number[] = [];
    // From a moment after it has come up out of silence.
    for (let t = REVEAL_AT + 0.2; t < hum.to; t += 0.1) times.push(t);
    for (const a of times) {
      for (const b of times) {
        if (coreGlowAt(a) + 1e-9 < coreGlowAt(b) && coreGlowAt(b) < 1 / 0.55) {
          expect(hum.gain(a)).toBeLessThanOrEqual(hum.gain(b) + 1e-12);
        }
      }
    }
    expect(hum.tone(REVEAL_AT)).toBeCloseTo(noteHz('F3'), 6);
    expect(hum.tone(hum.to)).toBeCloseTo(noteHz('F#3'), 6);
    for (let t = REVEAL_AT; t < hum.to; t += 0.1) {
      expect(hum.tone(t + 0.1)).toBeGreaterThanOrEqual(hum.tone(t) - 1e-9);
    }
  });

  it('runs a wind and a low drone under the whole film, with the drone dropping out for the touchdown', () => {
    const { wind, drone } = INTRO_BEDS;
    expect(wind.from).toBeLessThan(2);
    expect(wind.to).toBeGreaterThan(INTRO_SECONDS);
    expect(drone.from).toBeLessThan(1);
    expect(drone.to).toBeGreaterThan(INTRO_SECONDS);
    expect(drone.gain(TOUCHDOWN_AT + 0.5)).toBeLessThan(drone.gain(TOUCHDOWN_AT - 0.5));
    // The wind gets up toward the morning.
    expect(wind.gain(INTRO_SECONDS)).toBeGreaterThan(wind.gain(sceneTime('crater', 4)));
  });
});

describe('the lowpass of closed eyes', () => {
  it('is wide open for open eyes and a wall at 450 Hz for shut ones, closing smoothly between', () => {
    expect(LID_SHUT_HZ).toBe(450);
    expect(lidCutoffAt(0)).toBe(LID_OPEN_HZ);
    expect(lidCutoffAt(1)).toBeCloseTo(LID_SHUT_HZ, 9);
    expect(lidCutoffAt(-3)).toBe(LID_OPEN_HZ);
    expect(lidCutoffAt(7)).toBeCloseTo(LID_SHUT_HZ, 9);
    let before = Infinity;
    for (let lids = 0; lids <= 1.0001; lids += 0.05) {
      const cutoff = lidCutoffAt(lids);
      expect(cutoff).toBeLessThan(before);
      before = cutoff;
    }
    // Halfway shut sounds halfway muffled: the cutoff is the geometric mean of the two ends.
    expect(lidCutoffAt(0.5)).toBeCloseTo(Math.sqrt(LID_OPEN_HZ * LID_SHUT_HZ), 6);
  });

  it('is open above what ears pick out, and below the range where a filter turns touchy at the usual sample rates', () => {
    expect(LID_OPEN_HZ).toBeGreaterThanOrEqual(18000);
    // A lowpass near half the sample rate has its poles hard against the unit circle.
    expect(LID_OPEN_HZ).toBeLessThanOrEqual(0.46 * 44100);
  });

  it('follows the picture’s eyelids through the waking', () => {
    expect(lidCutoffAt(lidsAt(sceneTime('wake', 0.5)))).toBeCloseTo(LID_SHUT_HZ, 6);
    expect(lidCutoffAt(lidsAt(sceneTime('wake', 4)))).toBe(LID_OPEN_HZ);
  });
});
