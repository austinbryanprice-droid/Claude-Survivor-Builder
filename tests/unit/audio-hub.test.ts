import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioHub, createOutputChain, type AudioHub } from '../../src/engine/audio/hub';
import { gainOfVolume } from '../../src/shared/audio';
import type { FakeNode } from './helpers/fake-audio';
import {
  FakeAudioContext,
  FakeCompressor,
  FakeGain,
  asContext,
  reaches,
} from './helpers/fake-audio';

/** The page's `document`, as an event target with the one flag the hub reads. */
class FakeDocument extends EventTarget {
  hidden = false;

  show(): void {
    this.hidden = false;
    this.dispatchEvent(new Event('visibilitychange'));
  }

  hide(): void {
    this.hidden = true;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

/** An audio context that starts asleep, as a browser's does until the page has been clicked. */
class SleepyContext extends FakeAudioContext {
  override state: AudioContextState = 'suspended';
  resume = vi.fn(() => {
    this.state = 'running';
    return Promise.resolve();
  });
  suspend = vi.fn(() => {
    this.state = 'suspended';
    return Promise.resolve();
  });
  close = vi.fn(() => {
    this.state = 'closed';
    return Promise.resolve();
  });
}

describe('the audio hub', () => {
  let doc: FakeDocument;
  let made: SleepyContext[];
  const create = (): AudioContext => {
    const ctx = new SleepyContext();
    made.push(ctx);
    return ctx as unknown as AudioContext;
  };
  const hubWith = (volume = 1, enabled = true, factory = create): AudioHub =>
    createAudioHub({ volume, enabled, create: factory });
  /** The master volume: the last gain stage of the chain, the one that feeds the destination. */
  const master = (ctx: SleepyContext): FakeGain =>
    ctx.ofType(FakeGain).find((gain) => gain.outputs.includes(ctx.destination)) as FakeGain;

  beforeEach(() => {
    doc = new FakeDocument();
    made = [];
    vi.stubGlobal('document', doc);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes nothing until the page unlocks it from inside a click, and then makes one context and wakes it', () => {
    const hub = hubWith(0.7);
    expect(hub.context).toBeNull();
    expect(hub.input).toBeNull();
    expect(hub.volume).toBe(0.7);
    expect(made).toHaveLength(0);

    hub.unlock();
    expect(made).toHaveLength(1);
    const ctx = made[0] as SleepyContext;
    expect(hub.context).toBe(ctx);
    expect(hub.input).not.toBeNull();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe('running');

    // A second click finds the context awake and leaves it alone.
    hub.unlock();
    expect(made).toHaveLength(1);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('wakes a context the browser put back to sleep, on the next click', () => {
    const hub = hubWith();
    hub.unlock();
    const ctx = made[0] as SleepyContext;
    ctx.state = 'suspended';
    hub.unlock();
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it('keeps a page silent when it has been told to: no context is ever made', () => {
    const factory = vi.fn(create);
    const hub = hubWith(1, false, factory);
    hub.unlock();
    hub.unlock();
    hub.setVolume(1);
    expect(factory).not.toHaveBeenCalled();
    expect(hub.context).toBeNull();
    expect(hub.input).toBeNull();
  });

  it('makes no context for a player who has turned the volume to nothing, until they turn it up and click', () => {
    const hub = hubWith(0);
    hub.unlock();
    expect(made).toHaveLength(0);
    hub.setVolume(0.5);
    expect(made).toHaveLength(0);
    hub.unlock();
    expect(made).toHaveLength(1);
    expect(master(made[0] as SleepyContext).gain.value).toBeCloseTo(gainOfVolume(0.5), 9);
  });

  it('carries on silent in a browser that has no Web Audio, and does not try again', () => {
    const factory = vi.fn((): AudioContext => {
      throw new Error('AudioContext is not defined');
    });
    const hub = hubWith(1, true, factory);
    expect(() => hub.unlock()).not.toThrow();
    hub.unlock();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(hub.context).toBeNull();
    expect(hub.input).toBeNull();
  });

  it('says whether the page is meant to be heard: not when it was told to be silent, and not once the browser has refused', () => {
    expect(hubWith().enabled).toBe(true);
    expect(hubWith(1, false).enabled).toBe(false);
    // A volume of nothing is quiet, not off: the player can turn it up again.
    expect(hubWith(0).enabled).toBe(true);
    const refused = hubWith(1, true, () => {
      throw new Error('AudioContext is not defined');
    });
    expect(refused.enabled).toBe(true);
    refused.unlock();
    expect(refused.enabled).toBe(false);
  });

  it('sets the master volume as the square of the slider, eased over a few thousandths of a second', () => {
    const hub = hubWith(1);
    hub.unlock();
    const ctx = made[0] as SleepyContext;
    const gain = master(ctx).gain;
    expect(gain.value).toBe(1);
    ctx.currentTime = 5;
    hub.setVolume(0.5);
    expect(hub.volume).toBe(0.5);
    expect(gain.events[gain.events.length - 1]).toEqual({
      type: 'target',
      value: 0.25,
      time: 5,
      constant: 0.03,
    });
  });

  it('keeps the slider between 0 and 1 whatever it is handed', () => {
    const hub = hubWith(5);
    expect(hub.volume).toBe(1);
    hub.setVolume(-3);
    expect(hub.volume).toBe(0);
    hub.setVolume(Number.NaN);
    expect(hub.volume).toBe(0);
    hub.setVolume(0.35);
    expect(hub.volume).toBe(0.35);
    hub.setVolume(Number.POSITIVE_INFINITY);
    expect(hub.volume).toBe(0);
  });

  it('sends everything through a limiter and then the master volume to the speakers', () => {
    const hub = hubWith();
    hub.unlock();
    const ctx = made[0] as SleepyContext;
    const input = hub.input as unknown as FakeNode;
    expect(reaches(input, ctx.destination)).toBe(true);
    const [limiter] = ctx.ofType(FakeCompressor);
    expect(limiter).toBeDefined();
    // No path that skips the limiter: the input goes to it, and only it.
    expect(input.outputs).toEqual([limiter]);
    expect(limiter?.outputs).toEqual([master(ctx)]);
    // It only catches the loudest moments.
    expect(limiter?.threshold.value).toBeLessThan(-6);
    expect(limiter?.ratio.value).toBeGreaterThan(2);
    expect(limiter?.attack.value).toBeLessThan(0.02);
  });

  it('puts the sound to sleep while the tab is hidden, and wakes it when the tab is back', () => {
    const hub = hubWith();
    hub.unlock();
    const ctx = made[0] as SleepyContext;
    doc.hide();
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe('suspended');
    // Clicking in a hidden tab does not wake it.
    hub.unlock();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    doc.show();
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    expect(ctx.state).toBe('running');
  });

  it('does not wake a context the browser is still holding back when the tab comes back, since only a click may', () => {
    const hub = hubWith();
    hub.unlock();
    const ctx = made[0] as SleepyContext;
    ctx.state = 'suspended';
    doc.hide();
    expect(ctx.suspend).not.toHaveBeenCalled();
    doc.show();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('closes its context when the game goes, forgets the page and stays silent after', () => {
    const hub = hubWith();
    hub.unlock();
    const ctx = made[0] as SleepyContext;
    hub.dispose();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(hub.context).toBeNull();
    expect(hub.input).toBeNull();
    doc.hide();
    expect(ctx.suspend).not.toHaveBeenCalled();
    hub.unlock();
    expect(made).toHaveLength(1);
  });

  it('builds the same chain for a context that renders a file as for the one that plays', () => {
    const ctx = new FakeAudioContext();
    const chain = createOutputChain(asContext(ctx), 0.6);
    expect(reaches(chain.input as unknown as FakeNode, ctx.destination)).toBe(true);
    const out = ctx.ofType(FakeGain).find((gain) => gain.outputs.includes(ctx.destination));
    expect(out?.gain.value).toBeCloseTo(gainOfVolume(0.6), 9);
  });
});
