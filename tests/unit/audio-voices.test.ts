import { describe, expect, it } from 'vitest';
import { BEDS } from '../../src/engine/audio/beds';
import { createNoiseBank } from '../../src/engine/audio/noise';
import { createReverb, REVERB_SECONDS } from '../../src/engine/audio/reverb';
import { SOFT_CLIP, VOICES, type VoiceEnv } from '../../src/engine/audio/voices';
import { dbToGain } from '../../src/shared/audio';
import {
  INTRO_BEDS,
  INTRO_CUES,
  type BedName,
  type Cue,
  type VoiceName,
} from '../../src/shared/intro-sound';
import type { FakeNode } from './helpers/fake-audio';
import {
  FakeAudioContext,
  FakeBufferSource,
  FakeConvolver,
  FakeFilter,
  FakeGain,
  FakeOscillator,
  FakeParam,
  asContext,
  asNode,
  endOf,
  reaches,
  type FakeSourceNode,
} from './helpers/fake-audio';

const asBuffer = (buffer: unknown): AudioBuffer => buffer as AudioBuffer;
/** The noise bank is the slow part of setting up, and any context can use the same one. */
const NOISE = createNoiseBank(asContext(new FakeAudioContext()));

function setup() {
  const ctx = new FakeAudioContext();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const bus = ctx.createGain();
  const env: VoiceEnv = {
    ctx: asContext(ctx),
    dry: asNode(dry),
    wet: asNode(wet),
    noise: NOISE,
    bus: bus as unknown as GainNode,
  };
  return { ctx, dry, wet, bus, env };
}

const VOICE_NAMES = Object.keys(VOICES) as VoiceName[];
/** Seconds after its start by which every voice must have gone quiet. */
const LONGEST_VOICE = 12;

/** One cue of each voice with nothing but the defaults, as a recipe that was never given a field must still sound right. */
const bare = (voice: VoiceName): Cue => ({ at: 10, voice, level: 0, seed: 4242 });

/** Every number an automation event of a param has been told to reach, with the time. */
function eventsOf(nodes: readonly FakeNode[]): { param: FakeParam; value: number; time: number }[] {
  const out: { param: FakeParam; value: number; time: number }[] = [];
  for (const node of nodes) {
    for (const key of Object.keys(node)) {
      const member = (node as unknown as Record<string, unknown>)[key];
      if (member instanceof FakeParam) {
        for (const event of member.events) out.push({ param: member, ...event });
      }
    }
  }
  return out;
}

