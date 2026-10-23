import type { BlockWorld, CellState } from '../shared/block-world';
import { MATERIALS, SHAPE_KINDS, baseShape, packState, type ShapeKind } from '../shared/blocks';
import { createAim, updateAim, type Aim } from '../shared/build-aim';
import type { GroundQuery } from '../shared/ground';
import type { Vec3 } from '../shared/look';
import { nextTurn, type PieceChoice } from '../shared/placement';
import type { BlockCommand } from '../shared/protocol';
import { BLASTER } from '../systems/survival/balance';

/**
 * The player's hands: which hotbar slot is selected, which kind of shape it makes and how that is
 * turned, whether Build Mode is on, what the cursor would do and the clicks that send it, and the
 * pulse blaster in the slot after the blocks. It holds no DOM and no three.js, and reaches the
 * rest of the game through `BuildPorts`, so the tests can drive it with fakes. Nothing here
 * changes the world: a click becomes a command (or a shot) for the session, the host validates it,
 * and the world changes (or the machine is hurt) when the host's word comes back.
 */

export const HOTBAR_SLOTS = 8;

/** A held mouse button waits this long (seconds) before it repeats, then repeats this often. */
export const REPEAT_DELAY = 0.35;
export const REPEAT_INTERVAL = 0.15;
/** However worn down the player is, a held button repeats at no less than this fraction of its normal rate. */
export const MIN_HAND_SCALE = 0.25;
/** The same command is not sent twice within this long: the first answer may still be on its way. */
export const RESEND_GUARD = 0.5;
/** How long (seconds) a refusal stays on the screen after a click. */
export const NOTICE_SECONDS = 1.8;

/** The refusal shown when there is nobody to send a command to yet (the network code is still loading). */
export const NOT_READY = 'not-ready';

/** The material each of the first hotbar slots builds with, in tier order; the slots after them hold no block. */
export const HOTBAR_MATERIALS: readonly number[] = MATERIALS.map((material) => material.id);

/** The slot after the materials holds the pulse blaster: with it in hand the left button fires it instead of breaking a block. */
export const BLASTER_SLOT = HOTBAR_MATERIALS.length;

export type Button = 'primary' | 'secondary';

/**
 * How the crosshair looks: plain, over a surface a click could build on, or over one it could not,
 * or the blaster's sight while the blaster is in hand.
 */
export type Crosshair = 'none' | 'place' | 'blocked' | 'blaster';

/** What the HUD needs to draw the building hands. */
export interface BuildHudState {
  readonly selected: number;
  readonly buildMode: boolean;
  /** The kind of shape every block slot makes now: the shape key chooses it. */
  readonly kind: ShapeKind;
  /** How far the turn key has turned the piece from the way the aim would put it. */
  readonly turn: number;
  /** The piece the selected slot makes in that kind, before it is turned, or 0 when the slot holds no block. */
  readonly piece: CellState;
  readonly crosshair: Crosshair;
  /** Why a click would do nothing right now (a world rule such as 'occupied', or the host's words), or null. */
  readonly refusal: string | null;
  /** The pulse blaster is in hand. */
  readonly blaster: boolean;
  /** How many of the player's shots the host has said hit a machine so far; a rise is a hit marker to show. */
  readonly hits: number;
  /** Whether the latest of those felled its machine. */
  readonly kill: boolean;
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
  /** Fires the pulse blaster from the camera at `origin` along the unit vector `dir`. False when there is nobody to ask yet. */
  fire(origin: Vec3, dir: Vec3): boolean;
}

