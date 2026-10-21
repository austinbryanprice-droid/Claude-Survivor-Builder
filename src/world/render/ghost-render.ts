import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  ShaderMaterial,
} from 'three';
import type { Stage } from '../../engine/stage';
import { MATERIAL, SHAPE, packState } from '../../shared/blocks';
import { meshChunk } from '../voxels/mesher';

/**
 * What the player aims with: a ghost block at the cell a click would fill, tinted by whether the
 * click would work, and an outline around the block a click would break. The ghost is the very
 * beveled cube the mesher makes (so it shows the shape that will appear), drawn translucent with a
 * bright rim; both sit exactly on the grid cell, which is what makes the snap readable.
 */

/** Linear colors (they go into a bloom threshold of 1, so the outline glows a little). */
const VALID = new Color(0.12, 0.85, 1.0);
const INVALID = new Color(1.0, 0.2, 0.1);
const TARGET = new Color(1.0, 0.95, 0.85);
const TARGET_BLOCKED = new Color(1.0, 0.45, 0.25);

/** The outline stands a hair outside the cell so it does not fight the faces of its neighbors. */
const OUTLINE_SCALE = 1.006;
const TARGET_SCALE = 1.012;

const VERTEX = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = clamp(dot(N, V), 0.0, 1.0);
  // A bright rim so the shape reads against any ground, and a slow breath so it reads as a preview.
  float rim = pow(1.0 - facing, 2.4);
  float breath = 0.5 + 0.5 * sin(uTime * 3.2);
  float alpha = uAlpha * (0.82 + 0.18 * breath) + rim * 0.5;
  vec3 color = uColor * (0.6 + 0.5 * rim + 0.18 * breath);
  gl_FragColor = vec4(color, min(alpha, 0.85));
}
`;

/** Both the ghost and the outline come from one cell at the origin, so they are moved by position alone. */
function cubeGeometry(): BufferGeometry {
  const cube = packState(SHAPE.cube, MATERIAL.scrap);
  const data = meshChunk(
    { getBlock: (x, y, z) => (x === 0 && y === 0 && z === 0 ? cube : 0) },
    0,
    0,
    0,
  );
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  return geometry;
}

export interface GhostCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class GhostRenderer {
  readonly object = new Group();
  private readonly body: Mesh;
  private readonly bodyMaterial: ShaderMaterial;
  private readonly bodyLines: LineSegments;
  private readonly bodyLineMaterial: LineBasicMaterial;
  private readonly target: Mesh;
  private readonly targetMaterial: ShaderMaterial;
  private readonly targetLines: LineSegments;
  private readonly targetLineMaterial: LineBasicMaterial;
  private readonly geometries: BufferGeometry[] = [];
  private time = 0;

  constructor(private readonly stage: Stage) {
    const cube = cubeGeometry();
    const box = new EdgesGeometry(new BoxGeometry(1, 1, 1));
    this.geometries.push(cube, box);

    const makeBody = (color: Color, alpha: number): ShaderMaterial =>
      new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uColor: { value: color.clone() },
          uAlpha: { value: alpha },
          uTime: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
    const makeLines = (color: Color): LineBasicMaterial =>
      new LineBasicMaterial({ color: color.clone(), transparent: true, depthWrite: false });

    this.bodyMaterial = makeBody(VALID, 0.3);
    this.body = new Mesh(cube, this.bodyMaterial);
    this.bodyLineMaterial = makeLines(VALID.clone().multiplyScalar(1.8));
    this.bodyLines = new LineSegments(box, this.bodyLineMaterial);
    this.bodyLines.scale.setScalar(OUTLINE_SCALE);

    // The block a click would break: a faint wash and a pale outline, a touch larger than the cell.
    this.targetMaterial = makeBody(TARGET, 0.1);
    this.target = new Mesh(cube, this.targetMaterial);
    this.target.scale.setScalar(TARGET_SCALE);
    this.targetLineMaterial = makeLines(TARGET.clone().multiplyScalar(1.4));
    this.targetLines = new LineSegments(box, this.targetLineMaterial);
    this.targetLines.scale.setScalar(TARGET_SCALE);

    for (const part of [this.body, this.bodyLines, this.target, this.targetLines]) {
      part.castShadow = false;
      part.receiveShadow = false;
      // They move every frame the player looks around and are never far from the camera.
      part.frustumCulled = false;
      part.renderOrder = 10;
    }
    this.object.add(this.body, this.bodyLines, this.target, this.targetLines);
    this.object.visible = false;
    this.body.visible = false;
    this.bodyLines.visible = false;
    this.target.visible = false;
    this.targetLines.visible = false;
    stage.world.add(this.object);
  }

  /** Whether the ghost block and the break outline are on screen. */
  get shown(): { readonly ghost: boolean; readonly target: boolean } {
    return { ghost: this.body.visible, target: this.target.visible };
  }

  /** Shows the ghost block on a cell, green-blue when a click would place it and red when it would not; null hides it. */
  setGhost(cell: GhostCell | null, valid = true): void {
    const shown = cell !== null;
    this.body.visible = shown;
    this.bodyLines.visible = shown;
    if (!cell) return this.syncVisibility();
    this.body.position.set(cell.x, cell.y, cell.z);
    this.bodyLines.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
    const tint = valid ? VALID : INVALID;
    (this.bodyMaterial.uniforms.uColor?.value as Color).copy(tint);
    this.bodyLineMaterial.color.copy(tint).multiplyScalar(1.8);
    this.syncVisibility();
  }

  /** Outlines the block a click would break, paler when the click would be refused; null hides it. */
  setTarget(cell: GhostCell | null, valid = true): void {
    const shown = cell !== null;
    this.target.visible = shown;
    this.targetLines.visible = shown;
    if (!cell) return this.syncVisibility();
    // The mesh grows from its corner, so it is moved back by half of what it grew.
    const shift = (TARGET_SCALE - 1) / 2;
    this.target.position.set(cell.x - shift, cell.y - shift, cell.z - shift);
    this.targetLines.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
    const tint = valid ? TARGET : TARGET_BLOCKED;
    (this.targetMaterial.uniforms.uColor?.value as Color).copy(tint);
    this.targetLineMaterial.color.copy(tint).multiplyScalar(1.4);
    this.syncVisibility();
  }

  /** Advances the breathing of the ghost by `dt` seconds. */
  update(dt: number): void {
    this.time += dt;
    for (const material of [this.bodyMaterial, this.targetMaterial]) {
      const uniform = material.uniforms.uTime;
      if (uniform) uniform.value = this.time;
    }
  }

  /** Compiles the ghost's programs now, so the first time Build Mode shows it does not stall on the driver. */
  precompile(): Promise<void> {
    return this.stage.precompile(this.object);
  }

  dispose(): void {
    this.stage.world.remove(this.object);
    for (const geometry of this.geometries) geometry.dispose();
    this.bodyMaterial.dispose();
    this.bodyLineMaterial.dispose();
    this.targetMaterial.dispose();
    this.targetLineMaterial.dispose();
  }

  private syncVisibility(): void {
    this.object.visible =
      this.body.visible ||
      this.bodyLines.visible ||
      this.target.visible ||
      this.targetLines.visible;
  }
}
