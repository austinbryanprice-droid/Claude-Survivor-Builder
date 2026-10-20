import { NoBlending, ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import { FULLSCREEN_VERTEX, FullscreenPass } from './fullscreen';

const COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tHdr;
uniform sampler2D tBloom;
uniform sampler2D tShafts;
uniform vec2 uTexel;
uniform vec4 uParams;   // x exposure, y bloom strength, z saturation, w contrast
uniform vec4 uParams2;  // x vignette, y shaft strength, z fxaa on, w time
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform vec3 uShaftColor;

vec3 acesFilm(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 tone(vec3 hdr) { return acesFilm(hdr * uParams.x); }
float lumaG(vec3 c) { return dot(sqrt(c), vec3(0.299, 0.587, 0.114)); }
vec3 sampleTone(vec2 uv) { return tone(texture2D(tHdr, uv).rgb); }

// Compact FXAA on the tone-mapped image: cheap edge test first, blur only where needed.
vec3 fxaa(vec2 uv, vec3 rgbM) {
  vec3 rgbNW = sampleTone(uv + vec2(-1.0, -1.0) * uTexel);
  vec3 rgbNE = sampleTone(uv + vec2(1.0, -1.0) * uTexel);
  vec3 rgbSW = sampleTone(uv + vec2(-1.0, 1.0) * uTexel);
  vec3 rgbSE = sampleTone(uv + vec2(1.0, 1.0) * uTexel);
  float lNW = lumaG(rgbNW), lNE = lumaG(rgbNE), lSW = lumaG(rgbSW), lSE = lumaG(rgbSE);
  float lM = lumaG(rgbM);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.03, lMax * 0.1)) return rgbM;
  vec2 dir;
  dir.x = -((lNW + lNE) - (lSW + lSE));
  dir.y = ((lNW + lSW) - (lNE + lSE));
  float dirReduce = max((lNW + lNE + lSW + lSE) * 0.25 * 0.125, 1.0 / 128.0);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * uTexel;
  vec3 rgbA = 0.5 * (sampleTone(uv + dir * (1.0 / 3.0 - 0.5)) + sampleTone(uv + dir * (2.0 / 3.0 - 0.5)));
  vec3 rgbB = rgbA * 0.5 + 0.25 * (sampleTone(uv + dir * -0.5) + sampleTone(uv + dir * 0.5));
  float lB = lumaG(rgbB);
  return (lB < lMin || lB > lMax) ? rgbA : rgbB;
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec3 hdr = texture2D(tHdr, vUv).rgb;
  vec3 baseTone = tone(hdr);
  vec3 extra = texture2D(tBloom, vUv).rgb * uParams.y;
  if (uParams2.y > 0.0) extra += texture2D(tShafts, vUv).rgb * uShaftColor * uParams2.y;
  vec3 c = uParams2.z > 0.5 ? fxaa(vUv, baseTone) : baseTone;
  // Glow and shafts join in the HDR domain, so bright cores roll off like a film highlight.
  c += tone(hdr + extra) - baseTone;

  // Split toning: cool shadows, warm highlights (tints arrive luminance-normalized).
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float sm = 1.0 - smoothstep(0.0, 0.45, l);
  float hm = smoothstep(0.3, 0.95, l);
  c *= mix(vec3(1.0), uShadowTint, sm * 0.45);
  c *= mix(vec3(1.0), uHighlightTint, hm * 0.4);
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uParams.z);

  c = toSrgb(c);
  c = (c - 0.5) * uParams.w + 0.5;

  vec2 q = (vUv - 0.5) * vec2(1.0, 0.92);
  c *= 1.0 - uParams2.x * smoothstep(0.28, 0.95, length(q) * 1.45);

  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uParams2.w, vec2(0.06711056, 0.00583715))));
  c += (n - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
`;

/** The final pass: exposure, tone mapping, AA, glow, grade, vignette and dither to the screen. */
export class Composite {
  readonly pass: FullscreenPass;
  readonly uniforms: {
    tHdr: { value: unknown };
    tBloom: { value: unknown };
    tShafts: { value: unknown };
    uTexel: { value: Vector2 };
    uParams: { value: Vector4 };
    uParams2: { value: Vector4 };
    uShadowTint: { value: Vector3 };
    uHighlightTint: { value: Vector3 };
    uShaftColor: { value: Vector3 };
  };

  constructor() {
    this.uniforms = {
      tHdr: { value: null },
      tBloom: { value: null },
      tShafts: { value: null },
      uTexel: { value: new Vector2() },
      uParams: { value: new Vector4(1, 0.5, 1.1, 1.08) },
      uParams2: { value: new Vector4(0.25, 0, 1, 0) },
      uShadowTint: { value: new Vector3(1, 1, 1) },
      uHighlightTint: { value: new Vector3(1, 1, 1) },
      uShaftColor: { value: new Vector3(1, 0.85, 0.6) },
    };
    this.pass = new FullscreenPass(
      new ShaderMaterial({
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: COMPOSITE_FRAGMENT,
        uniforms: this.uniforms,
        depthTest: false,
        depthWrite: false,
        blending: NoBlending,
      }),
    );
  }

  dispose(): void {
    this.pass.dispose();
  }
}
