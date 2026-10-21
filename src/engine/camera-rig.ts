import type { PerspectiveCamera } from 'three';
import { overlapsSolid, type Body } from '../shared/collision';
import type { CollisionWorld } from '../shared/ground';
import { lookDirection, rightVector, type LookState, type Vec3 } from '../shared/look';
import { MOVEMENT, PLAYER, type PlayerState } from '../shared/movement';
import type { Settings } from '../shared/settings';

export type CameraMode = 'first' | 'third';

/** Over-the-shoulder framing, in blocks. */
const THIRD = {
  /** How far behind the shoulder the camera sits when nothing is in the way. */
  distance: 3.4,
  /** How far to the right of the player the camera is offset. */
  shoulder: 0.55,
  /** Height of the pivot above the feet, just under the eyes. */
  height: 1.55,
  /** Half the width of the camera's clearance cube; larger than the near plane's corner, so walls never clip in. */
  probeRadius: 0.2,
  /** How far the camera stays from the terrain's surface, which is smooth and so needs a sphere. */
  groundClearance: 0.32,
  /** The body is hidden when the camera is pulled in closer than this. */
  minDistanceForBody: 0.9,
} as const;

/** Degrees of extra field of view at full sprint. */
const SPRINT_FOV_KICK = 6;
/** Largest dip of the eye after a hard landing, in blocks. */
const MAX_LANDING_DIP = 0.12;

export interface ViewPoint {
  x: number;
  y: number;
  z: number;
}

/** What the rig needs to place the camera for one rendered frame. */
export interface RigFrame {
  dt: number;
  /** How far between `previous` and `current` this frame falls, from the fixed-step loop. */
  alpha: number;
  previous: ViewPoint;
  current: ViewPoint;
  look: LookState;
  settings: Settings;
  /** Horizontal speed in blocks per second; drives the sprint field-of-view kick. */
  speed: number;
}

export interface CameraRig {
  readonly mode: CameraMode;
  /** 0 in first person and 1 in third, eased in between while switching. */
  readonly blend: number;
  /** Whether the player's body should be drawn this frame. */
  readonly showAvatar: boolean;
  /** How far behind the shoulder the camera currently is (shorter when a wall is close). */
  readonly boomLength: number;
  setMode(mode: CameraMode, immediate?: boolean): void;
  toggle(): void;
  /** Call once per simulation tick so one-off events such as a hard landing are not missed. */
  onTick(player: PlayerState): void;
  /** Places and aims the camera. */
  update(frame: RigFrame): void;
}

export function createCameraRig(camera: PerspectiveCamera, world: CollisionWorld): CameraRig {
  camera.rotation.order = 'YXZ';

  let mode: CameraMode = 'first';
  let blend = 0;
  let boom: number = THIRD.distance;
  let dip = 0;
  let kick = 0;
  const dir: Vec3 = { x: 0, y: 0, z: 0 };
  const right: Vec3 = { x: 0, y: 0, z: 0 };
  const radius = THIRD.probeRadius;
  const probe: Body = { x: 0, y: 0, z: 0, halfWidth: radius, height: radius * 2 };

  const clearAt = (x: number, y: number, z: number): boolean => {
    probe.x = x;
    probe.y = y - radius;
    probe.z = z;
    if (overlapsSolid(probe, world)) return false;
    const ground = world.ground;
    return !ground || ground.distance(x, y, z) > THIRD.groundClearance;
  };

  /** How far the clearance cube can travel from an origin along a unit direction, up to `max`. */
  const reach = (
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    max: number,
  ): number => {
    if (!clearAt(ox, oy, oz)) return 0;
    const step = 0.2;
    let free = 0;
    for (;;) {
      const distance = Math.min(free + step, max);
      if (!clearAt(ox + dx * distance, oy + dy * distance, oz + dz * distance)) {
        let near = free;
        let far = distance;
        for (let i = 0; i < 5; i++) {
          const mid = (near + far) / 2;
          if (clearAt(ox + dx * mid, oy + dy * mid, oz + dz * mid)) near = mid;
          else far = mid;
        }
        return near;
      }
      free = distance;
      if (distance >= max) return max;
    }
  };

  const rig: CameraRig = {
    get mode() {
      return mode;
    },
    get blend() {
      return blend;
    },
    get showAvatar() {
      return blend > 0.3 && boom > THIRD.minDistanceForBody;
    },
    get boomLength() {
      return boom;
    },
    setMode(next, immediate = false) {
      mode = next;
      if (immediate) blend = next === 'third' ? 1 : 0;
    },
    toggle() {
      mode = mode === 'first' ? 'third' : 'first';
    },
    onTick(player) {
      if (player.landingSpeed > 3) {
        dip = Math.min(MAX_LANDING_DIP, dip + player.landingSpeed * 0.007);
      }
    },
    update({ dt, alpha, previous, current, look, settings, speed }) {
      const x = previous.x + (current.x - previous.x) * alpha;
      const y = previous.y + (current.y - previous.y) * alpha;
      const z = previous.z + (current.z - previous.z) * alpha;
      lookDirection(look.yaw, look.pitch, dir);
      rightVector(look.yaw, right);

      const target = mode === 'third' ? 1 : 0;
      blend += (target - blend) * (1 - Math.exp(-11 * dt));
      if (Math.abs(target - blend) < 0.002) blend = target;
      dip *= Math.exp(-11 * dt);

      const sprintShare =
        (speed - MOVEMENT.walkSpeed * 1.05) / (MOVEMENT.sprintSpeed - MOVEMENT.walkSpeed * 1.05);
      const kickTarget = Math.min(1, Math.max(0, sprintShare)) * SPRINT_FOV_KICK;
      kick += (kickTarget - kick) * (1 - Math.exp(-7 * dt));
      const fov = settings.fov + kick;
      if (Math.abs(fov - camera.fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }

      let cx = x;
      let cy = y + PLAYER.eyeHeight - dip;
      let cz = z;
      if (blend > 0.001) {
        // Pivot at the right shoulder, pulled in if a wall is beside the player.
        const hy = y + THIRD.height;
        const side = reach(x, hy, z, right.x, 0, right.z, THIRD.shoulder);
        const px = x + right.x * side;
        const pz = z + right.z * side;
        // Then back along the view, stopping short of anything behind. The boom snaps in so the
        // camera never shows the inside of a wall, and eases back out so it does not pop.
        const room = reach(px, hy, pz, -dir.x, -dir.y, -dir.z, THIRD.distance);
        boom = room < boom ? room : boom + (room - boom) * (1 - Math.exp(-5 * dt));
        const ease = blend * blend * (3 - 2 * blend);
        cx += (px - dir.x * boom - cx) * ease;
        cy += (hy - dir.y * boom - cy) * ease;
        cz += (pz - dir.z * boom - cz) * ease;
      } else {
        boom = THIRD.distance;
      }

      camera.position.set(cx, cy, cz);
      camera.rotation.set(look.pitch, look.yaw, 0);
    },
  };
  return rig;
}
