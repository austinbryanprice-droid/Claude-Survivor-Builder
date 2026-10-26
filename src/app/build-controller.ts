import type { BlockWorld, CellState } from '../shared/block-world';
import {
  MATERIALS,
  MODULES,
  SHAPE_KINDS,
  baseShape,
  moduleShape,
  packState,
  type BlockKind,
  type ShapeKind,
} from '../shared/blocks';
import { createAim, updateAim, type Aim } from '../shared/build-aim';
import { createEconomyReading } from '../shared/economy';
import type { GroundQuery } from '../shared/ground';
import type { Vec3 } from '../shared/look';
import { nextTurn, type PieceChoice } from '../shared/placement';
import type { BlockCommand } from '../shared/protocol';
import { aimAtDebris, createDebrisAim, type DebrisAim } from '../systems/economy/aim';
import { DEBRIS } from '../systems/economy/balance';
import { placementRefusal, type PlacementEconomy } from '../systems/economy/build-rules';
import { BLASTER } from '../systems/survival/balance';

/**
 * The player's hands: which hotbar slot is selected, which kind of shape it makes and how that is
 * turned, whether Build Mode is on, what the cursor would do and the clicks that send it, the
 * pulse blaster in the slot after the blocks, the module slot after the blaster, and the interact
 * key that strips a heap of debris the cursor is on. It holds no DOM and no three.js, and reaches the
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

/** The slot after the blaster holds the functional modules: the shape key chooses which one, and the right button places it. */
export const MODULE_SLOT = BLASTER_SLOT + 1;

/** The modules the module slot chooses between, in the order the shape key cycles through them. */
export const HOTBAR_MODULES: readonly number[] = MODULES.map((module) => module.id);

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
  readonly kind: BlockKind;
  /** The module the module slot holds now (`MODULE`): the shape key chooses it while that slot is in hand. */
  readonly module: number;
  /** How far the turn key has turned the piece from the way the aim would put it. */
  readonly turn: number;
  /** The piece the selected slot makes in that kind, before it is turned, or 0 when the slot holds nothing to place. */
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
  /** Strips left of the heap of debris the cursor is on and the player can reach (the interact key strips one), or 0 when it is on none. */
  readonly salvage: number;
  /** The material that heap gives, as a `MATERIAL` id; 0 when the cursor is on none. */
  readonly salvageGrade: number;
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
  /**
   * The crew's pool and the heaps of debris lying in the valley being played, as this screen has
   * them: what the host will check a block against, and what the interact key strips. A getter: a
   * new run has a new economy.
   */
  economy(): PlacementEconomy;
}

