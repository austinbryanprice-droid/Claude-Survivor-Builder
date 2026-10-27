import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInput, type Input, type InputAction } from '../../src/engine/input';
import { createPlayerInput } from '../../src/shared/movement';

/** The few parts of the page the input reads, as event targets, so that it can be driven without a browser. */
class FakeDocument extends EventTarget {
  pointerLockElement: unknown = null;
  hidden = false;
  exitPointerLock = vi.fn(() => this.lose());

  grant(canvas: unknown): void {
    this.pointerLockElement = canvas;
    this.dispatchEvent(new Event('pointerlockchange'));
  }

  lose(): void {
    this.pointerLockElement = null;
    this.dispatchEvent(new Event('pointerlockchange'));
  }

  refuse(): void {
    this.dispatchEvent(new Event('pointerlockerror'));
  }
}

class FakeCanvas extends EventTarget {
  requestPointerLock = vi.fn((): Promise<void> => Promise.resolve());
}

function key(code: string, extra: Record<string, unknown> = {}): Event {
  return Object.assign(new Event('keydown', { cancelable: true }), {
    code,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...extra,
  });
}

function mouse(type: string, extra: Record<string, unknown> = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), {
    button: 0,
    movementX: 0,
    movementY: 0,
    ...extra,
  });
}

