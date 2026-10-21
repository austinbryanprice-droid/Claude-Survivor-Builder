import type { BlockWorld, CellState } from '../shared/block-world';
import { MATERIALS, SHAPE, packState } from '../shared/blocks';
import { createAim, updateAim, type Aim } from '../shared/build-aim';
import type { GroundQuery } from '../shared/ground';
import type { Vec3 } from '../shared/look';
import type { BlockCommand } from '../shared/protocol';

/**
 * The player's building hands: which hotbar slot is selected, whether Build Mode is on, what the
 * cursor would do and the clicks that send it. It holds no DOM and no three.js, and reaches the
 * rest of the game through `BuildPorts`, so the tests can drive it with fakes. Nothing here
 * changes the world: a click becomes a command for the session, the host validates it, and the
 * world changes when the host's event comes back.
 */

export const HOTBAR_SLOTS = 8;

/** A held mouse button waits this long (seconds) before it repeats, then repeats this often. */
export const REPEAT_DELAY = 0.35;
export const REPEAT_INTERVAL = 0.15;
/** The same command is not sent twice within this long: the first answer may still be on its way. */
export const RESEND_GUARD = 0.5;
/** How long (seconds) a refusal stays on the screen after a click. */
export const NOTICE_SECONDS = 1.8;

/** The refusal shown when there is nobody to send a command to yet (the network code is still loading). */
export const NOT_READY = 'not-ready';

/** The pieces the hotbar starts with: one block of each material, in tier order. */
export const HOTBAR_PIECES: readonly CellState[] = MATERIALS.map((material) =>
  packState(SHAPE.cube, material.id),
);

export type Button = 'primary' | 'secondary';

/** How the crosshair looks: plain, over a surface a click could build on, or over one it could not. */
export type Crosshair = 'none' | 'place' | 'blocked';

/** What the HUD needs to draw the building hands. */
export interface BuildHudState {
  readonly selected: number;
  readonly buildMode: boolean;
  /** The piece the selected slot places, or 0 when the slot holds no block. */
  readonly piece: CellState;
  readonly crosshair: Crosshair;
  /** Why a click would do nothing right now (a world rule such as 'occupied', or the host's words), or null. */
  readonly refusal: string | null;
}

/** Where the player is looking from, as the camera has it this frame. */
export interface BuildView {
  /** The camera, which in third person is behind the player. */
  readonly origin: Vec3;
  /** The unit vector the camera looks along. */
  readonly dir: Vec3;
  /** The player's eyes: reach is measured from here. */
  readonly eye: Vec3;
}

/** What the controller needs from the rest of the game. */
export interface BuildPorts {
  /** The blocks of the world being played now. A getter: a joining player's world is replaced. */
  blocks(): BlockWorld;
  ground(): Pick<GroundQuery, 'distance'> | undefined;
  /** Asks the host to change the world. False when there is nobody to ask yet. */
  send(command: BlockCommand): boolean;
  /** The feet of every player who could be standing where a block goes, the local one first. */
  bodies(): readonly Vec3[];
  /** Called when Build Mode starts: bakes and compiles what the first block needs. */
  warmUp(): void;
}

export class BuildController {
  private selectedSlot = 0;
  private buildMode = false;
  private readonly aim: Aim = createAim();
  private clock = 0;
  private notice: string | null = null;
  private noticeUntil = 0;
  private lastKey = '';
  private lastSentAt = -Infinity;
  /** Seconds until each held button repeats; negative while it is up. */
  private readonly held: Record<Button, number> = { primary: -1, secondary: -1 };
  private readonly state: {
    selected: number;
    buildMode: boolean;
    piece: CellState;
    crosshair: Crosshair;
    refusal: string | null;
  } = {
    selected: 0,
    buildMode: false,
    piece: HOTBAR_PIECES[0] ?? 0,
    crosshair: 'none',
    refusal: null,
  };

  constructor(private readonly ports: BuildPorts) {}

  get selected(): number {
    return this.selectedSlot;
  }

  /** The piece each hotbar slot places, from the first slot; the slots after them hold no block. */
  get pieces(): readonly CellState[] {
    return HOTBAR_PIECES;
  }

  get inBuildMode(): boolean {
    return this.buildMode;
  }

