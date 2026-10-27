import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BEDS } from '../../src/engine/audio/beds';
import { VOICES } from '../../src/engine/audio/voices';
import { createIntroSound, type IntroSound, type SoundEvent } from '../../src/engine/intro/sound';
import { INTRO_SECONDS, lidsAt } from '../../src/shared/intro';
import {
  INTRO_CUES,
  LID_OPEN_HZ,
  LID_SHUT_HZ,
  SOUND_SECONDS,
  lidCutoffAt,
} from '../../src/shared/intro-sound';
import { FakeAudioContext, FakeFilter, FakeGain, asContext, asNode } from './helpers/fake-audio';

interface Rig {
  ctx: FakeAudioContext;
  sound: IntroSound;
  events: SoundEvent[];
  bus: FakeGain;
  lid: FakeFilter;
}

function setup(live = true): Rig {
  const ctx = new FakeAudioContext();
  const output = ctx.createGain();
  const events: SoundEvent[] = [];
  const sound = createIntroSound(asContext(ctx), {
    output: asNode(output),
    live,
    trace: (event) => events.push(event),
  });
  // The lid filter is the first filter the sound makes, and the bus is what feeds it.
  const lid = ctx.ofType(FakeFilter)[0] as FakeFilter;
  const bus = ctx.ofType(FakeGain).find((gain) => gain.outputs.includes(lid)) as FakeGain;
  return { ctx, sound, events, bus, lid };
}

const cues = (events: readonly SoundEvent[]): SoundEvent[] =>
  events.filter((event) => event.kind === 'cue');
const beds = (events: readonly SoundEvent[]): SoundEvent[] =>
  events.filter((event) => event.kind === 'bed');

