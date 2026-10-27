import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveSound, type LiveSoundEvent } from '../../src/engine/audio/live';
import { VOICES } from '../../src/engine/audio/voices';
import {
  BUDGET,
  EARSHOT,
  KINDS,
  dropFor,
  effectForEdit,
  effectForHarvest,
  effectForRefusal,
  effectsForPower,
  type Effect,
  type Listener,
} from '../../src/shared/effect-sound';
import { MATERIAL, MODULE, SHAPE, moduleShape, packState } from '../../src/shared/blocks';
import { QUIET_SCENE, ambienceFor, type SoundScene } from '../../src/shared/game-sound';
import {
  FakeAudioContext,
  FakeFilter,
  FakeGain,
  FakeParam,
  asContext,
  asNode,
  reaches,
  type FakeNode,
} from './helpers/fake-audio';

const NIGHT: SoundScene = { night: 1, danger: 0.6, nearCore: 0.5, held: false };

/** A sleeping context, as a browser's is until the page has been clicked. */
class SleepyContext extends FakeAudioContext {
  override state: AudioContextState = 'suspended';
}

function setup(options: { live?: boolean; ctx?: FakeAudioContext } = {}) {
  const ctx = options.ctx ?? new FakeAudioContext();
  const output = ctx.createGain();
  const events: LiveSoundEvent[] = [];
  const sound = createLiveSound(asContext(ctx), {
    output: asNode(output),
    live: options.live ?? true,
    seed: 77,
    trace: (event) => events.push(event),
  });
  /** Lets `seconds` of game time pass in `scene`, in frames of `step`, moving the audio clock with it. */
  const play = (scene: SoundScene, seconds: number, step = 1 / 60): void => {
    for (let t = 0; t < seconds; t += step) {
      ctx.currentTime += step;
      sound.update(step, scene);
    }
  };
  return { ctx, output, events, sound, play };
}

/** Every value a param was told to go to, by a jump or an ease, in the order they were written. */
function aims(param: FakeParam): number[] {
  return param.events
    .filter((event) => event.type === 'target' || event.type === 'set')
    .map((event) => event.value);
}

/**
 * The last stage of each long sound, in the order they were built (the wind, the Core's hum, the low
 * note): gains that are made silent and are steered by the sound, apart from the one that brings the
 * whole mix up.
 */
function bedGains(ctx: FakeAudioContext, output: FakeGain): FakeGain[] {
  return ctx
    .ofType(FakeGain)
    .filter(
      (gain) =>
        gain.gain.value === 0 && gain.gain.events.length > 0 && !gain.outputs.includes(output),
    );
}

