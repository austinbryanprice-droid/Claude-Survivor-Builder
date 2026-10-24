import type { PlayerInput } from '../shared/movement';

/** Things the player can ask for that are not movement. */
export type InputAction =
  | 'toggleCamera'
  | 'toggleOverlay'
  | 'cycleQuality'
  | 'toggleBuild'
  | 'cycleShape'
  | 'turnPiece'
  | 'interact'
  | 'cancel';

/** The two mouse buttons the game uses: left breaks or attacks, right places or interacts. */
export type PointerButton = 'primary' | 'secondary';

/** A change to the selected hotbar slot: a number key names one, the mouse wheel steps. */
export type HotbarChange = { readonly slot: number } | { readonly step: number };

export interface LookDelta {
  dx: number;
  dy: number;
}

export interface Input {
  /** True while the pointer is locked to the canvas. Movement keys only count while it is. */
  readonly locked: boolean;
  /** True after the browser refused a lock request, until a request succeeds. */
  readonly blocked: boolean;
  requestLock(): void;
  releaseLock(): void;
  /** Mouse movement in CSS pixels since the previous call; zero unless the pointer is locked. */
  takeLook(out: LookDelta): void;
  /** Writes the movement keys into `out` (everything but yaw); neutral unless the pointer is locked. */
  readKeys(out: PlayerInput): void;
  /** Called when the lock state changes or a request is refused. */
  onChange(listener: () => void): () => void;
  onAction(listener: (action: InputAction) => void): () => void;
  /** Called when a mouse button goes down (only while the pointer is locked) and when it comes up. */
  onPointer(listener: (button: PointerButton, down: boolean) => void): () => void;
  /** Called for a number key or a turn of the mouse wheel, only while the pointer is locked. */
  onHotbar(listener: (change: HotbarChange) => void): () => void;
  dispose(): void;
}

// Physical keys (event.code), so WASD sits in the same place on every keyboard layout.
const FORWARD = 'KeyW';
const BACK = 'KeyS';
const LEFT = 'KeyA';
const RIGHT = 'KeyD';
const JUMP = 'Space';
const SPRINT = ['ShiftLeft', 'ShiftRight'];
const CAMERA_KEYS = ['KeyV', 'F5'];
const OVERLAY_KEY = 'F3';
const QUALITY_KEY = 'KeyP';
const BUILD_KEY = 'KeyB';
const SHAPE_KEY = 'KeyQ';
const TURN_KEY = 'KeyR';
const INTERACT_KEY = 'KeyE';
const CANCEL_KEY = 'Escape';
const HOTBAR_KEY = /^Digit([1-9])$/;

const HELD_KEYS = new Set([FORWARD, BACK, LEFT, RIGHT, JUMP, ...SPRINT]);
/** Keys the page must not act on while the game has the mouse (scrolling, reloading, button clicks). */
const SWALLOWED_KEYS = new Set([
  ...HELD_KEYS,
  ...CAMERA_KEYS,
  OVERLAY_KEY,
  QUALITY_KEY,
  BUILD_KEY,
  SHAPE_KEY,
  TURN_KEY,
  INTERACT_KEY,
]);

/** Browsers can report one huge movement when the lock starts; no real flick is this large in one event. */
const MAX_MOVEMENT = 400;
/** Pixels of wheel movement that make one hotbar step; a notch of a wheel is 100, a trackpad sends many small ones. */
const WHEEL_STEP = 60;
/** The pixels a wheel event that reports lines or pages stands for. */
const WHEEL_LINE = 16;
const WHEEL_PAGE = 400;