describe('the film’s voices', () => {
  it('has a recipe for every voice the score uses', () => {
    for (const cue of INTRO_CUES) expect(VOICES[cue.voice], cue.voice).toBeTypeOf('function');
  });

  it.each(VOICE_NAMES.filter((name) => name !== 'duck'))(
    '%s starts its sounds when told, stops every oscillator, feeds the mix and dies away',
    (name) => {
      const { ctx, dry, env } = setup();
      const before = ctx.nodes.length;
      VOICES[name](env, 10, bare(name));
      const made = ctx.nodes.slice(before);
      const sources = made.filter(
        (node): node is FakeSourceNode =>
          node instanceof FakeOscillator || node instanceof FakeBufferSource,
      );
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(source.startedAt).toBeGreaterThanOrEqual(10 - 1e-9);
        expect(reaches(source, dry), `${name}: a source that goes nowhere`).toBe(true);
        const end = endOf(source);
        expect(end, `${name}: a source that never ends`).not.toBeNull();
        expect(end as number).toBeGreaterThanOrEqual(source.startedAt as number);
        expect(end as number).toBeLessThanOrEqual(10 + LONGEST_VOICE);
        if (source instanceof FakeOscillator) expect(source.stoppedAt).not.toBeNull();
      }
    },
  );

  it('sets a cue’s level as the gain of the first stage of its voice, and reads nothing else of it that is missing', () => {
    for (const name of VOICE_NAMES.filter((voice) => voice !== 'duck')) {
      for (const level of [-30, -12, 0, 3]) {
        const { ctx, env } = setup();
        const before = ctx.nodes.length;
        VOICES[name](env, 4, { ...bare(name), level });
        const first = ctx.nodes[before] as FakeNode;
        expect(first, name).toBeInstanceOf(FakeGain);
        expect((first as FakeGain).gain.value).toBeCloseTo(dbToGain(level), 9);
      }
    }
  });

  it('sends a share of a voice to the reverb by its own habit, unless the cue says otherwise', () => {
    const { ctx, wet, env } = setup();
    VOICES.ping(env, 0, bare('ping'));
    const sends = ctx.nodes.filter(
      (node): node is FakeGain => node instanceof FakeGain && node.outputs.includes(wet),
    );
    expect(sends).toHaveLength(1);
    expect(sends[0]?.gain.value).toBeCloseTo(0.8, 9);
    const dried = setup();
    VOICES.ping(dried.env, 0, { ...bare('ping'), send: 0 });
    expect(dried.ctx.nodes.some((node) => node.outputs.includes(dried.wet))).toBe(false);
  });

  it('places a panned cue between the speakers and leaves a centred one alone', () => {
    const left = setup();
    VOICES.step(left.env, 0, { ...bare('step'), pan: -0.6 });
    expect(left.ctx.nodes.some((node) => node.kind === 'panner')).toBe(true);
    const panned = left.ctx.nodes.find((node) => node.kind === 'panner') as unknown as {
      pan: FakeParam;
    };
    expect(panned.pan.value).toBe(-0.6);
    const centre = setup();
    VOICES.step(centre.env, 0, bare('step'));
    expect(centre.ctx.nodes.some((node) => node.kind === 'panner')).toBe(false);
    const wild = setup();
    VOICES.step(wild.env, 0, { ...bare('step'), pan: 7 });
    const clamped = wild.ctx.nodes.find((node) => node.kind === 'panner') as unknown as {
      pan: FakeParam;
    };
    expect(clamped.pan.value).toBe(1);
  });

  it('plays every cue of the film without breaking a rule of Web Audio, and never writes before the cue or leaves a sound running', () => {
    const { ctx, dry, env } = setup();
    for (const cue of INTRO_CUES) {
      if (cue.voice === 'duck') continue;
      const before = ctx.nodes.length;
      VOICES[cue.voice](env, cue.at, cue);
      const made = ctx.nodes.slice(before);
      for (const node of made) {
        if (node instanceof FakeOscillator || node instanceof FakeBufferSource) {
          expect(node.startedAt, `${cue.voice} at ${cue.at}`).toBeGreaterThanOrEqual(cue.at - 1e-9);
          const end = endOf(node);
          expect(end, `${cue.voice} at ${cue.at} never ends`).not.toBeNull();
          expect(end as number, `${cue.voice} at ${cue.at} rings too long`).toBeLessThanOrEqual(
            cue.at + LONGEST_VOICE,
          );
          expect(reaches(node, dry), `${cue.voice} at ${cue.at} goes nowhere`).toBe(true);
        }
      }
      for (const { param, value, time } of eventsOf(made)) {
        expect(Number.isFinite(value) && Number.isFinite(time), `${cue.voice} at ${cue.at}`).toBe(
          true,
        );
        expect(
          time,
          `${cue.voice} at ${cue.at} writes the past of ${param.name}`,
        ).toBeGreaterThanOrEqual(cue.at - 1e-9);
        expect(time).toBeLessThanOrEqual(cue.at + LONGEST_VOICE);
        if (param.owner instanceof FakeGain && param.name === 'gain') {
          expect(
            value,
            `${cue.voice} at ${cue.at}: a gain that goes negative`,
          ).toBeGreaterThanOrEqual(0);
        }
        if (param.owner instanceof FakeFilter && param.name === 'frequency') {
          expect(value).toBeGreaterThan(0);
          expect(value).toBeLessThan(ctx.sampleRate / 2);
        }
        if (param.owner instanceof FakeOscillator && param.name === 'frequency') {
          expect(value).toBeGreaterThan(0);
        }
      }
    }
    expect(ctx.sources.length).toBeGreaterThan(INTRO_CUES.length);
  });

  it('gives the same sound for the same cue and a different one for another seed', () => {
    const digest = (cue: Cue): string => {
      const { ctx, env } = setup();
      VOICES[cue.voice](env, cue.at, cue);
      const index = new Map<FakeNode, number>(ctx.nodes.map((node, i) => [node, i]));
      return JSON.stringify(
        ctx.nodes.map((node) => ({
          kind: node.kind,
          outputs: node.outputs.map((out) => index.get(out instanceof FakeParam ? out.owner : out)),
          started:
            node instanceof FakeBufferSource || node instanceof FakeOscillator ? node.startedAt : 0,
          offset: node instanceof FakeBufferSource ? node.offset : 0,
          params: eventsOf([node]).map(({ param, value, time }) => [param.name, value, time]),
        })),
      );
    };
    for (const name of ['crackle', 'thud', 'clang', 'boom', 'steam'] as const) {
      const cue: Cue = { ...bare(name), seed: 77, hz: 800 };
      expect(digest(cue)).toBe(digest({ ...cue }));
      expect(digest(cue)).not.toBe(digest({ ...cue, seed: 78 }));
    }
  });

  it('dips the whole mix for the length of a duck and brings it back at the end', () => {
    const { bus, env } = setup();
    VOICES.duck(env, 7.78, { ...bare('duck'), at: 7.78, level: -26, seconds: 0.22 });
    const events = bus.gain.events;
    expect(events[0]).toMatchObject({ type: 'set', value: 1, time: 7.78 });
    expect(events[1]?.type).toBe('linear');
    expect(events[1]?.value).toBeCloseTo(dbToGain(-26), 9);
    expect(events[events.length - 1]).toMatchObject({ type: 'set', value: 1 });
    expect(events[events.length - 1]?.time).toBeCloseTo(8, 9);
  });

  it('rolls the curve of its clipper through the origin, odd, rising and held to one', () => {
    const { length } = SOFT_CLIP;
    expect(SOFT_CLIP[0]).toBeCloseTo(-1, 9);
    expect(SOFT_CLIP[length - 1]).toBeCloseTo(1, 9);
    for (let i = 1; i < length; i++) {
      expect(SOFT_CLIP[i] as number).toBeGreaterThan(SOFT_CLIP[i - 1] as number);
      expect(Math.abs(SOFT_CLIP[i] as number)).toBeLessThanOrEqual(1 + 1e-9);
      expect((SOFT_CLIP[i] as number) + (SOFT_CLIP[length - 1 - i] as number)).toBeCloseTo(0, 6);
    }
  });
});