describe('holding the input while a film plays', () => {
  let doc: FakeDocument;
  let win: EventTarget;
  let canvas: FakeCanvas;
  let input: Input;

  beforeEach(() => {
    doc = new FakeDocument();
    win = new EventTarget();
    canvas = new FakeCanvas();
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', win);
    input = createInput(canvas as unknown as HTMLCanvasElement);
  });

  afterEach(() => {
    input.dispose();
    vi.unstubAllGlobals();
  });

  const keys = () => {
    const out = createPlayerInput();
    input.readKeys(out);
    return out;
  };
  const look = () => {
    const out = { dx: 0, dy: 0 };
    input.takeLook(out);
    return out;
  };

  it('listens to a locked pointer until it is held, and deaf while it is, with the pointer still in hand', () => {
    doc.grant(canvas);
    expect(input.locked).toBe(true);
    expect(input.captured).toBe(true);
    expect(input.held).toBe(false);

    win.dispatchEvent(key('KeyW'));
    expect(keys().forward).toBe(1);

    input.hold(true);
    expect(input.held).toBe(true);
    expect(input.locked).toBe(false);
    expect(input.captured).toBe(true);
    // What was pressed is let go of, and nothing new is counted.
    expect(keys().forward).toBe(0);
    win.dispatchEvent(key('KeyW'));
    win.dispatchEvent(key('Space'));
    expect(keys()).toMatchObject({ forward: 0, jump: false });
    doc.dispatchEvent(mouse('mousemove', { movementX: 40, movementY: 12 }));
    expect(look()).toEqual({ dx: 0, dy: 0 });
  });

  it('takes no clicks, wheel turns or hotbar keys while held, and takes them again when let go', () => {
    const pointer = vi.fn();
    const hotbar = vi.fn();
    input.onPointer(pointer);
    input.onHotbar(hotbar);
    doc.grant(canvas);
    input.hold(true);

    win.dispatchEvent(mouse('mousedown', { button: 0 }));
    win.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 300, deltaMode: 0 }));
    win.dispatchEvent(key('Digit3'));
    expect(pointer).not.toHaveBeenCalled();
    expect(hotbar).not.toHaveBeenCalled();

    input.hold(false);
    expect(input.locked).toBe(true);
    win.dispatchEvent(mouse('mousedown', { button: 0 }));
    expect(pointer).toHaveBeenCalledWith('primary', true);
    win.dispatchEvent(key('Digit3'));
    expect(hotbar).toHaveBeenCalledWith({ slot: 2 });
  });

  it('lets go of a button that was down when the hold began, so that nothing keeps firing', () => {
    const pointer = vi.fn();
    input.onPointer(pointer);
    doc.grant(canvas);
    win.dispatchEvent(mouse('mousedown', { button: 0 }));
    expect(pointer).toHaveBeenLastCalledWith('primary', true);
    input.hold(true);
    expect(pointer).toHaveBeenLastCalledWith('primary', false);
  });

  it('tells everyone when it is held and let go, and only when that changes something', () => {
    const changed = vi.fn();
    input.onChange(changed);
    doc.grant(canvas);
    expect(changed).toHaveBeenCalledTimes(1);
    input.hold(true);
    input.hold(true);
    expect(changed).toHaveBeenCalledTimes(2);
    input.hold(false);
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('can be held before the lock arrives, from inside the click that asks for it, so the lock arrives held', () => {
    const states: boolean[] = [];
    input.onChange(() => states.push(input.locked));
    input.onLockRequest(() => input.hold(true));

    input.requestLock();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(input.held).toBe(true);
    expect(input.captured).toBe(false);

    doc.grant(canvas);
    // The game was never told it had the pointer: it went from nothing to a held lock with no blip of play between.
    expect(input.locked).toBe(false);
    expect(input.captured).toBe(true);
    expect(input.held).toBe(true);
    expect(states.every((locked) => !locked)).toBe(true);

    input.hold(false);
    expect(input.locked).toBe(true);
    expect(states[states.length - 1]).toBe(true);
  });

  it('ends the hold by itself when the pointer is lost, so that the next lock is the player’s', () => {
    const changed = vi.fn();
    doc.grant(canvas);
    input.hold(true);
    input.onChange(changed);
    doc.lose();
    expect(input.held).toBe(false);
    expect(input.captured).toBe(false);
    expect(changed).toHaveBeenCalled();
    doc.grant(canvas);
    expect(input.locked).toBe(true);
  });

  it('ends the hold when an older browser refuses the pointer by an event, and says so until the next request', () => {
    // Older browsers answer a request with nothing, and report a refusal through `pointerlockerror`.
    canvas.requestPointerLock = vi.fn((): Promise<void> => undefined as unknown as Promise<void>);
    input.onLockRequest(() => input.hold(true));
    input.requestLock();
    expect(input.held).toBe(true);
    doc.refuse();
    expect(input.held).toBe(false);
    expect(input.blocked).toBe(true);
    // The next request starts clean: the refusal was about the one before.
    input.requestLock();
    expect(input.blocked).toBe(false);
  });

  it('ends the hold when the browser rejects the request, whether or not it also sends the event', async () => {
    canvas.requestPointerLock = vi.fn((): Promise<void> =>
      Promise.reject(new DOMException('no', 'SecurityError')),
    );
    input.onLockRequest(() => input.hold(true));
    input.requestLock();
    expect(input.held).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(input.held).toBe(false);
    expect(input.blocked).toBe(true);
    doc.refuse();
    expect(input.held).toBe(false);
  });

  it('keeps the hold when the refusal of the raw-movement request arrives after the plain lock has', () => {
    input.onLockRequest(() => input.hold(true));
    input.requestLock();
    doc.grant(canvas);
    // A browser that cannot give unaccelerated movement reports that, late, as an error event.
    doc.refuse();
    expect(input.captured).toBe(true);
    expect(input.held).toBe(true);
    expect(input.locked).toBe(false);
    expect(input.blocked).toBe(false);
  });

  it('keeps the hold when the raw-movement request fails and the plain one is still on its way', async () => {
    const answers: (() => void)[] = [];
    canvas.requestPointerLock = vi.fn(
      (options?: { unadjustedMovement?: boolean }): Promise<void> => {
        if (options?.unadjustedMovement) {
          return Promise.reject(new DOMException('not here', 'NotSupportedError'));
        }
        return new Promise<void>((resolve) => answers.push(resolve));
      },
    );
    input.onLockRequest(() => input.hold(true));
    input.requestLock();
    await Promise.resolve();
    await Promise.resolve();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(2);
    // The error event for the first request comes in while the second is still unanswered.
    doc.refuse();
    expect(input.held).toBe(true);
    expect(input.blocked).toBe(false);
    doc.grant(canvas);
    answers.forEach((answer) => answer());
    expect(input.held).toBe(true);
    expect(input.captured).toBe(true);
    expect(input.blocked).toBe(false);
  });

  it('still hears the keys that are not play: Esc as a cancel and F3 as the overlay', () => {
    const actions: InputAction[] = [];
    input.onAction((action) => actions.push(action));
    doc.grant(canvas);
    input.hold(true);
    win.dispatchEvent(key('Escape'));
    win.dispatchEvent(key('F3'));
    expect(actions).toEqual(['cancel', 'toggleOverlay']);
    // But the keys that are play are not heard.
    win.dispatchEvent(key('KeyB'));
    win.dispatchEvent(key('KeyE'));
    expect(actions).toEqual(['cancel', 'toggleOverlay']);
  });

  it('clicks on the canvas ask for the lock, and the asking can be heard', () => {
    const asked = vi.fn();
    input.onLockRequest(asked);
    canvas.dispatchEvent(new Event('click'));
    expect(asked).toHaveBeenCalledTimes(1);
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    doc.grant(canvas);
    canvas.dispatchEvent(new Event('click'));
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('stops listening for anything once it is disposed', () => {
    const asked = vi.fn();
    const stop = input.onLockRequest(asked);
    stop();
    input.requestLock();
    expect(asked).not.toHaveBeenCalled();
    input.dispose();
    input.requestLock();
    expect(asked).not.toHaveBeenCalled();
  });
});