  /** The piece a click places: the selected slot's block, or 0 when the slot holds none. */
  get piece(): CellState {
    return HOTBAR_PIECES[this.selectedSlot] ?? 0;
  }

  /** What the cursor is on and what a click would do there, as of the last `update`. */
  get target(): Readonly<Aim> {
    return this.aim;
  }

  selectSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SLOTS) return;
    this.selectedSlot = slot;
  }

  /** Moves the selection by whole slots (the mouse wheel), wrapping around the ends. */
  scrollSlot(steps: number): void {
    this.selectedSlot =
      (((this.selectedSlot + steps) % HOTBAR_SLOTS) + HOTBAR_SLOTS) % HOTBAR_SLOTS;
  }

  toggleBuildMode(): void {
    this.buildMode = !this.buildMode;
    this.notice = null;
    if (this.buildMode) this.ports.warmUp();
  }

  /** A mouse button went down: it acts once now and again while it stays down. */
  press(button: Button): void {
    this.fire(button);
    this.held[button] = REPEAT_DELAY;
  }

  release(button: Button): void {
    this.held[button] = -1;
  }

  releaseAll(): void {
    this.held.primary = -1;
    this.held.secondary = -1;
  }

  /** The host refused a command that was sent: show why for a moment. */
  noteRejection(reason: string): void {
    this.setNotice(reason);
  }

  /** Aims for this frame and repeats whatever a held button is doing. */
  update(dt: number, view: BuildView): void {
    this.clock += dt;
    updateAim(this.aim, {
      blocks: this.ports.blocks(),
      ground: this.ports.ground(),
      origin: view.origin,
      dir: view.dir,
      eye: view.eye,
      piece: this.piece,
      bodies: this.ports.bodies(),
    });
    for (const button of ['primary', 'secondary'] as const) {
      if (this.held[button] < 0) continue;
      this.held[button] -= dt;
      if (this.held[button] <= 0) {
        this.fire(button);
        this.held[button] = REPEAT_INTERVAL;
      }
    }
  }

  /** The state the HUD draws; the same object each time, so read it, do not keep it. */
  hudState(): BuildHudState {
    const aim = this.aim;
    const state = this.state;
    state.selected = this.selectedSlot;
    state.buildMode = this.buildMode;
    state.piece = this.piece;
    if (!aim.hasPlace) state.crosshair = 'none';
    else if (!aim.placeRefusal) state.crosshair = 'place';
    else state.crosshair = this.buildMode ? 'blocked' : 'none';
    const showing = this.notice !== null && this.clock < this.noticeUntil;
    if (showing) state.refusal = this.notice;
    else if (this.buildMode && aim.hasPlace) state.refusal = aim.placeRefusal;
    else state.refusal = null;
    return state;
  }

  private fire(button: Button): void {
    if (button === 'primary') this.breakTarget();
    else this.placePiece();
  }

  private placePiece(): void {
    const piece = this.piece;
    // A slot that holds no block has nothing to place; interacting with what is aimed at comes with the modules.
    if (piece === 0) return;
    const aim = this.aim;
    if (!aim.hasPlace) return;
    if (aim.placeRefusal) {
      this.setNotice(aim.placeRefusal);
      return;
    }
    this.send({ type: 'place', x: aim.place.x, y: aim.place.y, z: aim.place.z, state: piece });
  }

  private breakTarget(): void {
    const aim = this.aim;
    if (aim.on !== 'block') return;
    if (aim.breakRefusal) {
      this.setNotice(aim.breakRefusal);
      return;
    }
    this.send({ type: 'break', x: aim.target.x, y: aim.target.y, z: aim.target.z });
  }

  private send(command: BlockCommand): void {
    const state = command.type === 'place' ? command.state : 0;
    const key = `${command.type} ${command.x} ${command.y} ${command.z} ${state}`;
    if (key === this.lastKey && this.clock - this.lastSentAt < RESEND_GUARD) return;
    if (!this.ports.send(command)) {
      this.setNotice(NOT_READY);
      return;
    }
    this.lastKey = key;
    this.lastSentAt = this.clock;
  }

  private setNotice(text: string): void {
    this.notice = text;
    this.noticeUntil = this.clock + NOTICE_SECONDS;
  }
}
