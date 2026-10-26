import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
} from 'three';
import { reachEdge } from '../../shared/power';

/**
 * Where a module's power reaches (Phase 5g): a thin ring of light on the ground, drawn round the cell
 * of the Generator in hand where it would stand, or round the one the cursor is on. It follows the
 * ground (a ribbon laid on the terrain at the points where a player stops being in reach, found by
 * the very rule the host charges by, `reachEdge`), so on a hill it is pulled in, and Energy comes back
 * inside it and not outside it. Dashes of light march slowly round it, so it reads as a field and not
 * as a painted line, from the stage's animation clock.
 */

/** The ribbon is made of this many pieces round the ring, and is this wide, in blocks. */
const SEGMENTS = 96;
const WIDTH = 0.34;
/** It floats this far above the ground, so that it does not fight the terrain for the pixel. */
const LIFT = 0.07;
/** How many dashes run round the ring, and how many turns of it they make in a second. */
const DASHES = 48;
const MARCH = 0.04;

/** The colour of a powered module, brighter than 1 so that the bloom picks it up (linear). */
const GLOW = new Color(0.12, 0.85, 1.0).multiplyScalar(1.4);

const VERTEX = /* glsl */ `
attribute float aAround;
attribute float aAcross;
varying float vAround;
varying float vAcross;
void main() {
  vAround = aAround;
  vAcross = aAcross;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uDashes;
uniform float uMarch;
varying float vAround;
varying float vAcross;
void main() {
  // Soft toward both edges of the ribbon, so it has a glow and no hard sides.
  float across = abs(vAcross * 2.0 - 1.0);
  float soft = 1.0 - across * across;
  // A dash is the bright half of a repeating pattern that slides round the ring.
  float phase = fract(vAround * uDashes - uTime * uMarch * uDashes);
  float dash = smoothstep(0.0, 0.18, phase) * (1.0 - smoothstep(0.52, 0.7, phase));
  float strength = 0.38 + 0.62 * dash;
  gl_FragColor = vec4(uColor * (0.7 + 0.5 * dash), 0.8 * soft * strength);
}
`;

/** The cell a ring is drawn round. */
export interface ReachCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class ReachRing {
  readonly object = new Group();
  private readonly geometry = new BufferGeometry();
  private readonly positions = new Float32Array((SEGMENTS + 1) * 2 * 3);
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;
  /** What the ring was last laid for, so that the same cell and radius cost nothing a frame later. */
  private laid = '';
  private cell: ReachCell | null = null;
  private reach = 0;

  /** `groundAt` says where the ground is under a point, in blocks. */
  constructor(
    parent: Group,
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    const around = new Float32Array((SEGMENTS + 1) * 2);
    const across = new Float32Array((SEGMENTS + 1) * 2);
    const index: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      around[i * 2] = around[i * 2 + 1] = i / SEGMENTS;
      across[i * 2] = 0;
      across[i * 2 + 1] = 1;
      if (i < SEGMENTS) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aAround', new BufferAttribute(around, 1));
    this.geometry.setAttribute('aAcross', new BufferAttribute(across, 1));
    this.geometry.setIndex(index);

    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uColor: { value: GLOW.clone() },
        uTime: { value: 0 },
        uDashes: { value: DASHES },
        uMarch: { value: MARCH },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      // The ground is drawn in the same place; the ring wins it by a hair.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    // It is laid in place, not moved, and its bounds are not kept.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 9;
    this.mesh.visible = false;
    this.object.name = 'reach-ring';
    this.object.add(this.mesh);
    parent.add(this.object);
  }

  /** The cell and radius the ring is drawn for now, or null while it is not on screen. */
  get shown(): {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly radius: number;
  } | null {
    return this.mesh.visible && this.cell
      ? { x: this.cell.x, y: this.cell.y, z: this.cell.z, radius: this.reach }
      : null;
  }

  /**
   * Draws the ring round the middle of a cell, `radius` blocks out, where a player who walks the
   * ground stops being in reach; null (or a radius of nothing) takes it away. The ground is read again
   * only when the cell or the radius is not the one it was laid for.
   */
  show(cell: ReachCell | null, radius = 0): void {
    const on = cell !== null && radius > 0;
    this.mesh.visible = on;
    if (!on) {
      this.cell = null;
      return;
    }
    this.cell = cell;
    this.reach = radius;
    const key = `${cell.x},${cell.y},${cell.z},${radius}`;
    if (key === this.laid) return;
    this.laid = key;
    this.lay(cell, radius);
  }

  /** Moves the dashes for the stage's animation clock, in seconds. */
  update(time: number): void {
    const uniform = this.material.uniforms.uTime;
    if (uniform) uniform.value = time;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }

  /** Lays the ribbon on the ground round the cell: for each bearing, a strip centred on the edge of the reach. */
  private lay(cell: ReachCell, radius: number): void {
    const mx = cell.x + 0.5;
    const mz = cell.z + 0.5;
    for (let i = 0; i <= SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const edge = reachEdge(cell.x, cell.y, cell.z, radius, dx, dz, this.groundAt);
      const inner = Math.max(0, edge - WIDTH / 2);
      const outer = edge + WIDTH / 2;
      this.vertex(i * 2, mx + dx * inner, mz + dz * inner);
      this.vertex(i * 2 + 1, mx + dx * outer, mz + dz * outer);
    }
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }

  private vertex(slot: number, x: number, z: number): void {
    const at = slot * 3;
    this.positions[at] = x;
    this.positions[at + 1] = this.groundAt(x, z) + LIFT;
    this.positions[at + 2] = z;
  }
}