export class BuildController {
  private selectedSlot = 0;
  private shapeKind: BlockKind = 'cube';
  private moduleIndex = 0;
  private turnSteps = 0;
  private buildMode = false;
  private readonly aim: Aim = createAim();
  private readonly pick: {
    material: number;
    kind: ShapeKind;
    turn: number;
    module: number;
  } = {
    material: 0,
    kind: 'cube',
    turn: 0,
    module: 0,
  };
  private clock = 0;
  /** How fast a held button repeats, as a fraction of normal; low Energy slows it. */
  private repeatScale = 1;
  /** The player is down: the hands do nothing until they are back on their feet. */
  private down = false;
  /** Seconds of the hands' time until the blaster is ready again. */
  private cooldown = 0;
  /** Seconds of the hands' time until they strip another heap. */
  private salvageCooldown = 0;
  /** The heap of debris the cursor was on at the last `update`. */
  private readonly heap: DebrisAim = createDebrisAim();
  /** The pool as it was read for the last question about a placement. */
  private readonly pool = createEconomyReading();
  /** The host's economic rules for a placement, asked of this screen's view of the economy, so the ghost shows what the host would say. */
  private readonly houseRules = (
    x: number,
    y: number,
    z: number,
    state: CellState,
  ): string | null => placementRefusal(this.ports.economy(), this.pool, x, y, z, state);
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
    kind: BlockKind;
    module: number;
    turn: number;
    piece: CellState;
    crosshair: Crosshair;
    refusal: string | null;
    blaster: boolean;
    hits: number;
    kill: boolean;
    salvage: number;
    salvageGrade: number;
  } = {
    selected: 0,
    buildMode: false,
    kind: 'cube',
    module: 0,
    turn: 0,
    piece: 0,
    crosshair: 'none',
    refusal: null,
    blaster: false,
    hits: 0,
    kill: false,
    salvage: 0,
    salvageGrade: 0,
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
  get kind(): BlockKind {
    return this.shapeKind;
  }

  /** Whether the module slot is in hand. */
  get modular(): boolean {
    return this.selectedSlot === MODULE_SLOT;
  }

  /** The module the module slot holds (`MODULE`), or 0 when the game has none. */
  get module(): number {
    return HOTBAR_MODULES[this.moduleIndex] ?? 0;
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

  /**
   * The piece the selected slot makes in the chosen kind before the aim turns it, or 0 when the slot
   * holds no block. The module slot makes its module, at its first level, facing +x.
   */
  get piece(): CellState {
    if (this.modular) return this.module === 0 ? 0 : packState(moduleShape(this.module, 0), 1);
    const material = HOTBAR_MATERIALS[this.selectedSlot];
    return material === undefined ? 0 : packState(baseShape(this.shapeKind), material);
  }

  /** What a click would make for the aim to orient, or null when the selected slot holds nothing to place. */
  get choice(): PieceChoice | null {
    if (this.modular) {
      if (this.module === 0) return null;
      this.pick.material = 1;
      this.pick.kind = 'module';
      this.pick.module = this.module;
    } else {
      const material = HOTBAR_MATERIALS[this.selectedSlot];
      if (material === undefined) return null;
      this.pick.material = material;
      this.pick.kind = this.shapeKind;
      this.pick.module = 0;
    }
    this.pick.turn = this.turnSteps;
    return this.pick;
  }

  /** What the cursor is on and what a click would do there, as of the last `update`. */
  get target(): Readonly<Aim> {
    return this.aim;
  }

  /** The heap of debris the cursor was on at the last `update` (`index` is -1 for none). */
  get salvageTarget(): Readonly<DebrisAim> {
    return this.heap;
  }

  selectSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SLOTS) return;
    this.moveTo(slot);
  }

  /** Moves the selection by whole slots (the mouse wheel), wrapping around the ends. */
  scrollSlot(steps: number): void {
    this.moveTo((((this.selectedSlot + steps) % HOTBAR_SLOTS) + HOTBAR_SLOTS) % HOTBAR_SLOTS);
  }

  /** Selects a slot. The turn of a piece is kept between the block slots, but not carried into or out of the module slot, which turns four ways, not eight. */
  private moveTo(slot: number): void {
    const wasModular = this.modular;
    this.selectedSlot = slot;
    if (wasModular !== this.modular) this.turnSteps = 0;
  }

  /**
   * Chooses the next kind of shape: a block, then a slab, then a wedge, then a block again; with the
   * module slot in hand it chooses the next module instead. The turn starts over.
   */
  cycleShape(): void {
    if (this.modular) {
      this.moduleIndex = (this.moduleIndex + 1) % Math.max(1, HOTBAR_MODULES.length);
    } else {
      const at = SHAPE_KINDS.indexOf(this.shapeKind);
      this.shapeKind = SHAPE_KINDS[(at + 1) % SHAPE_KINDS.length] ?? 'cube';
    }
    this.turnSteps = 0;
  }

  /** Turns the piece one step further from the way the aim would put it; a block has no other way. */
  turnPiece(): void {
    this.turnSteps = nextTurn(this.modular ? 'module' : this.shapeKind, this.turnSteps);
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

  /** The cursor is not looking at the world any more (the mouse was freed): nothing is aimed at until the next `update`. */
  clearAim(): void {
    this.heap.index = -1;
    this.heap.left = 0;
    this.heap.distance = 0;
  }

  /** The host refused a command that was sent: show why for a moment. */
  noteRejection(reason: string): void {
    this.setNotice(reason);
  }

  /**
   * The interact key: strips the heap of debris the cursor is on, if the player can reach it. The
   * host has the final word (and says no when the heap is bare, the pool is full or the hands are
   * too quick); the hands only keep their own pace, a little slower than the host's.
   */
  interact(): void {
    if (this.down || this.heap.index < 0 || this.salvageCooldown > 0) return;
    const node = this.ports.economy().debris.nodes[this.heap.index];
    if (!node) return;
    const sent = this.send({
      type: 'harvest',
      x: Math.floor(node.x),
      y: Math.floor(node.y),
      z: Math.floor(node.z),
    });
    if (sent) this.salvageCooldown = DEBRIS.pace;
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
    this.salvageCooldown = Math.max(0, this.salvageCooldown - dt * this.repeatScale);
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
      rules: this.houseRules,
    });
    // A heap in front of the first block or hill the view meets can be stripped; one behind it cannot.
    aimAtDebris(this.heap, {
      debris: this.ports.economy().debris,
      origin: view.origin,
      dir: view.dir,
      eye: view.eye,
      blockedAt: this.aim.on === 'nothing' ? Infinity : this.aim.distance,
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
    state.module = this.module;
    state.turn = this.turnSteps;
    state.piece = this.piece;
    state.blaster = this.armed;
    state.hits = this.hitCount;
    state.kill = this.lastKill;
    state.salvage = this.down ? 0 : this.heap.left;
    state.salvageGrade =
      state.salvage > 0 ? (this.ports.economy().debris.nodes[this.heap.index]?.grade ?? 0) : 0;
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
    // A slot that holds nothing to place does nothing.
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

  /** Sends a command unless the same one went a moment ago. True when it went. */
  private send(command: BlockCommand): boolean {
    const state = command.type === 'place' ? command.state : 0;
    const key = `${command.type} ${command.x} ${command.y} ${command.z} ${state}`;
    if (key === this.lastKey && this.clock - this.lastSentAt < RESEND_GUARD) return false;
    if (!this.ports.send(command)) {
      this.setNotice(NOT_READY);
      return false;
    }
    this.lastKey = key;
    this.lastSentAt = this.clock;
    return true;
  }

  private setNotice(text: string): void {
    this.notice = text;
    this.noticeUntil = this.clock + NOTICE_SECONDS;
  }
}
