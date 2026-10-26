import type { Game } from '../engine/game';
import { MATERIALS, MODULES, type BlockKind } from '../shared/blocks';
import { createEconomyReading, type EconomyView } from '../shared/economy';
import { createReading, type SurvivalView } from '../shared/survival-state';
import { createVitalsReading, type VitalsView } from '../shared/vitals-state';
import { CRASH } from '../world/terrain/field';
import {
  BuildPromptTracker,
  MODULE_SLOT_INDEX,
  blockSlotsByKind,
  interactPrompt,
  moduleSlot,
  upgradePrompt,
  type BuildHudSource,
} from './build-hud';
import { wrapBearing } from './player-hud/format';
import { PlayerHud, type HotbarSlot, type PlayerHudState } from './player-hud/player-hud';
import { chargesForHud, clockForHud, coreForHud, downForHud, objectiveForRun } from './run-hud';
import { ResearchPill, lockForPiece, moduleSlotLocked, slotLocked } from './research-hud';
import { ladderForHud, terminalPrompt } from './terminal-hud';
import { FULL_VITALS, vitalsForHud } from './vitals-hud';

/**
 * The slots after the building blocks: the pulse blaster and the module slot, which are real, and
 * placeholder tools for the rest until the inventory comes. The module slot shows the module in hand.
 */
const TOOLS: readonly HotbarSlot[] = [
  { icon: 'blaster' },
  moduleSlot(MODULES[0]?.id ?? 0),
  { icon: 'torch', durability: 0.6 },
  { icon: 'charge', count: 15 },
];

/** The hotbar always has eight slots. */
const HOTBAR_SLOTS = 8;

/** A slot the HUD may write the pool's count into, and whether the crew has researched its material. */
type StockSlot = { -readonly [K in keyof HotbarSlot]: HotbarSlot[K] };

const RADIANS_TO_DEGREES = 180 / Math.PI;

export interface PlaceholderHud {
  readonly hud: PlayerHud;
  setVisible(visible: boolean): void;
  /** Takes the day and night clock and the objective from the run; null goes back to the made-up objective. */
  setSurvival(view: SurvivalView | null): void;
  /** Takes the player's Health, Energy and status icons from these meters; null draws full bars. */
  setVitals(view: VitalsView | null): void;
  /** Takes the crew's pool for the counts on the block slots, and its research for the padlocks and the pill; null shows neither. */
  setEconomy(view: EconomyView | null): void;
  /** Redraws the HUD from the game as it stands; `dt` seconds is how long the HUD's own timers have run. */
  update(dt: number): void;
  dispose(): void;
}

/**
 * The player HUD of the reference, driven by the game where the game knows the answer (the compass
 * follows the view, the waypoint points at the crash site, the hotbar, the crosshair, the hit
 * marker and Build Mode come from the player's hands, the day and night clock and the objective
 * come from the run, the crew's respawn charges come from it too, and Health, Energy, the status
 * icons and the screen of a player who is down come from the player's meters) and
 * by made-up numbers where it does not yet: the tools after the blaster.
 */
export function createPlaceholderHud(
  parent: HTMLElement,
  game: Game,
  build: BuildHudSource,
): PlaceholderHud {
  const hud = new PlayerHud(parent);
  const camera = game.stage.camera;
  // The block slots look like the shape they make, so a row is kept for each kind.
  // Each row is a copy the pool's counts are written into, one frame after another: the HUD reads
  // the state as it is handed over and keeps nothing of it.
  const slotRows = new Map<BlockKind, StockSlot[]>();
  for (const [kind, blocks] of blockSlotsByKind()) {
    slotRows.set(
      kind,
      [...blocks, ...TOOLS].slice(0, HOTBAR_SLOTS).map((slot) => ({ ...slot })),
    );
  }
  const prompts = new BuildPromptTracker();
  let visible = true;
  let survival: SurvivalView | null = null;
  let vitals: VitalsView | null = null;
  let economy: EconomyView | null = null;
  const reading = createReading();
  const vitalsReading = createVitalsReading();
  const poolReading = createEconomyReading();
  const noPool = createEconomyReading();
  const researchPill = new ResearchPill();

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
    setEconomy(view) {
      economy = view;
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
      // The block slots tell how much of their material the crew's pool holds, or that the crew has
      // not researched it yet.
      const row = slotRows.get(hands.kind) ?? [];
      const pool = economy ? economy.read(poolReading) : null;
      row.forEach((slot, i) => {
        const material = MATERIALS[i];
        if (i < poolReading.stock.length && slot.blueprint && material) {
          slot.stock = pool?.stock[i];
          slot.locked = pool !== null && slotLocked(material.id, pool);
        }
      });
      // The module slot draws the module the shape key has chosen, behind a padlock while its research is shut.
      const modules = row[MODULE_SLOT_INDEX];
      if (modules) {
        modules.icon = moduleSlot(hands.module).icon;
        modules.locked = pool !== null && moduleSlotLocked(hands.module, pool);
      }
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
        charges: run ? chargesForHud(run) : null,
        research: researchPill.update(dt, pool ?? noPool, hands.buildMode),
        down: vitals ? downForHud(vitalsReading, run) : null,
        objective: run
          ? objectiveForRun(run)
          : { place: 'The Ashbound Outpost', title: 'Light the beacon at the crash site' },
        slots: row,
        selected: hands.selected,
        prompt: prompts.update(dt, hands, pool ? lockForPiece(hands.piece, pool) : null),
        interact:
          hands.terminal === 'aimed'
            ? terminalPrompt(pool ?? noPool)
            : (interactPrompt(hands.salvage, hands.salvageGrade) ??
              (hands.upgrade === 0
                ? null
                : upgradePrompt(
                    hands.upgrade,
                    hands.upgradeRefusal,
                    pool ? lockForPiece(hands.upgrade, pool) : null,
                  ))),
        ladder: hands.terminal === 'open' ? ladderForHud(pool ?? noPool) : null,
        crosshair: hands.crosshair,
        hitMarker: { count: hands.hits, kill: hands.kill },
        buildMode: hands.buildMode,
      };
      hud.update(state);
    },
    dispose() {
      hud.dispose();
    },
  };
}