/** Plays the film as a player's browser would at full speed: a frame every sixtieth of a second, with the audio clock running with the film's. */
function playThrough(rig: Rig, until = INTRO_SECONDS, frame = 1 / 60): void {
  for (let t = frame; t <= until + 1e-9; t += frame) {
    rig.ctx.currentTime = t;
    rig.sound.update(Math.min(t, INTRO_SECONDS));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the film’s sound director', () => {
  it('starts nothing until the film is near enough to a cue, then starts it once, a moment ahead on the audio clock', () => {
    const { ctx, sound, events } = setup();
    sound.update(0);
    expect(events).toEqual([]);
    expect(sound.stats).toMatchObject({ voices: 0, beds: 0, state: 'playing' });

    ctx.currentTime = 5;
    sound.update(1.5);
    const first = cues(events);
    expect(first.length).toBeGreaterThan(0);
    for (const event of first) {
      expect(event.at).toBeLessThanOrEqual(1.5 + 0.2);
      // The film's second maps onto the audio clock as now + how far ahead of the film's clock the cue is.
      expect(event.when).toBeCloseTo(5 + (event.at - 1.5), 9);
    }
    const count = events.length;
    sound.update(1.5);
    sound.update(1.5);
    expect(events).toHaveLength(count);
    expect(sound.stats.voices).toBe(first.length);
  });

  it('starts a bed when it is due, at the film second the clock is at, and not again', () => {
    const { ctx, sound, events } = setup();
    ctx.currentTime = 2;
    sound.update(0.9);
    // The wind begins at 0.8 s, the drone at 0.3 s.
    expect(
      beds(events)
        .map((event) => event.name)
        .sort(),
    ).toEqual(['drone', 'wind']);
    const wind = beds(events).find((event) => event.name === 'wind') as SoundEvent;
    expect(wind.at).toBeCloseTo(0.9, 9);
    expect(wind.when).toBeCloseTo(2, 9);
    sound.update(1.2);
    expect(beds(events)).toHaveLength(2);
    expect(sound.stats.beds).toBe(2);
  });

  it('follows a film that runs slow: whatever the audio clock has done, a cue starts at most a lookahead ahead of it', () => {
    const { ctx, sound, events } = setup();
    // The audio clock runs five times as fast as the film does.
    let film = 0;
    let now = 100;
    for (let frame = 0; frame < 1500; frame++) {
      film += 1 / 60 / 5;
      now += 1 / 60;
      ctx.currentTime = now;
      const before = events.length;
      sound.update(film);
      for (const event of events.slice(before)) {
        expect(event.when).toBeGreaterThanOrEqual(now - 1e-9);
        expect(event.when - now).toBeLessThanOrEqual(0.2 + 1e-9);
      }
    }
    expect(cues(events).length).toBeGreaterThan(0);
  });

  it('holds the sound back with a picture that stalls: the film’s clock stands still, so nothing new starts', () => {
    const { ctx, sound, events } = setup();
    ctx.currentTime = 3;
    sound.update(10);
    const count = events.length;
    for (let i = 1; i <= 60; i++) {
      ctx.currentTime = 3 + i / 60;
      sound.update(10);
    }
    expect(events).toHaveLength(count);
  });

  it('drops what the film’s clock has jumped over instead of playing it all at once', () => {
    const { ctx, sound, events } = setup();
    sound.update(0.1);
    ctx.currentTime = 1;
    const before = events.length;
    sound.update(30);
    const after = events.slice(before);
    const played = cues(after);
    expect(played.length).toBeGreaterThan(0);
    for (const event of played) {
      expect(event.at).toBeGreaterThanOrEqual(30 - 0.25);
      expect(event.at).toBeLessThanOrEqual(30.2);
    }
    // The long sounds are joined where the film is: the fall and the skid are over, the wind and the Core's hum are not.
    expect(
      beds(after)
        .map((event) => event.name)
        .sort(),
    ).toEqual(['hum', 'wind']);
    expect(beds(after).every((event) => event.at === 30)).toBe(true);
  });

  it('plays the whole film once: every cue and every bed exactly once, in time with the film, and nothing left running', () => {
    const rig = setup();
    playThrough(rig);
    rig.ctx.currentTime = INTRO_SECONDS;
    rig.sound.finish();
    const { events, sound, ctx } = rig;
    expect(sound.stats).toMatchObject({
      voices: INTRO_CUES.length,
      beds: 5,
      skipped: 0,
      failed: 0,
      state: 'ringing',
    });
    expect(cues(events)).toHaveLength(INTRO_CUES.length);
    for (const event of cues(events)) {
      // The audio clock ran with the film's, so a cue starts on its own second.
      expect(Math.abs(event.when - event.at)).toBeLessThan(1e-6);
    }
    expect(cues(events).map((event) => [event.name, event.at])).toEqual(
      INTRO_CUES.map((cue) => [cue.voice, cue.at]),
    );
    expect(
      beds(events)
        .map((event) => event.name)
        .sort(),
    ).toEqual(['drone', 'grind', 'hum', 'roar', 'wind']);
    // Everything that was started has been given an end.
    const loose = ctx.oscillators.filter((osc) => osc.startedAt !== null && osc.stoppedAt === null);
    expect(loose).toEqual([]);
    for (const source of ctx.bufferSources) {
      if (source.loop) expect(source.stoppedAt, 'a looping noise left running').not.toBeNull();
    }
  });

  it('ends every bed by the end of the sound, the long ones as the tail dies away', () => {
    const rig = setup();
    playThrough(rig);
    rig.ctx.currentTime = INTRO_SECONDS;
    rig.sound.finish();
    const looping = rig.ctx.bufferSources.filter((source) => source.loop);
    expect(looping.length).toBeGreaterThan(3);
    for (const source of looping) {
      expect(source.stoppedAt as number).toBeLessThanOrEqual(SOUND_SECONDS + 0.1);
    }
  });

  it('writes the lowpass of the closed eyes from the picture’s own eyelids, and has it open again by the end', () => {
    const rig = setup();
    playThrough(rig);
    rig.ctx.currentTime = INTRO_SECONDS;
    rig.sound.finish();
    const { events: written } = rig.lid.frequency;
    expect(written.length).toBeGreaterThan(50);
    const cutoffs = written.map((event) => event.value);
    expect(Math.min(...cutoffs)).toBeCloseTo(LID_SHUT_HZ, 3);
    expect(cutoffs[cutoffs.length - 1]).toBe(LID_OPEN_HZ);
    for (const event of written) {
      expect(event.value).toBeGreaterThanOrEqual(LID_SHUT_HZ - 1e-6);
      expect(event.value).toBeLessThanOrEqual(LID_OPEN_HZ + 1e-6);
      // The cutoff written for a second is the one the eyelids of that second ask for.
      expect(event.value).toBeCloseTo(lidCutoffAt(lidsAt(event.time)), 3);
    }
    expect(rig.lid.frequency.value).toBe(LID_OPEN_HZ);
  });

  it('fades the sound out when the film is skipped, ignores the film from then on, and takes the sound apart when it has died', () => {
    const { ctx, sound, events, bus } = setup();
    ctx.currentTime = 12;
    sound.update(12);
    const count = events.length;
    ctx.currentTime = 12.1;
    sound.fadeOut(0.45);
    expect(sound.stats.state).toBe('fading');
    const end = bus.gain.events[bus.gain.events.length - 1];
    expect(end).toMatchObject({ type: 'linear', value: 0 });
    expect(end?.time).toBeCloseTo(12.1 + 0.45, 9);
    ctx.currentTime = 12.2;
    sound.update(13);
    expect(events).toHaveLength(count);

    const eventCount = bus.gain.events.length;
    sound.fadeOut(0.45);
    expect(bus.gain.events).toHaveLength(eventCount);

    expect(bus.disconnected).toBe(false);
    vi.advanceTimersByTime(300);
    expect(sound.stats.state).toBe('fading');
    vi.advanceTimersByTime(500);
    expect(sound.stats.state).toBe('stopped');
    expect(bus.disconnected).toBe(true);
    // The beds that were running are told to stop.
    const looping = ctx.bufferSources.filter((source) => source.loop && source.startedAt !== null);
    expect(looping.length).toBeGreaterThan(0);
    for (const source of looping) expect(source.stoppedAt).not.toBeNull();
  });

  it('lets the last chord ring after the film ends, fades the very end, and then takes itself apart', () => {
    const rig = setup();
    playThrough(rig);
    rig.ctx.currentTime = INTRO_SECONDS;
    const before = rig.events.length;
    rig.sound.finish();
    // Nothing is left in the score to start, but the beds are steered out to the end of the tail.
    expect(cues(rig.events.slice(before))).toEqual([]);
    expect(rig.sound.stats.state).toBe('ringing');
    const last = rig.bus.gain.events;
    expect(last[last.length - 2]).toMatchObject({ type: 'set', value: 1 });
    expect(last[last.length - 1]).toMatchObject({ type: 'linear', value: 0 });
    expect(last[last.length - 1]?.time).toBeCloseTo(SOUND_SECONDS, 6);
    // It stays up while the tail rings and is gone after it.
    vi.advanceTimersByTime(2000);
    expect(rig.bus.disconnected).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(rig.sound.stats.state).toBe('stopped');
    expect(rig.bus.disconnected).toBe(true);
    // A fade after the end, or a second end, does nothing.
    rig.sound.fadeOut(0.45);
    rig.sound.finish();
    expect(rig.sound.stats.state).toBe('stopped');
  });

  it('plays nothing while the browser has not let the page make sound, and joins in as soon as it does', () => {
    const { ctx, sound, events } = setup();
    ctx.state = 'suspended';
    ctx.currentTime = 1;
    sound.update(1.5);
    expect(events).toEqual([]);
    expect(sound.stats.voices).toBe(0);
    expect(sound.stats.skipped).toBeGreaterThan(0);
    const skipped = sound.stats.skipped;

    ctx.state = 'running';
    ctx.currentTime = 2;
    sound.update(2.5);
    expect(sound.stats.skipped).toBe(skipped);
    expect(cues(events).every((event) => event.at > 1.5 + 0.2 - 1e-9)).toBe(true);
    expect(
      beds(events)
        .map((event) => event.name)
        .sort(),
    ).toEqual(['drone', 'wind']);
  });

  it('renders a file whatever the context says its state is, since a context that renders has no clock to wait on', () => {
    const { ctx, sound, events } = setup(false);
    ctx.state = 'suspended';
    sound.advance(0, 3);
    expect(events.length).toBeGreaterThan(0);
    expect(sound.stats.skipped).toBe(0);
  });

  it('lays the span it is given out as the film’s clock stood at its start, so that a render is one long take', () => {
    const { ctx, sound, events } = setup(false);
    ctx.currentTime = 4;
    sound.advance(4, 10);
    const played = cues(events);
    expect(played.length).toBeGreaterThan(5);
    for (const event of played) {
      expect(event.at).toBeLessThanOrEqual(10);
      // A cue of the past, before the clock reached its moment, starts at once; the rest at their own second.
      if (event.at < 4) expect(event.when).toBe(4);
      else expect(event.when).toBeCloseTo(event.at, 9);
    }
  });
});

describe('a film whose sound fails', () => {
  it('goes on without it: a voice that throws is counted and reported once, and the next cues play', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(VOICES, 'groan').mockImplementation(() => {
      throw new Error('this recipe is broken');
    });
    const { ctx, sound, events } = setup();
    ctx.currentTime = 1;
    sound.update(1.5);
    ctx.currentTime = 6;
    sound.update(5.7);
    expect(sound.stats.failed).toBeGreaterThanOrEqual(2);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('groan');
    expect(cues(events).some((event) => event.name !== 'groan')).toBe(true);
    expect(cues(events).some((event) => event.name === 'groan')).toBe(false);
  });

  it('goes on without a bed that throws, and does not try to build it again every frame', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const wind = vi.spyOn(BEDS, 'wind').mockImplementation(() => {
      throw new Error('this bed is broken');
    });
    const { ctx, sound, events } = setup();
    for (let t = 1; t < 3; t += 1 / 60) {
      ctx.currentTime = t;
      sound.update(t);
    }
    expect(wind).toHaveBeenCalledTimes(1);
    expect(sound.stats.failed).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
    const names = beds(events).map((event) => event.name);
    expect(names).toContain('drone');
    expect(names).not.toContain('wind');
  });
});
