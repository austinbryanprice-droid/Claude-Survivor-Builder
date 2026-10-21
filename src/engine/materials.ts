import {
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type IUniform,
  type ShaderMaterialParameters,
  type Vector3,
} from 'three';
import type { AtmosphereUniforms } from './atmosphere';

/** Compile-time switches the quality preset flips on every lit material at once. */
export interface MaterialSwitches {
  /** Lit, self-shadowed clouds in the sky and in water reflections. */
  readonly richSky: boolean;
  /** Colored mist pockets in the haze. */
  readonly mist: boolean;
  /** Bump mapping from the ground layers' height channel. */
  readonly detailBump: boolean;
}

/**
 * Creates the ShaderMaterials that share the atmosphere and the shadow parameters, and keeps
 * them so a quality change can recompile them with new switches.
 */
export class MaterialRegistry {
  private readonly materials = new Set<ShaderMaterial>();
  private switches: MaterialSwitches = { richSky: true, mist: true, detailBump: true };

  constructor(
    readonly atmosphere: AtmosphereUniforms,
    /** x: shadows on, y: fade start, z: fade end (see lighting.glsl.ts). */
    readonly shadowParams: IUniform<Vector3>,
  ) {}

  /** A lit material: three's light and shadow uniforms plus the shared atmosphere. */
  create(
    params: ShaderMaterialParameters & { uniforms: Record<string, IUniform> },
  ): ShaderMaterial {
    const material = new ShaderMaterial({
      ...params,
      lights: true,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.lights),
        ...this.atmosphere,
        uShadowParams: this.shadowParams,
        ...params.uniforms,
      },
    });
    this.applySwitches(material);
    this.materials.add(material);
    return material;
  }

  /** An unlit material that still reads the atmosphere (sky, water body shader inputs). */
  createPlain(
    params: ShaderMaterialParameters & { uniforms: Record<string, IUniform> },
  ): ShaderMaterial {
    const material = new ShaderMaterial({
      ...params,
      uniforms: { ...this.atmosphere, uShadowParams: this.shadowParams, ...params.uniforms },
    });
    this.applySwitches(material);
    this.materials.add(material);
    return material;
  }

  /** Forgets a material this registry made and frees it, for things that come and go (another player's suit). */
  release(material: ShaderMaterial): void {
    if (this.materials.delete(material)) material.dispose();
  }

  setSwitches(next: MaterialSwitches): void {
    this.switches = next;
    for (const material of this.materials) {
      this.applySwitches(material);
      material.needsUpdate = true;
    }
  }

  private applySwitches(material: ShaderMaterial): void {
    const defines: Record<string, unknown> = { ...(material.defines as Record<string, unknown>) };
    const set = (key: string, on: boolean): void => {
      if (on) defines[key] = '1';
      else delete defines[key];
    };
    set('SKY_RICH', this.switches.richSky);
    set('MIST', this.switches.mist);
    set('DETAIL_BUMP', this.switches.detailBump);
    material.defines = defines as Record<string, string>;
  }

  dispose(): void {
    for (const material of this.materials) material.dispose();
    this.materials.clear();
  }
}
