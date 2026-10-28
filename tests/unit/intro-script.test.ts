import { describe, expect, it } from 'vitest';
import {
  CYCLE_SECONDS,
  DAY_SECONDS,
  sunBearingAt,
  sunElevationAt,
} from '../../src/shared/daycycle';
import {
  BURN_UNTIL,
  CAPTIONS,
  CAPTION_FADE,
  CORE_PULSES,
  CRAWLER_RISES,
  DIPS,
  INTRO_SECONDS,
  INTRO_TITLE,
  REVEAL_AT,
  SCENES,
  SKIP_HINT_FROM,
  STATION_NAME,
  STOP_AT,
  TITLE_WINDOW,
  TOUCHDOWN_AT,
  coreGlowAt,
  createIntroFrame,
  introFrameAt,
  introPhaseAt,
  introWanted,
  lidsAt,
  sceneAt,
  sceneTime,
  smootherstep01,
  smoothstep01,
  type IntroFrame,
  type IntroWish,
  type SceneName,
} from '../../src/shared/intro';

const ORDER: SceneName[] = ['skyfall', 'skid', 'crater', 'eyes', 'dawn', 'wake'];

/** What subtitles allow a reader: the characters of a caption per second it is up. */
const READING_CHARACTERS_PER_SECOND = 18;

describe('the intro script', () => {
  it('runs its scenes back to back, in story order, for a short film', () => {
    expect(SCENES.map((scene) => scene.name)).toEqual(ORDER);
    expect(SCENES[0]?.from).toBe(0);
    SCENES.forEach((scene, i) => {
      expect(scene.to).toBeGreaterThan(scene.from);
      if (i > 0) expect(scene.from).toBe(SCENES[i - 1]?.to);
    });
    expect(INTRO_SECONDS).toBe(SCENES[SCENES.length - 1]?.to);
    // The brief is a trailer of about half a minute to a minute: long enough to tell it, short enough to sit through.
    expect(INTRO_SECONDS).toBeGreaterThanOrEqual(30);
    expect(INTRO_SECONDS).toBeLessThanOrEqual(60);
  });

  it('finds the scene that plays at a moment of the film', () => {
    for (const scene of SCENES) {
      expect(sceneAt((scene.from + scene.to) / 2).name).toBe(scene.name);
      expect(sceneAt(scene.from).name).toBe(scene.name);
    }
    expect(sceneAt(-3).name).toBe('skyfall');
    expect(sceneAt(INTRO_SECONDS + 10).name).toBe('wake');
    expect(sceneTime('crater', 2)).toBe((SCENES[2]?.from ?? 0) + 2);
    expect(() => sceneTime('nope' as SceneName)).toThrow(/no scene/);
  });

  it('puts the touchdown and the stop where the skid scene has room for them', () => {
    const skid = SCENES.find((scene) => scene.name === 'skid');
    expect(skid).toBeDefined();
    expect(TOUCHDOWN_AT).toBe(skid?.from);
    expect(STOP_AT).toBeGreaterThan(TOUCHDOWN_AT + 3);
    // The dust needs time to rise and the dip to black to arrive after the stop.
    expect(STOP_AT).toBeLessThan((skid?.to ?? 0) - 1.5);
  });

  it('keeps each caption inside one scene, long enough to read and clear of the others', () => {
    expect(CAPTIONS.length).toBeGreaterThan(0);
    let last = -Infinity;
    for (const caption of CAPTIONS) {
      expect(caption.text.trim().length).toBeGreaterThan(8);
      // Its fades, and then the time a subtitle gives its letters.
      expect(caption.to - caption.from, caption.text).toBeGreaterThanOrEqual(
        CAPTION_FADE * 2 + caption.text.length / READING_CHARACTERS_PER_SECOND,
      );
      expect(caption.from).toBeGreaterThanOrEqual(last);
      last = caption.to;
      const scene = sceneAt(caption.from);
      expect(caption.to).toBeLessThanOrEqual(scene.to);
    }
  });

  it('tells the story in the order the picture shows it, and leaves the crash to the picture and the sound', () => {
    const scenes = CAPTIONS.map((caption) => sceneAt(caption.from).name);
    // The scenes never go backward from one line to the next, every one but the skid has a line, and the skid is silent.
    const places = scenes.map((name) => ORDER.indexOf(name));
    expect(places).toEqual([...places].sort((a, b) => a - b));
    expect(scenes).not.toContain('skid');
    expect(new Set(scenes)).toEqual(new Set(ORDER.filter((name) => name !== 'skid')));
  });

  it('says the lore plainly: the station, the Core, the machines, the night and the day, and the place', () => {
    const words = CAPTIONS.map((caption) => caption.text).join(' ');
    for (const part of [
      STATION_NAME,
      'reactor',
      'Core',
      'machines',
      'night',
      'day',
      INTRO_TITLE.title,
    ]) {
      expect(words, part).toContain(part);
    }
    // A trailer's narration, not a story to sit through.
    expect(words.split(/\s+/).length).toBeLessThanOrEqual(80);
  });

  it('keeps the title card inside the dawn', () => {
    const dawn = SCENES.find((scene) => scene.name === 'dawn');
    expect(TITLE_WINDOW.from).toBeGreaterThanOrEqual(dawn?.from ?? Infinity);
    expect(TITLE_WINDOW.to).toBeLessThanOrEqual(dawn?.to ?? 0);
    expect(TITLE_WINDOW.to - TITLE_WINDOW.from).toBeGreaterThan(TITLE_WINDOW.fade * 2);
  });

  it('hides every change of place behind a dip to black or the flash of the touchdown', () => {
    // Every scene start but the first is a change of place; the skyfall to skid cut is the touchdown flash.
    const starts = SCENES.slice(1).map((scene) => scene.from);
    const covered = starts.filter(
      (at) => at === TOUCHDOWN_AT || DIPS.some((dip) => Math.abs(dip.at - at) < 1e-9),
    );
    expect(covered).toEqual(starts);
    // The dips do not run into each other or off the ends of the film.
    let last = -Infinity;
    for (const dip of [...DIPS].sort((a, b) => a.at - b.at)) {
      expect(dip.at - dip.seconds / 2).toBeGreaterThan(last);
      last = dip.at + dip.seconds / 2;
      expect(dip.at + dip.seconds / 2).toBeLessThan(INTRO_SECONDS);
    }
  });
});

