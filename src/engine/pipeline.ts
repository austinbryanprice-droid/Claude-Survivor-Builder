import {
  Color,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  RGBAFormat,
  UnsignedIntType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { SkyState } from '../shared/daycycle';
import type { QualitySettings } from '../shared/quality';
import { Bloom } from './post/bloom';
import { Composite } from './post/composite';
import { LightShafts } from './post/shafts';

export interface FrameInfo {
  readonly sky: SkyState;
  readonly timeSeconds: number;
}

/** Size and cost numbers read after a frame, for the overlay and the benchmark. */
export interface PipelineStats {
  readonly width: number;
  readonly height: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly renderScale: number;
}

function normalizeTint(rgb: readonly [number, number, number]): Vector3 {
  const c = new Color().setRGB(rgb[0], rgb[1], rgb[2]);
  const l = Math.max(0.0001, c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722);
  return new Vector3(c.r / l, c.g / l, c.b / l);
}

/**
 * Renders the scene into an HDR target, then runs shafts, bloom and the composite. The canvas
 * keeps its own size; the internal resolution is `renderScale` times it, which the adaptive
 * governor (perf.ts) moves to protect the frame rate.
 */
export class Pipeline {
  private hdr: WebGLRenderTarget | null = null;
  private readonly bloom = new Bloom(5);
  private readonly shafts = new LightShafts();
  private readonly composite = new Composite();
  private quality: QualitySettings | null = null;
  private canvasWidth = 2;
  private canvasHeight = 2;
  private scale = 1;
  private readonly sunScreen = new Vector2();
  private readonly sunWorld = new Vector3();
  private readonly shaftColor = new Vector3();
  private readonly viewDir = new Vector3();
  private readonly sunDirV = new Vector3();
  /** Called before the main scene render; the water uses it to draw the planar reflection. */
  beforeScene: ((camera: PerspectiveCamera) => void) | null = null;

  constructor(private readonly renderer: WebGLRenderer) {}

  get renderScale(): number {
    return this.scale;
  }

  setQuality(quality: QualitySettings): void {
    this.quality = quality;
    this.scale = quality.renderScale;
    this.rebuild();
  }

  /** Sets the internal scale (1 = canvas resolution) without touching the preset. */
  setRenderScale(scale: number): void {
    const next = Math.min(1, Math.max(0.4, scale));
    if (Math.abs(next - this.scale) < 0.005) return;
    this.scale = next;
    this.rebuild();
  }

  resize(canvasWidth: number, canvasHeight: number): void {
    this.canvasWidth = Math.max(2, canvasWidth);
    this.canvasHeight = Math.max(2, canvasHeight);
    this.rebuild();
  }

  private rebuild(): void {
    const q = this.quality;
    if (!q) return;
    const w = Math.max(2, Math.round(this.canvasWidth * this.scale));
    const h = Math.max(2, Math.round(this.canvasHeight * this.scale));
    this.hdr?.depthTexture?.dispose();
    this.hdr?.dispose();
    const samples = q.antiAlias === 'msaa' ? 4 : 0;
    const target = new WebGLRenderTarget(w, h, {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      samples,
    });
    target.depthTexture = new DepthTexture(w, h, UnsignedIntType);
    this.hdr = target;
    if (q.bloom !== 'off') this.bloom.resize(w, h, q.bloom === 'full' ? 1 : 0.5);
    if (q.lightShafts) this.shafts.resize(w, h);
  }

  get width(): number {
    return this.hdr?.width ?? 0;
  }

  get height(): number {
    return this.hdr?.height ?? 0;
  }

  render(
    scene: Scene,
    camera: PerspectiveCamera,
    frame: FrameInfo,
    stats: { value: PipelineStats | null },
  ): void {
    const q = this.quality;
    const hdr = this.hdr;
    if (!q || !hdr) return;
    const renderer = this.renderer;
    const info = renderer.info;
    // Count the whole frame (reflection, shadows, scene and post) as one.
    info.autoReset = false;
    info.reset();

    this.beforeScene?.(camera);

    renderer.setRenderTarget(hdr);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);

    const c = this.composite.uniforms;
    const sky = frame.sky;

    let bloomTex: Texture | null = null;
    if (q.bloom !== 'off') {
      this.bloom.threshold = 1.0;
      this.bloom.knee = 0.7;
      this.bloom.radius = q.bloom === 'full' ? 1.25 : 1.0;
      bloomTex = this.bloom.render(renderer, hdr.texture, hdr.width, hdr.height);
    }

    let shaftStrength = 0;
    let shaftTex: Texture | null = null;
    if (q.lightShafts && sky.sunElevation > -3) {
      this.sunWorld
        .set(...sky.sunDir)
        .multiplyScalar(1000)
        .add(camera.position);
      const ndc = this.sunWorld.clone().project(camera);
      const facing = Math.max(
        0,
        camera.getWorldDirection(this.viewDir).dot(this.sunDirV.set(...sky.sunDir)),
      );
      if (facing > 0.02) {
        this.sunScreen.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
        this.shaftColor.set(1, 0.82, 0.55);
        const horizon = Math.min(1, Math.max(0.2, 1.2 - sky.sunElevation / 50));
        shaftTex = this.shafts.render(
          renderer,
          hdr.depthTexture as Texture,
          this.sunScreen,
          this.shaftColor,
          1,
          camera.aspect,
        );
        shaftStrength = 1.3 * horizon * Math.min(1, facing * 2.2);
      }
    }

    c.tHdr.value = hdr.texture;
    c.tBloom.value = bloomTex ?? hdr.texture;
    c.tShafts.value = shaftTex ?? hdr.texture;
    c.uTexel.value.set(1 / hdr.width, 1 / hdr.height);
    c.uParams.value.set(
      sky.exposure,
      q.bloom === 'off' ? 0 : 0.42 * sky.bloom,
      sky.saturation,
      sky.contrast,
    );
    c.uParams2.value.set(
      0.24,
      shaftStrength,
      q.antiAlias === 'fxaa' ? 1 : 0,
      frame.timeSeconds % 7,
    );
    c.uShadowTint.value.copy(normalizeTint(sky.shadowTint));
    c.uHighlightTint.value.copy(normalizeTint(sky.highlightTint));
    c.uShaftColor.value.set(1, 0.82, 0.55);
    this.composite.pass.render(renderer, null);

    stats.value = {
      width: hdr.width,
      height: hdr.height,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      renderScale: this.scale,
    };
    info.autoReset = true;
  }

  /** The most recent depth buffer, for effects that need it. */
  get depthTexture(): Texture | null {
    return this.hdr?.depthTexture ?? null;
  }

  dispose(): void {
    this.hdr?.depthTexture?.dispose();
    this.hdr?.dispose();
    this.bloom.dispose();
    this.shafts.dispose();
    this.composite.dispose();
  }
}
