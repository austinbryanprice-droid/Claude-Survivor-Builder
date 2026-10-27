/**
 * A stand-in for the browser's audio context that renders nothing: it keeps every node the code
 * makes, what each one is joined to and every automation event written on its parameters, so that a
 * test can look at the sound a recipe builds. It throws where a browser throws (a ramp to zero on an
 * exponential curve, a source stopped before it was started, a start at a time before 0), which is
 * how a unit test catches a recipe that would fail in the player's browser.
 */

export type NodeKind =
  | 'gain'
  | 'oscillator'
  | 'filter'
  | 'buffer-source'
  | 'panner'
  | 'shaper'
  | 'convolver'
  | 'compressor'
  | 'destination';

export interface ParamEvent {
  readonly type: 'set' | 'linear' | 'exponential' | 'target';
  readonly value: number;
  readonly time: number;
  /** The time constant of a `target` event. */
  readonly constant?: number;
}

function domError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

export class FakeParam {
  readonly events: ParamEvent[] = [];
  /** The nodes that are joined into this parameter to move it (a low-frequency oscillator, for one). */
  readonly modulators: FakeNode[] = [];
  private current: number;

  constructor(
    readonly owner: FakeNode,
    readonly name: string,
    initial: number,
  ) {
    this.current = initial;
  }

  get value(): number {
    return this.current;
  }

  set value(next: number) {
    if (!Number.isFinite(next)) throw new TypeError(`${this.name} set to ${next}`);
    this.current = next;
  }

  private write(type: ParamEvent['type'], value: number, time: number, constant?: number): this {
    if (!Number.isFinite(value))
      throw new TypeError(`${this.name}: the value ${value} is not finite`);
    if (!Number.isFinite(time) || time < 0) {
      throw new RangeError(`${this.name}: ${time} is not a time on the clock`);
    }
    this.events.push(
      constant === undefined ? { type, value, time } : { type, value, time, constant },
    );
    return this;
  }

  setValueAtTime(value: number, time: number): this {
    return this.write('set', value, time);
  }

  linearRampToValueAtTime(value: number, time: number): this {
    return this.write('linear', value, time);
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    if (value === 0) throw new RangeError(`${this.name}: an exponential ramp cannot end at 0`);
    return this.write('exponential', value, time);
  }

  setTargetAtTime(value: number, time: number, constant: number): this {
    if (!(constant >= 0)) throw new RangeError(`${this.name}: a time constant of ${constant}`);
    return this.write('target', value, time, constant);
  }

  cancelScheduledValues(time: number): this {
    if (!Number.isFinite(time) || time < 0) throw new RangeError(`${this.name}: ${time}`);
    for (let i = this.events.length - 1; i >= 0; i--) {
      if ((this.events[i] as ParamEvent).time >= time) this.events.splice(i, 1);
    }
    return this;
  }

  /** The value the parameter has been told to hold at the end of its events, 0 when it has none. */
  get lastValue(): number {
    return this.events.length > 0
      ? (this.events[this.events.length - 1] as ParamEvent).value
      : this.current;
  }
}

export class FakeNode {
  /** What this node's output is joined to. */
  readonly outputs: (FakeNode | FakeParam)[] = [];
  disconnected = false;

  constructor(
    readonly kind: NodeKind,
    readonly context: FakeAudioContext,
  ) {
    context.nodes.push(this);
  }

  connect<T extends FakeNode | FakeParam>(destination: T): T {
    if (destination instanceof FakeNode && destination.context !== this.context) {
      throw domError('InvalidAccessError', 'nodes of different contexts cannot be joined');
    }
    this.outputs.push(destination);
    if (destination instanceof FakeParam) destination.modulators.push(this);
    return destination;
  }

  disconnect(): void {
    this.outputs.length = 0;
    this.disconnected = true;
  }

  protected param(name: string, initial: number): FakeParam {
    return new FakeParam(this, name, initial);
  }
}

export class FakeGain extends FakeNode {
  readonly gain = this.param('gain', 1);
  constructor(context: FakeAudioContext) {
    super('gain', context);
  }
}

export class FakePanner extends FakeNode {
  readonly pan = this.param('pan', 0);
  constructor(context: FakeAudioContext) {
    super('panner', context);
  }
}

export class FakeFilter extends FakeNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = this.param('frequency', 350);
  readonly Q = this.param('Q', 1);
  readonly gain = this.param('gain', 0);
  readonly detune = this.param('detune', 0);
  constructor(context: FakeAudioContext) {
    super('filter', context);
  }
}

export class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample: OverSampleType = 'none';
  constructor(context: FakeAudioContext) {
    super('shaper', context);
  }
}

export class FakeConvolver extends FakeNode {
  buffer: FakeBuffer | null = null;
  constructor(context: FakeAudioContext) {
    super('convolver', context);
  }
}

export class FakeCompressor extends FakeNode {
  readonly threshold = this.param('threshold', -24);
  readonly knee = this.param('knee', 30);
  readonly ratio = this.param('ratio', 12);
  readonly attack = this.param('attack', 0.003);
  readonly release = this.param('release', 0.25);
  constructor(context: FakeAudioContext) {
    super('compressor', context);
  }
}