export class BuildController {
  private selectedSlot = 0;
  private shapeKind: ShapeKind = 'cube';
  private turnSteps = 0;
  private buildMode = false;
  private readonly aim: Aim = createAim();
  private readonly pick: { material: number; kind: ShapeKind; turn: number } = {
    material: 0,
    kind: 'cube',
    turn: 0,
  };
  private clock = 0;
  /** How fast a held button repeats, as a fraction of normal; low Energy slows it. */
  private repeatScale = 1;
  /** The player is down: the hands do nothing until they are back on their feet. */
  private down = false;
  /** Seconds of the hands' time until the blaster is ready again. */
  private cooldown = 0;
  /** Where the camera was and which way it looked at the last `update`: what a shot is aimed with. */
  private readonly sight: { origin: Vec3; dir: Vec3 } = {
    origin: { x: 0, y: 0, z: 0 },
    dir: { x: 0, y: 0, z: 0 },
  };
  private sighted = false;
  private hitCount = 0;
  private lastKill = false;
  private notice: string | null = null;
  private noticeUntil = 0;
  private lastKey = '';
  private lastSentAt = -Infinity;
  /** Seconds until each held button repeats; negative while it is up. */
  private readonly held: Record<Button, number> = { primary: -1, secondary: -1 };
  private readonly state: {
    selected: number;
    buildMode: boolean;
    kind: ShapeKind;
    turn: number;
    piece: CellState;
    crosshair: Crosshair;
    refusal: string | null;
    blaster: boolean;
    hits: number;
    kill: boolean;
  } = {
    selected: 0,
    buildMode: false,
    kind: 'cube',
    turn: 0,
    piece: 0,
    crosshair: 'none',
    refusal: null,
    blaster: false,
    hits: 0,
    kill: false,
  };

  constructor(private readonly ports: BuildPorts) {}

  get selected(): number {
    return this.selectedSlot;
  }

  /** How fast a held button repeats right now, as a fraction of normal (1 unless Energy is low). */
  get handScale(): number {
    return this.repeatScale;
  }

  /** The player is down: the hands do nothing. */
  get isDown(): boolean {
    return this.down;
  }

  /** The kind of shape the block slots make: a block, a slab or a wedge. */
  get kind(): ShapeKind {
    return this.shapeKind;
  }

  /** How many turn steps the piece is from the way the aim would put it. */
  get turn(): number {
    return this.turnSteps;
  }

  get inBuildMode(): boolean {
    return this.buildMode;
  }

  /** Whether the pulse blaster is in hand. */
  get armed(): boolean {
    return this.selectedSlot === BLASTER_SLOT;
  }

  /** The piece the selected slot makes in the chosen kind before the aim turns it, or 0 when the slot holds no block. */
  get piece(): CellState {
    const material = HOTBAR_MATERIALS[this.selectedSlot];
    return material === undefined ? 0 : packState(baseShape(this.shapeKind), material);
  }

