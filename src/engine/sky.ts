import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  LessEqualDepth,
  Mesh,
  type ShaderMaterial,
} from 'three';
import { ATMOSPHERE_GLSL } from './glsl/atmosphere.glsl';
import type { MaterialRegistry } from './materials';

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 view = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
  vDir = (inverse(viewMatrix) * vec4(view.xyz / view.w, 0.0)).xyz;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
${ATMOSPHERE_GLSL}
varying vec3 vDir;
void main() {
  gl_FragColor = vec4(skyRadiance(normalize(vDir)), 1.0);
}
`;

/**
 * The sky: one full-screen triangle drawn at the far plane after the opaque scene, so only
 * the pixels nothing else covered pay for the clouds.
 */
export function createSky(registry: MaterialRegistry): { mesh: Mesh; material: ShaderMaterial } {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  const material = registry.createPlain({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: {},
    depthTest: true,
    depthWrite: false,
    depthFunc: LessEqualDepth,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;
  return { mesh, material };
}
