import type { Color } from 'three';
import {
  DirectionalLight,
  PCFShadowMap,
  Vector3,
  type Group,
  type IUniform,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import type { QualitySettings } from '../shared/quality';

/**
 * The shadow-casting key light. Materials take their light direction and color from the
 * atmosphere uniforms; three's light objects exist only to drive the shadow maps. Balanced
 * uses one texel-snapped orthographic map that follows the player, Ultra uses three's two
 * cascades, and Low skips shadow maps entirely.
 */
export class SunRig {
  private readonly directional = new DirectionalLight(0xffffff, 0);
  private readonly cascaded = new SunLight(0xffffff, 0);
  private quality: QualitySettings | null = null;
  private readonly focus = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();

  constructor(
    private readonly root: Group,
    private readonly renderer: WebGLRenderer,
    /** Shared uniform read by `sunShadow()` in lit materials. */
    readonly shadowParams: IUniform<Vector3>,
  ) {
    this.directional.target.position.set(0, 0, 0);
    this.root.add(this.directional.target);
    renderer.shadowMap.type = PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
  }

  configure(quality: QualitySettings): void {
    this.quality = quality;
    const { shadows, shadowMapSize, shadowDistance } = quality;
    this.root.remove(this.directional, this.cascaded);
    this.directional.castShadow = false;
    this.cascaded.castShadow = false;
    this.renderer.shadowMap.enabled = shadows !== 'blob';
    this.shadowParams.value.set(
      shadows === 'blob' ? 0 : 1,
      shadowDistance * 0.72,
      shadowDistance * 0.98,
    );
    if (shadows === 'single') {
      const shadow = this.directional.shadow;
      shadow.mapSize.set(shadowMapSize, shadowMapSize);
      shadow.bias = -0.0004;
      shadow.normalBias = 0.07;
      shadow.radius = 1.7;
      this.directional.castShadow = true;
      this.root.add(this.directional);
    } else if (shadows === 'cascades') {
      const shadow = this.cascaded.shadow;
      shadow.mapSize.set(shadowMapSize, shadowMapSize);
      shadow.bias = -0.0003;
      shadow.normalBias = 0.06;
      shadow.radius = 1.9;
      shadow.camera.far = shadowDistance;
      this.cascaded.castShadow = true;
      this.root.add(this.cascaded);
    }
    // Force the shadow textures to be rebuilt at the new size.
    for (const light of [this.directional, this.cascaded]) {
      if (light.shadow.map) {
        light.shadow.map.dispose();
        light.shadow.map = null;
      }
    }
  }

  /** Points the shadow light along `keyDir` (toward the light) and centers the map on the view. */
  update(keyDir: Vector3, camera: PerspectiveCamera): void {
    const quality = this.quality;
    if (!quality || quality.shadows === 'blob') return;
    this.renderer.shadowMap.needsUpdate = true;
    if (quality.shadows === 'cascades') {
      this.cascaded.position.copy(keyDir);
      this.cascaded.updateMatrixWorld();
      return;
    }
    const half = quality.shadowDistance * 0.55;
    camera.getWorldDirection(this.focus);
    this.focus.y = 0;
    if (this.focus.lengthSq() < 1e-4) this.focus.set(0, 0, -1);
    this.focus
      .normalize()
      .multiplyScalar(half * 0.7)
      .add(camera.position);
    this.focus.y = Math.max(camera.position.y - 6, 4);

    // Snap the focus to the shadow texel grid so the map does not shimmer as the camera moves.
    const forward = new Vector3().copy(keyDir).negate();
    this.right.set(0, 1, 0).cross(forward);
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
    this.up.crossVectors(forward, this.right).normalize();
    // Three's lookAt gives the camera right = forward x up(0,1,0), the opposite handedness; the
    // snap only needs two perpendicular axes in the light plane, so the order does not matter.
    const texel = (half * 2) / quality.shadowMapSize;
    const fr = this.focus.dot(this.right);
    const fu = this.focus.dot(this.up);
    this.focus.addScaledVector(this.right, Math.round(fr / texel) * texel - fr);
    this.focus.addScaledVector(this.up, Math.round(fu / texel) * texel - fu);

    const light = this.directional;
    light.position.copy(this.focus).addScaledVector(keyDir, 170);
    light.target.position.copy(this.focus);
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    const cam = light.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = 340;
    cam.updateProjectionMatrix();
  }

  /** Sets the lights' own color to the key color, for tools that read three's light state. */
  tint(color: Color): void {
    this.directional.color.copy(color);
    this.cascaded.color.copy(color);
  }

  dispose(): void {
    this.directional.shadow.dispose();
    this.cascaded.shadow.dispose();
    this.root.remove(this.directional, this.cascaded);
  }
}