export function createInput(canvas: HTMLCanvasElement): Input {
  const pressed = new Set<string>();
  const changeListeners = new Set<() => void>();
  const actionListeners = new Set<(action: InputAction) => void>();
  const pointerListeners = new Set<(button: PointerButton, down: boolean) => void>();
  const hotbarListeners = new Set<(change: HotbarChange) => void>();
  const buttonsDown = new Set<PointerButton>();
  let wheel = 0;
  let lookX = 0;
  let lookY = 0;
  let skipNextMove = false;
  let blocked = false;

  const isLocked = (): boolean => document.pointerLockElement === canvas;
  const emitChange = (): void => changeListeners.forEach((listener) => listener());
  const emitAction = (action: InputAction): void => actionListeners.forEach((l) => l(action));
  const emitPointer = (button: PointerButton, down: boolean): void =>
    pointerListeners.forEach((l) => l(button, down));
  const emitHotbar = (change: HotbarChange): void => hotbarListeners.forEach((l) => l(change));

  /** Lets go of every mouse button the game thinks is down, so nothing keeps repeating. */
  const releaseButtons = (): void => {
    for (const button of [...buttonsDown]) {
      buttonsDown.delete(button);
      emitPointer(button, false);
    }
  };

  const refused = (): void => {
    blocked = true;
    emitChange();
  };

  /**
   * Asks for raw (unaccelerated) mouse movement first, which keeps aim consistent on systems
   * with pointer acceleration, and falls back to a plain lock where that is not supported.
   */
  const requestLock = (): void => {
    const attempt = (unadjusted: boolean): void => {
      let pending: Promise<void> | undefined;
      try {
        pending = unadjusted
          ? canvas.requestPointerLock({ unadjustedMovement: true })
          : canvas.requestPointerLock();
      } catch {
        refused();
        return;
      }
      // Older browsers return nothing and report failure through the `pointerlockerror` event only.
      if (pending instanceof Promise) {
        pending.catch((error: unknown) => {
          const unsupported = error instanceof DOMException && error.name === 'NotSupportedError';
          if (unadjusted && unsupported) attempt(false);
          else refused();
        });
      }
    };
    attempt(true);
  };

  const onLockChange = (): void => {
    pressed.clear();
    releaseButtons();
    wheel = 0;
    lookX = 0;
    lookY = 0;
    skipNextMove = isLocked();
    if (isLocked()) blocked = false;
    emitChange();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const locked = isLocked();
    const code = event.code;
    if (code === OVERLAY_KEY) {
      event.preventDefault();
      if (!event.repeat) emitAction('toggleOverlay');
      return;
    }
    if (code === CANCEL_KEY) {
      if (!event.repeat) emitAction('cancel');
      return;
    }
    // F5 reloads the page, which would throw away a run. While playing it toggles the camera
    // instead; with the mouse released it is left alone so the page can still be reloaded.
    // Browser shortcuts (Ctrl+R, Ctrl+F5, Cmd+W and the like) always pass through.
    if (!locked || event.ctrlKey || event.metaKey || event.altKey) return;
    if (SWALLOWED_KEYS.has(code)) event.preventDefault();
    if (CAMERA_KEYS.includes(code)) {
      if (!event.repeat) emitAction('toggleCamera');
      return;
    }
    if (code === QUALITY_KEY) {
      if (!event.repeat) emitAction('cycleQuality');
      return;
    }
    if (code === BUILD_KEY) {
      if (!event.repeat) emitAction('toggleBuild');
      return;
    }
    if (code === SHAPE_KEY) {
      if (!event.repeat) emitAction('cycleShape');
      return;
    }
    if (code === TURN_KEY) {
      if (!event.repeat) emitAction('turnPiece');
      return;
    }
    if (code === INTERACT_KEY) {
      if (!event.repeat) emitAction('interact');
      return;
    }
    const digit = HOTBAR_KEY.exec(code);
    if (digit) {
      if (!event.repeat) emitHotbar({ slot: Number(digit[1]) - 1 });
      return;
    }
    if (HELD_KEYS.has(code)) pressed.add(code);
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    pressed.delete(event.code);
    if (isLocked() && SWALLOWED_KEYS.has(event.code)) event.preventDefault();
  };

  const onMouseMove = (event: MouseEvent): void => {
    if (!isLocked()) return;
    if (skipNextMove) {
      skipNextMove = false;
      return;
    }
    lookX += Math.max(-MAX_MOVEMENT, Math.min(MAX_MOVEMENT, event.movementX));
    lookY += Math.max(-MAX_MOVEMENT, Math.min(MAX_MOVEMENT, event.movementY));
  };

  const buttonOf = (event: MouseEvent): PointerButton | null =>
    event.button === 0 ? 'primary' : event.button === 2 ? 'secondary' : null;

  const onMouseDown = (event: MouseEvent): void => {
    const button = buttonOf(event);
    if (!button || !isLocked()) return;
    event.preventDefault();
    if (buttonsDown.has(button)) return;
    buttonsDown.add(button);
    emitPointer(button, true);
  };

  const onMouseUp = (event: MouseEvent): void => {
    const button = buttonOf(event);
    if (!button || !buttonsDown.delete(button)) return;
    emitPointer(button, false);
  };

  const onWheel = (event: WheelEvent): void => {
    if (!isLocked()) return;
    const scale = event.deltaMode === 1 ? WHEEL_LINE : event.deltaMode === 2 ? WHEEL_PAGE : 1;
    const delta = event.deltaY * scale;
    // A change of direction starts over, so a flick back is not eaten by what was left of the last one.
    wheel = Math.sign(delta) === Math.sign(wheel) ? wheel + delta : delta;
    if (Math.abs(wheel) < WHEEL_STEP) return;
    emitHotbar({ step: wheel > 0 ? 1 : -1 });
    wheel = 0;
  };

  const onCanvasClick = (): void => {
    if (!isLocked()) requestLock();
  };
  const onContextMenu = (event: Event): void => event.preventDefault();
  const onBlur = (): void => pressed.clear();
  const onVisibility = (): void => {
    if (document.hidden) pressed.clear();
  };

  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', refused);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('wheel', onWheel, { passive: true });
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('contextmenu', onContextMenu);

  const axis = (positive: string, negative: string): number =>
    (pressed.has(positive) ? 1 : 0) - (pressed.has(negative) ? 1 : 0);

  return {
    get locked() {
      return isLocked();
    },
    get blocked() {
      return blocked;
    },
    requestLock,
    releaseLock: () => document.exitPointerLock(),
    takeLook(out) {
      out.dx = lookX;
      out.dy = lookY;
      lookX = 0;
      lookY = 0;
    },
    readKeys(out) {
      const active = isLocked();
      out.forward = active ? axis(FORWARD, BACK) : 0;
      out.strafe = active ? axis(RIGHT, LEFT) : 0;
      out.jump = active && pressed.has(JUMP);
      out.sprint = active && SPRINT.some((code) => pressed.has(code));
    },
    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    onAction(listener) {
      actionListeners.add(listener);
      return () => actionListeners.delete(listener);
    },
    onPointer(listener) {
      pointerListeners.add(listener);
      return () => pointerListeners.delete(listener);
    },
    onHotbar(listener) {
      hotbarListeners.add(listener);
      return () => hotbarListeners.delete(listener);
    },
    dispose() {
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', refused);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('click', onCanvasClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      changeListeners.clear();
      actionListeners.clear();
      pointerListeners.clear();
      hotbarListeners.clear();
    },
  };
}
