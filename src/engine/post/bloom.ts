import {
  AdditiveBlending,
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  NoBlending,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { FULLSCREEN_VERTEX, FullscreenPass } from './fullscreen';

const DOWN_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
uniform vec2 uThreshold;

vec3 tap(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float karis(vec3 c) { return 1.0 / (1.0 + luma(c)); }

void main() {
  vec3 a = tap(vec2(-2.0, 2.0)), b = tap(vec2(0.0, 2.0)), c = tap(vec2(2.0, 2.0));
  vec3 d = tap(vec2(-2.0, 0.0)), e = tap(vec2(0.0, 0.0)), f = tap(vec2(2.0, 0.0));
  vec3 g = tap(vec2(-2.0, -2.0)), h = tap(vec2(0.0, -2.0)), i = tap(vec2(2.0, -2.0));
  vec3 j = tap(vec2(-1.0, 1.0)), k = tap(vec2(1.0, 1.0));
  vec3 l = tap(vec2(-1.0, -1.0)), m = tap(vec2(1.0, -1.0));
  vec3 result;
  if (uFirst > 0.5) {
    // Karis-weighted groups suppress fireflies from tiny, extremely bright pixels.
    vec3 g0 = (a + b + d + e) * 0.25;
    vec3 g1 = (b + c + e + f) * 0.25;
    vec3 g2 = (d + e + g + h) * 0.25;
    vec3 g3 = (e + f + h + i) * 0.25;
    vec3 g4 = (j + k + l + m) * 0.25;
    float w0 = karis(g0), w1 = karis(g1), w2 = karis(g2), w3 = karis(g3), w4 = karis(g4);
    result = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5)
      / (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
    float l0 = luma(result);
    float knee = uThreshold.y;
    float soft = clamp(l0 - uThreshold.x + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    result *= max(soft, l0 - uThreshold.x) / max(l0, 1e-4);
  } else {
    result = e * 0.125
      + (a + c + g + i) * 0.03125
      + (b + d + f + h) * 0.0625
      + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(result, 1.0);
}
`;

const UP_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius;
uniform float uWeight;

void main() {
  vec2 r = uTexel * uRadius;
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + vec2(-r.x, 0.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(r.x, 0.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(0.0, -r.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(0.0, r.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(-r.x, -r.y)).rgb;
  c += texture2D(tSrc, vUv + vec2(r.x, -r.y)).rgb;
  c += texture2D(tSrc, vUv + vec2(-r.x, r.y)).rgb;
  c += texture2D(tSrc, vUv + vec2(r.x, r.y)).rgb;
  gl_FragColor = vec4(c * (1.0 / 16.0) * uWeight, 1.0);
}
`;

/**
 * Progressive bloom: a thresholded, firefly-safe downsample chain followed by a tent
 * upsample that adds each level back into the one above it. The first level is half or full
 * resolution depending on the quality preset.
 */
export class Bloom {
  private levels: WebGLRenderTarget[] = [];
  private readonly down: FullscreenPass;
  private readonly up: FullscreenPass;
  private readonly texel = new Vector2();
  threshold = 1.0;
  knee = 0.6;
  radius = 1.0;

  constructor(private readonly depth = 5) {
    this.down = new FullscreenPass(
      new ShaderMaterial({
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: DOWN_FRAGMENT,
        uniforms: {
          tSrc: { value: null },
          uTexel: { value: new Vector2() },
          uFirst: { value: 0 },
          uThreshold: { value: new Vector2(1, 0.6) },
        },
        depthTest: false,
        depthWrite: false,
        blending: NoBlending,
      }),
    );
    this.up = new FullscreenPass(
      new ShaderMaterial({
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: UP_FRAGMENT,
        uniforms: {
          tSrc: { value: null },
          uTexel: { value: new Vector2() },
          uRadius: { value: 1 },
          uWeight: { value: 1 },
        },
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
  }

  /** Rebuilds the chain for a source of `width` by `height` pixels; `scale` is 0.5 or 1. */
  resize(width: number, height: number, scale: number): void {
    for (const level of this.levels) level.dispose();
    this.levels = [];
    let w = Math.max(2, Math.round(width * scale));
    let h = Math.max(2, Math.round(height * scale));
    for (let i = 0; i < this.depth; i++) {
      const target = new WebGLRenderTarget(w, h, {
        type: HalfFloatType,
        format: RGBAFormat,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
      target.texture.wrapS = ClampToEdgeWrapping;
      target.texture.wrapT = ClampToEdgeWrapping;
      this.levels.push(target);
      w = Math.max(2, w >> 1);
      h = Math.max(2, h >> 1);
    }
  }

  /** Runs the chain over `source` and returns the texture holding the final bloom. */
  render(
    renderer: WebGLRenderer,
    source: Texture,
    sourceWidth: number,
    sourceHeight: number,
  ): Texture {
    const downMat = this.down.material;
    const upMat = this.up.material;
    (downMat.uniforms.uThreshold?.value as Vector2).set(this.threshold, this.knee);

    let src: Texture = source;
    let srcW = sourceWidth;
    let srcH = sourceHeight;
    this.levels.forEach((level, i) => {
      this.texel.set(1 / srcW, 1 / srcH);
      (downMat.uniforms.tSrc as { value: Texture }).value = src;
      (downMat.uniforms.uTexel?.value as Vector2).copy(this.texel);
      (downMat.uniforms.uFirst as { value: number }).value = i === 0 ? 1 : 0;
      this.down.render(renderer, level);
      src = level.texture;
      srcW = level.width;
      srcH = level.height;
    });

    for (let i = this.levels.length - 2; i >= 0; i--) {
      const lower = this.levels[i + 1] as WebGLRenderTarget;
      const target = this.levels[i] as WebGLRenderTarget;
      this.texel.set(1 / lower.width, 1 / lower.height);
      (upMat.uniforms.tSrc as { value: Texture }).value = lower.texture;
      (upMat.uniforms.uTexel?.value as Vector2).copy(this.texel);
      (upMat.uniforms.uRadius as { value: number }).value = this.radius;
      this.up.render(renderer, target);
    }
    return (this.levels[0] as WebGLRenderTarget).texture;
  }

  dispose(): void {
    for (const level of this.levels) level.dispose();
    this.levels = [];
    this.down.dispose();
    this.up.dispose();
  }
}
