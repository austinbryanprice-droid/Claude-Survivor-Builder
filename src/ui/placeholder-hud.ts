import type { Game } from '../engine/game';
import { MOVEMENT } from '../shared/movement';
import { CRASH } from '../world/terrain/field';
import { wrapBearing } from './player-hud/format';
import { PlayerHud, type HotbarSlot, type PlayerHudState } from './player-hud/player-hud';

/** Placeholder items for the hotbar; the real ones come with the inventory. */
const SLOTS: readonly HotbarSlot[] = [
  { icon: 'blade', durability: 0.92, badge: 'heart' },
  { icon: 'pick', durability: 0.8 },
  { icon: 'hammer', durability: 1, blueprint: true },
  { icon: 'torch', durability: 0.6 },
  { icon: 'bow', durability: 0.74, badge: 'shield' },
  { icon: 'axe', durability: 0.88 },
  { icon: 'charge', count: 15 },
  { icon: 'cloth', count: 8, badge: 'flask' },
];

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
 * follows the view, the waypoint points at the crash site, stamina drains while sprinting) and by
 * made-up numbers where it does not yet: health, status effects, the objective and the hotbar.
 * The number keys and the mouse wheel pick hotbar slots while the mouse is taken.
 */
export function createPlaceholderHud(parent: HTMLElement, game: Game): PlaceholderHud {
  const hud = new PlayerHud(parent);
  const camera = game.stage.camera;
  let selected = 0;
  let stamina = 1;
  let buffSeconds = 10 * 60 + 52;
  let visible = true;

  const onKey = (event: KeyboardEvent): void => {
    if (!game.input.locked) return;
    const digit = /^Digit([1-8])$/.exec(event.code);
    if (digit) selected = Number(digit[1]) - 1;
  };
  const onWheel = (event: WheelEvent): void => {
    if (!game.input.locked) return;
    const step = event.deltaY > 0 ? 1 : -1;
    selected = (selected + step + SLOTS.length) % SLOTS.length;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('wheel', onWheel, { passive: true });

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
        slots: SLOTS,
        selected,
      };
      hud.update(state);
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
      hud.dispose();
    },
  };
}
