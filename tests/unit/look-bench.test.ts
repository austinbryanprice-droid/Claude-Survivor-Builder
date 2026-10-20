import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QualityName } from '../../src/shared/quality';
import { PresetSweep, type SweepTarget } from '../../src/spike/bench';

/** Stands in for the look scene: records what the sweep asks of it. */
class FakeScene implements SweepTarget {
  quality: { name: QualityName } = { name: 'balanced' };
  stats: SweepTarget['stats'] = {
    value: { width: 1280, height: 720, drawCalls: 80, triangles: 7e5 },
  };
  gpuMs: number | null = null;
  gpuSerial = 0;
  readonly log: string[] = [];
  readonly route: number[] = [];
  routeSeconds = 0;

  applyQuality(name: QualityName): void {
    this.quality = { name };
    this.log.push(`quality:${name}`);
    const scale = name === 'low' ? 0.5 : name === 'ultra' ? 2 : 1;
    this.stats = {
      value: {
        width: Math.round(1280 * scale),
        height: Math.round(720 * scale),
        drawCalls: Math.round(80 * scale),
        triangles: 7e5 * scale,
      },
    };
  }
  setMoment(name: string): void {
    this.log.push(`moment:${name}`);
  }
  setGovernor(on: boolean): void {
    this.log.push(`governor:${on}`);
  }
  placeOnRoute(seconds: number, routeSeconds: number): void {
    this.route.push(seconds);
    this.routeSeconds = routeSeconds;
  }
  endRoute(): void {
    this.log.push('endRoute');
  }
}

const FRAME_MS = 1000 / 60;
let visibility: (() => void) | undefined;
const fakeDocument = {
  hidden: false,
  addEventListener: (type: string, listener: () => void) => {
    if (type === 'visibilitychange') visibility = listener;
  },
  removeEventListener: () => undefined,
};

/** Plays frames at a steady rate until the sweep stops (or `limit` frames pass). */
function play(sweep: PresetSweep, scene: FakeScene, limit = 5000, frameMs = FRAME_MS): number {
  let frames = 0;
  while (sweep.active && frames < limit) {
    sweep.beforeFrame(frameMs);
    scene.gpuMs = 8 + (frames % 3);
    scene.gpuSerial++;
    sweep.afterFrame(frameMs, 3);
    frames++;
  }
  return frames;
}

function makeSweep(
  scene: FakeScene,
  presets: readonly QualityName[] = ['low', 'balanced', 'ultra'],
  seconds = 1,
): { sweep: PresetSweep; changes: () => number } {
  let changes = 0;
  const sweep = new PresetSweep(
    scene,
    seconds,
    presets,
    () => ({
      buildId: 'test',
      gpu: 'Fake GPU',
      userAgent: 'Test',
      canvasWidth: 1280,
      canvasHeight: 720,
      devicePixelRatio: 1,
      drawCalls: 1,
      triangles: 1,
    }),
    () => changes++,
  );
  return { sweep, changes: () => changes };
}

