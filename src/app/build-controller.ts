import type { BlockWorld, CellState } from '../shared/block-world';
import {
  MATERIALS,
  MODULE,
  MODULES,
  SHAPE_KINDS,
  baseShape,
  moduleOfShape,
  moduleShape,
  packState,
  stateShape,
  type BlockKind,
  type ShapeKind,
} from '../shared/blocks';
import {
  AIM_REFUSAL,
  BUILD_REACH,
  createAim,
  distanceToCell,
  updateAim,
  type Aim,
  type Cell,
} from '../shared/build-aim';
import { createEconomyReading } from '../shared/economy';
import type { GroundQuery } from '../shared/ground';
import type { Vec3 } from '../shared/look';
import { nextTurn, type PieceChoice } from '../shared/placement';
import type { BlockCommand } from '../shared/protocol';
import { aimAtDebris, createDebrisAim, type DebrisAim } from '../systems/economy/aim';
import { DEBRIS } from '../systems/economy/balance';
import {
  FULLY_UPGRADED,
  placementRefusal,
  upgradeBlocker,
  upgradeRefusalOnScreen,
  upgradeStep,
  type PlacementEconomy,
  type UpgradeStep,
} from '../systems/economy/build-rules';
import { BLASTER } from '../systems/survival/balance';
import { reachOfModule, receivesPower, type PowerState } from '../systems/survival/power';

