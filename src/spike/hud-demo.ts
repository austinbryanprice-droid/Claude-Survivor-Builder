import { Vector3 } from 'three';
import { PlayerHud, type HotbarSlot, type PlayerHudState } from '../ui/player-hud/player-hud';
import { wrapBearing } from '../ui/player-hud/format';
import { CRASH } from '../world/terrain/field';
import type { LookScene } from './look-scene';

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

/**
 * Drives the player HUD with made-up numbers so the look spike shows the full screen: the
 * compass follows the camera and points at the crash site, stamina drains while Shift is held,
 * and the number keys and mouse wheel pick hotbar slots.
 */
export class HudDemo {
  readonly hud: PlayerHud;
  private selected = 0;
  private stamina = 1;
  private sprinting = false;
  private buffSeconds = 10 * 60 + 52;
  private readonly forward = new Vector3();
  private readonly stop: () => void;

  constructor(
    parent: HTMLElement,
    private readonly scene: LookScene,
  ) {
    this.hud = new PlayerHud(parent);
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        this.sprinting = event.type === 'keydown';
        return;
      }
      const digit = /^Digit([1-8])$/.exec(event.code);
      if (digit && event.type === 'keydown') this.selected = Number(digit[1]) - 1;
    };
    const onWheel = (event: WheelEvent): void => {
      const step = event.deltaY > 0 ? 1 : -1;
      this.selected = (this.selected + step + SLOTS.length) % SLOTS.length;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('wheel', onWheel, { passive: true });
    this.stop = () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('wheel', onWheel);
    };
  }

  private visible = true;

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.hud.root.hidden = !visible;
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  /** Advances the made-up numbers by `dt` seconds and redraws the HUD. */
  update(dt: number): void {
    const camera = this.scene.camera;
    const dir = camera.getWorldDirection(this.forward);
    const heading = wrapBearing((Math.atan2(dir.x, -dir.z) * 180) / Math.PI);
    this.stamina = Math.min(1, Math.max(0, this.stamina + (this.sprinting ? -0.22 : 0.3) * dt));
    this.buffSeconds = Math.max(0, this.buffSeconds - dt);

    const dx = CRASH.x - camera.position.x;
    const dz = CRASH.z - camera.position.z;
    const bearing = wrapBearing((Math.atan2(dx, -dz) * 180) / Math.PI);
    const state: PlayerHudState = {
      health: 0.78,
      healthSegments: 3,
      stamina: this.stamina,
      statuses: ['flask', 'mushroom', 'shield'],
      buff: { label: 'Rested', seconds: this.buffSeconds },
      heading,
      waypoints: [{ bearing, distance: Math.hypot(dx, dz) }],
      objective: { place: 'The Ashbound Outpost', title: 'Light the beacon at the crash site' },
      slots: SLOTS,
      selected: this.selected,
    };
    this.hud.update(state);
  }

  dispose(): void {
    this.stop();
    this.hud.dispose();
  }
}