/** The master volume of the whole mix: the gain that feeds the output. */
function busOf(ctx: FakeAudioContext, output: FakeGain): FakeGain {
  return ctx.ofType(FakeGain).find((gain) => gain.outputs.includes(output)) as FakeGain;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the sound of the valley, in Web Audio', () => {
  it('is silent and builds nothing while the browser has not let the page make sound', () => {
    const { ctx, sound, play, events } = setup({ ctx: new SleepyContext() });
    const made = ctx.nodes.length;
    play(QUIET_SCENE, 5);
    expect(events).toEqual([]);
    expect(sound.stats.beds).toBe(0);
    expect(sound.stats.voices).toBe(0);
    expect(ctx.sources).toHaveLength(0);
    // The setup (the room and the noise) is made, and nothing is started.
    expect(ctx.nodes.length).toBe(made);
  });

  it('starts the wind, the Core’s hum and the low note on the first frame, and nothing is started twice', () => {
    const { ctx, sound, play, events } = setup();
    play(QUIET_SCENE, 1);
    expect(sound.stats.beds).toBe(3);
    expect(events.filter((event) => event.kind === 'bed').map((event) => event.name)).toEqual([
      'wind',
      'hum',
      'drone',
    ]);
    for (const source of ctx.sources) expect(source.startedAt).not.toBeNull();
    const started = ctx.sources.length;
    play(QUIET_SCENE, 5);
    // Only cues add sources after that, never a second set of beds.
    expect(sound.stats.beds).toBe(3);
    expect(ctx.sources.length).toBeGreaterThanOrEqual(started);
  });

  it('brings the whole mix up from silence over a few seconds', () => {
    const { output, ctx, play } = setup();
    play(QUIET_SCENE, 0.1);
    const events = busOf(ctx, output).gain.events;
    expect(events[0]).toMatchObject({ type: 'set', value: 0 });
    expect(events.find((event) => event.type === 'target')).toMatchObject({ value: 1 });
  });

  it('eases each bed toward what the scene asks for', () => {
    const { ctx, output, play } = setup();
    play(NIGHT, 1);
    const want = ambienceFor(NIGHT);
    const written = bedGains(ctx, output).flatMap((gain) => aims(gain.gain));
    expect(written).toContain(want.wind);
    expect(written).toContain(want.hum);
    expect(written).toContain(want.drone);
    const tones = ctx.oscillators.flatMap((osc) => aims(osc.frequency));
    expect(tones.some((hz) => Math.abs(hz - want.thirdHz) < 1e-9)).toBe(true);
  });

  it('writes a new target only when the scene has moved, and not every frame', () => {
    const { ctx, output, play } = setup();
    play(NIGHT, 5);
    const count = (): number =>
      bedGains(ctx, output).reduce((total, gain) => total + aims(gain.gain).length, 0);
    const before = count();
    play(NIGHT, 20);
    expect(count()).toBe(before);
    play(QUIET_SCENE, 1);
    expect(count()).toBeGreaterThan(before);
  });

  it('follows the day into the night: the drone comes up and the wind goes down', () => {
    const { ctx, output, play } = setup();
    play(QUIET_SCENE, 1);
    const [wind, , drone] = bedGains(ctx, output) as [FakeGain, FakeGain, FakeGain];
    const windDay = aims(wind.gain).at(-1) as number;
    const droneDay = aims(drone.gain).at(-1) ?? 0;
    play({ ...NIGHT, danger: 0 }, 1);
    expect(aims(wind.gain).at(-1) as number).toBeLessThan(windDay);
    expect(aims(drone.gain).at(-1) as number).toBeGreaterThan(droneDay);
  });

  it('plays the sparse music by itself, in the right place and time', () => {
    const { sound, play, events } = setup();
    play(QUIET_SCENE, 60, 0.05);
    const cues = events.filter((event) => event.kind === 'cue');
    expect(cues.length).toBeGreaterThan(0);
    expect(sound.stats.voices).toBe(cues.length);
    for (const cue of cues) {
      expect(cue.when).toBeGreaterThan(0);
      expect(['pluck', 'pad']).toContain(cue.name);
    }
    expect(sound.stats.failed).toBe(0);
  });

  it('plays nothing of the music while the clock is held, though the long sounds go on', () => {
    const { sound, play } = setup();
    play({ ...QUIET_SCENE, held: true }, 120, 0.1);
    expect(sound.stats.beds).toBe(3);
    expect(sound.stats.voices).toBe(0);
  });

  it('starts a sound a moment ahead of the audio clock, and later ones later', () => {
    const { ctx, sound, play, events } = setup();
    play(QUIET_SCENE, 0.1);
    ctx.currentTime = 50;
    sound.play({ voice: 'riser', level: -9, hz: 240, to: 3600, seconds: 3.6, seed: 1 }, 0);
    sound.play({ voice: 'timp', level: -12, hz: 62, seed: 2 }, 3.8);
    const [first, second] = events.filter(
      (event) => event.name === 'riser' || event.name === 'timp',
    );
    expect((first as LiveSoundEvent).when).toBeGreaterThan(50);
    expect((first as LiveSoundEvent).when).toBeLessThan(50.2);
    expect((second as LiveSoundEvent).when - (first as LiveSoundEvent).when).toBeCloseTo(3.8, 6);
  });

  it('plays a list of cues at their own offsets', () => {
    const { sound, play, events } = setup();
    play(QUIET_SCENE, 0.1);
    sound.playAll([
      { after: 0, cue: { voice: 'ping', level: -17, hz: 587, seed: 1 } },
      { after: 0.4, cue: { voice: 'pad', level: -25, hz: 147, seconds: 4, seed: 2 } },
    ]);
    const heard = events.filter((event) => event.name === 'ping' || event.name === 'pad');
    expect(heard).toHaveLength(2);
    expect((heard[1] as LiveSoundEvent).when - (heard[0] as LiveSoundEvent).when).toBeCloseTo(
      0.4,
      6,
    );
  });

  it('keeps playing when a recipe throws, and says so once', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const voices = VOICES as unknown as Record<string, () => void>;
    const broken = vi.spyOn(voices, 'pluck').mockImplementation(() => {
      throw new Error('no such partial');
    });
    const { sound, play, events } = setup();
    // Long enough for several notes and a pad.
    play(QUIET_SCENE, 200, 0.05);
    expect(broken).toHaveBeenCalled();
    expect(sound.stats.failed).toBeGreaterThan(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.name === 'pad')).toBe(true);
    expect(sound.stats.beds).toBe(3);
  });

  it('fades out over the time it is given, stops the long sounds, and then does nothing', () => {
    const { ctx, output, sound, play } = setup({ live: false });
    play(QUIET_SCENE, 2);
    const voices = sound.stats.voices;
    ctx.currentTime = 10;
    sound.fadeOut(0.5);
    expect(sound.stats.state).toBe('stopped');
    const last = busOf(ctx, output).gain.events.at(-1);
    expect(last).toMatchObject({ type: 'linear', value: 0 });
    expect(last?.time).toBeCloseTo(10.5, 6);
    for (const osc of ctx.oscillators.filter((o) => o.startedAt !== null && o.stoppedAt !== null)) {
      expect(osc.stoppedAt).toBeGreaterThanOrEqual(10.5);
    }
    play(NIGHT, 300, 0.1);
    sound.play({ voice: 'ping', level: -17, hz: 587, seed: 1 });
    expect(sound.stats.voices).toBe(voices);
    // A second fade is a no-op.
    expect(() => sound.fadeOut(1)).not.toThrow();
  });

  it('renders on a context that has no clock to wait on', () => {
    const { sound, play } = setup({ live: false, ctx: new SleepyContext() });
    play(NIGHT, 30, 0.1);
    expect(sound.stats.beds).toBe(3);
    expect(sound.stats.voices).toBeGreaterThan(0);
    expect(sound.stats.failed).toBe(0);
  });

  it('never writes a non-finite or negative time on any param', () => {
    // The fake context throws where a browser would; this runs a night and a day through it.
    const { sound, play } = setup();
    play(NIGHT, 90, 0.05);
    play(QUIET_SCENE, 90, 0.05);
    play({ night: 0.4, danger: 1, nearCore: 1, held: false }, 30, 0.05);
    expect(sound.stats.failed).toBe(0);
  });
});

