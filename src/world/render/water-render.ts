import {
  BufferAttribute,
  BufferGeometry,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  NormalBlending,
  PerspectiveCamera,
  Plane,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Group,
  type IUniform,
  type Scene,
  type ShaderMaterial,
  type WebGLRenderer,
} from 'three';
import { ATMOSPHERE_GLSL } from '../../engine/glsl/atmosphere.glsl';
import type { MaterialRegistry } from '../../engine/materials';
import type { BakedTextures } from '../../engine/texture-bake';
import type { WaterMode } from '../../shared/quality';
import { WATER_LEVEL } from '../terrain/field';
import { LAKE_DEPTH_RANGE, type LakeMap } from './terrain-render';

const WATER_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAGMENT = /* glsl */ `
${ATMOSPHERE_GLSL}
uniform sampler2D uRipple;
uniform sampler2D uLakeDepth;
uniform vec4 uLakeBox;  // x0, z0, 1 / width, 1 / depth
uniform vec4 uWater;    // x depth range (m), y ripple strength, z reflection distortion
#ifdef PLANAR
uniform sampler2D uReflection;
uniform mat4 uReflectionMatrix;
#endif
varying vec3 vWorld;

void main() {
  vec3 P = vWorld;
  vec3 toCam = uCamPos - P;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 0.001);

  float depth = texture2D(uLakeDepth, (P.xz - uLakeBox.xy) * uLakeBox.zw).r * uWater.x;
  float shore = smoothstep(0.0, 0.1, depth);
  if (shore <= 0.0) discard;

  float t = uSkyParams.z;
  vec2 s1 = texture2D(uRipple, P.xz * 0.045 + vec2(t * 0.006, t * 0.004)).rg * 2.0 - 1.0;
  vec2 s2 = texture2D(uRipple, P.xz * 0.13 + vec2(-t * 0.014, t * 0.009)).rg * 2.0 - 1.0;
  float far = 1.0 / (1.0 + dist * 0.012);
  #ifdef WATER_FLAT
    vec2 slope = s2 * 0.3 * far;
  #else
    vec2 s3 = texture2D(uRipple, P.xz * 0.41 + vec2(t * 0.03, -t * 0.021)).rg * 2.0 - 1.0;
    vec2 slope = s1 * 0.5 + s2 * 0.28 * (0.45 + 0.55 * far) + s3 * 0.18 * far;
  #endif
  slope *= uWater.y;
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));

  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float cosV = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.03 + 0.97 * pow(1.0 - cosV, 5.0);

  vec3 refl = skyRadiance(R);
  #ifdef PLANAR
    vec4 rc = uReflectionMatrix * vec4(P, 1.0);
    vec2 ruv = rc.xy / rc.w + slope * uWater.z;
    vec2 edge = smoothstep(vec2(0.0), vec2(0.04), ruv) * smoothstep(vec2(1.0), vec2(0.96), ruv);
    vec3 planar = texture2D(uReflection, clamp(ruv, 0.001, 0.999)).rgb;
    refl = mix(refl, planar, edge.x * edge.y * step(0.0, rc.w));
  #endif

  // Body color: red is absorbed first, so deeper water goes dark teal.
  float depthK = 1.0 - exp(-depth * 0.5);
  vec3 body = mix(vec3(0.07, 0.2, 0.17), vec3(0.008, 0.06, 0.07), depthK);
  vec3 lightOnWater = ambientLight(vec3(0.0, 1.0, 0.0)) * 0.95
                    + uKeyColor * 0.2 * clamp(uKeyDir.y + 0.15, 0.0, 1.0);
  body *= lightOnWater;
  float bodyOpacity = 1.0 - exp(-depth * 0.9);

  // Sun glints: a tight lobe for the sparkle and a wide one for the sheen around it.
  float sunR = max(dot(R, uSunDir), 0.0);
  vec3 glint = uSunColor * (pow(sunR, 1400.0) * 36.0 + pow(sunR, 110.0) * 0.9) * step(0.0, uSunDir.y);

  float alpha = F + (1.0 - F) * bodyOpacity;
  vec3 radiance = refl * F + body * (1.0 - F) * bodyOpacity + glint * F;

  // Foam along the shore, broken up by noise.
  float fn = texture2D(uNoise, P.xz * 0.37 + vec2(t * 0.004, 0.0)).b;
  float foam = smoothstep(0.7, 0.05, depth + (fn - 0.5) * 0.55) * 0.75;
  vec3 foamColor = (lightOnWater * 0.8 + uKeyColor * 0.15) * vec3(0.95, 0.97, 1.0);
  radiance += foamColor * foam;
  alpha = max(alpha, foam);

  vec3 straight = applyAtmosphere(radiance / max(alpha, 0.001), P);
  float a = alpha * shore;
  gl_FragColor = vec4(straight * a, a);
}
`;

const MIRROR_BIAS = 0.003;

function at(e: ArrayLike<number>, i: number): number {
  return e[i] as number;
}

/**
 * The lake surface: one quad over the box that holds the water, shaded for depth, shore foam,
 * ripples and sun glints. Ultra adds a planar reflection of the terrain and trees.
 */
export class WaterRenderer {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private mode: WaterMode = 'ripples';
  private reflectionScale = 0;
  private target: WebGLRenderTarget | null = null;
  private readonly mirror = new PerspectiveCamera();
  private readonly reflectionMatrix = new Matrix4();
  private readonly clip = new Vector4();
  private readonly q = new Vector4();
  private readonly plane = new Plane();
  private readonly pos = new Vector3();
  private readonly fwd = new Vector3();
  private readonly up = new Vector3();