describe('the film’s beds', () => {
  const NAMES = Object.keys(BEDS) as BedName[];

  it('has a rig for every bed of the score, and a second control only where the score draws one', () => {
    expect(NAMES.sort()).toEqual((Object.keys(INTRO_BEDS) as BedName[]).sort());
    for (const name of NAMES) {
      const { env } = setup();
      const rig = BEDS[name](env);
      expect(rig.rate !== null, name).toBe(INTRO_BEDS[name].rate !== undefined);
    }
  });

  it.each(NAMES)(
    '%s is silent until it is steered, starts and stops all of its sources, and feeds the mix',
    (name) => {
      const { ctx, dry, env } = setup();
      const rig = BEDS[name](env);
      expect((rig.gain as unknown as FakeParam).value).toBe(0);
      expect(ctx.sources.length).toBeGreaterThan(1);
      for (const source of ctx.sources) {
        expect(source.startedAt).toBeNull();
        expect(reaches(source, dry), `${name}: a source that goes nowhere`).toBe(true);
      }
      rig.start(2);
      for (const source of ctx.sources) expect(source.startedAt).toBe(2);
      expect(() => rig.start(3)).toThrow();
      rig.stop(9);
      for (const source of ctx.sources) expect(source.stoppedAt).toBe(9);
    },
  );

  it.each(NAMES)(
    '%s can be steered along every curve of its score without a rule of Web Audio being broken',
    (name) => {
      const { env } = setup();
      const rig = BEDS[name](env);
      const score = INTRO_BEDS[name];
      for (let t = score.from; t <= score.to; t += 0.05) {
        rig.gain.linearRampToValueAtTime(score.gain(t), t);
        rig.tone.linearRampToValueAtTime(score.tone(t), t);
        if (rig.rate && score.rate) rig.rate.linearRampToValueAtTime(score.rate(t), t);
      }
    },
  );
});

