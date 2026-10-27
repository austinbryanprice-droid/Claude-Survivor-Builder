import { describe, expect, it } from 'vitest';
import { VOICES } from '../../src/engine/audio/voices';
import { noteHz } from '../../src/shared/audio';
import { DAY_SECONDS, DUSK_SECONDS, NIGHT_SECONDS } from '../../src/shared/daycycle';
import { INTRO_BEDS, type BedScore } from '../../src/shared/intro-sound';
import {
  Composer,
  DANGER,
  HUM_RANGE,
  MIX,
  MUSIC,
  QUIET_SCENE,
  SceneTracker,
  TENSION_SECONDS,
  ambienceFor,
  cuesForEvent,
  dangerFrom,
  dawnCues,
  follow,
  nearCoreFrom,
  nightAmount,
  nightfallCues,
  waveStinger,
  type MusicCue,
  type SceneInputs,
  type SoundScene,
} from '../../src/shared/game-sound';

const DAY: SoundScene = QUIET_SCENE;
const NIGHT: SoundScene = { night: 1, danger: 0, nearCore: 0, held: false };
const SIEGE: SoundScene = { night: 1, danger: 1, nearCore: 0.5, held: false };

/** Everything a composer asks for over `seconds` of a scene, with the time each thing falls due. */
function listen(
  composer: Composer,
  scene: SoundScene,
  seconds: number,
  step = 0.05,
): { at: number; cue: MusicCue['cue'] }[] {
  const heard: { at: number; cue: MusicCue['cue'] }[] = [];
  for (let t = 0; t < seconds; t += step) {
    for (const { after, cue } of composer.advance(step, scene)) heard.push({ at: t + after, cue });
  }
  return heard;
}

const SCALE_DAY = ['D4', 'E4', 'F#4', 'A4', 'B4', 'D5', 'E5', 'F#5'].map(noteHz);
const SCALE_NIGHT = ['D3', 'F3', 'G3', 'A3', 'C4', 'D4', 'F4'].map(noteHz);

describe('how far into the night the sky is', () => {
  it('is nothing by day and the whole of it in the dark', () => {
    expect(nightAmount('day', 0, DAY_SECONDS)).toBe(0);
    expect(nightAmount('day', DAY_SECONDS - 1, 1)).toBe(0);
    expect(nightAmount('night', NIGHT_SECONDS / 2, NIGHT_SECONDS / 2)).toBe(1);
  });

  it('comes up over the dusk after nightfall and goes down over the dawn, as the sky does', () => {
    expect(nightAmount('night', 0, NIGHT_SECONDS)).toBe(0);
    expect(nightAmount('night', DUSK_SECONDS / 2, NIGHT_SECONDS - DUSK_SECONDS / 2)).toBeCloseTo(
      0.5,
      6,
    );
    expect(nightAmount('night', DUSK_SECONDS, NIGHT_SECONDS - DUSK_SECONDS)).toBe(1);
    expect(nightAmount('night', NIGHT_SECONDS - DUSK_SECONDS, DUSK_SECONDS)).toBe(1);
    expect(nightAmount('night', NIGHT_SECONDS - DUSK_SECONDS / 2, DUSK_SECONDS / 2)).toBeCloseTo(
      0.5,
      6,
    );
    expect(nightAmount('night', NIGHT_SECONDS, 0)).toBe(0);
  });

  it('never steps: a second of the night moves it by a small amount', () => {
    let last = nightAmount('night', 0, NIGHT_SECONDS);
    for (let into = 1; into <= NIGHT_SECONDS; into++) {
      const now = nightAmount('night', into, NIGHT_SECONDS - into);
      expect(Math.abs(now - last)).toBeLessThan(0.1);
      last = now;
    }
  });
});

