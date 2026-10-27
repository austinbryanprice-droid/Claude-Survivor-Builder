import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  Vector4,
  type ShaderMaterial,
} from 'three';
import type { MaterialRegistry } from '../materials';

/**
 * A burst of light seen from afar: a square turned to face the camera, bright in the middle with a
 * halo and four points of light, added to what is behind it. The film's fireball head, the flash of
 * the touchdown and the pulse of the Core are all this, at different sizes and colors.
 */

const VERTEX = /* glsl */ `
uniform vec4 uPlace;     // x, y, z of the middle, and its radius in meters
uniform float uShare;    // the least it covers of its distance from the camera, as a share
varying vec2 vUv;

void main() {
  vec3 center = uPlace.xyz;
  float dist = length(cameraPosition - center);
  float radius = max(uPlace.w, dist * uShare);
  vec4 mv = viewMatrix * vec4(center, 1.0);
  mv.xy += position.xy * radius;
  vUv = position.xy;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uHalo;
uniform float uPower;
uniform float uRays;
varying vec2 vUv;

void main() {
  float r = length(vUv);
  if (r >= 1.0) discard;
  float edge = 1.0 - smoothstep(0.7, 1.0, r);
  float core = exp(-r * r * 26.0);
  float halo = max(1.0 / (1.0 + r * r * 14.0) - 0.07, 0.0);
  float wide = pow(max(1.0 - r, 0.0), 2.0);
  float armX = pow(max(0.0, 1.0 - abs(vUv.y) * 9.0), 2.0) * pow(1.0 - abs(vUv.x), 2.5);
  float armY = pow(max(0.0, 1.0 - abs(vUv.x) * 9.0), 2.0) * pow(1.0 - abs(vUv.y), 2.5);
  vec3 light = uCore * core * 6.0 + uHalo * (halo * 2.2 + wide * 0.25) + uCore * (armX + armY) * 1.4 * uRays;
  gl_FragColor = vec4(light * uPower * edge, 1.0);
}
`;

export interface Glow {
  readonly mesh: Mesh;
  /** Puts it at (x, y, z) with `radius` meters of reach and `power` times its brightness; 0 power hides it. */
  set(x: number, y: number, z: number, radius: number, power: number): void;
  dispose(): void;
}

export interface GlowOptions {
  /** The white-hot middle and the colored halo, linear. */
  readonly core?: string;
  readonly halo?: string;
  /** The four points of light, from 0 (none) to 1. */
  readonly rays?: number;
  /** The least it covers of its distance from the camera, so that a far one still shows. */
  readonly share?: number;
}

export function createGlow(registry: MaterialRegistry, options: GlowOptions = {}): Glow {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const place = { value: new Vector4(0, 0, 0, 1) };
  const power = { value: 0 };
  const material: ShaderMaterial = registry.createPlain({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uPlace: place,
      uShare: { value: options.share ?? 0.02 },
      uCore: { value: new Color(options.core ?? '#fff1d6') },
      uHalo: { value: new Color(options.halo ?? '#ff6a1c') },
      uPower: power,
      uRays: { value: options.rays ?? 0.6 },
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'intro-glow';
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  mesh.visible = false;
  return {
    mesh,
    set(x, y, z, radius, brightness) {
      mesh.visible = brightness > 0.001;
      place.value.set(x, y, z, radius);
      power.value = brightness;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      registry.release(material);
    },
  };
}