const HERE: Listener = { x: 0, y: 0, z: 0, yaw: 0 };

/** An effect of one note, which costs the budget one voice. */
function knock(overrides: Partial<Effect> = {}, level = -14): Effect {
  return {
    kind: 'place',
    key: 1,
    cues: [{ after: 0, cue: { voice: 'ping', level, hz: 440, seed: 9 } }],
    ...overrides,
  };
}

const effectsOf = (events: readonly LiveSoundEvent[]): LiveSoundEvent[] =>
  events.filter((event) => event.effect !== undefined);

describe('the sound of what people do, in Web Audio', () => {
  it('sounds nothing while the browser has not let the page make sound, and says it did not', () => {
    const { ctx, sound, events } = setup({ ctx: new SleepyContext() });
    expect(sound.effect(knock())).toBe(false);
    expect(events).toEqual([]);
    expect(sound.stats.effects).toBe(0);
    expect(ctx.sources).toHaveLength(0);
  });

  it('sounds an effect that has no place in the head, as loud as it was written', () => {
    const { sound, events, play } = setup();
    play(QUIET_SCENE, 0.1);
    sound.listen(HERE);
    expect(sound.effect(knock({ kind: 'refuse' }, -16))).toBe(true);
    expect(effectsOf(events)).toEqual([
      expect.objectContaining({ kind: 'cue', name: 'ping', effect: 'refuse', pan: 0, level: -16 }),
    ]);
    expect(sound.stats.effects).toBe(1);
    expect(sound.stats.voices).toBe(1);
  });

  it('places an effect where it is heard from: on the side it is on, and quieter the farther it is', () => {
    const { ctx, sound, events, play } = setup();
    play(QUIET_SCENE, 0.1);
    sound.listen(HERE);
    const hear = (x: number, z = 0): LiveSoundEvent => {
      // A second apart, so that the governor's gaps are not what is being tested.
      ctx.currentTime += 1;
      events.length = 0;
      expect(sound.effect(knock({ at: { x, y: 0, z } }))).toBe(true);
      return effectsOf(events)[0] as LiveSoundEvent;
    };
    const right = hear(20);
    expect(right.pan).toBeGreaterThan(0.5);
    expect(right.level).toBeCloseTo(-14 + dropFor(20), 6);
    expect(hear(-20).pan).toBeLessThan(-0.5);
    expect(Math.abs(hear(0, -20).pan as number)).toBeLessThan(1e-3);
    expect(hear(40).level as number).toBeLessThan(right.level as number);
    // Turned around, what was on the right is on the left.
    sound.listen({ ...HERE, yaw: Math.PI });
    expect(hear(20).pan).toBeLessThan(-0.5);
  });

  it('leaves out what is beyond earshot or too quiet to be heard, and does not count it as turned away', () => {
    const { sound, events, play } = setup();
    play(QUIET_SCENE, 0.1);
    sound.listen(HERE);
    expect(sound.effect(knock({ at: { x: EARSHOT + 5, y: 0, z: 0 } }))).toBe(false);
    expect(sound.effect(knock({ at: { x: 40, y: 0, z: 0 } }, -50))).toBe(false);
    expect(effectsOf(events)).toEqual([]);
    expect(sound.stats.dropped).toBe(0);
    expect(sound.stats.effects).toBe(0);
  });

  it('plays an effect that has a place in the head until it has been told where the listener is', () => {
    const { sound, events, play } = setup();
    play(QUIET_SCENE, 0.1);
    expect(sound.effect(knock({ at: { x: 70, y: 0, z: 0 } }))).toBe(true);
    expect(effectsOf(events)[0]).toMatchObject({ pan: 0, level: -14 });
  });

  it('starts each sound of an effect a moment ahead of the clock, at its own offset', () => {
    const { ctx, sound, events, play } = setup();
    play(QUIET_SCENE, 0.1);
    ctx.currentTime = 30;
    sound.effect({
      kind: 'raise',
      cues: [
        { after: 0, cue: { voice: 'ping', level: -20, hz: 440, seed: 1 } },
        { after: 0.25, cue: { voice: 'ping', level: -20, hz: 660, seed: 2 } },
      ],
    });
    const [a, b] = effectsOf(events) as [LiveSoundEvent, LiveSoundEvent];
    expect(a.when).toBeGreaterThan(30);
    expect(a.when).toBeLessThan(30.2);
    expect(b.when - a.when).toBeCloseTo(0.25, 6);
  });

  it('turns away a second sound from the same source within its gap, and lets the next through after it', () => {
    const { ctx, sound, play } = setup();
    play(QUIET_SCENE, 0.1);
    expect(sound.effect(knock())).toBe(true);
    expect(sound.effect(knock())).toBe(false);
    expect(sound.stats.dropped).toBe(1);
    expect(sound.effect(knock({ key: 2 }))).toBe(true);
    ctx.currentTime += KINDS.place.gap + 0.01;
    expect(sound.effect(knock())).toBe(true);
    expect(sound.stats.effects).toBe(3);
  });

  it('holds all the effects to a budget, the least important first, and always lets a refused click answer', () => {
    const { ctx, sound, play } = setup();
    play(QUIET_SCENE, 0.1);
    const room = Math.floor(BUDGET.voices * BUDGET.share[KINDS.place.priority]);
    let sounded = 0;
    for (let key = 0; key < room + 20; key++) if (sound.effect(knock({ key }))) sounded++;
    expect(sounded).toBe(room);
    expect(sound.stats.dropped).toBe(20);
    // A module is worth more than a block, and what is left is enough for it; so is a click turned away.
    expect(sound.effect(knock({ kind: 'module', key: 1000 }))).toBe(true);
    expect(sound.effect(knock({ kind: 'refuse', key: 0 }))).toBe(true);
    // The sounds die away, and the room is free again.
    ctx.currentTime += 2;
    expect(sound.effect(knock({ key: 2000 }))).toBe(true);
  });

  it('sends an effect through a bus of its own into the same room as the valley’s sound', () => {
    const { ctx, output, sound, play } = setup();
    play(QUIET_SCENE, 0.1);
    const bus = busOf(ctx, output);
    /** The older nodes that the nodes made by `make` are joined to: where what it makes flows into the mix. */
    const fedBy = (make: () => void): Set<FakeNode> => {
      const mark = ctx.nodes.length;
      make();
      const made = new Set(ctx.nodes.slice(mark));
      const fed = new Set<FakeNode>();
      for (const node of made) {
        for (const out of node.outputs) {
          const target = out instanceof FakeParam ? out.owner : out;
          if (!made.has(target)) fed.add(target);
        }
      }
      return fed;
    };
    const music = fedBy(() => sound.play({ voice: 'ping', level: -17, hz: 587, seed: 1 }));
    const effect = fedBy(() => sound.effect(knock()));
    const shared = [...effect].filter((node) => music.has(node));
    const own = [...effect].filter((node) => !music.has(node));
    // One room for both, and a bus of its own that leads to the same mix.
    expect(shared).toHaveLength(1);
    expect(own).toHaveLength(1);
    expect(own[0]).not.toBe(bus);
    expect(reaches(own[0] as FakeNode, bus)).toBe(true);
  });

  it('dulls a far sound with a lowpass and leaves a near one clear', () => {
    const { ctx, sound, play } = setup();
    play(QUIET_SCENE, 0.1);
    sound.listen(HERE);
    const lowpasses = (x: number): FakeFilter[] => {
      ctx.currentTime += 1;
      const mark = ctx.nodes.length;
      sound.effect(knock({ at: { x, y: 0, z: 0 } }));
      return ctx.nodes
        .slice(mark)
        .filter(
          (node): node is FakeFilter => node instanceof FakeFilter && node.type === 'lowpass',
        );
    };
    const near = lowpasses(2);
    const far = lowpasses(44);
    expect(far).toHaveLength(near.length + 1);
  });

  it('sounds nothing once the sound is fading out', () => {
    const { sound, play } = setup({ live: false });
    play(QUIET_SCENE, 1);
    sound.fadeOut(0.5);
    expect(sound.effect(knock())).toBe(false);
    expect(sound.stats.effects).toBe(0);
  });

  it('goes on when the recipe of an effect throws, and says so once', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const voices = VOICES as unknown as Record<string, () => void>;
    vi.spyOn(voices, 'ping').mockImplementation(() => {
      throw new Error('no such partial');
    });
    const { sound, play } = setup();
    play(QUIET_SCENE, 0.1);
    expect(() => sound.effect(knock())).not.toThrow();
    expect(sound.effect(knock({ key: 2 }))).toBe(false);
    expect(sound.stats.failed).toBe(2);
    expect(sound.stats.effects).toBe(0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(sound.stats.beds).toBe(3);
  });

  it('plays every effect the game can make without breaking a rule of Web Audio', () => {
    const { ctx, sound, play } = setup();
    play(QUIET_SCENE, 0.1);
    sound.listen({ x: 1, y: 2, z: 3, yaw: 0.7 });
    const materials = [MATERIAL.scrap, MATERIAL.composite, MATERIAL.alloy, MATERIAL.energy];
    const shapes = [SHAPE.cube, ...Object.values(MODULE).map((id) => moduleShape(id, 1))];
    const effects: (Effect | null)[] = [effectForRefusal()];
    for (const [i, shape] of shapes.entries()) {
      for (const [j, material] of materials.entries()) {
        const state = packState(shape, material);
        const where = { type: 'set', x: 4 + i, y: j, z: -9 } as const;
        effects.push(
          effectForEdit({ ...where, state, by: 2 }, 0),
          effectForEdit({ ...where, state: 0, by: 2 }, state),
          effectForEdit({ ...where, state: 0, by: 0 }, state),
          effectForEdit(
            { ...where, state: packState(shape, materials[j + 1] ?? material), by: 2 },
            state,
          ),
        );
      }
    }
    for (const material of [1, 2, 3, 4]) {
      for (const full of [false, true]) {
        for (const left of [0, 3]) {
          const event = {
            by: 2,
            node: left + material,
            material,
            gained: full ? 0 : 3,
            left,
            full,
          };
          effects.push(effectForHarvest(event, { x: 10, y: 1, z: 10 }));
        }
      }
    }
    const flips = [
      { x: 3, y: 1, z: 4, on: true },
      { x: 9, y: 1, z: 4, on: false },
    ];
    effects.push(...effectsForPower(flips, null), ...effectsForPower(flips, HERE));
    let sounded = 0;
    for (const [i, effect] of effects.entries()) {
      if (!effect) continue;
      // Far enough apart that the governor never turns one away.
      ctx.currentTime += 3;
      if (sound.effect({ ...effect, key: i })) sounded++;
    }
    expect(sounded).toBeGreaterThan(100);
    expect(sound.stats.dropped).toBe(0);
    expect(sound.stats.failed).toBe(0);
  });
});