describe('danger and the Core’s hum', () => {
  it('is nothing with no machine alive, a little for a far one and everything at your back', () => {
    expect(dangerFrom(null)).toBe(0);
    expect(dangerFrom(DANGER.far + 30)).toBeCloseTo(DANGER.floor, 9);
    expect(dangerFrom(DANGER.near)).toBe(1);
    expect(dangerFrom(0)).toBe(1);
  });

  it('grows as the nearest machine closes in', () => {
    let last = -1;
    for (let d = DANGER.far; d >= 0; d -= 4) {
      const now = dangerFrom(d);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it('puts the hum at its loudest beside the Core and at its quietest far from it', () => {
    expect(nearCoreFrom(0)).toBe(1);
    expect(nearCoreFrom(HUM_RANGE.near)).toBe(1);
    expect(nearCoreFrom(HUM_RANGE.far)).toBe(0);
    expect(nearCoreFrom(HUM_RANGE.far * 3)).toBe(0);
    expect(nearCoreFrom((HUM_RANGE.near + HUM_RANGE.far) / 2)).toBeCloseTo(0.5, 9);
  });
});

describe('the long sounds', () => {
  it('sit well under the film’s wind and hum, which are the loudest the game makes them, and are not silent', () => {
    const top = (score: BedScore): number => {
      let best = 0;
      for (let t = score.from; t <= score.to; t += 0.05) best = Math.max(best, score.gain(t));
      return best;
    };
    const filmWind = top(INTRO_BEDS.wind);
    const filmHum = top(INTRO_BEDS.hum);
    expect(filmWind).toBeCloseTo(0.12, 2);
    expect(filmHum).toBeGreaterThan(0.08);
    const day = ambienceFor({ ...DAY, nearCore: 1 });
    // At least six decibels under the film, and not more than eighteen.
    expect(day.wind).toBeLessThan(filmWind / 2);
    expect(day.wind).toBeGreaterThan(filmWind / 8);
    expect(day.hum).toBeLessThan(filmHum / 2);
    expect(day.hum).toBeGreaterThan(filmHum / 8);
    expect(day.drone).toBe(0);
  });

  it('turn the wind down and bring the low note up as the night comes', () => {
    const day = ambienceFor(DAY);
    const night = ambienceFor(NIGHT);
    expect(night.wind).toBeLessThan(day.wind);
    expect(night.windHz).toBeLessThan(day.windHz);
    expect(night.drone).toBeGreaterThan(day.drone);
    expect(day.drone).toBe(0);
  });

  it('turn the Core’s chord from the major by day to the minor by night', () => {
    expect(ambienceFor(DAY).thirdHz).toBeCloseTo(noteHz('F#3'), 6);
    expect(ambienceFor(NIGHT).thirdHz).toBeCloseTo(noteHz('F3'), 6);
  });

  it('hum louder beside the Core than far from it, and never go silent', () => {
    const near = ambienceFor({ ...DAY, nearCore: 1 }).hum;
    const far = ambienceFor({ ...DAY, nearCore: 0 }).hum;
    expect(near).toBeGreaterThan(far);
    expect(far / near).toBeCloseTo(MIX.humFar, 9);
  });

  it('draw the low note tighter and darker-to-brighter as the machines close in', () => {
    const calm = ambienceFor({ ...NIGHT, danger: 0 });
    const tense = ambienceFor({ ...NIGHT, danger: 1 });
    expect(tense.droneHz).toBeGreaterThan(calm.droneHz);
    expect(tense.drone).toBeGreaterThan(calm.drone);
  });

  it('stay finite, not below nothing and not above a bed’s full level over every scene', () => {
    for (let night = 0; night <= 1; night += 0.125) {
      for (let danger = 0; danger <= 1; danger += 0.25) {
        for (let nearCore = 0; nearCore <= 1; nearCore += 0.5) {
          const a = ambienceFor({ night, danger, nearCore, held: false });
          for (const value of Object.values(a)) {
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
          }
          expect(a.wind).toBeLessThanOrEqual(1);
          expect(a.hum).toBeLessThanOrEqual(1);
          expect(a.drone).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('the sparse music', () => {
  it('names only voices the film has', () => {
    const composer = new Composer(7);
    const heard = [
      ...listen(composer, DAY, 400),
      ...listen(composer, SIEGE, 400),
      ...waveStinger(1, 3, 5),
      ...nightfallCues(5),
      ...dawnCues(5),
    ];
    for (const { cue } of heard) {
      expect(Object.keys(VOICES)).toContain(cue.voice);
      expect(Number.isFinite(cue.level)).toBe(true);
      expect(cue.seed).toBeGreaterThanOrEqual(0);
    }
  });

  it('plays the same piece for the same seed and a different one for another', () => {
    const a = listen(new Composer(11), NIGHT, 300);
    const b = listen(new Composer(11), NIGHT, 300);
    const c = listen(new Composer(12), NIGHT, 300);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('holds still while the clock is held', () => {
    const composer = new Composer(3);
    expect(listen(composer, { ...DAY, held: true }, 600)).toEqual([]);
    expect(listen(composer, { ...SIEGE, held: true }, 600)).toEqual([]);
    // ...and picks up where it was when the clock runs again.
    expect(listen(composer, DAY, MUSIC.firstNote + 1).length).toBeGreaterThan(0);
  });

  it('asks for nothing from a step that is not forward in time', () => {
    const composer = new Composer(3);
    expect(composer.advance(0, DAY)).toEqual([]);
    expect(composer.advance(-1, DAY)).toEqual([]);
    expect(composer.advance(Number.NaN, DAY)).toEqual([]);
  });

  it('lets the film’s last chord die before its first note, and is sparse after', () => {
    const heard = listen(new Composer(21), DAY, 600);
    const notes = heard.filter(({ cue }) => cue.voice === 'pluck');
    expect(notes[0]?.at).toBeGreaterThanOrEqual(MUSIC.firstNote - 0.06);
    // A note every 7 to 15 seconds, and sometimes an answer: well under one a second, and a good few in ten minutes.
    expect(notes.length).toBeGreaterThan(30);
    expect(notes.length).toBeLessThan(600 / 4);
    const pads = heard.filter(({ cue }) => cue.voice === 'pad');
    expect(pads[0]?.at).toBeGreaterThanOrEqual(MUSIC.firstPad - 0.06);
    expect(pads.length).toBeGreaterThan(0);
  });

  it('keeps to the major scale by day and the minor by night, with no heartbeat in a quiet night', () => {
    const day = listen(new Composer(5), DAY, 800).filter(({ cue }) => cue.voice === 'pluck');
    for (const { cue } of day) {
      expect(SCALE_DAY.some((hz) => Math.abs(hz - (cue.hz ?? 0)) < 1e-6)).toBe(true);
    }
    const quiet = listen(new Composer(5), NIGHT, 800);
    const night = quiet.filter(({ cue }) => cue.voice === 'pluck');
    expect(night.length).toBeGreaterThan(0);
    for (const { cue } of night) {
      expect(SCALE_NIGHT.some((hz) => Math.abs(hz - (cue.hz ?? 0)) < 1e-6)).toBe(true);
    }
    expect(quiet.some(({ cue }) => cue.voice === 'heart' || cue.voice === 'timp')).toBe(false);
  });

  it('turns the pad from D major to D minor with the night', () => {
    const day = listen(new Composer(8), DAY, 300).filter(({ cue }) => cue.voice === 'pad');
    const night = listen(new Composer(8), NIGHT, 300).filter(({ cue }) => cue.voice === 'pad');
    const hz = (list: typeof day): number[] => list.map(({ cue }) => cue.hz ?? 0);
    expect(hz(day).some((value) => Math.abs(value - noteHz('F#4')) < 1e-6)).toBe(true);
    expect(hz(day).some((value) => Math.abs(value - noteHz('F4')) < 1e-6)).toBe(false);
    expect(hz(night).some((value) => Math.abs(value - noteHz('F4')) < 1e-6)).toBe(true);
    expect(hz(night).some((value) => Math.abs(value - noteHz('F#4')) < 1e-6)).toBe(false);
  });

  it('brings a heartbeat in by night once a machine is about, and quickens it as the machines close in', () => {
    const beats = (danger: number): number =>
      listen(new Composer(9), { ...NIGHT, danger }, 120).filter(({ cue }) => cue.voice === 'heart')
        .length;
    expect(beats(0.05)).toBe(0);
    expect(beats(0.2)).toBeGreaterThan(0);
    expect(beats(1)).toBeGreaterThan(beats(0.2) * 1.5);
    // A beat is a pair: two close thumps, the second softer.
    const pair = listen(new Composer(9), { ...NIGHT, danger: 0.5 }, 0.5).filter(
      ({ cue }) => cue.voice === 'heart',
    );
    expect(pair).toHaveLength(2);
    expect((pair[1] as { at: number }).at - (pair[0] as { at: number }).at).toBeGreaterThan(0.2);
    expect((pair[1] as { cue: { level: number } }).cue.level).toBeLessThan(
      (pair[0] as { cue: { level: number } }).cue.level,
    );
  });

  it('keeps the drum for when the machines are close, and by night only', () => {
    const drums = (scene: SoundScene): number =>
      listen(new Composer(4), scene, 120).filter(({ cue }) => cue.voice === 'timp').length;
    expect(drums({ ...NIGHT, danger: MUSIC.drum.from - 0.05 })).toBe(0);
    expect(drums({ ...NIGHT, danger: 1 })).toBeGreaterThan(5);
    expect(drums({ ...DAY, danger: 1 })).toBe(0);
  });

  it('makes no beat in the day even with machines about', () => {
    const heard = listen(new Composer(2), { ...DAY, danger: 1 }, 120);
    expect(heard.some(({ cue }) => cue.voice === 'heart' || cue.voice === 'timp')).toBe(false);
  });

  it('is not tied to the frame rate: the same notes come at 20 or 120 steps a second, to within a step', () => {
    const slow = listen(new Composer(13), NIGHT, 200, 0.05).filter(
      ({ cue }) => cue.voice === 'pluck',
    );
    const fast = listen(new Composer(13), NIGHT, 200, 1 / 120).filter(
      ({ cue }) => cue.voice === 'pluck',
    );
    expect(fast.length).toBe(slow.length);
    slow.forEach((item, i) => {
      expect(Math.abs(item.at - (fast[i] as { at: number }).at)).toBeLessThan(0.1);
      expect(item.cue.hz).toBe((fast[i] as { cue: { hz?: number } }).cue.hz);
    });
  });
});

describe('the stinger and the words of the hours', () => {
  it('climbs for a few seconds and ends with a drum, all well inside the ten seconds of warning', () => {
    const [riser, drum] = waveStinger(1, 3, 99) as [MusicCue, MusicCue];
    expect(riser.cue.voice).toBe('riser');
    expect(drum.cue.voice).toBe('timp');
    expect(riser.cue.to).toBeGreaterThan(riser.cue.hz ?? Infinity);
    expect(drum.after).toBeGreaterThanOrEqual(riser.after + (riser.cue.seconds ?? 0));
    expect(drum.after).toBeLessThan(10);
  });

  it('hits a little harder for each wave of a night', () => {
    const level = (wave: number): number => (waveStinger(wave, 4, 1)[0] as MusicCue).cue.level;
    expect(level(2)).toBeGreaterThan(level(1));
    expect(level(4)).toBeGreaterThan(level(3));
    expect((waveStinger(1, 1, 1)[0] as MusicCue).cue.level).toBe(level(1));
  });

  it('turns the chord to the minor at nightfall and to the major at dawn', () => {
    const pads = (cues: MusicCue[]): number[] =>
      cues.filter(({ cue }) => cue.voice === 'pad').map(({ cue }) => cue.hz ?? 0);
    expect(pads(nightfallCues(1))).toContain(noteHz('F4'));
    expect(pads(nightfallCues(1))).not.toContain(noteHz('F#4'));
    expect(pads(dawnCues(1))).toContain(noteHz('F#4'));
    expect(pads(dawnCues(1))).not.toContain(noteHz('F4'));
    expect(nightfallCues(1)[0]?.cue.voice).toBe('groan');
    expect(dawnCues(1)[0]?.cue.voice).toBe('ping');
  });
});

describe('what each word of the host sounds like', () => {
  const voices = (cues: MusicCue[]): string[] => cues.map(({ cue }) => cue.voice);

  it('groans as night falls, climbs ahead of a wave and rings at the dawn', () => {
    expect(voices(cuesForEvent({ k: 'nightfall', n: 2 }, 7))).toEqual([
      'groan',
      'pad',
      'pad',
      'pad',
    ]);
    expect(voices(cuesForEvent({ k: 'wave', n: 2, i: 1, of: 2, c: 5 }, 7))).toEqual([
      'riser',
      'timp',
    ]);
    expect(voices(cuesForEvent({ k: 'dawn', n: 2 }, 7))).toEqual(['ping', 'pad', 'pad', 'pad']);
  });

  it('is silent for the words that have no sound of their own yet', () => {
    const quiet: Parameters<typeof cuesForEvent>[0][] = [
      { k: 'overrun', n: 3, why: 'core' },
      { k: 'down', n: 3, p: 1 },
      { k: 'back', n: 3, p: 1, c: 2 },
      { k: 'drop', n: 3, m: 1, c: 4 },
      { k: 'blast', n: 3, x: 1, y: 2, z: 3 },
    ];
    for (const event of quiet) expect(cuesForEvent(event, 7)).toEqual([]);
  });

  it('hits harder for the later waves of a night, as the stinger itself does', () => {
    const level = (i: number): number =>
      (cuesForEvent({ k: 'wave', n: 4, i, of: 3, c: 6 }, 7)[1] as MusicCue).cue.level;
    expect(level(2)).toBeGreaterThan(level(1));
    expect(level(3)).toBeGreaterThan(level(2));
  });

  it('plays one night on every screen: the same word in the same world is the same sound', () => {
    const event = { k: 'wave', n: 5, i: 2, of: 3, c: 6 } as const;
    expect(cuesForEvent(event, 1234)).toEqual(cuesForEvent(event, 1234));
    expect(cuesForEvent({ k: 'nightfall', n: 5 }, 1234)).toEqual(
      cuesForEvent({ k: 'nightfall', n: 5 }, 1234),
    );
  });

  it('keeps the seeds of different waves, nights and worlds apart so that no two sound alike', () => {
    const seedOf = (event: Parameters<typeof cuesForEvent>[0], world: number): number | undefined =>
      cuesForEvent(event, world)[0]?.cue.seed;
    const seeds = [
      seedOf({ k: 'wave', n: 1, i: 1, of: 3, c: 6 }, 7),
      seedOf({ k: 'wave', n: 1, i: 2, of: 3, c: 6 }, 7),
      seedOf({ k: 'wave', n: 2, i: 1, of: 3, c: 6 }, 7),
      seedOf({ k: 'wave', n: 1, i: 1, of: 3, c: 6 }, 8),
      seedOf({ k: 'nightfall', n: 1 }, 7),
      seedOf({ k: 'nightfall', n: 2 }, 7),
    ];
    expect(seeds.every((seed) => seed !== undefined)).toBe(true);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

describe('following a value', () => {
  it('covers about two thirds of the way in the time it is given, and never overshoots', () => {
    let value = 0;
    for (let t = 0; t < 2; t += 0.01) value = follow(value, 1, 0.01, 2);
    expect(value).toBeCloseTo(1 - Math.exp(-1), 2);
    for (let t = 0; t < 60; t += 0.1) value = follow(value, 1, 0.1, 2);
    expect(value).toBeLessThanOrEqual(1);
    expect(value).toBeGreaterThan(0.999);
  });

  it('gets there in the same time whatever the size of the step', () => {
    const run = (step: number): number => {
      let value = 0;
      for (let t = 0; t < 3 - 1e-9; t += step) value = follow(value, 1, step, 1.5);
      return value;
    };
    expect(run(1 / 120)).toBeCloseTo(run(1 / 20), 6);
    expect(run(1 / 60)).toBeCloseTo(run(0.5), 6);
  });

  it('stays where it is for a step that is not forward in time or a time that is not a time', () => {
    expect(follow(0.3, 1, 0, 2)).toBe(0.3);
    expect(follow(0.3, 1, -1, 2)).toBe(0.3);
    expect(follow(0.3, 1, Number.NaN, 2)).toBe(0.3);
    expect(follow(0.3, 1, 0.1, 0)).toBe(0.3);
  });
});

describe('the scene a frame makes', () => {
  const NOON: SceneInputs = {
    phase: 'day',
    into: 100,
    left: DAY_SECONDS - 100,
    nearestMachine: null,
    coreDistance: 5,
    running: true,
    over: false,
  };
  const MIDNIGHT: SceneInputs = {
    ...NOON,
    phase: 'night',
    into: NIGHT_SECONDS / 2,
    left: NIGHT_SECONDS / 2,
  };

  it('reads the hour, the Core and the clock off the frame', () => {
    const scene = new SceneTracker().update(1 / 60, NOON);
    expect(scene).toEqual({ night: 0, danger: 0, nearCore: 1, held: false });
    const night = new SceneTracker().update(1 / 60, { ...MIDNIGHT, coreDistance: 500 });
    expect(night.night).toBe(1);
    expect(night.nearCore).toBe(0);
  });

  it('holds the music when the clock is held or the run is over, and not otherwise', () => {
    const tracker = new SceneTracker();
    expect(tracker.update(1 / 60, { ...NOON, running: false }).held).toBe(true);
    expect(tracker.update(1 / 60, { ...NOON, over: true }).held).toBe(true);
    expect(tracker.update(1 / 60, NOON).held).toBe(false);
  });

  it('hears no Core where there is none to hear', () => {
    expect(new SceneTracker().update(1 / 60, { ...NOON, coreDistance: null }).nearCore).toBe(0);
  });

  it('lets the tension rise within a second or so of a machine at the walls, and let go over several', () => {
    const tracker = new SceneTracker();
    const at = (inputs: SceneInputs, seconds: number): SoundScene => {
      let scene = tracker.update(0, inputs);
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) scene = tracker.update(1 / 60, inputs);
      return scene;
    };
    const first = at({ ...MIDNIGHT, nearestMachine: 20 }, 0.5);
    expect(first.danger).toBeGreaterThan(0);
    expect(first.danger).toBeLessThan(dangerFrom(20));
    const risen = at({ ...MIDNIGHT, nearestMachine: 20 }, TENSION_SECONDS.rise * 6).danger;
    expect(risen).toBeCloseTo(dangerFrom(20), 2);
    // Once the machines are gone it takes longer to settle than it took to rise.
    const still = at({ ...MIDNIGHT, nearestMachine: null }, TENSION_SECONDS.rise * 2).danger;
    expect(still).toBeGreaterThan(risen / 2);
    const settled = at({ ...MIDNIGHT, nearestMachine: null }, TENSION_SECONDS.fall * 8).danger;
    expect(settled).toBeLessThan(0.001);
  });

  it('does not jump when one machine falls and another stands further off', () => {
    const tracker = new SceneTracker();
    for (let i = 0; i < 600; i++) tracker.update(1 / 60, { ...MIDNIGHT, nearestMachine: 15 });
    const before = tracker.update(1 / 60, { ...MIDNIGHT, nearestMachine: 15 }).danger;
    const after = tracker.update(1 / 60, { ...MIDNIGHT, nearestMachine: 60 }).danger;
    expect(before - after).toBeGreaterThan(0);
    expect(before - after).toBeLessThan(0.02);
  });

  it('is the same object every frame, for a loop that makes no garbage', () => {
    const tracker = new SceneTracker();
    expect(tracker.update(1 / 60, NOON)).toBe(tracker.update(1 / 60, MIDNIGHT));
  });
});
