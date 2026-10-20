import {
  Color,
  SRGBColorSpace,
  Vector3,
  Vector4,
  type Camera,
  type IUniform,
  type Texture,
} from 'three';
import type { Rgb, SkyState } from '../shared/daycycle';

type U<T> = IUniform<T>;

/** Where the mist pockets sit; the scene sets these from the terrain field. */
export interface MistZones {
  readonly lake: { x: number; z: number; radius: number; top: number };
  readonly crash: { x: number; z: number; radius: number; top: number };
}

/** The shared uniform objects every material includes; one update per frame reaches them all. */
export type AtmosphereUniforms = {
  uCamPos: U<Vector3>;
  uSunDir: U<Vector3>;
  uMoonDir: U<Vector3>;
  uKeyDir: U<Vector3>;
  uKeyColor: U<Color>;
  uSunColor: U<Color>;
  uSkyZenith: U<Color>;
  uSkyMid: U<Color>;
  uSkyHorizon: U<Color>;
  uSkyHorizonSun: U<Color>;
  uFogColor: U<Color>;
  uFogSunColor: U<Color>;
  uCloudLit: U<Color>;
  uCloudShade: U<Color>;
  uAmbSky: U<Color>;
  uAmbGround: U<Color>;
  uSkyParams: U<Vector4>;
  uFogParams: U<Vector4>;
  uMistLake: U<Vector4>;
  uMistCrash: U<Vector4>;
  uMistLakeColor: U<Color>;
  uMistCrashColor: U<Color>;
  uMistParams: U<Vector4>;
  uNoise: U<Texture | null>;
};

function setSrgb(target: Color, rgb: Rgb, scale = 1): void {
  target.setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);
  if (scale !== 1) target.multiplyScalar(scale);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface FogTuning {
  /** Multiplies the palette's fog density. */
  readonly densityScale: number;
  /** Height fog falloff in 1/m (smaller = taller haze). */
  readonly heightFalloff: number;
  /** Altitude at which the base density applies. */
  readonly baseHeight: number;
}

export const DEFAULT_FOG: FogTuning = { densityScale: 1, heightFalloff: 0.022, baseHeight: 8 };

/**
 * Holds the shared atmosphere uniforms and fills them from a `SkyState`. Colors are converted
 * from the palette's sRGB to linear once per update, so shaders only ever see linear values.
 */
export class Atmosphere {
  readonly uniforms: AtmosphereUniforms;
  fog: FogTuning = DEFAULT_FOG;
  /** Brightness of the mist pockets relative to the palette; tuned by the scene. */
  mistStrength = 1;

  constructor(noise: Texture | null, zones: MistZones) {
    this.uniforms = {
      uCamPos: { value: new Vector3() },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uMoonDir: { value: new Vector3(0, 1, 0) },
      uKeyDir: { value: new Vector3(0, 1, 0) },
      uKeyColor: { value: new Color() },
      uSunColor: { value: new Color() },
      uSkyZenith: { value: new Color() },
      uSkyMid: { value: new Color() },
      uSkyHorizon: { value: new Color() },
      uSkyHorizonSun: { value: new Color() },
      uFogColor: { value: new Color() },
      uFogSunColor: { value: new Color() },
      uCloudLit: { value: new Color() },
      uCloudShade: { value: new Color() },
      uAmbSky: { value: new Color() },
      uAmbGround: { value: new Color() },
      uSkyParams: { value: new Vector4(0.5, 0, 0, 1) },
      uFogParams: { value: new Vector4(0.002, 0.022, 8, 0) },
      uMistLake: {
        value: new Vector4(zones.lake.x, zones.lake.z, zones.lake.radius, zones.lake.top),
      },
      uMistCrash: {
        value: new Vector4(zones.crash.x, zones.crash.z, zones.crash.radius, zones.crash.top),
      },
      uMistLakeColor: { value: new Color() },
      uMistCrashColor: { value: new Color() },
      uMistParams: { value: new Vector4(0.026, 0.034, 0, 0) },
      uNoise: { value: noise },
    };
  }

  update(sky: SkyState, camera: Camera, timeSeconds: number): void {
    const u = this.uniforms;
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uSunDir.value.set(...sky.sunDir);
    u.uMoonDir.value.set(...sky.moonDir);

    // The key light is the sun by day and the moon by night, handing over smoothly at dusk.
    const k = smoothstep(4, -8, sky.sunElevation);
    u.uKeyDir.value
      .set(...sky.sunDir)
      .lerp(u.uMoonDir.value, k)
      .normalize();
    const sunLinear = new Color();
    setSrgb(sunLinear, sky.sunColor, sky.sunIntensity);
    const moonLinear = new Color();
    setSrgb(moonLinear, sky.moonColor, sky.moonIntensity);
    u.uKeyColor.value.copy(sunLinear).lerp(moonLinear, k);
    setSrgb(u.uSunColor.value, sky.sunColor, Math.max(sky.sunIntensity, 0.8));

    setSrgb(u.uSkyZenith.value, sky.zenith);
    setSrgb(u.uSkyMid.value, sky.mid);
    setSrgb(u.uSkyHorizon.value, sky.horizon);
    setSrgb(u.uSkyHorizonSun.value, sky.horizonSun);
    setSrgb(u.uFogColor.value, sky.fog);
    setSrgb(u.uFogSunColor.value, sky.fogSun);
    setSrgb(u.uCloudLit.value, sky.cloudLit);
    setSrgb(u.uCloudShade.value, sky.cloudShade);
    setSrgb(u.uAmbSky.value, sky.ambientSky, sky.ambientIntensity);
    setSrgb(u.uAmbGround.value, sky.ambientGround, sky.ambientIntensity * 0.85);

    u.uSkyParams.value.set(sky.cloudCover, sky.night, timeSeconds, 1);
    u.uFogParams.value.set(
      0.0042 * sky.fogDensity * this.fog.densityScale,
      this.fog.heightFalloff,
      this.fog.baseHeight,
      0,
    );

    // Mist is lit by the sky: dimmer at night, tinted warm at golden hour.
    const mistLight = (0.35 + 0.65 * (1 - sky.night)) * this.mistStrength;
    u.uMistLakeColor.value.setRGB(0.28, 0.82, 0.8, SRGBColorSpace).multiplyScalar(mistLight);
    u.uMistLakeColor.value.lerp(u.uFogSunColor.value, 0.12);
    u.uMistCrashColor.value.setRGB(0.78, 0.3, 0.2, SRGBColorSpace).multiplyScalar(mistLight);
    u.uMistParams.value.set(0.026, 0.034, 0, 0);
  }
}