  /** What a click would make for the aim to orient, or null when the selected slot holds no block. */
  get choice(): PieceChoice | null {
    const material = HOTBAR_MATERIALS[this.selectedSlot];
    if (material === undefined) return null;
    this.pick.material = material;
    this.pick.kind = this.shapeKind;
    this.pick.turn = this.turnSteps;
    return this.pick;
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

  /** Chooses the next kind of shape: a block, then a slab, then a wedge, then a block again. The turn starts over. */
  cycleShape(): void {
    const at = SHAPE_KINDS.indexOf(this.shapeKind);
    this.shapeKind = SHAPE_KINDS[(at + 1) % SHAPE_KINDS.length] ?? 'cube';
    this.turnSteps = 0;
  }

  /** Turns the piece one step further from the way the aim would put it; a block has no other way. */
  turnPiece(): void {
    this.turnSteps = nextTurn(this.shapeKind, this.turnSteps);
  }

  /**
   * Slows how often a held button repeats to this fraction of normal (1 is normal), which is what
   * low Energy does to the hands. A single click always acts at once.
   */
  setHandScale(scale: number): void {
    this.repeatScale = Number.isFinite(scale) ? Math.min(1, Math.max(MIN_HAND_SCALE, scale)) : 1;
  }

  /** A player who is down cannot build, break or shoot: the buttons are let go and do nothing until they are up again. */
  setDown(down: boolean): void {
    if (down === this.down) return;
    this.down = down;
    if (down) this.releaseAll();
  }

  toggleBuildMode(): void {
    this.buildMode = !this.buildMode;
    this.notice = null;
    if (this.buildMode) this.ports.warmUp();
  }

  /** A mouse button went down: it acts once now and again while it stays down. */
  press(button: Button): void {
    this.act(button);
    this.held[button] = this.repeatDelay(button);
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

  /** The host said one of the player's shots hit a machine (and felled it, if `kill`): the HUD marks it. */
  noteHit(kill: boolean): void {
    this.hitCount++;
    this.lastKill = kill;
  }

  /** Aims for this frame and repeats whatever a held button is doing. */
  update(dt: number, view: BuildView): void {
    this.clock += dt;
    this.cooldown = Math.max(0, this.cooldown - dt * this.repeatScale);
    this.sight.origin.x = view.origin.x;
    this.sight.origin.y = view.origin.y;
    this.sight.origin.z = view.origin.z;
    this.sight.dir.x = view.dir.x;
    this.sight.dir.y = view.dir.y;
    this.sight.dir.z = view.dir.z;
    this.sighted = true;
    updateAim(this.aim, {
      blocks: this.ports.blocks(),
      ground: this.ports.ground(),
      origin: view.origin,
      dir: view.dir,
      eye: view.eye,
      piece: this.choice,
      bodies: this.ports.bodies(),
    });
    for (const button of ['primary', 'secondary'] as const) {
      if (this.held[button] < 0) continue;
      this.held[button] -= dt * this.repeatScale;
      if (this.held[button] <= 0) {
        this.act(button);
        this.held[button] = this.repeatInterval(button);
      }
    }
  }

  /** The state the HUD draws; the same object each time, so read it, do not keep it. */
  hudState(): BuildHudState {
    const aim = this.aim;
    const state = this.state;
    state.selected = this.selectedSlot;
    state.buildMode = this.buildMode;
    state.kind = this.shapeKind;
    state.turn = this.turnSteps;
    state.piece = this.piece;
    state.blaster = this.armed;
    state.hits = this.hitCount;
    state.kill = this.lastKill;
    if (this.armed) state.crosshair = 'blaster';
    else if (!aim.hasPlace) state.crosshair = 'none';
    else if (!aim.placeRefusal) state.crosshair = 'place';
    else state.crosshair = this.buildMode ? 'blocked' : 'none';
    const showing = this.notice !== null && this.clock < this.noticeUntil;
    if (showing) state.refusal = this.notice;
    else if (this.buildMode && aim.hasPlace) state.refusal = aim.placeRefusal;
    else state.refusal = null;
    return state;
  }

  /** What a button does now: the left one fires the blaster when it is in hand and breaks a block otherwise; the right one places. */
  private act(button: Button): void {
    if (this.down) return;
    if (button === 'primary') {
      if (this.armed) this.shoot();
      else this.breakTarget();
    } else this.placePiece();
  }

  /** How long a button is held before it repeats, and then how often: a blaster's pace is its own. */
  private repeatDelay(button: Button): number {
    return button === 'primary' && this.armed ? BLASTER.interval : REPEAT_DELAY;
  }

  private repeatInterval(button: Button): number {
    return button === 'primary' && this.armed ? BLASTER.interval : REPEAT_INTERVAL;
  }

  /** Fires along the line the camera looked at the last frame, if the blaster is ready; the host has the final word. */
  private shoot(): void {
    if (!this.sighted || this.cooldown > 0) return;
    if (!this.ports.fire(this.sight.origin, this.sight.dir)) {
      this.setNotice(NOT_READY);
      return;
    }
    this.cooldown = BLASTER.interval;
  }

  private placePiece(): void {
    // A slot that holds no block has nothing to place; interacting with what is aimed at comes with the modules.
    if (this.choice === null) return;
    const aim = this.aim;
    if (!aim.hasPlace) return;
    if (aim.placeRefusal) {
      this.setNotice(aim.placeRefusal);
      return;
    }
    this.send({ type: 'place', x: aim.place.x, y: aim.place.y, z: aim.place.z, state: aim.state });
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
