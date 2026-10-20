import {
  ACESFilmicToneMapping,
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';

/**
 * Basic light and sky for the movement test: a low warm sun with one shadow map that follows the
 * player, a hemisphere fill, a gradient sky with a sun glow, and haze toward the horizon. The
 * colors are the starting palette from docs/art-direction.md; the look spike replaces all of this.
 */

const ZENITH = '#2f5d9e';
const MIDSKY = '#6d7fb8';
const HORIZON = '#f2a65a';
const SUN_COLOR = '#ffd9a0';

const SHADOW_MAP_SIZE = 2048;
/** Half the width of the area the shadow map covers, in blocks. */
const SHADOW_EXTENT = 36;
const SUN_DISTANCE = 90;

export interface Environment {
  /** Unit vector from the world toward the sun. */
  readonly sunDirection: Vector3;
  /** Centers the sky on the camera and the shadow window on `focus` (usually the player). */
  update(camera: PerspectiveCamera, focus: Vector3): void;
  dispose(): void;
}

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 midsky;
  uniform vec3 horizon;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  varying vec3 vDirection;
  void main() {
    vec3 dir = normalize(vDirection);
    float h = clamp(dir.y, -0.3, 1.0);
    vec3 color = mix(horizon, midsky, smoothstep(0.0, 0.22, h));
    color = mix(color, zenith, smoothstep(0.18, 0.85, h));
    // Haze below the horizon so the ground's far edge melts into the sky.
    color = mix(color, horizon * 0.85, smoothstep(0.0, -0.25, dir.y));
    float s = max(dot(dir, sunDirection), 0.0);
    color += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 40.0) * 0.55 + pow(s, 6.0) * 0.18);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createEnvironment(renderer: WebGLRenderer, scene: Scene): Environment {
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const sunDirection = new Vector3(-0.5, 0.5, 0.9).normalize();

  const hemisphere = new HemisphereLight('#aac0ea', '#9a7a58', 2.6);
  scene.add(hemisphere);

  const sun = new DirectionalLight(SUN_COLOR, 3.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.camera.left = -SHADOW_EXTENT;
  sun.shadow.camera.right = SHADOW_EXTENT;
  sun.shadow.camera.top = SHADOW_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_EXTENT;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = SUN_DISTANCE * 2;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);

  scene.background = null;
  scene.fog = new Fog(new Color(HORIZON).lerp(new Color('#d9c0a6'), 0.45), 70, 330);

  const skyMaterial = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new Color(ZENITH) },
      midsky: { value: new Color(MIDSKY) },
      horizon: { value: new Color(HORIZON) },
      sunColor: { value: new Color(SUN_COLOR) },
      sunDirection: { value: sunDirection },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
  });
  const skyGeometry = new SphereGeometry(450, 32, 16);
  const sky = new Mesh(skyGeometry, skyMaterial);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);

  // The shadow window moves in whole shadow-map texels along the light's own axes, so shadow
  // edges do not shimmer as the player walks.
  const texel = (2 * SHADOW_EXTENT) / SHADOW_MAP_SIZE;
  const lightRight = new Vector3().crossVectors(new Vector3(0, 1, 0), sunDirection).normalize();
  const lightUp = new Vector3().crossVectors(sunDirection, lightRight).normalize();
  const snapped = new Vector3();

  return {
    sunDirection,
    update(camera, focus) {
      sky.position.copy(camera.position);
      const a = Math.round(focus.dot(lightRight) / texel) * texel;
      const b = Math.round(focus.dot(lightUp) / texel) * texel;
      const c = focus.dot(sunDirection);
      snapped.set(0, 0, 0).addScaledVector(lightRight, a).addScaledVector(lightUp, b);
      snapped.addScaledVector(sunDirection, c);
      sun.target.position.copy(snapped);
      sun.position.copy(snapped).addScaledVector(sunDirection, SUN_DISTANCE);
      sun.target.updateMatrixWorld();
    },
    dispose() {
      skyGeometry.dispose();
      skyMaterial.dispose();
      sun.shadow.dispose();
      hemisphere.dispose();
      scene.remove(sky, sun, sun.target, hemisphere);
    },
  };
}
