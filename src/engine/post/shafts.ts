import {
  ClampToEdgeWrapping,
  LinearFilter,
  NoBlending,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { FULLSCREEN_VERTEX, FullscreenPass } from './fullscreen';

const SHAFT_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform vec2 uSunUv;
uniform vec3 uColor;
uniform float uWeight;
uniform float uAspect;

// Radial march from the pixel toward the sun. Sky pixels (depth at the far plane) are the
// light source; anything nearer blocks it, so trees, hills and structures cut shafts into it.
void main() {
  const int STEPS = 28;
  vec2 delta = (uSunUv - vUv) / float(STEPS);
  vec2 uv = vUv;
  float accum = 0.0;
  float decay = 1.0;
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  uv += delta * jitter;
  for (int i = 0; i < STEPS; i++) {
    uv += delta;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { decay *= 0.94; continue; }
    float d = texture2D(tDepth, uv).r;
    float sky = step(0.99999, d);
    vec2 q = (uv - uSunUv) * vec2(uAspect, 1.0);
    float falloff = pow(clamp(1.0 - length(q) * 0.85, 0.0, 1.0), 2.0);
    accum += sky * falloff * decay;
    decay *= 0.94;
  }
  float s = accum / float(STEPS);
  // Sky pixels already glow on their own; the rays are for what stands in front of the sun.
  s *= mix(1.0, 0.1, step(0.99999, texture2D(tDepth, vUv).r));
  gl_FragColor = vec4(uColor * s * uWeight, 1.0);
}
`;

/** Quarter-resolution crepuscular rays, marched against the scene depth. */
export class LightShafts {
  private target: WebGLRenderTarget;
  private readonly pass: FullscreenPass;
  private readonly sunUv = new Vector2();

  constructor() {
    this.target = this.makeTarget(2, 2);
    this.pass = new FullscreenPass(
      new ShaderMaterial({
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: SHAFT_FRAGMENT,
        uniforms: {
          tDepth: { value: null },
          uSunUv: { value: new Vector2() },
          uColor: { value: new Vector3(1, 0.8, 0.5) },
          uWeight: { value: 1 },
          uAspect: { value: 1.78 },
        },
        depthTest: false,
        depthWrite: false,
        blending: NoBlending,
      }),
    );
  }

  private makeTarget(w: number, h: number): WebGLRenderTarget {
    const target = new WebGLRenderTarget(w, h, {
      type: UnsignedByteType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    target.texture.wrapS = ClampToEdgeWrapping;
    target.texture.wrapT = ClampToEdgeWrapping;
    return target;
  }

  resize(width: number, height: number): void {
    this.target.dispose();
    this.target = this.makeTarget(Math.max(2, width >> 2), Math.max(2, height >> 2));
  }

  /**
   * @param sunScreen sun position in 0..1 screen space (may lie outside the screen)
   * @param weight overall strength, already scaled by how directly the sun faces the camera
   */
  render(
    renderer: WebGLRenderer,
    depth: Texture,
    sunScreen: Vector2,
    color: Vector3,
    weight: number,
    aspect: number,
  ): Texture {
    this.sunUv.copy(sunScreen);
    const u = this.pass.material.uniforms;
    (u.tDepth as { value: Texture }).value = depth;
    (u.uSunUv?.value as Vector2).copy(this.sunUv);
    (u.uColor?.value as Vector3).copy(color);
    (u.uWeight as { value: number }).value = weight;
    (u.uAspect as { value: number }).value = aspect;
    this.pass.render(renderer, this.target);
    return this.target.texture;
  }

  get texture(): Texture {
    return this.target.texture;
  }

  dispose(): void {
    this.target.dispose();
    this.pass.dispose();
  }
}