beforeEach(() => {
  visibility = undefined;
  fakeDocument.hidden = false;
  vi.stubGlobal('document', fakeDocument);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PresetSweep', () => {
  it('flies the route once per preset in order, then puts the view back', () => {
    const scene = new FakeScene();
    const { sweep } = makeSweep(scene);
    expect(sweep.state).toBe('idle');
    sweep.start();
    expect(sweep.active).toBe(true);
    expect(sweep.preset).toBe('low');
    play(sweep, scene);

    expect(sweep.state).toBe('done');
    expect(sweep.preset).toBeNull();
    expect(sweep.runs.map((r) => r.preset)).toEqual(['low', 'balanced', 'ultra']);
    expect(scene.log.slice(0, 3)).toEqual(['moment:golden', 'governor:false', 'quality:low']);
    expect(scene.log.filter((line) => line.startsWith('quality:'))).toEqual([
      'quality:low',
      'quality:balanced',
      'quality:ultra',
      'quality:balanced',
    ]);
    // The governor comes back on and the camera returns before the starting preset is restored.
    expect(scene.log.slice(-3)).toEqual(['endRoute', 'governor:true', 'quality:balanced']);
    expect(scene.quality.name).toBe('balanced');
  });

  it('records each run in the shared report format at the preset own size', () => {
    const scene = new FakeScene();
    const { sweep } = makeSweep(scene);
    sweep.start();
    play(sweep, scene);

    for (const run of sweep.runs) {
      expect(run.report.scriptSeconds).toBe(1);
      expect(run.report.frames.frames).toBeGreaterThan(50);
      expect(run.report.frames.frames).toBeLessThan(70);
      expect(run.report.frames.avgMs).toBeCloseTo(FRAME_MS, 1);
      expect(run.report.cpu.avgMs).toBeCloseTo(3, 5);
      expect(run.report.environment.gpu).toBe('Fake GPU');
      expect(run.gpu?.avgMs).toBeGreaterThan(8);
      expect(run.gpu?.avgMs).toBeLessThan(10);
    }
    const [low, balanced, ultra] = sweep.runs;
    expect([low?.width, balanced?.width, ultra?.width]).toEqual([640, 1280, 2560]);
    expect(low?.drawCalls).toBeCloseTo(40, 5);
    expect(ultra?.triangles).toBeCloseTo(1.4e6, 0);
  });

  it('keeps no GPU time when the browser gives none', () => {
    const scene = new FakeScene();
    const { sweep } = makeSweep(scene, ['balanced']);
    sweep.start();
    while (sweep.active) {
      sweep.beforeFrame(FRAME_MS);
      sweep.afterFrame(FRAME_MS, 3);
    }
    expect(sweep.runs[0]?.gpu).toBeNull();
  });

  it('moves the camera along the route from the start to the end and never past it', () => {
    const scene = new FakeScene();
    const { sweep } = makeSweep(scene, ['balanced'], 2);
    sweep.start();
    const flight: number[] = [];
    while (sweep.active) {
      sweep.beforeFrame(FRAME_MS);
      if (!sweep.warmingUp) flight.push(scene.route.at(-1) as number);
      sweep.afterFrame(FRAME_MS, 3);
    }

    expect(scene.routeSeconds).toBe(2);
    expect(Math.min(...scene.route)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...scene.route)).toBeLessThanOrEqual(2);
    // Once the warm-up is over the camera only moves forward, and the flight ends at the far end.
    expect(flight[0]).toBeLessThan(0.05);
    for (let i = 1; i < flight.length; i++) {
      expect(flight[i] as number).toBeGreaterThanOrEqual((flight[i - 1] as number) - 1e-9);
    }
    expect(flight.at(-1)).toBeGreaterThan(1.95);
  });

  it('reports progress through the current preset and a warm-up before it', () => {
    const scene = new FakeScene();
    const { sweep } = makeSweep(scene, ['balanced'], 1);
    sweep.start();
    expect(sweep.warmingUp).toBe(true);
    expect(sweep.progress).toBe(0);
    let half = false;
    while (sweep.active) {
      sweep.beforeFrame(FRAME_MS);
      sweep.afterFrame(FRAME_MS, 3);
      if (!half && sweep.progress >= 0.5) {
        half = true;
        expect(sweep.warmingUp).toBe(false);
        expect(sweep.presetNumber).toBe(0);
        expect(sweep.presetCount).toBe(1);
      }
    }
    expect(half).toBe(true);
  });

  it('stops on cancel, keeps the presets it finished and restores the view', () => {
    const scene = new FakeScene();
    const { sweep } = makeSweep(scene);
    sweep.start();
    while (sweep.active && sweep.runs.length < 1) {
      sweep.beforeFrame(FRAME_MS);
      sweep.afterFrame(FRAME_MS, 3);
    }
    expect(sweep.runs.map((r) => r.preset)).toEqual(['low']);
    sweep.cancel('Stopped with Esc.');
    expect(sweep.state).toBe('cancelled');
    expect(sweep.note).toBe('Stopped with Esc.');
    expect(sweep.runs).toHaveLength(1);
    expect(scene.log.slice(-3)).toEqual(['endRoute', 'governor:true', 'quality:balanced']);
    // Cancelling again, or drawing more frames, changes nothing.
    sweep.cancel();
    sweep.beforeFrame(FRAME_MS);
    sweep.afterFrame(FRAME_MS, 3);
    expect(sweep.runs).toHaveLength(1);
  });

  it('stops when the tab is hidden', () => {
    const scene = new FakeScene();
    const { sweep } = makeSweep(scene);
    sweep.start();
    play(sweep, scene, 20);
    fakeDocument.hidden = true;
    visibility?.();
    expect(sweep.state).toBe('cancelled');
    expect(sweep.note).toContain('hidden');
    expect(scene.quality.name).toBe('balanced');
  });

  it('can run again and starts clean', () => {
    const scene = new FakeScene();
    const { sweep, changes } = makeSweep(scene, ['low']);
    sweep.start();
    play(sweep, scene);
    expect(sweep.runs).toHaveLength(1);
    const before = changes();
    sweep.start();
    expect(sweep.runs).toHaveLength(0);
    expect(sweep.state).toBe('running');
    expect(changes()).toBeGreaterThan(before);
    play(sweep, scene);
    expect(sweep.runs).toHaveLength(1);
    expect(sweep.state).toBe('done');
  });

  it('flies the same route on a slow machine, in fewer frames', () => {
    const fast = new FakeScene();
    const slow = new FakeScene();
    const a = makeSweep(fast, ['balanced']).sweep;
    const b = makeSweep(slow, ['balanced']).sweep;
    a.start();
    b.start();
    play(a, fast, 5000, 1000 / 120);
    play(b, slow, 5000, 1000 / 30);
    expect(a.state).toBe('done');
    expect(b.state).toBe('done');
    const fastFrames = a.runs[0]?.report.frames.frames ?? 0;
    const slowFrames = b.runs[0]?.report.frames.frames ?? 0;
    expect(fastFrames).toBeGreaterThan(slowFrames * 2.5);
    // Both measured the same one-second route end to end.
    expect(fast.routeSeconds).toBe(slow.routeSeconds);
  });
});