/**
 * The player's hands: which hotbar slot is selected, which kind of shape it makes and how that is
 * turned, whether Build Mode is on, what the cursor would do and the clicks that send it, the
 * pulse blaster in the slot after the blocks, the module slot after the blaster, and the interact
 * key that strips a heap of debris the cursor is on, opens the research ladder of the Research
 * Terminal it is on, or upgrades the piece it is on (a block to the next material, a turret to its
 * next level). It holds no DOM and no
 * three.js, and reaches the rest of the game through `BuildPorts`, so the tests can drive it with
 * fakes. Nothing here changes the world: a click becomes a command (or a shot) for the session, the
 * host validates it, and the world changes (or the machine is hurt) when the host's word comes back.
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
/** An open research ladder stays open until the player is this many blocks from the Terminal, a little past the reach that opened it, so a step either way at the edge does not flicker it shut. */
export const LADDER_STAY = BUILD_REACH + 1;

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
  /** The Research Terminal: 'aimed' when the cursor is on one the interact key would open, 'open' while its ladder is up, else 'none'. */
  readonly terminal: 'none' | 'aimed' | 'open';
  /** The piece the interact key would make of the block the cursor is on, one material up, or 0 when it offers none (outside Build Mode, when it would be refused). */
  readonly upgrade: CellState;
  /** Why the host would refuse that upgrade (the economy's words), or null when it would go. Meaningful when `upgrade` is not 0. */
  readonly upgradeRefusal: string | null;
  /** In Build Mode, what the turret or Power Node the cursor is on has of power; 'none' when it is on neither (or Build Mode is off). */
  readonly power: PowerState;
  /** The module (`MODULE`) that `power` is the state of; 0 when `power` is 'none'. */
  readonly powerModule: number;
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
  /**
   * What the module standing in a cell has of power, as this screen works it out from the world it
   * has ('none' for a cell that holds no module that takes part). A getter-like function: a joining
   * player's world is replaced. Absent for a game without power, where nothing is tagged.
   */
  power?(x: number, y: number, z: number): PowerState;
  /** A click or a key was turned away, by a rule this screen could see or by the host's word: the moment to answer it with a sound. */
  refused?(): void;
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
  /** What `reach` hands out. */
  private readonly ring: { cell: Cell | null; radius: number } = { cell: null, radius: 0 };
  /** Whether the ladder of a Research Terminal is open, and the cell of the Terminal it was opened on. */
  private ladderUp = false;
  private readonly ladderCell: Cell = { x: 0, y: 0, z: 0 };
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
    terminal: 'none' | 'aimed' | 'open';
    upgrade: CellState;
    upgradeRefusal: string | null;
    power: PowerState;
    powerModule: number;
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
    terminal: 'none',
    upgrade: 0,
    upgradeRefusal: null,
    power: 'none',
    powerModule: 0,
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

  /**
   * The cell whose power the screen rings on the ground, and how far it reaches, as of the last `update`:
   * the module in hand where a click would put it (a Generator), else the module of that kind the cursor
   * is on. `cell` is null and `radius` 0 when neither gives by radius. The object is reused.
   */
  get reach(): Readonly<{ cell: Cell | null; radius: number }> {
    const aim = this.aim;
    const ring = this.ring;
    ring.cell = null;
    ring.radius = this.modular ? reachOfModule(this.module) : 0;
    if (ring.radius > 0 && aim.hasPlace) {
      ring.cell = aim.place;
      return ring;
    }
    const module = aim.on === 'block' ? moduleOfShape(stateShape(aim.targetState)) : undefined;
    ring.radius = module ? reachOfModule(module.id) : 0;
    if (ring.radius > 0) ring.cell = aim.target;
    return ring;
  }

  /** Whether the research ladder of a Terminal is open. */
  get ladderOpen(): boolean {
    return this.ladderUp;
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
    if (down) {
      this.releaseAll();
      this.ladderUp = false;
    }
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

  /** The cursor is not looking at the world any more (the mouse was freed): nothing is aimed at until the next `update`, and a research ladder shuts. */
  clearAim(): void {
    this.heap.index = -1;
    this.heap.left = 0;
    this.heap.distance = 0;
    this.ladderUp = false;
  }

  /** The host refused a command that was sent: show why for a moment. */
  noteRejection(reason: string): void {
    this.setNotice(reason);
  }

  /**
   * The interact key. With a research ladder open it shuts it. Otherwise it strips the heap of
   * debris the cursor is on, if the player can reach it (the host has the final word, and says no
   * when the heap is bare, the pool is full or the hands are too quick; the hands only keep their
   * own pace, a little slower than the host's), or, with the cursor on a Research Terminal in
   * reach and no heap in front of it, opens the Terminal's ladder, which only shows what the
   * crew's research has opened and asks the host for nothing, or, with the cursor on any other
   * block in reach, upgrades that block to the next material, or a module that has a ladder (the
   * turret) to its next level (Build Mode or not: it only shows more there, as it does for a click).
   */
  interact(): void {
    if (this.down) return;
    if (this.ladderUp) {
      this.ladderUp = false;
      return;
    }
    if (this.heap.index >= 0) {
      this.strip();
      return;
    }
    if (this.terminalAimed()) {
      this.ladderCell.x = this.aim.target.x;
      this.ladderCell.y = this.aim.target.y;
      this.ladderCell.z = this.aim.target.z;
      this.ladderUp = true;
      return;
    }
    this.upgradeTarget();
  }

  /**
   * Upgrades the piece the cursor is on, a block or a module with a ladder: the better piece (the
   * next material, or the module at its next level) is sent as the piece this screen showed
   * (the host checks the cell still holds what the player saw). What this screen can tell is
   * refused is shown instead of sent, as for a click; the host has the final word.
   */
  private upgradeTarget(): void {
    const aim = this.aim;
    if (aim.on !== 'block') return;
    if (aim.breakRefusal === AIM_REFUSAL.outOfReach) {
      this.setNotice(AIM_REFUSAL.outOfReach);
      return;
    }
    const step = upgradeStep(aim.targetState);
    if (!step) {
      this.setNotice(upgradeBlocker(aim.targetState) ?? FULLY_UPGRADED);
      return;
    }
    const refusal = upgradeRefusalOnScreen(this.ports.economy(), this.pool, aim.targetState);
    if (refusal) {
      this.setNotice(refusal);
      return;
    }
    this.send({
      type: 'upgrade',
      x: aim.target.x,
      y: aim.target.y,
      z: aim.target.z,
      state: step.to,
    });
  }

  /**
   * What the interact key would upgrade the piece under the cursor to, or null when it offers
   * nothing: the player is down, a ladder is open, a heap of debris is in front (the key strips
   * it), or the cursor is not on a piece in reach that has a better self (a block with a better
   * material, a turret below the top of its ladder).
   */
  private upgradeOffer(): UpgradeStep | null {
    const aim = this.aim;
    if (this.down || this.ladderUp || this.heap.index >= 0) return null;
    if (aim.on !== 'block' || aim.breakRefusal === AIM_REFUSAL.outOfReach) return null;
    return upgradeStep(aim.targetState);
  }

  /** Sends the strip of the heap the cursor is on, at the hands' pace. */
  private strip(): void {
    if (this.salvageCooldown > 0) return;
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

  /** Whether the cursor is on a Research Terminal that a break would reach, with no heap of debris in front of it. */
  private terminalAimed(): boolean {
    const aim = this.aim;
    return (
      this.heap.index < 0 &&
      aim.on === 'block' &&
      aim.breakRefusal !== AIM_REFUSAL.outOfReach &&
      moduleOfShape(stateShape(aim.targetState))?.id === MODULE.terminal
    );
  }

  /** Whether the Terminal the open ladder belongs to still stands, and the player is still near it. */
  private ladderHolds(eye: Vec3): boolean {
    const { x, y, z } = this.ladderCell;
    const state = this.ports.blocks().getBlock(x, y, z);
    return (
      moduleOfShape(stateShape(state))?.id === MODULE.terminal &&
      distanceToCell(eye, x, y, z) <= LADDER_STAY
    );
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
    // The ladder is open for as long as its Terminal stands and the player is near it.
    if (this.ladderUp && (this.down || !this.ladderHolds(view.eye))) this.ladderUp = false;
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
    state.terminal = this.down
      ? 'none'
      : this.ladderUp
        ? 'open'
        : this.terminalAimed()
          ? 'aimed'
          : 'none';
    // Build Mode shows every upgrade the cursor is on, and why one would be refused; outside it the
    // card is only for an upgrade that would go, so a crew with nothing to spend is not nagged.
    const offer = this.upgradeOffer();
    const why = offer ? upgradeRefusalOnScreen(this.ports.economy(), this.pool, offer.from) : null;
    const shown = offer !== null && (this.buildMode || why === null);
    state.upgrade = shown ? offer.to : 0;
    state.upgradeRefusal = shown ? why : null;
    // Build Mode tags a turret or a Power Node with whether it has power, even one just out of reach, as the ring is: a base is read from a little way off.
    const aimed =
      this.buildMode && !this.down && aim.on === 'block'
        ? moduleOfShape(stateShape(aim.targetState))
        : undefined;
    const tagged = aimed && receivesPower(aimed.id) ? aimed : undefined;
    state.power = tagged
      ? (this.ports.power?.(aim.target.x, aim.target.y, aim.target.z) ?? 'none')
      : 'none';
    state.powerModule = tagged && state.power !== 'none' ? tagged.id : 0;
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
    const state = command.type === 'place' || command.type === 'upgrade' ? command.state : 0;
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
    this.ports.refused?.();
  }
}