describe('the sky of the intro', () => {
  it('starts at dusk of the day the reactor fell, with the sun still up', () => {
    const phase = introPhaseAt(0);
    expect(phase).toBeGreaterThan(DAY_SECONDS / CYCLE_SECONDS);
    expect(sunElevationAt(phase)).toBeGreaterThan(2);
    expect(sunElevationAt(phase)).toBeLessThan(12);
  });

  it('is dark by the crater and never runs backward', () => {
    expect(sunElevationAt(introPhaseAt(sceneTime('crater', 0)))).toBeLessThan(0);
    let last = introPhaseAt(0);
    for (let t = 0; t <= INTRO_SECONDS; t += 0.05) {
      const phase = introPhaseAt(t);
      expect(phase).toBeGreaterThanOrEqual(last - 1e-12);
      last = phase;
    }
  });

  it('ends on exactly the sky a run opens with, and holds it, so that the hand-over is not a cut', () => {
    expect(introPhaseAt(INTRO_SECONDS)).toBe(1);
    expect(introPhaseAt(INTRO_SECONDS - 2)).toBe(1);
    expect(sunElevationAt(introPhaseAt(INTRO_SECONDS))).toBeCloseTo(sunElevationAt(0), 9);
    expect(sunBearingAt(introPhaseAt(INTRO_SECONDS))).toBeCloseTo(sunBearingAt(0), 9);
    // Past either end it holds.
    expect(introPhaseAt(-5)).toBe(introPhaseAt(0));
    expect(introPhaseAt(INTRO_SECONDS + 5)).toBe(1);
  });
});

describe('the easing curves', () => {
  it('start and finish flat, clamp, and rise steadily between', () => {
    for (const ease of [smoothstep01, smootherstep01]) {
      expect(ease(-2)).toBe(0);
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      expect(ease(5)).toBe(1);
      expect(ease(0.5)).toBeCloseTo(0.5, 9);
      let last = 0;
      for (let x = 0; x <= 1; x += 0.01) {
        expect(ease(x)).toBeGreaterThanOrEqual(last);
        last = ease(x);
      }
    }
  });
});