  constructor(
    private readonly group: Group,
    lake: LakeMap,
    textures: BakedTextures,
    registry: MaterialRegistry,
  ) {
    const { x0, z0, x1, z1 } = lake;
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([
          x0,
          WATER_LEVEL,
          z0,
          x1,
          WATER_LEVEL,
          z0,
          x1,
          WATER_LEVEL,
          z1,
          x0,
          WATER_LEVEL,
          z1,
        ]),
        3,
      ),
    );
    geometry.setIndex([0, 2, 1, 0, 3, 2]);
    geometry.computeBoundingSphere();

    const uniforms: Record<string, IUniform> = {
      uRipple: { value: textures.ripple },
      uLakeDepth: { value: lake.texture },
      uLakeBox: { value: new Vector4(x0, z0, 1 / (x1 - x0), 1 / (z1 - z0)) },
      uWater: { value: new Vector4(LAKE_DEPTH_RANGE, 1, 0.035, 0) },
      uReflection: { value: null },
      uReflectionMatrix: { value: this.reflectionMatrix },
    };
    this.material = registry.createPlain({
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: NormalBlending,
      premultipliedAlpha: true,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = true;
    group.add(this.mesh);
    this.mirror.layers.set(0);
  }

  /** Picks the water model for a preset. Planar needs `renderReflection` each frame. */
  setMode(mode: WaterMode, reflectionScale: number): void {
    this.mode = mode;
    this.reflectionScale = reflectionScale;
    const defines: Record<string, string> = {
      ...(this.material.defines as Record<string, string>),
    };
    delete defines.WATER_FLAT;
    delete defines.PLANAR;
    if (mode === 'flat') defines.WATER_FLAT = '1';
    if (mode === 'planar') defines.PLANAR = '1';
    this.material.defines = defines;
    this.material.needsUpdate = true;
    if (mode !== 'planar') this.releaseTarget();
  }

  get usesReflection(): boolean {
    return this.mode === 'planar';
  }

  /** The size of the reflection target, or null when there is none. */
  get reflectionSize(): { width: number; height: number } | null {
    return this.target ? { width: this.target.width, height: this.target.height } : null;
  }

  /**
   * Renders the scene seen from a camera mirrored in the water plane, clipped to what is above
   * the water, into a half-resolution HDR target the water shader samples.
   */
  renderReflection(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    width: number,
    height: number,
  ): void {
    if (this.mode !== 'planar') return;
    const w = Math.max(16, Math.round(width * this.reflectionScale));
    const h = Math.max(16, Math.round(height * this.reflectionScale));
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.releaseTarget();
      this.target = new WebGLRenderTarget(w, h, {
        type: HalfFloatType,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: true,
        generateMipmaps: false,
      });
      (this.material.uniforms.uReflection as IUniform).value = this.target.texture;
    }

    const mirror = this.mirror;
    camera.getWorldPosition(this.pos);
    camera.getWorldDirection(this.fwd);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const level2 = 2 * WATER_LEVEL;
    mirror.position.set(this.pos.x, level2 - this.pos.y, this.pos.z);
    mirror.up.set(this.up.x, -this.up.y, this.up.z);
    mirror.lookAt(
      this.pos.x + this.fwd.x,
      level2 - (this.pos.y + this.fwd.y),
      this.pos.z + this.fwd.z,
    );
    mirror.near = camera.near;
    mirror.far = camera.far;
    mirror.fov = camera.fov;
    mirror.aspect = camera.aspect;
    mirror.updateProjectionMatrix();
    mirror.updateMatrixWorld();

    this.reflectionMatrix
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(mirror.projectionMatrix)
      .multiply(mirror.matrixWorldInverse);

    // Oblique near plane: nothing below the water surface may appear in its own reflection.
    this.plane.set(new Vector3(0, 1, 0), -WATER_LEVEL).applyMatrix4(mirror.matrixWorldInverse);
    this.clip.set(
      this.plane.normal.x,
      this.plane.normal.y,
      this.plane.normal.z,
      this.plane.constant,
    );
    const e = mirror.projectionMatrix.elements;
    this.q.set(
      (Math.sign(this.clip.x) + at(e, 8)) / at(e, 0),
      (Math.sign(this.clip.y) + at(e, 9)) / at(e, 5),
      -1,
      (1 + at(e, 10)) / at(e, 14),
    );
    this.clip.multiplyScalar(2 / this.clip.dot(this.q));
    e[2] = this.clip.x;
    e[6] = this.clip.y;
    e[10] = this.clip.z + 1 - MIRROR_BIAS;
    e[14] = this.clip.w;

    const shadowsWereOn = renderer.shadowMap.enabled;
    const previousTarget = renderer.getRenderTarget();
    this.mesh.visible = false;
    renderer.shadowMap.enabled = false;
    renderer.setRenderTarget(this.target);
    renderer.clear(true, true, true);
    renderer.render(scene, mirror);
    renderer.setRenderTarget(previousTarget);
    renderer.shadowMap.enabled = shadowsWereOn;
    this.mesh.visible = true;
  }

  private releaseTarget(): void {
    this.target?.dispose();
    this.target = null;
    const uniform = this.material.uniforms.uReflection;
    if (uniform) uniform.value = null;
  }

  dispose(): void {
    this.releaseTarget();
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}