describe('the reverb', () => {
  it('rings in two different rooms, one for each ear, which die away to nothing and go dark as they do', () => {
    const ctx = new FakeAudioContext();
    createReverb(asContext(ctx));
    const room = ctx.ofType(FakeConvolver)[0] as FakeConvolver;
    const buffer = room.buffer;
    expect(buffer?.numberOfChannels).toBe(2);
    expect(buffer?.duration).toBeGreaterThan(REVERB_SECONDS);
    const left = buffer?.getChannelData(0) as Float32Array;
    const right = buffer?.getChannelData(1) as Float32Array;
    const rms = (data: Float32Array, from: number, to: number): number => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += (data[i] as number) ** 2;
      return Math.sqrt(sum / (to - from));
    };
    const rate = ctx.sampleRate;
    // Nothing arrives before the pre-delay.
    expect(rms(left, 0, Math.floor(0.015 * rate))).toBe(0);
    const early = rms(left, Math.floor(0.05 * rate), Math.floor(0.3 * rate));
    const late = rms(left, Math.floor(2.7 * rate), Math.floor(3.1 * rate));
    expect(early).toBeGreaterThan(0);
    // 60 dB is the fall over REVERB_SECONDS; the stretch from 0.2 s to 2.9 s is most of it.
    expect(20 * Math.log10(late / early)).toBeLessThan(-30);
    let same = 0;
    for (let i = 0; i < left.length; i++) if (left[i] === right[i]) same++;
    expect(same / left.length).toBeLessThan(0.01);
    for (const data of [left, right])
      for (let i = 0; i < data.length; i += 97) expect(Number.isFinite(data[i])).toBe(true);
  });

  it('clears the lowest pitches out of what goes in before the room hears it', () => {
    const ctx = new FakeAudioContext();
    const reverb = createReverb(asContext(ctx));
    const filters = ctx.ofType(FakeFilter);
    expect(filters.map((filter) => filter.type).sort()).toEqual(['highpass', 'lowpass']);
    const input = reverb.input as unknown as FakeNode;
    expect(reaches(input, ctx.ofType(FakeConvolver)[0] as FakeNode)).toBe(true);
    expect(
      reaches(ctx.ofType(FakeConvolver)[0] as FakeNode, reverb.output as unknown as FakeNode),
    ).toBe(true);
  });
});

describe('the noise bank', () => {
  const channels = (color: 'white' | 'pink' | 'brown', seed?: number) => {
    const bank = createNoiseBank(asContext(new FakeAudioContext()), seed);
    const buffer = bank[color] as unknown as {
      getChannelData(channel: number): Float32Array;
      duration: number;
    };
    return {
      left: buffer.getChannelData(0),
      right: buffer.getChannelData(1),
      seconds: buffer.duration,
    };
  };
  const autocorrelation = (data: Float32Array, lag: number): number => {
    let num = 0;
    let den = 0;
    for (let i = 0; i + lag < data.length; i++) {
      num += (data[i] as number) * (data[i + lag] as number);
      den += (data[i] as number) ** 2;
    }
    return num / den;
  };
  const rms = (data: Float32Array): number => {
    let sum = 0;
    for (const x of data) sum += x * x;
    return Math.sqrt(sum / data.length);
  };

  it('brings every colour to the same loudness, so a voice is as loud in any of them', () => {
    for (const color of ['white', 'pink', 'brown'] as const) {
      const { left, right } = channels(color);
      expect(rms(left)).toBeCloseTo(0.2, 3);
      expect(rms(right)).toBeCloseTo(0.2, 3);
    }
  });

  it('tilts down by colour: white is uncorrelated from one sample to the next, pink somewhat, brown nearly always', () => {
    expect(Math.abs(autocorrelation(channels('white').left, 1))).toBeLessThan(0.02);
    expect(autocorrelation(channels('pink').left, 1)).toBeGreaterThan(0.5);
    expect(autocorrelation(channels('brown').left, 1)).toBeGreaterThan(0.97);
    expect(autocorrelation(channels('pink').left, 1)).toBeLessThan(
      autocorrelation(channels('brown').left, 1),
    );
  });

  it('is the same noise every time from the same seed, another noise from another, and different in each ear', () => {
    const a = channels('pink', 5);
    const b = channels('pink', 5);
    const c = channels('pink', 6);
    expect(Array.from(a.left.subarray(0, 64))).toEqual(Array.from(b.left.subarray(0, 64)));
    expect(Array.from(a.left.subarray(0, 64))).not.toEqual(Array.from(c.left.subarray(0, 64)));
    expect(Array.from(a.left.subarray(0, 64))).not.toEqual(Array.from(a.right.subarray(0, 64)));
  });

  it('loops without a seam: brown noise steps no further across the join than it does anywhere else', () => {
    const { left } = channels('brown');
    const steps: number[] = [];
    for (let i = 1; i < left.length; i++)
      steps.push(Math.abs((left[i] as number) - (left[i - 1] as number)));
    const typical = steps.reduce((sum, step) => sum + step, 0) / steps.length;
    const seam = Math.abs((left[0] as number) - (left[left.length - 1] as number));
    expect(seam).toBeLessThan(typical * 8);
  });

  it('is long enough to play a few seconds of from anywhere in it', () => {
    expect(channels('white').seconds).toBeGreaterThanOrEqual(3.5);
    const buffer = asBuffer(createNoiseBank(asContext(new FakeAudioContext())).white);
    expect(buffer.numberOfChannels).toBe(2);
  });
});