export class FakeBuffer {
  readonly duration: number;
  private readonly data: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    if (numberOfChannels < 1 || numberOfChannels > 32 || length < 1 || !Number.isInteger(length)) {
      throw domError('NotSupportedError', `a buffer of ${numberOfChannels} x ${length}`);
    }
    if (sampleRate < 3000 || sampleRate > 768000) {
      throw domError('NotSupportedError', `a sample rate of ${sampleRate}`);
    }
    this.duration = length / sampleRate;
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    const data = this.data[channel];
    if (!data) throw domError('IndexSizeError', `no channel ${channel}`);
    return data;
  }

  copyToChannel(source: Float32Array, channel: number, offset = 0): void {
    const data = this.getChannelData(channel);
    if (offset > this.length) throw new RangeError(`an offset of ${offset}`);
    data.set(source.subarray(0, this.length - offset), offset);
  }
}

/** A node that starts and stops at moments on the audio clock. */
export class FakeSource extends FakeNode {
  /** The moment it was told to start at, or null. */
  startedAt: number | null = null;
  /** The moment it was last told to stop at, or null. */
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;

  start(when = 0): void {
    if (this.startedAt !== null) throw domError('InvalidStateError', 'start was called twice');
    if (!(when >= 0)) throw new RangeError(`a start at ${when}`);
    this.startedAt = when;
  }

  stop(when = 0): void {
    if (this.startedAt === null) throw domError('InvalidStateError', 'stop before start');
    if (!(when >= 0)) throw new RangeError(`a stop at ${when}`);
    this.stoppedAt = when;
  }
}

export class FakeOscillator extends FakeSource {
  type: OscillatorType = 'sine';
  readonly frequency = this.param('frequency', 440);
  readonly detune = this.param('detune', 0);
  constructor(context: FakeAudioContext) {
    super('oscillator', context);
  }
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  /** The part of the buffer it was told to play: where it starts, and for how long (null: to the end). */
  offset = 0;
  duration: number | null = null;
  readonly playbackRate = this.param('playbackRate', 1);
  constructor(context: FakeAudioContext) {
    super('buffer-source', context);
  }

  override start(when = 0, offset = 0, duration?: number): void {
    if (!(offset >= 0) || (duration !== undefined && !(duration >= 0))) {
      throw new RangeError(`a buffer played from ${offset} for ${duration}`);
    }
    super.start(when);
    this.offset = offset;
    this.duration = duration ?? null;
  }
}

export type FakeSourceNode = FakeOscillator | FakeBufferSource;

export class FakeAudioContext {
  readonly nodes: FakeNode[] = [];
  readonly sampleRate = 44100;
  currentTime = 0;
  state: AudioContextState = 'running';
  readonly destination = new FakeNode('destination', this);

  createGain(): FakeGain {
    return new FakeGain(this);
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator(this);
  }
  createBiquadFilter(): FakeFilter {
    return new FakeFilter(this);
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this);
  }
  createStereoPanner(): FakePanner {
    return new FakePanner(this);
  }
  createWaveShaper(): FakeShaper {
    return new FakeShaper(this);
  }
  createConvolver(): FakeConvolver {
    return new FakeConvolver(this);
  }
  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this);
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }

  /** Every node of one class that was made, in the order they were made. */
  ofType<T extends FakeNode>(type: abstract new (context: FakeAudioContext) => T): T[] {
    return this.nodes.filter((node): node is T => node instanceof type);
  }

  get oscillators(): FakeOscillator[] {
    return this.ofType(FakeOscillator);
  }

  get bufferSources(): FakeBufferSource[] {
    return this.ofType(FakeBufferSource);
  }

  get sources(): FakeSourceNode[] {
    return this.nodes.filter(
      (node): node is FakeSourceNode =>
        node instanceof FakeOscillator || node instanceof FakeBufferSource,
    );
  }
}

/** True when sound leaving `from` can reach `to`, through other nodes or the parameters of other nodes (a parameter feeds the node it belongs to). */
export function reaches(from: FakeNode, to: FakeNode): boolean {
  const seen = new Set<FakeNode>();
  const queue: FakeNode[] = [from];
  while (queue.length > 0) {
    const node = queue.pop() as FakeNode;
    if (node === to) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const out of node.outputs) queue.push(out instanceof FakeParam ? out.owner : out);
  }
  return false;
}

/** The second a source stops sounding: its stop time, or for a buffer played once, where its window ends; null when it plays on. */
export function endOf(source: FakeSourceNode): number | null {
  if (source.startedAt === null) return null;
  if (source.stoppedAt !== null) return source.stoppedAt;
  if (source instanceof FakeBufferSource && !source.loop && source.buffer) {
    const length = source.duration ?? source.buffer.duration - source.offset;
    return source.startedAt + length;
  }
  return null;
}

/** The context as the type the code under test takes. */
export function asContext(ctx: FakeAudioContext): BaseAudioContext {
  return ctx as unknown as BaseAudioContext;
}

export function asNode(node: FakeNode): AudioNode {
  return node as unknown as AudioNode;
}