describe('the overlay of the intro', () => {
  const frameAt = (time: number): IntroFrame => introFrameAt(time, createIntroFrame());

  it('opens out of black with no bars, and ends on a clear screen the player can take over', () => {
    const first = frameAt(0);
    expect(first.black).toBe(1);
    expect(first.bars).toBe(0);
    expect(first.caption).toBeNull();
    expect(first.title).toBe(0);
    expect(first.skipHint).toBe(0);

    const last = frameAt(INTRO_SECONDS);
    expect(last.black).toBe(0);
    expect(last.flash).toBe(0);
    expect(last.bars).toBe(0);
    expect(last.lids).toBe(0);
    expect(last.caption).toBeNull();
    expect(last.title).toBe(0);
    expect(last.skipHint).toBe(0);
  });

  it('keeps every share between 0 and 1 for the whole film', () => {
    for (let t = -1; t <= INTRO_SECONDS + 1; t += 0.037) {
      const frame = frameAt(t);
      for (const key of [
        'black',
        'flash',
        'bars',
        'lids',
        'captionAlpha',
        'title',
        'skipHint',
      ] as const) {
        expect(frame[key], `${key} at ${t}`).toBeGreaterThanOrEqual(0);
        expect(frame[key], `${key} at ${t}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('flashes at the touchdown and the stop and not in between or after', () => {
    expect(frameAt(TOUCHDOWN_AT + 0.02).flash).toBeGreaterThan(0.5);
    expect(frameAt(STOP_AT + 0.02).flash).toBeGreaterThan(0.2);
    expect(frameAt(TOUCHDOWN_AT + 2.2).flash).toBe(0);
    expect(frameAt(STOP_AT + 2).flash).toBe(0);
  });

  it('dips to black at the cuts and is clear between them', () => {
    for (const dip of DIPS) {
      expect(frameAt(dip.at).black).toBeGreaterThan(0.99);
      expect(frameAt(dip.at - dip.seconds / 2 - 0.05).black).toBe(0);
      expect(frameAt(dip.at + dip.seconds / 2 + 0.05).black).toBe(0);
    }
  });

  it('shows each caption in its window and nothing outside it', () => {
    for (const caption of CAPTIONS) {
      const middle = frameAt((caption.from + caption.to) / 2);
      expect(middle.caption).toBe(caption.text);
      expect(middle.captionAlpha).toBeCloseTo(1, 6);
      const arriving = frameAt(caption.from + CAPTION_FADE / 2);
      expect(arriving.captionAlpha).toBeGreaterThan(0);
      expect(arriving.captionAlpha).toBeLessThan(1);
      expect(frameAt(caption.from - 0.1).caption).toBeNull();
      expect(frameAt(caption.to + 0.1).caption).toBeNull();
    }
  });

  it('brings the title card up in the middle of its window', () => {
    expect(frameAt(TITLE_WINDOW.from).title).toBe(0);
    expect(frameAt((TITLE_WINDOW.from + TITLE_WINDOW.to) / 2).title).toBeCloseTo(1, 6);
    expect(frameAt(TITLE_WINDOW.to).title).toBe(0);
  });

  it('shuts the survivor eyes at the cut to the waking and opens them for the hand-over', () => {
    expect(frameAt(sceneTime('wake', 0.1)).lids).toBe(1);
    expect(frameAt(sceneTime('wake', 3.6)).lids).toBe(0);
    expect(frameAt(sceneTime('crater', 3)).lids).toBe(0);
  });

  it('offers the skip prompt once the film is under way and takes it away before the end', () => {
    expect(frameAt(SKIP_HINT_FROM - 0.01).skipHint).toBe(0);
    expect(frameAt(SKIP_HINT_FROM + 2).skipHint).toBeGreaterThan(0.9);
    expect(frameAt(INTRO_SECONDS - 6).skipHint).toBeGreaterThan(0.3);
    expect(frameAt(INTRO_SECONDS - 0.2).skipHint).toBe(0);
  });
});

describe('what the picture and the sound of the intro share', () => {
  it('lays the Core’s moments, the machines’ rises and the end of the fires inside the scenes they belong to', () => {
    expect(REVEAL_AT).toBeCloseTo(STOP_AT + 0.35, 9);
    expect(CORE_PULSES[0]).toBeGreaterThan(REVEAL_AT);
    for (let i = 1; i < CORE_PULSES.length; i++) {
      expect(CORE_PULSES[i]).toBeGreaterThan(CORE_PULSES[i - 1] as number);
    }
    for (const pulse of CORE_PULSES) {
      expect(pulse).toBeGreaterThan(REVEAL_AT);
      expect(pulse).toBeLessThan(sceneAt(pulse).to);
      expect(['skid', 'crater', 'eyes']).toContain(sceneAt(pulse).name);
    }
    expect(CRAWLER_RISES).toHaveLength(5);
    for (const [i, rise] of CRAWLER_RISES.entries()) {
      expect(sceneAt(rise).name).toBe('eyes');
      if (i > 0) expect(rise).toBeGreaterThan(CRAWLER_RISES[i - 1] as number);
    }
    expect(sceneAt(BURN_UNTIL).name).toBe('dawn');
  });

  it('has the Core dark until it is uncovered, then flashing, breathing, and dimmed away by the morning', () => {
    expect(coreGlowAt(0)).toBe(0);
    expect(coreGlowAt(REVEAL_AT - 0.05)).toBe(0);
    expect(coreGlowAt(REVEAL_AT)).toBeGreaterThan(1);
    expect(coreGlowAt(REVEAL_AT + 3)).toBeGreaterThan(0.15);
    expect(coreGlowAt(REVEAL_AT + 3)).toBeLessThan(0.5);
    expect(coreGlowAt(sceneTime('dawn', 1.5))).toBeGreaterThan(0.2);
    expect(coreGlowAt(sceneTime('dawn', 4.6))).toBe(0);
    expect(coreGlowAt(INTRO_SECONDS)).toBe(0);
    for (let t = 0; t <= INTRO_SECONDS; t += 0.05) {
      expect(coreGlowAt(t)).toBeGreaterThanOrEqual(0);
      expect(coreGlowAt(t)).toBeLessThan(1.5);
    }
  });

  it('has the survivor’s eyes open until the cut, shut for it, opening twice with a blink between, and open for the hand-over', () => {
    const wake = (seconds: number): number => lidsAt(sceneTime('wake', seconds));
    expect(lidsAt(0)).toBe(0);
    expect(lidsAt(sceneTime('wake', 0) - 0.01)).toBe(0);
    expect(wake(0)).toBe(1);
    expect(wake(0.8)).toBe(1);
    expect(wake(2.3)).toBeCloseTo(0.22, 9);
    expect(wake(2.75)).toBeCloseTo(1, 9);
    expect(wake(3.4)).toBe(0);
    expect(wake(5)).toBe(0);
    // Opening, then closing for the blink, then opening for good.
    expect(wake(1.6)).toBeLessThan(wake(1));
    expect(wake(2.5)).toBeGreaterThan(wake(2.3));
    expect(wake(3.1)).toBeLessThan(wake(2.75));
  });

  it('is the very number the overlay draws the survivor’s eyelids with', () => {
    for (let t = -0.5; t <= INTRO_SECONDS + 0.5; t += 0.037) {
      expect(introFrameAt(t, createIntroFrame()).lids).toBe(lidsAt(t));
    }
  });
});

describe('when a fresh run opens with the intro', () => {
  const plain: IntroWish = {
    mode: 'auto',
    setting: true,
    automated: false,
    custom: false,
  };

  it('plays for a player who has not turned it off', () => {
    expect(introWanted(plain)).toBe(true);
  });

  it('stays out of the way of the player settings, scripts and custom views', () => {
    expect(introWanted({ ...plain, setting: false })).toBe(false);
    expect(introWanted({ ...plain, automated: true })).toBe(false);
    expect(introWanted({ ...plain, custom: true })).toBe(false);
  });

  it('does not ask what the system says about motion: a player cannot see that, and the film is calmer for them instead', () => {
    // The wish has no such field to answer by, so a system that asks for less motion is a plain start like any other.
    expect(Object.keys(plain).sort()).toEqual(['automated', 'custom', 'mode', 'setting']);
    expect(introWanted(plain)).toBe(true);
  });

  it('is settled by the address when it says so', () => {
    const everythingAgainst: IntroWish = {
      mode: 'on',
      setting: false,
      automated: true,
      custom: true,
    };
    expect(introWanted(everythingAgainst)).toBe(true);
    expect(introWanted({ ...plain, mode: 'off' })).toBe(false);
  });
});
