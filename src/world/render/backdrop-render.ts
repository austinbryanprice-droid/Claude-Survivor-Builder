import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  Sphere,
  Vector3,
  type Group,
  type ShaderMaterial,
} from 'three';
import { ATMOSPHERE_GLSL } from '../../engine/glsl/atmosphere.glsl';
import type { MaterialRegistry } from '../../engine/materials';
import { smoothstep } from '../../shared/noise';
import { WORLD_HALF, type TerrainField } from '../terrain/field';

const BACKDROP_VERTEX = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vWorld = position;
  vNormal = normal;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const BACKDROP_FRAGMENT = /* glsl */ `
${ATMOSPHERE_GLSL}
varying vec3 vWorld;
varying vec3 vNormal;

void main() {
  vec3 N = normalize(vNormal);
  float h = vWorld.y;
  float slope = 1.0 - N.y;
  float n1 = texture2D(uNoise, vWorld.xz * 0.004).r;
  float n2 = texture2D(uNoise, vWorld.xz * 0.021 + 0.37).g;

  vec3 forest = vec3(0.028, 0.062, 0.026) * (0.75 + 0.7 * n2);
  vec3 meadow = vec3(0.09, 0.14, 0.045) * (0.8 + 0.5 * n1);
  vec3 rock = vec3(0.17, 0.145, 0.125) * (0.75 + 0.5 * n2);
  vec3 snow = vec3(0.78, 0.78, 0.8);

  vec3 col = mix(meadow, forest, smoothstep(10.0, 24.0, h) * smoothstep(0.5, 0.2, slope));
  float rockW = clamp(smoothstep(0.26, 0.46, slope + (n1 - 0.5) * 0.22) + smoothstep(70.0, 130.0, h + (n1 - 0.5) * 50.0) * 0.8, 0.0, 1.0);
  col = mix(col, rock, rockW);
  float snowW = smoothstep(140.0, 175.0, h + (n2 - 0.5) * 36.0) * smoothstep(0.62, 0.3, slope);
  col = mix(col, snow, snowW);

  float ndl = dot(N, uKeyDir);
  float diff = clamp((ndl + 0.12) / 1.12, 0.0, 1.0);
  vec3 lit = col * (uKeyColor * diff + ambientLight(N));
  lit = applyAtmosphere(lit, vWorld);
  gl_FragColor = vec4(lit, 1.0);
}
`;

const ANGLES = 288;
const INNER_RADIUS = 86;
const OUTER_RADIUS = 2400;
const GROWTH = 1.082;

/**
 * Mountains and far hills beyond the playable square: one polar mesh sampled from the same
 * height function, so the skyline continues the valley instead of ending at its edge.
 */
export class BackdropRenderer {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly triangles: number;

  constructor(
    private readonly group: Group,
    field: TerrainField,
    registry: MaterialRegistry,
  ) {
    const radii: number[] = [];
    for (let r = INNER_RADIUS; r < OUTER_RADIUS; r *= GROWTH) radii.push(r);
    radii.push(OUTER_RADIUS);
    const rings = radii.length;
    const positions = new Float32Array(rings * ANGLES * 3);
    for (let i = 0; i < rings; i++) {
      const r = radii[i] as number;
      for (let a = 0; a < ANGLES; a++) {
        const t = (a / ANGLES) * Math.PI * 2;
        const x = Math.cos(t) * r;
        const z = Math.sin(t) * r;
        // The playable terrain covers the inside; sink the ring there so it never shows through.
        const inside = Math.max(Math.abs(x), Math.abs(z));
        const sink = 0.7 * smoothstep(WORLD_HALF + 8, WORLD_HALF, inside);
        const o = (i * ANGLES + a) * 3;
        positions[o] = x;
        positions[o + 1] = field.heightAt(x, z) - sink;
        positions[o + 2] = z;
      }
    }

    const indices: number[] = [];
    for (let i = 0; i + 1 < rings; i++) {
      for (let a = 0; a < ANGLES; a++) {
        const a1 = (a + 1) % ANGLES;
        const v00 = i * ANGLES + a;
        const v10 = i * ANGLES + a1;
        const v01 = (i + 1) * ANGLES + a;
        const v11 = (i + 1) * ANGLES + a1;
        indices.push(v00, v01, v11, v00, v11, v10);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.boundingSphere = new Sphere(new Vector3(0, 60, 0), OUTER_RADIUS * 1.05);

    this.material = registry.createPlain({
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      uniforms: {},
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.triangles = indices.length / 3;
    group.add(this.mesh);
  }

  dispose(): void {
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}
