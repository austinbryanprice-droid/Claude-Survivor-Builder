import type { Game } from '../engine/game';
import type { ShapeKind } from '../shared/blocks';
import { MOVEMENT } from '../shared/movement';
import { CRASH } from '../world/terrain/field';
import { BuildPromptTracker, blockSlotsByKind, type BuildHudSource } from './build-hud';
import { wrapBearing } from './player-hud/format';
import { PlayerHud, type HotbarSlot, type PlayerHudState } from './player-hud/player-hud';

/** Placeholder tools for the slots after the building blocks; the real ones come with the inventory. */
const TOOLS: readonly HotbarSlot[] = [
  { icon: 'blade', durability: 0.92, badge: 'heart' },
  { icon: 'pick', durability: 0.8 },
  { icon: 'torch', durability: 0.6 },
  { icon: 'charge', count: 15 },
];

/** The hotbar always has eight slots. */
const HOTBAR_SLOTS = 8;

/** Stamina drained and regained per second while sprinting and while not. */
const STAMINA_DRAIN = 0.22;
const STAMINA_REGAIN = 0.3;
const RADIANS_TO_DEGREES = 180 / Math.PI;

export interface PlaceholderHud {
  readonly hud: PlayerHud;
  setVisible(visible: boolean): void;
  /** Advances the made-up numbers by `dt` seconds and redraws the HUD. */
  update(dt: number): void;
  dispose(): void;
}

/**
 * The player HUD of the reference, driven by the game where the game knows the answer (the compass
 * follows the view, the waypoint points at the crash site, stamina drains while sprinting, and the
 * hotbar, the crosshair and Build Mode come from the player's building hands) and by made-up
 * numbers where it does not yet: health, status effects, the objective and the tools.
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
  let stamina = 1;
  let buffSeconds = 10 * 60 + 52;
  let visible = true;

  return {
    hud,
    setVisible(next) {
      visible = next;
      hud.root.hidden = !next;
    },
    update(dt) {
      if (!visible) return;
      const { player } = game;
      // The camera's yaw turns counterclockwise and a compass bearing clockwise.
      const heading = wrapBearing(-camera.rotation.y * RADIANS_TO_DEGREES);
      const sprinting =
        player.onGround && Math.hypot(player.vx, player.vz) > MOVEMENT.walkSpeed * 1.1;
      stamina = Math.min(
        1,
        Math.max(0, stamina + (sprinting ? -STAMINA_DRAIN : STAMINA_REGAIN) * dt),
      );
      buffSeconds = Math.max(0, buffSeconds - dt);

      const dx = CRASH.x - camera.position.x;
      const dz = CRASH.z - camera.position.z;
      const hands = build.hudState();
      const state: PlayerHudState = {
        health: 0.78,
        healthSegments: 3,
        stamina,
        statuses: ['flask', 'mushroom', 'shield'],
        buff: { label: 'Rested', seconds: buffSeconds },
        heading,
        waypoints: [
          {
            bearing: wrapBearing(Math.atan2(dx, -dz) * RADIANS_TO_DEGREES),
            distance: Math.hypot(dx, dz),
          },
        ],
        objective: { place: 'The Ashbound Outpost', title: 'Light the beacon at the crash site' },
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
