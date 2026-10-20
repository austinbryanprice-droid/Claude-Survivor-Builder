import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import type { SdfGrid } from '../world/terrain/grid';
import { FLY_PATH, type ShotPose } from './shots';

const EYE_HEIGHT = 1.7;
const RADIUS = 0.36;
const GRAVITY = 24;
const JUMP = 7.4;
const WALK = 4.4;
const RUN = 8.2;
const FLY = 14;
const FLY_FAST = 46;

/** Camera forward vector from a compass bearing and a pitch, both in degrees. */
export function directionFrom(bearing: number, pitch: number, out = new Vector3()): Vector3 {
  const b = MathUtils.degToRad(bearing);
  const p = MathUtils.degToRad(pitch);
  return out.set(Math.sin(b) * Math.cos(p), Math.sin(p), -Math.cos(b) * Math.cos(p));
}

/**
 * Spike-local first-person movement against the terrain field: a stack of sphere probes is
 * pushed out of the field along its gradient. It proves the same grid that builds the mesh
 * answers collision; the real controller arrives with Phase 1. Press F to toggle free flight.
 */
export class LookController {
  readonly position = new Vector3();
  yaw = 0;
  pitch = 0;
  fly = false;
  private velocity = new Vector3();
  private onGround = false;
  private readonly keys = new Set<string>();
  private readonly grad = new Float32Array(3);
  private readonly tmp = new Vector3();
  locked = false;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly grid: SdfGrid,
    private readonly bound: number,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && !e.repeat) this.fly = !this.fly;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('click', () => {
      if (!this.locked) void canvas.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw += e.movementX * 0.0022;
      this.pitch = MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.5, 1.5);
    });
  }

  /** Puts the camera at a pose (position is the eye). */
  place(pose: ShotPose): void {
    const ground = this.grid.groundAt(pose.x, pose.z);
    this.position.set(pose.x, ground + pose.height - EYE_HEIGHT, pose.z);
    this.yaw = MathUtils.degToRad(pose.bearing);
    this.pitch = MathUtils.degToRad(pose.pitch);
    this.velocity.set(0, 0, 0);
  }

  get active(): boolean {
    return this.keys.size > 0 || this.locked;
  }

  update(dt: number): void {
    const k = this.keys;
    const forward =
      (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const strafe =
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) -
      (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    if (k.has('KeyJ')) this.yaw -= dt * 1.6;
    if (k.has('KeyL')) this.yaw += dt * 1.6;
    if (k.has('KeyI')) this.pitch = Math.min(1.5, this.pitch + dt * 1.2);
    if (k.has('KeyK')) this.pitch = Math.max(-1.5, this.pitch - dt * 1.2);

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Forward in the horizontal plane is (sin, -cos); right is (cos, sin).
    let wx = sin * forward + cos * strafe;
    let wz = -cos * forward + sin * strafe;
    const len = Math.hypot(wx, wz);
    if (len > 1) {
      wx /= len;
      wz /= len;
    }

    if (this.fly) {
      const speed = sprint ? FLY_FAST : FLY;
      const vertical =
        (k.has('KeyE') || k.has('Space') ? 1 : 0) - (k.has('KeyQ') || k.has('ControlLeft') ? 1 : 0);
      const fwd = directionFrom((this.yaw * 180) / Math.PI, (this.pitch * 180) / Math.PI, this.tmp);
      const move = new Vector3(cos * strafe, 0, sin * strafe).addScaledVector(fwd, forward);
      this.position.addScaledVector(move, speed * dt);
      this.position.y += vertical * speed * 0.6 * dt;
      this.clampToWorld();
      return;
    }

    const speed = sprint ? RUN : WALK;
    // Ease horizontal velocity so starts and stops feel weighty without a full model.
    const accel = this.onGround ? 14 : 3;
    this.velocity.x += (wx * speed - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (wz * speed - this.velocity.z) * Math.min(1, accel * dt);
    this.velocity.y -= GRAVITY * dt;
    if (this.onGround && k.has('Space')) {
      this.velocity.y = JUMP;
      this.onGround = false;
    }
    this.position.addScaledVector(this.velocity, dt);
    this.resolve();
    this.clampToWorld();
  }

  private resolve(): void {
    this.onGround = false;
    const heights = [RADIUS, 0.95, 1.5];
    for (let pass = 0; pass < 3; pass++) {
      for (const h of heights) {
        const x = this.position.x;
        const y = this.position.y + h;
        const z = this.position.z;
        const d = this.grid.sample(x, y, z) - RADIUS;
        if (d >= 0) continue;
        this.grid.gradient(x, y, z, this.grad);
        const gx = this.grad[0] as number;
        const gy = this.grad[1] as number;
        const gz = this.grad[2] as number;
        const gl = Math.hypot(gx, gy, gz) || 1;
        const nx = gx / gl;
        const ny = gy / gl;
        const nz = gz / gl;
        this.position.x -= nx * d;
        this.position.y -= ny * d;
        this.position.z -= nz * d;
        if (ny > 0.55) {
          this.onGround = true;
          if (this.velocity.y < 0) this.velocity.y = 0;
        }
        // Remove velocity into the surface.
        const into = this.velocity.x * nx + this.velocity.y * ny + this.velocity.z * nz;
        if (into < 0) {
          this.velocity.x -= nx * into;
          this.velocity.y -= ny * into;
          this.velocity.z -= nz * into;
        }
      }
    }
  }

  private clampToWorld(): void {
    const b = this.bound - 1;
    this.position.x = MathUtils.clamp(this.position.x, -b, b);
    this.position.z = MathUtils.clamp(this.position.z, -b, b);
    this.position.y = Math.max(this.position.y, -2);
  }

  /** Writes the eye pose into the camera. */
  apply(camera: PerspectiveCamera): void {
    camera.position.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
    const dir = directionFrom((this.yaw * 180) / Math.PI, (this.pitch * 180) / Math.PI, this.tmp);
    camera.lookAt(camera.position.x + dir.x, camera.position.y + dir.y, camera.position.z + dir.z);
  }
}

/** A looping camera path through FLY_PATH for the benchmark and the screenshot tour. */
export class CameraPath {
  private readonly points: Vector3[];
  private readonly looks: [number, number][];
  private readonly total: number;

  constructor(
    grid: SdfGrid,
    private readonly seconds: number,
  ) {
    this.points = FLY_PATH.map(([x, z, h]) => new Vector3(x, grid.groundAt(x, z) + h, z));
    this.looks = FLY_PATH.map(([, , , bearing, pitch]) => [bearing, pitch]);
    this.total = FLY_PATH.length - 1;
  }

  private static catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      0.5 *
      (2 * p1 +
        (p2 - p0) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (3 * p1 - p0 - 3 * p2 + p3) * t3)
    );
  }

  /** Writes the pose at time `t` seconds into the camera. */
  apply(camera: PerspectiveCamera, t: number): void {
    const u = ((t / this.seconds) % 1) * this.total;
    const i = Math.min(this.total - 1, Math.floor(u));
    const f = u - i;
    const at = (n: number): number => Math.min(this.total, Math.max(0, n));
    const P = (n: number): Vector3 => this.points[at(n)] as Vector3;
    const pos = new Vector3(
      CameraPath.catmull(P(i - 1).x, P(i).x, P(i + 1).x, P(i + 2).x, f),
      CameraPath.catmull(P(i - 1).y, P(i).y, P(i + 1).y, P(i + 2).y, f),
      CameraPath.catmull(P(i - 1).z, P(i).z, P(i + 1).z, P(i + 2).z, f),
    );
    const a = this.looks[i] as [number, number];
    const b = this.looks[at(i + 1)] as [number, number];
    // Shortest-way bearing interpolation.
    let db = b[0] - a[0];
    if (db > 180) db -= 360;
    if (db < -180) db += 360;
    const s = f * f * (3 - 2 * f);
    const bearing = a[0] + db * s;
    const pitch = a[1] + (b[1] - a[1]) * s;
    camera.position.copy(pos);
    const dir = directionFrom(bearing, pitch);
    camera.lookAt(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z);
  }
}
