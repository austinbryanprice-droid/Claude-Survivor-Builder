import type { PlayerInput } from '../shared/movement';

/** Things the player can ask for that are not movement. */
export type InputAction = 'toggleCamera' | 'toggleOverlay' | 'cycleQuality' | 'cancel';

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
const CANCEL_KEY = 'Escape';

const HELD_KEYS = new Set([FORWARD, BACK, LEFT, RIGHT, JUMP, ...SPRINT]);
/** Keys the page must not act on while the game has the mouse (scrolling, reloading, button clicks). */
const SWALLOWED_KEYS = new Set([...HELD_KEYS, ...CAMERA_KEYS, OVERLAY_KEY, QUALITY_KEY]);

/** Browsers can report one huge movement when the lock starts; no real flick is this large in one event. */
const MAX_MOVEMENT = 400;

export function createInput(canvas: HTMLCanvasElement): Input {
  const pressed = new Set<string>();
  const changeListeners = new Set<() => void>();
  const actionListeners = new Set<(action: InputAction) => void>();
  let lookX = 0;
  let lookY = 0;
  let skipNextMove = false;
  let blocked = false;

  const isLocked = (): boolean => document.pointerLockElement === canvas;
  const emitChange = (): void => changeListeners.forEach((listener) => listener());
  const emitAction = (action: InputAction): void => actionListeners.forEach((l) => l(action));

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
    dispose() {
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', refused);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('click', onCanvasClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      changeListeners.clear();
      actionListeners.clear();
    },
  };
}
