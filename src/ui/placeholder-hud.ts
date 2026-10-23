import type { Game } from '../engine/game';
import type { ShapeKind } from '../shared/blocks';
import { createReading, type SurvivalView } from '../shared/survival-state';
import { createVitalsReading, type VitalsView } from '../shared/vitals-state';
import { CRASH } from '../world/terrain/field';
import { BuildPromptTracker, blockSlotsByKind, type BuildHudSource } from './build-hud';
import { wrapBearing } from './player-hud/format';
import { PlayerHud, type HotbarSlot, type PlayerHudState } from './player-hud/player-hud';
import { clockForHud, coreForHud, objectiveForRun } from './run-hud';
import { FULL_VITALS, vitalsForHud } from './vitals-hud';

/** Placeholder tools for the slots after the building blocks; the real ones come with the inventory. */
const TOOLS: readonly HotbarSlot[] = [
  { icon: 'blade', durability: 0.92, badge: 'heart' },
  { icon: 'pick', durability: 0.8 },
  { icon: 'torch', durability: 0.6 },
  { icon: 'charge', count: 15 },
];

/** The hotbar always has eight slots. */
const HOTBAR_SLOTS = 8;

const RADIANS_TO_DEGREES = 180 / Math.PI;

export interface PlaceholderHud {
  readonly hud: PlayerHud;
  setVisible(visible: boolean): void;
  /** Takes the day and night clock and the objective from the run; null goes back to the made-up objective. */
  setSurvival(view: SurvivalView | null): void;
  /** Takes the player's Health, Energy and status icons from these meters; null draws full bars. */
  setVitals(view: VitalsView | null): void;
  /** Redraws the HUD from the game as it stands; `dt` seconds is how long the HUD's own timers have run. */
  update(dt: number): void;
  dispose(): void;
}

/**
 * The player HUD of the reference, driven by the game where the game knows the answer (the compass
 * follows the view, the waypoint points at the crash site, the hotbar, the crosshair and Build Mode
 * come from the player's building hands, the day and night clock and the objective come from the
 * run, and Health, Energy and the status icons come from the player's meters) and by made-up
 * numbers where it does not yet: the tools.
 */
export function createPlaceholderHud(
  parent: HTMLElement,
  game: Game,
  build: BuildHudSource,
): PlaceholderHud {
  const hud = new PlayerHud(parent);
  const camera = game.stage.camera;
  // The block slots look like the shape they make, so a row is kept for each kind.
  const slotRows = new Map<ShapeKind, readonly HotbarSlot[]>();
  for (const [kind, blocks] of blockSlotsByKind()) {
    slotRows.set(kind, [...blocks, ...TOOLS].slice(0, HOTBAR_SLOTS));
  }
  const prompts = new BuildPromptTracker();
  let visible = true;
  let survival: SurvivalView | null = null;
  let vitals: VitalsView | null = null;
  const reading = createReading();
  const vitalsReading = createVitalsReading();

  return {
    hud,
    setVisible(next) {
      visible = next;
      hud.root.hidden = !next;
    },
    setSurvival(view) {
      survival = view;
    },
    setVitals(view) {
      vitals = view;
    },
    update(dt) {
      if (!visible) return;
      // The camera's yaw turns counterclockwise and a compass bearing clockwise.
      const heading = wrapBearing(-camera.rotation.y * RADIANS_TO_DEGREES);

      const dx = CRASH.x - camera.position.x;
      const dz = CRASH.z - camera.position.z;
      const hands = build.hudState();
      const run = survival ? survival.read(reading) : null;
      const own = vitals ? vitalsForHud(vitals.read(vitalsReading)) : FULL_VITALS;
      const state: PlayerHudState = {
        health: own.health,
        healthTone: own.healthTone,
        healthSegments: 3,
        energy: own.energy,
        energyTone: own.energyTone,
        statuses: own.statuses,
        heading,
        waypoints: [
          {
            bearing: wrapBearing(Math.atan2(dx, -dz) * RADIANS_TO_DEGREES),
            distance: Math.hypot(dx, dz),
          },
        ],
        clock: run ? clockForHud(run) : null,
        core: run ? coreForHud(run) : null,
        objective: run
          ? objectiveForRun(run)
          : { place: 'The Ashbound Outpost', title: 'Light the beacon at the crash site' },
        slots: slotRows.get(hands.kind) ?? [],
        selected: hands.selected,
        prompt: prompts.update(dt, hands),
        crosshair: hands.crosshair,
        buildMode: hands.buildMode,
      };
      hud.update(state);
    },
    dispose() {
      hud.dispose();
    },
  };
}
